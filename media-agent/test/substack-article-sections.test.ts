import { describe, expect, it, mock } from 'bun:test'
import { buildArticleSections } from '../src/platform/substack/helpers.js'
import type { WrittenArticle } from '../src/types.js'

function makeArticle(): WrittenArticle {
  return {
    title: 'Signal over noise',
    subtitle: 'Testing structured article publishing.',
    body: 'Signal over noise',
    sections: [
      { type: 'image', imageId: 'header' },
      { type: 'paragraph', text: 'Opening paragraph.' },
      { type: 'heading', text: 'Why it matters', level: 2 },
      { type: 'paragraph', text: 'Because structure matters.' },
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
        imagePath: '/tmp/inline-1.png',
        alt: 'Inline alt',
        caption: 'Inline caption',
        placement: 'inline',
        anchorHeading: 'Why it matters',
      },
    ],
  }
}

describe('buildArticleSections', () => {
  it('preserves article order and uploads local article images', async () => {
    const uploadImage = mock(async (filePath: string) => `https://cdn.example/${filePath.split('/').pop()}`)

    const sections = await buildArticleSections(makeArticle(), { uploadImage })

    expect(sections).toEqual([
      { type: 'image', src: 'https://cdn.example/header.png', alt: 'Header alt', caption: undefined },
      { type: 'paragraph', text: 'Opening paragraph.' },
      { type: 'heading', text: 'Why it matters', level: 2 },
      { type: 'paragraph', text: 'Because structure matters.' },
      { type: 'image', src: 'https://cdn.example/inline-1.png', alt: 'Inline alt', caption: 'Inline caption' },
    ])
    expect(uploadImage.mock.calls.map(([filePath]) => filePath)).toEqual([
      '/tmp/header.png',
      '/tmp/inline-1.png',
    ])
  })

  it('skips broken image assets without dropping the text sections', async () => {
    const errors: string[] = []
    const uploadImage = mock(async (filePath: string) => {
      if (filePath.endsWith('inline-1.png')) throw new Error('upload failed')
      return `https://cdn.example/${filePath.split('/').pop()}`
    })

    const sections = await buildArticleSections(makeArticle(), {
      uploadImage,
      onImageError: (message) => errors.push(message),
    })

    expect(sections).toEqual([
      { type: 'image', src: 'https://cdn.example/header.png', alt: 'Header alt', caption: undefined },
      { type: 'paragraph', text: 'Opening paragraph.' },
      { type: 'heading', text: 'Why it matters', level: 2 },
      { type: 'paragraph', text: 'Because structure matters.' },
    ])
    expect(errors).toEqual([
      'Article image "inline-1" failed to upload: upload failed',
    ])
  })
})
