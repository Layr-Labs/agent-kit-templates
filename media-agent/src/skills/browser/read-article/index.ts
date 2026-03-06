import { tool } from 'ai'
import { z } from 'zod'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import type { Skill, SkillContext } from '../../types.js'
import type { BrowserLike } from '../../../browser/types.js'

const skill: Skill = {
  name: 'read-article',
  description: 'Read full article content from a URL using the browser. Lightweight — no LLM agent loop, just navigate + extract.',
  category: 'browser',

  async init(ctx: SkillContext) {
    return {
      read_article: tool({
        description: 'Navigate to a URL and extract the full article text. Uses the browser directly (no LLM loop) so it is fast. Returns the article text. For very long articles, saves to a file and returns the path.',
        inputSchema: z.object({
          url: z.string().describe('The article URL to read'),
        }),
        execute: async ({ url }) => {
          if (!ctx.browser) return { error: 'Browser not available.' }

          const browser = ctx.browser as BrowserLike
          try {
            await browser.navigate(url)
            await browser.waitMs(3000)

            // Extract article text using common article selectors, falling back to body
            const text = await browser.evaluate<string>(`
              (() => {
                const selectors = ['article', '[role="main"]', 'main', '.post-content', '.article-body', '.entry-content', '.story-body'];
                for (const sel of selectors) {
                  const el = document.querySelector(sel);
                  if (el && el.innerText.length > 200) return el.innerText;
                }
                return document.body?.innerText ?? '';
              })()
            `)

            if (!text || text.length < 50) {
              return { error: 'Could not extract article content from ' + url }
            }

            // For long articles, save to file
            if (text.length > 8000) {
              const slug = url.replace(/https?:\/\//, '').replace(/[^a-z0-9]+/gi, '-').slice(0, 60)
              const dir = join(ctx.dataDir, 'articles-read')
              mkdirSync(dir, { recursive: true })
              const filePath = join(dir, `${slug}.txt`)
              writeFileSync(filePath, text, 'utf-8')
              return {
                url,
                chars: text.length,
                preview: text.slice(0, 2000),
                full_text_path: filePath,
              }
            }

            return { url, chars: text.length, text }
          } catch (err: any) {
            return { error: `Failed to read ${url}: ${err.message}` }
          }
        },
      }),

      read_articles: tool({
        description: 'Read multiple article URLs in sequence. Returns summaries of each. Use this after scanning to get full context before scoring.',
        inputSchema: z.object({
          urls: z.array(z.string()).describe('List of article URLs to read'),
          max: z.number().default(5).describe('Maximum number of articles to read'),
        }),
        execute: async ({ urls, max }) => {
          if (!ctx.browser) return { error: 'Browser not available.' }

          const browser = ctx.browser as BrowserLike
          const results: Array<{ url: string; title: string; preview: string; chars: number }> = []

          for (const url of urls.slice(0, max)) {
            try {
              await browser.navigate(url)
              await browser.waitMs(3000)

              const extracted = await browser.evaluate<string>(`
                (() => {
                  const title = document.title || '';
                  const selectors = ['article', '[role="main"]', 'main', '.post-content', '.article-body', '.entry-content'];
                  let text = '';
                  for (const sel of selectors) {
                    const el = document.querySelector(sel);
                    if (el && el.innerText.length > 200) { text = el.innerText; break; }
                  }
                  if (!text) text = document.body?.innerText ?? '';
                  return JSON.stringify({ title, text });
                })()
              `)

              const { title, text } = JSON.parse(extracted)
              results.push({
                url,
                title,
                preview: text.slice(0, 1500),
                chars: text.length,
              })
            } catch {
              results.push({ url, title: '', preview: 'Failed to read', chars: 0 })
            }
          }

          return { articlesRead: results.length, articles: results }
        },
      }),
    }
  },
}

export default skill
