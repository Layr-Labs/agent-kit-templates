import { tool } from 'ai'
import { z } from 'zod'
import type { Skill, SkillContext } from '../../types.js'

const skill: Skill = {
  name: 'browse',
  description: 'General-purpose browser automation. Send any task to the browser agent.',
  category: 'browser',

  async init(ctx: SkillContext) {
    return {
      browse: tool({
        description: 'Execute any task in the browser via automation. Use this to read articles, navigate websites, fill forms, extract data, or interact with any web page. For large content, save results to a file using write_file instead of returning it directly.',
        inputSchema: z.object({
          task: z.string().describe('What to do in the browser. Be specific about what to navigate to, what to extract, and where to save results.'),
          max_steps: z.number().default(20).describe('Maximum browser automation steps'),
        }),
        execute: async ({ task, max_steps }) => {
          if (!ctx.browser) {
            return { success: false, result: 'Browser not available.' }
          }

          ctx.events.emit({
            type: 'skill',
            skill: 'browse',
            action: task.slice(0, 200),
            ts: Date.now(),
          })

          try {
            const { runBrowserTask } = await import('../../../browser/index.js')
            const result = await runBrowserTask({
              task,
              browser: ctx.browser,
              maxSteps: max_steps,
            })
            return result
          } catch (err) {
            return { success: false, result: `Browser error: ${(err as Error).message}` }
          }
        },
      }),
    }
  },
}

export default skill
