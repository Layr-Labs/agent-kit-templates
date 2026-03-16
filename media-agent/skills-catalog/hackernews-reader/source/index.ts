import { tool } from 'ai'
import { z } from 'zod'

const ALGOLIA_BASE = 'https://hn.algolia.com/api/v1'
const FIREBASE_BASE = 'https://hacker-news.firebaseio.com/v0'
const UA = 'media-agent-hackernews-reader/1.0'

interface AlgoliaHit {
  objectID: string
  title?: string
  url?: string
  author: string
  points?: number
  num_comments?: number
  created_at: string
  story_text?: string
  comment_text?: string
  story_id?: number
  parent_id?: number
  _tags?: string[]
}

interface AlgoliaResponse {
  hits: AlgoliaHit[]
  nbHits: number
  page: number
  nbPages: number
  hitsPerPage: number
}

interface FirebaseItem {
  id: number
  type: string
  by?: string
  time?: number
  title?: string
  text?: string
  url?: string
  score?: number
  descendants?: number
  kids?: number[]
  parent?: number
  dead?: boolean
  deleted?: boolean
}

function stripHtml(html: string): string {
  return html
    .replace(/<p>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<a[^>]*href="([^"]*)"[^>]*>[^<]*<\/a>/gi, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function formatAlgoliaHit(hit: AlgoliaHit) {
  const isComment = (hit._tags ?? []).includes('comment')
  return {
    id: hit.objectID,
    type: isComment ? 'comment' : 'story',
    title: hit.title ?? null,
    url: hit.url ?? null,
    author: hit.author,
    points: hit.points ?? null,
    commentCount: hit.num_comments ?? null,
    createdAt: hit.created_at,
    text: hit.story_text ? stripHtml(hit.story_text) : hit.comment_text ? stripHtml(hit.comment_text) : null,
    storyId: hit.story_id ?? null,
    hnUrl: isComment
      ? `https://news.ycombinator.com/item?id=${hit.objectID}`
      : `https://news.ycombinator.com/item?id=${hit.objectID}`,
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`)
  return res.json() as Promise<T>
}

const skill = {
  name: 'hackernews-reader',
  description: 'Search and read Hacker News stories, comments, and discussions',
  category: 'agent' as const,

  async init() {
    return {
      search_hn: tool({
        description: 'Full-text search across Hacker News stories and comments. Returns matching items sorted by relevance or date.',
        inputSchema: z.object({
          query: z.string().describe('Search query (e.g. "rust programming", "OpenAI GPT")'),
          tags: z.string().optional().describe('Filter by tag: "story", "comment", "ask_hn", "show_hn", "front_page". Combine with AND/OR: "(story,show_hn)"'),
          sort_by: z.enum(['relevance', 'date']).optional().default('relevance').describe('Sort order'),
          time_range: z.enum(['last_24h', 'past_week', 'past_month', 'past_year']).optional().describe('Time filter'),
          max_results: z.number().optional().default(15).describe('Maximum results to return'),
        }),
        execute: async ({ query, tags, sort_by, time_range, max_results }) => {
          const endpoint = sort_by === 'date' ? 'search_by_date' : 'search'
          const params = new URLSearchParams({ query, hitsPerPage: String(max_results) })

          if (tags) params.set('tags', tags)

          if (time_range) {
            const now = Math.floor(Date.now() / 1000)
            const ranges: Record<string, number> = {
              last_24h: 86400,
              past_week: 604800,
              past_month: 2592000,
              past_year: 31536000,
            }
            params.set('numericFilters', `created_at_i>${now - ranges[time_range]}`)
          }

          const data = await fetchJson<AlgoliaResponse>(`${ALGOLIA_BASE}/${endpoint}?${params}`)
          return {
            totalHits: data.nbHits,
            results: data.hits.map(formatAlgoliaHit),
          }
        },
      }),

      get_hn_top_stories: tool({
        description: 'Get current top, best, new, ask, or show stories from Hacker News. Returns story metadata with links.',
        inputSchema: z.object({
          category: z.enum(['top', 'best', 'new', 'ask', 'show']).default('top').describe('Story category'),
          limit: z.number().optional().default(20).describe('Number of stories to fetch (max 50)'),
        }),
        execute: async ({ category, limit }) => {
          const clampedLimit = Math.min(limit, 50)
          const endpoint = category === 'ask' ? 'askstories' : category === 'show' ? 'showstories' : `${category}stories`
          const ids = await fetchJson<number[]>(`${FIREBASE_BASE}/${endpoint}.json`)
          const topIds = ids.slice(0, clampedLimit)

          const items = await Promise.all(
            topIds.map(id => fetchJson<FirebaseItem>(`${FIREBASE_BASE}/item/${id}.json`).catch(() => null)),
          )

          return {
            category,
            count: items.filter(Boolean).length,
            stories: items
              .filter((item): item is FirebaseItem => item !== null && !item.dead && !item.deleted)
              .map(item => ({
                id: item.id,
                title: item.title ?? '',
                url: item.url ?? null,
                author: item.by ?? '',
                score: item.score ?? 0,
                commentCount: item.descendants ?? 0,
                time: item.time ? new Date(item.time * 1000).toISOString() : null,
                text: item.text ? stripHtml(item.text) : null,
                hnUrl: `https://news.ycombinator.com/item?id=${item.id}`,
              })),
          }
        },
      }),

      get_hn_item: tool({
        description: 'Get a specific Hacker News item (story or comment) by ID, including its child comments.',
        inputSchema: z.object({
          item_id: z.number().describe('Hacker News item ID'),
          comment_depth: z.number().optional().default(2).describe('How many levels of child comments to fetch (0 = none, max 3)'),
        }),
        execute: async ({ item_id, comment_depth }) => {
          const depth = Math.min(comment_depth, 3)
          const item = await fetchJson<FirebaseItem>(`${FIREBASE_BASE}/item/${item_id}.json`)
          if (!item) return { error: `Item ${item_id} not found` }

          async function fetchChildren(ids: number[], currentDepth: number): Promise<any[]> {
            if (currentDepth <= 0 || !ids || ids.length === 0) return []
            const children = await Promise.all(
              ids.slice(0, 20).map(id =>
                fetchJson<FirebaseItem>(`${FIREBASE_BASE}/item/${id}.json`).catch(() => null),
              ),
            )
            const results = []
            for (const child of children) {
              if (!child || child.dead || child.deleted) continue
              results.push({
                id: child.id,
                author: child.by ?? '',
                text: child.text ? stripHtml(child.text) : '',
                time: child.time ? new Date(child.time * 1000).toISOString() : null,
                children: await fetchChildren(child.kids ?? [], currentDepth - 1),
              })
            }
            return results
          }

          return {
            id: item.id,
            type: item.type,
            title: item.title ?? null,
            url: item.url ?? null,
            author: item.by ?? '',
            score: item.score ?? null,
            text: item.text ? stripHtml(item.text) : null,
            commentCount: item.descendants ?? 0,
            time: item.time ? new Date(item.time * 1000).toISOString() : null,
            hnUrl: `https://news.ycombinator.com/item?id=${item.id}`,
            comments: await fetchChildren(item.kids ?? [], depth),
          }
        },
      }),
    }
  },
}

export default skill
