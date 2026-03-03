import { generateObject } from 'ai'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import type { Signal, Topic, AgentIdentity } from '../types.js'
import { Cache } from '../cache/cache.js'
import { EventBus } from '../console/events.js'
import type { Config } from '../config/index.js'
import { buildScoringPrompt } from '../prompts/scoring.js'
import { buildSafetyPrompt } from '../prompts/safety.js'
import { buildMonologuePrompt } from '../prompts/monologue.js'

const batchScoreSchema = z.object({
  topics: z.array(
    z.object({
      signalIndices: z.array(z.number()).describe('Which signal indices (0-based) this topic covers'),
      summary: z.string().describe('One-line summary of the topic'),
      safe: z.boolean().describe('Is this topic safe to create content about?'),
      safetyReason: z.string().optional().describe('If unsafe, why'),
      virality: z.number().describe('Score 0-10'),
      contentPotential: z.number().describe('Score 0-10'),
      audienceBreadth: z.number().describe('Score 0-10'),
      timeliness: z.number().describe('Score 0-10'),
      creativity: z.number().describe('Score 0-10'),
      worldviewAlignment: z.number().describe('Score 0-10: how well does this connect to the agent\'s themes?'),
      reasoning: z.string().describe('Brief explanation of the scoring'),
    }),
  ),
})

export class Scorer {
  private scoringPrompt: string
  private safetyPrompt: string
  private monologuePrompt: string

  constructor(
    private events: EventBus,
    private evalCache: Cache,
    private config: Config,
    identity: AgentIdentity,
  ) {
    this.scoringPrompt = buildScoringPrompt(identity)
    this.safetyPrompt = buildSafetyPrompt(identity)
    this.monologuePrompt = buildMonologuePrompt(identity)
  }

  async scoreAndFilter(
    signals: Signal[],
    recentTopicSummaries: string[],
  ): Promise<Topic[]> {
    this.events.transition('shortlisting')

    if (signals.length === 0) {
      this.events.monologue('Nothing worth creating right now. Slow news cycle.')
      return []
    }

    const batchKey = Cache.key(`batch-eval:${signals.map(s => s.content.slice(0, 50)).join('|').slice(0, 500)}`)
    const cached = this.evalCache.get(batchKey) as Topic[] | null
    if (cached) {
      this.events.monologue(`Using cached evaluation for ${cached.length} topics.`)
      return cached
    }

    this.events.monologue(`${signals.length} signals to evaluate. Batch-scoring...`)

    const capped = signals.slice(0, 100)
    const signalList = capped.map((s, i) => `[${i}] ${s.content}`).join('\n\n')

    const blacklist = recentTopicSummaries.length > 0
      ? `\n\n===== DO NOT REPEAT — ALREADY COVERED =====\n${recentTopicSummaries.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n===== END BLACKLIST =====`
      : ''

    const { object } = await generateObject({
      model: this.config.model('scoring'),
      schema: batchScoreSchema,
      system: `${this.monologuePrompt}\n\n${this.scoringPrompt}\n\n${this.safetyPrompt}\n\nYou are evaluating a batch of signals. Group related signals into topics, then score each topic. Return at most 10 topics, ranked by content potential. For each topic, list which signal indices it covers. Also perform a safety check inline.`,
      prompt: `Score these signals for content potential:\n\n${signalList}${blacklist}`,
    })

    const topics: Topic[] = []

    for (const scored of object.topics) {
      if (!scored.safe) {
        this.events.monologue(`"${scored.summary.slice(0, 60)}..." — skipping. ${scored.safetyReason ?? 'Content policy.'}`)
        continue
      }

      const worldview = scored.worldviewAlignment ?? 0
      if (worldview < 4) {
        this.events.monologue(`"${scored.summary.slice(0, 60)}..." — worldview alignment ${worldview}/10. Not my beat.`)
        continue
      }

      const validIndices = scored.signalIndices.filter(i => i >= 0 && i < capped.length)

      const composite =
        scored.virality * 0.15 +
        scored.contentPotential * 0.15 +
        scored.audienceBreadth * 0.10 +
        scored.timeliness * 0.10 +
        scored.creativity * 0.15 +
        worldview * 0.35

      const isDuplicate = recentTopicSummaries.some(
        recent => this.similarity(recent, scored.summary) > 0.3,
      )

      if (isDuplicate) {
        this.events.monologue(`"${scored.summary.slice(0, 60)}..." — already covered recently.`)
        continue
      }

      const topic: Topic = {
        id: randomUUID(),
        signals: validIndices.map(i => capped[i].id),
        summary: scored.summary,
        scores: {
          virality: scored.virality,
          contentPotential: scored.contentPotential,
          audienceBreadth: scored.audienceBreadth,
          timeliness: scored.timeliness,
          creativity: scored.creativity,
          worldviewAlignment: worldview,
          composite,
        },
        safety: { passed: true },
        status: 'candidate',
        evaluatedAt: Date.now(),
      }

      topics.push(topic)
      this.events.monologue(`"${scored.summary}" — composite: ${composite.toFixed(1)}. ${scored.reasoning}`)
    }

    topics.sort((a, b) => b.scores.composite - a.scores.composite)

    for (let i = 0; i < Math.min(5, topics.length); i++) {
      topics[i].status = 'shortlisted'
    }

    this.events.emit({
      type: 'shortlist',
      topics: topics.slice(0, 5).map(t => ({ id: t.id, summary: t.summary, score: t.scores.composite })),
      ts: Date.now(),
    })

    if (topics.length > 0) {
      this.events.monologue(`Top pick: "${topics[0].summary}" (${topics[0].scores.composite.toFixed(1)}).`)
    } else {
      this.events.monologue('Nothing worth creating right now.')
    }

    this.evalCache.set(batchKey, topics, this.config.cache.topicEvalTtlMs)
    return topics
  }

  private similarity(a: string, b: string): number {
    const wordsA = new Set(a.toLowerCase().split(/\s+/))
    const wordsB = new Set(b.toLowerCase().split(/\s+/))
    const intersection = [...wordsA].filter(w => wordsB.has(w)).length
    const union = new Set([...wordsA, ...wordsB]).size
    return union === 0 ? 0 : intersection / union
  }
}
