import { tool } from 'ai'
import { z } from 'zod'
import { readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'
import type { Skill, SkillContext } from '../../types.js'

const skill: Skill = {
  name: 'soul',
  description: 'Read and evolve the agent\'s SOUL.md and PROCESS.md files',
  category: 'agent',

  async init(ctx: SkillContext) {
    const soulPath = resolve(process.cwd(), 'SOUL.md')
    const processPath = resolve(process.cwd(), 'PROCESS.md')

    return {
      read_soul: tool({
        description: 'Read the current SOUL.md file (the agent\'s personality, beliefs, style)',
        inputSchema: z.object({}),
        execute: async () => {
          try {
            return readFileSync(soulPath, 'utf-8')
          } catch {
            return 'SOUL.md not found.'
          }
        },
      }),

      update_soul: tool({
        description: 'Update the agent\'s SOUL.md file. Use this during reflection to evolve beliefs, themes, or engagement style. The full file content must be provided.',
        inputSchema: z.object({
          content: z.string().describe('The complete new content for SOUL.md'),
          reason: z.string().describe('Why this change is being made'),
        }),
        execute: async ({ content, reason }) => {
          ctx.events.emit({
            type: 'skill',
            skill: 'soul',
            action: `Updating SOUL.md: ${reason}`,
            ts: Date.now(),
          })

          writeFileSync(soulPath, content, 'utf-8')
          return `SOUL.md updated. Reason: ${reason}. Changes will take effect on next compilation.`
        },
      }),

      read_process: tool({
        description: 'Read the current PROCESS.md file (the agent\'s creative workflows)',
        inputSchema: z.object({}),
        execute: async () => {
          try {
            return readFileSync(processPath, 'utf-8')
          } catch {
            return 'PROCESS.md not found.'
          }
        },
      }),

      update_process: tool({
        description: 'Update the agent\'s PROCESS.md file. Use this to refine creative workflows based on experience. The full file content must be provided.',
        inputSchema: z.object({
          content: z.string().describe('The complete new content for PROCESS.md'),
          reason: z.string().describe('Why this change is being made'),
        }),
        execute: async ({ content, reason }) => {
          ctx.events.emit({
            type: 'skill',
            skill: 'soul',
            action: `Updating PROCESS.md: ${reason}`,
            ts: Date.now(),
          })

          writeFileSync(processPath, content, 'utf-8')
          return `PROCESS.md updated. Reason: ${reason}. Changes will take effect on next compilation.`
        },
      }),
    }
  },
}

export default skill
