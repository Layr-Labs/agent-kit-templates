import { tool } from 'ai'
import { z } from 'zod'

const REST_BASE = 'https://en.wikipedia.org/api/rest_v1'
const ACTION_BASE = 'https://en.wikipedia.org/w/api.php'
const UA = 'media-agent-wikipedia-reader/1.0 (https://github.com/Layr-Labs/media-agent)'

async function wikiRestFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${REST_BASE}${path}`, {
    headers: { 'User-Agent': UA, 'Accept': 'application/json' },
  })
  if (!res.ok) throw new Error(`Wikipedia REST API ${res.status}: ${path}`)
  return res.json() as Promise<T>
}

async function wikiActionFetch<T>(params: Record<string, string>): Promise<T> {
  const searchParams = new URLSearchParams({
    ...params,
    format: 'json',
    origin: '*',
  })
  const res = await fetch(`${ACTION_BASE}?${searchParams}`, {
    headers: { 'User-Agent': UA },
  })
  if (!res.ok) throw new Error(`Wikipedia Action API ${res.status}`)
  return res.json() as Promise<T>
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<sup[\s\S]*?<\/sup>/gi, '')
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, content) => `\n${'#'.repeat(Number(level))} ${content.replace(/<[^>]+>/g, '').trim()}\n`)
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, content) => `- ${content.replace(/<[^>]+>/g, '').trim()}\n`)
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, content) => `\n${content.replace(/<[^>]+>/g, '').trim()}\n`)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\[\d+\]/g, '') // Remove citation brackets [1], [2], etc.
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

interface WikiSummary {
  title: string
  displaytitle: string
  description: string
  extract: string
  extract_html: string
  content_urls: {
    desktop: { page: string }
    mobile: { page: string }
  }
  thumbnail?: { source: string; width: number; height: number }
  timestamp: string
  pageid: number
}

interface WikiSearchResult {
  query: {
    search: Array<{
      pageid: number
      title: string
      snippet: string
      size: number
      wordcount: number
      timestamp: string
    }>
    searchinfo: { totalhits: number }
  }
}

interface WikiParseResult {
  parse: {
    title: string
    pageid: number
    text: { '*': string }
    categories: Array<{ '*': string }>
    sections: Array<{ toclevel: number; line: string; number: string }>
  }
}

const skill = {
  name: 'wikipedia-reader',
  description: 'Search and read Wikipedia articles — summaries, full text, and structured data',
  category: 'agent' as const,

  async init() {
    return {
      search_wikipedia: tool({
        description: 'Search Wikipedia articles by query. Returns titles, snippets, and page IDs for further lookup.',
        inputSchema: z.object({
          query: z.string().describe('Search query (e.g. "machine learning", "French Revolution")'),
          max_results: z.number().optional().default(10).describe('Maximum results'),
          language: z.string().optional().default('en').describe('Wikipedia language code (e.g. "en", "fr", "de", "es")'),
        }),
        execute: async ({ query, max_results, language }) => {
          const base = language === 'en' ? ACTION_BASE : `https://${language}.wikipedia.org/w/api.php`
          const params = new URLSearchParams({
            action: 'query',
            list: 'search',
            srsearch: query,
            srlimit: String(max_results),
            srprop: 'snippet|size|wordcount|timestamp',
            format: 'json',
            origin: '*',
          })
          const res = await fetch(`${base}?${params}`, { headers: { 'User-Agent': UA } })
          if (!res.ok) throw new Error(`Wikipedia search error: ${res.status}`)
          const data = await res.json() as WikiSearchResult

          return {
            totalHits: data.query.searchinfo.totalhits,
            results: data.query.search.map(r => ({
              pageId: r.pageid,
              title: r.title,
              snippet: stripHtml(r.snippet),
              wordCount: r.wordcount,
              lastModified: r.timestamp,
              url: `https://${language}.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, '_'))}`,
            })),
          }
        },
      }),

      get_wikipedia_summary: tool({
        description: 'Get a concise summary of a Wikipedia article. Fast and lightweight — returns the article intro paragraph, thumbnail, and description.',
        inputSchema: z.object({
          title: z.string().describe('Article title (e.g. "Machine learning", "Albert Einstein")'),
          language: z.string().optional().default('en').describe('Wikipedia language code'),
        }),
        execute: async ({ title, language }) => {
          const base = language === 'en' ? REST_BASE : `https://${language}.wikipedia.org/api/rest_v1`
          const encoded = encodeURIComponent(title.replace(/ /g, '_'))
          const res = await fetch(`${base}/page/summary/${encoded}`, {
            headers: { 'User-Agent': UA, Accept: 'application/json' },
          })
          if (!res.ok) throw new Error(`Wikipedia summary not found: ${title} (${res.status})`)
          const data = await res.json() as WikiSummary

          return {
            title: data.title,
            description: data.description ?? null,
            summary: data.extract,
            url: data.content_urls.desktop.page,
            thumbnail: data.thumbnail?.source ?? null,
            lastModified: data.timestamp,
            pageId: data.pageid,
          }
        },
      }),

      read_wikipedia_article: tool({
        description: 'Read the full text of a Wikipedia article. Returns the article content as clean markdown-like text with section headings.',
        inputSchema: z.object({
          title: z.string().describe('Article title (e.g. "Machine learning")'),
          language: z.string().optional().default('en').describe('Wikipedia language code'),
          sections_only: z.boolean().optional().default(false).describe('If true, return only section headings (table of contents) without full text'),
        }),
        execute: async ({ title, language, sections_only }) => {
          const base = language === 'en' ? ACTION_BASE : `https://${language}.wikipedia.org/w/api.php`

          if (sections_only) {
            const params = new URLSearchParams({
              action: 'parse',
              page: title,
              prop: 'sections',
              format: 'json',
              origin: '*',
            })
            const res = await fetch(`${base}?${params}`, { headers: { 'User-Agent': UA } })
            if (!res.ok) throw new Error(`Wikipedia parse error: ${res.status}`)
            const data = await res.json() as WikiParseResult
            return {
              title: data.parse.title,
              sections: data.parse.sections.map(s => ({
                level: s.toclevel,
                heading: s.line,
                number: s.number,
              })),
              url: `https://${language}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
            }
          }

          const params = new URLSearchParams({
            action: 'parse',
            page: title,
            prop: 'text|categories|sections',
            format: 'json',
            origin: '*',
          })
          const res = await fetch(`${base}?${params}`, { headers: { 'User-Agent': UA } })
          if (!res.ok) throw new Error(`Wikipedia parse error: ${res.status}`)
          const data = await res.json() as WikiParseResult

          if (!data.parse) return { error: `Article not found: ${title}` }

          let content = stripHtml(data.parse.text['*'])

          // Remove common Wikipedia chrome
          content = content
            .replace(/\[edit\]/gi, '')
            .replace(/\[citation needed\]/gi, '')
            .replace(/^\s*Jump to navigation.*$/m, '')

          if (content.length > 60000) {
            content = content.slice(0, 60000) + '\n\n[... truncated — article exceeds 60k chars]'
          }

          return {
            title: data.parse.title,
            pageId: data.parse.pageid,
            url: `https://${language}.wikipedia.org/wiki/${encodeURIComponent(data.parse.title.replace(/ /g, '_'))}`,
            contentLength: content.length,
            sections: data.parse.sections.map(s => s.line),
            categories: data.parse.categories.map(c => c['*']),
            content,
          }
        },
      }),
    }
  },
}

export default skill
