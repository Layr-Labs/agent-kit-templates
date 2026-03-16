import type { LanguageModelV3FinishReason } from '@ai-sdk/provider';
import type { EigenGatewayProviderConfig } from './types.js';
import { AttestClient, JwtProvider } from '@layr-labs/ecloud-sdk/attest';

const SENSITIVE_HEADERS = ['Authorization'];

export interface ResolvedConfig {
  baseURL: string;
  jwt?: string;
  jwtProvider?: JwtProvider;
  headers: Record<string, string>;
  timeout: number;
  fetch: typeof fetch;
  debug: boolean;
}

export function resolveConfig(
  config: EigenGatewayProviderConfig,
  defaultTimeout: number = 30000,
): ResolvedConfig {
  let jwtProvider: JwtProvider | undefined;

  if (config.attestConfig) {
    const attestClient = new AttestClient(config.attestConfig);
    jwtProvider = new JwtProvider(attestClient);
  }

  return {
    baseURL: config.baseURL,
    jwt: config.jwt,
    jwtProvider,
    headers: config.headers ?? {},
    timeout: config.timeout ?? defaultTimeout,
    fetch: config.fetch ?? fetch,
    debug: config.debug ?? false,
  };
}

export async function prepareHeaders(
  config: ResolvedConfig,
  endpoint: string,
  body: any,
  extraHeaders?: Record<string, string | undefined>,
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...config.headers,
  };

  if (extraHeaders) {
    for (const [key, value] of Object.entries(extraHeaders)) {
      if (value !== undefined) {
        headers[key] = value;
      }
    }
  }

  const jwt = config.jwt ?? await config.jwtProvider?.getToken();
  if (jwt) {
    headers['Authorization'] = `Bearer ${jwt}`;
  } else {
    console.log(`[Eigen Gateway] No JWT provided for endpoint ${endpoint}. Requests may fail if authentication is required.`);
  }

  return headers;
}

export function getSignal(timeout: number, abortSignal?: AbortSignal): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeout);
  if (abortSignal) {
    return AbortSignal.any([abortSignal, timeoutSignal]);
  }
  return timeoutSignal;
}

export async function handleApiError(response: Response, label: string): Promise<never> {
  const text = await response.text();
  let errorData: any;

  try {
    errorData = JSON.parse(text);
  } catch {
    errorData = { message: text };
  }

  throw new Error(
    `${label} error (${response.status}): ${errorData.error?.message ?? errorData.message ?? 'Unknown error'}`
  );
}

export function mapFinishReason(finishReason: string | null): LanguageModelV3FinishReason {
  let unified: 'stop' | 'length' | 'content-filter' | 'tool-calls' | 'error' | 'other';

  switch (finishReason) {
    case 'stop':
      unified = 'stop';
      break;
    case 'length':
      unified = 'length';
      break;
    case 'content_filter':
      unified = 'content-filter';
      break;
    case 'tool_calls':
    case 'function_call':
      unified = 'tool-calls';
      break;
    default:
      unified = 'other';
  }

  return {
    unified,
    raw: finishReason ?? undefined,
  };
}

export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const redacted = { ...headers };
  for (const key of SENSITIVE_HEADERS) {
    if (redacted[key]) {
      redacted[key] = '[REDACTED]';
    }
  }
  return redacted;
}
