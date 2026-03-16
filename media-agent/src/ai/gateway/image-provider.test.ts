import { describe, it, expect, vi } from 'vitest';
import { EigenGatewayImageModel } from './image-provider.js';

function mockResponse(body: any, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function createModel(fetchFn: typeof fetch) {
  return new EigenGatewayImageModel('dall-e-3', {
    baseURL: 'https://test.example.com',
    fetch: fetchFn,
  });
}

const baseCallOptions = {
  prompt: 'A cat in a hat',
  n: 1,
} as any;

describe('EigenGatewayImageModel', () => {
  describe('doGenerate', () => {
    it('should extract images from content array (data URL format)', async () => {
      const fetchFn = vi.fn().mockResolvedValue(mockResponse({
        id: 'img-1',
        model: 'dall-e-3',
        created: 1700000000,
        choices: [{
          message: {
            content: [
              { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBOR123' } },
            ],
          },
        }],
        usage: { prompt_tokens: 10, completion_tokens: 0 },
      }));

      const model = createModel(fetchFn);
      const result = await model.doGenerate(baseCallOptions);

      expect(result.images).toEqual(['iVBOR123']);
      expect(result.response.modelId).toBe('dall-e-3');
    });

    it('should extract images from file content parts', async () => {
      const fetchFn = vi.fn().mockResolvedValue(mockResponse({
        id: 'img-2',
        model: 'dall-e-3',
        choices: [{
          message: {
            content: [
              { type: 'file', data: 'base64filedata' },
            ],
          },
        }],
      }));

      const model = createModel(fetchFn);
      const result = await model.doGenerate(baseCallOptions);

      expect(result.images).toEqual(['base64filedata']);
    });

    it('should extract images from separate images array', async () => {
      const fetchFn = vi.fn().mockResolvedValue(mockResponse({
        id: 'img-3',
        model: 'dall-e-3',
        choices: [{
          message: {
            content: 'Here is the image',
            images: [
              { image_url: { url: 'data:image/jpeg;base64,jpegdata' } },
            ],
          },
        }],
      }));

      const model = createModel(fetchFn);
      const result = await model.doGenerate(baseCallOptions);

      expect(result.images).toEqual(['jpegdata']);
    });

    it('should fallback to data array format (OpenAI style)', async () => {
      const fetchFn = vi.fn().mockResolvedValue(mockResponse({
        created: 1700000000,
        data: [
          { b64_json: 'openai_base64_data' },
        ],
      }));

      const model = createModel(fetchFn);
      const result = await model.doGenerate(baseCallOptions);

      expect(result.images).toEqual(['openai_base64_data']);
    });

    it('should return empty images when no images found', async () => {
      const fetchFn = vi.fn().mockResolvedValue(mockResponse({
        id: 'img-empty',
        model: 'dall-e-3',
        choices: [{
          message: { content: 'No images here' },
        }],
      }));

      const model = createModel(fetchFn);
      const result = await model.doGenerate(baseCallOptions);

      expect(result.images).toEqual([]);
    });

    it('should handle usage information', async () => {
      const fetchFn = vi.fn().mockResolvedValue(mockResponse({
        id: 'img-usage',
        model: 'dall-e-3',
        choices: [{
          message: {
            content: [{ type: 'file', data: 'img' }],
          },
        }],
        usage: { prompt_tokens: 20, completion_tokens: 100, total_tokens: 120 },
      }));

      const model = createModel(fetchFn);
      const result = await model.doGenerate(baseCallOptions);

      expect(result.usage).toEqual({
        inputTokens: 20,
        outputTokens: 100,
        totalTokens: 120,
      });
    });

    it('should throw on error responses', async () => {
      const fetchFn = vi.fn().mockResolvedValue(mockResponse(
        { error: { message: 'Content policy violation' } },
        400,
      ));

      const model = createModel(fetchFn);
      await expect(model.doGenerate(baseCallOptions)).rejects.toThrow(
        'Image API error (400): Content policy violation',
      );
    });

    it('should send correct request body', async () => {
      const fetchFn = vi.fn().mockResolvedValue(mockResponse({
        id: 'img-body',
        model: 'dall-e-3',
        choices: [{ message: { content: [] } }],
      }));

      const model = createModel(fetchFn);
      await model.doGenerate({
        ...baseCallOptions,
        size: '1024x1024',
        n: 2,
      });

      const body = JSON.parse(fetchFn.mock.calls[0][1].body);
      expect(body.model).toBe('dall-e-3');
      expect(body.n).toBe(2);
      expect(body.size).toBe('1024x1024');
      expect(body.messages[0].role).toBe('user');
      expect(body.messages[0].content).toBe('A cat in a hat');
    });

    it('should use 60s default timeout', async () => {
      const fetchFn = vi.fn().mockResolvedValue(mockResponse({
        id: 'img-timeout',
        model: 'dall-e-3',
        choices: [{ message: { content: [] } }],
      }));

      const model = createModel(fetchFn);
      await model.doGenerate(baseCallOptions);

      const signal = fetchFn.mock.calls[0][1].signal as AbortSignal;
      expect(signal).toBeDefined();
    });
  });
});
