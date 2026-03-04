import type { EventBus } from '../../console/events.js'
import type { PlatformAdapter, PublishOptions, PublishResult, Scanner } from '../types.js'
import type { SubstackClient } from './client.js'
import type { SubstackEngagement } from './engagement.js'
import type { SubstackScanner } from './scanner/index.js'

export class SubstackAdapter implements PlatformAdapter {
  readonly name = 'substack'

  constructor(
    private client: SubstackClient,
    private engagement: SubstackEngagement,
    private substackScanner: SubstackScanner,
  ) {}

  async init(events: EventBus): Promise<void> {}

  supportedContentTypes(): ('article' | 'image')[] {
    return ['article', 'image']
  }

  async publish(opts: PublishOptions): Promise<PublishResult> {
    if (opts.contentType === 'article') {
      const metadata = opts.metadata as { title?: string; subtitle?: string } | undefined
      const result = await this.client.publishArticle({
        title: metadata?.title ?? 'Untitled',
        body: opts.text,
        subtitle: metadata?.subtitle,
        headerImagePath: opts.imagePath,
      })
      return { platformId: result.slug, url: result.url }
    }

    const result = await this.client.publishNote({
      text: opts.text,
      imagePath: opts.imagePath,
    })
    return { platformId: result.id, url: result.url }
  }

  async engage(): Promise<void> {
    await this.engagement.check()
  }

  getScanner(): Scanner {
    return this.substackScanner
  }
}
