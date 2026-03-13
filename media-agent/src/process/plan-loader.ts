import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import type { ProcessPlan, ProcessWorkflow, BackgroundTask } from './types.js'

interface RawWorkflow {
  name: string
  priority: number
  timerKey: string
  intervalMs: number
  skills: string[]
  instruction: string
  runOnce?: boolean
}

interface RawBackgroundTask {
  name: string
  timerKey: string
  intervalMs: number
  skill: string
  tool: string
}

interface RawProcessToml {
  description?: string
  workflows?: RawWorkflow[]
  backgroundTasks?: RawBackgroundTask[]
}

export interface LoadedProcess {
  plan: ProcessPlan
  /** Creative process description shown to the LLM in workflow system prompts. */
  description: string
}

/**
 * Load the deterministic process plan from PROCESS.toml.
 * This is the primary process definition format — no LLM compilation needed.
 */
export function loadProcessPlan(path?: string): LoadedProcess {
  const tomlPath = path ?? resolve(process.cwd(), 'PROCESS.toml')
  if (!existsSync(tomlPath)) {
    throw new Error(`Missing required file: PROCESS.toml (looked at ${tomlPath})`)
  }

  const { parse } = require('smol-toml') as typeof import('smol-toml')
  const raw = readFileSync(tomlPath, 'utf-8')
  const parsed = parse(raw) as unknown as RawProcessToml

  const description = parsed.description ?? ''

  const workflows: ProcessWorkflow[] = (parsed.workflows ?? []).map(w => {
    if (!w.name) throw new Error('PROCESS.toml: workflow missing "name"')
    if (!w.timerKey) throw new Error(`PROCESS.toml: workflow "${w.name}" missing "timerKey"`)
    if (!w.intervalMs) throw new Error(`PROCESS.toml: workflow "${w.name}" missing "intervalMs"`)
    if (!w.instruction) throw new Error(`PROCESS.toml: workflow "${w.name}" missing "instruction"`)
    if (!w.skills || w.skills.length === 0) throw new Error(`PROCESS.toml: workflow "${w.name}" missing "skills"`)

    return {
      name: w.name,
      trigger: {
        type: 'interval' as const,
        intervalMs: w.intervalMs,
        timerKey: w.timerKey,
      },
      instruction: w.instruction,
      priority: w.priority ?? 5,
      runOnce: w.runOnce ?? false,
      skills: w.skills,
    }
  })

  const backgroundTasks: BackgroundTask[] = (parsed.backgroundTasks ?? []).map(t => {
    if (!t.name) throw new Error('PROCESS.toml: background task missing "name"')
    if (!t.timerKey) throw new Error(`PROCESS.toml: background task "${t.name}" missing "timerKey"`)
    if (!t.intervalMs) throw new Error(`PROCESS.toml: background task "${t.name}" missing "intervalMs"`)
    if (!t.tool) throw new Error(`PROCESS.toml: background task "${t.name}" missing "tool"`)

    return {
      name: t.name,
      trigger: {
        type: 'interval' as const,
        intervalMs: t.intervalMs,
        timerKey: t.timerKey,
      },
      skill: t.skill ?? '',
      tool: t.tool,
    }
  })

  console.log(`Loaded process plan from PROCESS.toml: ${workflows.length} workflows, ${backgroundTasks.length} background tasks.`)

  return {
    plan: { workflows, backgroundTasks },
    description,
  }
}
