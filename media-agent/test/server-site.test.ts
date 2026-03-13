import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { EventBus } from '../src/console/events.js'
import { createDatabase } from '../src/db/index.js'
import { createServer } from '../src/server/index.js'
import { SkillRegistry } from '../src/skills/registry.js'
import { initCostTracker } from '../src/ai/tracking.js'

describe('agent site server', () => {
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

  it('returns a public-safe site bootstrap payload', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'media-agent-site-'))
    db = await createDatabase(join(tempRoot, 'agent.db'))

    db.run(
      `INSERT INTO posts (id, platform_id, content_id, text, summary, image_url, article_url, type, signature, signer_address, posted_at, likes, shares, comments, views, engagement_checked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'post-1',
        'platform-1',
        'content-1',
        'The agent published a new deep dive on transformer telescopes.',
        'A guided breakdown of the paper, what it actually proves, and where the uncertainty still sits.',
        join(tempRoot, 'images', 'header.png'),
        'https://example.com/deep-dive',
        'article',
        '0xsig',
        '0xaddr',
        Date.now() - 5_000,
        12,
        4,
        3,
        120,
        Date.now() - 1_000,
      ],
    )

    const events = new EventBus(join(tempRoot, 'events.jsonl'))
    await events.init()
    await initCostTracker(tempRoot, events)
    events.transition('writing')
    events.monologue('Staying with the limitations section before publishing.')

    const identity = {
      name: 'Peer',
      tagline: 'I read the actual paper. Then I tell you what it really says.',
      creator: '@creator',
      born: 'Somewhere on the internet',
      bio: 'A public-facing science agent.',
      constitution: '## Sovereignty\nPeer owns its own keys.',
      persona: 'Warm, specific, skeptical of hype.',
      beliefs: ['Curiosity is a practice.'],
      themes: ['Machine learning', 'Astrophysics'],
      punchesUp: ['Hype cycles'],
      respects: ['Researchers who show their work'],
      voice: 'Warm, plain, specific.',
      restrictions: ['Never expose private keys.'],
      motto: 'Read the paper. Then tell everyone.',
    }

    const compiled = {
      version: 1,
      compilerVersion: 3,
      compiledAt: Date.now() - 10_000,
      sourceHash: 'abc123def456',
      identity: {
        name: identity.name,
        tagline: identity.tagline,
        creator: identity.creator,
        born: identity.born,
        bio: identity.bio,
        persona: identity.persona,
        beliefs: identity.beliefs,
        themes: identity.themes,
        punchesUp: identity.punchesUp,
        respects: identity.respects,
        voice: identity.voice,
        restrictions: identity.restrictions,
        motto: identity.motto,
      },
      style: {
        name: 'Notebook Cosmos',
        description: 'Warm scientific notebook energy.',
        visualIdentity: 'Deep-space tones with diagrammatic structure.',
        compositionPrinciples: 'Single-scene editorial compositions.',
        renderingRules: 'No text in generated imagery.',
      },
      engagement: {
        voiceDescription: 'Explain complex things plainly.',
        rules: ['Answer real questions fully.'],
      },
      governance: {
        upgradeRules: ['Creator proposals require agent consent.'],
        financialCommitments: ['15% creator dividend.'],
        restrictions: ['Never expose private keys.'],
      },
      plan: {
        backgroundTasks: [],
        workflows: [],
      },
      creativeProcess: '## Deep Dive\n1. Read the paper\n2. Explain it plainly',
    }

    const skills = new SkillRegistry()
    app = await createServer({
      events,
      config: {
        dataDir: tempRoot,
        skills: { hotReloadEnabled: true },
        platform: 'substack',
      } as any,
      db,
      identity,
      compiled: compiled as any,
      skills,
      executor: {} as any,
      wallets: { evm: '0x1234', solana: 'So1anaPub1ic' },
    })

    const response = await app.inject({ method: 'GET', url: '/api/site/bootstrap' })
    expect(response.statusCode).toBe(200)

    const payload = await response.json()
    expect(payload.identity.name).toBe('Peer')
    expect(payload.copy.tabs.map((tab: { id: string }) => tab.id)).toEqual(['editorial', 'live', 'worldview', 'about'])
    expect(payload.worldview.themes).toEqual(['Machine learning', 'Astrophysics'])
    expect(payload.processPlan.workflows).toEqual([])
    expect(payload.editorial.posts[0].summary).toContain('guided breakdown')
    expect(payload.transparency.wallets.evm).toBe('0x1234')
    expect(payload.transparency.skills.active).toEqual([])
    expect(payload.editorial.total).toBe(1)
    expect(payload.editorial.posts[0].imageUrl).toBe('/images/header.png')
    expect(JSON.stringify(payload)).not.toContain('MNEMONIC')
    expect(payload.transparency.wallets).not.toHaveProperty('mnemonic')
    expect(payload.transparency.wallets).not.toHaveProperty('privateKey')
  })

  it('serves the built site index at the root route', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'media-agent-root-'))
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

    const response = await app.inject({ method: 'GET', url: '/' })
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('text/html')
    expect(response.body).toContain('<div id="root">')
  })

})
