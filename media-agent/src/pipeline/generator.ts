import { generateText, Output } from 'ai'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { z } from 'zod'
import sharp from 'sharp'
import { uploadToR2 } from '../cdn/r2.js'
import type { ContentConcept, AgentIdentity } from '../types.js'
import { Cache } from '../cache/cache.js'
import { EventBus } from '../console/events.js'
import type { Config } from '../config/index.js'
import { buildStylePrompt, type StyleConfig } from '../prompts/style.js'

const subjectExtractionSchema = z.object({
  subjects: z.array(z.object({
    name: z.string().describe('Full name or product name'),
    type: z.enum(['person', 'product', 'company', 'other']),
  })),
})

export class Generator {
  private imageDir: string
  private signatureBuffer: Buffer | null = null
  private refImageCache = new Map<string, string>()
  private stylePrompt: string

  constructor(
    private events: EventBus,
    private imageCache: Cache,
    private config: Config,
    private identity: AgentIdentity,
    private style?: StyleConfig,
    private signaturePath?: string,
  ) {
    this.imageDir = join(config.dataDir, 'images')
    this.stylePrompt = style ? buildStylePrompt(style) : ''
  }

  async init(): Promise<void> {
    await mkdir(this.imageDir, { recursive: true })
    if (this.signaturePath) {
      try {
        this.signatureBuffer = await readFile(this.signaturePath)
      } catch {
        this.events.monologue('Signature file not found — content will be unsigned.')
      }
    }
  }

  async generate(
    concept: ContentConcept,
    variantCount: number = this.config.imageVariants,
  ): Promise<{ variants: string[]; prompt: string }> {
    this.events.transition('generating')

    const prompt = this.buildPrompt(concept)
    const cacheKey = Cache.key(`img:${prompt}`)
    const cached = this.imageCache.get(cacheKey) as { variants: string[] } | null
    if (cached) {
      this.events.monologue('Using cached image variants.')
      return { variants: cached.variants, prompt }
    }

    this.events.monologue(`Generating ${variantCount} image variants...`)
    this.events.emit({
      type: 'generate',
      prompt: prompt.slice(0, 200),
      variantCount,
      ts: Date.now(),
    })

    const variants: string[] = []

    for (let i = 0; i < variantCount; i++) {
      try {
        const refImages = i === 0 ? await this.findReferenceImages(concept) : (concept.referenceImageUrls ?? [])
        const messages = this.buildMessages(prompt, refImages)
        const { files } = await generateText({
          model: this.config.model('generation'),
          messages,
        })

        if (files && files.length > 0) {
          const file = files[0]
          const filename = `${concept.id}-v${i + 1}.png`
          const filepath = join(this.imageDir, filename)
          const raw = Buffer.from(file.uint8Array)
          const signed = await this.applySignature(raw)
          await writeFile(filepath, signed)
          uploadToR2(filepath, 'images', this.config.r2).catch(() => {})
          variants.push(filepath)
          this.events.monologue(`Variant ${i + 1}/${variantCount} generated.`)
        } else {
          this.events.monologue(`Variant ${i + 1}: no image returned.`)
        }
      } catch (err) {
        this.events.monologue(`Variant ${i + 1} failed: ${(err as Error).message}.`)
      }
    }

    if (variants.length > 0) {
      this.imageCache.set(cacheKey, { variants }, this.config.cache.imagePromptTtlMs)
    }

    return { variants, prompt }
  }

  async retry(
    concept: ContentConcept,
    feedback: string,
    attempt: number,
  ): Promise<{ variants: string[]; prompt: string }> {
    this.events.monologue(`Retry ${attempt}/${this.config.maxImageRetries}. Adjusting based on: ${feedback}`)
    const modified = {
      ...concept,
      composition: `${concept.composition}\n\nIMPORTANT ADJUSTMENT: ${feedback}`,
    }
    return this.generate(modified, 1)
  }

  private async findReferenceImages(concept: ContentConcept): Promise<string[]> {
    const urls: string[] = [...(concept.referenceImageUrls ?? [])]

    try {
      const { output: object } = await generateText({
        model: this.config.model('caption'),
        output: Output.object({ schema: subjectExtractionSchema }),
        prompt: `Extract named people, products, or companies from this concept that would benefit from a visual reference:\n\nVisual: ${concept.visual}\n\nOnly include specific, real, recognizable subjects.`,
      })
      if (!object) return urls

      for (const subject of object.subjects) {
        if (this.refImageCache.has(subject.name)) {
          urls.push(this.refImageCache.get(subject.name)!)
          continue
        }

        const wikiImage = await this.fetchWikipediaImage(subject.name)
        if (wikiImage) {
          this.refImageCache.set(subject.name, wikiImage)
          urls.push(wikiImage)
          this.events.monologue(`Found reference for ${subject.name} via Wikipedia`)
        }
      }
    } catch {
      // Subject extraction failed
    }

    return [...new Set(urls)].slice(0, 5)
  }

  private async fetchWikipediaImage(name: string): Promise<string | null> {
    const slug = name.replace(/\s+/g, '_')
    try {
      const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(slug)}`)
      if (!res.ok) return null
      const data = await res.json() as {
        originalimage?: { source: string }
        thumbnail?: { source: string }
      }
      return data.originalimage?.source ?? data.thumbnail?.source ?? null
    } catch {
      return null
    }
  }

  private buildMessages(prompt: string, referenceUrls: string[]): Array<{ role: 'user'; content: Array<{ type: 'text'; text: string } | { type: 'image'; image: URL }> }> {
    const content: Array<{ type: 'text'; text: string } | { type: 'image'; image: URL }> = []

    if (referenceUrls.length > 0) {
      content.push({
        type: 'text',
        text: 'REFERENCE IMAGES — use these for recognizable likenesses. Exaggerate for effect but keep the likeness.',
      })
      for (const url of referenceUrls) {
        try {
          content.push({ type: 'image', image: new URL(url) })
        } catch { /* invalid URL */ }
      }
    }

    content.push({ type: 'text', text: prompt })
    return [{ role: 'user' as const, content }]
  }

  private async applySignature(imageBuffer: Buffer): Promise<Buffer> {
    if (!this.signatureBuffer) return imageBuffer

    try {
      const image = sharp(imageBuffer)
      const { width } = await image.metadata()
      if (!width) return imageBuffer

      const sigWidth = Math.round(width * 0.12)
      const margin = Math.round(width * 0.02)

      const resizedSig = await sharp(this.signatureBuffer)
        .resize({ width: sigWidth, withoutEnlargement: true })
        .toBuffer()

      return image
        .composite([{
          input: resizedSig,
          gravity: 'northeast',
          top: margin,
          left: width - sigWidth - margin,
        }])
        .toBuffer()
    } catch {
      return imageBuffer
    }
  }

  private buildPrompt(concept: ContentConcept): string {
    const mood = this.inferMood(concept)

    return [
      this.stylePrompt,
      '',
      '---',
      '',
      `COLOR MOOD: ${mood}`,
      '',
      `APPROACH: ${concept.approach}`,
      '',
      `SCENE DESCRIPTION:`,
      concept.visual,
      '',
      `COMPOSITION:`,
      concept.composition,
      '',
      `REASONING:`,
      concept.reasoning,
      '',
      `CRITICAL REMINDERS:`,
      `- ZERO text in the image. No words, letters, signs, labels, or speech bubbles.`,
      `- Single panel, clean background`,
      `- Maximum 3 characters in frame`,
      `- Every element must serve the concept`,
    ].join('\n')
  }

  private inferMood(concept: ContentConcept): string {
    const text = `${concept.visual} ${concept.approach} ${concept.reasoning}`.toLowerCase()
    if (/tech|ai|robot|algorithm|data|digital|screen|phone|computer/.test(text)) {
      return 'COOL — slate blue, teal, muted purple, off-white.'
    }
    if (/chaos|urgent|breaking|disaster|fire|crash|panic/.test(text)) {
      return 'HOT — vermillion, amber, charcoal, white.'
    }
    if (/money|business|corporate|ceo|profit|market/.test(text)) {
      return 'CORPORATE — forest green, navy, gold, cream.'
    }
    return 'WARM — ochre, warm gray, dusty rose, cream.'
  }
}
