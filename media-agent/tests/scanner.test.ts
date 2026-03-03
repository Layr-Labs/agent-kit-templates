import { test, expect, describe } from 'bun:test'
import { TwitterScanner } from '../src/scanner/index.js'
import { EventBus } from '../src/console/events.js'
import { Cache } from '../src/cache/cache.js'
import { join } from 'path'
import { mkdtemp } from 'fs/promises'
import { tmpdir } from 'os'

// Mock TwitterReadProvider that returns empty results
const mockProvider = {
  name: 'mock-v2',
  search: async () => ({ tweets: [], has_next_page: false, next_cursor: '' }),
  getMentions: async () => ({ tweets: [], has_next_page: false, next_cursor: '' }),
  getUserInfo: async () => null,
  getFollowers: async () => ({ followers: [], has_next_page: false, next_cursor: '' }),
  getUserTweets: async () => ({ tweets: [], has_next_page: false, next_cursor: '' }),
  findTopTweet: async () => undefined,
  getTweetById: async () => null,
}

describe('TwitterScanner', () => {
  test('creates without crashing', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'scanner-test-'))
    const events = new EventBus(join(tempDir, 'console.jsonl'))
    await events.init()
    const cache = new Cache<any>('signals', 100, join(tempDir, 'cache.json'))

    const scanner = new TwitterScanner(
      events, mockProvider, cache, 'fake-bearer-token',
      { newsTtlMs: 60000, timelineTtlMs: 30000 },
    )

    expect(scanner.name).toBe('twitter')
    expect(scanner.bufferSize).toBe(0)
  })

  test('scan returns signals array (empty with mocked APIs)', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'scanner-test-'))
    const events = new EventBus(join(tempDir, 'console.jsonl'))
    await events.init()
    const cache = new Cache<any>('signals', 100, join(tempDir, 'cache.json'))

    const scanner = new TwitterScanner(
      events, mockProvider, cache, 'fake-bearer-token',
      { newsTtlMs: 60000, timelineTtlMs: 30000 },
    )

    // Scan will fail on Grok API (no real bearer token) but shouldn't crash
    const signals = await scanner.scan()
    expect(Array.isArray(signals)).toBe(true)
  })

  test('deduplicates signals across scans', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'scanner-test-'))
    const events = new EventBus(join(tempDir, 'console.jsonl'))
    await events.init()
    const cache = new Cache<any>('signals', 100, join(tempDir, 'cache.json'))

    const scanner = new TwitterScanner(
      events, mockProvider, cache, 'fake-bearer-token',
      { newsTtlMs: 60000, timelineTtlMs: 30000 },
    )

    const signals1 = await scanner.scan()
    const signals2 = await scanner.scan()

    // Second scan should not add duplicates
    expect(signals2.length).toBe(signals1.length)
  })
})
