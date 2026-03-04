import { tool } from 'ai'
import { z } from 'zod'
import type { Skill, SkillContext } from '../../types.js'
import { Captioner } from '../../../pipeline/captioner.js'

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
          const recentCaptions = ctx.state.allPosts.slice(-10).map(p => p.text)
          const caption = await captioner.generate(ctx.state.bestConcept, recentCaptions)
          ctx.state.caption = caption
          return { caption }
        },
      }),
    }
  },
}

export default skill
