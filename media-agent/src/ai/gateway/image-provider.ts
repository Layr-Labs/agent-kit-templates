import type {
  ImageModelV3,
  ImageModelV3CallOptions,
  ImageModelV3File,
  ImageModelV3Usage,
  SharedV3Warning,
} from '@ai-sdk/provider';
import type { EigenGatewayProviderConfig } from './types.js';
import {
  resolveConfig,
  prepareHeaders,
  getSignal,
  handleApiError,
  redactHeaders,
  type ResolvedConfig,
} from './base-provider.js';

/**
 * Custom Image Model implementation for Eigen Gateway
 */
export class EigenGatewayImageModel implements ImageModelV3 {
  readonly specificationVersion = 'v3' as const;
  readonly modelId: string;
  readonly provider: string = 'eigen-gateway';
  readonly maxImagesPerCall: number | undefined = undefined;

  private readonly config: ResolvedConfig;

  constructor(
    modelId: string,
    config: EigenGatewayProviderConfig
  ) {
    this.modelId = modelId;
    this.config = resolveConfig(config, 60000);
  }

  async doGenerate(
    options: ImageModelV3CallOptions
  ): Promise<{
    images: Array<string>;
    warnings: Array<SharedV3Warning>;
    providerMetadata?: Record<string, any>;
    response: {
      timestamp: Date;
      modelId: string;
      headers: Record<string, string> | undefined;
    };
    usage?: ImageModelV3Usage;
  }> {
    const endpoint = '/v1/chat/completions';
    const url = `${this.config.baseURL}${endpoint}`;

    const body = this.prepareRequestBody(options);
    const headers = await prepareHeaders(this.config, endpoint, body, options.headers);

    if (this.config.debug) {
      console.log('[Eigen Gateway] Image generation request:', { url, headers: redactHeaders(headers), body });
    }

    const response = await this.config.fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: getSignal(this.config.timeout, options.abortSignal),
    });

    if (!response.ok) {
      await handleApiError(response, 'Image API');
    }

    const json = await response.json() as any;

    const images: string[] = [];
    const warnings: Array<SharedV3Warning> = [];

    // Parse images from chat completions response format
    const choice = json.choices?.[0];
    if (choice?.message?.content) {
      if (Array.isArray(choice.message.content)) {
        for (const part of choice.message.content) {
          // Inline image data
          if (part.type === 'image_url' || part.type === 'image') {
            const url = part.image_url?.url || part.url;
            if (url) {
              const match = url.match(/^data:[^;]+;base64,(.+)$/);
              if (match) {
                images.push(match[1]);
              }
            }
          }
          // Some providers return base64 directly in a file-like part
          if (part.type === 'file' && part.data) {
            images.push(part.data);
          }
        }
      }
    }

    // Also check for images in a separate images array (some providers)
    if (choice?.message?.images && Array.isArray(choice.message.images)) {
      for (const img of choice.message.images) {
        const url = img.image_url?.url || img.url;
        if (url) {
          const match = url.match(/^data:[^;]+;base64,(.+)$/);
          if (match) {
            images.push(match[1]);
          }
        }
      }
    }

    // Fallback: check for data array format (OpenAI images/generations style)
    if (images.length === 0 && json.data && Array.isArray(json.data)) {
      for (const item of json.data) {
        if (item.b64_json) {
          images.push(item.b64_json);
        }
      }
    }

    const usage: ImageModelV3Usage | undefined = json.usage
      ? {
          inputTokens: json.usage.prompt_tokens ?? undefined,
          outputTokens: json.usage.completion_tokens ?? undefined,
          totalTokens: json.usage.total_tokens ?? undefined,
        }
      : undefined;

    return {
      images,
      warnings,
      response: {
        timestamp: json.created ? new Date(json.created * 1000) : new Date(),
        modelId: json.model || this.modelId,
        headers: Object.fromEntries(response.headers.entries()),
      },
      usage,
    };
  }

  private prepareRequestBody(options: ImageModelV3CallOptions): any {
    // Build user message content
    const userContent: any[] = [];

    if (options.prompt) {
      userContent.push({ type: 'text', text: options.prompt });
    }

    // Input images for editing operations
    if (options.files && options.files.length > 0) {
      for (const file of options.files) {
        const dataUrl = this.convertFileToDataUrl(file);
        if (dataUrl) {
          userContent.push({ type: 'image_url', image_url: { url: dataUrl } });
        }
      }
    }

    // Mask for inpainting
    if (options.mask) {
      const maskUrl = this.convertFileToDataUrl(options.mask);
      if (maskUrl) {
        userContent.push({ type: 'image_url', image_url: { url: maskUrl } });
      }
    }

    const body: any = {
      model: this.modelId,
      messages: [
        {
          role: 'user',
          content: userContent.length === 1 && userContent[0].type === 'text'
            ? userContent[0].text
            : userContent,
        },
      ],
      n: options.n,
    };

    if (options.size) body.size = options.size;
    if (options.aspectRatio) body.aspect_ratio = options.aspectRatio;
    if (options.seed != null) body.seed = options.seed;

    // Provider-specific options
    const eigenOptions = options.providerOptions?.['eigen-gateway'];
    if (eigenOptions) {
      Object.assign(body, eigenOptions);
    }

    return body;
  }

  private convertFileToDataUrl(file: ImageModelV3File): string | undefined {
    if (file.type === 'url') {
      return file.url;
    }
    if (file.type === 'file') {
      const mediaType = file.mediaType || 'image/png';
      if (typeof file.data === 'string') {
        return `data:${mediaType};base64,${file.data}`;
      }
      if (file.data instanceof Uint8Array) {
        let binary = '';
        for (let i = 0; i < file.data.length; i++) {
          binary += String.fromCharCode(file.data[i]);
        }
        return `data:${mediaType};base64,${btoa(binary)}`;
      }
    }
    return undefined;
  }
}
