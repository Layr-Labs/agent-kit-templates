import type { AgentIdentity } from '../types.js'
import type { Config } from '../config/index.js'
import { ProcessExecutor } from '../process/executor.js'
import { EventBus } from '../console/events.js'
import { SkillRegistry } from '../skills/registry.js'

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export class AgentLoop {
  private running = false

  constructor(
    private events: EventBus,
    private executor: ProcessExecutor,
    private skills: SkillRegistry,
    private config: Config,
    private identity: AgentIdentity,
  ) {}

  async start(): Promise<void> {
    this.running = true
    await this.executor.init()
    this.events.monologue(`${this.identity.name} is live.`)

    while (this.running) {
      try {
        await this.executor.tick()
        if (!this.executor.hasRunningWorkflow()) {
          await this.skills.tickAll()
        }
      } catch (err) {
        this.events.monologue(`Loop error: ${(err as Error).message}. Recovering...`)
      }
      await sleep(this.config.tickIntervalMs)
    }
  }

  stop(): void {
    this.running = false
  }
}
