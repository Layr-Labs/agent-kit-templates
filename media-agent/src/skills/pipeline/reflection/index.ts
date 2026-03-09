import { tool } from 'ai'
import { z } from 'zod'
import { join } from 'path'
import type { Skill, SkillContext } from '../../types.js'
import { WorldviewStore } from '../../../agent/worldview.js'

let worldview: WorldviewStore

const skill: Skill = {
  name: 'reflection',
  description: 'Reflects on recent work and evolves the worldview',
  category: 'pipeline',
  toolScope: ['get_analytics', 'list_subscribers', 'get_self'],

  async init(ctx: SkillContext) {
    worldview = new WorldviewStore(ctx.events, ctx.config, ctx.identity, join(ctx.dataDir, 'worldview.json'))
    await worldview.init()

    return {
      reflect_worldview: tool({
        description: 'Reflect on recent posts and potentially evolve the worldview.',
        inputSchema: z.object({}),
        execute: async () => {
          const recentPostTexts = ctx.state.allPosts.slice(-20).map(p => p.text)
          const changed = await worldview.reflect(recentPostTexts)
          return { changed, postCount: recentPostTexts.length }
        },
      }),
    }
  },
}

export default skill
