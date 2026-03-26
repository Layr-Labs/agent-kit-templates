import Fastify from 'fastify'
import fastifyRateLimit from '@fastify/rate-limit'
import fastifyStatic from '@fastify/static'
import { execSync } from 'child_process'
import { basename, join, resolve } from 'path'
import type { EventBus } from '../console/events.js'
import type { Config } from '../config/index.js'
import type { Database } from '../db/index.js'
import { registerConsoleRoutes } from '../console/stream.js'
import type { AgentIdentity } from '../types.js'
import { handleUpgradeConsent } from '../upgrade/consent.js'
import {
  handleSkillInstallUpgrade,
  handleSkillRemoveUpgrade,
  handleSkillStateUpgrade,
} from '../upgrade/skills.js'
import { getCostTracker } from '../ai/tracking.js'
import type { SkillRegistry } from '../skills/registry.js'
import type { ProcessExecutor } from '../process/executor.js'
import { getInstalledSkillsRoot, listInstalledSkillInventory } from '../skills/installed.js'
import { handleProcessUpgrade } from '../upgrade/process.js'
import type { CompiledAgent } from '../process/types.js'
import { buildSiteBootstrap, loadWorldview } from './site.js'
import { ContentSigner } from '../crypto/signer.js'

export async function createServer(opts: {
  events: EventBus
  config: Config
  db: Database
  identity: AgentIdentity
  compiled: CompiledAgent
  skills: SkillRegistry
  executor: ProcessExecutor
  wallets?: { evm: string; solana: string }
  getSubstackPublicationUrl?: () => Promise<string | null>
  siteRoot?: string
}) {
  const { events, config, db, identity, compiled, skills, executor, wallets, getSubstackPublicationUrl } = opts
  const app = Fastify({ logger: false })

  // Rate limiting plugin (used for selected routes such as verification)
  await app.register(fastifyRateLimit, {
    max: 30,
    timeWindow: '1 minute',
    keyGenerator: (request) => request.ip,
  })

  const installedSkillsRoot = getInstalledSkillsRoot(config.dataDir)
  const siteRoot = opts.siteRoot ?? resolve(import.meta.dir, '../../site/dist')

  // Capture git info once at server creation.
  // Prefer live git data; fall back to env vars injected by the coordinator.
  let repoUrl: string | null = process.env.REPO_URL || null
  let gitCommit: string | null = process.env.GIT_COMMIT || null
  try {
    repoUrl = execSync('git remote get-url origin', { encoding: 'utf-8' }).trim()
      .replace(/\.git$/, '')
      .replace(/^git@github\.com:/, 'https://github.com/')
    gitCommit = execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim()
  } catch { /* not in a git repo — env-var fallback already set */ }

  // Template name is the directory name at the repo root (e.g. "media-agent")
  const template = basename(resolve(import.meta.dir, '../..'))

  // Health
  app.get('/health', async () => ({
    status: 'ok',
    agent: identity.name,
    ts: Date.now(),
  }))
  app.get('/api/health', async () => ({
    status: 'ok',
    agent: identity.name,
    uptime: process.uptime(),
    state: events.state,
    ts: Date.now(),
  }))

  // Feed
  app.get('/api/feed', async (req) => {
    const limit = Number((req.query as any).limit) || 20
    const offset = Number((req.query as any).offset) || 0
    const rows = db.query(
      'SELECT * FROM posts ORDER BY posted_at DESC LIMIT ? OFFSET ?',
    ).all(limit, offset)
    return rows
  })

  // Worldview
  app.get('/api/worldview', async () => {
    return loadWorldview(config, identity)
  })

  // Identity
  app.get('/api/identity', async () => identity)

  app.get('/api/platform/profile', async (_req, reply) => {
    if (config.platform === 'substack') {
      if (!getSubstackPublicationUrl) {
        reply.code(404)
        return { error: 'Platform profile URL is not available for this agent.' }
      }

      try {
        const url = await getSubstackPublicationUrl()
        if (!url) {
          reply.code(404)
          return { error: 'Platform profile URL is not available yet.' }
        }

        return {
          platform: 'substack',
          label: 'Publication',
          url,
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (message.toLowerCase().includes('no publication found')) {
          reply.code(404)
          return { error: 'Platform profile has not been created yet.' }
        }

        reply.code(502)
        return { error: `Failed to resolve platform profile URL: ${message}` }
      }
    }

    if (config.platform === 'twitter') {
      const username = config.twitter.username.trim().replace(/^@+/, '')
      if (!username) {
        reply.code(404)
        return { error: 'Platform profile URL is not available yet.' }
      }

      return {
        platform: 'twitter',
        label: 'Profile',
        url: `https://x.com/${username}`,
      }
    }

    reply.code(404)
    return { error: 'Platform profile URL is not available for this agent.' }
  })

  app.get('/api/substack/publication', async (_req, reply) => {
    if (config.platform !== 'substack' || !getSubstackPublicationUrl) {
      reply.code(404)
      return { error: 'Substack publication URL is not available for this agent.' }
    }

    try {
      const url = await getSubstackPublicationUrl()
      if (!url) {
        reply.code(404)
        return { error: 'Substack publication URL is not available yet.' }
      }

      return {
        platform: 'substack',
        url,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.toLowerCase().includes('no publication found')) {
        reply.code(404)
        return { error: 'Substack publication has not been created yet.' }
      }

      reply.code(502)
      return { error: `Failed to resolve Substack publication URL: ${message}` }
    }
  })

  // Site bootstrap
  app.get('/api/site/bootstrap', async () => buildSiteBootstrap({
    events,
    config,
    db,
    identity,
    compiled,
    skills,
    wallets,
    repoUrl,
    gitCommit,
    template,
  }))

  // Skills
  app.get('/api/skills', async () => ({
    hotReloadEnabled: config.skills.hotReloadEnabled,
    installedRoot: installedSkillsRoot,
    activeSkills: skills.list(),
    installedSkills: await listInstalledSkillInventory(installedSkillsRoot),
  }))

  // Wallets
  app.get('/api/wallets', async () => {
    if (!wallets) return { evm: null, solana: null }
    return wallets
  })

  // Cost tracking
  app.get('/api/costs', async (req) => {
    const limit = Number((req.query as any).limit) || 50
    const tracker = getCostTracker()
    if (!tracker) return { enabled: false, reason: 'Cost tracker not initialized.' }
    return { enabled: true, ...tracker.getSummary(limit) }
  })

  // Coordinator -> agent constitutional consent gate
  app.post('/upgrade/consent', async (request, reply) => {
    const response = await handleUpgradeConsent({
      headers: request.headers as Record<string, string | string[] | undefined>,
      body: request.body,
      config,
      events,
      identity,
    })
    reply.code(response.status)
    for (const [key, value] of response.headers.entries()) {
      reply.header(key, value)
    }
    return response.text()
  })

  app.post('/upgrade/skills/install', async (request, reply) => {
    const response = await handleSkillInstallUpgrade({
      headers: request.headers as Record<string, string | string[] | undefined>,
      body: request.body,
      dataDir: config.dataDir,
      installedRoot: installedSkillsRoot,
      registry: skills,
      events,
    })
    reply.code(response.status)
    for (const [key, value] of response.headers.entries()) {
      reply.header(key, value)
    }
    return response.text()
  })

  app.post('/upgrade/skills/set-state', async (request, reply) => {
    const response = await handleSkillStateUpgrade({
      headers: request.headers as Record<string, string | string[] | undefined>,
      body: request.body,
      dataDir: config.dataDir,
      installedRoot: installedSkillsRoot,
      registry: skills,
      events,
    })
    reply.code(response.status)
    for (const [key, value] of response.headers.entries()) {
      reply.header(key, value)
    }
    return response.text()
  })

  app.post('/upgrade/skills/remove', async (request, reply) => {
    const response = await handleSkillRemoveUpgrade({
      headers: request.headers as Record<string, string | string[] | undefined>,
      body: request.body,
      dataDir: config.dataDir,
      installedRoot: installedSkillsRoot,
      registry: skills,
      events,
    })
    reply.code(response.status)
    for (const [key, value] of response.headers.entries()) {
      reply.header(key, value)
    }
    return response.text()
  })

  app.post('/upgrade/process', async (request, reply) => {
    const response = await handleProcessUpgrade({
      headers: request.headers as Record<string, string | string[] | undefined>,
      body: request.body,
      config,
      registry: skills,
      executor,
      events,
      identity,
    })
    reply.code(response.status)
    for (const [key, value] of response.headers.entries()) {
      reply.header(key, value)
    }
    return response.text()
  })

  // Verify link
  app.post('/api/verify/link', {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '1 minute',
      },
    },
  }, async (request, reply) => {
    const { url } = (request.body ?? {}) as { url?: string }
    if (!url || typeof url !== 'string') {
      reply.code(400)
      return { signatureVerified: false, error: 'Missing url field.' }
    }

    const twitterMatch = url.match(/^https?:\/\/(?:x\.com|twitter\.com)\/([^/]+)\/status\/(\d+)/)
    // Match standard (example.substack.com/p/slug) and open (open.substack.com/pub/name/p/slug) formats
    const substackMatch = url.match(/^https?:\/\/([^/]+)\/(?:pub\/[^/]+\/)?p\/([^/?#]+)/)

    let accountVerified = false
    let post: Record<string, unknown> | null = null

    if (twitterMatch) {
      const [, username, tweetId] = twitterMatch
      accountVerified = config.platform === 'twitter' &&
        username.toLowerCase() === config.twitter.username.toLowerCase()
      post = db.query('SELECT * FROM posts WHERE platform_id = ?').get(tweetId) as Record<string, unknown> | null
    } else if (substackMatch) {
      const [, domain, slug] = substackMatch
      let pubUrl: string | null = null
      if (getSubstackPublicationUrl) {
        try { pubUrl = await getSubstackPublicationUrl() } catch { /* ignore */ }
      }

      if (pubUrl) {
        try {
          accountVerified = new URL(pubUrl).origin === new URL(`https://${domain}`).origin
        } catch { /* ignore */ }
      }

      post = db.query('SELECT * FROM posts WHERE article_url LIKE ?').get(`%${slug}%`) as Record<string, unknown> | null
      if (!post) {
        post = db.query('SELECT * FROM posts WHERE platform_id = ?').get(slug) as Record<string, unknown> | null
      }

      if (post && !accountVerified && config.platform === 'substack') {
        accountVerified = true
      }
    } else {
      return { accountVerified: false, signatureVerified: false, error: 'Unrecognized URL format. Provide a Twitter or Substack post URL.' }
    }

    if (!post) {
      return { accountVerified, signatureVerified: false, error: 'Post not created by agent.' }
    }

    const urlSig = post.url_signature as string | null
    const sigAddr = post.signer_address as string | null

    // Normalize the URL to the canonical form used when signing.
    // Twitter adapter signs https://x.com/i/status/<id> but users paste
    // https://x.com/<username>/status/<id>.  Substack signs the
    // canonical_url but users may paste open.substack.com, custom-domain,
    // or query-param variants.  Use the stored article_url for Substack
    // (it IS the string that was signed) and reconstruct for Twitter.
    if (urlSig && sigAddr) {
      let verifyUrl = url
      if (twitterMatch) {
        const [, , tweetId] = twitterMatch
        verifyUrl = `https://x.com/i/status/${tweetId}`
      } else if (substackMatch && post.article_url) {
        verifyUrl = String(post.article_url)
      }

      try {
        const signatureVerified = await ContentSigner.verify(verifyUrl, urlSig, sigAddr)
        return { accountVerified, signatureVerified }
      } catch {
        return { accountVerified, signatureVerified: false, error: 'Signature verification failed.' }
      }
    }

    // Fallback for posts published before URL signing was added:
    // verify the content signature against the stored post text.
    const contentSig = post.signature as string | null
    if (contentSig && sigAddr) {
      try {
        const signatureVerified = await ContentSigner.verify(
          String(post.text ?? ''), contentSig, sigAddr,
        )
        return { accountVerified, signatureVerified }
      } catch {
        return { accountVerified, signatureVerified: false, error: 'Signature verification failed.' }
      }
    }

    return { accountVerified }
  })

  // Verify raw signature
  app.post('/api/verify/signature', async (request, reply) => {
    const { message, signature } = (request.body ?? {}) as { message?: string; signature?: string }
    if (!message || !signature) {
      reply.code(400)
      return { signatureVerified: false, signerAddress: '', error: 'Missing message or signature field.' }
    }

    const signerAddress = wallets?.evm ?? ''
    if (!signerAddress) {
      return { signatureVerified: false, signerAddress: '', error: 'Agent has no EVM wallet configured.' }
    }

    try {
      const signatureVerified = await ContentSigner.verify(message, signature, signerAddress)
      return { signatureVerified, signerAddress }
    } catch {
      return { signatureVerified: false, signerAddress, error: 'Signature verification failed.' }
    }
  })

  // Console SSE
  registerConsoleRoutes(app, events)

  // Static site assets
  await app.register(fastifyStatic, {
    root: siteRoot,
    prefix: '/site/',
  })

  app.get('/', async (_request, reply) => reply.sendFile('index.html'))
  app.get('/favicon.svg', async (_request, reply) => reply.sendFile('eigen-symbol.svg'))

  // Static files for images
  try {
    await app.register(fastifyStatic, {
      root: resolve(process.cwd(), config.dataDir, 'images'),
      prefix: '/images/',
      decorateReply: false,
    })
  } catch { /* images dir might not exist yet */ }

  return app
}
