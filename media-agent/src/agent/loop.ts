import { generateText, stepCountIs } from 'ai'
import type { AgentIdentity } from '../types.js'
import type { Config } from '../config/index.js'
import { ProcessExecutor } from '../process/executor.js'
import { EventBus } from '../console/events.js'
import { SkillRegistry } from '../skills/registry.js'
import { buildPersonaPrompt } from '../prompts/identity.js'

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export class AgentLoop {
  private running = false
  private personaPrompt: string

  constructor(
    private events: EventBus,
    private executor: ProcessExecutor,
    private skills: SkillRegistry,
    private config: Config,
    private identity: AgentIdentity,
  ) {
    this.personaPrompt = buildPersonaPrompt(identity)
  }

  async start(): Promise<void> {
    this.running = true
    await this.executor.init()
    this.events.monologue(`${this.identity.name} is live.`)

    while (this.running) {
      try {
        await this.executor.tick()
        await this.agentAction()
        await this.skills.tickAll()
      } catch (err) {
        this.events.monologue(`Loop error: ${(err as Error).message}. Recovering...`)
      }
      await sleep(this.config.tickIntervalMs)
    }
  }

  stop(): void {
    this.running = false
  }

  private async agentAction(): Promise<void> {
    const tools = this.skills.tools
    if (Object.keys(tools).length === 0) return

    const toolNames = Object.keys(tools)

    try {
      const { text, steps } = await generateText({
        model: this.config.model('engagement'),
        tools,
        stopWhen: stepCountIs(15),
        system: `${this.personaPrompt}

You are the operational brain of an autonomous agent. Each tick you can use your tools to take actions.

Available tools: ${toolNames.join(', ')}

Only use tools when there's a reason to. Most ticks you should do nothing. Use tools when:
- You want to read or send email
- A periodic operational task is due
- You want to evolve your soul or creative process

If there's nothing to do, respond briefly with your current status. Do NOT use tools unnecessarily.`,
        prompt: `Current state: ${this.events.state}\n\nAnything you need to do right now?`,
        providerOptions: {
          anthropic: { cacheControl: { type: 'ephemeral' } },
        },
      })

      const toolCalls = steps.flatMap(s => s.toolCalls ?? [])
      if (toolCalls.length > 0) {
        for (const call of toolCalls) {
          this.events.emit({
            type: 'skill',
            skill: call.toolName,
            action: JSON.stringify((call as any).input ?? {}).slice(0, 200),
            ts: Date.now(),
          })
        }
        this.events.monologue(`Agent used ${toolCalls.length} tool(s): ${toolCalls.map(c => c.toolName).join(', ')}`)
      }

      if (text && text.length > 0) {
        this.events.monologue(text.slice(0, 300))
      }
    } catch (err) {
      this.events.monologue(`Agent action error: ${(err as Error).message}`)
    }
  }
}
