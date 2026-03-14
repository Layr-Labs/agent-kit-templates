import { join } from 'path'
import { existsSync } from 'fs'
import { mnemonicToSeedSync } from 'bip39'
import { SubstackClient, loadCookies, saveCookies } from 'substack-skill'
import type { CookieEntry } from 'substack-skill'
import { tool } from 'ai'
import { z } from 'zod'
import type { EventBus } from '../../console/events.js'
import type { Config } from '../../config/index.js'
import type { AgentIdentity } from '../../types.js'
import type { BrowserLike } from '../../browser/types.js'
import { generateTrackedText } from '../../ai/tracking.js'
import { buildPersonaPrompt } from '../../prompts/identity.js'
import { makeUpdatePublicationExecute, makeUpdateProfileExecute } from './helpers.js'
import {
  collectRegexOtpCandidates,
  extractSubstackOtpCandidates,
  findOtpCodesInText,
  maskOtpCode,
  type OtpCandidate,
} from './otp.js'

const SUBSTACK_BASE = 'https://substack.com'
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36'
const OTP_DEBUG_CODE_REGEX = /\b\d{6}\b/g

export interface CdpBrowserTarget {
  type?: string
  url?: string
  title?: string
  webSocketDebuggerUrl?: string
}

async function derivePrivateKey(mnemonic: string): Promise<`0x${string}`> {
  const { HDKey } = await import('viem/accounts')
  const seed = mnemonicToSeedSync(mnemonic)
  const hd = HDKey.fromMasterSeed(seed)
  const derived = hd.derive("m/44'/60'/0'/0/0")
  return `0x${Buffer.from(derived.privateKey!).toString('hex')}` as `0x${string}`
}

interface LoginCompletionResult {
  ok: boolean
  error?: string
  status?: number
  statusText?: string
  responseType?: string
  redirected?: boolean
  responseUrl?: string
  body?: string
  headers?: Record<string, string>
  before?: {
    url?: string
    title?: string
    readyState?: string
  }
  after?: {
    url?: string
    title?: string
    readyState?: string
  }
}

function isSubstackLoginDebugEnabled(): boolean {
  const raw = process.env.SUBSTACK_LOGIN_DEBUG?.trim().toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on'
}

function logSubstackLoginDebug(events: EventBus, message: string): void {
  if (!isSubstackLoginDebugEnabled()) return
  events.monologue(`[substack-debug] ${message}`)
}

function redactOtpLikeText(value: string | undefined, maxLength = 120): string {
  if (!value) return 'none'
  const compact = value.replace(/\s+/g, ' ').trim()
  if (!compact) return 'empty'
  const redacted = compact.replace(OTP_DEBUG_CODE_REGEX, (match) => maskOtpCode(match))
  return redacted.length <= maxLength ? redacted : `${redacted.slice(0, maxLength)}...`
}

function summarizeInboxMessageForDebug(message: Record<string, unknown>): string {
  return [
    `id=${String(message.id ?? '').slice(0, 8) || 'none'}`,
    `date=${redactOtpLikeText(typeof message.date === 'string' ? message.date : undefined, 48)}`,
    `from=${redactOtpLikeText(typeof message.from === 'string' ? message.from : undefined, 80)}`,
    `subject=${redactOtpLikeText(typeof message.subject === 'string' ? message.subject : undefined, 80)}`,
    `preview=${redactOtpLikeText(typeof message.snippet === 'string' ? message.snippet : typeof message.preview === 'string' ? message.preview : undefined, 100)}`,
  ].join(' | ')
}

function summarizeOtpEmailForDebug(input: {
  subject?: string
  preview?: string
  text?: string
  body?: string
  html?: string
}): string {
  const hintedCodes = [
    ...findOtpCodesInText(input.subject),
    ...findOtpCodesInText(input.preview),
    ...findOtpCodesInText(input.text),
    ...findOtpCodesInText(input.body),
    ...findOtpCodesInText(input.html),
  ]
  const uniqueCodes = [...new Set(hintedCodes)].map(code => maskOtpCode(code))

  return [
    `subjectLen=${input.subject?.length ?? 0}`,
    `previewLen=${input.preview?.length ?? 0}`,
    `textLen=${input.text?.length ?? 0}`,
    `bodyLen=${input.body?.length ?? 0}`,
    `htmlLen=${input.html?.length ?? 0}`,
    `codeHints=${uniqueCodes.length > 0 ? uniqueCodes.join(',') : 'none'}`,
    input.subject ? `subject=${JSON.stringify(redactOtpLikeText(input.subject, 100))}` : '',
    input.preview ? `preview=${JSON.stringify(redactOtpLikeText(input.preview, 100))}` : '',
  ].filter(Boolean).join(' | ')
}

function describeDirectFallbackIssue(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('Could not extract OTP code from email. Subject: "none"')) {
    return 'Direct Substack API login timed out without finding any EigenMail message whose subject matched "verification code".'
  }
  return null
}

async function completeOtpLoginInBrowser(
  browser: BrowserLike,
  email: string,
  code: string,
): Promise<LoginCompletionResult> {
  const raw = await browser.evaluate<string>(`
    (async () => {
      const snapshot = () => ({
        url: window.location.href,
        title: document.title,
        readyState: document.readyState,
      });

      try {
        const before = snapshot();
        const res = await fetch('/api/v1/email-otp-login/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          redirect: 'manual',
          body: JSON.stringify({
            code: ${JSON.stringify(code)},
            email: ${JSON.stringify(email)},
            redirect: 'https://substack.com/',
          }),
        });
        const headers = Object.fromEntries(
          Array.from(res.headers.entries()).filter(([key]) =>
            ['cache-control', 'content-type', 'location', 'server', 'cf-ray'].includes(key.toLowerCase())
          ),
        );
        const body = await res.text().catch(() => '');
        return JSON.stringify({
          ok: res.type === 'opaqueredirect' || res.status === 302 || res.status === 0 || res.ok || res.status === 200,
          status: res.status,
          statusText: res.statusText,
          responseType: res.type,
          redirected: res.redirected,
          responseUrl: res.url,
          headers,
          body: body.slice(0, 600),
          before,
          after: snapshot(),
        });
      } catch (e) {
        return JSON.stringify({
          ok: false,
          error: e instanceof Error ? e.message : String(e),
          before: snapshot(),
          after: snapshot(),
        });
      }
    })()
  `)

  try {
    return JSON.parse(raw) as LoginCompletionResult
  } catch (error) {
    return {
      ok: false,
      error: `Could not parse browser completion response: ${error instanceof Error ? error.message : String(error)}`,
      body: raw.slice(0, 600),
    }
  }
}

function summarizeLoginCompletionFailure(
  candidate: OtpCandidate,
  result: LoginCompletionResult,
): string {
  const parts = [`candidate=${maskOtpCode(candidate.code)} via ${candidate.source}`]

  if (typeof result.status === 'number') parts.push(`status=${result.status}`)
  if (result.statusText) parts.push(`statusText=${result.statusText}`)
  if (result.responseType) parts.push(`type=${result.responseType}`)
  if (result.before?.url) parts.push(`page=${result.before.url}`)
  if (result.responseUrl && result.responseUrl !== result.before?.url) parts.push(`response=${result.responseUrl}`)
  if (result.headers && Object.keys(result.headers).length > 0) {
    parts.push(`headers=${JSON.stringify(result.headers)}`)
  }
  if (result.body) parts.push(`body=${JSON.stringify(result.body)}`)
  if (result.error) parts.push(`error=${result.error}`)

  return parts.join(' | ')
}

async function loginViaDirectApi(
  privateKey: `0x${string}`,
  cookiesPath: string,
): Promise<{ cookies: CookieEntry[]; email: string }> {
  const { login } = await import('substack-skill')
  return login({
    eigenMailPrivateKey: privateKey,
    cookiesPath,
  })
}

interface BrowserFetchJsonResult<T = unknown> {
  ok: boolean
  status: number
  statusText: string
  url: string
  contentType?: string | null
  body: string
  json: T | null
  error?: string
}

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '')
}

export function resolveCdpJsonEndpoint(): string {
  const cdpPort = Number(process.env.CDP_PORT || 9222)
  const cdpUrl = process.env.CDP_URL?.trim() || `http://localhost:${cdpPort}`
  return `${trimTrailingSlashes(cdpUrl)}/json`
}

function normalizeComparableUrl(value?: string): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    url.hash = ''
    return trimTrailingSlashes(url.toString())
  } catch {
    return null
  }
}

function hostnameForUrl(value?: string): string | null {
  if (!value) return null
  try {
    return new URL(value).hostname.toLowerCase()
  } catch {
    return null
  }
}

function buildCookieLookupUrls(currentUrl?: string): string[] {
  const urls = [SUBSTACK_BASE]

  const normalizedCurrent = normalizeComparableUrl(currentUrl)
  if (normalizedCurrent) {
    urls.push(normalizedCurrent)
    try {
      urls.push(new URL(normalizedCurrent).origin)
    } catch {}
  }

  return [...new Set(urls)]
}

export function selectCdpTarget(
  targets: CdpBrowserTarget[],
  currentUrl?: string,
): CdpBrowserTarget | null {
  const withDebugger = targets.filter((target) => typeof target.webSocketDebuggerUrl === 'string' && target.webSocketDebuggerUrl.length > 0)
  const pages = withDebugger.filter((target) => target.type === 'page')

  const normalizedCurrent = normalizeComparableUrl(currentUrl)
  if (normalizedCurrent) {
    const exact = pages.find((target) => normalizeComparableUrl(target.url) === normalizedCurrent)
    if (exact) return exact
  }

  const currentHost = hostnameForUrl(currentUrl)
  if (currentHost) {
    const sameHost = pages.find((target) => hostnameForUrl(target.url) === currentHost)
    if (sameHost) return sameHost
  }

  const substackPage = pages.find((target) => {
    const host = hostnameForUrl(target.url)
    return !!host && (host === 'substack.com' || host.endsWith('.substack.com'))
  })
  if (substackPage) return substackPage

  return pages[0] ?? withDebugger[0] ?? null
}

function parseSubstackCookies(cookieJson: string): CookieEntry[] {
  try {
    const rawCookies = JSON.parse(cookieJson) as any[]
    return rawCookies
      .filter((cookie: any) => typeof cookie?.domain === 'string' && cookie.domain.includes('substack'))
      .map((cookie: any) => ({
        name: String(cookie.name ?? ''),
        value: String(cookie.value ?? ''),
        domain: cookie.domain ?? '.substack.com',
        path: cookie.path ?? '/',
        secure: cookie.secure ?? false,
      }))
      .filter((cookie) => cookie.name.length > 0)
  } catch {
    return []
  }
}

async function readDocumentCookies(browser: BrowserLike): Promise<CookieEntry[]> {
  const cookieJson = await browser.evaluate<string>(`
    (() => {
      const pairs = document.cookie.split(';').map(s => s.trim()).filter(Boolean);
      return JSON.stringify(pairs.map(p => {
        const [name, ...rest] = p.split('=');
        return { name: name.trim(), value: rest.join('='), domain: '.substack.com', path: '/', secure: true };
      }));
    })()
  `)

  return parseSubstackCookies(cookieJson)
}

async function readCdpCookies(browser: BrowserLike): Promise<CookieEntry[] | null> {
  const currentUrl = await browser.currentUrl().catch(() => '')
  const cdpRes = await fetch(resolveCdpJsonEndpoint())
  if (!cdpRes.ok) {
    throw new Error(`CDP target discovery failed: ${cdpRes.status} ${cdpRes.statusText}`)
  }

  const targets = await cdpRes.json() as CdpBrowserTarget[]
  const target = selectCdpTarget(targets, currentUrl)
  if (!target?.webSocketDebuggerUrl) {
    return null
  }

  const cookieJson = await new Promise<string>((resolve) => {
    const ws = new WebSocket(target.webSocketDebuggerUrl!)

    ws.onopen = () => {
      ws.send(JSON.stringify({
        id: 1,
        method: 'Network.getCookies',
        params: { urls: buildCookieLookupUrls(currentUrl) },
      }))
    }

    ws.onmessage = (event: any) => {
      const data = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString())
      if (data.id === 1) {
        ws.close()
        resolve(JSON.stringify(data.result?.cookies ?? []))
      }
    }

    ws.onerror = () => {
      ws.close()
      resolve('[]')
    }

    setTimeout(() => {
      ws.close()
      resolve('[]')
    }, 5000)
  })

  const cookies = parseSubstackCookies(cookieJson)
  return cookies.length > 0 ? cookies : null
}

async function extractBrowserSessionCookies(
  browser: BrowserLike,
  events: EventBus,
): Promise<CookieEntry[]> {
  events.monologue('Extracting session cookies...')

  try {
    const cdpCookies = await readCdpCookies(browser)
    if (cdpCookies && cdpCookies.length > 0) {
      return cdpCookies
    }
    events.monologue('CDP cookie extraction returned no Substack cookies. Falling back to document.cookie.')
  } catch (error) {
    events.monologue(`CDP cookie extraction failed: ${error instanceof Error ? error.message : String(error)}. Falling back to document.cookie.`)
  }

  return readDocumentCookies(browser)
}

export async function authenticateVerifiedSession(
  client: Pick<SubstackClient, 'authenticate' | 'amILoggedIn'>,
  cookies: CookieEntry[],
): Promise<void> {
  await client.authenticate({ cookies })
  const status = await client.amILoggedIn()
  if (!status) {
    throw new Error('Authenticated cookies did not yield a logged-in Substack session.')
  }
}

async function getFreshSelf(client: SubstackClient): Promise<any> {
  return client.refreshSelf()
}

function pickSubstackDisplayName(identity: AgentIdentity, currentName?: unknown): string {
  const candidate = [currentName, identity.name, identity.creator]
    .find(value => typeof value === 'string' && value.trim().length > 0)

  const cleaned = String(candidate ?? 'Agent').replace(/\s+/g, ' ').trim().slice(0, 80)
  return cleaned || 'Agent'
}

function summarizeBrowserFetchFailure(
  label: string,
  result: BrowserFetchJsonResult<unknown>,
): string {
  const parts = [label, `status=${result.status}`, `statusText=${result.statusText}`]

  if (result.url) parts.push(`url=${result.url}`)
  if (result.contentType) parts.push(`contentType=${result.contentType}`)
  if (result.body) parts.push(`body=${JSON.stringify(result.body)}`)
  if (result.error) parts.push(`error=${result.error}`)

  return parts.join(' | ')
}

async function browserJsonRequest<T = unknown>(
  browser: BrowserLike,
  input: string,
  init: {
    method?: string
    headers?: Record<string, string>
    body?: unknown
  } = {},
): Promise<BrowserFetchJsonResult<T>> {
  const requestConfig = {
    method: init.method ?? 'GET',
    headers: init.headers ?? {},
    body: init.body === undefined ? null : JSON.stringify(init.body),
  }

  const raw = await browser.evaluate<string>(`
    (async () => {
      const input = ${JSON.stringify(input)};
      const config = ${JSON.stringify(requestConfig)};

      try {
        const fetchInit = {
          method: config.method,
          headers: config.headers,
          credentials: 'include',
        };

        if (config.body !== null) {
          fetchInit.body = config.body;
        }

        const res = await fetch(input, fetchInit);
        const text = await res.text().catch(() => '');
        let json = null;

        try {
          json = text ? JSON.parse(text) : null;
        } catch {}

        return JSON.stringify({
          ok: res.ok,
          status: res.status,
          statusText: res.statusText,
          url: res.url,
          contentType: res.headers.get('content-type'),
          body: text.slice(0, 1200),
          json,
        });
      } catch (error) {
        return JSON.stringify({
          ok: false,
          status: 0,
          statusText: 'BROWSER_FETCH_FAILED',
          url: input,
          contentType: null,
          body: '',
          json: null,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })()
  `)

  try {
    return JSON.parse(raw) as BrowserFetchJsonResult<T>
  } catch (error) {
    return {
      ok: false,
      status: 0,
      statusText: 'BROWSER_FETCH_PARSE_FAILED',
      url: input,
      body: raw.slice(0, 1200),
      json: null,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function initializePublicationViaBrowser(
  client: SubstackClient,
  browser: BrowserLike,
  identity: AgentIdentity,
  events: EventBus,
): Promise<any> {
  const currentSelf = await getFreshSelf(client)
  const displayName = pickSubstackDisplayName(identity, currentSelf?.name)

  events.monologue('No publication found — initializing creator dashboard via browser...')

  await browser.navigate(`${SUBSTACK_BASE}/profile/start?utm_source=menu`)
  await browser.waitMs(1500)

  const profileResult = await browserJsonRequest<any>(browser, `${SUBSTACK_BASE}/api/v1/user/profile`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: {
      name: displayName,
      accept_tos: true,
    },
  })

  if (!profileResult.ok) {
    throw new Error(summarizeBrowserFetchFailure('profile-setup', profileResult))
  }

  const handle = String(
    profileResult.json?.handle ??
    profileResult.json?.profile?.handle ??
    currentSelf?.handle ??
    '',
  ).trim()

  if (!handle) {
    throw new Error(`Substack did not return a handle after profile setup: ${JSON.stringify(profileResult.body)}`)
  }

  events.monologue(`Substack handle ready: ${handle}`)

  await browser.navigate(`${SUBSTACK_BASE}/@${handle}`)
  await browser.waitMs(1500)

  const initializeResult = await browserJsonRequest(
    browser,
    `${SUBSTACK_BASE}/api/v1/@${handle}/personal-initialize?action=access_dashboard`,
    { method: 'POST' },
  )

  if (!initializeResult.ok) {
    throw new Error(summarizeBrowserFetchFailure('personal-initialize', initializeResult))
  }

  const publishHomeUrl = `https://${handle}.substack.com/publish/home`
  events.monologue(`Creator dashboard initialized — opening ${publishHomeUrl}`)
  await browser.navigate(publishHomeUrl)
  await browser.waitMs(2500)

  for (let attempt = 0; attempt < 8; attempt++) {
    const refreshedSelf = await getFreshSelf(client)
    if (refreshedSelf?.primaryPublication) {
      return refreshedSelf
    }
    await browser.waitMs(1000)
  }

  throw new Error(`personal-initialize succeeded for @${handle}, but no primaryPublication appeared in the authenticated profile`)
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

  // Snapshot existing inbox state before requesting a new OTP so we do not
  // accidentally classify the fresh verification email as stale.
  const preExistingIds = new Set<string>()
  try {
    const before: any = await mail.inbox({ limit: 10 })
    for (const m of (before?.messages ?? [])) {
      if (m.id) preExistingIds.add(m.id)
    }
  } catch {}

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
        const headers = Object.fromEntries(
          Array.from(res.headers.entries()).filter(([key]) =>
            ['cache-control', 'content-type', 'cf-ray', 'server'].includes(key.toLowerCase())
          ),
        );
        const body = await res.text().catch(() => '');
        if (!res.ok) {
          return JSON.stringify({
            error: 'HTTP ' + res.status,
            status: res.status,
            statusText: res.statusText,
            url: res.url,
            headers,
            body: body.slice(0, 300),
          });
        }
        return JSON.stringify({
          ok: true,
          status: res.status,
          statusText: res.statusText,
          url: res.url,
          headers,
          body: body.slice(0, 300),
        });
      } catch (e) {
        return JSON.stringify({ error: e.message });
      }
    })()
  `)

  const otpParsed = JSON.parse(otpResult)
  logSubstackLoginDebug(
    events,
    [
      'Browser OTP request result',
      `ok=${otpParsed.ok ? 'true' : 'false'}`,
      `status=${otpParsed.status ?? 'unknown'}`,
      otpParsed.statusText ? `statusText=${otpParsed.statusText}` : '',
      otpParsed.url ? `url=${otpParsed.url}` : '',
      otpParsed.headers ? `headers=${JSON.stringify(otpParsed.headers)}` : '',
      otpParsed.body ? `body=${JSON.stringify(redactOtpLikeText(String(otpParsed.body), 180))}` : '',
      otpParsed.error ? `error=${otpParsed.error}` : '',
    ].filter(Boolean).join(' | '),
  )
  if (otpParsed.error) {
    throw new Error(`email-login failed: ${otpParsed.error}`)
  }

  // Step 2: Wait for OTP email by polling inbox (runs in Node, not browser)
  events.monologue(`Waiting for OTP email... (${preExistingIds.size} pre-existing messages to skip)`)

  let otpCandidates: OtpCandidate[] = []
  let lastInboxSummary = 'no inbox poll completed'
  const inspectedMessageIds = new Set<string>()
  for (let attempt = 0; attempt < 40; attempt++) {
    await new Promise(r => setTimeout(r, 3000))

    try {
      const inbox: any = await mail.inbox({ limit: 10 })
      const messages = inbox?.messages ?? []
      const newMessages = messages.filter((message: any) => !preExistingIds.has(message.id))
      const pendingMessages = newMessages.filter((message: any) => !inspectedMessageIds.has(String(message.id ?? '')))
      lastInboxSummary = `attempt=${attempt + 1}/40 | inbox=${messages.length} | new=${newMessages.length} | pending=${pendingMessages.length} | inspected=${inspectedMessageIds.size}`
      logSubstackLoginDebug(events, `OTP inbox poll | ${lastInboxSummary}`)

      for (const msg of pendingMessages) {
        const messageId = String(msg.id ?? '')
        if (messageId) inspectedMessageIds.add(messageId)
        try {
          const full: any = await mail.read(msg.id)
          const otpEmail = {
            messageId: String(full?.id ?? msg.id ?? ''),
            from: String(full?.from ?? msg.from ?? ''),
            subject: String(full?.subject ?? msg.subject ?? ''),
            preview: String(full?.snippet ?? full?.preview ?? msg.snippet ?? msg.preview ?? ''),
            text: String(full?.text ?? full?.body ?? ''),
            body: String(full?.body ?? full?.text ?? ''),
            html: String(full?.html ?? ''),
          }
          logSubstackLoginDebug(
            events,
            `Inspecting inbox message | ${summarizeInboxMessageForDebug(full ?? msg)} | ${summarizeOtpEmailForDebug(otpEmail)} | regexCandidates=${collectRegexOtpCandidates(otpEmail).length}`,
          )
          otpCandidates = await extractSubstackOtpCandidates(otpEmail, events)
          if (otpCandidates.length > 0) {
            break
          }
          logSubstackLoginDebug(events, `No OTP candidates extracted from message | ${summarizeInboxMessageForDebug(full ?? msg)}`)
        } catch (error) {
          events.monologue(`Failed to inspect OTP email ${String(msg.id ?? '').slice(0, 8)}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }

      if (otpCandidates.length > 0) break
    } catch (err) {
      events.monologue(`Inbox poll error: ${(err as Error).message}`)
    }
  }

  if (otpCandidates.length === 0) {
    logSubstackLoginDebug(events, `OTP polling exhausted without a usable code | ${lastInboxSummary}`)
    throw new Error('Could not find Substack OTP code in inbox after 2 minutes.')
  }

  events.monologue(`Got ${otpCandidates.length} OTP candidate(s), completing login via browser...`)

  // Step 3: Complete login with OTP — runs inside browser
  const completionFailures: string[] = []
  let loginCompleted = false

  for (let index = 0; index < otpCandidates.length; index++) {
    const candidate = otpCandidates[index]
    events.monologue(`Submitting OTP candidate ${index + 1}/${otpCandidates.length} (${maskOtpCode(candidate.code)} from ${candidate.source})...`)
    const completeParsed = await completeOtpLoginInBrowser(browser, email, candidate.code)

    if (completeParsed.ok) {
      events.monologue(`OTP candidate ${index + 1}/${otpCandidates.length} accepted by Substack.`)
      loginCompleted = true
      break
    }

    const failureSummary = summarizeLoginCompletionFailure(candidate, completeParsed)
    completionFailures.push(failureSummary)
    events.monologue(`Login completion attempt ${index + 1} failed: ${failureSummary}`)
    await browser.waitMs(1000)
  }

  if (!loginCompleted) {
    throw new Error(`email-otp-login/complete failed after ${otpCandidates.length} attempt(s): ${completionFailures.join(' || ')}`)
  }

  // Wait for cookies to settle
  await browser.waitMs(2000)

  const cookies = await extractBrowserSessionCookies(browser, events)

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
      await authenticateVerifiedSession(client, cookies)
      events.monologue('Substack session restored from cookies')
      return client
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
    try {
      const { cookies, email } = await loginViaBrowser(privateKey, browser, cookiesPath, events)
      events.monologue(`Logged into Substack as ${email}`)
      await authenticateVerifiedSession(client, cookies)
      return client
    } catch (error) {
      events.monologue(`Browser-based Substack login failed: ${error instanceof Error ? error.message : String(error)}`)
      events.monologue('Falling back to direct Substack API login...')
      try {
        const { cookies, email } = await loginViaDirectApi(privateKey, cookiesPath)
        events.monologue(`Logged into Substack as ${email}`)
        await authenticateVerifiedSession(client, cookies)
        return client
      } catch (fallbackError) {
        const fallbackHint = describeDirectFallbackIssue(fallbackError)
        if (fallbackHint) {
          events.monologue(fallbackHint)
        }
        throw new Error(
          `Substack login failed. Browser flow: ${error instanceof Error ? error.message : String(error)}. Direct fallback: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`,
        )
      }
    }
  }

  // Fallback: direct API login (works from residential IPs, may fail from datacenter)
  events.monologue('Logging into Substack via API (direct, no browser)...')
  const { cookies, email } = await loginViaDirectApi(privateKey, cookiesPath)
  events.monologue(`Logged into Substack as ${email}`)
  await authenticateVerifiedSession(client, cookies)
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
      try {
        const { cookies, email } = await loginViaBrowser(privateKey, browser, cookiesPath, events)
        await authenticateVerifiedSession(client, cookies)
        events.monologue(`Re-authenticated as ${email}`)
      } catch (error) {
        events.monologue(`Browser re-authentication failed: ${error instanceof Error ? error.message : String(error)}`)
        events.monologue('Falling back to direct Substack API re-authentication...')
        try {
          const { cookies, email } = await loginViaDirectApi(privateKey, cookiesPath)
          await authenticateVerifiedSession(client, cookies)
          events.monologue(`Re-authenticated as ${email}`)
        } catch (fallbackError) {
          const fallbackHint = describeDirectFallbackIssue(fallbackError)
          if (fallbackHint) {
            events.monologue(fallbackHint)
          }
          throw fallbackError
        }
      }
    } else {
      const { cookies, email } = await loginViaDirectApi(privateKey, cookiesPath)
      await authenticateVerifiedSession(client, cookies)
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
  config: Config,
  events: EventBus,
  browser?: BrowserLike,
): Promise<void> {
  events.monologue('Checking publication setup...')

  let self = await getFreshSelf(client)

  // If no publication exists, create one
  if (!self.primaryPublication) {
    const publicationName = pickSubstackDisplayName(identity, self?.name)
    let ensurePublicationError: Error | null = null
    let browserInitError: Error | null = null

    try {
      const publication = await client.ensurePublication({ name: publicationName })
      self = await getFreshSelf(client)
      events.monologue(`Publication created: ${formatPublicationAddress(publication.subdomain)}`)
    } catch (error) {
      ensurePublicationError = error instanceof Error ? error : new Error(String(error))
      events.monologue(`SDK publication bootstrap failed: ${ensurePublicationError.message.slice(0, 180)}`)
    }

    if (!self.primaryPublication && browser) {
      try {
        self = await initializePublicationViaBrowser(client, browser, identity, events)
        events.monologue(`Publication created: ${formatPublicationAddress(self.primaryPublication?.subdomain)}`)
      } catch (error) {
        browserInitError = error instanceof Error ? error : new Error(String(error))
        events.monologue(`Browser-backed publication initialization failed: ${browserInitError.message.slice(0, 180)}`)
      }
    }

    if (!self.primaryPublication) {
      if (ensurePublicationError && browserInitError) {
        events.monologue(`Publication bootstrap failures: sdk=${ensurePublicationError.message.slice(0, 120)} | browser=${browserInitError.message.slice(0, 120)}`)
      }
      // Non-fatal — agent can still run without a publication, just can't publish
      events.monologue('Continuing without publication — publishing will fail until manually set up.')
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
      execute: makeUpdatePublicationExecute(client),
    }),

    update_profile: tool({
      description: 'Update the authenticated user profile (display name, handle, bio).',
      inputSchema: z.object({
        name: z.string().optional().describe('Display name'),
        handle: z.string().optional().describe('Username handle'),
        bio: z.string().optional().describe('Short profile bio'),
      }),
      execute: makeUpdateProfileExecute(client),
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
    modelId: config.modelId('editing'),
    model: config.model('editing'),
    system: `${persona}

<publication_setup_task>
  <goal>Align the Substack publication with the agent's identity.</goal>
  <rules>
    <rule>Only update fields that are missing or don't match the agent's identity.</rule>
    <rule>If the publication is already well-configured, just call setup_complete.</rule>
    <rule>Publication name should reflect the agent's identity.</rule>
    <rule>If the handle or subdomain are clearly generic or mismatched, align them to a short URL-safe version of the agent identity.</rule>
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

  events.monologue(
    self.primaryPublication?.subdomain
      ? `Publication setup complete: ${formatPublicationAddress(self.primaryPublication.subdomain)}`
      : 'Publication setup complete'
  )
}

function formatPublicationAddress(subdomain: string | undefined | null): string {
  const handle = subdomain?.trim()
  if (!handle) return "substack.com"
  return `https://${handle}.substack.com`
}
