import type { Signal } from '../../../types.js'
import type { TwitterSignal } from '../types.js'
import { Cache } from '../../../cache/cache.js'
import { EventBus } from '../../../console/events.js'
import type { TwitterReadProvider } from '../provider.js'
import type { TwitterClient } from '../client.js'
import { GrokNewsScanner } from './grok-news.js'
import { ViralTweetScanner } from './viral-tweets.js'
import { TimelineScanner } from './timeline.js'

export class TwitterScanner {
  readonly name = 'twitter'
  private buffer: Map<string, TwitterSignal> = new Map()
  private seenIds = new Set<string>()
  private grokNews: GrokNewsScanner
  private viralTweets: ViralTweetScanner
  private timeline: TimelineScanner | null

  constructor(
    private events: EventBus,
    readProvider: TwitterReadProvider,
    signalCache: Cache<TwitterSignal[]>,
    bearerToken: string,
    scanConfig: { newsTtlMs: number; timelineTtlMs: number },
    twitter?: TwitterClient,
  ) {
    this.grokNews = new GrokNewsScanner(events, bearerToken, signalCache, scanConfig.newsTtlMs)
    this.viralTweets = new ViralTweetScanner(events, readProvider, signalCache, scanConfig.timelineTtlMs)
    this.timeline = twitter
      ? new TimelineScanner(events, twitter, signalCache, scanConfig.timelineTtlMs)
      : null
  }

  async scan(): Promise<Signal[]> {
    this.pruneStale()

    const scanners = [
      this.grokNews.scan(),
      this.viralTweets.scan(),
      ...(this.timeline ? [this.timeline.scan()] : []),
    ]

    const results = await Promise.allSettled(scanners)

    let newCount = 0
    for (const result of results) {
      if (result.status === 'fulfilled') {
        for (const signal of result.value) {
          const dedupeKey = signal.tweetId ?? signal.grok?.storyId
          if (dedupeKey && this.seenIds.has(dedupeKey)) continue
          if (dedupeKey) this.seenIds.add(dedupeKey)
          this.buffer.set(signal.id, signal)
          newCount++
        }
      }
    }

    const signals = [...this.buffer.values()]
    this.events.emit({ type: 'scan', source: 'twitter', signalCount: signals.length, ts: Date.now() })

    if (newCount > 0) {
      this.events.monologue(`${newCount} new signals ingested (${signals.length} total in buffer).`)
    }

    return signals
  }

  get bufferSize(): number {
    return this.buffer.size
  }

  private pruneStale(): void {
    const now = Date.now()
    for (const [id, signal] of this.buffer) {
      if (now > signal.expiresAt) {
        const dedupeKey = signal.tweetId ?? signal.grok?.storyId
        if (dedupeKey) this.seenIds.delete(dedupeKey)
        this.buffer.delete(id)
      }
    }
  }
}
