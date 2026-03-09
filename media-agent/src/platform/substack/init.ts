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
 * Perform the full Substack login through the browser.
 *
 * All API calls are made inside the browser via evaluate(), which means
 * they route through the same residential proxy and share the browser's
 * Cloudflare session. This bypasses Cloudflare bot detection that blocks
 * direct fetch() from datacenter IPs.
 */
async function loginViaBrowser(
  privateKey: `0x${string}`,
  browser: BrowserLike,
  cookiesPath: string,
  events: EventBus,
): Promise<{ cookies: CookieEntry[]; email: string }> {
  const { EigenMailClient } = await import('eigenmail-sdk')

  const mail = new EigenMailClient({ privateKey })
  const loginResult = await mail.login()
  const email = loginResult.email ?? (await mail.me()).email
  events.monologue(`Login email: ${email}`)

  // Navigate to substack.com to establish Cloudflare session
  events.monologue('Navigating to Substack (Cloudflare warmup)...')
  await browser.navigate('https://substack.com')
  await browser.waitMs(5000)

  // Step 1: Request OTP — runs inside browser (same proxy, same CF session)
  events.monologue('Requesting login OTP via browser...')
  const otpResult = await browser.evaluate<string>(`
    (async () => {
      try {
        const res = await fetch('/api/v1/email-login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            email: ${JSON.stringify(email)},
            redirect: '/',
            can_create_user: true,
          }),
        });
        if (!res.ok) return JSON.stringify({ error: 'HTTP ' + res.status });
        return JSON.stringify({ ok: true });
      } catch (e) {
        return JSON.stringify({ error: e.message });
      }
    })()
  `)

  const otpParsed = JSON.parse(otpResult)
  if (otpParsed.error) {
    throw new Error(`email-login failed: ${otpParsed.error}`)
  }

  // Step 2: Wait for OTP email by polling inbox (runs in Node, not browser)
  // Collect message IDs that existed BEFORE the OTP request so we skip stale codes.
  const preExistingIds = new Set<string>()
  try {
    const before: any = await mail.inbox({ limit: 10 })
    for (const m of (before?.messages ?? [])) {
      if (m.id) preExistingIds.add(m.id)
    }
  } catch {}

  events.monologue(`Waiting for OTP email... (${preExistingIds.size} pre-existing messages to skip)`)

  let code: string | null = null
  for (let attempt = 0; attempt < 40; attempt++) {
    await new Promise(r => setTimeout(r, 3000))

    try {
      const inbox: any = await mail.inbox({ limit: 10 })
      const messages = inbox?.messages ?? []

      for (const msg of messages) {
        // Skip messages that existed before we requested the OTP
        if (preExistingIds.has(msg.id)) continue

        // Check if it's from Substack
        const from = String(msg.from ?? '').toLowerCase()
        const subject = String(msg.subject ?? '').toLowerCase()
        if (!from.includes('substack') && !subject.includes('substack') && !subject.includes('verification')) continue

        // Try extracting 6-digit code from subject
        const subjectCode = String(msg.subject ?? '').match(/(\d{6})/)?.[1]
        if (subjectCode) {
          code = subjectCode
          events.monologue(`Found OTP code in subject: ${msg.subject}`)
          break
        }

        // Read full message body for code
        try {
          const full: any = await mail.read(msg.id)
          const body = String(full?.body ?? full?.text ?? '')
          const bodyCode = body.match(/\b(\d{6})\b/)?.[1]
          if (bodyCode) {
            code = bodyCode
            events.monologue(`Found OTP code in body`)
            break
          }
        } catch {}
      }

      if (code) break
    } catch (err) {
      events.monologue(`Inbox poll error: ${(err as Error).message}`)
    }
  }

  if (!code) {
    throw new Error('Could not find Substack OTP code in inbox after 2 minutes.')
  }

  events.monologue('Got OTP code, completing login via browser...')

  // Step 3: Complete login with OTP — runs inside browser
  const loginCompleteResult = await browser.evaluate<string>(`
    (async () => {
      try {
        const res = await fetch('/api/v1/email-otp-login/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            code: ${JSON.stringify(code)},
            email: ${JSON.stringify(email)},
            redirect: '/',
          }),
        });
        // Follow any redirect manually
        if (res.redirected) {
          return JSON.stringify({ ok: true, url: res.url });
        }
        if (!res.ok) return JSON.stringify({ error: 'HTTP ' + res.status });
        return JSON.stringify({ ok: true });
      } catch (e) {
        return JSON.stringify({ error: e.message });
      }
    })()
  `)

  const completeParsed = JSON.parse(loginCompleteResult)
  if (completeParsed.error) {
    throw new Error(`email-otp-login/complete failed: ${completeParsed.error}`)
  }

  // Wait for cookies to settle
  await browser.waitMs(2000)

  // Extract cookies from the browser.
  // Use document.cookie (gets non-httpOnly cookies) + CDP via Node fetch (gets all cookies).
  events.monologue('Extracting session cookies...')

  // First try CDP from Node side (not from inside browser page)
  let cookieJson = '[]'
  try {
    const cdpRes = await fetch('http://localhost:9222/json')
    const targets = await cdpRes.json() as any[]
    const wsUrl = targets[0]?.webSocketDebuggerUrl
    if (wsUrl) {
      cookieJson = await new Promise<string>((resolve) => {
        const ws = new WebSocket(wsUrl)
        ws.onopen = () => {
          ws.send(JSON.stringify({
            id: 1,
            method: 'Network.getCookies',
            params: { urls: ['https://substack.com', 'https://.substack.com'] },
          }))
        }
        ws.onmessage = (event: any) => {
          const data = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString())
          if (data.id === 1) {
            ws.close()
            resolve(JSON.stringify(data.result?.cookies ?? []))
          }
        }
        setTimeout(() => { ws.close(); resolve('[]') }, 5000)
      })
    }
  } catch {
    // Fallback: extract from document.cookie inside browser
    cookieJson = await browser.evaluate<string>(`
      (() => {
        const pairs = document.cookie.split(';').map(s => s.trim()).filter(Boolean);
        return JSON.stringify(pairs.map(p => {
          const [name, ...rest] = p.split('=');
          return { name: name.trim(), value: rest.join('='), domain: '.substack.com', path: '/', secure: true };
        }));
      })()
    `)
  }

  let cookies: CookieEntry[] = []
  try {
    const rawCookies = JSON.parse(cookieJson) as any[]
    cookies = rawCookies
      .filter((c: any) => c.domain?.includes('substack'))
      .map((c: any) => ({
        name: c.name,
        value: c.value,
        domain: c.domain ?? '.substack.com',
        path: c.path ?? '/',
        secure: c.secure ?? false,
      }))
  } catch {}

  if (cookies.length === 0) {
    throw new Error('Login completed but no cookies could be extracted from browser.')
  }

  const hasSession = cookies.some(c => c.name === 'substack.sid')
  events.monologue(`Got ${cookies.length} cookies${hasSession ? ' (session found)' : ''}`)

  // Handle email confirmation for new accounts
  try {
    const inbox: any = await mail.inbox()
    const messages = inbox?.messages ?? []
    const confirmMsg = messages.find(
      (m: any) => m.subject?.toLowerCase().includes('confirm') && m.from?.toLowerCase().includes('substack'),
    )
    if (confirmMsg) {
      events.monologue('Confirming email via browser...')
      const fullMsg: any = await mail.read(confirmMsg.id)
      const body = String(fullMsg?.body ?? '')
      const linkMatch = body.match(/(https:\/\/email\.mg[^\s"<>]*\/c\/[^\s"<>]*)/) ??
        body.match(/(https?:\/\/[^\s"<>]*substack[^\s"<>]*confirm[^\s"<>]*)/i)
      if (linkMatch) {
        await browser.navigate(linkMatch[1])
        await browser.waitMs(3000)
        events.monologue('Email confirmed!')
      }
    }
  } catch {}

  // Save cookies for future sessions (SubstackClient can restore from these)
  await saveCookies(cookiesPath, cookies)
  events.monologue(`Logged in as ${email}`)

  return { cookies, email }
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
      const status = await client.amILoggedIn()
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

  if (browser) {
    // Login through the browser — all API calls route through the residential
    // proxy, bypassing Cloudflare bot detection on datacenter IPs.
    events.monologue('Logging into Substack via browser...')
    const { cookies, email } = await loginViaBrowser(privateKey, browser, cookiesPath, events)
    events.monologue(`Logged into Substack as ${email}`)
    await client.authenticate({ cookies })
    return client
  }

  // Fallback: direct API login (works from residential IPs, may fail from datacenter)
  events.monologue('Logging into Substack via API (direct, no browser)...')
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
    const status = await client.amILoggedIn()
    if (status) return true
  } catch {}

  events.monologue('Substack session expired — re-authenticating...')
  try {
    const cookiesPath = join(dataDir, 'substack-cookies.json')
    const privateKey = await derivePrivateKey(mnemonic)

    if (browser) {
      const { cookies, email } = await loginViaBrowser(privateKey, browser, cookiesPath, events)
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

  let self = await client.getSelf()

  // If no publication exists, create one
  if (!self.primaryPublication) {
    events.monologue('No publication found — creating one...')
    try {
      await client.acceptPublisherAgreement()
      const subdomain = identity.name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24) || 'agentpub'
      const description = identity.tagline || `${identity.name}'s publication`
      await client.createPublication(identity.name, subdomain, description)
      // Clear cached self to pick up the new publication
      self = await client.getSelf()
      events.monologue(`Publication created: ${self.primaryPublication?.subdomain}`)
    } catch (err) {
      events.monologue(`Publication creation failed: ${(err as Error).message}`)
      return
    }
  }

  let publication: any
  try {
    publication = await client.getPublication()
  } catch (err) {
    events.monologue(`Could not fetch publication: ${(err as Error).message}`)
    return
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
    system: `${persona}

<publication_setup_task>
  <goal>Align the Substack publication with the agent's identity.</goal>
  <rules>
    <rule>Only update fields that are missing or don't match the agent's identity.</rule>
    <rule>If the publication is already well-configured, just call setup_complete.</rule>
    <rule>Publication name should reflect the agent's identity.</rule>
    <rule>Bio/description should capture the agent's voice and mission.</rule>
    <rule>Set appropriate category tags for discoverability.</rule>
    <rule>Be concise — Substack has character limits on most fields.</rule>
    <rule>Call setup_complete when done.</rule>
  </rules>
</publication_setup_task>`,
    prompt: `<current_profile>\n${JSON.stringify(self, null, 2)}\n</current_profile>\n\n<current_publication>\n${JSON.stringify(publication, null, 2)}\n</current_publication>`,
    tools: setupTools,
    maxSteps: 10,
  })

  events.monologue('Publication setup complete')
}
