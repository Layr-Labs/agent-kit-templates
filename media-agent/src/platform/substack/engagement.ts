import { Output } from 'ai'
import { z } from 'zod'
import type { SubstackClient } from 'substack-skill'
import type { EventBus } from '../../console/events.js'
import type { Config } from '../../config/index.js'
import type { AgentIdentity } from '../../types.js'
import { buildPersonaPrompt } from '../../prompts/identity.js'
import { generateTrackedText } from '../../ai/tracking.js'
import { replyToComment } from './helpers.js'

const engagementDecisionSchema = z.object({
  actions: z.array(z.object({
    commentId: z.number(),
    shouldReact: z.boolean(),
    shouldReply: z.boolean(),
    replyDraft: z.string().optional(),
    reason: z.string(),
  })),
})

export class SubstackEngagement {
  private personaPrompt: string
  private hasPublishedSinceBoot = false

  constructor(
    private client: SubstackClient,
    private events: EventBus,
    private config: Config,
    identity: AgentIdentity,
    private hasPublishedContent?: () => boolean,
  ) {
    this.personaPrompt = buildPersonaPrompt(identity)
  }

  async check(): Promise<void> {
    const hasPublishedContent = this.hasPublishedSinceBoot || this.hasPublishedContent?.() === true
    if (!hasPublishedContent) {
      this.events.monologue('No published content yet — skipping engagement check.')
      return
    }

    this.events.transition('engaging')

    try {
      const unread = await this.client.getUnreadActivity() as any
      const items = unread?.items ?? unread ?? []

      if (!Array.isArray(items) || items.length === 0) {
        this.events.monologue('No new activity to engage with.')
        return
      }

      // Filter for comment-type activity
      const commentItems = items.filter(
        (item: any) => item.type === 'comment' || item.type === 'reaction' || item.comment_id,
      )

      if (commentItems.length === 0) {
        this.events.monologue('No new comments to respond to.')
        return
      }

      this.events.monologue(`${commentItems.length} engagement items to review...`)

      const { output: object } = await generateTrackedText({
        operation: 'substack_engagement',
        modelId: this.config.modelId('engagement'),
        model: this.config.model('engagement'),
        output: Output.object({ schema: engagementDecisionSchema }),
        system: `${this.personaPrompt}\n\n<engagement_task platform="substack">\n  <task>Decide how to engage with each comment — react (heart), reply, both, or skip.</task>\n  <react_to>Thoughtful comments, genuine questions, and interesting perspectives.</react_to>\n  <reply_to>Comments that ask a direct question, raise an interesting point worth expanding on, or where a substantive reply would add value. Write the reply draft in your voice.</reply_to>\n  <skip>Spam, generic praise, or low-effort comments.</skip>\n</engagement_task>`,
        prompt: `<recent_activity>\n${commentItems.map((item: any) =>
          `  <item id="${item.comment_id ?? item.id}" author="${item.author_name ?? item.user_name ?? 'Unknown'}" type="${item.type ?? 'comment'}">${item.body_text ?? item.summary ?? item.body ?? ''}</item>`
        ).join('\n')}\n</recent_activity>\n\nHow should I engage with each comment?`,
      })

      if (!object) return

      for (const action of object.actions) {
        if (action.shouldReact && action.commentId) {
          try {
            await this.client.reactToComment(action.commentId)
            this.events.emit({
              type: 'engage',
              targetId: String(action.commentId),
              text: '\u2764\ufe0f',
              ts: Date.now(),
            })
          } catch (err) {
            this.events.monologue(`Failed to react to comment ${action.commentId}: ${(err as Error).message}`)
          }
        }

        if (action.shouldReply && action.replyDraft && action.commentId) {
          try {
            await replyToComment(this.client, action.commentId, action.replyDraft)
            this.events.emit({
              type: 'engage',
              targetId: String(action.commentId),
              text: action.replyDraft.slice(0, 280),
              ts: Date.now(),
            })
          } catch (err) {
            this.events.monologue(`Failed to reply to comment ${action.commentId}: ${(err as Error).message}`)
          }
        }
      }
    } catch (err) {
      this.events.monologue(`Engagement check failed: ${(err as Error).message}`)
    }
  }

  markContentPublished(): void {
    this.hasPublishedSinceBoot = true
  }
}
