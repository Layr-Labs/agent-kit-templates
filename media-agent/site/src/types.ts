export type TabId = 'live' | 'editorial' | 'worldview' | 'about'

export interface ConsoleEvent {
  type: string
  ts: number
  [key: string]: unknown
}

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
    tabs: Array<{ id: TabId; label: string; description: string }>
    emptyEditorial: string
  }
  meta: {
    compiledAt: number
    sourceHash: string
    platform: string
    now: number
    uptimeSeconds: number
  }
  identity: {
    name: string
    tagline: string
    creator: string
    born?: string
    bio?: string
    constitution: string
    persona: string
    beliefs: string[]
    themes: string[]
    punchesUp: string[]
    respects: string[]
    voice: string
    restrictions: string[]
    motto: string
  }
  worldview: {
    beliefs: string[]
    themes: string[]
    punchesUp: string[]
    respects: string[]
    evolvedAt?: number
  }
  engagement: {
    voiceDescription: string
    rules: string[]
  }
  governance: {
    upgradeRules: string[]
    financialCommitments: string[]
    restrictions: string[]
  }
  style: {
    name: string
    description: string
    visualIdentity: string
    compositionPrinciples: string
    renderingRules: string
  } | null
  creativeProcess: string
  processPlan: {
    workflows: Array<{
      name: string
      instruction: string
      priority: number
      runOnce?: boolean
      skills?: string[]
      trigger: { intervalMs: number; timerKey: string }
    }>
    backgroundTasks: Array<{
      name: string
      skill: string
      tool: string
      trigger: { intervalMs: number; timerKey: string }
    }>
  }
  live: {
    state: string
    recentEvents: ConsoleEvent[]
    recentMonologues: Array<ConsoleEvent & { type: 'monologue'; text: string; state: string }>
  }
  editorial: {
    posts: PublicPostRecord[]
    total: number
  }
  transparency: {
    wallets: { evm: string | null; solana: string | null }
    skills: {
      hotReloadEnabled: boolean
      active: Array<{
        name: string
        description: string
        category: string
        source: string
        version?: string
        enabled?: boolean
        capabilities?: string[]
        declaredTools?: Array<{ name: string; description: string }>
        tools: string[]
      }>
      installed: Array<{ name: string; version: string; enabled: boolean }>
    }
    costs:
      | {
          enabled: false
          reason: string
        }
      | {
          enabled: true
          totalCalls: number
          failedCalls: number
          totalCostUsd: number
          totalMarketCostUsd: number
          totalInputTokens: number
          totalOutputTokens: number
          totalTokens: number
          totalCachedTokens: number
          byModel: Array<{
            modelId: string
            calls: number
            failures: number
            costUsd: number
            marketCostUsd: number
            inputTokens: number
            outputTokens: number
            totalTokens: number
            cachedTokens: number
            avgCostUsd: number
          }>
          recent: Array<{
            ts: number
            operation: string
            modelId: string
            success: boolean
            durationMs: number
            totalTokens?: number
            costUsd?: number
          }>
        }
  }
}
