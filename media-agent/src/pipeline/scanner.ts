import type { Signal } from '../types.js'

export interface Scanner {
  readonly name: string
  scan(): Promise<Signal[]>
  readonly bufferSize: number
}

export class ScannerRegistry {
  private scanners: Scanner[] = []

  register(scanner: Scanner): void {
    this.scanners.push(scanner)
  }

  async scan(): Promise<Signal[]> {
    const results = await Promise.allSettled(
      this.scanners.map(s => s.scan()),
    )
    const signals: Signal[] = []
    for (const result of results) {
      if (result.status === 'fulfilled') {
        signals.push(...result.value)
      } else {
        console.error(`Scanner failed:`, result.reason)
      }
    }
    return signals
  }

  get size(): number {
    return this.scanners.length
  }

  get names(): string[] {
    return this.scanners.map(s => s.name)
  }
}
