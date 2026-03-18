import { createEigenGateway } from '@layr-labs/ai-gateway-provider'
import type { EigenGatewayProviderConfig } from '@layr-labs/ai-gateway-provider'

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
let eigenProvider: ReturnType<typeof createEigenGateway> | null = null

export function assertModelProviderConfigured(): void {
  if (!resolveBaseURL()) {
    throw new Error('LLM_PROXY_URL or EIGEN_GATEWAY_URL is required.')
  }

  if (!resolveStaticJwt() && !resolveAttestConfig()) {
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
  return getEigenProvider()(modelId)
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

export function getEigenProvider(): ReturnType<typeof createEigenGateway> {
  const baseURL = resolveBaseURL()
  const jwt = resolveStaticJwt()
  const attestConfig = resolveAttestConfig()

  if (!baseURL || (!jwt && !attestConfig)) {
    throw new Error('Proxy provider is not configured.')
  }

  if (!eigenProvider) {
    const config: EigenGatewayProviderConfig = {
      baseURL,
      debug: process.env.DEBUG === 'true',
    }

    if (jwt) {
      config.jwt = jwt
    }

    if (attestConfig) {
      config.attestConfig = attestConfig
    }

    eigenProvider = createEigenGateway(config)
  }

  return eigenProvider
}

function resolveBaseURL(): string | undefined {
  return process.env.LLM_PROXY_URL?.trim() || process.env.EIGEN_GATEWAY_URL?.trim()
}

function resolveStaticJwt(): string | undefined {
  return process.env.LLM_PROXY_API_KEY?.trim() || process.env.KMS_AUTH_JWT?.trim()
}

function resolveAttestConfig(): { kmsServerURL: string; kmsPublicKey: string; audience: string } | undefined {
  const kmsServerURL = process.env.KMS_SERVER_URL?.trim()
  const kmsPublicKey = process.env.KMS_PUBLIC_KEY?.trim()
  if (kmsServerURL && kmsPublicKey) {
    return { kmsServerURL, kmsPublicKey, audience: 'llm-proxy' }
  }
  return undefined
}
