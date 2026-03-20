import { basename, join } from 'path'
import { readFileSync } from 'fs'
import type { ConsoleEvent, EventBus } from '../console/events.js'
import { getCostTracker } from '../ai/tracking.js'
import type { Config } from '../config/index.js'
import type { Database } from '../db/index.js'
import type { BackgroundTask, CompiledAgent, ProcessWorkflow } from '../process/types.js'
import type { SkillRegistry } from '../skills/registry.js'
import type { AgentIdentity, Worldview } from '../types.js'

export interface PublicPostRecord {
  id: string
  platformId: string
  contentId: string | null
  text: string
  summary?: string
  imageUrl?: string
  videoUrl?: string
  articleUrl?: string
  referenceId?: string
  type: string
  signature?: string
  signerAddress?: string
  urlSignature?: string
  postedAt: number
  engagement: {
    likes: number
    shares: number
    comments: number
    views: number
    lastChecked: number
  }
}

export interface SiteBootstrapPayload {
  copy: {
    eyebrow: string
    heroSupport: string
    primaryCtaLabel: string
    secondaryCtaLabel: string
    tabs: Array<{ id: string; label: string; description: string }>
    emptyEditorial: string
  }
  meta: {
    compiledAt: number
    sourceHash: string
    platform: string
    now: number
    uptimeSeconds: number
    repoUrl: string | null
    gitCommit: string | null
    template: string
  }
  compiledAgent: CompiledAgent
  identity: AgentIdentity
  worldview: Worldview
  engagement: {
    voiceDescription: string
    rules: string[]
  }
  governance: CompiledAgent['governance']
  style: CompiledAgent['style'] | null
  creativeProcess: string
  processPlan: {
    workflows: Array<Pick<ProcessWorkflow, 'name' | 'instruction' | 'priority' | 'runOnce' | 'skills'> & {
      trigger: { intervalMs: number; timerKey: string }
    }>
    backgroundTasks: Array<Pick<BackgroundTask, 'name' | 'skill' | 'tool'> & {
      trigger: { intervalMs: number; timerKey: string }
    }>
  }
  live: {
    state: string
    recentEvents: ConsoleEvent[]
    recentMonologues: Array<Extract<ConsoleEvent, { type: 'monologue' }>>
  }
  editorial: {
    posts: PublicPostRecord[]
    total: number
  }
  transparency: {
    wallets: { evm: string | null; solana: string | null }
    skills: {
      hotReloadEnabled: boolean
      active: ReturnType<SkillRegistry['list']>
      installed: Array<{ name: string; version: string; enabled: boolean }>
    }
    costs:
      | ({ enabled: true } & ReturnType<NonNullable<ReturnType<typeof getCostTracker>>['getSummary']>)
      | { enabled: false; reason: string }
  }
}

export function loadWorldview(config: Config, identity: AgentIdentity): Worldview {
  try {
    const raw = readFileSync(join(config.dataDir, 'worldview.json'), 'utf-8')
    return JSON.parse(raw) as Worldview
  } catch {
    return {
      beliefs: identity.beliefs,
      themes: identity.themes,
      punchesUp: identity.punchesUp,
      respects: identity.respects,
    }
  }
}

export function listPublicPosts(db: Database, limit: number, offset = 0): {
  posts: PublicPostRecord[]
  total: number
} {
  const rows = db.query(
    'SELECT * FROM posts ORDER BY posted_at DESC LIMIT ? OFFSET ?',
  ).all(limit, offset) as Array<Record<string, unknown>>
  const countRow = db.query('SELECT COUNT(*) AS count FROM posts').get() as { count?: number } | null

  return {
    posts: rows.map(mapPostRow),
    total: countRow?.count ?? rows.length,
  }
}

export function buildSiteBootstrap(opts: {
  events: EventBus
  config: Config
  db: Database
  identity: AgentIdentity
  compiled: CompiledAgent
  skills: SkillRegistry
  wallets?: { evm: string; solana: string }
  repoUrl?: string | null
  gitCommit?: string | null
  template?: string
}): SiteBootstrapPayload {
  const { events, config, db, identity, compiled, skills, wallets } = opts
  const tracker = getCostTracker()
  const worldview = loadWorldview(config, identity)
  const editorial = listPublicPosts(db, 20, 0)
  const recentEvents = [...events.history].slice(-40).reverse()
  const recentMonologues = recentEvents
    .filter((event): event is Extract<ConsoleEvent, { type: 'monologue' }> => event.type === 'monologue')
    .slice(0, 8)

  return {
    copy: {
      eyebrow: 'LIVE DOSSIER',
      heroSupport: `${identity.name} is a sovereign media agent. This is the public record of what it watches, what it believes, what it publishes, and what it is doing right now.`,
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
      compiledAt: compiled.compiledAt,
      sourceHash: compiled.sourceHash,
      platform: config.platform,
      now: Date.now(),
      uptimeSeconds: Math.floor(process.uptime()),
      repoUrl: opts.repoUrl ?? null,
      gitCommit: opts.gitCommit ?? null,
      template: opts.template ?? 'unknown',
    },
    compiledAgent: compiled,
    identity,
    worldview,
    engagement: {
      voiceDescription: compiled.engagement?.voiceDescription ?? identity.voice,
      rules: compiled.engagement?.rules ?? [],
    },
    governance: compiled.governance,
    style: compiled.style ?? null,
    creativeProcess: compiled.creativeProcess,
    processPlan: compiled.plan,
    live: {
      state: events.state,
      recentEvents,
      recentMonologues,
    },
    editorial,
    transparency: {
      wallets: {
        evm: wallets?.evm ?? null,
        solana: wallets?.solana ?? null,
      },
      skills: {
        hotReloadEnabled: config.skills.hotReloadEnabled,
        active: skills.list(),
        installed: skills.installedManifests().map((manifest) => ({
          name: manifest.name,
          version: manifest.version,
          enabled: manifest.enabled !== false,
        })),
      },
      costs: tracker
        ? { enabled: true, ...tracker.getSummary(10) }
        : { enabled: false, reason: 'Cost tracker not initialized.' },
    },
  }
}

export function mapPostRow(row: Record<string, unknown>): PublicPostRecord {
  return {
    id: String(row.id ?? ''),
    platformId: String(row.platform_id ?? ''),
    contentId: row.content_id ? String(row.content_id) : null,
    text: String(row.text ?? ''),
    summary: row.summary ? String(row.summary) : undefined,
    imageUrl: normalizeMediaUrl(row.image_url),
    videoUrl: normalizeMediaUrl(row.video_url),
    articleUrl: row.article_url ? String(row.article_url) : undefined,
    referenceId: row.reference_id ? String(row.reference_id) : undefined,
    type: String(row.type ?? 'flagship'),
    signature: row.signature ? String(row.signature) : undefined,
    signerAddress: row.signer_address ? String(row.signer_address) : undefined,
    urlSignature: row.url_signature ? String(row.url_signature) : undefined,
    postedAt: Number(row.posted_at ?? 0),
    engagement: {
      likes: Number(row.likes ?? 0),
      shares: Number(row.shares ?? 0),
      comments: Number(row.comments ?? 0),
      views: Number(row.views ?? 0),
      lastChecked: Number(row.engagement_checked_at ?? 0),
    },
  }
}

export function normalizeMediaUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) return undefined
  if (/^https?:\/\//.test(value) || value.startsWith('/images/')) return value

  const filename = basename(value)
  if (!filename || filename === '.' || filename === '..') return undefined
  return `/images/${encodeURIComponent(filename)}`
}
