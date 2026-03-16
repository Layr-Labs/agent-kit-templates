import { gateway } from 'ai'

export type ModelTask =
  | 'scoring'
  | 'ideation'
  | 'generation'
  | 'caption'
  | 'review'
  | 'editing'
  | 'writing'
  | 'engagement'
  | 'monologue'
  | 'reflection'
  | 'compilation'

const agentModelOverride = process.env.AGENT_MODEL?.trim()

export function assertAiGatewayConfigured(): void {
  if (!process.env.AI_GATEWAY_API_KEY) {
    throw new Error('AI_GATEWAY_API_KEY is required. Direct provider fallback has been removed.')
  }
}

export function resolveModel(
  models: Record<string, string> & { overrides?: Record<string, string> },
  task: ModelTask,
  contentType?: string,
) {
  const overrideKey = contentType ? `${contentType}_${task}` : undefined
  const modelId =
    resolveRuntimeModelOverride(task) ||
    ((overrideKey && models.overrides?.[overrideKey]) || models[task] || (task === 'review' ? models.editing : undefined))

  if (!modelId) {
    throw new Error(`No model configured for task: ${task}`)
  }

  assertAiGatewayConfigured()
  return gateway(modelId)
}

export function resolveModelId(
  models: Record<string, string> & { overrides?: Record<string, string> },
  task: ModelTask,
  contentType?: string,
): string {
  const overrideKey = contentType ? `${contentType}_${task}` : undefined
  return resolveRuntimeModelOverride(task) ||
    (overrideKey && models.overrides?.[overrideKey]) ||
    models[task] ||
    (task === 'review' ? models.editing : undefined) ||
    'anthropic/claude-sonnet-4.6'
}

function resolveRuntimeModelOverride(task: ModelTask): string | undefined {
  if (!agentModelOverride) return undefined
  if (task === 'generation' || task === 'review') return undefined
  return agentModelOverride
}
