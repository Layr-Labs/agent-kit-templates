import { tool } from 'ai'
import { z } from 'zod'
import type { Skill, SkillContext } from '../../types.js'

const skill: Skill = {
  name: 'scanner',
  description: 'Scans configured data sources for signals',
  category: 'pipeline',
  toolScope: [
    'get_substack_posts', 'search_substack_posts', 'get_reader_feed',
    'search_publications', 'get_substack_user',
  ],

  async init(ctx: SkillContext) {
    return {
      scan: tool({
        description: 'Scan all configured data sources for new signals.',
        inputSchema: z.object({}),
        execute: async () => {
          const signals = await ctx.scannerRegistry.scan()
          ctx.state.signals = signals
          if (signals.length > 0) {
            ctx.state.cachedSignals = signals
          }
          return {
            count: signals.length,
            top: signals.slice(0, 3).map(s => s.content.slice(0, 100)),
          }
        },
      }),
    }
  },
}

export default skill
