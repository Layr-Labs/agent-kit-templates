import type {
  Experimental_VideoModelV3 as VideoModelV3,
  Experimental_VideoModelV3CallOptions as VideoModelV3CallOptions,
  Experimental_VideoModelV3File as VideoModelV3File,
  Experimental_VideoModelV3VideoData as VideoModelV3VideoData,
  SharedV3ProviderMetadata,
  SharedV3Warning,
} from '@ai-sdk/provider';
import type { EigenGatewayProviderConfig } from './types.js';
import {
  resolveConfig,
  prepareHeaders,
  getSignal,
  redactHeaders,
  type ResolvedConfig,
} from './base-provider.js';

/**
 * Video Model implementation for Eigen Gateway.
 *
 * Uses the Vercel AI Gateway `/video-model` endpoint with SSE response protocol.
 */
export class EigenGatewayVideoModel implements VideoModelV3 {
  readonly specificationVersion = 'v3' as const;
  readonly modelId: string;
  readonly provider: string = 'eigen-gateway';
  readonly maxVideosPerCall: number | undefined = 1;

  private readonly config: ResolvedConfig;

  constructor(
    modelId: string,
    config: EigenGatewayProviderConfig
  ) {
    this.modelId = modelId;
    this.config = resolveConfig(config, 120000);
  }

  async doGenerate(
    options: VideoModelV3CallOptions
  ): Promise<{
    videos: Array<VideoModelV3VideoData>;
    warnings: Array<SharedV3Warning>;
    providerMetadata?: SharedV3ProviderMetadata;
    response: {
      timestamp: Date;
      modelId: string;
      headers: Record<string, string> | undefined;
    };
  }> {
    const endpoint = '/v3/ai/video-model';
    const url = `${this.config.baseURL}${endpoint}`;

    const body = this.prepareRequestBody(options);
    const headers = await prepareHeaders(this.config, endpoint, body, {
      ...options.headers,
      'ai-video-model-specification-version': '3',
      'ai-model-id': this.modelId,
      'accept': 'text/event-stream',
    });

    if (this.config.debug) {
      console.log('[Eigen Gateway] Video generation request:', {
        url,
        headers: redactHeaders(headers),
        body,
      });
    }

    const response = await this.config.fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: getSignal(this.config.timeout, options.abortSignal),
    });

    if (!response.ok) {
      const text = await response.text();
      let errorData: any;
      try {
        errorData = JSON.parse(text);
      } catch {
        errorData = { message: text };
      }
      throw new Error(
        `Video API error (${response.status}): ${errorData.error?.message ?? errorData.message ?? 'Unknown error'}`
      );
    }

    const event = await this.parseSSEResponse(response);

    if (event.type === 'error') {
      throw new Error(
        `Video API error (${event.statusCode}): ${event.message}`
      );
    }

    const responseHeaders = Object.fromEntries(response.headers.entries());

    return {
      videos: event.videos ?? [],
      warnings: event.warnings ?? [],
      providerMetadata: event.providerMetadata as SharedV3ProviderMetadata | undefined,
      response: {
        timestamp: new Date(),
        modelId: this.modelId,
        headers: responseHeaders,
      },
    };
  }

  private prepareRequestBody(options: VideoModelV3CallOptions): Record<string, unknown> {
    const body: Record<string, unknown> = {
      prompt: options.prompt,
      n: options.n,
    };

    if (options.aspectRatio != null) body.aspectRatio = options.aspectRatio;
    if (options.resolution != null) body.resolution = options.resolution;
    if (options.duration != null) body.duration = options.duration;
    if (options.fps != null) body.fps = options.fps;
    if (options.seed != null) body.seed = options.seed;
    if (options.providerOptions != null) body.providerOptions = options.providerOptions;
    if (options.image != null) body.image = this.encodeFileInput(options.image);

    return body;
  }

  private encodeFileInput(file: VideoModelV3File): VideoModelV3File {
    if (file.type === 'file' && file.data instanceof Uint8Array) {
      let binary = '';
      for (let i = 0; i < file.data.length; i++) {
        binary += String.fromCharCode(file.data[i]);
      }
      return {
        ...file,
        data: btoa(binary),
      };
    }
    return file;
  }

  private async parseSSEResponse(response: Response): Promise<any> {
    const text = await response.text();
    const lines = text.split('\n');

    for (const line of lines) {
      if (line.startsWith('data:')) {
        const data = line.slice(5).trim();
        if (data && data !== '[DONE]') {
          return JSON.parse(data);
        }
      }
    }

    throw new Error('Video API error: SSE stream ended without a data event');
  }
}
