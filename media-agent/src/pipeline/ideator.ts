import { generateText, Output } from 'ai'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import type { Topic, ContentConcept, ConceptCritique, AgentIdentity } from '../types.js'
import { EventBus } from '../console/events.js'
import type { Config } from '../config/index.js'
import { buildIdeationPrompt } from '../prompts/ideation.js'
import { buildCritiquePrompt } from '../prompts/critique.js'
import { buildMonologuePrompt } from '../prompts/monologue.js'
import type { WorldviewStore } from '../agent/worldview.js'

const conceptsSchema = z.object({
  concepts: z.array(
    z.object({
      visual: z.string(),
      composition: z.string(),
      caption: z.string(),
      approach: z.string(),
      reasoning: z.string(),
    }),
  ),
})

const critiqueSchema = z.object({
  critiques: z.array(
    z.object({
      index: z.number(),
      quality: z.number().describe('Score 1-10'),
      clarity: z.number().describe('Score 1-10'),
      shareability: z.number().describe('Score 1-10'),
      execution: z.number().describe('Score 1-10'),
      critique: z.string(),
    }),
  ),
})

export class Ideator {
  private ideationPrompt: string
  private critiquePrompt: string
  private monologuePrompt: string

  constructor(
    private events: EventBus,
    private config: Config,
    identity: AgentIdentity,
    private worldview?: WorldviewStore,
  ) {
    this.ideationPrompt = buildIdeationPrompt(identity)
    this.critiquePrompt = buildCritiquePrompt(identity)
    this.monologuePrompt = buildMonologuePrompt(identity)
  }

  async ideate(topic: Topic, conceptCount = 3, recentPosts: string[] = []): Promise<ContentConcept[]> {
    this.events.transition('ideating')
    this.events.monologue(`Working on "${topic.summary}". Thinking of ${conceptCount} different angles...`)

    const themesPrompt = this.worldview?.getThemesPrompt() ?? ''

    let pastWorkContext = ''
    if (recentPosts.length > 0) {
      pastWorkContext = `\n\n===== PAST WORK (DO NOT repeat these angles) =====\n${recentPosts.map((p, i) => `${i + 1}. ${p.slice(0, 200)}`).join('\n')}\n===== END =====`
    }

    const { output: object } = await generateText({
      model: this.config.model('ideation'),
      output: Output.object({ schema: conceptsSchema }),
      system: `${this.monologuePrompt}\n\n${this.ideationPrompt}`,
      prompt: `${themesPrompt}\n\nGenerate ${conceptCount} content concepts for this topic:\n\n"${topic.summary}"\n\nComposite score: ${topic.scores.composite.toFixed(1)} — strong on ${this.topDimension(topic)}.${pastWorkContext}`,
    })
    if (!object) throw new Error('Failed to generate concepts')

    const concepts: ContentConcept[] = object.concepts.map(c => ({
      id: randomUUID(),
      topicId: topic.id,
      ...c,
    }))

    this.events.emit({
      type: 'ideate',
      concepts: concepts.map(c => ({ id: c.id, caption: c.caption })),
      topicId: topic.id,
      ts: Date.now(),
    })

    for (const concept of concepts) {
      this.events.monologue(`Concept: "${concept.caption}" — ${concept.approach}. ${concept.reasoning}`)
    }

    return concepts
  }

  async critique(concepts: ContentConcept[]): Promise<{
    best: ContentConcept
    critique: ConceptCritique
  }> {
    this.events.transition('critiquing')
    this.events.monologue(`${concepts.length} concepts on the table. Let me be honest about which one works...`)

    const { output: object } = await generateText({
      model: this.config.model('ideation'),
      output: Output.object({ schema: critiqueSchema }),
      system: `${this.monologuePrompt}\n\n${this.critiquePrompt}`,
      prompt: `Critique these concepts:\n\n${concepts.map((c, i) => `[${i}] Visual: ${c.visual}\nCaption: "${c.caption}"\nApproach: ${c.approach}`).join('\n\n')}`,
    })
    if (!object) throw new Error('Failed to generate critique')

    const scored = object.critiques.map(crit => ({
      ...crit,
      overallScore: (crit.quality + crit.clarity + crit.shareability + crit.execution) / 4,
    }))

    for (const crit of scored) {
      crit.index = Math.max(0, Math.min(crit.index, concepts.length - 1))
    }

    scored.sort((a, b) => b.overallScore - a.overallScore)
    const winner = scored[0]
    const bestConcept = concepts[winner.index]

    const critique: ConceptCritique = {
      conceptId: bestConcept.id,
      quality: winner.quality,
      clarity: winner.clarity,
      shareability: winner.shareability,
      execution: winner.execution,
      overallScore: winner.overallScore,
      critique: winner.critique,
    }

    this.events.emit({
      type: 'critique',
      critique: winner.critique,
      selected: winner.index,
      ts: Date.now(),
    })

    this.events.monologue(`Winner: "${bestConcept.caption}" — score ${winner.overallScore.toFixed(1)}/10. ${winner.critique}`)

    return { best: bestConcept, critique }
  }

  private topDimension(topic: Topic): string {
    const { virality, contentPotential, audienceBreadth, timeliness, creativity } = topic.scores
    const dims = [
      ['virality', virality],
      ['content potential', contentPotential],
      ['audience breadth', audienceBreadth],
      ['timeliness', timeliness],
      ['creativity', creativity],
    ] as const
    return dims.reduce((a, b) => (b[1] > a[1] ? b : a))[0]
  }
}
