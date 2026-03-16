import { afterEach, describe, expect, it } from 'bun:test'
import { assertModelProviderConfigured, resolveModel } from '../src/config/models.js'

const envKeys = [
  'LLM_PROXY_URL',
  'EIGEN_GATEWAY_URL',
  'LLM_PROXY_API_KEY',
  'KMS_AUTH_JWT',
  'KMS_SERVER_URL',
  'KMS_PUBLIC_KEY',
] as const

const savedEnv: Record<string, string | undefined> = {}
for (const key of envKeys) {
  savedEnv[key] = process.env[key]
}

afterEach(() => {
  for (const key of envKeys) {
    if (savedEnv[key] === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = savedEnv[key]
    }
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
    delete process.env.KMS_SERVER_URL
    delete process.env.KMS_PUBLIC_KEY

    expect(() => assertModelProviderConfigured()).toThrow('LLM_PROXY_API_KEY or KMS_AUTH_JWT is required')
  })

  it('accepts attestation config as an alternative to a static JWT', () => {
    process.env.EIGEN_GATEWAY_URL = 'https://proxy.example.com'
    delete process.env.LLM_PROXY_API_KEY
    delete process.env.KMS_AUTH_JWT
    process.env.KMS_SERVER_URL = 'https://kms.example.com'
    process.env.KMS_PUBLIC_KEY = 'test-public-key'

    expect(() => assertModelProviderConfigured()).not.toThrow()
  })

  it('resolves models through the proxy provider when configured', () => {
    process.env.EIGEN_GATEWAY_URL = 'https://proxy.example.com'
    process.env.LLM_PROXY_API_KEY = 'test-key'

    const model = resolveModel({ engagement: 'anthropic/claude-haiku-4.5' } as any, 'engagement')
    expect(model).toBeTruthy()
  })
})
