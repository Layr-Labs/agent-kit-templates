import { tool } from 'ai'
import { z } from 'zod'
import type { Skill, SkillContext } from '../../types.js'
import { Editor } from '../../../pipeline/editor.js'

let editor: Editor

const skill: Skill = {
  name: 'editor',
  description: 'Editorial quality gate — reviews content before publishing',
  category: 'pipeline',

  async init(ctx: SkillContext) {
    editor = new Editor(ctx.events, ctx.config, ctx.identity)

    return {
      editorial_review: tool({
        description: 'Run editorial review on the current concept, caption, and image.',
        inputSchema: z.object({}),
        execute: async () => {
          if (!ctx.state.bestConcept || !ctx.state.caption || ctx.state.imagePaths.length === 0) {
            return { error: 'Missing concept, caption, or image for review.' }
          }
          const review = await editor.review(
            ctx.state.bestConcept,
            ctx.state.caption,
            ctx.state.imagePaths[0],
            ctx.state.allPosts,
            ctx.state.allContent,
          )
          ctx.state.review = review
          return {
            approved: review.approved,
            caption: review.caption,
            qualityScore: review.qualityScore,
            reason: review.reason,
          }
        },
      }),
    }
  },
}

export default skill
