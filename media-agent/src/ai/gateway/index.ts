import { EigenGatewayLanguageModel } from './provider.js';
import { EigenGatewayImageModel } from './image-provider.js';
import { EigenGatewayVideoModel } from './video-provider.js';
import type { EigenGatewayProviderConfig, ModelRequestOptions } from './types.js';

/**
 * Create an Eigen Gateway provider function
 *
 * @param config - Configuration for the Eigen Gateway
 * @returns A function that creates language models
 *
 * @example
 * ```typescript
 * import { createEigenGateway } from '@eigencloud/eigen-gateway-provider';
 * import { generateText } from 'ai';
 *
 * const eigenGateway = createEigenGateway({
 *   baseURL: 'https://ai-gateway-dev.eigencloud.xyz',
 * });
 *
 * const result = await generateText({
 *   model: eigenGateway('anthropic/claude-sonnet-4.6'),
 *   prompt: 'Hello, world!',
 * });
 * ```
 */
export function createEigenGateway(config: EigenGatewayProviderConfig) {
  /**
   * Create a language model instance
   *
   * @param modelId - The model identifier (e.g., 'anthropic/claude-sonnet-4.6', 'claude-3-opus')
   * @param options - Optional request options
   * @returns Language model instance compatible with Vercel AI SDK
   */
  return function (modelId: string, options?: ModelRequestOptions) {
    return new EigenGatewayLanguageModel(modelId, {
      ...config,
      headers: {
        ...config.headers,
        ...options?.headers,
      },
    });
  };
}

// Lazy-initialized default instance
let _eigenInstance: ReturnType<typeof createEigenGateway> | null = null;

function getEigenInstance(): ReturnType<typeof createEigenGateway> {
  if (!_eigenInstance) {
    _eigenInstance = createEigenGateway(getDefaultConfig());
  }
  return _eigenInstance;
}

/**
 * Create an Eigen Gateway image provider function
 *
 * @param config - Configuration for the Eigen Gateway
 * @returns A function that creates image models
 */
export function createEigenGatewayImage(config: EigenGatewayProviderConfig) {
  return function (modelId: string, options?: ModelRequestOptions) {
    return new EigenGatewayImageModel(modelId, {
      ...config,
      headers: {
        ...config.headers,
        ...options?.headers,
      },
    });
  };
}

/**
 * Create an Eigen Gateway video provider function
 *
 * @param config - Configuration for the Eigen Gateway
 * @returns A function that creates video models
 */
export function createEigenGatewayVideo(config: EigenGatewayProviderConfig) {
  return function (modelId: string, options?: ModelRequestOptions) {
    return new EigenGatewayVideoModel(modelId, {
      ...config,
      headers: {
        ...config.headers,
        ...options?.headers,
      },
    });
  };
}

// Lazy-initialized default instances
let _eigenImageInstance: ReturnType<typeof createEigenGatewayImage> | null = null;
let _eigenVideoInstance: ReturnType<typeof createEigenGatewayVideo> | null = null;

function getDefaultConfig(): EigenGatewayProviderConfig {
  const baseURL = process.env.EIGEN_GATEWAY_URL || 'https://ai-gateway-dev.eigencloud.xyz';
  const jwt = process.env.KMS_AUTH_JWT;
  const debug = process.env.DEBUG === 'true';

  const kmsServerURL = process.env.KMS_SERVER_URL;
  const kmsPublicKey = process.env.KMS_PUBLIC_KEY;

  const attestConfig = kmsServerURL && kmsPublicKey ? { kmsServerURL, kmsPublicKey, audience: 'llm-proxy' } : undefined;

  return { baseURL, jwt, debug, attestConfig };
}

function getEigenImageInstance(): ReturnType<typeof createEigenGatewayImage> {
  if (!_eigenImageInstance) {
    _eigenImageInstance = createEigenGatewayImage(getDefaultConfig());
  }
  return _eigenImageInstance;
}

function getEigenVideoInstance(): ReturnType<typeof createEigenGatewayVideo> {
  if (!_eigenVideoInstance) {
    _eigenVideoInstance = createEigenGatewayVideo(getDefaultConfig());
  }
  return _eigenVideoInstance;
}

/**
 * Pre-configured Eigen Gateway instance (auto-configured from environment)
 *
 * This instance is automatically configured from environment variables:
 * - EIGEN_GATEWAY_URL: The base URL for the gateway (default: https://ai-gateway-dev.eigencloud.xyz)
 * - KMS_SERVER_URL / KMS_PUBLIC_KEY: TEE attestation-based JWT auth (set automatically in TEE)
 * - KMS_AUTH_JWT: Optional JWT override (bypasses attestation)
 * - DEBUG: Enable debug logging (optional, set to 'true')
 *
 * @example
 * ```typescript
 * import { eigen } from '@eigencloud/eigen-gateway-provider';
 * import { generateText, generateImage } from 'ai';
 *
 * // Language model
 * const result = await generateText({
 *   model: eigen('anthropic/claude-sonnet-4.6'),
 *   prompt: 'Hello, world!',
 * });
 *
 * // Image model
 * const image = await generateImage({
 *   model: eigen.image('dall-e-3'),
 *   prompt: 'A cat in a hat',
 * });
 * ```
 */
const eigenFn = (modelId: string, options?: ModelRequestOptions) => {
  return getEigenInstance()(modelId, options);
};
eigenFn.image = (modelId: string, options?: ModelRequestOptions) => {
  return getEigenImageInstance()(modelId, options);
};
eigenFn.video = (modelId: string, options?: ModelRequestOptions) => {
  return getEigenVideoInstance()(modelId, options);
};
export const eigen = eigenFn;

/**
 * Create a standalone Eigen Gateway provider instance
 *
 * This is useful when you want to reuse the same configuration for multiple models.
 *
 * @example
 * ```typescript
 * const provider = new EigenGatewayProvider({
 *   baseURL: 'https://ai-gateway-dev.eigencloud.xyz',
 * });
 *
 * const claude = provider.model('anthropic/claude-sonnet-4.6');
 * ```
 */
export class EigenGatewayProvider {
  private config: EigenGatewayProviderConfig;

  constructor(config: EigenGatewayProviderConfig) {
    this.config = config;
  }

  /**
   * Create a language model instance
   */
  model(modelId: string, options?: ModelRequestOptions) {
    return new EigenGatewayLanguageModel(modelId, {
      ...this.config,
      headers: {
        ...this.config.headers,
        ...options?.headers,
      },
    });
  }

  /**
   * Convenience method for chat models (alias for model)
   */
  chat(modelId: string, options?: ModelRequestOptions) {
    return this.model(modelId, options);
  }

  /**
   * Create an image model instance
   */
  image(modelId: string, options?: ModelRequestOptions) {
    return new EigenGatewayImageModel(modelId, {
      ...this.config,
      headers: {
        ...this.config.headers,
        ...options?.headers,
      },
    });
  }

  /**
   * Create a video model instance
   */
  video(modelId: string, options?: ModelRequestOptions) {
    return new EigenGatewayVideoModel(modelId, {
      ...this.config,
      headers: {
        ...this.config.headers,
        ...options?.headers,
      },
    });
  }

  /**
   * Update the configuration
   */
  updateConfig(config: Partial<EigenGatewayProviderConfig>) {
    this.config = { ...this.config, ...config };
  }
}

// Re-export types and utilities
export type {
  EigenGatewayProviderConfig,
  ModelRequestOptions,
} from './types.js';

export { EigenGatewayLanguageModel } from './provider.js';
export { EigenGatewayImageModel } from './image-provider.js';
export { EigenGatewayVideoModel } from './video-provider.js';
