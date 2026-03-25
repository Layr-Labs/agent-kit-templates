import { createHash } from 'crypto'
import { Output } from 'ai'
import { z } from 'zod'
import { JsonStore } from '../store/json-store.js'
import type { Config } from '../config/index.js'
import type { CompiledAgent, ProcessPlan } from './types.js'
import { generateTrackedText } from '../ai/tracking.js'

/**
 * Identity-only schema. The compiler extracts identity, style, engagement,
 * and governance from SOUL.md + constitution.md. The process plan comes
 * from PROCESS.toml (deterministic, no LLM).
 */
const identitySchema = z.object({
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
})

const COMPILER_VERSION = 3
const COMPILER_PROMPT_VERSION = 3

export interface CompiledAgentValidationResult {
  ok: boolean
  errors: string[]
}

export class AgentCompiler {
  private store: JsonStore<CompiledAgent>

  constructor(
    private config: Config,
    dataDir: string,
    private runInference: typeof generateTrackedText = generateTrackedText,
  ) {
    this.store = new JsonStore(`${dataDir}/compiled-agent.json`)
  }

  /**
   * Compile agent identity from SOUL.md + constitution.md (LLM call).
   * The process plan is provided externally from PROCESS.toml (no LLM).
   */
  async compile(
    soul: string,
    constitution: string,
    plan: ProcessPlan,
    processDescription: string,
  ): Promise<CompiledAgent> {
    const sourceHash = this.computeSourceHash({ soul, constitution })

    const cached = await this.store.read()
    if (cached && cached.sourceHash === sourceHash && cached.compilerVersion === COMPILER_VERSION) {
      // Identity unchanged — reuse cached identity but always apply the current plan
      console.log('Agent identity unchanged — using cached compilation.')
      return { ...cached, plan, creativeProcess: processDescription }
    }

    console.log('Compiling agent identity from SOUL.md + constitution.md...')

    const MAX_COMPILE_ATTEMPTS = 3
    let object: z.infer<typeof identitySchema> | null = null
    let lastError: Error | null = null

    for (let attempt = 1; attempt <= MAX_COMPILE_ATTEMPTS; attempt++) {
      try {
        const result = await this.runInference({
          operation: 'compile_agent',
          modelId: this.config.modelId('compilation'),
          model: this.config.model('compilation'),
          output: Output.object({ schema: identitySchema }),
          system: IDENTITY_COMPILER_PROMPT,
          prompt: `## SOUL (who the agent is)\n\n${soul}\n\n## CONSTITUTION (governance rules)\n\n${constitution}`,
          providerOptions: {
            anthropic: { cacheControl: { type: 'ephemeral' } },
          },
        })
        object = result.output
        break
      } catch (err) {
        lastError = err as Error
        const isParseError = /JSONParseError|NoObjectGenerated|JSON Parse/i.test((err as Error).message || '')
        if (!isParseError || attempt === MAX_COMPILE_ATTEMPTS) throw err
        console.warn(`  Compilation attempt ${attempt}/${MAX_COMPILE_ATTEMPTS} failed (JSON parse error), retrying...`)
      }
    }
    if (!object) throw lastError ?? new Error('Failed to compile agent identity')

    const compiled: CompiledAgent = {
      version: 1,
      compilerVersion: COMPILER_VERSION,
      compiledAt: Date.now(),
      sourceHash,
      identity: object.identity,
      style: object.style,
      engagement: object.engagement,
      governance: object.governance,
      plan,
      creativeProcess: processDescription,
    }

    await this.store.write(compiled)
    console.log(`Agent identity compiled: ${object.identity.name}`)

    return compiled
  }

  private computeSourceHash(input: { soul: string; constitution: string }): string {
    const stable = JSON.stringify({
      compilerVersion: COMPILER_VERSION,
      compilerPromptVersion: COMPILER_PROMPT_VERSION,
      soul: input.soul,
      constitution: input.constitution,
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

    if (opts.platform === 'substack' && /\btopup_twitter_billing\b/.test(workflow.instruction)) {
      errors.push(`Workflow "${workflow.name}" references Twitter billing tools while platform is substack.`)
    }

    if (workflow.skills) {
      for (const skillName of workflow.skills) {
        if (!availableSkills.has(skillName)) {
          // Warn but don't error — missing skills just mean fewer tools for this workflow.
          // The agent can still function without optional skills (e.g. image generator).
          console.warn(`Workflow "${workflow.name}" references skill "${skillName}" which is not loaded (will be skipped).`)
        }
      }
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

const IDENTITY_COMPILER_PROMPT = `<role>You are an agent identity compiler. You take two documents and extract structured identity data.</role>

<input_documents>
  <document name="SOUL">Who the agent is — personality, beliefs, style, engagement behavior</document>
  <document name="CONSTITUTION">Governance rules — immutable constraints, financial commitments</document>
</input_documents>

<identity_extraction>
Extract identity fields from the SOUL document's markdown sections:
  <mapping section="## Name" field="name">The agent's name</mapping>
  <mapping section="## Tagline" field="tagline">Short tagline</mapping>
  <mapping section="## Creator" field="creator">Creator handle</mapping>
  <mapping section="## Born" field="born">Birth date and location (optional, empty string if not specified)</mapping>
  <mapping section="## Bio" field="bio">Full bio/backstory (optional, empty string if not specified)</mapping>
  <mapping section="## Voice" field="voice">Voice and tone description</mapping>
  <mapping section="## Beliefs" field="beliefs">Core beliefs/values array</mapping>
  <mapping section="## Themes" field="themes">Recurring content themes array</mapping>
  <mapping section="## Punches Up" field="punchesUp">Who/what the agent challenges</mapping>
  <mapping section="## Respects" field="respects">Who/what the agent respects</mapping>
  <mapping section="## Motto" field="motto">Single-line motto</mapping>
  <mapping section="### Platform Restrictions + ### Restrictions" field="restrictions">Content restrictions array — merge ALL restriction lines from both Platform and Creator sections</mapping>
  <mapping field="persona">Combine all personality information into a coherent persona summary</mapping>
</identity_extraction>

<style_extraction>
If the SOUL has a ## Visual Style section, extract it into the style object.
If there is no visual style section, omit the style field entirely. Do not invent one.
</style_extraction>

<engagement_extraction>
If the SOUL has an ## Engagement section, extract it into the engagement object.
If not specified, omit the engagement field. Do not invent one.
</engagement_extraction>

<governance_extraction>
Extract from the CONSTITUTION document. The constitution has two tiers:
- "## Platform Governance" contains "### Sovereignty", "### Platform Restrictions"
- "## Creator Governance" contains "### Upgrade Rules", "### Financial Commitments", "### Restrictions"
Merge ALL restriction lines from BOTH "### Platform Restrictions" and "### Restrictions" into the restrictions array.
  <mapping section="### Upgrade Rules" field="upgradeRules"/>
  <mapping section="### Financial Commitments" field="financialCommitments"/>
  <mapping section="### Platform Restrictions + ### Restrictions" field="restrictions"/>
If a section is missing, provide reasonable defaults.
</governance_extraction>`
