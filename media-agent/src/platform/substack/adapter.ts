import type { EventBus } from '../../console/events.js'
import type { PlatformAdapter, PublishOptions, PublishResult, Scanner } from '../types.js'
import type { SubstackClient } from 'substack-skill'
import type { SubstackEngagement } from './engagement.js'
import type { SubstackScanner } from './scanner/index.js'
import { buildArticleBody, buildPostBody, uploadImageFromPath, uploadAndAttachImage, type Section } from './helpers.js'

export class SubstackAdapter implements PlatformAdapter {
  readonly name = 'substack'

  constructor(
    private client: SubstackClient,
    private engagement: SubstackEngagement,
    private substackScanner: SubstackScanner,
    private events: EventBus,
  ) {}

  async init(_events: EventBus): Promise<void> {}

  supportedContentTypes(): ('article' | 'image')[] {
    return ['article', 'image']
  }

  async publish(opts: PublishOptions): Promise<PublishResult> {
    if (opts.contentType === 'article') {
      const metadata = opts.metadata as { title?: string; subtitle?: string } | undefined
      const title = metadata?.title ?? 'Untitled'
      const body = opts.article
        ? await buildArticleBody(this.client, opts.article, {
          onImageError: (message) => this.events.monologue(message),
        })
        : await buildPostBody(await this.buildFallbackSections(opts.text, opts.imagePath, title))

      const draft = await this.client.createDraft({
        title,
        subtitle: metadata?.subtitle,
        body,
        audience: 'everyone',
      })

      const published = await this.client.publishDraft(draft.id)
      this.engagement.markContentPublished()

      return {
        platformId: published.slug ?? String(published.id),
        url: published.canonical_url,
      }
    }

    // Note (short-form)
    let attachmentIds: string[] | undefined

    if (opts.imagePath) {
      try {
        attachmentIds = [await uploadAndAttachImage(this.client, opts.imagePath)]
      } catch (err) {
        this.events.monologue(`Note image upload failed: ${(err as Error).message}`)
      }
    }

    const result = await this.client.postNote(opts.text, attachmentIds) as any
    this.engagement.markContentPublished()

    return {
      platformId: result?.id?.toString() ?? Date.now().toString(),
      url: result?.url,
    }
  }

  private async buildFallbackSections(text: string, headerImagePath: string | undefined, title: string): Promise<Section[]> {
    const sections: Section[] = []

    if (headerImagePath) {
      try {
        const uploaded = await uploadImageFromPath(this.client, headerImagePath)
        sections.push({
          type: 'image',
          src: uploaded.url,
          alt: title,
        })
      } catch (err) {
        this.events.monologue(`Header image upload failed: ${(err as Error).message}`)
      }
    }

    for (const chunk of text.split('\n\n').map((entry) => entry.trim()).filter(Boolean)) {
      const headingMatch = chunk.match(/^(#{1,6})\s+(.+)$/)
      if (headingMatch) {
        sections.push({
          type: 'heading',
          text: headingMatch[2].trim(),
          level: headingMatch[1].length,
        })
      } else {
        sections.push({
          type: 'paragraph',
          text: chunk,
        })
      }
    }

    return sections
  }

  async engage(): Promise<void> {
    await this.engagement.check()
  }

  getScanner(): Scanner {
    return this.substackScanner
  }
}
