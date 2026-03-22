/**
 * Media Agent
 *
 * A general-purpose sovereign media agent. Defined by three files:
 * - SOUL.md — who the agent is (personality, beliefs, style)
 * - PROCESS.md — how the agent creates (creative workflows)
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
import { AgentCompiler } from './process/compiler.js'
import { ProcessExecutor } from './process/executor.js'
import { JsonStore } from './store/json-store.js'
import type { PlatformAdapter } from './platform/types.js'
import type { Post, AgentIdentity } from './types.js'
import type { SkillContext } from './skills/types.js'

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

  return new TwitterAdapter(twitter, engagement, twitterScanner)
}

async function initSubstackPlatform(events: EventBus, ctx: SkillContext): Promise<PlatformAdapter> {
  const { SubstackClient } = await import('./platform/substack/client.js')
  const { SubstackEngagement } = await import('./platform/substack/engagement.js')
  const { SubstackScanner } = await import('./platform/substack/scanner/index.js')
  const { SubstackAdapter } = await import('./platform/substack/adapter.js')

  if (!ctx.browser) {
    console.error('Substack agent requires browser automation. Set CDP_URL.')
    process.exit(1)
  }

  const substackHandle = process.env.SUBSTACK_HANDLE ?? 'mysubstack'
  const client = new SubstackClient(events, substackHandle, ctx.browser)
  const engagement = new SubstackEngagement(client, events, ctx.identity)
  const rssFeeds = (process.env.RSS_FEEDS ?? '').split(',').filter(Boolean)
  const substackScanner = new SubstackScanner(rssFeeds)

  return new SubstackAdapter(client, engagement, substackScanner)
}

async function main() {
  // 1. Read the three defining files
  const soulText = readFile('SOUL.md')
  const processText = readFile('PROCESS.md')
  const constitutionText = readFile('constitution.md')

  // 2. Init config
  const config = createConfig()
  await mkdir(config.dataDir, { recursive: true })

  // 3. Init infrastructure
  const db = await createDatabase(join(config.dataDir, 'agent.db'))
  const events = new EventBus(join(config.dataDir, 'events.jsonl'))
  await events.init()

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
  await skills.discover(join(import.meta.dir, 'skills'))

  // 8. Compile agent
  const compiler = new AgentCompiler(config, config.dataDir)
  const compiled = await compiler.compile(soulText, processText, constitutionText, skills.names)
  Object.assign(identity, compiled.identity)
  identity.constitution = constitutionText
  ctx.compiledStyle = compiled.style

  // 9. Init platform
  let platform: PlatformAdapter
  if (config.platform === 'substack') {
    platform = await initSubstackPlatform(events, ctx)
  } else {
    platform = await initTwitterPlatform(config, events, ctx)
  }
  await platform.init(events)
  ctx.platform = platform
  ctx.scannerRegistry.register(platform.getScanner())

  // 10. Init all skills (each creates its own internals from ctx)
  await skills.initAll(ctx)

  console.log(`Agent: ${identity.name} | Platform: ${config.platform}`)
  console.log(`Skills: ${skills.names.join(', ')}`)
  console.log(`Workflows: ${compiled.plan.workflows.map(w => w.name).join(', ')}`)

  // 11. Start
  const executor = new ProcessExecutor(compiled.plan, skills, ctx.state, events, config, identity, compiled.creativeProcess, config.dataDir)
  const loop = new AgentLoop(events, executor, skills, config, identity)

  const app = await createServer({ events, config, db, identity, wallets: { evm: wallet.ethAddress, solana: wallet.solAddress } })
  await app.listen({ port: config.port, host: '0.0.0.0' })
  console.log(`Media agent running on port ${config.port}`)

  loop.start()

  const shutdown = async () => {
    console.log('Shutting down...')
    loop.stop()
    await Promise.all([signalCache.persist(), evalCache.persist(), imageCache.persist()])
    await skills.shutdownAll()
    await app.close()
    db.close()
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
