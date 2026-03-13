import { randomUUID } from 'crypto'
import type { Signal } from '../../../types.js'
import type { TwitterSignal } from '../types.js'
import { Cache } from '../../../cache/cache.js'
import { EventBus } from '../../../console/events.js'

interface GrokNewsStory {
  id: string
  name: string
  summary: string
  hook?: string
  category?: string
  keywords?: string[]
  updated_at?: string
  contexts?: {
    topics?: string[]
    entities?: {
      events?: string[]
      organizations?: string[]
      people?: string[]
      places?: string[]
      products?: string[]
    }
    finance?: { tickers?: string[] }
    sports?: { teams?: string[] }
  }
  cluster_posts_results?: Array<{ post_id: string }>
}

export class GrokNewsScanner {
  private seenIds = new Set<string>()

  constructor(
    private events: EventBus,
    private bearerToken: string,
    private signalCache: Cache<TwitterSignal[]>,
    private newsTtlMs: number,
    private categories: string[] = ['technology', 'science', 'entertainment', 'sports', 'business'],
  ) {}

  async scan(): Promise<TwitterSignal[]> {
    const results = await Promise.allSettled(
      this.categories.map(cat => this.scanCategory(cat)),
    )

    const signals: TwitterSignal[] = []
    for (const result of results) {
      if (result.status === 'fulfilled') {
        signals.push(...result.value)
      }
    }
    return signals
  }

  private async scanCategory(query: string): Promise<TwitterSignal[]> {
    const cacheKey = Cache.key(`grok-news:${query}`)
    const cached = this.signalCache.get(cacheKey)
    if (cached) return cached

    try {
      const url = new URL('https://api.x.com/2/news/search')
      url.searchParams.set('query', query)
      url.searchParams.set('max_results', '10')
      url.searchParams.set('max_age_hours', '24')
      url.searchParams.set(
        'news.fields',
        'category,cluster_posts_results,contexts,hook,keywords,name,summary,updated_at',
      )

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${this.bearerToken}` },
      })

      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)

      const json = (await res.json()) as { data?: GrokNewsStory[] }
      const stories = json.data ?? []

      const signals: TwitterSignal[] = stories.map(story => ({
        id: randomUUID(),
        source: 'twitter' as const,
        type: 'headline' as const,
        content: `${story.name}\n\n${story.summary}`,
        url: '',
        tweetId: story.cluster_posts_results?.[0]?.post_id,
        metrics: { likes: story.cluster_posts_results?.length ?? 0 },
        ingestedAt: Date.now(),
        expiresAt: Date.now() + this.newsTtlMs,
        grok: {
          storyId: story.id,
          headline: story.name,
          summary: story.summary,
          hook: story.hook,
          category: story.category,
          topics: story.contexts?.topics,
          entities: story.contexts?.entities,
          keywords: story.keywords,
          postIds: story.cluster_posts_results?.map(p => p.post_id) ?? [],
        },
      }))

      this.signalCache.set(cacheKey, signals, this.newsTtlMs)

      const newStories = signals.filter(s => {
        const key = s.grok?.storyId
        if (key && !this.seenIds.has(key)) { this.seenIds.add(key); return true }
        return false
      })
      if (newStories.length > 0) {
        this.events.monologue(
          `Grok news "${query}": ${newStories.length} new stories. Top: "${newStories[0].grok?.headline ?? 'unknown'}"`,
        )
      }
      return signals
    } catch (err) {
      this.events.monologue(`Grok news "${query}" failed: ${(err as Error).message}`)
      return []
    }
  }
}
