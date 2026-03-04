import { generateText, stepCountIs } from 'ai'
import type { ProcessPlan, ProcessWorkflow, BackgroundTask, Trigger } from './types.js'
import type { PipelineState } from './state.js'
import { resetWorkflowState } from './state.js'
import type { SkillRegistry } from '../skills/registry.js'
import type { EventBus } from '../console/events.js'
import type { Config } from '../config/index.js'
import { JsonStore } from '../store/json-store.js'
import { buildPersonaPrompt } from '../prompts/identity.js'
import type { AgentIdentity } from '../types.js'

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
    if (trigger.intervalMs >= 86400000) return 30000       // daily+ → 30s
    if (trigger.intervalMs >= 21600000) return 20000       // 6h+ → 20s
    if (trigger.intervalMs >= 3600000) return 15000        // 1h+ → 15s
    if (trigger.intervalMs >= 300000) return 10000         // 5min+ → 10s
    if (trigger.intervalMs >= 604800000) return 60000      // weekly → 60s
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
    const lines = posts.map((p, i) => {
      const age = Math.round((Date.now() - (p.postedAt ?? 0)) / 3600000)
      return `${i + 1}. [${age}h ago] ${p.text}${p.articleUrl ? ` (${p.articleUrl})` : ''}`
    })
    return `\n\n=== ALREADY PUBLISHED (do NOT repeat these topics) ===\n${lines.join('\n')}\n=== END ===`
  }

  private async executeWorkflow(workflow: ProcessWorkflow): Promise<boolean> {
    this.events.monologue(`Starting workflow: ${workflow.name}`)
    resetWorkflowState(this.state)

    try {
      const { text, steps } = await generateText({
        model: this.config.model('ideation'),
        tools: this.skills.tools,
        stopWhen: stepCountIs(120),
        system: `${this.personaPrompt}

Your creative process:
${this.creativeProcess}

You are now executing the "${workflow.name}" workflow. Your objective is described below.

You have access to all your tools. Use them in whatever order makes sense to achieve the objective.

IMPORTANT TOOL USAGE RULES:
- For publishing articles: ALWAYS use publish_article. Never use browse to manually navigate the Substack editor.
- For publishing image posts: ALWAYS use publish_image. Never use browse for this.
- For reading source articles: use read_article or read_articles (fast, lightweight). Use browse only for Google searches and research that requires multi-step navigation.
- For Substack account setup: use check_substack_account and setup_substack_account.
- browse is for RESEARCH ONLY — searching Google, finding primary sources, reading pages that need interaction. Never use it for publishing, posting, or account management.

If something fails, try the correct dedicated tool again before attempting workarounds. If a tool fails twice, move on — don't burn steps on manual browser navigation for tasks that have dedicated tools.

Think out loud about what you're doing — your thoughts are broadcast live to your audience.`,
        prompt: `${workflow.instruction}${this.recentPostsSummary()}`,
        providerOptions: {
          anthropic: { cacheControl: { type: 'ephemeral' } },
          ...(this.config.reasoningEffort ? { openai: { reasoningEffort: this.config.reasoningEffort } } : {}),
        },
      })

      const toolCalls = steps.flatMap(s => s.toolCalls ?? [])
      this.events.monologue(`Workflow "${workflow.name}" completed. Used ${toolCalls.length} tool(s): ${toolCalls.map(c => c.toolName).join(', ')}`)

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
