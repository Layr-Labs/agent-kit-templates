import type { AttestClientConfig } from '@layr-labs/ecloud-sdk/attest';

/**
 * Configuration options for the Eigen Gateway provider
 */
export interface EigenGatewayProviderConfig {
  /**
   * Base URL for the Eigen Gateway server
   * @example "https://ai-gateway-dev.eigencloud.xyz"
   */
  baseURL: string;

  /**
   * Optional JWT override. If not set, tokens are obtained automatically
   * via TEE attestation when `attestConfig` is provided.
   */
  jwt?: string;

  /**
   * Configuration for full TEE/VTPM attestation-based JWT auth.
   * When set, the provider will auto-fetch and refresh JWTs via the attestation flow.
   */
  attestConfig?: AttestClientConfig;

  /**
   * Additional headers to include in all requests
   */
  headers?: Record<string, string>;

  /**
   * Request timeout in milliseconds
   * @default 30000
   */
  timeout?: number;

  /**
   * Custom fetch implementation
   * Useful for testing or using alternative HTTP clients
   */
  fetch?: typeof fetch;

  /**
   * Enable debug logging
   * @default false
   */
  debug?: boolean;
}

/**
 * Options for individual model requests
 */
export interface ModelRequestOptions {
  /**
   * Override headers for this specific request
   */
  headers?: Record<string, string>;
}
