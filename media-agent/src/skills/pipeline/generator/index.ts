import { tool } from 'ai'
import { z } from 'zod'
import type { Skill, SkillContext } from '../../types.js'
import { Generator } from '../../../pipeline/generator.js'

let generator: Generator

const skill: Skill = {
  name: 'generator',
  description: 'Generates image variants from a content concept',
  category: 'pipeline',

  async init(ctx: SkillContext) {
    generator = new Generator(ctx.events, ctx.caches.image, ctx.config, ctx.identity, ctx.compiledStyle)
    await generator.init()

    return {
      generate_image: tool({
        description: 'Generate image variants from the best concept.',
        inputSchema: z.object({
          variants: z.number().default(3).describe('Number of image variants to generate'),
        }),
        execute: async ({ variants }) => {
          if (!ctx.state.bestConcept) {
            return { error: 'No concept selected. Run generate_concepts or critique_concepts first.' }
          }
          const result = await generator.generate(ctx.state.bestConcept, variants)
          ctx.state.imagePaths = result.variants
          ctx.state.imagePrompt = result.prompt
          return {
            variantCount: result.variants.length,
            paths: result.variants,
          }
        },
      }),
    }
  },
}

export default skill
