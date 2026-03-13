import { randomUUID } from 'crypto'
import type { TwitterSignal } from '../types.js'
import { Cache } from '../../../cache/cache.js'
import { EventBus } from '../../../console/events.js'
import type { TwitterClient } from '../client.js'

export class TimelineScanner {
  private seenIds = new Set<string>()

  constructor(
    private events: EventBus,
    private twitter: TwitterClient,
    private signalCache: Cache<TwitterSignal[]>,
    private ttlMs: number,
    private minLikes: number = 200,
  ) {}

  async scan(): Promise<TwitterSignal[]> {
    const cacheKey = Cache.key('home-timeline')
    const cached = this.signalCache.get(cacheKey)
    if (cached) return cached

    try {
      const timeline = await this.twitter.getHomeTimeline(50)
      const quality = timeline.filter(t => t.likes >= this.minLikes)

      const signals: TwitterSignal[] = quality.map(t => ({
        id: randomUUID(),
        source: 'twitter' as const,
        type: 'tweet' as const,
        content: t.text,
        url: `https://x.com/${t.authorUsername}/status/${t.id}`,
        tweetId: t.id,
        author: t.authorUsername,
        metrics: {
          likes: t.likes,
          retweets: t.retweets,
          comments: t.replies,
        },
        ingestedAt: Date.now(),
        expiresAt: Date.now() + this.ttlMs,
      }))

      this.signalCache.set(cacheKey, signals, this.ttlMs)

      const newTweets = signals.filter(s => {
        if (s.tweetId && !this.seenIds.has(s.tweetId)) { this.seenIds.add(s.tweetId); return true }
        return false
      })
      if (newTweets.length > 0) {
        const top = newTweets.sort((a, b) => (b.metrics?.likes ?? 0) - (a.metrics?.likes ?? 0))[0]
        this.events.monologue(
          `Timeline: ${newTweets.length} new tweets. Top: "${top.content.slice(0, 80)}..." by @${top.author} (${top.metrics?.likes} likes)`,
        )
      }
      return signals
    } catch (err) {
      this.events.monologue(`Timeline scan failed: ${(err as Error).message}`)
      return []
    }
  }
}
