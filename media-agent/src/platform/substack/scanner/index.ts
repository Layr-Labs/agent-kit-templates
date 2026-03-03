import type { Signal } from '../../../types.js'
import type { Scanner } from '../../../pipeline/scanner.js'
import { RSSScanner } from './rss.js'

export class SubstackScanner implements Scanner {
  readonly name = 'substack'
  private scanners: Scanner[] = []

  constructor(rssFeeds: string[], scanTtlMs: number = 15 * 60_000) {
    if (rssFeeds.length > 0) {
      this.scanners.push(new RSSScanner(rssFeeds, scanTtlMs))
    }
  }

  async scan(): Promise<Signal[]> {
    const results = await Promise.allSettled(
      this.scanners.map(s => s.scan()),
    )
    const signals: Signal[] = []
    for (const result of results) {
      if (result.status === 'fulfilled') {
        signals.push(...result.value)
      }
    }
    return signals
  }

  get bufferSize(): number {
    return this.scanners.reduce((sum, s) => sum + s.bufferSize, 0)
  }
}
