import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { EventBus } from '../src/console/events.js'
import { SkillRegistry } from '../src/skills/registry.js'
import { createPipelineState } from '../src/process/state.js'
import { ContentSigner } from '../src/crypto/signer.js'
import { buildUpgradeSignatureMessage, verifyUpgradeRequest, type UpgradeEnvelope } from '../src/upgrade/auth.js'
import { removeInstalledSkill, setInstalledSkillEnabled } from '../src/skills/installed.js'

const TEST_MNEMONIC = 'legal winner thank year wave sausage worth useful legal winner thank yellow'
const originalCoordinatorAddress = process.env.COORDINATOR_ADDRESS

afterEach(() => {
  if (originalCoordinatorAddress === undefined) {
    delete process.env.COORDINATOR_ADDRESS
  } else {
    process.env.COORDINATOR_ADDRESS = originalCoordinatorAddress
  }
})

function makeEnvelope(timestamp: string): UpgradeEnvelope {
  return {
    id: crypto.randomUUID(),
    description: 'Install arxiv-skill.',
    summary: 'Install arxiv-skill v1.0.0.',
    proposedBy: '@creator',
    timestamp,
    changes: {
      skillInstall: {
        name: 'arxiv-skill',
        version: '1.0.0',
        bundleHash: 'abc123',
      },
    },
  }
}

async function signEnvelope(payload: UpgradeEnvelope): Promise<{ address: string; signature: string }> {
  const signer = new ContentSigner(TEST_MNEMONIC)
  const signature = await signer.sign(buildUpgradeSignatureMessage(payload))
  process.env.COORDINATOR_ADDRESS = signer.address
  return { address: signer.address, signature }
}

describe('verifyUpgradeRequest', () => {
  it('rejects mismatched request and payload timestamps', async () => {
    const now = Math.floor(Date.now() / 1000)
    const payload = makeEnvelope(String(now))
    const signed = await signEnvelope(payload)

    const response = await verifyUpgradeRequest({
      headers: {
        'x-address': signed.address,
        'x-timestamp': String(now + 30),
        'x-signature': signed.signature,
      },
      payload,
    })

    expect(response).not.toBeNull()
    expect(response?.status).toBe(401)
    expect(await response?.text()).toContain('timestamp')
  })

  it('rejects expired signed payloads', async () => {
    const oldTs = Math.floor(Date.now() / 1000) - 301
    const payload = makeEnvelope(String(oldTs))
    const signed = await signEnvelope(payload)

    const response = await verifyUpgradeRequest({
      headers: {
        'x-address': signed.address,
        'x-timestamp': String(oldTs),
        'x-signature': signed.signature,
      },
      payload,
    })

    expect(response).not.toBeNull()
    expect(response?.status).toBe(401)
    expect(await response?.text()).toContain('expired')
  })
})

describe('installed skill name validation', () => {
  it('rejects traversal-style names for enable/disable and remove', async () => {
    const installedRoot = await mkdtemp(join(tmpdir(), 'media-agent-installed-'))

    await expect(setInstalledSkillEnabled(installedRoot, '../installed-backup/evil-skill', false)).rejects.toThrow()
    await expect(removeInstalledSkill(installedRoot, '../installed-backup/evil-skill')).rejects.toThrow()

    await rm(installedRoot, { recursive: true, force: true })
  })
})

describe('reloadInstalledSkills rollback', () => {
  it('restores the previous runtime when the reload handler fails', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'media-agent-reload-'))
    const builtinRoot = join(tempRoot, 'builtin-skills')
    const installedRoot = join(tempRoot, 'installed-skills')

    await mkdir(installedRoot, { recursive: true })

    const stableSkillDir = join(installedRoot, 'stable-skill')
    await mkdir(join(stableSkillDir, 'dist'), { recursive: true })
    await mkdir(join(stableSkillDir, 'source'), { recursive: true })

    await writeFile(join(stableSkillDir, 'manifest.json'), JSON.stringify({
      apiVersion: 1,
      name: 'stable-skill',
      version: '1.0.0',
      description: 'Stable installed skill',
      entrypoint: 'dist/index.mjs',
      sourceEntrypoint: 'source/index.ts',
      tools: [{ name: 'stable_tool', description: 'Stable tool' }],
      enabled: true,
    }, null, 2))
    await writeFile(join(stableSkillDir, 'source', 'index.ts'), 'export default {}')
    await writeFile(join(stableSkillDir, 'dist', 'index.mjs'), `
export default {
  name: 'stable-skill',
  description: 'Stable installed skill',
  category: 'agent',
  async init() {
    return {
      stable_tool: {
        description: 'Stable tool',
        execute: async () => 'ok',
      },
    }
  },
}
`.trim())

    const events = new EventBus(join(tempRoot, 'events.jsonl'))
    await events.init()

    const registry = new SkillRegistry()
    await registry.discover({ builtinRoot, installedRoot })
    await registry.initAll({
      events,
      identity: {
        name: 'Test Agent',
        tagline: 'Testing',
        creator: '@creator',
        constitution: 'Test constitution',
        persona: 'A test agent.',
        beliefs: [],
        themes: [],
        punchesUp: [],
        respects: [],
        voice: 'plain',
        restrictions: [],
        motto: 'test',
      },
      config: {},
      dataDir: tempRoot,
      db: {},
      wallet: {},
      state: createPipelineState(),
      scannerRegistry: {},
      caches: { eval: {}, image: {}, signal: {} },
    } as any)

    expect('stable_tool' in registry.tools).toBe(true)

    registry.setInstalledSkillsReloadHandler(async () => {
      throw new Error('compile failed')
    })

    await writeFile(join(stableSkillDir, 'manifest.json'), JSON.stringify({
      apiVersion: 1,
      name: 'stable-skill',
      version: '1.0.0',
      description: 'Stable installed skill',
      entrypoint: 'dist/index.mjs',
      sourceEntrypoint: 'source/index.ts',
      tools: [{ name: 'stable_tool', description: 'Stable tool' }],
      enabled: false,
    }, null, 2))

    await expect(registry.reloadInstalledSkills()).rejects.toThrow('compile failed')
    expect('stable_tool' in registry.tools).toBe(true)
    expect(registry.names).toContain('stable-skill')

    await registry.shutdownAll()
    await rm(tempRoot, { recursive: true, force: true })
  })
})
