import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { EventBus } from '../src/console/events.js'
import { createDatabase } from '../src/db/index.js'
import { createServer } from '../src/server/index.js'
import { SkillRegistry } from '../src/skills/registry.js'

describe('server substack publication endpoint', () => {
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

  it('returns the canonical Substack publication URL when available', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'media-agent-substack-url-'))
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
      getSubstackPublicationUrl: async () => 'https://peer.substack.com',
    })

    const response = await app.inject({ method: 'GET', url: '/api/substack/publication' })
    expect(response.statusCode).toBe(200)

    const payload = await response.json()
    expect(payload.platform).toBe('substack')
    expect(payload.url).toBe('https://peer.substack.com')
  })

  it('returns 404 when the agent is not a substack agent', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'media-agent-substack-url-'))
    db = await createDatabase(join(tempRoot, 'agent.db'))

    const events = new EventBus(join(tempRoot, 'events.jsonl'))
    await events.init()

    app = await createServer({
      events,
      config: {
        dataDir: tempRoot,
        skills: { hotReloadEnabled: false },
        platform: 'twitter',
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
    })

    const response = await app.inject({ method: 'GET', url: '/api/substack/publication' })
    expect(response.statusCode).toBe(404)
  })
})
