/**
 * Account Control Certificate Cron
 *
 * Periodically checks whether the agent has a valid proof-of-control
 * certificate from the attestation service.  If no certificate exists (or it
 * has expired), the agent gathers its platform credentials, signs an
 * attestation message with its EVM wallet, and requests a new certificate.
 *
 * Important: these certificates prove *control* (the agent can present valid
 * credentials) — not exclusive ownership.  Credentials like API keys and
 * cookies are not inherently exclusive; multiple parties may hold them.
 *
 * Follows the same start/stop lifecycle pattern as SelfBilling.
 */

import { existsSync } from 'fs'
import { join } from 'path'
import type { ContentSigner } from '../crypto/signer.js'
import type { EventBus } from '../console/events.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CookieEntry {
  name: string
  value: string
  domain?: string
  path?: string
  secure?: boolean
}

export interface OwnershipCredentials {
  platform: 'twitter' | 'substack'
  cookies?: CookieEntry[]
  token?: string
  platformUserId: string
  platformUsername: string
}

export interface OwnershipCertConfig {
  serviceUrl: string
  /** How often to check (default 12 h). */
  checkIntervalMs: number
  /** Re-request when the existing cert is older than this (default 7 d). */
  certMaxAgeMs: number
}

interface Certificate {
  id: string
  platform: string
  platformUserId: string
  platformUsername: string
  address: string
  issuedAt: string
  serviceAddress: string
}

interface CertificateResponse {
  certificate: Certificate
  signature: string
}

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

export class OwnershipCertificateManager {
  private timer: ReturnType<typeof setInterval> | null = null
  private running = false

  constructor(
    private signer: ContentSigner,
    private config: OwnershipCertConfig,
    private getCredentials: () => Promise<OwnershipCredentials | null>,
    private events: EventBus,
  ) {}

  start(): void {
    if (this.timer) return
    // Run on next tick so it doesn't block startup, then repeat on interval.
    setTimeout(() => this.tick(), 5_000)
    this.timer = setInterval(() => this.tick(), this.config.checkIntervalMs)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private async tick(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      await this.checkAndRequest()
    } catch (err) {
      this.events.monologue(
        `Ownership certificate check failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    } finally {
      this.running = false
    }
  }

  // -------------------------------------------------------------------------
  // Core logic
  // -------------------------------------------------------------------------

  private async checkAndRequest(): Promise<void> {
    // 1. Gather credentials first — if the platform hasn't initialised yet
    //    (no cookies saved, no bearer token configured) we skip early.
    const creds = await this.getCredentials()
    if (!creds) return

    // 2. Ask the ownership service whether a cert already exists.
    const existing = await this.fetchExistingCerts()

    const match = existing.find(
      (c) =>
        c.certificate.platform === creds.platform &&
        c.certificate.platformUserId === creds.platformUserId,
    )

    if (match) {
      const ageMs = Date.now() - new Date(match.certificate.issuedAt).getTime()
      if (ageMs < this.config.certMaxAgeMs) {
        // Certificate is still fresh — nothing to do.
        return
      }
      const ageDays = Math.round(ageMs / 86_400_000)
      this.events.monologue(
        `Ownership certificate for ${creds.platform}/@${match.certificate.platformUsername} is ${ageDays}d old — refreshing`,
      )
    } else {
      this.events.monologue(
        `No ownership certificate found for ${creds.platform} — requesting one`,
      )
    }

    // 3. Request a fresh certificate.
    await this.requestCertificate(creds)
  }

  private async fetchExistingCerts(): Promise<CertificateResponse[]> {
    const url = `${this.config.serviceUrl}/certificates?address=${this.signer.address}`
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) {
      throw new Error(`GET /certificates returned ${res.status}`)
    }
    const data = (await res.json()) as { certificates: CertificateResponse[] }
    return data.certificates ?? []
  }

  private async requestCertificate(creds: OwnershipCredentials): Promise<void> {
    const timestamp = Math.floor(Date.now() / 1000)
    const message = [
      'proof-of-ownership',
      creds.platform,
      this.signer.address,
      creds.platformUserId,
      String(timestamp),
    ].join(':')

    const signature = await this.signer.sign(message)

    const credentials: Record<string, unknown> =
      creds.platform === 'substack'
        ? { cookies: creds.cookies }
        : { token: creds.token }

    const res = await fetch(`${this.config.serviceUrl}/attest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform: creds.platform,
        credentials,
        address: this.signer.address,
        message,
        signature,
      }),
      signal: AbortSignal.timeout(15_000),
    })

    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string }
      throw new Error(
        `POST /attest returned ${res.status}: ${body.error ?? 'unknown'}`,
      )
    }

    const result = (await res.json()) as CertificateResponse
    this.events.monologue(
      `Ownership certificate issued for ${creds.platform}/@${result.certificate.platformUsername} (cert ${result.certificate.id.slice(0, 8)})`,
    )
  }
}

// ---------------------------------------------------------------------------
// Credential helpers
// ---------------------------------------------------------------------------

/**
 * Build a credential-getter for Substack.
 *
 * Reads saved cookies from disk and calls `getSelf()` on the client to
 * retrieve the user's ID and handle.  Returns `null` when cookies don't exist
 * yet (agent hasn't completed first login).
 */
export function substackCredentialGetter(
  dataDir: string,
  getClient: () => { getSelf: () => Promise<{ id: number; handle: string }> } | undefined,
): () => Promise<OwnershipCredentials | null> {
  return async () => {
    const cookiesPath = join(dataDir, 'substack-cookies.json')
    if (!existsSync(cookiesPath)) return null

    const client = getClient()
    if (!client) return null

    let cookies: CookieEntry[]
    try {
      const { loadCookies } = await import('substack-skill')
      cookies = await loadCookies(cookiesPath)
    } catch {
      return null
    }

    if (cookies.length === 0) return null

    let self: { id: number; handle: string }
    try {
      self = await client.getSelf()
    } catch {
      // Session may be expired — skip this tick, the main loop will refresh.
      return null
    }

    return {
      platform: 'substack',
      cookies,
      platformUserId: String(self.id),
      platformUsername: self.handle,
    }
  }
}

/**
 * Build a credential-getter for Twitter.
 *
 * Uses the bearer token to authenticate with the ownership service.
 * Calls the Twitter v2 API via the agent's OAuth client to resolve the
 * user ID (since the app-only bearer token may not support /users/me).
 */
export function twitterCredentialGetter(
  bearerToken: string,
  username: string,
  getOAuth: () => { v2: { userByUsername: (u: string) => Promise<{ data?: { id?: string; username?: string } }> } } | undefined,
): () => Promise<OwnershipCredentials | null> {
  return async () => {
    if (!bearerToken || !username) return null

    const oauth = getOAuth()
    if (!oauth) return null

    let userId: string
    let resolvedUsername: string
    try {
      const res = await oauth.v2.userByUsername(username)
      if (!res.data?.id) return null
      userId = res.data.id
      resolvedUsername = res.data.username ?? username
    } catch {
      return null
    }

    return {
      platform: 'twitter',
      token: bearerToken,
      platformUserId: userId,
      platformUsername: resolvedUsername,
    }
  }
}

// ---------------------------------------------------------------------------
// Config resolution
// ---------------------------------------------------------------------------

const TWELVE_HOURS = 12 * 60 * 60 * 1000
const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000

export function resolveOwnershipConfig(): OwnershipCertConfig | null {
  const serviceUrl = process.env.PROOF_OF_OWNERSHIP_URL?.trim()
  if (!serviceUrl) return null

  return {
    serviceUrl: serviceUrl.replace(/\/+$/, ''),
    checkIntervalMs:
      Number(process.env.OWNERSHIP_CHECK_INTERVAL_MS) || TWELVE_HOURS,
    certMaxAgeMs:
      Number(process.env.OWNERSHIP_CERT_MAX_AGE_MS) || SEVEN_DAYS,
  }
}
