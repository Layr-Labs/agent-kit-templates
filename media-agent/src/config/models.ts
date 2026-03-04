import { gateway } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'

export type ModelTask =
  | 'scoring'
  | 'ideation'
  | 'generation'
  | 'caption'
  | 'editing'
  | 'writing'
  | 'engagement'
  | 'monologue'
  | 'reflection'
  | 'compilation'

const useGateway = !!process.env.AI_GATEWAY_API_KEY

export function resolveModel(
  models: Record<string, string> & { overrides?: Record<string, string> },
  task: ModelTask,
  contentType?: string,
) {
  const overrideKey = contentType ? `${contentType}_${task}` : undefined
  const modelId = (overrideKey && models.overrides?.[overrideKey]) || models[task]

  if (!modelId) {
    throw new Error(`No model configured for task: ${task}`)
  }

  if (useGateway) return gateway(modelId)
  return anthropic(modelId)
}

export function resolveModelId(
  models: Record<string, string> & { overrides?: Record<string, string> },
  task: ModelTask,
  contentType?: string,
): string {
  const overrideKey = contentType ? `${contentType}_${task}` : undefined
  return (overrideKey && models.overrides?.[overrideKey]) || models[task] || 'claude-sonnet-4-6'
}
