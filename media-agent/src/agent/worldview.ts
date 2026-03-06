import { Output } from 'ai'
import { z } from 'zod'
import { JsonStore } from '../store/json-store.js'
import { EventBus } from '../console/events.js'
import type { AgentIdentity, Worldview } from '../types.js'
import type { Config } from '../config/index.js'
import { buildPersonaPrompt } from '../prompts/identity.js'
import { generateTrackedText } from '../ai/tracking.js'

const reflectionSchema = z.object({
  beliefs: z.array(z.string()).describe('Updated beliefs (5-7 items). Change sparingly.'),
  themes: z.array(z.string()).describe('Updated recurring themes (6-10 items).'),
  punchesUp: z.array(z.string()).describe('Updated punch-up targets (4-6 items).'),
  respects: z.array(z.string()).describe('Updated respects (4-6 items).'),
  reasoning: z.string().describe('Brief monologue about what changed and why. First person.'),
  changed: z.boolean().describe('Did anything actually change?'),
})

export class WorldviewStore {
  private store: JsonStore<Worldview & { changelog: Array<{ date: number; summary: string }> }>
  private current: (Worldview & { changelog: Array<{ date: number; summary: string }> }) | null = null
  private reflectionPrompt: string

  constructor(
    private events: EventBus,
    private config: Config,
    private identity: AgentIdentity,
    storePath: string,
  ) {
    this.store = new JsonStore(storePath)

    const persona = buildPersonaPrompt(identity)
    this.reflectionPrompt = `
${persona}

You are reflecting on your recent work and how it's shaped your thinking.
This is a rare, introspective moment. Your worldview can evolve, but it evolves SLOWLY.

Guidelines:
- Be CONSERVATIVE. Real worldview evolution is slow.
- Only add a new theme if it's genuinely emerging from your work.
- Only drop a theme if you've exhausted it or it no longer resonates.
- Beliefs are deep convictions. They change RARELY.
- Set changed=false if nothing substantively shifted.
- Your reasoning will be broadcast on your live console. Make it honest.
`.trim()
  }

  async init(): Promise<void> {
    this.current = await this.store.read()
    if (!this.current) {
      this.current = {
        beliefs: this.identity.beliefs,
        themes: this.identity.themes,
        punchesUp: this.identity.punchesUp,
        respects: this.identity.respects,
        evolvedAt: Date.now(),
        changelog: [],
      }
      await this.store.write(this.current)
    }
  }

  get(): Worldview {
    return this.current ?? {
      beliefs: this.identity.beliefs,
      themes: this.identity.themes,
      punchesUp: this.identity.punchesUp,
      respects: this.identity.respects,
    }
  }

  getThemesPrompt(): string {
    const wv = this.get()
    return `RECURRING THEMES (reference and build on these):\n${wv.themes.map(t => `- ${t}`).join('\n')}`
  }

  getForFrontend() {
    const wv = this.get()
    return {
      beliefs: wv.beliefs,
      punchesUp: wv.punchesUp,
      respects: wv.respects,
      evolvedAt: wv.evolvedAt,
      changelog: this.current?.changelog.slice(-50) ?? [],
    }
  }

  async reflect(recentPosts: string[]): Promise<boolean> {
    if (recentPosts.length < 3) {
      this.events.monologue('Not enough recent work to reflect on.')
      return false
    }

    const wv = this.get()
    this.events.monologue('Time to reflect on my recent work...')

    const { output: object } = await generateTrackedText({
      operation: 'worldview_reflection',
      modelId: this.config.modelId('reflection'),
      model: this.config.model('reflection'),
      output: Output.object({ schema: reflectionSchema }),
      system: this.reflectionPrompt,
      prompt: [
        'CURRENT WORLDVIEW:',
        '',
        'Beliefs:',
        ...wv.beliefs.map(b => `- ${b}`),
        '',
        'Recurring themes:',
        ...wv.themes.map(t => `- ${t}`),
        '',
        'I punch up at:',
        ...wv.punchesUp.map(p => `- ${p}`),
        '',
        'I respect:',
        ...wv.respects.map(r => `- ${r}`),
        '',
        'MY RECENT POSTS (most recent first):',
        ...recentPosts.map((p, i) => `${i + 1}. "${p}"`),
        '',
        'Reflect on this body of work. Has anything shifted?',
      ].join('\n'),
    })
    if (!object) throw new Error('Failed to generate worldview reflection')

    this.events.monologue(object.reasoning)

    if (!object.changed) {
      this.events.monologue('After reflection: my views hold. Nothing to update.')
      return false
    }

    const updated = {
      beliefs: object.beliefs,
      themes: object.themes,
      punchesUp: object.punchesUp,
      respects: object.respects,
      evolvedAt: Date.now(),
      changelog: [
        ...(this.current?.changelog ?? []),
        { date: Date.now(), summary: object.reasoning },
      ],
    }

    this.current = updated
    await this.store.write(updated)

    this.events.monologue('Worldview updated.')
    return true
  }
}
