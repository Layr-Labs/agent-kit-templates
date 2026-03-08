import { createHash } from 'crypto'
import { Output } from 'ai'
import { z } from 'zod'
import { JsonStore } from '../store/json-store.js'
import type { Config } from '../config/index.js'
import type { CompiledAgent } from './types.js'
import { generateTrackedText } from '../ai/tracking.js'
import type { CompilerSkillInfo, CompilerToolInfo } from './tool-catalog.js'

const compiledAgentSchema = z.object({
  identity: z.object({
    name: z.string().describe('The agent name, from ## Name'),
    tagline: z.string().describe('Short tagline, from ## Tagline'),
    creator: z.string().describe('Creator handle, from ## Creator'),
    born: z.string().describe('Birth date and location, from ## Born. Empty string if not specified.'),
    bio: z.string().describe('Full bio/backstory, from ## Bio. Empty string if not specified.'),
    persona: z.string().describe('The agent personality summary, extracted from the soul'),
    beliefs: z.array(z.string()).describe('Core beliefs/values (5-7 items)'),
    themes: z.array(z.string()).describe('Recurring content themes (4-10 items)'),
    punchesUp: z.array(z.string()).describe('Who/what the agent challenges (3-6 items)'),
    respects: z.array(z.string()).describe('Who/what the agent respects (3-6 items)'),
    voice: z.string().describe('Voice and tone description'),
    restrictions: z.array(z.string()).describe('Content restrictions and boundaries'),
    motto: z.string().describe('Single-line motto or slogan'),
  }),
  style: z.object({
    name: z.string().describe('Short name for the visual style'),
    description: z.string().describe('Overall style description'),
    visualIdentity: z.string().describe('How images should look'),
    compositionPrinciples: z.string().describe('Layout and composition rules'),
    renderingRules: z.string().describe('Technical constraints and what to avoid'),
  }).optional().describe('Visual style for image generation'),
  engagement: z.object({
    voiceDescription: z.string().describe('How the agent interacts with its audience'),
    rules: z.array(z.string()).describe('Specific engagement rules (5-10 items)'),
  }).optional().describe('Engagement behavior with audience'),
  governance: z.object({
    upgradeRules: z.array(z.string()).describe('Rules about what can/cannot be upgraded'),
    financialCommitments: z.array(z.string()).describe('Financial obligations (dividends, spending limits)'),
    restrictions: z.array(z.string()).describe('Hard restrictions the agent must never violate'),
  }),
  plan: z.object({
    backgroundTasks: z.array(z.object({
      name: z.string(),
      trigger: z.object({
        type: z.literal('interval'),
        intervalMs: z.number().describe('Interval in milliseconds. E.g. 1800000 for 30 min, 21600000 for 6 hours, 86400000 for 24 hours'),
        timerKey: z.string().describe('Unique key for this timer. E.g. "scan", "engagement", "daily_briefing"'),
      }),
      skill: z.string(),
      tool: z.string(),
    })),
    workflows: z.array(z.object({
      name: z.string(),
      trigger: z.object({
        type: z.literal('interval'),
        intervalMs: z.number().describe('Interval in milliseconds. E.g. 1800000 for 30 min, 21600000 for 6 hours, 86400000 for 24 hours'),
        timerKey: z.string().describe('Unique key for this timer. E.g. "daily_briefing", "quick_analysis"'),
      }),
      instruction: z.string().describe('Natural language instruction for the LLM to execute this workflow using available tools'),
      priority: z.number(),
      runOnce: z.boolean().describe('If true, this workflow only runs once (e.g. bootstrap/setup). After first successful run, it is skipped. Use false for recurring workflows.'),
    })),
  }),
})

const COMPILER_VERSION = 2
const COMPILER_PROMPT_VERSION = 2

interface CompilerInputs {
  availableSkills: CompilerSkillInfo[]
  availableTools: CompilerToolInfo[]
}

export interface CompiledAgentValidationResult {
  ok: boolean
  errors: string[]
}

export class AgentCompiler {
  private store: JsonStore<CompiledAgent>

  constructor(
    private config: Config,
    dataDir: string,
  ) {
    this.store = new JsonStore(`${dataDir}/compiled-agent.json`)
  }

  async compile(
    soul: string,
    process: string,
    constitution: string,
    inputs: CompilerInputs,
  ): Promise<CompiledAgent> {
    const sourceHash = this.computeSourceHash({
      soul,
      process,
      constitution,
      platform: this.config.platform,
      availableSkills: inputs.availableSkills,
      availableTools: inputs.availableTools,
    })

    const cached = await this.store.read()
    if (cached && cached.sourceHash === sourceHash && cached.compilerVersion === COMPILER_VERSION) {
      console.log('Agent definition unchanged — using cached compilation.')
      return cached
    }

    console.log('Compiling agent from SOUL.md + PROCESS.md + constitution.md...')

    const { output: object } = await generateTrackedText({
      operation: 'compile_agent',
      modelId: this.config.modelId('compilation'),
      model: this.config.model('compilation'),
      output: Output.object({ schema: compiledAgentSchema }),
      system: COMPILER_SYSTEM_PROMPT(inputs),
      prompt: `## SOUL (who the agent is)\n\n${soul}\n\n## PROCESS (how the agent creates)\n\n${process}\n\n## CONSTITUTION (governance rules)\n\n${constitution}`,
      providerOptions: {
        anthropic: { cacheControl: { type: 'ephemeral' } },
      },
    })
    if (!object) throw new Error('Failed to compile agent definition')

    const compiled: CompiledAgent = {
      version: 1,
      compilerVersion: COMPILER_VERSION,
      compiledAt: Date.now(),
      sourceHash,
      identity: object.identity,
      style: object.style,
      engagement: object.engagement,
      governance: object.governance,
      plan: object.plan,
      creativeProcess: process,
    }

    const validation = validateCompiledAgent(compiled, {
      availableSkillNames: inputs.availableSkills.map((skill) => skill.name),
      availableToolNames: inputs.availableTools.map((tool) => tool.name),
      platform: this.config.platform,
    })
    if (!validation.ok) {
      throw new Error(`Compiled agent failed validation: ${validation.errors.join(' | ')}`)
    }

    await this.store.write(compiled)
    console.log(`Agent compiled: ${compiled.plan.workflows.length} workflows, ${compiled.plan.backgroundTasks.length} background tasks.`)

    return compiled
  }

  private computeSourceHash(input: {
    soul: string
    process: string
    constitution: string
    platform: string
    availableSkills: CompilerSkillInfo[]
    availableTools: CompilerToolInfo[]
  }): string {
    const stable = JSON.stringify({
      compilerVersion: COMPILER_VERSION,
      compilerPromptVersion: COMPILER_PROMPT_VERSION,
      platform: input.platform,
      soul: input.soul,
      process: input.process,
      constitution: input.constitution,
      availableSkills: input.availableSkills,
      availableTools: input.availableTools,
    })

    return createHash('sha256').update(stable).digest('hex').slice(0, 16)
  }
}

export function validateCompiledAgent(
  compiled: CompiledAgent,
  opts: {
    availableSkillNames: string[]
    availableToolNames: string[]
    platform: 'twitter' | 'substack'
  },
): CompiledAgentValidationResult {
  const errors: string[] = []
  const availableSkills = new Set(opts.availableSkillNames)
  const availableTools = new Set(opts.availableToolNames)
  const seenTimerKeys = new Set<string>()

  for (const task of compiled.plan.backgroundTasks) {
    if (!availableTools.has(task.tool)) {
      errors.push(`Background task "${task.name}" references unavailable tool "${task.tool}".`)
    }
    if (task.skill && !availableSkills.has(task.skill)) {
      errors.push(`Background task "${task.name}" references unavailable skill "${task.skill}".`)
    }
    validateTrigger(task.trigger, `Background task "${task.name}"`, seenTimerKeys, errors)
  }

  for (const workflow of compiled.plan.workflows) {
    validateTrigger(workflow.trigger, `Workflow "${workflow.name}"`, seenTimerKeys, errors)

    if (!Number.isFinite(workflow.priority)) {
      errors.push(`Workflow "${workflow.name}" has a non-finite priority.`)
    }

    if (/\bcreate_skill\b/.test(workflow.instruction)) {
      errors.push(`Workflow "${workflow.name}" still references deprecated tool "create_skill".`)
    }

    if (opts.platform === 'twitter' && /\bpublish_article\b/.test(workflow.instruction)) {
      errors.push(`Workflow "${workflow.name}" references publish_article on twitter, which is unsupported.`)
    }
    if (opts.platform === 'twitter' && /\b(setup_substack_account|check_substack_account)\b/.test(workflow.instruction)) {
      errors.push(`Workflow "${workflow.name}" references Substack setup tools while platform is twitter.`)
    }
    if (opts.platform === 'substack' && /\btopup_twitter_billing\b/.test(workflow.instruction)) {
      errors.push(`Workflow "${workflow.name}" references Twitter billing tools while platform is substack.`)
    }
  }

  return { ok: errors.length === 0, errors }
}

function validateTrigger(
  trigger: { timerKey: string; intervalMs: number },
  label: string,
  seenTimerKeys: Set<string>,
  errors: string[],
): void {
  if (!trigger.timerKey || trigger.timerKey.trim().length === 0) {
    errors.push(`${label} is missing timerKey.`)
  }
  if (!Number.isFinite(trigger.intervalMs) || trigger.intervalMs <= 0) {
    errors.push(`${label} has invalid intervalMs "${trigger.intervalMs}".`)
  }
  if (seenTimerKeys.has(trigger.timerKey)) {
    errors.push(`${label} reuses timerKey "${trigger.timerKey}".`)
  } else {
    seenTimerKeys.add(trigger.timerKey)
  }
}

function COMPILER_SYSTEM_PROMPT(inputs: CompilerInputs): string {
  const skillsSection = inputs.availableSkills.length > 0
    ? inputs.availableSkills.map((skill) => {
        const tools = skill.tools.length > 0
          ? ` tools: ${skill.tools.map((tool) => tool.name).join(', ')}`
          : ''
        const caps = skill.capabilities.length > 0
          ? ` capabilities: ${skill.capabilities.join(', ')}`
          : ''
        const version = skill.version ? `@${skill.version}` : ''
        return `- ${skill.name}${version} [${skill.source}] — ${skill.description}${tools}${caps}`
      }).join('\n')
    : '- none'

  const toolsSection = inputs.availableTools.length > 0
    ? inputs.availableTools.map((tool) => (
      `| ${tool.name} | ${tool.description} | ${tool.source}${tool.skill ? ` (${tool.skill})` : ''} |`
    )).join('\n')
    : '| none | No tools available | n/a |'

  return `You are an agent compiler. You take three documents describing an autonomous agent and compile them into structured data:

1. SOUL — who the agent is (personality, beliefs, style, engagement behavior)
2. PROCESS — how the agent operates, learns, researches, and creates (creative or operational workflows described in plain text)
3. CONSTITUTION — governance rules (immutable constraints, financial commitments)

## Available Skills
${skillsSection}

## Tool Reference

These tools are available for the agent to use during workflow execution:

| Tool | What it does | Source |
|---|---|---|
${toolsSection}

You are not limited to media publishing. Use the available tools to compile workflows for research, learning, browser-driven tasks, email, wallet operations, or file-based knowledge work when that is what the PROCESS describes.

Only reference tools that are actually available. Installed skills are creator-managed upgrades. Do not invent missing tools or assume the agent can create new skills for itself at runtime.

## Compiling the PROCESS into Workflows

The PROCESS document describes the agent's operational flows in plain text. You must compile this into:

1. **Background tasks** — periodic standalone actions (scan, engage, reflect). These run independently.
2. **Workflows** — multi-step research, learning, or creative processes. Each workflow has:
   - A trigger (interval-based timing)
   - An instruction (natural language description of what the agent should do, referencing available tools)
   - A priority (higher = checked first)

**IMPORTANT:** The workflow \`instruction\` field should be a clear, detailed natural language description of the creative flow. The agent will receive this instruction along with all available tools and execute it autonomously. Include quality thresholds, variant counts, and any specific requirements mentioned in the PROCESS.

## Bootstrap Workflow

If the PROCESS involves publishing to an external platform (Substack, Twitter, etc.), you SHOULD include a **bootstrap workflow** as the HIGHEST priority workflow. This workflow runs once at startup to ensure the platform account is set up before publishing workflows fire.

For Substack: The bootstrap workflow should use \`check_substack_account\` to check if an account exists. If not, call \`setup_substack_account\` with the agent's name, bio, newsletter name, and description from the identity. The setup tool itself can derive publication handle candidates from the full agent identity, test what is available, and reuse an existing publication if one already exists on the account.

Give bootstrap workflows \`priority: 100\` (highest), \`runOnce: true\`, and a very short interval (intervalMs: 30000) so they fire immediately on first tick. The timerKey should be "bootstrap".

The bootstrap instruction should clearly state: "Check if the platform account exists. If it does, do nothing. If it doesn't, set it up using the setup tools. Use the agent's identity for account details, let the setup flow choose an appropriate Substack handle, and reuse any existing publication before creating a new one."

If the PROCESS does not require an external publishing platform, do NOT invent a bootstrap workflow.

## Trigger Format

**CRITICAL:** Every trigger MUST have \`type: "interval"\`, a \`timerKey\` string, and an \`intervalMs\` number. Do NOT use the \`condition\` field for interval triggers. Each background task and workflow MUST have a UNIQUE timerKey — never reuse the same timerKey for different tasks.

Examples:
- \`{ "type": "interval", "timerKey": "scan", "intervalMs": 1800000 }\`  ← every 30 minutes
- \`{ "type": "interval", "timerKey": "engagement", "intervalMs": 1800000 }\`  ← every 30 minutes
- \`{ "type": "interval", "timerKey": "daily_briefing", "intervalMs": 86400000 }\`  ← every 24 hours
- \`{ "type": "interval", "timerKey": "quick_analysis", "intervalMs": 21600000 }\`  ← every 6 hours
- \`{ "type": "interval", "timerKey": "reflection", "intervalMs": 604800000 }\`  ← every 7 days

Common intervals:
| Natural language | intervalMs |
|---|---|
| every 30 seconds | 30000 |
| every 5 minutes | 300000 |
| every 30 minutes | 1800000 |
| every 1 hour | 3600000 |
| every 6 hours | 21600000 |
| every 12 hours | 43200000 |
| every 24 hours / daily | 86400000 |
| every 7 days / weekly | 604800000 |

## Identity Extraction

Extract identity fields from the SOUL document's markdown sections:
- ## Name → name (the agent's name)
- ## Tagline → tagline
- ## Creator → creator
- ## Born → born (optional, birth date and location)
- ## Bio → bio (optional, full backstory)
- ## Voice → voice
- ## Beliefs → beliefs array
- ## Themes → themes array
- ## Punches Up → punchesUp array
- ## Respects → respects array
- ## Motto → motto
- ## Restrictions → restrictions array
- Combine all personality information into a coherent persona summary

## Style Extraction

If the SOUL has a ## Visual Style section, extract it into the style object.
If there is no visual style section, omit the style field entirely. Do not invent one.

## Engagement Extraction

If the SOUL has an ## Engagement section, extract it into the engagement object.
If not specified, omit the engagement field. Do not invent one.

## Governance Extraction

Extract from the CONSTITUTION document:
- ## Upgrade Rules → upgradeRules
- ## Financial Commitments → financialCommitments
- ## Restrictions → restrictions

If a section is missing, provide reasonable defaults.

## Workflow Priorities

Higher priority = checked first: bootstrap=100, flagship=10, article=8, quickhit=5

## Learning Persistence

When the PROCESS involves research, synthesis, or repeated web learning, prefer workflows that save durable findings using \`record_learning\`, \`write_note\`, or \`write_file\`. Important learnings should not exist only in transient model output.

When the PROCESS depends on accumulated knowledge, prior research, or a running notebook of ideas, include steps that consult \`list_learnings\` + \`read_learning\` and \`list_notes\` + \`read_note\` before doing fresh work.`
}
