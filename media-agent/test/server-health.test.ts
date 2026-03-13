import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { EventBus } from '../src/console/events.js'
import { createDatabase } from '../src/db/index.js'
import { createServer } from '../src/server/index.js'
import { SkillRegistry } from '../src/skills/registry.js'

describe('server health endpoint', () => {
  let tempRoot = ''
  let app: Awaited<ReturnType<typeof createServer>> | null = null
  let db: Awaited<ReturnType<typeof createDatabase>> | null = null

  afterEach(async () => {
    await app?.close()
    db?.close()
    if (tempRoot) await rm(tempRoot, { recursive: true, force: true })
    app = null
    db = null
    tempRoot = ''
  })

  it('responds on /health for coordinator and Caddy probes', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'media-agent-health-'))
    db = await createDatabase(join(tempRoot, 'agent.db'))

    const events = new EventBus(join(tempRoot, 'events.jsonl'))
    await events.init()

    app = await createServer({
      events,
      config: {
        dataDir: tempRoot,
        skills: { hotReloadEnabled: false },
        platform: 'substack',
      } as any,
      db,
      identity: {
        name: 'Peer',
        tagline: 'Testing',
        creator: '@creator',
        constitution: 'Test constitution',
        persona: 'Test persona',
        beliefs: [],
        themes: [],
        punchesUp: [],
        respects: [],
        voice: 'plain',
        restrictions: [],
        motto: 'Test motto',
      },
      compiled: {
        version: 1,
        compilerVersion: 3,
        compiledAt: Date.now(),
        sourceHash: 'hash',
        identity: {
          name: 'Peer',
          tagline: 'Testing',
          creator: '@creator',
          persona: 'Test persona',
          beliefs: [],
          themes: [],
          punchesUp: [],
          respects: [],
          voice: 'plain',
          restrictions: [],
          motto: 'Test motto',
        },
        governance: {
          upgradeRules: [],
          financialCommitments: [],
          restrictions: [],
        },
        plan: {
          backgroundTasks: [],
          workflows: [],
        },
        creativeProcess: '## Process\n- Test',
      } as any,
      skills: new SkillRegistry(),
      executor: {} as any,
      wallets: { evm: '0x1234', solana: 'So1anaPub1ic' },
    })

    const response = await app.inject({ method: 'GET', url: '/health' })
    expect(response.statusCode).toBe(200)

    const payload = await response.json()
    expect(payload.status).toBe('ok')
    expect(payload.agent).toBe('Peer')
    expect(payload).not.toHaveProperty('state')
    expect(payload).not.toHaveProperty('uptime')
  })
})
