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

  it('strips empty prompts and blank text content blocks before inference', async () => {
    const runGenerateText = mock(async (options: Record<string, any>) => {
      expect(options.prompt).toBeUndefined()
      expect(options.system).toBeUndefined()
      expect(options.messages).toEqual([
        {
          role: 'user',
          content: [
            { type: 'image', image: new Uint8Array([1, 2, 3]), mimeType: 'image/png' },
            { type: 'text', text: 'Review the attached image.' },
          ],
        },
      ])
      return { text: 'ok' }
    })

    const result = await generateTrackedText({
      operation: 'sanitize_messages',
      modelId: 'anthropic/claude-sonnet-4.6',
      model: 'test-model',
      prompt: '   ',
      system: '\n\n',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: '' },
            { type: 'image', image: new Uint8Array([1, 2, 3]), mimeType: 'image/png' },
            { type: 'text', text: 'Review the attached image.' },
            { type: 'text', text: '   ' },
          ],
        },
        {
          role: 'assistant',
          content: '   ',
        },
      ],
    }, runGenerateText as any)

    expect(result.text).toBe('ok')
    expect(runGenerateText).toHaveBeenCalledTimes(1)
  })

  it('fails fast when an inference request has no usable prompt content', async () => {
    const runGenerateText = mock(async (_options: Record<string, unknown>) => {
      throw new Error('should not be called')
    })

    await expect(generateTrackedText({
      operation: 'empty_request',
      modelId: 'anthropic/claude-sonnet-4.6',
      model: 'test-model',
      prompt: '   ',
      messages: [
        { role: 'user', content: '  ' },
        { role: 'assistant', content: [{ type: 'text', text: '' }] },
      ],
    }, runGenerateText as any)).rejects.toThrow('Inference request "empty_request" has no non-empty prompt content.')

    expect(runGenerateText).not.toHaveBeenCalled()
  })
})
