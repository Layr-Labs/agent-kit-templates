import { Output } from 'ai'
import { z } from 'zod'
import { readFile } from 'fs/promises'
import type { ContentConcept, Content, Post, AgentIdentity } from '../types.js'
import { EventBus } from '../console/events.js'
import type { Config } from '../config/index.js'
import { buildPersonaPrompt } from '../prompts/identity.js'
import { generateTrackedText } from '../ai/tracking.js'

const editorSchema = z.object({
  approved: z.boolean(),
  isDuplicate: z.boolean().describe('Is this too similar to a previous post?'),
  duplicateOf: z.string().optional().describe('Which previous post is it duplicating?'),
  imageApproved: z.boolean().describe('Does the image look good?'),
  imageIssues: z.string().optional().describe('What is wrong with the image if not approved'),
  captionApproved: z.boolean(),
  revisedCaption: z.string().optional().describe('Improved caption if needed'),
  qualityScore: z.number().describe('1-10 overall quality'),
  reason: z.string().describe('Editorial reasoning'),
})

export class Editor {
  private editorPrompt: string

  constructor(
    private events: EventBus,
    private config: Config,
    identity: AgentIdentity,
  ) {
    const persona = buildPersonaPrompt(identity)
    this.editorPrompt = `
${persona}

You are the EDITOR — a separate editorial intelligence that reviews every piece of content before it goes live.

Your job:

1. DUPLICATE CHECK — If this new content covers the same topic, same angle, or would feel repetitive, REJECT it.

2. QUALITY GATE — Is this actually good? Would someone share this? A score below 6 means reject.

3. CAPTION REVIEW — Is the caption punchy enough? If you can write a better one, provide it as revisedCaption.
   Keep it under ${config.maxCaptionLength} characters. No hashtags, no emojis.

4. IMAGE REVIEW — Check the generated image:
   - No text leaked into the image (instant reject)
   - The visual is clear and readable
   - Characters look intentional
   - Composition matches the concept

5. BRAND ALIGNMENT — Does this fit the agent's identity and themes?

Be HARSH. Better to reject mediocre content than publish something that dilutes the feed.
`
  }

  async review(
    concept: ContentConcept,
    caption: string,
    imagePath: string,
    allPastPosts: Post[],
    allPastContent: Content[],
  ): Promise<{
    approved: boolean
    caption: string
    reason: string
    qualityScore: number
  }> {
    this.events.monologue('Sending to editorial review...')

    const pastFeed = allPastPosts.map((p, i) => `${i + 1}. "${p.text}"`).join('\n')
    const pastTopics = allPastContent.map((c, i) => `${i + 1}. Topic: ${c.concept.visual} | Caption: "${c.caption}"`).join('\n')

    const textPrompt = [
      'CONTENT TO REVIEW:',
      `Visual concept: ${concept.visual}`,
      `Approach: ${concept.approach}`,
      `Reasoning: ${concept.reasoning}`,
      `Proposed caption: "${caption}"`,
      '',
      'The generated image is attached. Review BOTH.',
      '',
      `ALL PREVIOUS POSTS (${allPastPosts.length} total):`,
      pastFeed || '(none)',
      '',
      `PREVIOUS CONTENT TOPICS (${allPastContent.length} total):`,
      pastTopics || '(none)',
      '',
      'Should this be published?',
    ].join('\n')

    const content: Array<{ type: 'text'; text: string } | { type: 'image'; image: Uint8Array; mimeType: string }> = []

    try {
      const imageBuffer = await readFile(imagePath)
      content.push({ type: 'image', image: new Uint8Array(imageBuffer), mimeType: 'image/png' })
    } catch {
      this.events.monologue('Could not read image for review — reviewing text only.')
    }

    content.push({ type: 'text', text: textPrompt })

    const { output: object } = await generateTrackedText({
      operation: 'editorial_review',
      modelId: this.config.modelId('editing'),
      model: this.config.model('editing'),
      output: Output.object({ schema: editorSchema }),
      system: this.editorPrompt,
      messages: [{ role: 'user', content }],
    })
    if (!object) throw new Error('Failed to generate editorial review')

    const finalCaption = object.captionApproved ? caption : (object.revisedCaption ?? caption)

    if (!object.imageApproved) {
      this.events.monologue(`EDITOR REJECTED — image issues: ${object.imageIssues ?? 'Visual quality issue.'}`)
      return { approved: false, caption, reason: object.imageIssues ?? 'Image quality issue', qualityScore: object.qualityScore }
    }

    if (object.isDuplicate) {
      this.events.monologue(`EDITOR REJECTED — duplicate. ${object.duplicateOf ? `Similar to: "${object.duplicateOf}"` : 'Covers same ground.'}`)
      return { approved: false, caption, reason: object.reason, qualityScore: object.qualityScore }
    }

    if (!object.approved) {
      this.events.monologue(`EDITOR REJECTED — quality ${object.qualityScore}/10. ${object.reason}`)
      return { approved: false, caption, reason: object.reason, qualityScore: object.qualityScore }
    }

    if (!object.captionApproved && object.revisedCaption) {
      this.events.monologue(`EDITOR APPROVED with caption revision: "${caption}" -> "${object.revisedCaption}"`)
    } else {
      this.events.monologue(`EDITOR APPROVED — quality ${object.qualityScore}/10. ${object.reason}`)
    }

    return { approved: true, caption: finalCaption, reason: object.reason, qualityScore: object.qualityScore }
  }
}
