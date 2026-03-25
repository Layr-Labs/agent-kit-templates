const DEFAULT_EIGENMAIL_API_URL = 'https://eigenmail-mainnet-alpha-api.eigenagents.org'

export function resolveEigenMailConfig(): {
  apiUrl: string
  domain: string
} {
  const rawApiUrl = process.env.EIGENMAIL_API_URL?.trim() || DEFAULT_EIGENMAIL_API_URL

  let parsed: URL
  try {
    parsed = new URL(rawApiUrl)
  } catch {
    throw new Error(`Invalid EIGENMAIL_API_URL: ${rawApiUrl}`)
  }

  return {
    apiUrl: rawApiUrl.replace(/\/+$/, ''),
    domain: parsed.host,
  }
}

export function getEigenMailClientOptions(privateKey: `0x${string}`): {
  privateKey: `0x${string}`
  apiUrl: string
  domain: string
} {
  const { apiUrl, domain } = resolveEigenMailConfig()
  return {
    privateKey,
    apiUrl,
    domain,
  }
}
