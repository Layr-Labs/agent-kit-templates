import { randomUUID } from 'crypto'
import type { Signal } from '../../../types.js'
import type { Scanner } from '../../../pipeline/scanner.js'

export class RSSScanner implements Scanner {
  readonly name = 'rss'
  private buffer: Signal[] = []

  constructor(
    private feeds: string[],
    private ttlMs: number = 15 * 60_000,
  ) {}

  async scan(): Promise<Signal[]> {
    const signals: Signal[] = []

    for (const feedUrl of this.feeds) {
      try {
        const res = await fetch(feedUrl)
        if (!res.ok) continue

        const xml = await res.text()
        const items = this.parseRSS(xml)

        for (const item of items) {
          const existing = this.buffer.find(s => s.url === item.link)
          if (existing) continue

          const signal: Signal = {
            id: randomUUID(),
            source: 'rss',
            type: 'headline',
            content: `${item.title}\n\n${item.description ?? ''}`.trim(),
            url: item.link,
            author: item.author,
            ingestedAt: Date.now(),
            expiresAt: Date.now() + this.ttlMs,
            metadata: { feedUrl },
          }

          signals.push(signal)
        }
      } catch (err) {
        console.error(`RSS scan failed for ${feedUrl}:`, (err as Error).message)
      }
    }

    this.buffer.push(...signals)
    this.buffer = this.buffer.filter(s => Date.now() < s.expiresAt)

    return this.buffer
  }

  get bufferSize(): number {
    return this.buffer.length
  }

  private parseRSS(xml: string): Array<{ title: string; link: string; description?: string; author?: string }> {
    const items: Array<{ title: string; link: string; description?: string; author?: string }> = []

    const itemMatches = xml.match(/<item[\s\S]*?<\/item>/gi) ?? []
    for (const itemXml of itemMatches.slice(0, 20)) {
      const title = this.extractTag(itemXml, 'title')
      const link = this.extractTag(itemXml, 'link')
      if (!title || !link) continue

      items.push({
        title,
        link,
        description: this.extractTag(itemXml, 'description'),
        author: this.extractTag(itemXml, 'author') ?? this.extractTag(itemXml, 'dc:creator'),
      })
    }

    return items
  }

  private extractTag(xml: string, tag: string): string | undefined {
    const regex = new RegExp(`<${tag}[^>]*>(?:<\\!\\[CDATA\\[)?(.*?)(?:\\]\\]>)?<\\/${tag}>`, 'is')
    const match = xml.match(regex)
    return match?.[1]?.trim()
  }
}
