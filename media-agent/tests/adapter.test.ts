import { test, expect, describe } from 'bun:test'
import { TwitterAdapter } from '../src/platform/adapter.js'

describe('TwitterAdapter', () => {
  test('name is twitter', () => {
    const adapter = new TwitterAdapter(
      {} as any, // twitter client
      { check: async () => {} }, // engagement
      { name: 'twitter', scan: async () => [], bufferSize: 0 }, // scanner
    )
    expect(adapter.name).toBe('twitter')
  })

  test('supports image and video content types', () => {
    const adapter = new TwitterAdapter({} as any, { check: async () => {} }, { name: 'twitter', scan: async () => [], bufferSize: 0 })
    const types = adapter.supportedContentTypes()
    expect(types).toContain('image')
    expect(types).toContain('video')
    expect(types).not.toContain('article')
  })

  test('getScanner returns the twitter scanner', () => {
    const mockScanner = { name: 'twitter', scan: async () => [], bufferSize: 0 }
    const adapter = new TwitterAdapter({} as any, { check: async () => {} }, mockScanner)
    expect(adapter.getScanner()).toBe(mockScanner)
  })

  test('engage delegates to engagement loop', async () => {
    let engaged = false
    const adapter = new TwitterAdapter(
      {} as any,
      { check: async () => { engaged = true } },
      { name: 'twitter', scan: async () => [], bufferSize: 0 },
    )
    await adapter.engage()
    expect(engaged).toBe(true)
  })
})
