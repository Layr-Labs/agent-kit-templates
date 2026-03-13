import { describe, expect, it, mock } from 'bun:test'
import { generateTrackedText } from '../src/ai/tracking.js'

describe('generateTrackedText', () => {
  it('passes an explicit retry budget to every inference', async () => {
    const runGenerateText = mock(async (options: Record<string, unknown>) => {
      expect(options.maxRetries).toBe(2)
      return { text: 'ok' }
    })

    const result = await generateTrackedText({
      operation: 'test_inference',
      modelId: 'anthropic/claude-sonnet-4.6',
      model: 'test-model',
      prompt: 'Hello',
    }, runGenerateText as any)

    expect(result.text).toBe('ok')
    expect(runGenerateText).toHaveBeenCalledTimes(1)
  })

  it('strips Anthropic cache control when using gateway model ids', async () => {
    const runGenerateText = mock(async (options: Record<string, any>) => {
      expect(options.providerOptions.anthropic?.cacheControl).toBeUndefined()
      expect(options.providerOptions.anthropic?.mode).toBe('tools')
      return { text: 'ok' }
    })

    await generateTrackedText({
      operation: 'compile_agent',
      modelId: 'anthropic/claude-sonnet-4.6',
      model: 'test-model',
      prompt: 'Hello',
      providerOptions: {
        anthropic: {
          cacheControl: { type: 'ephemeral' },
          mode: 'tools',
        },
      },
    }, runGenerateText as any)

    expect(runGenerateText).toHaveBeenCalledTimes(1)
  })

  it('keeps Anthropic cache control for non-gateway model ids', async () => {
    const runGenerateText = mock(async (options: Record<string, any>) => {
      expect(options.providerOptions.anthropic?.cacheControl).toEqual({ type: 'ephemeral' })
      return { text: 'ok' }
    })

    await generateTrackedText({
      operation: 'compile_agent',
      modelId: 'test-model',
      model: 'test-model',
      prompt: 'Hello',
      providerOptions: {
        anthropic: {
          cacheControl: { type: 'ephemeral' },
        },
      },
    }, runGenerateText as any)

    expect(runGenerateText).toHaveBeenCalledTimes(1)
  })
})
