import { describe, expect, it, mock } from 'bun:test'
import type { WrittenArticle } from '../src/types.js'

function makeArticle(): WrittenArticle {
  return {
    title: 'The Structure Is the Story',
    subtitle: 'A test article with embedded images.',
    body: 'Lead paragraph.\n\n## Why it matters\n\nBecause the structure matters.',
    sections: [
      { type: 'image', imageId: 'header' },
      { type: 'paragraph', text: 'Lead paragraph.' },
      { type: 'heading', text: 'Why it matters', level: 2 },
      { type: 'paragraph', text: 'Because the structure matters.' },
      { type: 'image', imageId: 'inline-1' },
    ],
    images: [
      {
        id: 'header',
        prompt: 'lead prompt',
        imagePath: '/tmp/header.png',
        alt: 'Header alt',
        placement: 'header',
      },
      {
        id: 'inline-1',
        prompt: 'inline prompt',
        imagePath: '/tmp/inline.png',
        alt: 'Inline alt',
        placement: 'inline',
        anchorHeading: 'Why it matters',
      },
    ],
  }
}

describe('publisher publish_article', () => {
  it('passes the rich article payload to the platform and stores the header image', async () => {
    const publish = mock(async () => ({
      platformId: 'article-123',
      url: 'https://example.substack.com/p/article-123',
    }))
    const dbRun = mock(() => {})

    const skill = (await import('../src/skills/pipeline/publisher/index.js')).default
    const tools = await skill.init({
      platform: { publish },
      state: {
        article: makeArticle(),
        bestConcept: {
          id: 'concept-1',
          topicId: 'topic-1',
          visual: 'Visual',
          composition: 'Composition',
          caption: 'Caption',
          approach: 'Analysis',
          reasoning: 'Reasoning',
        },
        critique: null,
        imagePrompt: null,
        imagePaths: [],
        allContent: [],
        allPosts: [],
      },
      db: { run: dbRun },
      events: {
        transition: mock((_state: string) => {}),
        emit: mock((_event: Record<string, unknown>) => {}),
        monologue: mock((_message: string) => {}),
      },
    } as any)

    const result = await tools.publish_article.execute({})

    expect(publish).toHaveBeenCalledTimes(1)
    expect(publish.mock.calls[0]?.[0]).toMatchObject({
      contentType: 'article',
      text: makeArticle().body,
      imagePath: '/tmp/header.png',
      article: makeArticle(),
      metadata: {
        title: 'The Structure Is the Story',
        subtitle: 'A test article with embedded images.',
      },
    })
    expect(result).toEqual({
      platformId: 'article-123',
      url: 'https://example.substack.com/p/article-123',
      title: 'The Structure Is the Story',
    })

    expect(dbRun).toHaveBeenCalledTimes(1)
    const insertArgs = dbRun.mock.calls[0]
    expect(insertArgs?.[1]?.[5]).toBe('/tmp/header.png')
  })
})
