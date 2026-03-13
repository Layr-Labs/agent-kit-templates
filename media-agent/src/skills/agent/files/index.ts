import { tool } from 'ai'
import { z } from 'zod'
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'fs'
import { join, resolve } from 'path'
import type { Skill, SkillContext } from '../../types.js'

const skill: Skill = {
  name: 'files',
  description: 'Read, write, and list files in the agent data directory',
  category: 'agent',

  async init(ctx: SkillContext) {
    const dataDir = resolve(ctx.dataDir)
    mkdirSync(dataDir, { recursive: true })

    function safePath(filePath: string): string {
      const resolved = resolve(dataDir, filePath)
      if (!resolved.startsWith(dataDir)) {
        throw new Error('Path traversal not allowed')
      }
      return resolved
    }

    return {
      write_file: tool({
        description: 'Write content to a file in the data directory. Use this to persist large content (articles, research, analysis) that would be too long for tool responses.',
        inputSchema: z.object({
          path: z.string().describe('File path relative to data directory. E.g. "articles/us-iran-analysis.md"'),
          content: z.string().describe('The full content to write'),
        }),
        execute: async ({ path, content }) => {
          const fullPath = safePath(path)
          const dir = fullPath.substring(0, fullPath.lastIndexOf('/'))
          mkdirSync(dir, { recursive: true })
          writeFileSync(fullPath, content, 'utf-8')
          return `Written ${content.length} chars to ${path}`
        },
      }),

      read_file: tool({
        description: 'Read a file from the data directory.',
        inputSchema: z.object({
          path: z.string().describe('File path relative to data directory'),
        }),
        execute: async ({ path }) => {
          const fullPath = safePath(path)
          if (!existsSync(fullPath)) return `File not found: ${path}`
          return readFileSync(fullPath, 'utf-8')
        },
      }),

      list_files: tool({
        description: 'List files in a directory within the data directory.',
        inputSchema: z.object({
          path: z.string().default('.').describe('Directory path relative to data directory'),
        }),
        execute: async ({ path }) => {
          const fullPath = safePath(path)
          if (!existsSync(fullPath)) return `Directory not found: ${path}`
          const entries = readdirSync(fullPath, { withFileTypes: true })
          return entries.map(e => `${e.isDirectory() ? '[dir] ' : ''}${e.name}`).join('\n')
        },
      }),
    }
  },
}

export default skill
