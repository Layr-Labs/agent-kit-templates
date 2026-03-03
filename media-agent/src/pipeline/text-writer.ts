import { generateText, generateObject } from 'ai'
import { z } from 'zod'
import type { ContentConcept, AgentIdentity } from '../types.js'
import { EventBus } from '../console/events.js'
import type { Config } from '../config/index.js'
import { buildArticleOutlinePrompt, buildArticleSectionPrompt, buildArticleHeadlinePrompt } from '../prompts/article.js'

const outlineSchema = z.object({
  thesis: z.string(),
  hook: z.string(),
  sections: z.array(z.object({
    title: z.string(),
    keyArgument: z.string(),
    evidence: z.string(),
    transition: z.string(),
  })),
  conclusion: z.string(),
})

const headlineSchema = z.object({
  options: z.array(z.object({
    headline: z.string(),
    subtitle: z.string(),
  })),
  bestIndex: z.number(),
})

export class TextWriter {
  private outlinePrompt: string
  private sectionPrompt: string
  private headlinePrompt: string

  constructor(
    private events: EventBus,
    private config: Config,
    identity: AgentIdentity,
  ) {
    this.outlinePrompt = buildArticleOutlinePrompt(identity)
    this.sectionPrompt = buildArticleSectionPrompt(identity)
    this.headlinePrompt = buildArticleHeadlinePrompt(identity)
  }

  async write(concept: ContentConcept, opts?: {
    targetLength?: 'short' | 'medium' | 'long'
    style?: 'essay' | 'analysis' | 'satire' | 'tutorial'
  }): Promise<{ title: string; body: string; subtitle: string }> {
    this.events.transition('writing')

    const wordTarget = opts?.targetLength === 'short' ? 500
      : opts?.targetLength === 'long' ? 3000
      : 1500

    this.events.monologue(`Writing article (~${wordTarget} words) for "${concept.caption}"...`)

    // Step 1: Generate outline
    const { object: outline } = await generateObject({
      model: this.config.model('writing'),
      schema: outlineSchema,
      system: this.outlinePrompt,
      prompt: `Create an outline for an article about:\n\n"${concept.visual}"\n\nAngle: ${concept.approach}\nReasoning: ${concept.reasoning}\n\nTarget length: ~${wordTarget} words. Style: ${opts?.style ?? 'essay'}.`,
    })

    this.events.monologue(`Outline ready: ${outline.sections.length} sections. Thesis: "${outline.thesis}"`)

    // Step 2: Write each section
    const sections: string[] = []
    sections.push(outline.hook)

    for (const section of outline.sections) {
      const { text } = await generateText({
        model: this.config.model('writing'),
        system: this.sectionPrompt,
        prompt: `Write this section of the article:\n\nTitle: ${section.title}\nKey argument: ${section.keyArgument}\nEvidence to include: ${section.evidence}\nTransition to next: ${section.transition}\n\nOverall thesis: ${outline.thesis}\nTarget: ~${Math.round(wordTarget / outline.sections.length)} words for this section.`,
      })
      // Strip any leading header the LLM added — we add our own
      const cleanText = text.replace(/^#{1,3}\s+.*\n+/, '').trim()
      sections.push(`## ${section.title}\n\n${cleanText}`)
    }

    sections.push(outline.conclusion)

    // Step 3: Generate headline
    const { object: headlines } = await generateObject({
      model: this.config.model('caption'),
      schema: headlineSchema,
      system: this.headlinePrompt,
      prompt: `Generate headline and subtitle for this article:\n\nThesis: ${outline.thesis}\n\nFirst paragraph:\n${outline.hook.slice(0, 300)}`,
    })

    const best = headlines.options[headlines.bestIndex]

    this.events.monologue(`Article complete: "${best.headline}"`)

    return {
      title: best.headline,
      subtitle: best.subtitle,
      body: sections.join('\n\n'),
    }
  }
}
