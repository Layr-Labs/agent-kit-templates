import { Output } from 'ai'
import { z } from 'zod'
import type {
  ContentConcept,
  AgentIdentity,
  WrittenArticle,
  ArticleImageAsset,
  ArticleSection,
} from '../types.js'
import { EventBus } from '../console/events.js'
import type { Config } from '../config/index.js'
import { buildArticleOutlinePrompt, buildArticleSectionPrompt, buildArticleHeadlinePrompt } from '../prompts/article.js'
import { generateTrackedText } from '../ai/tracking.js'

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

interface ArticleIllustrator {
  generate(
    concept: ContentConcept,
    variantCount?: number,
  ): Promise<{ variants: string[]; prompt: string }>
}

export class TextWriter {
  private outlinePrompt: string
  private sectionPrompt: string
  private headlinePrompt: string

  constructor(
    private events: EventBus,
    private config: Config,
    identity: AgentIdentity,
    private illustrator?: ArticleIllustrator,
    private runInference: typeof generateTrackedText = generateTrackedText,
  ) {
    this.outlinePrompt = buildArticleOutlinePrompt(identity)
    this.sectionPrompt = buildArticleSectionPrompt(identity)
    this.headlinePrompt = buildArticleHeadlinePrompt(identity)
  }

  async write(concept: ContentConcept, opts?: {
    targetLength?: 'short' | 'medium' | 'long'
    style?: 'essay' | 'analysis' | 'satire' | 'tutorial'
    existingHeaderImagePath?: string
  }): Promise<WrittenArticle> {
    this.events.transition('writing')

    const wordTarget = opts?.targetLength === 'short' ? 500
      : opts?.targetLength === 'long' ? 3000
      : 1500

    this.events.monologue(`Writing article (~${wordTarget} words) for "${concept.caption}"...`)

    // Step 1: Generate outline
    const { output: outline } = await this.runInference({
      operation: 'write_article_outline',
      modelId: this.config.modelId('writing'),
      model: this.config.model('writing'),
      output: Output.object({ schema: outlineSchema }),
      system: this.outlinePrompt,
      prompt: `Create an outline for an article about:\n\n"${concept.visual}"\n\nAngle: ${concept.approach}\nReasoning: ${concept.reasoning}\n\nTarget length: ~${wordTarget} words. Style: ${opts?.style ?? 'essay'}.`,
    })
    if (!outline) throw new Error('Failed to generate article outline')

    this.events.monologue(`Outline ready: ${outline.sections.length} sections. Thesis: "${outline.thesis}"`)

    // Step 2: Build structured article + article illustrations
    const sections: ArticleSection[] = []
    const images: ArticleImageAsset[] = []

    const headerImage = await this.resolveHeaderImage(concept, opts?.existingHeaderImagePath)
    if (headerImage) {
      images.push(headerImage)
      sections.push({ type: 'image', imageId: headerImage.id })
    }

    this.appendParagraphs(sections, outline.hook)

    const inlineImageBudget = this.resolveInlineImageBudget(opts?.targetLength)

    for (const [index, section] of outline.sections.entries()) {
      const { text } = await this.runInference({
        operation: 'write_article_section',
        modelId: this.config.modelId('writing'),
        model: this.config.model('writing'),
        system: this.sectionPrompt,
        prompt: `Write this section of the article:\n\nTitle: ${section.title}\nKey argument: ${section.keyArgument}\nEvidence to include: ${section.evidence}\nTransition to next: ${section.transition}\n\nOverall thesis: ${outline.thesis}\nTarget: ~${Math.round(wordTarget / outline.sections.length)} words for this section.`,
      })
      // Strip any leading header the LLM added — we add our own
      const cleanText = text.replace(/^#{1,3}\s+.*\n+/, '').trim()
      sections.push({ type: 'heading', text: section.title, level: 2 })
      this.appendParagraphs(sections, cleanText)

      if (index < inlineImageBudget) {
        const image = await this.generateInlineImage(concept, section, index)
        if (image) {
          images.push(image)
          sections.push({ type: 'image', imageId: image.id })
        }
      }
    }

    this.appendParagraphs(sections, outline.conclusion)

    // Step 3: Generate headline
    const { output: headlines } = await this.runInference({
      operation: 'write_article_headline',
      modelId: this.config.modelId('caption'),
      model: this.config.model('caption'),
      output: Output.object({ schema: headlineSchema }),
      system: this.headlinePrompt,
      prompt: `Generate headline and subtitle for this article:\n\nThesis: ${outline.thesis}\n\nFirst paragraph:\n${outline.hook.slice(0, 300)}`,
    })
    if (!headlines) throw new Error('Failed to generate headlines')

    const best = headlines.options[headlines.bestIndex]

    this.events.monologue(`Article complete: "${best.headline}"`)

    return {
      title: best.headline,
      subtitle: best.subtitle,
      body: this.renderBody(sections),
      sections,
      images,
    }
  }

  private async resolveHeaderImage(
    concept: ContentConcept,
    existingHeaderImagePath?: string,
  ): Promise<ArticleImageAsset | null> {
    if (existingHeaderImagePath) {
      return {
        id: `${concept.id}-header`,
        prompt: '',
        imagePath: existingHeaderImagePath,
        alt: this.truncate(`Editorial illustration for ${concept.caption}`, 180),
        placement: 'header',
      }
    }

    if (!this.illustrator) return null

    try {
      const result = await this.illustrator.generate({
        ...concept,
        id: `${concept.id}-article-header`,
      }, 1)
      const imagePath = result.variants[0]
      if (!imagePath) return null

      this.events.monologue('Generated article lead image.')
      return {
        id: `${concept.id}-header`,
        prompt: result.prompt,
        imagePath,
        alt: this.truncate(`Editorial illustration for ${concept.caption}`, 180),
        placement: 'header',
      }
    } catch (err) {
      this.events.monologue(`Article lead image failed: ${(err as Error).message}`)
      return null
    }
  }

  private async generateInlineImage(
    concept: ContentConcept,
    section: z.infer<typeof outlineSchema>['sections'][number],
    index: number,
  ): Promise<ArticleImageAsset | null> {
    if (!this.illustrator) return null

    const slug = this.toSlug(section.title)
    const imageConcept: ContentConcept = {
      ...concept,
      id: `${concept.id}-article-${index + 1}-${slug}`,
      visual: `${concept.visual}\n\nSection focus: ${section.title}. ${section.keyArgument}`,
      composition: `Editorial illustration for the article section "${section.title}". ${concept.composition}`,
      caption: section.title,
      reasoning: `${concept.reasoning}\n\nIllustrate this article section's central idea: ${section.keyArgument}\nEvidence/context: ${section.evidence}`,
    }

    try {
      const result = await this.illustrator.generate(imageConcept, 1)
      const imagePath = result.variants[0]
      if (!imagePath) return null

      this.events.monologue(`Generated inline illustration for "${section.title}".`)
      return {
        id: `${concept.id}-inline-${index + 1}-${slug}`,
        prompt: result.prompt,
        imagePath,
        alt: this.truncate(`Illustration for section "${section.title}"`, 180),
        placement: 'inline',
        anchorHeading: section.title,
      }
    } catch (err) {
      this.events.monologue(`Inline illustration failed for "${section.title}": ${(err as Error).message}`)
      return null
    }
  }

  private resolveInlineImageBudget(length: 'short' | 'medium' | 'long' | undefined): number {
    if (!this.illustrator) return 0
    if (length === 'short') return 1
    if (length === 'long') return 3
    return 2
  }

  private appendParagraphs(sections: ArticleSection[], text: string): void {
    for (const paragraph of text.split(/\n\s*\n/g).map((entry) => entry.trim()).filter(Boolean)) {
      sections.push({ type: 'paragraph', text: paragraph })
    }
  }

  private renderBody(sections: ArticleSection[]): string {
    return sections
      .flatMap((section) => {
        if (section.type === 'heading') return [`${'#'.repeat(section.level)} ${section.text}`]
        if (section.type === 'paragraph') return [section.text]
        return []
      })
      .join('\n\n')
      .trim()
  }

  private toSlug(input: string): string {
    const slug = input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32)
    return slug || 'section'
  }

  private truncate(value: string, maxLength: number): string {
    if (value.length <= maxLength) return value
    return `${value.slice(0, maxLength - 1)}…`
  }
}
