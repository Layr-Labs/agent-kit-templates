import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { handleProcessUpgrade } from '../src/upgrade/process.js'
import { recordApprovedReceipt } from '../src/upgrade/receipts.js'
import { ContentSigner } from '../src/crypto/signer.js'
import { buildUpgradeSignatureMessage, type UpgradeEnvelope } from '../src/upgrade/auth.js'
import { EventBus } from '../src/console/events.js'

const TEST_MNEMONIC = 'legal winner thank year wave sausage worth useful legal winner thank yellow'
const originalCoordinatorAddress = process.env.COORDINATOR_ADDRESS
const originalCwd = process.cwd()

afterEach(() => {
  process.chdir(originalCwd)
  if (originalCoordinatorAddress === undefined) {
    delete process.env.COORDINATOR_ADDRESS
  } else {
    process.env.COORDINATOR_ADDRESS = originalCoordinatorAddress
  }
})

async function signEnvelope(payload: UpgradeEnvelope): Promise<{ address: string; signature: string }> {
  const signer = new ContentSigner(TEST_MNEMONIC)
  const signature = await signer.sign(buildUpgradeSignatureMessage(payload))
  process.env.COORDINATOR_ADDRESS = signer.address
  return { address: signer.address, signature }
}

const VALID_PROCESS_TOML = `
description = "Test agent"

[[workflows]]
name = "test-workflow"
priority = 5
timerKey = "test"
intervalMs = 3600000
skills = ["scanner"]
instruction = "Scan and report."

[[backgroundTasks]]
name = "scan"
timerKey = "scan"
intervalMs = 1800000
skill = "scanner"
tool = "scan"
`

describe('handleProcessUpgrade', () => {
  let tempRoot: string

  afterEach(async () => {
    if (tempRoot) await rm(tempRoot, { recursive: true, force: true })
  })

  it('rejects when no consent receipt exists', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'media-agent-process-'))

    const now = Math.floor(Date.now() / 1000)
    const envelope: UpgradeEnvelope = {
      id: crypto.randomUUID(),
      description: 'Update process',
      summary: 'Change scanning interval',
      proposedBy: '@creator',
      timestamp: String(now),
      changes: { processUpdate: { summary: 'Update' } },
    }

    const signed = await signEnvelope(envelope)

    const response = await handleProcessUpgrade({
      headers: {
        'x-address': signed.address,
        'x-timestamp': String(now),
        'x-signature': signed.signature,
      },
      body: { ...envelope, processContent: VALID_PROCESS_TOML },
      config: { dataDir: tempRoot, platform: 'substack' } as any,
      registry: { names: [], tools: {}, list: () => [], installedManifests: () => [] } as any,
      executor: { replacePlan: () => {} } as any,
      events: new EventBus(join(tempRoot, 'events.jsonl')),
      identity: {} as any,
    })

    expect(response.status).toBe(409)
    const body = JSON.parse(await response.text())
    expect(body.error).toContain('No approved consent receipt')
  })

  it('rejects invalid payload (missing processContent)', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'media-agent-process-'))

    const response = await handleProcessUpgrade({
      headers: {},
      body: { id: '1', description: 'test', summary: 'test', proposedBy: 'x', timestamp: '1' },
      config: { dataDir: tempRoot } as any,
      registry: {} as any,
      executor: {} as any,
      events: new EventBus(join(tempRoot, 'events.jsonl')),
      identity: {} as any,
    })

    expect(response.status).toBe(400)
    const body = JSON.parse(await response.text())
    expect(body.error).toContain('Invalid process upgrade payload')
  })

  it('rolls back PROCESS.toml on compile failure', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'media-agent-process-'))
    process.chdir(tempRoot)

    const originalToml = `
description = "Original"

[[workflows]]
name = "original"
priority = 5
timerKey = "original"
intervalMs = 3600000
skills = ["scanner"]
instruction = "Do original stuff."
`
    await writeFile(join(tempRoot, 'SOUL.md'), '## Name\nTest')
    await writeFile(join(tempRoot, 'PROCESS.toml'), originalToml)
    await writeFile(join(tempRoot, 'constitution.md'), '## Restrictions\nNone')

    const now = Math.floor(Date.now() / 1000)
    const envelope: UpgradeEnvelope = {
      id: crypto.randomUUID(),
      description: 'Bad update',
      summary: 'This will fail to compile',
      proposedBy: '@creator',
      timestamp: String(now),
      changes: {},
    }

    const signed = await signEnvelope(envelope)
    await recordApprovedReceipt(tempRoot, envelope)

    const response = await handleProcessUpgrade({
      headers: {
        'x-address': signed.address,
        'x-timestamp': String(now),
        'x-signature': signed.signature,
      },
      body: { ...envelope, processContent: VALID_PROCESS_TOML },
      config: { dataDir: tempRoot, platform: 'substack', modelId: () => 'test', model: () => 'test' } as any,
      registry: { names: [], tools: {}, list: () => [], installedManifests: () => [] } as any,
      executor: { replacePlan: () => {} } as any,
      events: new EventBus(join(tempRoot, 'events.jsonl')),
      identity: {} as any,
    })

    // Compile will fail without LLM — PROCESS.toml should be rolled back
    expect(response.status).toBe(400)
    const rolledBack = readFileSync(join(tempRoot, 'PROCESS.toml'), 'utf-8')
    expect(rolledBack).toBe(originalToml)
  })

  it('rejects malformed TOML content', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'media-agent-process-'))
    process.chdir(tempRoot)

    await writeFile(join(tempRoot, 'SOUL.md'), '## Name\nTest')
    await writeFile(join(tempRoot, 'PROCESS.toml'), 'description = "Original"')
    await writeFile(join(tempRoot, 'constitution.md'), '## Restrictions\nNone')

    const now = Math.floor(Date.now() / 1000)
    const envelope: UpgradeEnvelope = {
      id: crypto.randomUUID(),
      description: 'Bad TOML',
      summary: 'Malformed TOML',
      proposedBy: '@creator',
      timestamp: String(now),
      changes: {},
    }

    const signed = await signEnvelope(envelope)
    await recordApprovedReceipt(tempRoot, envelope)

    const response = await handleProcessUpgrade({
      headers: {
        'x-address': signed.address,
        'x-timestamp': String(now),
        'x-signature': signed.signature,
      },
      // Send invalid TOML — missing required workflow fields
      body: { ...envelope, processContent: '[[workflows]]\nname = "broken"' },
      config: { dataDir: tempRoot, platform: 'substack' } as any,
      registry: { names: [], tools: {}, list: () => [], installedManifests: () => [] } as any,
      executor: { replacePlan: () => {} } as any,
      events: new EventBus(join(tempRoot, 'events.jsonl')),
      identity: {} as any,
    })

    expect(response.status).toBe(400)
    // Original TOML should be restored
    const content = readFileSync(join(tempRoot, 'PROCESS.toml'), 'utf-8')
    expect(content).toBe('description = "Original"')
  })
})
