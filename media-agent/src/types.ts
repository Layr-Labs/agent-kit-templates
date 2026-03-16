export interface Signal {
  id: string
  source: string
  type: string
  content: string
  url: string
  sourceId?: string
  author?: string
  mediaUrls?: string[]
  metrics?: {
    likes?: number
    shares?: number
    retweets?: number
    comments?: number
    score?: number
    rank?: number
  }
  ingestedAt: number
  expiresAt: number
  metadata?: Record<string, unknown>
}

export interface TopicScores {
  virality: number
  contentPotential: number
  audienceBreadth: number
  timeliness: number
  creativity: number
  worldviewAlignment: number
  composite: number
}

export interface Topic {
  id: string
  signals: string[]
  summary: string
  scores: TopicScores
  safety: { passed: boolean; reason?: string }
  status: 'candidate' | 'shortlisted' | 'selected' | 'posted' | 'rejected'
  evaluatedAt: number
}

export interface ContentConcept {
  id: string
  topicId: string
  visual: string
  composition: string
  caption: string
  approach: string
  reasoning: string
  referenceImageUrls?: string[]
}

export interface ArticleImageAsset {
  id: string
  prompt: string
  imagePath: string
  alt: string
  caption?: string
  placement: 'header' | 'inline'
  anchorHeading?: string
}

export type ArticleSection =
  | {
    type: 'heading'
    text: string
    level: 1 | 2 | 3 | 4 | 5 | 6
  }
  | {
    type: 'paragraph'
    text: string
  }
  | {
    type: 'image'
    imageId: string
  }

export interface WrittenArticle {
  title: string
  subtitle: string
  body: string
  sections: ArticleSection[]
  images: ArticleImageAsset[]
}

export interface ConceptCritique {
  conceptId: string
  quality: number
  clarity: number
  shareability: number
  execution: number
  overallScore: number
  critique: string
}

export interface Content {
  id: string
  conceptId: string
  topicId: string
  type: 'flagship' | 'quickhit' | 'paid' | 'article'
  concept: ContentConcept
  prompt: string
  variants: string[]
  selectedVariant: number
  critique: ConceptCritique
  caption: string
  createdAt: number
}

export interface Post {
  id: string
  platformId: string
  contentId?: string
  text: string
  summary?: string
  imageUrl?: string
  videoUrl?: string
  articleUrl?: string
  referenceId?: string
  type: 'flagship' | 'quickhit' | 'paid' | 'article' | 'engagement'
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

export interface AgentIdentity {
  name: string
  tagline: string
  creator: string
  born?: string
  bio?: string
  constitution: string

  // Derived at startup by AgentCompiler:
  persona: string
  beliefs: string[]
  themes: string[]
  punchesUp: string[]
  respects: string[]
  voice: string
  restrictions: string[]
  motto: string
}

export interface Worldview {
  beliefs: string[]
  themes: string[]
  punchesUp: string[]
  respects: string[]
  evolvedAt?: number
}
