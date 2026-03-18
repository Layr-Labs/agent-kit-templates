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
  describeOtpCandidates,
  extractSubstackOtpCandidates,
  maskOtpCode,
  type OtpCandidate,
  type OtpAttemptFeedback,
  type OtpEmailInput,
  type OtpExtractionResult,
} from './otp.js'

const SUBSTACK_BASE = 'https://substack.com'
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36'
const OTP_DEBUG_CODE_REGEX = /\b\d{6}\b/g
const MAX_BROWSER_OTP_ATTEMPTS = 6
const MAX_BROWSER_OTP_REFINEMENTS = 2
const MAX_SUBSTACK_DISPLAY_NAME_LENGTH = 30

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
  const findCodes = (text: string | undefined): string[] => text?.match(/\b\d{6}\b/g) ?? []
  const hintedCodes = [
    ...findCodes(input.subject),
    ...findCodes(input.preview),
    ...findCodes(input.text),
    ...findCodes(input.body),
    ...findCodes(input.html),
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

export async function reuseBrowserAuthenticatedSession(
  client: Pick<SubstackClient, 'authenticate' | 'amILoggedIn'>,
  browser: BrowserLike,
  cookiesPath: string,
  events: EventBus,
): Promise<CookieEntry[] | null> {
  events.monologue('Checking whether Substack already has an authenticated browser session...')

  const profileResult = await browserJsonRequest<any>(browser, `${SUBSTACK_BASE}/api/v1/user/profile`)
  if (!profileResult.ok) {
    logSubstackLoginDebug(
      events,
      `Browser auth probe found no active Substack session | ${summarizeBrowserFetchFailure('user-profile', profileResult)}`,
    )
    return null
  }

  const cookies = await extractBrowserSessionCookies(browser, events)
  if (cookies.length === 0) {
    throw new Error('Browser session looks authenticated, but no Substack cookies could be extracted.')
  }

  await authenticateVerifiedSession(client, cookies)
  await saveCookies(cookiesPath, cookies)

  const handle = String(
    profileResult.json?.handle ??
    profileResult.json?.profile?.handle ??
    '',
  ).trim()
  events.monologue(
    `Browser already authenticated with Substack${handle ? ` (@${handle})` : ''}; skipping OTP login.`,
  )

  return cookies
}

async function getFreshSelf(client: SubstackClient): Promise<any> {
  return client.refreshSelf()
}

function pickSubstackDisplayName(
  identity: AgentIdentity,
  currentName?: unknown,
): string {
  const candidate = [currentName, identity.name, identity.creator]
    .find(value => typeof value === 'string' && value.trim().length > 0)

  const cleaned = String(candidate ?? 'Agent').replace(/\s+/g, ' ').trim()
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
  preferredName?: string,
): Promise<any> {
  const currentSelf = await getFreshSelf(client)
  const displayName = pickSubstackDisplayName(identity, preferredName ?? currentSelf?.name)

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

interface PublicationBootstrapAttempt {
  self: any
  attemptedName: string
  ensurePublicationError: Error | null
  browserInitError: Error | null
}

function summarizePublicationBootstrapErrors(
  ensurePublicationError: Error | null,
  browserInitError: Error | null,
): string[] {
  const failures: string[] = []
  if (ensurePublicationError) failures.push(`sdk=${ensurePublicationError.message}`)
  if (browserInitError) failures.push(`browser=${browserInitError.message}`)
  return failures
}

async function attemptPublicationBootstrap(params: {
  client: SubstackClient
  identity: AgentIdentity
  events: EventBus
  browser?: BrowserLike
  preferredName?: string
}): Promise<PublicationBootstrapAttempt> {
  let self = await getFreshSelf(params.client)
  const attemptedName = pickSubstackDisplayName(params.identity, params.preferredName ?? self?.name)
  let ensurePublicationError: Error | null = null
  let browserInitError: Error | null = null

  try {
    const publication = await params.client.ensurePublication({ name: attemptedName })
    self = await getFreshSelf(params.client)
    params.events.monologue(`Publication created: ${formatPublicationAddress(publication.subdomain)}`)
  } catch (error) {
    ensurePublicationError = error instanceof Error ? error : new Error(String(error))
    params.events.monologue(`SDK publication bootstrap failed: ${ensurePublicationError.message.slice(0, 180)}`)
  }

  if (!self.primaryPublication && params.browser) {
    try {
      self = await initializePublicationViaBrowser(
        params.client,
        params.browser,
        params.identity,
        params.events,
        attemptedName,
      )
      params.events.monologue(`Publication created: ${formatPublicationAddress(self.primaryPublication?.subdomain)}`)
    } catch (error) {
      browserInitError = error instanceof Error ? error : new Error(String(error))
      params.events.monologue(`Browser-backed publication initialization failed: ${browserInitError.message.slice(0, 180)}`)
    }
  }

  return {
    self,
    attemptedName,
    ensurePublicationError,
    browserInitError,
  }
}

function validatePublicationBootstrapName(name: string): string | null {
  const normalized = name.replace(/\s+/g, ' ').trim()
  if (!normalized) {
    return 'Choose a non-empty publication name before creating the Substack publication.'
  }
  if (normalized.length > MAX_SUBSTACK_DISPLAY_NAME_LENGTH) {
    return `Please enter a shorter name (${MAX_SUBSTACK_DISPLAY_NAME_LENGTH} characters max). Keep the title concise and put extra identity detail into the bio or publication description.`
  }
  return null
}

interface SetupPublicationDependencies {
  generateText?: typeof generateTrackedText
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

  const existingBrowserSessionCookies = await reuseBrowserAuthenticatedSession(
    new SubstackClient(),
    browser,
    cookiesPath,
    events,
  )
  if (existingBrowserSessionCookies) {
    return { cookies: existingBrowserSessionCookies, email }
  }

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
  let otpEmailForCandidates: OtpEmailInput | null = null
  let lastInboxSummary = 'no inbox poll completed'
  let browserSessionRechecked = false
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
            `Inspecting inbox message | ${summarizeInboxMessageForDebug(full ?? msg)} | ${summarizeOtpEmailForDebug(otpEmail)}`,
          )
          const extractionResult = await extractSubstackOtpCandidates(otpEmail, events)

          if (extractionResult.noOtpRequired && !browserSessionRechecked) {
            browserSessionRechecked = true
            events.monologue(`OTP extractor says no OTP required: ${extractionResult.noOtpReason ?? 'unknown reason'}. Re-checking browser session...`)

            // If the email contains a magic login link, navigate to it first
            const loginLinks = extractionResult.loginLinks ?? []
            if (loginLinks.length > 0) {
              const link = loginLinks[0]
              events.monologue(`Found login link: "${link.label}" — navigating to complete sign-in...`)
              await browser.navigate(link.url)
              await browser.waitMs(3000)
            }

            const recheckCookies = await reuseBrowserAuthenticatedSession(
              new SubstackClient(),
              browser,
              cookiesPath,
              events,
            )
            if (recheckCookies) {
              return { cookies: recheckCookies, email }
            }
            events.monologue('Browser session re-check did not find an active session. Continuing OTP polling...')
          }

          if (extractionResult.candidates.length > 0) {
            otpCandidates = extractionResult.candidates
            otpEmailForCandidates = otpEmail
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
  const attemptedFeedback: OtpAttemptFeedback[] = []
  const queuedCandidates = [...otpCandidates]
  const queuedCodes = new Set(queuedCandidates.map(candidate => candidate.code))
  let loginCompleted = false
  let refinementCount = 0
  let attemptsMade = 0

  for (let index = 0; index < queuedCandidates.length && attemptsMade < MAX_BROWSER_OTP_ATTEMPTS; index++) {
    const candidate = queuedCandidates[index]
    attemptsMade += 1
    events.monologue(`Submitting OTP candidate ${attemptsMade}/${Math.min(queuedCandidates.length, MAX_BROWSER_OTP_ATTEMPTS)} (${maskOtpCode(candidate.code)} from ${candidate.source})...`)
    const completeParsed = await completeOtpLoginInBrowser(browser, email, candidate.code)

    if (completeParsed.ok) {
      events.monologue(`OTP candidate ${attemptsMade} accepted by Substack.`)
      loginCompleted = true
      break
    }

    const failureSummary = summarizeLoginCompletionFailure(candidate, completeParsed)
    completionFailures.push(failureSummary)
    attemptedFeedback.push({
      code: candidate.code,
      source: candidate.source,
      failure: failureSummary,
    })
    events.monologue(`Login completion attempt ${attemptsMade} failed: ${failureSummary}`)

    if (otpEmailForCandidates && refinementCount < MAX_BROWSER_OTP_REFINEMENTS) {
      refinementCount += 1
      events.monologue(`Substack rejected ${maskOtpCode(candidate.code)}. Re-evaluating the OTP email with failure context...`)
      const refinedResult = await extractSubstackOtpCandidates(
        otpEmailForCandidates,
        events,
        { attemptFeedback: attemptedFeedback },
      )
      const newCandidates = refinedResult.candidates.filter(refined => !queuedCodes.has(refined.code))
      if (newCandidates.length > 0) {
        newCandidates.forEach(refined => queuedCodes.add(refined.code))
        queuedCandidates.push(...newCandidates)
        events.monologue(`OTP retry analysis proposed ${newCandidates.length} additional candidate(s): ${describeOtpCandidates(newCandidates)}`)
      } else {
        events.monologue('OTP retry analysis found no new OTP candidates after the rejection.')
      }
    }

    await browser.waitMs(1000)
  }

  if (!loginCompleted) {
    throw new Error(`email-otp-login/complete failed after ${attemptsMade} attempt(s): ${completionFailures.join(' || ')}`)
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

async function createEigenMailBrowserFallbackContext(privateKey: `0x${string}`): Promise<{
  email: string
  tools: Record<string, any>
}> {
  const { EigenMailClient } = await import('eigenmail-sdk')
  const mail = new EigenMailClient({ privateKey })
  const loginResult = await mail.login()
  const email = loginResult.email ?? (await mail.me()).email

  const summarizeEmail = (message: {
    subject?: string
    from?: string
    date?: string
    body?: string
    html?: string
  }) => {
    const body = String(message.body ?? message.html ?? '')
    const allUrls = body.match(/https?:\/\/[^\s"<>\]]+/g) ?? []
    const urls = allUrls.filter(url => !url.includes('/open?') && !url.includes('/o/'))
    return {
      subject: message.subject ?? '',
      from: message.from ?? '',
      date: message.date ?? '',
      urls,
      body: body.slice(0, 8_000),
    }
  }

  return {
    email,
    tools: {
      wait_for_email: tool({
        description:
          'Wait for a NEW email to arrive matching sender/subject filters. ' +
          'Use this immediately after triggering a Substack verification email. ' +
          'Returns the email body and extracted URLs for OTP or magic-link handling.',
        inputSchema: z.object({
          from: z.string().optional().describe('Filter by sender substring, e.g. "substack.com"'),
          subject: z.string().optional().describe('Filter by subject substring'),
          timeout_seconds: z.number().optional().describe('Maximum wait in seconds, default 120'),
        }),
        execute: async (params: { from?: string; subject?: string; timeout_seconds?: number }) => {
          try {
            const timeout = Math.max((params.timeout_seconds ?? 120) * 1000, 30_000)
            const message = await mail.waitForEmail({
              from: params.from,
              subject: params.subject,
              timeout,
              interval: 5_000,
            })
            if (!message) {
              return JSON.stringify({
                ok: false,
                error: 'Timed out waiting for a matching email.',
              })
            }
            return JSON.stringify({
              ok: true,
              email: summarizeEmail(message),
            })
          } catch (error) {
            return JSON.stringify({
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            })
          }
        },
      }),
      read_inbox: tool({
        description: 'List recent EigenMail inbox messages so the browser agent can inspect Substack emails.',
        inputSchema: z.object({
          limit: z.number().optional().describe('Number of messages to return, default 10'),
          query: z.string().optional().describe('Optional inbox search query'),
        }),
        execute: async (params: { limit?: number; query?: string }) => {
          try {
            const inbox = await mail.inbox({ limit: params.limit ?? 10, q: params.query })
            return JSON.stringify({
              ok: true,
              messages: (inbox.messages ?? []).map((message: any) => ({
                id: message.id,
                subject: message.subject,
                from: message.from,
                date: message.date,
              })),
            })
          } catch (error) {
            return JSON.stringify({
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            })
          }
        },
      }),
      read_email: tool({
        description: 'Read a specific EigenMail message by ID. Returns body text and extracted URLs.',
        inputSchema: z.object({
          id: z.string().describe('Message ID from read_inbox'),
        }),
        execute: async (params: { id: string }) => {
          try {
            const message = await mail.read(params.id)
            return JSON.stringify({
              ok: true,
              email: summarizeEmail(message),
            })
          } catch (error) {
            return JSON.stringify({
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            })
          }
        },
      }),
    },
  }
}

export async function retryBrowserLoginWithFreshSession(
  privateKey: `0x${string}`,
  cookiesPath: string,
  events: EventBus,
  deps?: {
    createFreshBrowser?: () => Promise<BrowserLike | null>
    disconnectBrowser?: (browser?: BrowserLike | null) => Promise<void>
    loginFn?: (
      privateKey: `0x${string}`,
      browser: BrowserLike,
      cookiesPath: string,
      events: EventBus,
    ) => Promise<{ cookies: CookieEntry[]; email: string }>
  },
): Promise<{ cookies: CookieEntry[]; email: string }> {
  events.monologue('Retrying Substack login with a fresh browser session...')

  const createFreshBrowser = deps?.createFreshBrowser ?? (async () => {
    const { createBrowser } = await import('../../browser/index.js')
    return createBrowser({ fresh: true })
  })
  const disconnectFreshBrowser = deps?.disconnectBrowser ?? (async (browser?: BrowserLike | null) => {
    const { disconnectBrowser } = await import('../../browser/index.js')
    await disconnectBrowser(browser)
  })
  const loginFn = deps?.loginFn ?? loginViaBrowser

  const retryBrowser = await createFreshBrowser()
  if (!retryBrowser) {
    throw new Error('Could not create a fresh browser session for Substack retry')
  }

  try {
    events.monologue('Fresh browser session established. Re-running Substack email login...')
    return await loginFn(privateKey, retryBrowser, cookiesPath, events)
  } finally {
    await disconnectFreshBrowser(retryBrowser)
  }
}

export async function loginViaBrowserAutopilotFallback(
  privateKey: `0x${string}`,
  cookiesPath: string,
  events: EventBus,
  browser?: BrowserLike,
  deps?: {
    resolveEmail?: (privateKey: `0x${string}`) => Promise<string>
    runBrowserLoginFn?: (opts: {
      platform: string
      loginUrl: string
      successUrlContains: string
      credentials: {
        username: string
        password: string
        email?: string
        totpKey?: string
      }
      browser?: BrowserLike
      task?: string
      maxSteps?: number
      extraTools?: Record<string, any>
    }) => Promise<{
      success: boolean
      result: string | null
      browser: BrowserLike | null
      loginMethod: 'cached' | 'cdp' | 'x11' | 'failed'
    }>
    disconnectBrowserFn?: (browser?: BrowserLike | null) => Promise<void>
    reuseSessionFn?: (
      client: Pick<SubstackClient, 'authenticate' | 'amILoggedIn'>,
      browser: BrowserLike,
      cookiesPath: string,
      events: EventBus,
    ) => Promise<CookieEntry[] | null>
    createEigenMailContext?: (privateKey: `0x${string}`) => Promise<{ email: string; tools: Record<string, any> }>
  },
): Promise<{ cookies: CookieEntry[]; email: string }> {
  const createEigenMailContext = deps?.createEigenMailContext ?? createEigenMailBrowserFallbackContext
  const runBrowserLoginFn = deps?.runBrowserLoginFn ?? (async (opts) => {
    const { runBrowserLogin } = await import('../../browser/index.js')
    return runBrowserLogin(opts)
  })
  const disconnectBrowserFn = deps?.disconnectBrowserFn ?? (async (activeBrowser?: BrowserLike | null) => {
    const { disconnectBrowser } = await import('../../browser/index.js')
    await disconnectBrowser(activeBrowser)
  })
  const reuseSessionFn = deps?.reuseSessionFn ?? reuseBrowserAuthenticatedSession

  const { email, tools } = await createEigenMailContext(privateKey)
  events.monologue(`Launching browser-autopilot Substack fallback for ${email}...`)

  const autopilot = await runBrowserLoginFn({
    platform: 'Substack',
    loginUrl: 'https://substack.com/sign-in?next=%2F',
    successUrlContains: 'substack.com',
    credentials: {
      username: email,
      password: '',
      email,
      totpKey: '',
    },
    browser,
    task: [
      'Use the browser to sign into Substack with the provided email address.',
      'If the account does not exist, create it using the email flow.',
      'If prompted for email, enter the provided email address.',
      'If prompted to check email, use wait_for_email first, then use read_inbox/read_email as needed.',
      'If an email contains a magic or verification link, open it in the browser.',
      'If an email contains a verification code, enter it into the browser form.',
      'Finish on an authenticated Substack page where the user is signed in.',
    ].join(' '),
    maxSteps: 60,
    extraTools: tools,
  })

  if (!autopilot.success || !autopilot.browser) {
    throw new Error(
      `browser-autopilot could not authenticate Substack${autopilot.result ? `: ${autopilot.result}` : ''}`,
    )
  }

  events.monologue(`browser-autopilot completed using ${autopilot.loginMethod} mode. Verifying authenticated Substack session...`)

  try {
    const cookies = await reuseSessionFn(
      new SubstackClient(),
      autopilot.browser,
      cookiesPath,
      events,
    )

    if (!cookies) {
      throw new Error('browser-autopilot completed but no authenticated Substack session was detected')
    }

    return { cookies, email }
  } finally {
    await disconnectBrowserFn(autopilot.browser)
  }
}

/**
 * Initialize an authenticated SubstackClient.
 *
 * 1. Try restoring session from saved cookies
 * 2. If expired/missing, warm up Cloudflare via browser, retry once with a
 *    fresh browser session, then use browser-autopilot as the last browser recourse.
 * 3. Falls back to direct API login only when no browser is available
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
      let retryError: unknown
      try {
        const { cookies, email } = await retryBrowserLoginWithFreshSession(privateKey, cookiesPath, events)
        events.monologue(`Logged into Substack as ${email}`)
        await authenticateVerifiedSession(client, cookies)
        return client
      } catch (freshBrowserError) {
        retryError = freshBrowserError
        events.monologue(`Fresh-browser Substack retry failed: ${retryError instanceof Error ? retryError.message : String(retryError)}`)
      }
      try {
        const { cookies, email } = await loginViaBrowserAutopilotFallback(privateKey, cookiesPath, events, browser)
        events.monologue(`Logged into Substack as ${email}`)
        await authenticateVerifiedSession(client, cookies)
        return client
      } catch (autopilotError) {
        throw new Error(
          `Substack login failed. Browser flow: ${error instanceof Error ? error.message : String(error)}. ` +
          `Fresh browser retry: ${typeof retryError !== 'undefined' ? (retryError instanceof Error ? retryError.message : String(retryError)) : 'not attempted'}. ` +
          `browser-autopilot fallback: ${autopilotError instanceof Error ? autopilotError.message : String(autopilotError)}`,
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
        try {
          const { cookies, email } = await retryBrowserLoginWithFreshSession(privateKey, cookiesPath, events)
          await authenticateVerifiedSession(client, cookies)
          events.monologue(`Re-authenticated as ${email}`)
        } catch (retryError) {
          events.monologue(`Fresh-browser Substack re-authentication retry failed: ${retryError instanceof Error ? retryError.message : String(retryError)}`)
          try {
            const { cookies, email } = await loginViaBrowserAutopilotFallback(privateKey, cookiesPath, events, browser)
            await authenticateVerifiedSession(client, cookies)
            events.monologue(`Re-authenticated as ${email}`)
          } catch (autopilotError) {
            throw autopilotError
          }
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
  deps: SetupPublicationDependencies = {},
): Promise<void> {
  events.monologue('Checking publication setup...')

  let self = await getFreshSelf(client)
  let publicationBootstrapFailures: string[] = []
  let lastBootstrapAttemptedName: string | null = null
  const runTrackedText = deps.generateText ?? generateTrackedText

  let publication: any = null
  if (self.primaryPublication) {
    try {
      publication = await client.getPublication()
    } catch (err) {
      events.monologue(`Could not fetch publication: ${(err as Error).message}`)
    }
  }

  const setupTools = {
    bootstrap_publication: tool({
      description: 'Create or retry the Substack publication. Use this first when no publication exists, especially after bootstrap errors.',
      inputSchema: z.object({
        name: z.string().min(1).describe('A concise publication name, 30 characters max. Put extra identity detail into the bio or publication description.'),
      }),
      execute: async ({ name }: { name: string }) => {
        const normalizedName = name.replace(/\s+/g, ' ').trim()
        lastBootstrapAttemptedName = normalizedName

        const validationError = validatePublicationBootstrapName(normalizedName)
        if (validationError) {
          publicationBootstrapFailures = [validationError]
          events.monologue(`Publication bootstrap failed: ${validationError}`)
          return {
            success: false,
            attemptedName: normalizedName,
            publication: null,
            errors: publicationBootstrapFailures,
          }
        }

        const bootstrapAttempt = await attemptPublicationBootstrap({
          client,
          identity,
          events,
          browser,
          preferredName: normalizedName,
        })

        self = bootstrapAttempt.self
        lastBootstrapAttemptedName = bootstrapAttempt.attemptedName
        publicationBootstrapFailures = summarizePublicationBootstrapErrors(
          bootstrapAttempt.ensurePublicationError,
          bootstrapAttempt.browserInitError,
        )

        if (!self.primaryPublication) {
          return {
            success: false,
            attemptedName: bootstrapAttempt.attemptedName,
            publication: null,
            errors: publicationBootstrapFailures,
          }
        }

        try {
          publication = await client.getPublication()
        } catch (error) {
          publication = null
          events.monologue(`Publication created but fetching publication metadata failed: ${(error as Error).message}`)
        }

        return {
          success: true,
          attemptedName: bootstrapAttempt.attemptedName,
          publication: self.primaryPublication,
        }
      },
    }),
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

  const bootstrapContext = !self.primaryPublication
    ? [
        '<publication_bootstrap_status>',
        'No publication exists yet.',
        `The Substack publication title must be ${MAX_SUBSTACK_DISPLAY_NAME_LENGTH} characters or fewer.`,
        'Choose a deliberate short publication name that captures the identity. Do not mechanically truncate the full identity name.',
        'If the identity has multiple names, qualifiers, or parenthetical detail, move that richer context into the bio or publication description instead.',
        lastBootstrapAttemptedName ? `Last attempted bootstrap name: ${JSON.stringify(lastBootstrapAttemptedName)}` : '',
        publicationBootstrapFailures.length > 0
          ? `Most recent bootstrap failures:\n${publicationBootstrapFailures.map(failure => `- ${failure}`).join('\n')}`
          : 'No bootstrap failure was captured yet.',
        '</publication_bootstrap_status>',
      ].filter(Boolean).join('\n')
    : '<publication_bootstrap_status>\nPublication already exists.\n</publication_bootstrap_status>'

  await runTrackedText({
    operation: 'publication_setup',
    modelId: config.modelId('editing'),
    model: config.model('editing'),
    system: `${persona}

<publication_setup_task>
  <goal>Align the Substack publication with the agent's identity.</goal>
  <rules>
    <rule>If there is no publication yet, call bootstrap_publication before trying publication-only tools.</rule>
    <rule>Only update fields that are missing or don't match the agent's identity.</rule>
    <rule>If the publication is already well-configured, just call setup_complete.</rule>
    <rule>Publication and profile names must stay within Substack's 30 character limit.</rule>
    <rule>Publication name should reflect the agent's identity, but if the full identity is too long, invent a concise title instead of chopping the name mid-thought.</rule>
    <rule>Put extra names, cast details, or explanatory context into the bio and publication description rather than overloading the title.</rule>
    <rule>If the handle or subdomain are clearly generic or mismatched, align them to a short URL-safe version of the agent identity.</rule>
    <rule>Bio/description should capture the agent's voice and mission.</rule>
    <rule>Set appropriate category tags for discoverability.</rule>
    <rule>Be concise — Substack has character limits on most fields.</rule>
    <rule>If a bootstrap or update attempt fails, use the error feedback to choose a different shorter or cleaner input rather than repeating the same request.</rule>
    <rule>Call setup_complete when done.</rule>
  </rules>
</publication_setup_task>`,
    prompt: `${bootstrapContext}\n\n<current_profile>\n${JSON.stringify(self, null, 2)}\n</current_profile>\n\n<current_publication>\n${JSON.stringify(publication, null, 2)}\n</current_publication>`,
    tools: setupTools,
    maxSteps: 10,
  })

  self = await getFreshSelf(client)
  if (!self.primaryPublication) {
    events.monologue('Publication setup ended without a publication. Publishing will remain unavailable until setup succeeds.')
    return
  }

  if (!publication) {
    try {
      publication = await client.getPublication()
    } catch (error) {
      events.monologue(`Could not fetch publication after setup: ${(error as Error).message}`)
    }
  }

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
