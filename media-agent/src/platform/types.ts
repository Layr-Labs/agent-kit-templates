import type { EventBus } from '../console/events.js'
import type { Signal } from '../types.js'
import type { WrittenArticle } from '../types.js'

export interface PublishOptions {
  text: string
  imagePath?: string
  videoPath?: string
  referenceId?: string
  contentType: 'image' | 'article' | 'video'
  article?: WrittenArticle
  metadata?: Record<string, unknown>
}

export interface PublishResult {
  platformId: string
  url?: string
}

export interface Scanner {
  readonly name: string
  scan(): Promise<Signal[]>
  readonly bufferSize: number
}

export interface PlatformAdapter {
  readonly name: string
  init(events: EventBus): Promise<void>
  publish(opts: PublishOptions): Promise<PublishResult>
  engage(): Promise<void>
  getScanner(): Scanner
  supportedContentTypes(): ('image' | 'article' | 'video')[]
  findReference?(topicSummary: string): Promise<string | undefined>
  shutdown?(): Promise<void>
}
