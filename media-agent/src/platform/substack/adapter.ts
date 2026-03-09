import type { EventBus } from '../../console/events.js'
import type { PlatformAdapter, PublishOptions, PublishResult, Scanner } from '../types.js'
import type { SubstackClient } from 'substack-skill'
import type { SubstackEngagement } from './engagement.js'
import type { SubstackScanner } from './scanner/index.js'

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
    const { PostBuilder } = await import('substack-skill')

    if (opts.contentType === 'article') {
      const metadata = opts.metadata as { title?: string; subtitle?: string } | undefined
      const title = metadata?.title ?? 'Untitled'
      const builder = new PostBuilder()

      // Header image
      if (opts.imagePath) {
        try {
          const { readFileSync } = await import('fs')
          const buffer = readFileSync(opts.imagePath)
          const filename = opts.imagePath.split('/').pop() ?? 'image.png'
          const uploaded = await this.client.uploadImage(buffer, filename)
          builder.image(uploaded.url, title)
        } catch (err) {
          this.events.monologue(`Header image upload failed: ${(err as Error).message}`)
        }
      }

      // Article body — split into paragraphs
      for (const paragraph of opts.text.split('\n\n').filter(Boolean)) {
        builder.paragraph(paragraph)
      }

      const draft = await this.client.createDraft({
        title,
        subtitle: metadata?.subtitle,
        body: builder.build(),
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
        const { readFileSync } = await import('fs')
        const buffer = readFileSync(opts.imagePath)
        const filename = opts.imagePath.split('/').pop() ?? 'image.png'
        const uploaded = await this.client.uploadImage(buffer, filename)
        const attachment = await this.client.attachImage(uploaded.url)
        attachmentIds = [attachment.id]
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

  async engage(): Promise<void> {
    await this.engagement.check()
  }

  getScanner(): Scanner {
    return this.substackScanner
  }
}
