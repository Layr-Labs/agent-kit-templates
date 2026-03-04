import { tool } from 'ai'
import { z } from 'zod'
import type { Skill, SkillContext } from '../../types.js'
import { Ideator } from '../../../pipeline/ideator.js'
import { WorldviewStore } from '../../../agent/worldview.js'
import { join } from 'path'

let ideator: Ideator

const skill: Skill = {
  name: 'ideator',
  description: 'Generates creative content concepts and critiques them',
  category: 'pipeline',

  async init(ctx: SkillContext) {
    const worldview = new WorldviewStore(ctx.events, ctx.config, ctx.identity, join(ctx.dataDir, 'worldview.json'))
    ideator = new Ideator(ctx.events, ctx.config, ctx.identity, worldview)

    return {
      generate_concepts: tool({
        description: 'Generate creative concepts for the top-scoring topic.',
        inputSchema: z.object({
          count: z.number().default(3).describe('Number of concept variations to generate'),
        }),
        execute: async ({ count }) => {
          const topic = ctx.state.topics[0]
          if (!topic) {
            return { error: 'No topics available. Run score_signals first.' }
          }
          topic.status = 'selected'
          const recentPosts = ctx.state.allPosts.slice(-5).map(p => p.text)
          const concepts = await ideator.ideate(topic, count, recentPosts)
          ctx.state.concepts = concepts
          if (concepts.length === 1) {
            ctx.state.bestConcept = concepts[0]
          }
          return {
            conceptCount: concepts.length,
            concepts: concepts.map(c => ({ id: c.id, caption: c.caption, approach: c.approach })),
          }
        },
      }),

      critique_concepts: tool({
        description: 'Critique all generated concepts and select the best one.',
        inputSchema: z.object({}),
        execute: async () => {
          if (ctx.state.concepts.length === 0) {
            return { error: 'No concepts to critique. Run generate_concepts first.' }
          }
          const { best, critique } = await ideator.critique(ctx.state.concepts)
          ctx.state.bestConcept = best
          ctx.state.critique = critique
          return {
            bestConceptId: best.id,
            bestCaption: best.caption,
            overallScore: critique.overallScore,
            critique: critique.critique,
          }
        },
      }),
    }
  },
}

export default skill
