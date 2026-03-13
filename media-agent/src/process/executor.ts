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
import { getPostsNewestFirst } from './state.js'

type TimerState = Record<string, number>
type GenerateTrackedText = typeof generateTrackedText

interface ActiveWorkflowState {
  name: string
  finished: boolean
  timedOut: boolean
}

export class ProcessExecutor {
  private timerStore: JsonStore<TimerState>
  private timers: TimerState = {}
  private completedOnce = new Set<string>()
  private personaPrompt: string
  private activeWorkflow?: ActiveWorkflowState
  private activeWorkflowNoticeAt = 0

  constructor(
    private plan: ProcessPlan,
    private skills: SkillRegistry,
    private state: PipelineState,
    private events: EventBus,
    private config: Config,
    private identity: AgentIdentity,
    private creativeProcess: string,
    dataDir: string,
    private generateText: GenerateTrackedText = generateTrackedText,
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

    if (this.hasRunningWorkflow()) {
      const noticeIntervalMs = Math.max(this.config.tickIntervalMs ?? 0, 15000)
      if ((now - this.activeWorkflowNoticeAt) >= noticeIntervalMs) {
        this.events.monologue(
          `Workflow "${this.activeWorkflow?.name}" is still settling after timeout. Skipping scheduled work this tick.`,
        )
        this.activeWorkflowNoticeAt = now
      }
      return
    }
    this.activeWorkflowNoticeAt = 0

    // 1. Workflows first (content creation takes priority)
    const sorted = [...this.plan.workflows].sort((a, b) => b.priority - a.priority)

    for (const workflow of sorted) {
      if (workflow.runOnce && this.completedOnce.has(workflow.trigger.timerKey)) continue
      if (this.shouldFire(workflow.trigger, now)) {
        const success = await this.executeWorkflow(workflow)
        if (success) {
          this.markFired(workflow.trigger, now)
          if (workflow.runOnce) this.completedOnce.add(workflow.trigger.timerKey)
          break
        }
        if (this.hasRunningWorkflow()) {
          return
        }
      }
    }

    // 2. Background tasks after (scan, engage, reflect)
    for (const task of this.plan.backgroundTasks) {
      if (this.hasRunningWorkflow()) {
        return
      }
      if (this.shouldFire(task.trigger, now)) {
        const success = await this.executeBackgroundTask(task)
        if (success) {
          this.markFired(task.trigger, now)
        }
      }
    }

    await this.timerStore.write(this.timers)
  }

  hasRunningWorkflow(): boolean {
    return !!this.activeWorkflow && !this.activeWorkflow.finished
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

  private async executeBackgroundTask(task: BackgroundTask): Promise<boolean> {
    const toolFn = this.skills.tools[task.tool] as any
    if (!toolFn) {
      this.events.monologue(`Background task "${task.name}": tool "${task.tool}" not found.`)
      return false
    }
    try {
      await toolFn.execute({})
      return true
    } catch (err) {
      this.events.monologue(`Background task "${task.name}" error: ${(err as Error).message}`)
      return false
    }
  }

  private recentPostsSummary(): string {
    const posts = getPostsNewestFirst(this.state.allPosts)
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

    const workflowTimeoutMs = resolveWorkflowTimeoutMs()
    const abortController = new AbortController()
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined
    const activeWorkflow: ActiveWorkflowState = {
      name: workflow.name,
      finished: false,
      timedOut: false,
    }
    this.activeWorkflow = activeWorkflow

    try {
      // Scope tools: if the workflow declares skills, resolve only those skills' tools.
      // Otherwise fall back to the full tool bag.
      const tools = workflow.skills && workflow.skills.length > 0
        ? this.skills.resolveWorkflowTools(workflow.skills)
        : this.skills.tools

      const workflowPromise: Promise<boolean> = (async () => {
        try {
          const { text, steps } = await this.generateText({
            operation: `workflow:${workflow.name}`,
            modelId: this.config.modelId('ideation'),
            model: this.config.model('ideation'),
            tools,
            stopWhen: stepCountIs(120),
            abortSignal: abortController.signal,
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

          const toolCalls = steps.flatMap((s: any) => s.toolCalls ?? [])
          this.events.monologue(`Workflow "${workflow.name}" completed. Used ${toolCalls.length} tool(s): ${toolCalls.map((c: any) => c.toolName).join(', ')}`)

          if (text) {
            this.events.monologue(text.slice(0, 300))
          }

          return true
        } catch (err) {
          if (!activeWorkflow.timedOut) {
            this.events.monologue(`Workflow "${workflow.name}" error: ${(err as Error).message}`)
          }
          return false
        } finally {
          activeWorkflow.finished = true
          if (this.activeWorkflow === activeWorkflow) {
            this.activeWorkflow = undefined
          }
        }
      })()

      void workflowPromise.then(async (success) => {
        if (!activeWorkflow.timedOut || !success) return
        this.markFired(workflow.trigger, Date.now())
        if (workflow.runOnce) this.completedOnce.add(workflow.trigger.timerKey)
        await this.timerStore.write(this.timers)
        this.events.monologue(
          `Workflow "${workflow.name}" completed after timeout. Timers updated to avoid duplicate reruns.`,
        )
      })

      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          activeWorkflow.timedOut = true
          abortController.abort()
          reject(new Error(`Workflow "${workflow.name}" timed out after ${workflowTimeoutMs / 1000}s`))
        }, workflowTimeoutMs)
      })

      return await Promise.race([workflowPromise, timeoutPromise])
    } catch (err) {
      this.events.monologue(`Workflow "${workflow.name}" error: ${(err as Error).message}`)
      return false
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle)
    }
  }
}

function resolveWorkflowTimeoutMs(): number {
  const raw = Number(process.env.WORKFLOW_TIMEOUT_MS ?? 25 * 60 * 1000)
  return Number.isFinite(raw) && raw > 0 ? raw : 25 * 60 * 1000
}
