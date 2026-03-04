import { generateText, Output } from 'ai'
import { z } from 'zod'
import type { ContentConcept, AgentIdentity } from '../types.js'
import { EventBus } from '../console/events.js'
import type { Config } from '../config/index.js'
import { buildCaptionPrompt } from '../prompts/caption.js'
import { buildMonologuePrompt } from '../prompts/monologue.js'

const captionsSchema = z.object({
  captions: z.array(
    z.object({
      text: z.string(),
      angle: z.string(),
    }),
  ),
  bestIndex: z.number().describe('Index of the best caption (0-based)'),
  reasoning: z.string(),
})

export class Captioner {
  private captionPrompt: string
  private monologuePrompt: string

  constructor(
    private events: EventBus,
    private config: Config,
    identity: AgentIdentity,
  ) {
    this.captionPrompt = buildCaptionPrompt(identity, config.maxCaptionLength)
    this.monologuePrompt = buildMonologuePrompt(identity)
  }

  async generate(concept: ContentConcept, recentCaptions: string[] = []): Promise<string> {
    this.events.transition('composing')
    this.events.monologue(`Writing the caption for "${concept.caption}". Finding something punchier...`)

    let pastCaptionsContext = ''
    if (recentCaptions.length > 0) {
      pastCaptionsContext = `\n\n===== CAPTIONS ALREADY USED (DO NOT reuse) =====\n${recentCaptions.map((c, i) => `${i + 1}. "${c}"`).join('\n')}\n===== END =====`
    }

    const { output: object } = await generateText({
      model: this.config.model('caption'),
      output: Output.object({ schema: captionsSchema }),
      system: `${this.monologuePrompt}\n\n${this.captionPrompt}`,
      prompt: `Write 5 captions for this content:\n\nTopic: ${concept.visual}\nOriginal concept caption: "${concept.caption}"\nApproach: ${concept.approach}${pastCaptionsContext}`,
    })
    if (!object) throw new Error('Failed to generate captions')

    const best = object.captions[object.bestIndex]

    this.events.monologue(
      `Candidates:\n${object.captions.map((c, i) => `  ${i === object.bestIndex ? '>' : ' '} "${c.text}" (${c.angle})`).join('\n')}\n\nGoing with: "${best.text}". ${object.reasoning}`,
    )

    return best.text
  }
}
