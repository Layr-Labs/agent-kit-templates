import { tool } from 'ai'
import { z } from 'zod'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import type { Skill, SkillContext } from '../../types.js'

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'learning'
}

const skill: Skill = {
  name: 'learnings',
  description: 'Persist durable research notes and lessons learned to files for future reuse',
  category: 'agent',

  async init(ctx: SkillContext) {
    const learningsDir = join(ctx.dataDir, 'learnings')
    const notesDir = join(ctx.dataDir, 'notes')
    mkdirSync(learningsDir, { recursive: true })
    mkdirSync(notesDir, { recursive: true })
    const learningsRoot = resolve(learningsDir)
    const notesRoot = resolve(notesDir)

    function safePath(root: string, filename: string): string {
      const fullPath = resolve(root, filename)
      if (!fullPath.startsWith(root)) {
        throw new Error('Path traversal not allowed')
      }
      return fullPath
    }

    return {
      record_learning: tool({
        description: 'Persist a durable learning or research note to the learnings directory. Use this when you read something useful on the web or discover a reusable insight.',
        inputSchema: z.object({
          topic: z.string().describe('Short title for the learning'),
          summary: z.string().describe('Concise explanation of what was learned'),
          sources: z.array(z.string()).default([]).describe('URLs or source identifiers that support the learning'),
          details: z.string().optional().describe('Longer notes, key quotes, implications, or follow-up actions'),
          tags: z.array(z.string()).default([]).describe('Searchable tags for later retrieval'),
        }),
        execute: async ({ topic, summary, sources, details, tags }) => {
          const stamp = new Date().toISOString().replace(/[:.]/g, '-')
          const filename = `${stamp}-${slugify(topic)}.md`
          const fullPath = join(learningsDir, filename)

          const body = [
            `# ${topic}`,
            '',
            `Recorded: ${new Date().toISOString()}`,
            tags.length ? `Tags: ${tags.join(', ')}` : '',
            '',
            '## Summary',
            summary,
            '',
            sources.length ? '## Sources' : '',
            ...sources.map((source) => `- ${source}`),
            details ? '' : '',
            details ? '## Details' : '',
            details ?? '',
            '',
          ].filter(Boolean).join('\n')

          writeFileSync(fullPath, body, 'utf-8')

          ctx.events.emit({
            type: 'skill',
            skill: 'learnings',
            action: `Recorded learning: ${topic}`,
            ts: Date.now(),
          })

          return {
            saved: true,
            path: fullPath,
            topic,
          }
        },
      }),

      list_learnings: tool({
        description: 'List saved learning files for later recall.',
        inputSchema: z.object({
          limit: z.number().default(20),
        }),
        execute: async ({ limit }) => {
          const entries = readdirSync(learningsDir)
            .filter((name) => name.endsWith('.md'))
            .sort()
            .reverse()
            .slice(0, limit)

          return entries
        },
      }),

      read_learning: tool({
        description: 'Read a previously saved learning file by filename.',
        inputSchema: z.object({
          filename: z.string().describe('Filename returned by list_learnings'),
        }),
        execute: async ({ filename }) => {
          const fullPath = safePath(learningsRoot, filename)
          return readFileSync(fullPath, 'utf-8')
        },
      }),

      write_note: tool({
        description: 'Write a reusable working note to the notes directory. Use this for drafts, research notes, checklists, or intermediate summaries you want to revisit later.',
        inputSchema: z.object({
          title: z.string().describe('Short title for the note'),
          content: z.string().describe('Full markdown or plain text note content'),
        }),
        execute: async ({ title, content }) => {
          const stamp = new Date().toISOString().replace(/[:.]/g, '-')
          const filename = `${stamp}-${slugify(title)}.md`
          const fullPath = join(notesDir, filename)
          writeFileSync(fullPath, content, 'utf-8')

          ctx.events.emit({
            type: 'skill',
            skill: 'learnings',
            action: `Wrote note: ${title}`,
            ts: Date.now(),
          })

          return {
            saved: true,
            path: fullPath,
            title,
          }
        },
      }),

      list_notes: tool({
        description: 'List saved notes for later recall.',
        inputSchema: z.object({
          limit: z.number().default(20),
        }),
        execute: async ({ limit }) => {
          const entries = readdirSync(notesDir)
            .filter((name) => name.endsWith('.md'))
            .sort()
            .reverse()
            .slice(0, limit)

          return entries
        },
      }),

      read_note: tool({
        description: 'Read a previously saved note by filename.',
        inputSchema: z.object({
          filename: z.string().describe('Filename returned by list_notes'),
        }),
        execute: async ({ filename }) => {
          const fullPath = safePath(notesRoot, filename)
          return readFileSync(fullPath, 'utf-8')
        },
      }),
    }
  },
}

export default skill
