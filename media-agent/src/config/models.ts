import { createGateway } from 'ai'

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
let gatewayProvider: ReturnType<typeof createGateway> | null = null

export function assertModelProviderConfigured(): void {
  if (!resolveProxyBaseURL()) {
    throw new Error('LLM_PROXY_URL or EIGEN_GATEWAY_URL is required.')
  }

  if (!resolveProxyApiKey()) {
    throw new Error('LLM_PROXY_API_KEY or KMS_AUTH_JWT is required.')
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

  assertModelProviderConfigured()
  return getGatewayProvider()(modelId)
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

export function getGatewayProvider(): ReturnType<typeof createGateway> {
  const baseURL = resolveProxyBaseURL()
  const apiKey = resolveProxyApiKey()

  if (!baseURL || !apiKey) {
    throw new Error('Proxy provider is not configured.')
  }

  if (!gatewayProvider) {
    gatewayProvider = createGateway({
      baseURL,
      apiKey,
    })
  }

  return gatewayProvider
}

function resolveProxyBaseURL(): string | undefined {
  return process.env.LLM_PROXY_URL?.trim() || process.env.EIGEN_GATEWAY_URL?.trim()
}

function resolveProxyApiKey(): string | undefined {
  return process.env.LLM_PROXY_API_KEY?.trim() || process.env.KMS_AUTH_JWT?.trim()
}
