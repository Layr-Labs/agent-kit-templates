import { tool } from 'ai'
import { z } from 'zod'
import type { Skill, SkillContext } from '../../types.js'
import { Captioner } from '../../../pipeline/captioner.js'
import { getRecentPostTexts } from '../../../process/state.js'

let captioner: Captioner

const skill: Skill = {
  name: 'captioner',
  description: 'Writes punchy captions for content',
  category: 'pipeline',

  async init(ctx: SkillContext) {
    captioner = new Captioner(ctx.events, ctx.config, ctx.identity)

    return {
      write_caption: tool({
        description: 'Write a caption for the best concept.',
        inputSchema: z.object({}),
        execute: async () => {
          if (!ctx.state.bestConcept) {
            return { error: 'No concept selected. Run generate_concepts first.' }
          }
          const recentCaptions = getRecentPostTexts(ctx.state.allPosts, 10)
          const caption = await captioner.generate(ctx.state.bestConcept, recentCaptions)
          ctx.state.caption = caption
          return { caption }
        },
      }),
    }
  },
}

export default skill
