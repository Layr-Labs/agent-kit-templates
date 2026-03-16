import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamResult,
  LanguageModelV3StreamPart,
  LanguageModelV3Content,
} from '@ai-sdk/provider';
import type { EigenGatewayProviderConfig, ModelRequestOptions } from './types.js';
import {
  resolveConfig,
  prepareHeaders,
  getSignal,
  handleApiError,
  mapFinishReason,
  redactHeaders,
  type ResolvedConfig,
} from './base-provider.js';

/**
 * Custom Language Model implementation for Eigen Gateway
 */
export class EigenGatewayLanguageModel implements LanguageModelV3 {
  readonly specificationVersion = 'v3' as const;
  readonly modelId: string;
  readonly provider: string = 'eigen-gateway';
  readonly supportedUrls: Record<string, RegExp[]> = {};

  private readonly config: ResolvedConfig;

  constructor(
    modelId: string,
    config: EigenGatewayProviderConfig
  ) {
    this.modelId = modelId;
    this.config = resolveConfig(config, 30000);
  }

  /**
   * Make a non-streaming request
   */
  async doGenerate(
    options: LanguageModelV3CallOptions
  ): Promise<LanguageModelV3GenerateResult> {
    const endpoint = '/v1/chat/completions';
    const url = `${this.config.baseURL}${endpoint}`;

    const body = this.prepareRequestBody(options, false);
    const headers = await prepareHeaders(this.config, endpoint, body);

    if (this.config.debug) {
      console.log('[Eigen Gateway] Request:', { url, headers: redactHeaders(headers), body });
    }

    const response = await this.config.fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: getSignal(this.config.timeout, options.abortSignal),
    });

    if (!response.ok) {
      await handleApiError(response, 'Eigen Gateway API');
    }

    const json = await response.json() as any;
    const choice = json.choices[0];

    // Build content array from response
    const content: Array<LanguageModelV3Content> = [];

    // Handle content - can be string or array of content parts
    if (choice.message?.content) {
      if (typeof choice.message.content === 'string') {
        // Simple text response
        content.push({
          type: 'text',
          text: choice.message.content,
        });
      } else if (Array.isArray(choice.message.content)) {
        // Content array (multimodal response with text/images/files)
        for (const part of choice.message.content) {
          if (part.type === 'text') {
            content.push({
              type: 'text',
              text: part.text,
            });
          } else if (part.type === 'image_url' || part.type === 'image') {
            // Handle image content
            const imageUrl = part.image_url?.url || part.url;
            if (imageUrl) {
              if (imageUrl.startsWith('data:')) {
                // Data URL - extract base64
                const match = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
                if (match) {
                  content.push({
                    type: 'file',
                    data: match[2], // base64 data
                    mediaType: match[1],
                  });
                }
              } else {
                // Regular URL
                content.push({
                  type: 'file',
                  data: imageUrl,
                  mediaType: part.media_type || 'image/png',
                });
              }
            }
          } else if (part.type === 'file') {
            // Generic file content
            content.push({
              type: 'file',
              data: part.data || part.url,
              mediaType: part.media_type || part.mediaType || 'application/octet-stream',
            });
          }
        }
      }
    }

    // Add tool calls if present
    if (choice.message?.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        content.push({
          type: 'tool-call',
          toolCallId: tc.id,
          toolName: tc.function.name,
          input: tc.function.arguments,
        });
      }
    }

    // Handle images array (some providers return images separately from content)
    if (choice.message?.images && Array.isArray(choice.message.images)) {
      for (const img of choice.message.images) {
        const imageUrl = img.image_url?.url || img.url;
        if (imageUrl) {
          if (imageUrl.startsWith('data:')) {
            // Data URL - extract base64
            const match = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
            if (match) {
              content.push({
                type: 'file',
                data: match[2], // base64 data
                mediaType: match[1],
              });
            }
          } else {
            // Regular URL
            content.push({
              type: 'file',
              data: imageUrl,
              mediaType: img.media_type || img.type || 'image/png',
            });
          }
        }
      }
    }

    return {
      content,
      finishReason: mapFinishReason(choice.finish_reason),
      usage: {
        inputTokens: {
          total: json.usage?.prompt_tokens ?? 0,
          noCache: undefined,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: {
          total: json.usage?.completion_tokens ?? 0,
          text: undefined,
          reasoning: undefined,
        },
      },
      request: {
        body,
      },
      response: {
        id: json.id,
        timestamp: json.created ? new Date(json.created * 1000) : undefined,
        modelId: json.model,
        headers: Object.fromEntries(response.headers.entries()),
        body: json,
      },
      warnings: [],
    };
  }

  /**
   * Make a streaming request
   */
  async doStream(
    options: LanguageModelV3CallOptions
  ): Promise<LanguageModelV3StreamResult> {
    const endpoint = '/v1/chat/completions';
    const url = `${this.config.baseURL}${endpoint}`;

    const body = this.prepareRequestBody(options, true);
    const headers = await prepareHeaders(this.config, endpoint, body);

    if (this.config.debug) {
      console.log('[Eigen Gateway] Streaming request:', { url, headers: redactHeaders(headers), body });
    }

    const response = await this.config.fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: getSignal(this.config.timeout, options.abortSignal),
    });

    if (!response.ok) {
      await handleApiError(response, 'Eigen Gateway API');
    }

    const stream = new ReadableStream<LanguageModelV3StreamPart>({
      async start(controller) {
        const reader = response.body?.getReader();
        if (!reader) {
          controller.close();
          return;
        }

        const decoder = new TextDecoder();
        let buffer = '';
        let textId: string | undefined;
        let toolCallId: string | undefined;

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || !trimmed.startsWith('data: ')) continue;

              const data = trimmed.slice(6);
              if (data === '[DONE]') continue;

              try {
                const json = JSON.parse(data);
                const choice = json.choices[0];

                if (!choice) continue;

                // Handle content delta
                if (choice.delta?.content) {
                  if (!textId) {
                    textId = `text-${Date.now()}-${Math.random()}`;
                    controller.enqueue({
                      type: 'text-start',
                      id: textId,
                    });
                  }
                  controller.enqueue({
                    type: 'text-delta',
                    id: textId,
                    delta: choice.delta.content,
                  });
                }

                // Handle tool calls
                if (choice.delta?.tool_calls) {
                  const toolCall = choice.delta.tool_calls[0];

                  const newToolCallId = toolCall.id;
                  const newToolName = toolCall.function?.name;

                  if (newToolCallId && newToolName) {
                    // Start of a new tool call
                    if (toolCallId) {
                      // End previous tool call
                      controller.enqueue({
                        type: 'tool-input-end',
                        id: toolCallId,
                      });
                    }
                    toolCallId = newToolCallId;
                    controller.enqueue({
                      type: 'tool-input-start',
                      id: newToolCallId,
                      toolName: newToolName,
                    });
                  }

                  if (toolCall.function?.arguments && toolCallId) {
                    controller.enqueue({
                      type: 'tool-input-delta',
                      id: toolCallId,
                      delta: toolCall.function.arguments,
                    });
                  }
                }

                // Handle finish
                if (choice.finish_reason) {
                  // End any pending text or tool call
                  if (textId) {
                    controller.enqueue({
                      type: 'text-end',
                      id: textId,
                    });
                    textId = undefined;
                  }

                  if (toolCallId) {
                    controller.enqueue({
                      type: 'tool-input-end',
                      id: toolCallId,
                    });
                    toolCallId = undefined;
                  }

                  controller.enqueue({
                    type: 'finish',
                    finishReason: mapFinishReason(choice.finish_reason),
                    usage: {
                      inputTokens: {
                        total: json.usage?.prompt_tokens ?? 0,
                        noCache: undefined,
                        cacheRead: undefined,
                        cacheWrite: undefined,
                      },
                      outputTokens: {
                        total: json.usage?.completion_tokens ?? 0,
                        text: undefined,
                        reasoning: undefined,
                      },
                    },
                  });
                }
              } catch (error) {
                console.error('[Eigen Gateway] Failed to parse stream part:', error);
              }
            }
          }
        } finally {
          reader.releaseLock();
          controller.close();
        }
      },
    });

    return {
      stream,
      request: {
        body,
      },
    };
  }

  /**
   * Prepare the request body for OpenAI-compatible API
   */
  private prepareRequestBody(
    options: LanguageModelV3CallOptions,
    stream: boolean
  ): any {
    const { prompt, ...settings } = options;

    // Convert prompt to messages format
    const messages: any[] = [];
    for (const p of prompt as any[]) {
      if (p.role === 'system') {
        messages.push({ role: 'system', content: this.convertContentParts(p.content) });
      } else if (p.role === 'user') {
        messages.push({ role: 'user', content: this.convertContentParts(p.content) });
      } else if (p.role === 'assistant') {
        // Separate tool-call parts from content parts
        const contentParts: any[] = [];
        const toolCalls: any[] = [];
        if (Array.isArray(p.content)) {
          for (const part of p.content) {
            if (part.type === 'tool-call') {
              toolCalls.push({
                id: part.toolCallId,
                type: 'function',
                function: {
                  name: part.toolName,
                  arguments: JSON.stringify(part.input),
                },
              });
            } else {
              contentParts.push(part);
            }
          }
        }
        const msg: any = { role: 'assistant' };
        if (contentParts.length > 0) {
          msg.content = this.convertContentParts(contentParts);
        } else {
          msg.content = null;
        }
        if (toolCalls.length > 0) {
          msg.tool_calls = toolCalls;
        }
        messages.push(msg);
      } else if (p.role === 'tool') {
        // Each tool-result part becomes a separate tool message
        if (Array.isArray(p.content)) {
          for (const part of p.content) {
            if (part.type === 'tool-result') {
              let content: string;
              if (part.output.type === 'text') {
                content = part.output.value;
              } else if (part.output.type === 'json') {
                content = JSON.stringify(part.output.value);
              } else {
                content = JSON.stringify(part.output);
              }
              messages.push({
                role: 'tool',
                tool_call_id: part.toolCallId,
                content,
              });
            }
          }
        }
      } else {
        messages.push(p);
      }
    }

    const body: any = {
      model: this.modelId,
      messages,
      stream,
    };

    // Add settings
    if (settings.maxOutputTokens != null) body.max_tokens = settings.maxOutputTokens;
    if (settings.temperature != null) body.temperature = settings.temperature;
    if (settings.topP != null) body.top_p = settings.topP;
    if (settings.frequencyPenalty != null) body.frequency_penalty = settings.frequencyPenalty;
    if (settings.presencePenalty != null) body.presence_penalty = settings.presencePenalty;
    if (settings.seed != null) body.seed = settings.seed;

    // Handle tools
    if (settings.tools && settings.tools.length > 0) {
      body.tools = settings.tools.map((tool: any) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
        },
      }));

      // Handle tool choice
      if (settings.toolChoice) {
        if (settings.toolChoice.type === 'auto') {
          body.tool_choice = 'auto';
        } else if (settings.toolChoice.type === 'none') {
          body.tool_choice = 'none';
        } else if (settings.toolChoice.type === 'required') {
          body.tool_choice = 'required';
        } else if (settings.toolChoice.type === 'tool') {
          body.tool_choice = {
            type: 'function',
            function: { name: settings.toolChoice.toolName },
          };
        }
      }
    }

    return body;
  }

  /**
   * Convert V3 content parts to OpenAI format
   */
  private convertContentParts(content: any): any {
    if (typeof content === 'string') {
      return content;
    }

    if (Array.isArray(content)) {
      // Convert content parts array
      return content.map((part: any) => {
        if (part.type === 'text') {
          return { type: 'text', text: part.text };
        }
        if (part.type === 'file') {
          // Handle file/image content
          if (typeof part.data === 'string') {
            // Base64 or URL
            if (part.data.startsWith('http://') || part.data.startsWith('https://')) {
              return {
                type: part.mediaType.startsWith('image/') ? 'image_url' : 'file',
                [part.mediaType.startsWith('image/') ? 'image_url' : 'file_url']: { url: part.data },
              };
            } else {
              return {
                type: part.mediaType.startsWith('image/') ? 'image_url' : 'file',
                [part.mediaType.startsWith('image/') ? 'image_url' : 'file_url']: {
                  url: `data:${part.mediaType};base64,${part.data}`,
                },
              };
            }
          }
        }
        return part;
      });
    }

    return content;
  }
}
