import { describe, expect, it } from 'bun:test'
import { createPipelineState, getPostsNewestFirst, getRecentPostTexts } from '../src/process/state.js'

describe('pipeline state post ordering', () => {
  it('hydrates stored posts oldest-to-newest within the retained window', () => {
    const state = createPipelineState({
      query: () => ({
        all: () => [
          { id: '3', platform_id: 'p3', text: 'newest', type: 'article', posted_at: 300 },
          { id: '2', platform_id: 'p2', text: 'middle', type: 'article', posted_at: 200 },
          { id: '1', platform_id: 'p1', text: 'oldest', type: 'article', posted_at: 100 },
        ],
      }),
    })

    expect(state.allPosts.map((post) => post.text)).toEqual(['oldest', 'middle', 'newest'])
  })

  it('returns recent post text from the newest end without mutating the source array', () => {
    const posts = [
      { id: '1', platformId: 'p1', text: 'oldest', type: 'article', postedAt: 100, engagement: { likes: 0, shares: 0, comments: 0, views: 0, lastChecked: 0 } },
      { id: '2', platformId: 'p2', text: 'middle', type: 'article', postedAt: 200, engagement: { likes: 0, shares: 0, comments: 0, views: 0, lastChecked: 0 } },
      { id: '3', platformId: 'p3', text: 'newest', type: 'article', postedAt: 300, engagement: { likes: 0, shares: 0, comments: 0, views: 0, lastChecked: 0 } },
    ]

    expect(getRecentPostTexts(posts as any, 2)).toEqual(['middle', 'newest'])
    expect(posts.map((post) => post.text)).toEqual(['oldest', 'middle', 'newest'])
    expect(getPostsNewestFirst(posts as any).map((post) => post.text)).toEqual(['newest', 'middle', 'oldest'])
    expect(posts.map((post) => post.text)).toEqual(['oldest', 'middle', 'newest'])
  })
})
