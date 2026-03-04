import type { Signal, Topic, ContentConcept, ConceptCritique, Content, Post } from '../types.js'

export interface PipelineState {
  // Per-workflow state (reset between workflows)
  signals: Signal[]
  topics: Topic[]
  concepts: ContentConcept[]
  bestConcept: ContentConcept | null
  critique: ConceptCritique | null
  imagePaths: string[]
  imagePrompt: string | null
  caption: string | null
  article: { title: string; subtitle: string; body: string } | null
  review: { approved: boolean; caption: string; reason?: string; qualityScore?: number } | null

  // Long-lived state (persists across workflows)
  allPosts: Post[]
  allContent: Content[]
  cachedSignals: Signal[]

  // Arbitrary state for custom skills
  custom: Record<string, unknown>
}

export function createPipelineState(db?: any): PipelineState {
  // Load past posts from DB so the agent knows what it already published
  let allPosts: Post[] = []
  if (db) {
    try {
      const rows = db.query('SELECT * FROM posts ORDER BY posted_at DESC LIMIT 50').all() as any[]
      allPosts = rows.map((r: any) => ({
        id: r.id,
        platformId: r.platform_id,
        contentId: r.content_id,
        text: r.text,
        imageUrl: r.image_url,
        videoUrl: r.video_url,
        articleUrl: r.article_url,
        referenceId: r.reference_id,
        type: r.type,
        signature: r.signature,
        signerAddress: r.signer_address,
        postedAt: r.posted_at,
        engagement: { likes: 0, shares: 0, comments: 0, views: 0, lastChecked: 0 },
      }))
      if (allPosts.length > 0) {
        console.log(`Loaded ${allPosts.length} past posts from database.`)
      }
    } catch { /* DB might not exist yet */ }
  }

  return {
    signals: [],
    topics: [],
    concepts: [],
    bestConcept: null,
    critique: null,
    imagePaths: [],
    imagePrompt: null,
    caption: null,
    article: null,
    review: null,
    allPosts,
    allContent: [],
    cachedSignals: [],
    custom: {},
  }
}

export function resetWorkflowState(state: PipelineState): void {
  state.signals = []
  state.topics = []
  state.concepts = []
  state.bestConcept = null
  state.critique = null
  state.imagePaths = []
  state.imagePrompt = null
  state.caption = null
  state.article = null
  state.review = null
}
