export interface Trigger {
  type: 'interval'
  intervalMs: number
  timerKey: string
}

export interface ProcessWorkflow {
  name: string
  trigger: Trigger
  instruction: string
  priority: number
  runOnce?: boolean
  /** When set, only tools from these skills (own tools + toolScope) are provided to the LLM. */
  skills?: string[]
}

export interface ProcessPlan {
  backgroundTasks: BackgroundTask[]
  workflows: ProcessWorkflow[]
}

export interface BackgroundTask {
  name: string
  trigger: Trigger
  skill: string
  tool: string
}

export interface CompiledStyle {
  name: string
  description: string
  visualIdentity: string
  compositionPrinciples: string
  renderingRules: string
}

export interface CompiledEngagement {
  voiceDescription: string
  rules: string[]
}

export interface CompiledGovernance {
  upgradeRules: string[]
  financialCommitments: string[]
  restrictions: string[]
}

export interface CompiledAgent {
  version: number
  compilerVersion: number
  compiledAt: number
  sourceHash: string
  identity: {
    name: string
    tagline: string
    creator: string
    born?: string
    bio?: string
    persona: string
    beliefs: string[]
    themes: string[]
    punchesUp: string[]
    respects: string[]
    voice: string
    restrictions: string[]
    motto: string
  }
  style?: CompiledStyle
  engagement?: CompiledEngagement
  governance: CompiledGovernance
  plan: ProcessPlan
  creativeProcess: string
}
