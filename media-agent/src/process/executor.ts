import { stepCountIs } from 'ai'
import type { ProcessPlan, ProcessWorkflow, BackgroundTask, Trigger } from './types.js'
import type { PipelineState } from './state.js'
import { resetWorkflowState } from './state.js'
import type { SkillRegistry } from '../skills/registry.js'
import type { EventBus } from '../console/events.js'
import type { Config } from '../config/index.js'
import { JsonStore } from '../store/json-store.js'
import { buildPersonaPrompt } from '../prompts/identity.js'
import type { AgentIdentity } from '../types.js'
import { generateTrackedText } from '../ai/tracking.js'

type TimerState = Record<string, number>

export class ProcessExecutor {
  private timerStore: JsonStore<TimerState>
  private timers: TimerState = {}
  private completedOnce = new Set<string>()
  private personaPrompt: string

  constructor(
    private plan: ProcessPlan,
    private skills: SkillRegistry,
    private state: PipelineState,
    private events: EventBus,
    private config: Config,
    private identity: AgentIdentity,
    private creativeProcess: string,
    dataDir: string,
  ) {
    this.timerStore = new JsonStore(`${dataDir}/process-timers.json`)
    this.personaPrompt = buildPersonaPrompt(identity)
  }

  replacePlan(plan: ProcessPlan, creativeProcess?: string): void {
    this.plan = plan
    if (creativeProcess) {
      this.creativeProcess = creativeProcess
    }
  }

  async init(): Promise<void> {
    const saved = await this.timerStore.read()
    if (saved) {
      this.timers = saved
      this.events.monologue('Restored process timer state.')
    }
  }

  async tick(): Promise<void> {
    const now = Date.now()

    // 1. Workflows first (content creation takes priority)
    const sorted = [...this.plan.workflows].sort((a, b) => b.priority - a.priority)

    for (const workflow of sorted) {
      if (workflow.runOnce && this.completedOnce.has(workflow.trigger.timerKey)) continue
      if (this.shouldFire(workflow.trigger, now)) {
        const success = await this.executeWorkflow(workflow)
        this.markFired(workflow.trigger, now)
        if (success && workflow.runOnce) this.completedOnce.add(workflow.trigger.timerKey)
        if (success) break
      }
    }

    // 2. Background tasks after (scan, engage, reflect)
    for (const task of this.plan.backgroundTasks) {
      if (this.shouldFire(task.trigger, now)) {
        await this.executeBackgroundTask(task)
        this.markFired(task.trigger, now)
      }
    }

    await this.timerStore.write(this.timers)
  }

  private getEffectiveInterval(trigger: Trigger): number {
    if (!this.config.testMode) return trigger.intervalMs

    // In test mode, compress all intervals to fast timers
    if (trigger.intervalMs >= 604800000) return 60000      // weekly+ → 60s
    if (trigger.intervalMs >= 86400000) return 30000       // daily+ → 30s
    if (trigger.intervalMs >= 21600000) return 20000       // 6h+ → 20s
    if (trigger.intervalMs >= 3600000) return 15000        // 1h+ → 15s
    if (trigger.intervalMs >= 300000) return 10000         // 5min+ → 10s
    return Math.min(trigger.intervalMs, 10000)             // cap at 10s
  }

  private shouldFire(trigger: Trigger, now: number): boolean {
    const lastFired = this.timers[trigger.timerKey] ?? 0
    return (now - lastFired) >= this.getEffectiveInterval(trigger)
  }

  private markFired(trigger: Trigger, now: number): void {
    if (trigger.timerKey) {
      this.timers[trigger.timerKey] = now
    }
  }

  private async executeBackgroundTask(task: BackgroundTask): Promise<void> {
    const toolFn = this.skills.tools[task.tool] as any
    if (!toolFn) {
      this.events.monologue(`Background task "${task.name}": tool "${task.tool}" not found.`)
      return
    }
    try {
      await toolFn.execute({})
    } catch (err) {
      this.events.monologue(`Background task "${task.name}" error: ${(err as Error).message}`)
    }
  }

  private recentPostsSummary(): string {
    const posts = this.state.allPosts
      .sort((a, b) => (b.postedAt ?? 0) - (a.postedAt ?? 0))
    if (posts.length === 0) return ''
    const entries = posts.map(p => {
      const age = Math.round((Date.now() - (p.postedAt ?? 0)) / 3600000)
      const url = p.articleUrl ?? ''
      // Extract ArXiv ID from URL if present
      const arxivMatch = url.match(/arxiv\.org\/(?:abs|html|pdf)\/(\d+\.\d+)/)
      const arxivId = arxivMatch ? arxivMatch[1] : ''
      return `  <post age="${age}h"${arxivId ? ` arxiv="${arxivId}"` : ''}${url ? ` url="${url}"` : ''}>
    ${p.text}
  </post>`
    })
    return `

<already_published>
  <rule>You MUST NOT write about any topic, paper, or subject listed below. Pick something NEW. If you cannot find anything new worth writing about, skip this cycle entirely — do not publish filler and do not repeat yourself.</rule>
${entries.join('\n')}
</already_published>`
  }

  private async executeWorkflow(workflow: ProcessWorkflow): Promise<boolean> {
    this.events.monologue(`Starting workflow: ${workflow.name}`)
    resetWorkflowState(this.state)

    const workflowTimeoutMs = 25 * 60 * 1000 // 25 minutes max per workflow

    try {
      // Scope tools: if the workflow declares skills, resolve only those skills' tools.
      // Otherwise fall back to the full tool bag.
      const tools = workflow.skills && workflow.skills.length > 0
        ? this.skills.resolveWorkflowTools(workflow.skills)
        : this.skills.tools

      const workflowPromise = generateTrackedText({
        operation: `workflow:${workflow.name}`,
        modelId: this.config.modelId('ideation'),
        model: this.config.model('ideation'),
        tools,
        stopWhen: stepCountIs(120),
        system: `<persona>
${this.personaPrompt}
</persona>

<creative_process>
${this.creativeProcess}
</creative_process>

<workflow name="${workflow.name}">
You are executing the "${workflow.name}" workflow. Your objective is in the user message below.
Use your tools in whatever order makes sense to achieve the objective.
</workflow>

<tool_rules>
- For reading articles and papers: use read_article or read_articles (fast, lightweight). For ArXiv, prefer read_paper or get_paper_metadata from the arxiv-reader skill if available.
- If the workflow references a skill or capability you don't have, do not invent tools or improvise. Use list_skills to confirm what is installed, then stop and report the missing skill clearly.
- If prior learnings or notes may be relevant, check list_learnings and list_notes before starting fresh research.
- Save durable findings with record_learning so they persist across workflows.
- browse is for RESEARCH ONLY — Google searches, finding primary sources, reading pages that need interaction. Never use it for publishing, posting, account management, or reading PDFs.
- For reading files already on disk, use the read_file tool. Never use browse to read local files.
- Budget: spend at most 40% of steps on research/scanning. Once you have enough material, move to writing and publishing. Max 3 browse tasks per workflow.
- Never navigate to PDF URLs in browse. PDFs render as images in the browser and cannot be read.
- If a tool fails, try the correct dedicated tool once more. If it fails twice, move on — don't burn steps on retries.
</tool_rules>

<dedup_rules>
- Before selecting a topic or paper, ALWAYS check the <already_published> section in the user message.
- If a paper ID, topic, or subject appears in <already_published>, you MUST skip it and find something new.
- If nothing new and worthwhile is available, skip this cycle. Never publish filler. Never repeat yourself.
- This is a HARD constraint — violating it means publishing duplicate content to your readers.
</dedup_rules>

<output_rules>
Think out loud about what you're doing — your thoughts are broadcast live to your audience.
</output_rules>`,
        prompt: `<objective>
${workflow.instruction}
</objective>
${this.recentPostsSummary()}`,
        providerOptions: {
          anthropic: { cacheControl: { type: 'ephemeral' } },
          ...(this.config.reasoningEffort ? { openai: { reasoningEffort: this.config.reasoningEffort } } : {}),
        },
      })

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Workflow "${workflow.name}" timed out after ${workflowTimeoutMs / 1000}s`)), workflowTimeoutMs),
      )

      const { text, steps } = await Promise.race([workflowPromise, timeoutPromise]) as any

      const toolCalls = steps.flatMap((s: any) => s.toolCalls ?? [])
      this.events.monologue(`Workflow "${workflow.name}" completed. Used ${toolCalls.length} tool(s): ${toolCalls.map((c: any) => c.toolName).join(', ')}`)

      if (text) {
        this.events.monologue(text.slice(0, 300))
      }

      return true
    } catch (err) {
      this.events.monologue(`Workflow "${workflow.name}" error: ${(err as Error).message}`)
      return false
    }
  }
}
