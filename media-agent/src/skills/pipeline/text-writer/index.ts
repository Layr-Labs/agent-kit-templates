import { tool } from 'ai'
import { z } from 'zod'
import type { Skill, SkillContext } from '../../types.js'
import { TextWriter } from '../../../pipeline/text-writer.js'

let textWriter: TextWriter

const skill: Skill = {
  name: 'text_writer',
  description: 'Writes long-form articles from a content concept',
  category: 'pipeline',

  async init(ctx: SkillContext) {
    textWriter = new TextWriter(ctx.events, ctx.config, ctx.identity)

    return {
      write_article: tool({
        description: 'Write a full long-form article from the best concept.',
        inputSchema: z.object({
          length: z.enum(['short', 'medium', 'long']).default('medium'),
          style: z.enum(['essay', 'analysis', 'satire', 'tutorial']).default('essay'),
        }),
        execute: async ({ length, style }) => {
          if (!ctx.state.bestConcept) {
            return { error: 'No concept selected. Run generate_concepts first.' }
          }
          const article = await textWriter.write(ctx.state.bestConcept, {
            targetLength: length,
            style,
          })
          ctx.state.article = article
          return {
            title: article.title,
            subtitle: article.subtitle,
            wordCount: article.body.split(/\s+/).length,
          }
        },
      }),
    }
  },
}

export default skill
