import { tool } from 'ai'
import { generateText } from 'ai'
import { z } from 'zod'
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'fs'
import { join, resolve } from 'path'
import type { Skill, SkillContext } from '../../types.js'

const SKILL_TEMPLATE = `import { tool } from 'ai'
import { z } from 'zod'
import type { Skill, SkillContext } from '../../types.js'

const skill: Skill = {
  name: '{{NAME}}',
  description: '{{DESCRIPTION}}',
  category: '{{CATEGORY}}',

  async init(ctx: SkillContext) {
    return {
      {{TOOLS}}
    }
  },
}

export default skill
`

const EXAMPLE_SKILL = `// Example: a skill that reads article text from a URL
import { tool } from 'ai'
import { z } from 'zod'
import type { Skill, SkillContext } from '../../types.js'

const skill: Skill = {
  name: 'article-reader',
  description: 'Reads full article text from URLs',
  category: 'agent',

  async init(ctx: SkillContext) {
    return {
      read_article: tool({
        description: 'Fetch and extract the main text content from a URL',
        inputSchema: z.object({
          url: z.string().describe('The URL to read'),
        }),
        execute: async ({ url }) => {
          const res = await fetch(url)
          const html = await res.text()
          // Strip HTML tags, keep text
          const text = html.replace(/<script[^>]*>[\\s\\S]*?<\\/script>/gi, '')
            .replace(/<style[^>]*>[\\s\\S]*?<\\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\\s+/g, ' ')
            .trim()
          return text.slice(0, 10000)
        },
      }),
    }
  },
}

export default skill`

let ctx: SkillContext

const skill: Skill = {
  name: 'skill-creator',
  description: 'Creates new skills at runtime. The agent can build its own tools.',
  category: 'agent',

  async init(skillCtx: SkillContext) {
    ctx = skillCtx

    const skillsDir = join(import.meta.dir, '..')
    const constitutionPath = resolve(process.cwd(), 'constitution.md')
    const constitution = existsSync(constitutionPath) ? readFileSync(constitutionPath, 'utf-8') : ''

    return {
      list_skills: tool({
        description: 'List all currently registered skills and their tools',
        inputSchema: z.object({}),
        execute: async () => {
          if (!ctx.registry) return 'Registry not available'
          const toolNames = Object.keys(ctx.registry.tools)
          return `Skills: ${ctx.registry.names.join(', ')}\n\nTools (${toolNames.length}): ${toolNames.join(', ')}`
        },
      }),

      create_skill: tool({
        description: 'Create a new skill with custom tools. The agent writes TypeScript code that gets hot-loaded into the runtime. Use this when you need a capability that doesn\'t exist yet.',
        inputSchema: z.object({
          name: z.string().describe('Skill name (lowercase, hyphenated). E.g. "article-reader", "price-checker"'),
          description: z.string().describe('What this skill does'),
          category: z.enum(['agent', 'browser']).describe('agent = internal processing, browser = web interaction'),
          what_it_should_do: z.string().describe('Detailed description of what tools this skill should provide and how they should work. Be specific about inputs, outputs, and behavior.'),
          research_first: z.boolean().default(false).describe('If true, use the browser to research how to build this skill before generating code'),
        }),
        execute: async ({ name, description, category, what_it_should_do, research_first }) => {
          ctx.events.emit({
            type: 'skill',
            skill: 'skill-creator',
            action: `Creating skill: ${name} — ${description}`,
            ts: Date.now(),
          })

          // Research phase — use browser if requested
          let researchContext = ''
          if (research_first && ctx.browser) {
            try {
              const { runBrowserTask } = await import('../../../browser/index.js')
              const result = await runBrowserTask({
                task: `Research how to implement this: ${what_it_should_do}. Look for API documentation, code examples, or relevant resources. Summarize what you find.`,
                browser: ctx.browser,
                maxSteps: 15,
              })
              researchContext = result.result ? `\n\nResearch findings:\n${result.result}` : ''
            } catch {
              researchContext = '\n\n(Research failed, proceeding with generation)'
            }
          }

          // Generate the skill code via LLM
          try {
            const { text: generatedCode } = await generateText({
              model: ctx.config.model('ideation'),
              system: `You are a TypeScript skill code generator for a sovereign agent framework.

You write self-contained skill files that follow this exact pattern:

${EXAMPLE_SKILL}

RULES:
1. The file must export a default Skill object
2. Tools use \`inputSchema\` (not \`parameters\`) with Zod schemas
3. The \`execute\` function is async and returns a value (string, object, etc.)
4. You have access to \`ctx: SkillContext\` which provides:
   - ctx.events (EventBus — for logging)
   - ctx.config (Config — for model resolution)
   - ctx.db (Database — SQLite)
   - ctx.wallet (WalletManager — EVM + Solana addresses)
   - ctx.browser (browser-autopilot instance, may be null)
   - ctx.state (PipelineState — shared state)
   - ctx.dataDir (string — path to .data/ directory)
   - ctx.caches (eval, image, signal caches)
5. For browser tasks, use: const { runBrowserTask } = await import('../../../browser/index.js')
6. For file storage, use ctx.dataDir
7. Keep it simple — one file, no external dependencies beyond what's already installed
8. Handle errors gracefully — return error messages, don't throw

CONSTITUTION (the agent must respect these constraints):
${constitution}

Output ONLY the TypeScript code. No markdown fences. No explanation.`,
              prompt: `Create a skill called "${name}" (category: ${category}).

Description: ${description}

What it should do:
${what_it_should_do}${researchContext}`,
              providerOptions: {
                anthropic: { cacheControl: { type: 'ephemeral' } },
              },
            })

            // Clean up the generated code
            let code = generatedCode.trim()
            if (code.startsWith('```')) {
              code = code.replace(/^```\w*\n/, '').replace(/\n```$/, '')
            }

            // Write the skill file
            const skillDir = join(skillsDir, category, name)
            mkdirSync(skillDir, { recursive: true })
            const indexPath = join(skillDir, 'index.ts')
            writeFileSync(indexPath, code, 'utf-8')

            ctx.events.emit({
              type: 'skill',
              skill: 'skill-creator',
              action: `Skill "${name}" written to ${indexPath}. Hot-loading...`,
              ts: Date.now(),
            })

            // Hot-load into the live registry
            if (!ctx.registry) {
              return `Skill "${name}" was written to ${indexPath} but cannot hot-load (no registry reference). Restart the agent to load it.`
            }

            const result = await ctx.registry.loadAndInit(indexPath, ctx)
            if (!result) {
              return `Skill "${name}" was written to ${indexPath} but failed to load. The generated code may need fixes.`
            }

            ctx.events.monologue(`New skill "${name}" created and hot-loaded with tools: ${result.tools.join(', ')}`)

            return `Skill "${name}" created and loaded successfully.
File: ${indexPath}
Tools: ${result.tools.join(', ')}

The tools are now available in the current session. No restart needed.`
          } catch (err) {
            return `Failed to generate skill code: ${(err as Error).message}`
          }
        },
      }),
    }
  },
}

export default skill
