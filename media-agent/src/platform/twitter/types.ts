import type { Signal } from '../../types.js'

export interface GrokMetadata {
  storyId: string
  headline: string
  summary: string
  hook?: string
  category?: string
  topics?: string[]
  entities?: {
    events?: string[]
    organizations?: string[]
    people?: string[]
    places?: string[]
    products?: string[]
  }
  keywords?: string[]
  postIds: string[]
}

export interface TwitterSignal extends Signal {
  tweetId?: string
  grok?: GrokMetadata
}
