import { generateText } from 'ai'
import { appendFile, mkdir, readFile } from 'fs/promises'
import { dirname, join } from 'path'
import type { EventBus } from '../console/events.js'

export interface CostRecord {
  ts: number
  operation: string
  modelId: string
  providerModelId?: string
  generationId?: string
  success: boolean
  durationMs: number
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  cachedTokens?: number
  costUsd?: number
  marketCostUsd?: number
  error?: string
}

interface CostSummaryBucket {
  modelId: string
  calls: number
  failures: number
  costUsd: number
  marketCostUsd: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cachedTokens: number
  avgCostUsd: number
}

interface OperationCostBucket {
  operation: string
  calls: number
  failures: number
  costUsd: number
  marketCostUsd: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  avgDurationMs: number
  avgCostUsd: number
}

export interface CostSummary {
  totalCalls: number
  failedCalls: number
  totalCostUsd: number
  totalMarketCostUsd: number
  totalInputTokens: number
  totalOutputTokens: number
  totalTokens: number
  totalCachedTokens: number
  byModel: CostSummaryBucket[]
  byOperation: OperationCostBucket[]
  recent: CostRecord[]
}

class CostTracker {
  private readonly logPath: string
  private records: CostRecord[] = []

  constructor(dataDir: string, private readonly events: EventBus) {
    this.logPath = join(dataDir, 'costs', 'usage.jsonl')
  }

  async init(): Promise<void> {
    await mkdir(dirname(this.logPath), { recursive: true })
    try {
      const raw = await readFile(this.logPath, 'utf-8')
      const lines = raw.trim().split('\n').filter(Boolean)
      this.records = lines.flatMap((line) => {
        try {
          return [JSON.parse(line) as CostRecord]
        } catch {
          return []
        }
      })
    } catch {
      this.records = []
    }
  }

  async record(record: CostRecord): Promise<void> {
    this.records.push(record)
    await appendFile(this.logPath, JSON.stringify(record) + '\n')

    if (typeof record.costUsd === 'number') {
      this.events.emit({ type: 'metric', name: 'llm_cost_usd', value: record.costUsd, ts: record.ts })
    }

    this.events.emit({
      type: 'skill',
      skill: 'llm',
      action: `${record.operation} -> ${record.modelId}${typeof record.costUsd === 'number' ? ` ($${record.costUsd.toFixed(6)})` : ''}`,
      details: {
        success: record.success,
        totalTokens: record.totalTokens,
        costUsd: record.costUsd,
        durationMs: record.durationMs,
      },
      ts: record.ts,
    })
  }

  getSummary(limit = 50): CostSummary {
    const byModel = new Map<string, Omit<CostSummaryBucket, 'avgCostUsd'>>()
    const byOperation = new Map<string, Omit<OperationCostBucket, 'avgCostUsd' | 'avgDurationMs'> & { totalDurationMs: number }>()

    let totalCalls = 0
    let failedCalls = 0
    let totalCostUsd = 0
    let totalMarketCostUsd = 0
    let totalInputTokens = 0
    let totalOutputTokens = 0
    let totalTokens = 0
    let totalCachedTokens = 0

    for (const record of this.records) {
      totalCalls += 1
      if (!record.success) failedCalls += 1
      totalCostUsd += record.costUsd ?? 0
      totalMarketCostUsd += record.marketCostUsd ?? 0
      totalInputTokens += record.inputTokens ?? 0
      totalOutputTokens += record.outputTokens ?? 0
      totalTokens += record.totalTokens ?? 0
      totalCachedTokens += record.cachedTokens ?? 0

      // By model
      const modelBucket = byModel.get(record.modelId) ?? {
        modelId: record.modelId,
        calls: 0,
        failures: 0,
        costUsd: 0,
        marketCostUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cachedTokens: 0,
      }
      modelBucket.calls += 1
      if (!record.success) modelBucket.failures += 1
      modelBucket.costUsd += record.costUsd ?? 0
      modelBucket.marketCostUsd += record.marketCostUsd ?? 0
      modelBucket.inputTokens += record.inputTokens ?? 0
      modelBucket.outputTokens += record.outputTokens ?? 0
      modelBucket.totalTokens += record.totalTokens ?? 0
      modelBucket.cachedTokens += record.cachedTokens ?? 0
      byModel.set(record.modelId, modelBucket)

      // By operation (task)
      const opBucket = byOperation.get(record.operation) ?? {
        operation: record.operation,
        calls: 0,
        failures: 0,
        costUsd: 0,
        marketCostUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        totalDurationMs: 0,
      }
      opBucket.calls += 1
      if (!record.success) opBucket.failures += 1
      opBucket.costUsd += record.costUsd ?? 0
      opBucket.marketCostUsd += record.marketCostUsd ?? 0
      opBucket.inputTokens += record.inputTokens ?? 0
      opBucket.outputTokens += record.outputTokens ?? 0
      opBucket.totalTokens += record.totalTokens ?? 0
      opBucket.totalDurationMs += record.durationMs ?? 0
      byOperation.set(record.operation, opBucket)
    }

    return {
      totalCalls,
      failedCalls,
      totalCostUsd,
      totalMarketCostUsd,
      totalInputTokens,
      totalOutputTokens,
      totalTokens,
      totalCachedTokens,
      byModel: [...byModel.values()]
        .map(bucket => ({ ...bucket, avgCostUsd: bucket.calls > 0 ? bucket.costUsd / bucket.calls : 0 }))
        .sort((a, b) => b.costUsd - a.costUsd),
      byOperation: [...byOperation.values()]
        .map(({ totalDurationMs, ...bucket }) => ({
          ...bucket,
          avgCostUsd: bucket.calls > 0 ? bucket.costUsd / bucket.calls : 0,
          avgDurationMs: bucket.calls > 0 ? Math.round(totalDurationMs / bucket.calls) : 0,
        }))
        .sort((a, b) => b.costUsd - a.costUsd),
      recent: this.records.slice(-limit).reverse(),
    }
  }
}

let tracker: CostTracker | null = null

export async function initCostTracker(dataDir: string, events: EventBus): Promise<CostTracker> {
  tracker = new CostTracker(dataDir, events)
  await tracker.init()
  return tracker
}

export function getCostTracker(): CostTracker | null {
  return tracker
}

export async function generateTrackedText(
  options: Record<string, unknown> & { operation: string; modelId?: string },
  runGenerateText: typeof generateText = generateText,
): Promise<any> {
  const { operation, modelId, ...generateOptions } = options
  const startedAt = Date.now()
  const providerOptions = withOpenAIStrictSchemaDisabled(
    stripGatewayIncompatibleProviderOptions(
      modelId,
      generateOptions.providerOptions as Record<string, unknown> | undefined,
    ),
  )
  const maxRetries = resolveInferenceMaxRetries()
  const normalizedGenerateOptions = normalizeGenerateOptions({
    ...generateOptions,
    providerOptions,
  }, operation)

  try {
    const result = await runGenerateText({
      ...normalizedGenerateOptions,
      maxRetries,
    } as any)
    await tracker?.record(buildCostRecord({
      operation,
      modelId: modelId ?? inferModelId(result),
      result,
      startedAt,
      error: undefined,
    }))
    return result
  } catch (error) {
    await tracker?.record(buildCostRecord({
      operation,
      modelId: modelId ?? 'unknown',
      result: null,
      startedAt,
      error: error instanceof Error ? error.message : String(error),
    }))
    throw error
  }
}

function normalizeGenerateOptions(
  options: Record<string, unknown>,
  operation: string,
): Record<string, unknown> {
  const normalized: Record<string, unknown> = { ...options }

  if (typeof normalized.system === 'string' && normalized.system.trim().length === 0) {
    delete normalized.system
  }

  if (typeof normalized.prompt === 'string' && normalized.prompt.trim().length === 0) {
    delete normalized.prompt
  }

  if (Array.isArray(normalized.messages)) {
    const sanitizedMessages = sanitizeMessages(normalized.messages)
    if (sanitizedMessages.length > 0) {
      normalized.messages = sanitizedMessages
    } else {
      delete normalized.messages
    }
  }

  if (!hasPromptContent(normalized)) {
    throw new Error(`Inference request "${operation}" has no non-empty prompt content.`)
  }

  return normalized
}

function sanitizeMessages(messages: unknown[]): unknown[] {
  return messages.flatMap((message) => {
    if (!isRecord(message) || !('content' in message)) return [message]

    const content = message.content
    if (typeof content === 'string') {
      return content.trim().length > 0 ? [message] : []
    }

    if (!Array.isArray(content)) return [message]

    const sanitizedContent = content.filter((part) => {
      if (!isRecord(part)) return true
      if (part.type !== 'text') return true
      return typeof part.text !== 'string' || part.text.trim().length > 0
    })

    if (sanitizedContent.length === 0) return []
    return [{ ...message, content: sanitizedContent }]
  })
}

function hasPromptContent(options: Record<string, unknown>): boolean {
  if (typeof options.prompt === 'string' && options.prompt.trim().length > 0) return true

  if (!Array.isArray(options.messages)) return false

  return options.messages.some((message) => {
    if (!isRecord(message) || !('content' in message)) return false

    const content = message.content
    if (typeof content === 'string') return content.trim().length > 0
    if (!Array.isArray(content)) return false

    return content.some((part) => {
      if (!isRecord(part)) return false
      if (part.type !== 'text') return true
      return typeof part.text === 'string' && part.text.trim().length > 0
    })
  })
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null
}

function buildCostRecord(input: {
  operation: string
  modelId: string
  result: any
  startedAt: number
  error?: string
}): CostRecord {
  const usage = input.result?.usage ?? {}
  const gatewayMeta = input.result?.providerMetadata?.gateway
    ?? input.result?.providerMetadata?.vercel?.gateway
    ?? input.result?.response?.providerMetadata?.gateway

  const inputTokens = toNumber(usage.inputTokens ?? usage.promptTokens)
  const outputTokens = toNumber(usage.outputTokens ?? usage.completionTokens)
  const totalTokens = toNumber(usage.totalTokens ?? usage.total_tokens) ?? sumNumbers(inputTokens, outputTokens)
  const cachedTokens = toNumber(
    usage.cachedInputTokens
    ?? usage.promptTokensDetails?.cachedTokens
    ?? usage.prompt_tokens_details?.cached_tokens,
  )
  const costUsd = toNumber(usage.cost ?? gatewayMeta?.cost)
  const marketCostUsd = toNumber(usage.marketCost ?? usage.market_cost ?? gatewayMeta?.marketCost ?? gatewayMeta?.marketCostUsd ?? gatewayMeta?.market_cost)

  return {
    ts: Date.now(),
    operation: input.operation,
    modelId: input.modelId,
    providerModelId: gatewayMeta?.routing?.resolvedProviderApiModelId,
    generationId: input.result?.generationId ?? gatewayMeta?.generationId,
    success: !input.error,
    durationMs: Date.now() - input.startedAt,
    inputTokens,
    outputTokens,
    totalTokens,
    cachedTokens,
    costUsd,
    marketCostUsd,
    error: input.error,
  }
}

function inferModelId(result: any): string {
  return result?.modelId
    ?? result?.response?.modelId
    ?? result?.providerMetadata?.gateway?.routing?.originalModelId
    ?? result?.providerMetadata?.vercel?.gateway?.routing?.originalModelId
    ?? 'unknown'
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.length > 0) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function sumNumbers(a?: number, b?: number): number | undefined {
  if (typeof a !== 'number' && typeof b !== 'number') return undefined
  return (a ?? 0) + (b ?? 0)
}

function withOpenAIStrictSchemaDisabled(
  providerOptions?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...(providerOptions ?? {}),
    // AI SDK 6 enables strictJsonSchema by default for OpenAI-compatible
    // providers, but this codebase still relies on optional/default-heavy
    // schemas. Relax strict mode so GPT models can execute existing flows.
    openai: {
      ...((providerOptions?.openai as Record<string, unknown> | undefined) ?? {}),
      strictJsonSchema: false,
    },
    azure: {
      ...((providerOptions?.azure as Record<string, unknown> | undefined) ?? {}),
      strictJsonSchema: false,
    },
  }
}

function stripGatewayIncompatibleProviderOptions(
  modelId: string | undefined,
  providerOptions?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!providerOptions || !looksLikeGatewayModelId(modelId)) {
    return providerOptions
  }

  const anthropicOptions = providerOptions.anthropic as Record<string, unknown> | undefined
  if (!anthropicOptions || (!('cacheControl' in anthropicOptions) && !('cache_control' in anthropicOptions))) {
    return providerOptions
  }

  // Gateway fallbacks may route an Anthropic model ID to non-Anthropic providers
  // (for example Vertex or Bedrock), and Anthropic prompt-caching metadata causes
  // those providers to reject the request as an invalid payload.
  const nextAnthropicOptions = { ...anthropicOptions }
  delete nextAnthropicOptions.cacheControl
  delete nextAnthropicOptions.cache_control

  const nextProviderOptions: Record<string, unknown> = { ...providerOptions }
  if (Object.keys(nextAnthropicOptions).length > 0) {
    nextProviderOptions.anthropic = nextAnthropicOptions
  } else {
    delete nextProviderOptions.anthropic
  }

  return nextProviderOptions
}

function looksLikeGatewayModelId(modelId?: string): boolean {
  return typeof modelId === 'string' && /^[a-z0-9-]+\/[a-z0-9][^/\s]*$/i.test(modelId)
}

function resolveInferenceMaxRetries(): number {
  const raw = Number(process.env.AI_INFERENCE_MAX_RETRIES ?? 2)
  if (!Number.isFinite(raw) || raw < 0) return 2
  return Math.floor(raw)
}
