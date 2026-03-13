/**
 * Media Agent
 *
 * A general-purpose autonomous media agent. Defined by three files:
 * - SOUL.md — who the agent is (personality, beliefs, style)
 * - PROCESS.toml — deterministic pipeline definition (workflows, timers, skill scoping)
 * - constitution.md — governance rules (immutable constraints)
 */

import { join, resolve } from 'path'
import { readFileSync } from 'fs'
import { mkdir } from 'fs/promises'
import { createConfig } from './config/index.js'
import { createDatabase } from './db/index.js'
import { EventBus } from './console/events.js'
import { Cache } from './cache/cache.js'
import { AgentLoop } from './agent/loop.js'
import { ScannerRegistry } from './pipeline/scanner.js'
import { ContentSigner } from './crypto/signer.js'
import { WalletManager } from './crypto/wallet.js'
import { SkillRegistry } from './skills/registry.js'
import { createServer } from './server/index.js'
import { createPipelineState } from './process/state.js'
import { AgentCompiler, validateCompiledAgent } from './process/compiler.js'
import { ProcessExecutor } from './process/executor.js'
import { loadProcessPlan } from './process/plan-loader.js'
import { JsonStore } from './store/json-store.js'
import { initCostTracker } from './ai/tracking.js'
import type { PlatformAdapter } from './platform/types.js'
import type { Post, AgentIdentity } from './types.js'
import type { SkillContext } from './skills/types.js'
import { ensureInstalledSkillsRoot, getInstalledSkillsRoot } from './skills/installed.js'

function readFile(path: string): string {
  try {
    return readFileSync(resolve(process.cwd(), path), 'utf-8')
  } catch {
    console.error(`Missing required file: ${path}`)
    process.exit(1)
  }
}

async function initTwitterPlatform(config: ReturnType<typeof createConfig>, events: EventBus, ctx: SkillContext): Promise<PlatformAdapter> {
  const { TwitterClient } = await import('./platform/twitter/client.js')
  const { TwitterV2Reader } = await import('./platform/twitter/twitterapi-v2.js')
  const { EngagementLoop } = await import('./platform/twitter/engagement.js')
  const { TwitterScanner } = await import('./platform/twitter/scanner/index.js')
  const { TwitterAdapter } = await import('./platform/twitter/adapter.js')

  const { TwitterApi } = await import('twitter-api-v2')
  const oauth = new TwitterApi({
    appKey: config.twitter.apiKey,
    appSecret: config.twitter.apiSecret,
    accessToken: config.twitter.accessToken,
    accessSecret: config.twitter.accessSecret,
  })

  const readProvider = new TwitterV2Reader(config.twitter.bearerToken, oauth)
  const twitter = new TwitterClient(events, readProvider, config)

  const postsStore = new JsonStore<Post[]>(join(config.dataDir, 'posts.json'))
  const engagement = new EngagementLoop(events, twitter, postsStore, config, ctx.identity, ctx.signer)
  await engagement.init()

  const twitterScanner = new TwitterScanner(
    events, readProvider, ctx.caches.signal,
    config.twitter.bearerToken,
    { newsTtlMs: config.scan.newsTtlMs, timelineTtlMs: config.scan.timelineTtlMs },
    twitter,
  )

  // Store client + provider on context so the twitter skill can create tools from them
  ;(ctx as any).twitterClient = twitter
  ;(ctx as any).twitterProvider = readProvider

  return new TwitterAdapter(twitter, engagement, twitterScanner)
}

async function initSubstackPlatform(mnemonic: string, events: EventBus, ctx: SkillContext): Promise<PlatformAdapter> {
  const { initSubstackClient, setupPublication } = await import('./platform/substack/init.js')
  const { SubstackEngagement } = await import('./platform/substack/engagement.js')
  const { SubstackScanner } = await import('./platform/substack/scanner/index.js')
  const { SubstackAdapter } = await import('./platform/substack/adapter.js')

  // Login via the authenticated browser session when available.
  const client = await initSubstackClient(mnemonic, ctx.dataDir, events, ctx.browser)

  // Store client on context so the substack skill can create tools from it
  ;(ctx as any).substackClient = client

  // LLM-driven publication setup (aligns publication with SOUL.md identity)
  await setupPublication(client, ctx.identity, events, ctx.browser)

  const engagement = new SubstackEngagement(client, events, ctx.identity)
  const rssFeeds = (process.env.RSS_FEEDS ?? '').split(',').filter(Boolean)
  const substackScanner = new SubstackScanner(rssFeeds)

  return new SubstackAdapter(client, engagement, substackScanner, events)
}

async function main() {
  console.log('Agent starting...')

  // 1. Read defining files + load process plan
  const soulText = readFile('SOUL.md')
  const constitutionText = readFile('constitution.md')
  const { plan, description: processDescription } = loadProcessPlan()
  console.log('Agent files loaded')

  // 2. Init config
  const config = createConfig()
  await mkdir(config.dataDir, { recursive: true })
  const installedSkillsRoot = getInstalledSkillsRoot(config.dataDir)
  await ensureInstalledSkillsRoot(installedSkillsRoot)

  // 3. Init infrastructure
  const db = await createDatabase(join(config.dataDir, 'agent.db'))
  const events = new EventBus(join(config.dataDir, 'events.jsonl'))
  await events.init()
  await initCostTracker(config.dataDir, events)

  const signalCache = new Cache<any>('signals', 200, join(config.dataDir, 'cache-signals.json'))
  const evalCache = new Cache('eval', config.cache.maxEntries, join(config.dataDir, 'cache-eval.json'))
  const imageCache = new Cache('images', 100, join(config.dataDir, 'cache-images.json'))
  await Promise.all([signalCache.restore(), evalCache.restore(), imageCache.restore()])

  // 4. Wallet + signer
  const mnemonic = process.env.MNEMONIC ?? ''
  const wallet = new WalletManager(mnemonic)
  const signer = mnemonic ? new ContentSigner(mnemonic) : undefined
  if (signer) console.log(`Content signer: ${signer.address}`)

  // 5. Browser
  const { createBrowser } = await import('./browser/index.js')
  const browser = await createBrowser()
  if (browser) console.log('Browser session established')

  // 6. Build shared context — populated by compiler
  const identity: AgentIdentity = {
    name: '', tagline: '', creator: '', constitution: constitutionText,
    persona: '', beliefs: [], themes: [], punchesUp: [],
    respects: [], voice: '', restrictions: [], motto: '',
  }

  const ctx: SkillContext = {
    events,
    identity,
    config,
    dataDir: config.dataDir,
    db,
    wallet,
    browser: browser ?? undefined,
    state: createPipelineState(db),
    scannerRegistry: new ScannerRegistry(),
    signer,
    caches: { eval: evalCache, image: imageCache, signal: signalCache },
  }

  // 7. Discover all skills
  const skills = new SkillRegistry()
  ctx.registry = skills
  await skills.discover({
    builtinRoot: join(import.meta.dir, 'skills'),
    installedRoot: installedSkillsRoot,
  })

  // 8. Compile agent identity + apply process plan
  const compiler = new AgentCompiler(config, config.dataDir)
  const compileCurrentAgent = async () => {
    const nextSoul = readFile('SOUL.md')
    const nextConstitution = readFile('constitution.md')
    const nextProcess = loadProcessPlan()
    return compiler.compile(nextSoul, nextConstitution, nextProcess.plan, nextProcess.description)
  }

  const compiled = await compiler.compile(soulText, constitutionText, plan, processDescription)
  Object.assign(identity, compiled.identity)
  identity.constitution = constitutionText
  ctx.compiledStyle = compiled.style

  // 9. Init platform
  let platform: PlatformAdapter
  if (config.platform === 'substack') {
    platform = await initSubstackPlatform(mnemonic, events, ctx)
  } else {
    platform = await initTwitterPlatform(config, events, ctx)
  }
  await platform.init(events)
  ctx.platform = platform
  ctx.scannerRegistry.register(platform.getScanner())

  // 10. Init all skills (each creates its own internals from ctx)
  await skills.initAll(ctx)

  const startupValidation = validateCompiledAgent(compiled, {
    availableSkillNames: skills.names,
    availableToolNames: Object.keys(skills.tools),
    platform: config.platform,
  })
  if (!startupValidation.ok) {
    throw new Error(`Compiled agent plan is invalid at startup: ${startupValidation.errors.join(' | ')}`)
  }

  console.log(`Agent: ${identity.name} | Platform: ${config.platform}`)
  console.log(`Skills: ${skills.names.join(', ')}`)
  console.log(`Workflows: ${compiled.plan.workflows.map(w => w.name).join(', ')}`)

  // 11. Create executor + wire hot reload
  const executor = new ProcessExecutor(compiled.plan, skills, ctx.state, events, config, identity, compiled.creativeProcess, config.dataDir)

  skills.setInstalledSkillsReloadHandler(async ({ added, removed, reloaded }) => {
    const nextCompiled = await compileCurrentAgent()
    const runtimeValidation = validateCompiledAgent(nextCompiled, {
      availableSkillNames: skills.names,
      availableToolNames: Object.keys(skills.tools),
      platform: config.platform,
    })
    if (!runtimeValidation.ok) {
      throw new Error(runtimeValidation.errors.join(' | '))
    }

    executor.replacePlan(nextCompiled.plan, nextCompiled.creativeProcess)

    const changed = [...added, ...removed, ...reloaded]
    events.monologue(`Recompiled workflow plan after skill refresh${changed.length > 0 ? ` (${changed.join(', ')})` : ''}.`)
  })
  skills.startHotReload({
    installedRoot: installedSkillsRoot,
    enabled: config.skills.hotReloadEnabled,
  })

  // 12. Start server (needs executor for /upgrade/process)
  const app = await createServer({
    events,
    config,
    db,
    identity,
    compiled,
    skills,
    executor,
    wallets: { evm: wallet.ethAddress, solana: wallet.solAddress },
  })
  await app.listen({ port: config.port, host: '0.0.0.0' })
  console.log(`Media agent running on port ${config.port}`)

  // 13. Start agent loop
  const loop = new AgentLoop(events, executor, skills, config, identity)
  const loopPromise = loop.start()

  const shutdown = async () => {
    console.log('Shutting down...')
    loop.stop()
    await Promise.all([signalCache.persist(), evalCache.persist(), imageCache.persist()])
    skills.stopHotReload()
    await skills.shutdownAll()
    const { disconnectBrowser } = await import('./browser/index.js')
    await disconnectBrowser(ctx.browser)
    await app.close()
    db.close()
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  await loopPromise
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
