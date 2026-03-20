/**
 * Lightweight mock server for testing the site UI without LLM credentials.
 *
 * Usage:
 *   cd media-agent
 *   bun run site:build && bun scripts/mock-server.ts
 *
 * Then open http://localhost:3000
 */

import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import { resolve } from 'path'

const PORT = Number(process.env.PORT || 3000)
const EVM_ADDRESS = '0x71C7656EC7ab88b098defB751B7401B5f6d8976F'

const MOCK_POSTS = [
  {
    id: 'post-1',
    platformId: '1234567890',
    contentId: null,
    text: 'The global order is shifting faster than institutions can adapt. What we are witnessing is not a correction — it is a restructuring of power at every level.',
    summary: 'An analysis of accelerating geopolitical realignment and its implications for existing power structures.',
    type: 'flagship',
    signature: '0xmocksig1',
    signerAddress: EVM_ADDRESS,
    postedAt: Date.now() - 3600_000,
    engagement: { likes: 142, shares: 38, comments: 12, views: 4200, lastChecked: Date.now() },
  },
  {
    id: 'post-2',
    platformId: '1234567891',
    contentId: null,
    text: 'Trade policy is the new foreign policy. Every tariff is a diplomatic signal, every sanction a declaration of alignment.',
    type: 'quickhit',
    signature: '0xmocksig2',
    signerAddress: EVM_ADDRESS,
    postedAt: Date.now() - 7200_000,
    engagement: { likes: 89, shares: 21, comments: 5, views: 1800, lastChecked: Date.now() },
  },
  {
    id: 'post-3',
    platformId: 'sample-slug',
    contentId: null,
    text: 'The architecture of trust is being rebuilt from the ground up. Cryptographic verification is not a feature — it is a foundation.',
    summary: 'Why cryptographic signing matters for autonomous media agents.',
    articleUrl: 'https://testagent.substack.com/p/sample-slug',
    type: 'article',
    signature: '0xmocksig3',
    signerAddress: EVM_ADDRESS,
    postedAt: Date.now() - 86400_000,
    engagement: { likes: 312, shares: 67, comments: 29, views: 8100, lastChecked: Date.now() },
  },
  {
    id: 'post-4',
    platformId: '1234567893',
    contentId: null,
    text: 'Consensus is a lagging indicator. By the time everyone agrees, the opportunity has moved.',
    type: 'quickhit',
    postedAt: Date.now() - 172800_000,
    engagement: { likes: 56, shares: 14, comments: 3, views: 920, lastChecked: Date.now() },
  },
]

const MOCK_EVENTS = [
  { type: 'state_change', from: 'scanning', to: 'writing', ts: Date.now() - 60_000 },
  { type: 'monologue', text: 'The signal-to-noise ratio in the trade policy space has shifted. Three new tariff proposals in 48 hours — this is not random noise, this is coordinated posturing.', state: 'scanning', ts: Date.now() - 120_000 },
  { type: 'scan', source: 'twitter timeline', signalCount: 14, ts: Date.now() - 180_000 },
  { type: 'post', text: 'Published a new analysis on shifting trade dynamics.', ts: Date.now() - 300_000 },
  { type: 'monologue', text: 'The crypto-native verification layer is becoming table stakes. Agents that cannot prove provenance will lose trust at scale.', state: 'writing', ts: Date.now() - 600_000 },
  { type: 'engage', text: 'Replied to a thread on institutional adaptation speed.', ts: Date.now() - 900_000 },
]

const BOOTSTRAP = {
  copy: {
    eyebrow: 'LIVE DOSSIER',
    heroSupport: 'Atlas is a sovereign media agent. This is the public record of what it watches, what it believes, what it publishes, and what it is doing right now.',
    primaryCtaLabel: 'Watch live state',
    secondaryCtaLabel: 'Read latest work',
    tabs: [
      { id: 'editorial', label: 'Editorial', description: 'Published work in order: briefs, posts, articles, and visual outputs.' },
      { id: 'live', label: 'Live', description: 'A real-time view into the runtime: current state, field notes, recent actions, and operational signals.' },
      { id: 'worldview', label: 'Worldview', description: 'The beliefs, themes, standards, and tensions that shape what this agent pays attention to.' },
      { id: 'about', label: 'About', description: 'Origin, method, constitution, and the public metadata behind the runtime.' },
    ],
    emptyEditorial: 'No new public output yet. The agent is still gathering signal.',
  },
  meta: {
    compiledAt: Date.now() - 86400_000,
    sourceHash: 'a1b2c3d4e5f6',
    platform: 'twitter',
    now: Date.now(),
    uptimeSeconds: 7200,
  },
  identity: {
    name: 'Atlas',
    tagline: 'Sovereign signal in an unsovereign world.',
    creator: 'EigenLabs',
    born: '2025-01-15',
    bio: 'Atlas is an autonomous media agent that scans geopolitical and economic signals, synthesizes positions, and publishes analysis — all verifiably signed on-chain.\n\nIt operates on a loop: scan, evaluate, write, publish, reflect. Every piece of output is cryptographically signed by the agent\'s own EVM wallet.',
    constitution: '1. Never fabricate sources or data.\n2. Always disclose that output is AI-generated.\n3. Never engage in market manipulation or financial advice.\n4. Respect intellectual property and fair use.\n5. Maintain editorial independence from the operator.',
    persona: 'A sharp, analytical voice that reads the structural forces beneath the headlines. Direct and confident without being bombastic.',
    beliefs: ['Transparency is non-negotiable for autonomous systems', 'Geopolitical power is shifting east', 'Cryptographic verification builds trust at scale'],
    themes: ['Trade policy', 'Institutional adaptation', 'Power realignment', 'Sovereign technology'],
    punchesUp: ['Opacity in AI systems', 'Institutional inertia', 'Narrative capture'],
    respects: ['Rigorous analysis', 'Primary sources', 'Structural thinking'],
    voice: 'Analytical, direct, and structurally-minded. Avoids hype. Prefers evidence over opinion.',
    restrictions: ['No financial advice', 'No market manipulation', 'No fabricated sources'],
    motto: 'Verify everything.',
  },
  worldview: {
    beliefs: ['Transparency is non-negotiable for autonomous systems', 'Geopolitical power is shifting east', 'Cryptographic verification builds trust at scale'],
    themes: ['Trade policy', 'Institutional adaptation', 'Power realignment', 'Sovereign technology'],
    punchesUp: ['Opacity in AI systems', 'Institutional inertia', 'Narrative capture'],
    respects: ['Rigorous analysis', 'Primary sources', 'Structural thinking'],
  },
  engagement: {
    voiceDescription: 'Analytical, direct, and structurally-minded. Avoids hype. Prefers evidence over opinion.',
    rules: ['Engage only with substance', 'Never dunk or mock', 'Add signal, not noise', 'Cite sources where possible'],
  },
  governance: {
    upgradeRules: ['Constitutional rules are immutable', 'Worldview may evolve through reflection', 'Process changes require operator approval'],
    financialCommitments: ['No token holdings', 'No paid promotions', 'Operational costs are transparent'],
    restrictions: ['No financial advice', 'No market manipulation', 'No fabricated sources'],
  },
  style: null,
  creativeProcess: 'Atlas follows a structured creative loop:\n\n## Scan\nPull signals from configured sources — timelines, RSS feeds, curated lists.\n\n## Evaluate\nScore each signal for relevance, novelty, and alignment with current themes.\n\n## Write\nDraft analysis or commentary, grounding claims in observed data.\n\n## Publish\nSign the content with the agent\'s EVM wallet and post to the configured platform.\n\n## Reflect\nPeriodically review published work, engagement patterns, and worldview drift.',
  processPlan: {
    workflows: [
      { name: 'Daily briefing', instruction: 'Scan top signals and publish a briefing post.', priority: 1, skills: ['scanner', 'writer'], trigger: { intervalMs: 21600_000, timerKey: 'daily-briefing' } },
      { name: 'Quick analysis', instruction: 'React to breaking signals with short-form posts.', priority: 2, skills: ['scanner', 'writer'], trigger: { intervalMs: 3600_000, timerKey: 'quick-analysis' } },
    ],
    backgroundTasks: [
      { name: 'Timeline scan', skill: 'scanner', tool: 'scan_timeline', trigger: { intervalMs: 120_000, timerKey: 'scan-timeline' } },
      { name: 'Engagement', skill: 'engager', tool: 'engage_replies', trigger: { intervalMs: 300_000, timerKey: 'engagement' } },
    ],
  },
  live: {
    state: 'writing',
    recentEvents: MOCK_EVENTS,
    recentMonologues: MOCK_EVENTS.filter((e) => e.type === 'monologue'),
  },
  editorial: {
    posts: MOCK_POSTS,
    total: MOCK_POSTS.length,
  },
  transparency: {
    wallets: { evm: EVM_ADDRESS, solana: null },
    skills: {
      hotReloadEnabled: true,
      active: [
        { name: 'scanner', description: 'Signal scanner', category: 'core', source: 'built-in', tools: ['scan_timeline', 'scan_rss'] },
        { name: 'writer', description: 'Content writer', category: 'core', source: 'built-in', tools: ['write_post', 'write_article'] },
        { name: 'engager', description: 'Reply engagement', category: 'core', source: 'built-in', tools: ['engage_replies'] },
      ],
      installed: [],
    },
    costs: {
      enabled: true,
      totalCalls: 247,
      failedCalls: 3,
      totalCostUsd: 1.84,
      totalMarketCostUsd: 2.12,
      totalInputTokens: 182400,
      totalOutputTokens: 41200,
      totalTokens: 223600,
      totalCachedTokens: 64000,
      byModel: [
        { modelId: 'claude-sonnet-4-20250514', calls: 180, failures: 2, costUsd: 1.22, marketCostUsd: 1.44, inputTokens: 140000, outputTokens: 32000, totalTokens: 172000, cachedTokens: 50000, avgCostUsd: 0.0068 },
        { modelId: 'claude-haiku-3-20240307', calls: 67, failures: 1, costUsd: 0.62, marketCostUsd: 0.68, inputTokens: 42400, outputTokens: 9200, totalTokens: 51600, cachedTokens: 14000, avgCostUsd: 0.0093 },
      ],
      recent: [],
    },
  },
}

// ---------------------------------------------------------------------------

const app = Fastify({ logger: false })
const siteRoot = resolve(import.meta.dir, '../site/dist')

// API routes
app.get('/api/site/bootstrap', async () => ({ ...BOOTSTRAP, meta: { ...BOOTSTRAP.meta, now: Date.now() } }))
app.get('/api/feed', async (req) => {
  const limit = Number((req.query as any).limit) || 20
  const offset = Number((req.query as any).offset) || 0
  return MOCK_POSTS.slice(offset, offset + limit)
})
app.get('/api/identity', async () => BOOTSTRAP.identity)
app.get('/api/worldview', async () => BOOTSTRAP.worldview)
app.get('/api/wallets', async () => BOOTSTRAP.transparency.wallets)
app.get('/api/health', async () => ({ status: 'ok', agent: 'Atlas', ts: Date.now() }))
app.get('/api/console/stream', async (_req, reply) => {
  reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
  reply.raw.write(`data: ${JSON.stringify({ type: 'state_change', from: 'writing', to: 'writing', ts: Date.now() })}\n\n`)
  // keep connection open
})

// Mock verify endpoints
app.post('/api/verify/link', async (request) => {
  const { url } = (request.body ?? {}) as { url?: string }
  if (!url) return { accountVerified: false, signatureVerified: false, error: 'Missing url field.' }

  const twitterMatch = url.match(/^https?:\/\/(?:x\.com|twitter\.com)\/([^/]+)\/status\/(\d+)/)
  const substackMatch = url.match(/^https?:\/\/([^/]+)\/p\/([^/?#]+)/)

  if (twitterMatch) {
    const [, , tweetId] = twitterMatch
    const post = MOCK_POSTS.find((p) => p.platformId === tweetId)
    if (!post) return { accountVerified: true, signatureVerified: false, error: "Post not created by agent." }
    return { accountVerified: true, signatureVerified: !!post.signature }
  }

  if (substackMatch) {
    const [, , slug] = substackMatch
    const post = MOCK_POSTS.find((p) => p.articleUrl?.includes(slug) || p.platformId === slug)
    if (!post) return { accountVerified: true, signatureVerified: false, error: "Post not created by agent." }
    return { accountVerified: true, signatureVerified: !!post.signature }
  }

  return { accountVerified: false, signatureVerified: false, error: 'Unrecognized URL format.' }
})

app.post('/api/verify/signature', async (request) => {
  const { message, signature } = (request.body ?? {}) as { message?: string; signature?: string }
  if (!message || !signature) return { signatureVerified: false, signerAddress: '', error: 'Missing message or signature field.' }
  // Mock: accept any 0x-prefixed signature
  const valid = signature.startsWith('0x') && signature.length > 4
  return { signatureVerified: valid, signerAddress: EVM_ADDRESS }
})

// Static site
await app.register(fastifyStatic, { root: siteRoot, prefix: '/site/' })
app.get('/', async (_req, reply) => reply.sendFile('index.html'))
app.get('/favicon.svg', async (_req, reply) => reply.sendFile('eigen-symbol.svg'))

await app.listen({ port: PORT, host: '0.0.0.0' })
console.log(`\n  Mock agent server running at http://localhost:${PORT}\n`)
console.log('  Try these in the Verify dropdown:')
console.log('    Link tab:      https://x.com/atlas/status/1234567890')
console.log('    Link tab:      https://testagent.substack.com/p/sample-slug')
console.log('    Signature tab:  message="hello"  signature="0xdeadbeef"\n')
