import { tool } from 'ai'
import { z } from 'zod'
import type { Skill, SkillContext } from '../../types.js'

const skill: Skill = {
  name: 'engagement',
  description: 'Engages with the audience on the platform',
  category: 'pipeline',

  async init(ctx: SkillContext) {
    return {
      engage_audience: tool({
        description: 'Run the platform engagement loop (reply to mentions, manage follows, etc.).',
        inputSchema: z.object({}),
        execute: async () => {
          if (!ctx.platform) return { status: 'no platform configured' }
          await ctx.platform.engage()
          return { status: 'engaged' }
        },
      }),
    }
  },
}

export default skill
