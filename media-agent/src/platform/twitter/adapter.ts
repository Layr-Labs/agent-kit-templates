import type { EventBus } from '../../console/events.js'
import type { PlatformAdapter, PublishOptions, PublishResult, Scanner } from '../types.js'
import type { TwitterClient } from './client.js'

export class TwitterAdapter implements PlatformAdapter {
  readonly name = 'twitter'

  constructor(
    private twitter: TwitterClient,
    private engagementLoop: { check: () => Promise<void> },
    private twitterScanner: Scanner,
  ) {}

  async init(events: EventBus): Promise<void> {}

  supportedContentTypes(): ('image' | 'video')[] {
    return ['image', 'video']
  }

  async publish(opts: PublishOptions): Promise<PublishResult> {
    if (opts.videoPath) {
      const tweetId = await this.twitter.postVideo({
        text: opts.text,
        videoPath: opts.videoPath,
        quoteTweetId: opts.referenceId,
      })
      return { platformId: tweetId, url: `https://x.com/i/status/${tweetId}` }
    }

    const tweetId = await this.twitter.postCartoon({
      text: opts.text,
      imagePath: opts.imagePath!,
      quoteTweetId: opts.referenceId,
    })
    return { platformId: tweetId, url: `https://x.com/i/status/${tweetId}` }
  }

  async engage(): Promise<void> {
    await this.engagementLoop.check()
  }

  getScanner(): Scanner {
    return this.twitterScanner
  }

  async findReference(topicSummary: string): Promise<string | undefined> {
    try {
      return await this.twitter.provider.findTopTweet(topicSummary, 100)
    } catch {
      return undefined
    }
  }
}
