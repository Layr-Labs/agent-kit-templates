import { randomUUID } from 'crypto'
import type { TwitterSignal } from '../types.js'
import { Cache } from '../../../cache/cache.js'
import { EventBus } from '../../../console/events.js'
import type { TwitterReadProvider } from '../provider.js'

export class ViralTweetScanner {
  private seenIds = new Set<string>()

  constructor(
    private events: EventBus,
    private twitterApiIo: TwitterReadProvider,
    private signalCache: Cache<TwitterSignal[]>,
    private ttlMs: number,
  ) {}

  async scan(): Promise<TwitterSignal[]> {
    const cacheKey = Cache.key('twitterapiio-viral')
    const cached = this.signalCache.get(cacheKey)
    if (cached) return cached

    try {
      const queries = [
        'min_faves:50000 -is:retweet lang:en',
        '(tech OR AI OR Apple OR Google OR OpenAI OR Meta OR Microsoft) min_faves:10000 -is:retweet lang:en',
        '(open source OR indie OR startup OR founder OR VC) min_faves:5000 -is:retweet lang:en',
      ]

      const allSignals: TwitterSignal[] = []

      for (const query of queries) {
        try {
          const res = await this.twitterApiIo.search(query, 'Top')
          const signals: TwitterSignal[] = res.tweets.map(t => {
            const mediaUrls: string[] = []
            if (t.extendedEntities?.media) {
              for (const m of t.extendedEntities.media) {
                if (m.media_url_https) mediaUrls.push(m.media_url_https)
              }
            }
            if (t.media?.photos) {
              for (const p of t.media.photos) {
                if (p.url && !mediaUrls.includes(p.url)) mediaUrls.push(p.url)
              }
            }
            return {
              id: randomUUID(),
              source: 'twitter' as const,
              type: 'tweet' as const,
              content: t.text,
              url: t.url,
              tweetId: t.id,
              author: t.author.userName,
              mediaUrls: mediaUrls.length > 0 ? mediaUrls : undefined,
              metrics: {
                likes: t.likeCount,
                retweets: t.retweetCount,
                comments: t.replyCount,
              },
              ingestedAt: Date.now(),
              expiresAt: Date.now() + this.ttlMs,
            }
          })
          allSignals.push(...signals)
        } catch { /* individual query failed */ }
      }

      this.signalCache.set(cacheKey, allSignals, this.ttlMs)

      const newTweets = allSignals.filter(s => {
        if (s.tweetId && !this.seenIds.has(s.tweetId)) { this.seenIds.add(s.tweetId); return true }
        return false
      })
      if (newTweets.length > 0) {
        const sorted = newTweets.sort((a, b) => (b.metrics?.likes ?? 0) - (a.metrics?.likes ?? 0))
        this.events.monologue(
          `Viral tweets: ${newTweets.length} new. Top: "${sorted[0].content.slice(0, 80)}..." (${sorted[0].metrics?.likes} likes)`,
        )
      }
      return allSignals
    } catch (err) {
      this.events.monologue(`Viral tweet search failed: ${(err as Error).message}`)
      return []
    }
  }
}
