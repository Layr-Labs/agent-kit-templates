import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import { join, resolve } from 'path'
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

export async function createServer(opts: {
  events: EventBus
  config: Config
  db: Database
  identity: AgentIdentity
  compiled: CompiledAgent
  skills: SkillRegistry
  executor: ProcessExecutor
  wallets?: { evm: string; solana: string }
}) {
  const { events, config, db, identity, compiled, skills, executor, wallets } = opts
  const app = Fastify({ logger: false })
  const installedSkillsRoot = getInstalledSkillsRoot(config.dataDir)
  const siteRoot = resolve(import.meta.dir, '../../site/dist')

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

  // Site bootstrap
  app.get('/api/site/bootstrap', async () => buildSiteBootstrap({
    events,
    config,
    db,
    identity,
    compiled,
    skills,
    wallets,
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
