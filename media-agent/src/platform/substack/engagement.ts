import { Output, gateway } from 'ai'
import { z } from 'zod'
import type { SubstackClient } from 'substack-skill'
import type { EventBus } from '../../console/events.js'
import type { AgentIdentity } from '../../types.js'
import { buildPersonaPrompt } from '../../prompts/identity.js'
import { generateTrackedText } from '../../ai/tracking.js'

const engagementDecisionSchema = z.object({
  actions: z.array(z.object({
    commentId: z.number(),
    shouldReact: z.boolean(),
    reason: z.string(),
  })),
})

export class SubstackEngagement {
  private personaPrompt: string

  constructor(
    private client: SubstackClient,
    private events: EventBus,
    identity: AgentIdentity,
    private model: string = 'claude-haiku-4-5-20251001',
  ) {
    this.personaPrompt = buildPersonaPrompt(identity)
  }

  private hasPublishedContent = false

  async check(): Promise<void> {
    if (!this.hasPublishedContent) {
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
        modelId: this.model,
        model: gateway(this.model),
        output: Output.object({ schema: engagementDecisionSchema }),
        system: `${this.personaPrompt}\n\nYou are reviewing reader engagement on your Substack. Decide which comments to react to (heart). React to thoughtful comments, genuine questions, and interesting perspectives. Skip spam or generic comments.`,
        prompt: `Recent activity:\n\n${commentItems.map((item: any) =>
          `[${item.comment_id ?? item.id}] ${item.author_name ?? item.user_name ?? 'Unknown'}: "${item.body_text ?? item.summary ?? item.body ?? ''}" (${item.type ?? 'comment'})`
        ).join('\n\n')}\n\nWhich should I react to?`,
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
      }
    } catch (err) {
      this.events.monologue(`Engagement check failed: ${(err as Error).message}`)
    }
  }

  markContentPublished(): void {
    this.hasPublishedContent = true
  }
}
