import { describe, expect, it, mock } from 'bun:test'
import { TextWriter } from '../src/pipeline/text-writer.js'
import type { ContentConcept } from '../src/types.js'

function makeConcept(overrides: Partial<ContentConcept> = {}): ContentConcept {
  return {
    id: 'concept-1',
    topicId: 'topic-1',
    visual: 'A tense diplomatic table with rival delegations facing each other.',
    composition: 'Wide shot, clear focal point, restrained editorial composition.',
    caption: 'The room is quiet. The stakes are not.',
    approach: 'Editorial analysis',
    reasoning: 'Translate geopolitical tension into a single legible scene.',
    referenceImageUrls: [],
    ...overrides,
  }
}

function makeEvents() {
  return {
    transition: mock((_state: string) => {}),
    monologue: mock((_message: string) => {}),
  }
}

function makeConfig() {
  return {
    modelId: () => 'test-model',
    model: () => 'test-model',
  }
}

describe('TextWriter', () => {
  it('builds a structured article with header and inline article images', async () => {
    const events = makeEvents()
    const illustrator = {
      generate: mock(async (concept: ContentConcept) => ({
        variants: [`/tmp/${concept.id}.png`],
        prompt: `prompt:${concept.id}`,
      })),
    }

    let sectionCall = 0
    const runInference = mock(async (opts: Record<string, any>) => {
      if (opts.operation === 'write_article_outline') {
        return {
          output: {
            thesis: 'Power is shifting faster than institutions can absorb.',
            hook: 'The headlines say crisis. The real story is coordination failure.',
            sections: [
              {
                title: 'The first fracture',
                keyArgument: 'Alliance discipline is eroding.',
                evidence: 'Public disagreements and staggered sanctions.',
                transition: 'That fracture creates space for opportunists.',
              },
              {
                title: 'The opportunists move',
                keyArgument: 'Regional players exploit great-power hesitation.',
                evidence: 'Proxy escalation and shipping disruptions.',
                transition: 'Readers should watch the signal, not the noise.',
              },
            ],
            conclusion: 'The next moves matter more than today’s rhetoric.',
          },
        }
      }

      if (opts.operation === 'write_article_section') {
        sectionCall += 1
        return {
          text: sectionCall === 1
            ? 'The coalition is visibly straining.\n\nThat matters because deterrence depends on credible unity.'
            : 'Secondary actors are testing limits in real time.',
        }
      }

      if (opts.operation === 'write_article_headline') {
        return {
          output: {
            options: [
              { headline: 'The Quiet Break in the Coalition', subtitle: 'Why the strain matters more than the sound bites.' },
            ],
            bestIndex: 0,
          },
        }
      }

      throw new Error(`Unexpected operation: ${opts.operation}`)
    })

    const writer = new TextWriter(
      events as any,
      makeConfig() as any,
      {
        name: 'Kenji',
        tagline: 'Testing',
        creator: '@creator',
        constitution: 'constitution',
        persona: 'Analyst',
        beliefs: [],
        themes: [],
        punchesUp: [],
        respects: [],
        voice: 'plain',
        restrictions: [],
        motto: 'test',
      },
      illustrator,
      runInference as any,
    )

    const article = await writer.write(makeConcept(), {
      targetLength: 'medium',
      style: 'analysis',
      existingHeaderImagePath: '/tmp/header.png',
    })

    expect(article.title).toBe('The Quiet Break in the Coalition')
    expect(article.images.map((image) => image.imagePath)).toEqual([
      '/tmp/header.png',
      '/tmp/concept-1-article-1-the-first-fracture.png',
      '/tmp/concept-1-article-2-the-opportunists-move.png',
    ])
    expect(article.sections.map((section) => section.type)).toEqual([
      'image',
      'paragraph',
      'heading',
      'paragraph',
      'paragraph',
      'image',
      'heading',
      'paragraph',
      'image',
      'paragraph',
    ])
    expect(article.body).toContain('## The first fracture')
    expect(article.body).toContain('## The opportunists move')
    expect(illustrator.generate).toHaveBeenCalledTimes(2)
  })

  it('keeps writing when an inline illustration fails', async () => {
    const events = makeEvents()
    let imageCall = 0
    const illustrator = {
      generate: mock(async () => {
        imageCall += 1
        if (imageCall === 2) {
          throw new Error('image backend timeout')
        }
        return {
          variants: [`/tmp/image-${imageCall}.png`],
          prompt: `prompt-${imageCall}`,
        }
      }),
    }

    let sectionCall = 0
    const runInference = mock(async (opts: Record<string, any>) => {
      if (opts.operation === 'write_article_outline') {
        return {
          output: {
            thesis: 'Systems fail gradually, then visibly.',
            hook: 'What looks sudden usually spent months becoming inevitable.',
            sections: [
              {
                title: 'Pressure builds',
                keyArgument: 'Decision-makers ignored slow-moving signals.',
                evidence: 'Months of contradictory messaging.',
                transition: 'Then came the external stress test.',
              },
              {
                title: 'The break becomes visible',
                keyArgument: 'Markets and ministries react once ambiguity collapses.',
                evidence: 'Emergency meetings and tariff threats.',
                transition: 'The lesson is structural, not episodic.',
              },
            ],
            conclusion: 'The next rupture will look obvious in hindsight too.',
          },
        }
      }

      if (opts.operation === 'write_article_section') {
        sectionCall += 1
        return { text: `Section body ${sectionCall}` }
      }

      if (opts.operation === 'write_article_headline') {
        return {
          output: {
            options: [{ headline: 'The Break Wasn’t Sudden', subtitle: 'The warning signs were there long before the headlines.' }],
            bestIndex: 0,
          },
        }
      }

      throw new Error(`Unexpected operation: ${opts.operation}`)
    })

    const writer = new TextWriter(
      events as any,
      makeConfig() as any,
      {
        name: 'Kenji',
        tagline: 'Testing',
        creator: '@creator',
        constitution: 'constitution',
        persona: 'Analyst',
        beliefs: [],
        themes: [],
        punchesUp: [],
        respects: [],
        voice: 'plain',
        restrictions: [],
        motto: 'test',
      },
      illustrator,
      runInference as any,
    )

    const article = await writer.write(makeConcept())

    expect(article.images.map((image) => image.imagePath)).toEqual([
      '/tmp/image-1.png',
      '/tmp/image-3.png',
    ])
    expect(article.body).toContain('Section body 1')
    expect(article.body).toContain('Section body 2')
    expect(events.monologue).toHaveBeenCalledWith('Inline illustration failed for "Pressure builds": image backend timeout')
  })
})
