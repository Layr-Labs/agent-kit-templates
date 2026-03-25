const DEFAULT_EIGENMAIL_API_URL = 'https://eigenmail-mainnet-alpha-api.eigenagents.org'

export function resolveEigenMailConfig(): {
  apiUrl: string
  domain: string
} {
  const envValue = process.env.EIGENMAIL_API_URL?.trim()
  const rawApiUrl = envValue || DEFAULT_EIGENMAIL_API_URL

  console.log(`[eigenmail] resolveConfig: env=${envValue ?? '(unset)'} default=${DEFAULT_EIGENMAIL_API_URL} resolved=${rawApiUrl}`)

  let parsed: URL
  try {
    parsed = new URL(rawApiUrl)
  } catch {
    throw new Error(`Invalid EIGENMAIL_API_URL: ${rawApiUrl}`)
  }

  const config = {
    apiUrl: rawApiUrl.replace(/\/+$/, ''),
    domain: parsed.host,
  }
  console.log(`[eigenmail] resolveConfig: apiUrl=${config.apiUrl} domain=${config.domain}`)
  return config
}

export function getEigenMailClientOptions(privateKey: `0x${string}`): {
  privateKey: `0x${string}`
  apiUrl: string
  domain: string
} {
  const { apiUrl, domain } = resolveEigenMailConfig()
  const address = (() => {
    try {
      const { privateKeyToAccount } = require('viem/accounts')
      return privateKeyToAccount(privateKey).address
    } catch { return '(could not derive)' }
  })()
  console.log(`[eigenmail] clientOptions: address=${address} apiUrl=${apiUrl} domain=${domain}`)
  return {
    privateKey,
    apiUrl,
    domain,
  }
}
