import { generateText, Output } from 'ai'
import { gateway } from 'ai'
import { z } from 'zod'
import type { SubstackClient } from './client.js'
import { EventBus } from '../../console/events.js'
import { buildPersonaPrompt } from '../../prompts/identity.js'
import type { AgentIdentity } from '../../types.js'

const replyDecisionSchema = z.object({
  replies: z.array(z.object({
    commentId: z.string(),
    shouldReply: z.boolean(),
    replyText: z.string().optional(),
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
    // Skip engagement if we haven't published anything yet — no comments to check
    if (!this.hasPublishedContent) {
      this.events.monologue('No published content yet — skipping engagement check.')
      return
    }

    this.events.transition('engaging')

    const comments = await this.client.getRecentComments()
    if (comments.length === 0) {
      this.events.monologue('No new comments to respond to.')
      return
    }

    this.events.monologue(`${comments.length} comments to review...`)

    const { output: object } = await generateText({
      model: gateway(this.model),
      output: Output.object({ schema: replyDecisionSchema }),
      system: `${this.personaPrompt}\n\nYou are reviewing reader comments on your Substack newsletter. Decide which comments deserve a reply. Reply to comments that are thoughtful, ask genuine questions, or offer interesting perspectives. Skip spam, generic praise, or comments that don't warrant engagement. Keep replies conversational and in your authentic voice.`,
      prompt: `Recent comments:\n\n${comments.map((c, i) => `[${c.id}] ${c.author}: "${c.text}" (on post: ${c.postSlug})`).join('\n\n')}\n\nWhich should I reply to?`,
    })
    if (!object) return

    for (const decision of object.replies) {
      if (decision.shouldReply && decision.replyText) {
        try {
          await this.client.replyToComment(decision.commentId, decision.replyText)
          this.events.emit({
            type: 'engage',
            targetId: decision.commentId,
            text: decision.replyText,
            ts: Date.now(),
          })
        } catch (err) {
          this.events.monologue(`Failed to reply to comment ${decision.commentId}: ${(err as Error).message}`)
        }
      }
    }
  }

  markContentPublished(): void {
    this.hasPublishedContent = true
  }
}
