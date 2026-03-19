import { createEigenGateway } from '@layr-labs/ai-gateway-provider'
import type { EigenGatewayProviderConfig } from '@layr-labs/ai-gateway-provider'
import { AttestClient, JwtProvider } from '@layr-labs/ecloud-sdk/attest'
import { log } from 'console'

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

let eigenProvider: ReturnType<typeof createEigenGateway> | null = null
let gatewayProjectMap: Record<string, string> | undefined
const NON_OVERRIDABLE_AGENT_MODEL_TASKS = new Set<ModelTask>(['generation', 'review', 'compilation'])

export async function initModelProvider(projectMap?: Record<string, string>): Promise<void> {
  gatewayProjectMap = projectMap
  const baseURL = await resolveBaseURL()

  if (!baseURL) {
    throw new Error(
      'Gateway URL is required. Set LLM_PROXY_URL / EIGEN_GATEWAY_URL, or configure [gateway.projects] in config.toml with attestation.',
    )
  }

  const jwt = resolveStaticJwt()
  const attestConfig = resolveAttestConfig()

  if (!jwt && !attestConfig) {
    throw new Error('LLM_PROXY_API_KEY or KMS_AUTH_JWT is required.')
  }

  // The gateway provider defaults to a 30s timeout which is too short for
  // structured-output LLM calls through a proxy. Override until the upstream
  // fix lands: https://github.com/Layr-Labs/ai-gateway-provider/pull/2
  const config: EigenGatewayProviderConfig = {
    baseURL,
    debug: process.env.DEBUG === 'true',
    timeout: 1_200_000,
  }

  if (jwt) {
    config.jwt = jwt
  }

  if (attestConfig) {
    config.attestConfig = attestConfig
  }

  eigenProvider = createEigenGateway(config)
}

export function getEigenProvider(): ReturnType<typeof createEigenGateway> {
  if (!eigenProvider) {
    throw new Error('Model provider not initialised. Call initModelProvider() first.')
  }
  return eigenProvider
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

  if (!eigenProvider) {
    throw new Error('Model provider not initialised. Call initModelProvider() first.')
  }

  return eigenProvider(modelId)
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
  const agentModelOverride = process.env.AGENT_MODEL?.trim()
  if (!agentModelOverride) return undefined
  if (NON_OVERRIDABLE_AGENT_MODEL_TASKS.has(task)) return undefined
  return agentModelOverride
}

async function resolveBaseURL(): Promise<string | undefined> {
  const envURL = process.env.LLM_PROXY_URL?.trim() || process.env.EIGEN_GATEWAY_URL?.trim()
  if (envURL) return envURL

  const attestConfig = resolveAttestConfig()
  if (!attestConfig || !gatewayProjectMap || Object.keys(gatewayProjectMap).length === 0) {
    return undefined
  }

  const attestClient = new AttestClient(attestConfig)
  const jwtProvider = new JwtProvider(attestClient)
  const token = await jwtProvider.getToken()

  const projectId = decodeProjectId(token)
  if (!projectId) {
    throw new Error('JWT does not contain a submods.gce.project_id claim. Cannot resolve gateway URL.')
  }

  const url = gatewayProjectMap[projectId]
  if (!url) {
    throw new Error(
      `No gateway URL configured for project "${projectId}". Add it to [gateway.projects] in config.toml.`,
    )
  }

  return url
}

function decodeProjectId(jwt: string): string | undefined {
  const payload = jwt.split('.')[1]
  if (!payload) return undefined
  const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString())
  return decoded.submods?.gce?.project_id
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
