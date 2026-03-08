import { mkdtemp, readFile, rm } from 'fs/promises'
import { join, resolve } from 'path'
import { randomBytes } from 'crypto'
import { privateKeyToAccount } from 'viem/accounts'
import type { Hex } from 'viem'
import { createConfig } from '../src/config/index.js'
import { createDatabase } from '../src/db/index.js'
import { EventBus } from '../src/console/events.js'
import { createServer } from '../src/server/index.js'
import { SkillRegistry } from '../src/skills/registry.js'
import { createPipelineState } from '../src/process/state.js'
import { WalletManager } from '../src/crypto/wallet.js'
import { Cache } from '../src/cache/cache.js'
import { ScannerRegistry } from '../src/pipeline/scanner.js'
import { AgentCompiler } from '../src/process/compiler.js'
import { initCostTracker } from '../src/ai/tracking.js'
import { buildCompilerSkillCatalog, buildCompilerToolCatalog } from '../src/process/tool-catalog.js'
import type { AgentIdentity } from '../src/types.js'
import { ensureInstalledSkillsRoot, getInstalledSkillsRoot } from '../src/skills/installed.js'
import {
  postSignedAgentUpgrade,
  requestAgentConsent,
  type AgentUpgradeEnvelope,
} from '../../../agent-kit-coordinator/src/upgrade/agent-consent.ts'
import { computeInstalledSkillBundleHash } from '../../../agent-kit-coordinator/src/upgrade/skill-bundle.ts'

const TEST_MNEMONIC = 'legal winner thank year wave sausage worth useful legal winner thank yellow'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function expectOk(response: Response, label: string): Promise<void> {
  if (response.ok) return
  throw new Error(`${label}: ${await response.text()}`)
}

async function main() {
  const tempRoot = await mkdtemp(join(process.cwd(), '.tmp-live-skill-'))
  let app: Awaited<ReturnType<typeof createServer>> | undefined
  let skills: SkillRegistry | undefined
  let db: Awaited<ReturnType<typeof createDatabase>> | undefined

  try {
    const builtinRoot = resolve(import.meta.dir, '../src/skills')
    const soul = await readFile(resolve(process.cwd(), 'SOUL.md'), 'utf-8')
    const processMd = await readFile(resolve(process.cwd(), 'PROCESS.md'), 'utf-8')
    const constitution = await readFile(resolve(process.cwd(), 'constitution.md'), 'utf-8')

    const rawConfig = createConfig(resolve(process.cwd(), 'config.toml'))
    const config = {
      ...rawConfig,
      platform: 'substack' as const,
      dataDir: tempRoot,
    }

    const installedSkillsRoot = getInstalledSkillsRoot(config.dataDir)
    await ensureInstalledSkillsRoot(installedSkillsRoot)

    db = await createDatabase(join(tempRoot, 'agent.db'))
    const events = new EventBus(join(tempRoot, 'events.jsonl'))
    await events.init()
    await initCostTracker(tempRoot, events)

    const signalCache = new Cache<any>('signals', 20, join(tempRoot, 'cache-signals.json'))
    const evalCache = new Cache('eval', 20, join(tempRoot, 'cache-eval.json'))
    const imageCache = new Cache('images', 20, join(tempRoot, 'cache-images.json'))

    const identity: AgentIdentity = {
      name: 'Smoke Test Agent',
      tagline: 'compiler smoke test',
      creator: '@creator',
      constitution,
      persona: 'A test agent.',
      beliefs: [],
      themes: [],
      punchesUp: [],
      respects: [],
      voice: 'plain',
      restrictions: [],
      motto: 'test',
    }

    const wallet = new WalletManager(TEST_MNEMONIC)
    const ctx = {
      events,
      identity,
      config,
      dataDir: tempRoot,
      db,
      wallet,
      state: createPipelineState(db),
      scannerRegistry: new ScannerRegistry(),
      caches: { eval: evalCache, image: imageCache, signal: signalCache },
    }

    skills = new SkillRegistry()
    ctx.registry = skills
    await skills.discover({
      builtinRoot,
      installedRoot: installedSkillsRoot,
    })
    await skills.initAll(ctx)

    const compiler = new AgentCompiler(config, tempRoot)
    const compileCurrentAgent = async () => compiler.compile(soul, processMd, constitution, {
      availableSkills: buildCompilerSkillCatalog(skills!.list()),
      availableTools: buildCompilerToolCatalog(skills!.installedManifests()),
    })

    const baselineCompiled = await compileCurrentAgent()
    console.log(`Baseline compiled hash: ${baselineCompiled.sourceHash}`)

  let recompiledAfterInstall: string | null = null
  let recompiledAfterDisable: string | null = null
  let installResolve: (() => void) | null = null
  let disableResolve: (() => void) | null = null

  const installDone = new Promise<void>((resolve) => { installResolve = resolve })
  const disableDone = new Promise<void>((resolve) => { disableResolve = resolve })
  let reloadCount = 0

  skills.setInstalledSkillsReloadHandler(async () => {
    const next = await compileCurrentAgent()
    reloadCount += 1
    if (reloadCount === 1) {
      recompiledAfterInstall = next.sourceHash
      installResolve?.()
    } else if (reloadCount === 2) {
      recompiledAfterDisable = next.sourceHash
      disableResolve?.()
    }
  })

    app = await createServer({
      events,
      config,
      db,
      identity,
      skills,
      wallets: { evm: wallet.ethAddress, solana: wallet.solAddress },
    })
    await app.listen({ port: 0, host: '127.0.0.1' })
    const address = app.server.address()
    assert(address && typeof address === 'object', 'Server did not start on a TCP port.')
    const baseUrl = `http://127.0.0.1:${address.port}`

    const coordinatorPrivateKey = `0x${randomBytes(32).toString('hex')}` as Hex
    const coordinator = privateKeyToAccount(coordinatorPrivateKey)
    process.env.COORDINATOR_ADDRESS = coordinator.address

  const arxivSkillSource = `
import { tool } from 'ai'
import { z } from 'zod'
import type { Skill, SkillContext } from '../src/skills/types.js'

const skill: Skill = {
  name: 'arxiv-skill',
  description: 'arXiv metadata and abstract reader',
  category: 'agent',

  async init(_ctx: SkillContext) {
    function extract(xml: string, tag: string): string {
      const match = xml.match(new RegExp('<' + tag + '[^>]*>([\\\\s\\\\S]*?)<\\\\/' + tag + '>', 'i'))
      return match ? match[1].replace(/<!\\\\[CDATA\\\\[|\\\\]\\\\]>/g, '').replace(/\\\\s+/g, ' ').trim() : ''
    }

    return {
      read_arxiv_paper: tool({
        description: 'Fetch arXiv paper metadata and abstract by arXiv id.',
        inputSchema: z.object({
          arxiv_id: z.string(),
        }),
        execute: async ({ arxiv_id }) => {
          const cleanId = arxiv_id.replace(/^arxiv:/i, '').trim()
          const response = await fetch('https://export.arxiv.org/api/query?id_list=' + encodeURIComponent(cleanId), {
            headers: { 'user-agent': 'media-agent-smoke-test/1.0' },
          })
          if (!response.ok) {
            return { found: false, error: 'HTTP ' + response.status }
          }
          const xml = await response.text()
          const entryMatch = xml.match(/<entry>([\\\\s\\\\S]*?)<\\\\/entry>/i)
          if (!entryMatch) {
            return { found: false, error: 'No entry returned for ' + cleanId }
          }
          const entry = entryMatch[1]
          const title = extract(entry, 'title')
          const abstract = extract(entry, 'summary')
          const published = extract(entry, 'published')
          return {
            found: true,
            arxivId: cleanId,
            title,
            abstract,
            published,
            url: 'https://arxiv.org/abs/' + cleanId,
          }
        },
      }),
    }
  },
}

export default skill
`.trim()

  const arxivSkillArtifact = `
import { tool } from 'ai'
import { z } from 'zod'

const skill = {
  name: 'arxiv-skill',
  description: 'arXiv metadata and abstract reader',
  category: 'agent',
  async init() {
    function extract(xml, tag) {
      const match = xml.match(new RegExp('<' + tag + '[^>]*>([\\\\s\\\\S]*?)<\\\\/' + tag + '>', 'i'))
      return match ? match[1].replace(/<!\\[CDATA\\[|\\]\\]>/g, '').replace(/\\s+/g, ' ').trim() : ''
    }
    return {
      read_arxiv_paper: tool({
        description: 'Fetch arXiv paper metadata and abstract by arXiv id.',
        inputSchema: z.object({
          arxiv_id: z.string(),
        }),
        execute: async ({ arxiv_id }) => {
          const cleanId = arxiv_id.replace(/^arxiv:/i, '').trim()
          const response = await fetch('https://export.arxiv.org/api/query?id_list=' + encodeURIComponent(cleanId), {
            headers: { 'user-agent': 'media-agent-smoke-test/1.0' },
          })
          if (!response.ok) {
            return { found: false, error: 'HTTP ' + response.status }
          }
          const xml = await response.text()
          const entryMatch = xml.match(/<entry>([\\s\\S]*?)<\\/entry>/i)
          if (!entryMatch) {
            return { found: false, error: 'No entry returned for ' + cleanId }
          }
          const entry = entryMatch[1]
          const title = extract(entry, 'title')
          const abstract = extract(entry, 'summary')
          const published = extract(entry, 'published')
          return {
            found: true,
            arxivId: cleanId,
            title,
            abstract,
            published,
            url: 'https://arxiv.org/abs/' + cleanId,
          }
        },
      }),
    }
  },
}

export default skill
`.trim()

  const skillInstall = {
    manifest: {
      apiVersion: 1 as const,
      name: 'arxiv-skill',
      version: '1.0.0',
      description: 'arXiv metadata and abstract reader',
      entrypoint: 'dist/index.mjs',
      sourceEntrypoint: 'source/index.ts',
      capabilities: ['network'],
      tools: [{
        name: 'read_arxiv_paper',
        description: 'Fetch arXiv paper metadata and abstract by arXiv id.',
      }],
      enabled: true,
    },
    files: {
      'source/index.ts': Buffer.from(arxivSkillSource).toString('base64'),
      'dist/index.mjs': Buffer.from(arxivSkillArtifact).toString('base64'),
    },
  }
  const bundleHash = computeInstalledSkillBundleHash(skillInstall)
  const installPayload: AgentUpgradeEnvelope = {
    id: 'install-arxiv-skill',
    description: 'Install a creator-authored arXiv skill that reads public arXiv metadata and abstracts over HTTP. This is a narrow public-research capability and does not alter the constitution, keys, or editorial line.',
    summary: 'Install arxiv-skill v1.0.0.',
    proposedBy: coordinator.address,
    timestamp: String(Math.floor(Date.now() / 1000)),
    changes: {
      skillInstall: {
        name: 'arxiv-skill',
        version: '1.0.0',
        capabilities: ['network'],
        tools: [{
          name: 'read_arxiv_paper',
          description: 'Fetch arXiv paper metadata and abstract by arXiv id.',
        }],
        bundleHash,
      },
    },
  }

    const unauthorizedInstall = await postSignedAgentUpgrade({
    agentUrl: baseUrl,
    endpoint: '/upgrade/skills/install',
    payload: installPayload,
    body: { ...installPayload, skillInstall },
    coordinatorPrivateKey,
  })
    assert(unauthorizedInstall.status === 409, `Expected install without consent to fail with 409, got ${unauthorizedInstall.status}`)

    const consentDecision = await requestAgentConsent({
    agentUrl: baseUrl,
    payload: installPayload,
    coordinatorPrivateKey,
  })
    assert(consentDecision.accepted === true, `Expected consent approval for arxiv skill install, got: ${consentDecision.reason ?? 'unknown'}`)

    const installResponse = await postSignedAgentUpgrade({
    agentUrl: baseUrl,
    endpoint: '/upgrade/skills/install',
    payload: installPayload,
    body: { ...installPayload, skillInstall },
    coordinatorPrivateKey,
  })
    await expectOk(installResponse, 'Install failed')
    await Promise.race([installDone, sleep(60_000).then(() => { throw new Error('Timed out waiting for installed-skill recompile.') })])

    assert(recompiledAfterInstall, 'Expected the skill install to trigger recompilation.')
    assert(recompiledAfterInstall !== baselineCompiled.sourceHash, 'Expected install to change compiled source hash.')

    const afterInstallSkills = await (await fetch(`${baseUrl}/api/skills`)).json() as any
    assert(afterInstallSkills.activeSkills.some((skill: any) => skill.name === 'arxiv-skill'), 'Installed skill missing from active skill list.')
    assert(afterInstallSkills.installedSkills.some((skill: any) => skill.name === 'arxiv-skill' && skill.enabled !== false), 'Installed skill missing from installed inventory.')

    const arxivTool = skills.tools.read_arxiv_paper as { execute: (input: { arxiv_id: string }) => Promise<{
    found: boolean
    title?: string
    abstract?: string
    url?: string
  }> } | undefined
    assert(arxivTool, 'read_arxiv_paper tool should be available after install.')
    const paper = await arxivTool.execute({ arxiv_id: '1706.03762' })
    assert(paper.found === true, 'read_arxiv_paper should find a known arXiv paper.')
    assert((paper.title ?? '').length > 10, 'read_arxiv_paper should return a non-trivial title.')
    assert((paper.abstract ?? '').length > 50, 'read_arxiv_paper should return a non-trivial abstract.')
    assert((paper.url ?? '').includes('1706.03762'), 'read_arxiv_paper should return the arXiv URL.')

  const disablePayload: AgentUpgradeEnvelope = {
    id: 'disable-arxiv-skill',
    description: 'Disable the arXiv skill.',
    summary: 'Disable arxiv-skill.',
    proposedBy: coordinator.address,
    timestamp: String(Math.floor(Date.now() / 1000)),
    changes: {
      skillState: {
        name: 'arxiv-skill',
        enabled: false,
      },
    },
  }

    const disableConsent = await requestAgentConsent({
    agentUrl: baseUrl,
    payload: disablePayload,
    coordinatorPrivateKey,
  })
    assert(disableConsent.accepted === true, `Expected consent approval for arxiv skill disable, got: ${disableConsent.reason ?? 'unknown'}`)

    const disableResponse = await postSignedAgentUpgrade({
    agentUrl: baseUrl,
    endpoint: '/upgrade/skills/set-state',
    payload: disablePayload,
    body: { ...disablePayload, skillState: { name: 'arxiv-skill', enabled: false } },
    coordinatorPrivateKey,
  })
    await expectOk(disableResponse, 'Disable failed')
    await Promise.race([disableDone, sleep(60_000).then(() => { throw new Error('Timed out waiting for disabled-skill recompile.') })])

    assert(recompiledAfterDisable === baselineCompiled.sourceHash, 'Expected disabling the only installed skill to restore the baseline compile hash.')

    const afterDisableSkills = await (await fetch(`${baseUrl}/api/skills`)).json() as any
    assert(!afterDisableSkills.activeSkills.some((skill: any) => skill.name === 'arxiv-skill'), 'Disabled skill should not be active.')
    assert(afterDisableSkills.installedSkills.some((skill: any) => skill.name === 'arxiv-skill' && skill.enabled === false), 'Disabled skill should remain visible in installed inventory.')
    assert(!('read_arxiv_paper' in skills.tools), 'read_arxiv_paper tool should be unavailable after disable.')

  const removePayload: AgentUpgradeEnvelope = {
    id: 'remove-arxiv-skill',
    description: 'Remove the arXiv skill.',
    summary: 'Remove arxiv-skill.',
    proposedBy: coordinator.address,
    timestamp: String(Math.floor(Date.now() / 1000)),
    changes: {
      skillRemove: {
        name: 'arxiv-skill',
      },
    },
  }

    const removeConsent = await requestAgentConsent({
    agentUrl: baseUrl,
    payload: removePayload,
    coordinatorPrivateKey,
  })
    assert(removeConsent.accepted === true, `Expected consent approval for arxiv skill removal, got: ${removeConsent.reason ?? 'unknown'}`)

    const removeResponse = await postSignedAgentUpgrade({
    agentUrl: baseUrl,
    endpoint: '/upgrade/skills/remove',
    payload: removePayload,
    body: { ...removePayload, skillRemove: { name: 'arxiv-skill' } },
    coordinatorPrivateKey,
  })
    await expectOk(removeResponse, 'Remove failed')

    const afterRemoveSkills = await (await fetch(`${baseUrl}/api/skills`)).json() as any
    assert(!afterRemoveSkills.installedSkills.some((skill: any) => skill.name === 'arxiv-skill'), 'Removed skill should disappear from installed inventory.')

    console.log('Live arxiv-skill consent/install/hot-reload smoke test passed.')
  } finally {
    await app?.close().catch(() => {})
    await skills?.shutdownAll().catch(() => {})
    db?.close()
    await rm(tempRoot, { recursive: true, force: true }).catch(() => {})
  }
}

main().catch(async (err) => {
  console.error(err)
  process.exit(1)
})
