import { describe, it, expect, vi } from 'vitest';
import { EigenGatewayLanguageModel } from './provider.js';

function mockResponse(body: any, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function mockStreamResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index]));
        index++;
      } else {
        controller.close();
      }
    },
  });

  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'text/event-stream' }),
    body,
    text: async () => chunks.join(''),
  } as unknown as Response;
}

function createModel(fetchFn: typeof fetch) {
  return new EigenGatewayLanguageModel('test-model', {
    baseURL: 'https://test.example.com',
    fetch: fetchFn,
  });
}

const baseCallOptions = {
  prompt: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'Hello' }] }],
  mode: { type: 'regular' as const },
} as any;

describe('EigenGatewayLanguageModel', () => {
  describe('doGenerate', () => {
    it('should return text content from a simple response', async () => {
      const fetchFn = vi.fn().mockResolvedValue(mockResponse({
        id: 'chatcmpl-1',
        model: 'test-model',
        created: 1700000000,
        choices: [{
          message: { content: 'Hello there!' },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }));

      const model = createModel(fetchFn);
      const result = await model.doGenerate(baseCallOptions);

      expect(result.content).toEqual([{ type: 'text', text: 'Hello there!' }]);
      expect(result.finishReason).toEqual({ unified: 'stop', raw: 'stop' });
      expect(result.usage.inputTokens.total).toBe(10);
      expect(result.usage.outputTokens.total).toBe(5);
      expect(result.response.id).toBe('chatcmpl-1');
      expect(result.response.modelId).toBe('test-model');
    });

    it('should handle tool call responses', async () => {
      const fetchFn = vi.fn().mockResolvedValue(mockResponse({
        id: 'chatcmpl-2',
        model: 'test-model',
        choices: [{
          message: {
            content: null,
            tool_calls: [{
              id: 'call_1',
              type: 'function',
              function: {
                name: 'getWeather',
                arguments: '{"location":"SF"}',
              },
            }],
          },
          finish_reason: 'tool_calls',
        }],
        usage: { prompt_tokens: 10, completion_tokens: 15 },
      }));

      const model = createModel(fetchFn);
      const result = await model.doGenerate(baseCallOptions);

      expect(result.content).toEqual([{
        type: 'tool-call',
        toolCallId: 'call_1',
        toolName: 'getWeather',
        input: '{"location":"SF"}',
      }]);
      expect(result.finishReason.unified).toBe('tool-calls');
    });

    it('should handle multimodal content array responses', async () => {
      const fetchFn = vi.fn().mockResolvedValue(mockResponse({
        id: 'chatcmpl-3',
        model: 'test-model',
        choices: [{
          message: {
            content: [
              { type: 'text', text: 'Here is the image:' },
              { type: 'image_url', image_url: { url: 'data:image/png;base64,abc123' } },
            ],
          },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }));

      const model = createModel(fetchFn);
      const result = await model.doGenerate(baseCallOptions);

      expect(result.content).toEqual([
        { type: 'text', text: 'Here is the image:' },
        { type: 'file', data: 'abc123', mediaType: 'image/png' },
      ]);
    });

    it('should handle images array (separate from content)', async () => {
      const fetchFn = vi.fn().mockResolvedValue(mockResponse({
        id: 'chatcmpl-4',
        model: 'test-model',
        choices: [{
          message: {
            content: 'A cat',
            images: [
              { image_url: { url: 'data:image/jpeg;base64,imgdata' } },
            ],
          },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }));

      const model = createModel(fetchFn);
      const result = await model.doGenerate(baseCallOptions);

      expect(result.content).toEqual([
        { type: 'text', text: 'A cat' },
        { type: 'file', data: 'imgdata', mediaType: 'image/jpeg' },
      ]);
    });

    it('should handle image URLs (non-data URLs)', async () => {
      const fetchFn = vi.fn().mockResolvedValue(mockResponse({
        id: 'chatcmpl-5',
        model: 'test-model',
        choices: [{
          message: {
            content: [
              { type: 'image_url', image_url: { url: 'https://example.com/img.png' } },
            ],
          },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 5, completion_tokens: 5 },
      }));

      const model = createModel(fetchFn);
      const result = await model.doGenerate(baseCallOptions);

      expect(result.content).toEqual([
        { type: 'file', data: 'https://example.com/img.png', mediaType: 'image/png' },
      ]);
    });

    it('should handle file content parts', async () => {
      const fetchFn = vi.fn().mockResolvedValue(mockResponse({
        id: 'chatcmpl-6',
        model: 'test-model',
        choices: [{
          message: {
            content: [
              { type: 'file', data: 'filedata', media_type: 'application/pdf' },
            ],
          },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 5, completion_tokens: 5 },
      }));

      const model = createModel(fetchFn);
      const result = await model.doGenerate(baseCallOptions);

      expect(result.content).toEqual([
        { type: 'file', data: 'filedata', mediaType: 'application/pdf' },
      ]);
    });

    it('should throw on error responses', async () => {
      const fetchFn = vi.fn().mockResolvedValue(mockResponse(
        { error: { message: 'Rate limited' } },
        429,
      ));

      const model = createModel(fetchFn);
      await expect(model.doGenerate(baseCallOptions)).rejects.toThrow(
        'Eigen Gateway API error (429): Rate limited',
      );
    });

    it('should throw on non-JSON error responses', async () => {
      const resp = {
        ok: false,
        status: 500,
        headers: new Headers(),
        text: async () => 'Internal Server Error',
      } as unknown as Response;
      const fetchFn = vi.fn().mockResolvedValue(resp);

      const model = createModel(fetchFn);
      await expect(model.doGenerate(baseCallOptions)).rejects.toThrow(
        'Eigen Gateway API error (500): Internal Server Error',
      );
    });

    it('should map all finish reasons correctly', async () => {
      const reasons: Array<[string, string]> = [
        ['stop', 'stop'],
        ['length', 'length'],
        ['content_filter', 'content-filter'],
        ['tool_calls', 'tool-calls'],
        ['function_call', 'tool-calls'],
        ['unknown_reason', 'other'],
      ];

      for (const [raw, expected] of reasons) {
        const fetchFn = vi.fn().mockResolvedValue(mockResponse({
          id: 'chatcmpl-fr',
          model: 'test-model',
          choices: [{ message: { content: 'hi' }, finish_reason: raw }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }));

        const model = createModel(fetchFn);
        const result = await model.doGenerate(baseCallOptions);
        expect(result.finishReason.unified).toBe(expected);
        expect(result.finishReason.raw).toBe(raw);
      }
    });

    it('should send correct request body with settings', async () => {
      const fetchFn = vi.fn().mockResolvedValue(mockResponse({
        id: 'chatcmpl-settings',
        model: 'test-model',
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }));

      const model = createModel(fetchFn);
      await model.doGenerate({
        ...baseCallOptions,
        maxOutputTokens: 100,
        temperature: 0.5,
        topP: 0.9,
        seed: 42,
      });

      const body = JSON.parse(fetchFn.mock.calls[0][1].body);
      expect(body.model).toBe('test-model');
      expect(body.max_tokens).toBe(100);
      expect(body.temperature).toBe(0.5);
      expect(body.top_p).toBe(0.9);
      expect(body.seed).toBe(42);
      expect(body.stream).toBe(false);
    });

    it('should send correct URL', async () => {
      const fetchFn = vi.fn().mockResolvedValue(mockResponse({
        id: 'chatcmpl-url',
        model: 'test-model',
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }));

      const model = createModel(fetchFn);
      await model.doGenerate(baseCallOptions);

      expect(fetchFn.mock.calls[0][0]).toBe('https://test.example.com/v1/chat/completions');
    });
  });

  describe('doStream', () => {
    it('should stream text content', async () => {
      const chunks = [
        'data: {"choices":[{"delta":{"content":"Hello"},"index":0}]}\n\n',
        'data: {"choices":[{"delta":{"content":" world"},"index":0}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"stop","index":0}],"usage":{"prompt_tokens":5,"completion_tokens":2}}\n\n',
        'data: [DONE]\n\n',
      ];

      const fetchFn = vi.fn().mockResolvedValue(mockStreamResponse(chunks));
      const model = createModel(fetchFn);
      const result = await model.doStream(baseCallOptions);

      const parts: any[] = [];
      const reader = result.stream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
      }

      expect(parts[0].type).toBe('text-start');
      expect(parts[1]).toEqual({ type: 'text-delta', id: parts[0].id, delta: 'Hello' });
      expect(parts[2]).toEqual({ type: 'text-delta', id: parts[0].id, delta: ' world' });
      expect(parts[3]).toEqual({ type: 'text-end', id: parts[0].id });
      expect(parts[4].type).toBe('finish');
      expect(parts[4].finishReason.unified).toBe('stop');
    });

    it('should stream tool calls', async () => {
      const chunks = [
        'data: {"choices":[{"delta":{"tool_calls":[{"id":"call_1","type":"function","function":{"name":"getWeather","arguments":""}}]},"index":0}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"function":{"arguments":"{\\"loc"}}]},"index":0}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"function":{"arguments":"ation\\":\\"SF\\"}"}}]},"index":0}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"tool_calls","index":0}],"usage":{"prompt_tokens":5,"completion_tokens":10}}\n\n',
        'data: [DONE]\n\n',
      ];

      const fetchFn = vi.fn().mockResolvedValue(mockStreamResponse(chunks));
      const model = createModel(fetchFn);
      const result = await model.doStream(baseCallOptions);

      const parts: any[] = [];
      const reader = result.stream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
      }

      expect(parts[0]).toEqual({ type: 'tool-input-start', id: 'call_1', toolName: 'getWeather' });
      expect(parts[1]).toEqual({ type: 'tool-input-delta', id: 'call_1', delta: '{"loc' });
      expect(parts[2]).toEqual({ type: 'tool-input-delta', id: 'call_1', delta: 'ation":"SF"}' });
      expect(parts[3]).toEqual({ type: 'tool-input-end', id: 'call_1' });
      expect(parts[4].type).toBe('finish');
      expect(parts[4].finishReason.unified).toBe('tool-calls');
    });

    it('should handle malformed SSE lines gracefully', async () => {
      const chunks = [
        'data: not-valid-json\n\n',
        'data: {"choices":[{"delta":{"content":"ok"},"index":0}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"stop","index":0}],"usage":{"prompt_tokens":1,"completion_tokens":1}}\n\n',
        'data: [DONE]\n\n',
      ];

      const fetchFn = vi.fn().mockResolvedValue(mockStreamResponse(chunks));
      const model = createModel(fetchFn);
      const result = await model.doStream(baseCallOptions);

      const parts: any[] = [];
      const reader = result.stream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
      }

      // Should still get text after the malformed line
      expect(parts.some(p => p.type === 'text-delta' && p.delta === 'ok')).toBe(true);
      expect(parts.some(p => p.type === 'finish')).toBe(true);
    });

    it('should throw on error responses', async () => {
      const resp = {
        ok: false,
        status: 503,
        headers: new Headers(),
        text: async () => '{"error":{"message":"Service unavailable"}}',
      } as unknown as Response;
      const fetchFn = vi.fn().mockResolvedValue(resp);

      const model = createModel(fetchFn);
      await expect(model.doStream(baseCallOptions)).rejects.toThrow(
        'Eigen Gateway API error (503): Service unavailable',
      );
    });

    it('should set stream=true in request body', async () => {
      const chunks = [
        'data: {"choices":[{"delta":{"content":"hi"},"index":0}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"stop","index":0}],"usage":{"prompt_tokens":1,"completion_tokens":1}}\n\n',
        'data: [DONE]\n\n',
      ];
      const fetchFn = vi.fn().mockResolvedValue(mockStreamResponse(chunks));
      const model = createModel(fetchFn);
      const result = await model.doStream(baseCallOptions);

      // Drain the stream
      const reader = result.stream.getReader();
      while (!(await reader.read()).done) {}

      const body = JSON.parse(fetchFn.mock.calls[0][1].body);
      expect(body.stream).toBe(true);
    });
  });
});
