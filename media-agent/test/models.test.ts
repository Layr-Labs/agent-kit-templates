import { afterEach, describe, expect, it } from 'bun:test'
import { assertModelProviderConfigured, resolveModel } from '../src/config/models.js'

const originalProxyUrl = process.env.LLM_PROXY_URL
const originalEigenGatewayUrl = process.env.EIGEN_GATEWAY_URL
const originalProxyApiKey = process.env.LLM_PROXY_API_KEY
const originalKmsAuthJwt = process.env.KMS_AUTH_JWT

afterEach(() => {
  if (originalProxyUrl === undefined) {
    delete process.env.LLM_PROXY_URL
  } else {
    process.env.LLM_PROXY_URL = originalProxyUrl
  }

  if (originalEigenGatewayUrl === undefined) {
    delete process.env.EIGEN_GATEWAY_URL
  } else {
    process.env.EIGEN_GATEWAY_URL = originalEigenGatewayUrl
  }

  if (originalProxyApiKey === undefined) {
    delete process.env.LLM_PROXY_API_KEY
  } else {
    process.env.LLM_PROXY_API_KEY = originalProxyApiKey
  }

  if (originalKmsAuthJwt === undefined) {
    delete process.env.KMS_AUTH_JWT
  } else {
    process.env.KMS_AUTH_JWT = originalKmsAuthJwt
  }
})

describe('proxy-backed model resolution', () => {
  it('fails fast when the proxy base URL is not configured', () => {
    delete process.env.LLM_PROXY_URL
    delete process.env.EIGEN_GATEWAY_URL
    process.env.LLM_PROXY_API_KEY = 'test-key'

    expect(() => assertModelProviderConfigured()).toThrow('LLM_PROXY_URL or EIGEN_GATEWAY_URL is required')
    expect(() => resolveModel({ engagement: 'anthropic/claude-haiku-4.5' } as any, 'engagement')).toThrow('LLM_PROXY_URL or EIGEN_GATEWAY_URL is required')
  })

  it('fails fast when proxy auth is not configured', () => {
    process.env.EIGEN_GATEWAY_URL = 'https://proxy.example.com'
    delete process.env.LLM_PROXY_API_KEY
    delete process.env.KMS_AUTH_JWT

    expect(() => assertModelProviderConfigured()).toThrow('LLM_PROXY_API_KEY or KMS_AUTH_JWT is required')
  })

  it('resolves models through the proxy provider when configured', () => {
    process.env.EIGEN_GATEWAY_URL = 'https://proxy.example.com'
    process.env.LLM_PROXY_API_KEY = 'test-key'

    const model = resolveModel({ engagement: 'anthropic/claude-haiku-4.5' } as any, 'engagement')
    expect(model).toBeTruthy()
  })
})
