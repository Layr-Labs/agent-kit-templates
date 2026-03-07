import { tool } from 'ai'
import { z } from 'zod'
import type { Skill, SkillContext } from '../../types.js'
import { Scorer } from '../../../pipeline/scorer.js'

let scorer: Scorer

const skill: Skill = {
  name: 'scorer',
  description: 'Evaluates and scores signals into ranked topics',
  category: 'pipeline',

  async init(ctx: SkillContext) {
    scorer = new Scorer(ctx.events, ctx.caches.eval, ctx.config, ctx.identity)

    return {
      score_signals: tool({
        description: 'Score all cached signals against the agent worldview. Returns ranked topics.',
        inputSchema: z.object({}),
        execute: async () => {
          const signals = ctx.state.cachedSignals
          if (signals.length === 0) {
            return { topicCount: 0, message: 'No signals to score' }
          }
          const recentSummaries = ctx.state.allPosts
            .sort((a, b) => (b.postedAt ?? 0) - (a.postedAt ?? 0))
            .map(p => p.text)
          const topics = await scorer.scoreAndFilter(signals, recentSummaries)

          // Scoring establishes a new candidate set, so clear any downstream
          // concept/article state that may belong to an older topic.
          ctx.state.concepts = []
          ctx.state.bestConcept = null
          ctx.state.critique = null
          ctx.state.imagePaths = []
          ctx.state.imagePrompt = null
          ctx.state.caption = null
          ctx.state.article = null
          ctx.state.review = null
          ctx.state.topics = topics
          return {
            topicCount: topics.length,
            top: topics.slice(0, 3).map(t => ({
              summary: t.summary,
              score: t.scores.composite,
            })),
          }
        },
      }),
    }
  },
}

export default skill
