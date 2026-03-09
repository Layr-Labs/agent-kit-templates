import { join } from 'path'
import { existsSync } from 'fs'
import { mnemonicToSeedSync } from 'bip39'
import { SubstackClient, loadCookies, saveCookies } from 'substack-skill'
import type { CookieEntry } from 'substack-skill'
import { tool, gateway } from 'ai'
import { z } from 'zod'
import type { EventBus } from '../../console/events.js'
import type { AgentIdentity } from '../../types.js'
import type { BrowserLike } from '../../browser/types.js'
import { generateTrackedText } from '../../ai/tracking.js'
import { buildPersonaPrompt } from '../../prompts/identity.js'

const SUBSTACK_BASE = 'https://substack.com'
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36'

async function derivePrivateKey(mnemonic: string): Promise<`0x${string}`> {
  const { HDKey } = await import('viem/accounts')
  const seed = mnemonicToSeedSync(mnemonic)
  const hd = HDKey.fromMasterSeed(seed)
  const derived = hd.derive("m/44'/60'/0'/0/0")
  return `0x${Buffer.from(derived.privateKey!).toString('hex')}` as `0x${string}`
}

/**
 * Use the browser (which routes through the residential proxy) to navigate
 * to substack.com and solve the Cloudflare challenge. Returns cookies
 * including cf_clearance that can be used for subsequent API calls.
 */
async function warmupCloudflare(browser: BrowserLike, events: EventBus): Promise<CookieEntry[]> {
  events.monologue('Warming up Cloudflare session via browser...')

  await browser.navigate('https://substack.com')
  await browser.waitMs(5000)

  // Extract cookies via CDP (document.cookie misses httpOnly cookies)
  const cookieJson = await browser.evaluate<string>(`
    (async () => {
      try {
        // Use CDP to get all cookies including httpOnly
        const resp = await fetch('http://localhost:9222/json');
        const targets = await resp.json();
        const wsUrl = targets[0]?.webSocketDebuggerUrl;
        if (!wsUrl) return JSON.stringify([]);

        return new Promise((resolve) => {
          const ws = new WebSocket(wsUrl);
          ws.onopen = () => {
            ws.send(JSON.stringify({ id: 1, method: 'Network.getCookies', params: { urls: ['https://substack.com', 'https://.substack.com'] } }));
          };
          ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.id === 1) {
              ws.close();
              resolve(JSON.stringify(data.result?.cookies ?? []));
            }
          };
          setTimeout(() => { ws.close(); resolve(JSON.stringify([])); }, 5000);
        });
      } catch {
        // Fallback: document.cookie (won't have httpOnly cookies)
        const pairs = document.cookie.split(';').map(s => s.trim()).filter(Boolean);
        const cookies = pairs.map(p => {
          const [name, ...rest] = p.split('=');
          return { name: name.trim(), value: rest.join('='), domain: '.substack.com' };
        });
        return JSON.stringify(cookies);
      }
    })()
  `)

  try {
    const rawCookies = JSON.parse(cookieJson) as any[]
    const cookies: CookieEntry[] = rawCookies.map(c => ({
      name: c.name,
      value: c.value,
      domain: c.domain ?? '.substack.com',
      path: c.path ?? '/',
      secure: c.secure ?? false,
    }))

    const hasClearance = cookies.some(c => c.name === 'cf_clearance')
    events.monologue(`Cloudflare warmup: got ${cookies.length} cookies${hasClearance ? ' (cf_clearance found)' : ''}`)
    return cookies
  } catch {
    events.monologue('Cloudflare warmup: failed to parse cookies')
    return []
  }
}

/**
 * Perform the Substack OTP login with Cloudflare clearance cookies.
 * This replicates the substack-skill login() flow but includes
 * cf_clearance cookies in all requests to bypass Cloudflare.
 */
async function loginWithClearance(
  privateKey: `0x${string}`,
  clearanceCookies: CookieEntry[],
  cookiesPath: string,
  events: EventBus,
): Promise<{ cookies: CookieEntry[]; email: string }> {
  const { EigenMailClient } = await import('eigenmail-sdk')

  const mail = new EigenMailClient({ privateKey })
  const loginResult = await mail.login()
  const email = loginResult.email ?? (await mail.me()).email
  events.monologue(`Login email: ${email}`)

  const cookieHeader = clearanceCookies.map(c => `${c.name}=${c.value}`).join('; ')

  // Step 1: Request OTP
  events.monologue('Requesting login OTP...')
  const loginRes = await fetch(`${SUBSTACK_BASE}/api/v1/email-login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': DEFAULT_USER_AGENT,
      'Cookie': cookieHeader,
    },
    body: JSON.stringify({
      email,
      redirect: '/',
      can_create_user: true,
    }),
  })

  if (!loginRes.ok) {
    const err = await loginRes.text()
    throw new Error(`email-login failed (${loginRes.status}): ${err.slice(0, 200)}`)
  }

  // Step 2: Wait for OTP email
  events.monologue('Waiting for OTP email...')
  const otpRequestedAt = new Date(Date.now() - 3000)
  const otpEmail: any = await mail.waitForEmail({
    since: otpRequestedAt,
    subject: 'verification code',
    timeout: 120000,
    interval: 3000,
  })

  const subjectCode = (otpEmail?.subject ?? '').match(/^(\d{6})/)?.[1]
  const bodyCode = String(otpEmail?.body ?? otpEmail?.text ?? '').match(/\b(\d{6})\b/)?.[1]
  const code = subjectCode ?? bodyCode

  if (!code) {
    throw new Error(`Could not extract OTP code from email. Subject: "${otpEmail?.subject ?? 'none'}"`)
  }

  events.monologue('Got OTP code, completing login...')

  // Step 3: Complete login with OTP
  const completeRes = await fetch(`${SUBSTACK_BASE}/api/v1/email-otp-login/complete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': DEFAULT_USER_AGENT,
      'Cookie': cookieHeader,
    },
    body: JSON.stringify({
      code,
      email,
      redirect: `${SUBSTACK_BASE}/`,
    }),
    redirect: 'manual',
  })

  if (!completeRes.ok && completeRes.status !== 302) {
    const err = await completeRes.text()
    throw new Error(`email-otp-login/complete failed (${completeRes.status}): ${err.slice(0, 200)}`)
  }

  // Extract session cookies from response
  const setCookieHeaders = completeRes.headers.getSetCookie?.() ?? []
  const sessionCookies: CookieEntry[] = []

  for (const header of setCookieHeaders) {
    const parts = header.split(';').map(s => s.trim())
    const [nameValue] = parts
    const eqIdx = nameValue.indexOf('=')
    if (eqIdx === -1) continue

    const name = nameValue.slice(0, eqIdx)
    const value = nameValue.slice(eqIdx + 1)

    let domain = '.substack.com'
    let path = '/'
    let secure = false
    for (const attr of parts.slice(1)) {
      const lower = attr.toLowerCase()
      if (lower.startsWith('domain=')) domain = attr.slice(7)
      else if (lower.startsWith('path=')) path = attr.slice(5)
      else if (lower === 'secure') secure = true
    }

    sessionCookies.push({ name, value, domain, path, secure })
  }

  // Merge: clearance cookies + session cookies (session cookies override)
  const cookieMap = new Map<string, CookieEntry>()
  for (const c of clearanceCookies) cookieMap.set(c.name, c)
  for (const c of sessionCookies) cookieMap.set(c.name, c)
  const allCookies = [...cookieMap.values()]

  if (sessionCookies.length === 0) {
    throw new Error('Login succeeded but no session cookies returned.')
  }

  // Handle email confirmation for new accounts
  try {
    const inbox: any = await mail.inbox()
    const messages = inbox?.messages ?? []
    const confirmMsg = messages.find(
      (m: any) => m.subject?.toLowerCase().includes('confirm') && m.from?.toLowerCase().includes('substack'),
    )
    if (confirmMsg) {
      events.monologue('Confirming email...')
      const fullMsg: any = await mail.read(confirmMsg.id)
      const body = String(fullMsg?.body ?? '')
      const linkMatch = body.match(/(https:\/\/email\.mg[^\s"<>]*\/c\/[^\s"<>]*)/) ??
        body.match(/(https?:\/\/[^\s"<>]*substack[^\s"<>]*confirm[^\s"<>]*)/i)
      if (linkMatch) {
        await fetch(linkMatch[1], {
          headers: {
            Cookie: allCookies.map(c => `${c.name}=${c.value}`).join('; '),
            'User-Agent': DEFAULT_USER_AGENT,
          },
          redirect: 'follow',
        })
        events.monologue('Email confirmed!')
      }
    }
  } catch {}

  // Save cookies
  await saveCookies(cookiesPath, allCookies)
  events.monologue(`Logged in! Got ${allCookies.length} cookies.`)

  return { cookies: allCookies, email }
}

/**
 * Initialize an authenticated SubstackClient.
 *
 * 1. Try restoring session from saved cookies
 * 2. If expired/missing, warm up Cloudflare via browser, then login via OTP API
 * 3. Falls back to direct API login if no browser is available
 */
export async function initSubstackClient(
  mnemonic: string,
  dataDir: string,
  events: EventBus,
  browser?: BrowserLike,
): Promise<SubstackClient> {
  const cookiesPath = join(dataDir, 'substack-cookies.json')
  const client = new SubstackClient()

  // Try restoring existing session
  if (existsSync(cookiesPath)) {
    try {
      const cookies = await loadCookies(cookiesPath)
      await client.authenticate({ cookies })
      const status = await client.amILoggedIn() as any
      if (status) {
        events.monologue('Substack session restored from cookies')
        return client
      }
    } catch {
      events.monologue('Saved Substack cookies invalid, re-authenticating...')
    }
  }

  if (!mnemonic) throw new Error('MNEMONIC required for Substack login')

  const privateKey = await derivePrivateKey(mnemonic)

  // Warm up Cloudflare via browser if available (needed for datacenter IPs)
  let clearanceCookies: CookieEntry[] = []
  if (browser) {
    try {
      clearanceCookies = await warmupCloudflare(browser, events)
    } catch (err) {
      events.monologue(`Cloudflare warmup failed: ${(err as Error).message}`)
    }
  }

  if (clearanceCookies.length > 0) {
    // Login with Cloudflare clearance cookies
    events.monologue('Logging into Substack via API (with Cloudflare clearance)...')
    const { cookies, email } = await loginWithClearance(privateKey, clearanceCookies, cookiesPath, events)
    events.monologue(`Logged into Substack as ${email}`)
    await client.authenticate({ cookies })
    return client
  }

  // Fallback: direct API login (works from residential IPs, may fail from datacenter)
  events.monologue('Logging into Substack via API (direct)...')
  const { login } = await import('substack-skill')
  const { cookies, email } = await login({
    eigenMailPrivateKey: privateKey,
    cookiesPath,
  })
  events.monologue(`Logged into Substack as ${email}`)
  await client.authenticate({ cookies })
  return client
}

/**
 * Re-authenticate with Substack if session expired.
 * Returns true if session is now valid.
 */
export async function refreshSession(
  client: SubstackClient,
  mnemonic: string,
  dataDir: string,
  events: EventBus,
  browser?: BrowserLike,
): Promise<boolean> {
  try {
    const status = await client.amILoggedIn() as any
    if (status) return true
  } catch {}

  events.monologue('Substack session expired — re-authenticating...')
  try {
    const cookiesPath = join(dataDir, 'substack-cookies.json')
    const privateKey = await derivePrivateKey(mnemonic)

    let clearanceCookies: CookieEntry[] = []
    if (browser) {
      try { clearanceCookies = await warmupCloudflare(browser, events) } catch {}
    }

    if (clearanceCookies.length > 0) {
      const { cookies, email } = await loginWithClearance(privateKey, clearanceCookies, cookiesPath, events)
      await client.authenticate({ cookies })
      events.monologue(`Re-authenticated as ${email}`)
    } else {
      const { login } = await import('substack-skill')
      const { cookies, email } = await login({ eigenMailPrivateKey: privateKey, cookiesPath })
      await client.authenticate({ cookies })
      events.monologue(`Re-authenticated as ${email}`)
    }
    return true
  } catch (err) {
    events.monologue(`Re-authentication failed: ${(err as Error).message}`)
    return false
  }
}

/**
 * LLM-driven publication setup.
 *
 * Fetches current publication/profile state, then uses an LLM with tools
 * to align the publication with the agent's identity from SOUL.md.
 * Only updates fields that are missing or mismatched.
 */
export async function setupPublication(
  client: SubstackClient,
  identity: AgentIdentity,
  events: EventBus,
  model: string = 'claude-haiku-4-5-20251001',
): Promise<void> {
  events.monologue('Checking publication setup...')

  let self: any
  let publication: any

  try {
    self = await client.getSelf()
    publication = await client.getPublication()
  } catch (err) {
    events.monologue(`Publication not found, attempting initial setup: ${(err as Error).message}`)
    try {
      await client.acceptPublisherAgreement()
      self = await client.getSelf()
      publication = await client.getPublication()
    } catch (setupErr) {
      events.monologue(`Publication setup failed: ${(setupErr as Error).message}`)
      return
    }
  }

  const setupTools = {
    update_publication: tool({
      description: 'Update the Substack publication metadata (name, description, about page, etc.).',
      inputSchema: z.object({
        name: z.string().optional().describe('Publication name'),
        subdomain: z.string().optional().describe('Subdomain (e.g. "my-pub" for my-pub.substack.com)'),
        author_bio: z.string().optional().describe('Author bio shown on the publication'),
        copyright: z.string().optional().describe('Copyright notice'),
      }),
      execute: async (fields: Record<string, unknown>) => {
        const clean = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined))
        if (Object.keys(clean).length === 0) return { success: true, message: 'Nothing to update' }
        await client.updatePublication(clean)
        return { success: true, updated: Object.keys(clean) }
      },
    }),

    update_profile: tool({
      description: 'Update the authenticated user profile (display name, handle, bio).',
      inputSchema: z.object({
        name: z.string().optional().describe('Display name'),
        handle: z.string().optional().describe('Username handle'),
        bio: z.string().optional().describe('Short profile bio'),
      }),
      execute: async (fields: Record<string, unknown>) => {
        const clean = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined))
        if (Object.keys(clean).length === 0) return { success: true, message: 'Nothing to update' }
        await client.updateProfile(clean as any)
        return { success: true, updated: Object.keys(clean) }
      },
    }),

    list_categories: tool({
      description: 'List all available Substack categories/tags for publication discovery.',
      inputSchema: z.object({}),
      execute: async () => {
        return client.listCategories()
      },
    }),

    set_publication_tag: tool({
      description: 'Set a category tag for the publication to help with discovery.',
      inputSchema: z.object({
        tag_id: z.number().describe('Category/tag ID from list_categories'),
        rank: z.number().describe('Priority rank (1 = primary)'),
      }),
      execute: async ({ tag_id, rank }: { tag_id: number; rank: number }) => {
        await client.setPublicationTag(tag_id, rank)
        return { success: true }
      },
    }),

    setup_complete: tool({
      description: 'Call when publication setup is complete. Provide a brief summary of changes made.',
      inputSchema: z.object({
        summary: z.string().describe('Brief summary of what was set up or changed'),
      }),
    }),
  }

  const persona = buildPersonaPrompt(identity)

  await generateTrackedText({
    operation: 'publication_setup',
    modelId: model,
    model: gateway(model),
    system: `You are setting up a Substack publication for an autonomous media agent. Review the current publication and profile state, then make any necessary updates to align it with the agent's identity.

${persona}

Guidelines:
- Only update fields that are missing or don't match the agent's identity
- If the publication is already well-configured, just call setup_complete
- Publication name should reflect the agent's identity
- Bio/description should capture the agent's voice and mission
- Set appropriate category tags for discoverability
- Be concise — Substack has character limits on most fields
- Call setup_complete when done`,
    prompt: `Current profile:\n${JSON.stringify(self, null, 2)}\n\nCurrent publication:\n${JSON.stringify(publication, null, 2)}`,
    tools: setupTools,
    maxSteps: 10,
  })

  events.monologue('Publication setup complete')
}
