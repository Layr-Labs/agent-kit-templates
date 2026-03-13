import { afterEach, describe, expect, it } from 'bun:test'
import { assertAiGatewayConfigured, resolveModel } from '../src/config/models.js'

const originalGatewayKey = process.env.AI_GATEWAY_API_KEY

afterEach(() => {
  if (originalGatewayKey === undefined) {
    delete process.env.AI_GATEWAY_API_KEY
  } else {
    process.env.AI_GATEWAY_API_KEY = originalGatewayKey
  }
})

describe('gateway-only model resolution', () => {
  it('fails fast when AI Gateway is not configured', () => {
    delete process.env.AI_GATEWAY_API_KEY

    expect(() => assertAiGatewayConfigured()).toThrow('AI_GATEWAY_API_KEY is required')
    expect(() => resolveModel({ engagement: 'anthropic/claude-haiku-4.5' } as any, 'engagement')).toThrow('AI_GATEWAY_API_KEY is required')
  })

  it('resolves models through AI Gateway when configured', () => {
    process.env.AI_GATEWAY_API_KEY = 'test-key'

    const model = resolveModel({ engagement: 'anthropic/claude-haiku-4.5' } as any, 'engagement')
    expect(model).toBeTruthy()
  })
})
