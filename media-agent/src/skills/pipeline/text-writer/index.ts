import { tool } from 'ai'
import { z } from 'zod'
import type { Skill, SkillContext } from '../../types.js'
import { TextWriter } from '../../../pipeline/text-writer.js'
import { Generator } from '../../../pipeline/generator.js'

let textWriter: TextWriter
let illustrator: Generator

const skill: Skill = {
  name: 'text_writer',
  description: 'Writes long-form articles from a content concept',
  category: 'pipeline',

  async init(ctx: SkillContext) {
    illustrator = new Generator(ctx.events, ctx.caches.image, ctx.config, ctx.identity, ctx.compiledStyle)
    await illustrator.init()
    textWriter = new TextWriter(ctx.events, ctx.config, ctx.identity, illustrator)

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
            existingHeaderImagePath: ctx.state.imagePaths[0],
          })
          ctx.state.article = article
          if (ctx.state.imagePaths.length === 0 && article.images[0]?.imagePath) {
            ctx.state.imagePaths = [article.images[0].imagePath]
          }
          return {
            title: article.title,
            subtitle: article.subtitle,
            wordCount: article.body.split(/\s+/).length,
            imageCount: article.images.length,
            sectionCount: article.sections.length,
          }
        },
      }),
    }
  },
}

export default skill
