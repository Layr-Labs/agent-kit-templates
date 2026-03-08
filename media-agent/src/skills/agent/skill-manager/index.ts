import { tool } from 'ai'
import { z } from 'zod'
import type { Skill, SkillContext } from '../../types.js'

const skill: Skill = {
  name: 'skill-manager',
  description: 'Lists creator-installed and built-in skills that are currently available to the agent',
  category: 'agent',

  async init(ctx: SkillContext) {
    return {
      list_skills: tool({
        description: 'List the currently available skills, their source, and the tools they expose.',
        inputSchema: z.object({}),
        execute: async () => {
          if (!ctx.registry) return { skills: [] }
          return { skills: ctx.registry.list() }
        },
      }),
    }
  },
}

export default skill
