import { describe, it, expect, vi } from 'vitest';
import { EigenGatewayVideoModel } from './video-provider.js';

function sseResponse(event: object, status = 200): Response {
  const body = `data: ${JSON.stringify(event)}\n\n`;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'text/event-stream' }),
    text: async () => body,
  } as unknown as Response;
}

function errorResponse(body: any, status = 400): Response {
  return {
    ok: false,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function createModel(fetchFn: typeof fetch) {
  return new EigenGatewayVideoModel('google/veo-3', {
    baseURL: 'https://test.example.com',
    fetch: fetchFn,
  });
}

const baseCallOptions = {
  prompt: 'A cat walking across a room',
  n: 1,
  aspectRatio: undefined,
  resolution: undefined,
  duration: undefined,
  fps: undefined,
  seed: undefined,
  image: undefined,
  providerOptions: {},
} as any;

describe('EigenGatewayVideoModel', () => {
  describe('doGenerate', () => {
    it('should parse SSE result event with video URLs', async () => {
      const fetchFn = vi.fn().mockResolvedValue(sseResponse({
        type: 'result',
        videos: [
          { type: 'url', url: 'https://cdn.example.com/video.mp4', mediaType: 'video/mp4' },
        ],
        warnings: [],
      }));

      const model = createModel(fetchFn);
      const result = await model.doGenerate(baseCallOptions);

      expect(result.videos).toEqual([
        { type: 'url', url: 'https://cdn.example.com/video.mp4', mediaType: 'video/mp4' },
      ]);
      expect(result.warnings).toEqual([]);
      expect(result.response.modelId).toBe('google/veo-3');
    });

    it('should parse SSE result event with base64 video data', async () => {
      const fetchFn = vi.fn().mockResolvedValue(sseResponse({
        type: 'result',
        videos: [
          { type: 'base64', data: 'dmlkZW9kYXRh', mediaType: 'video/mp4' },
        ],
      }));

      const model = createModel(fetchFn);
      const result = await model.doGenerate(baseCallOptions);

      expect(result.videos).toEqual([
        { type: 'base64', data: 'dmlkZW9kYXRh', mediaType: 'video/mp4' },
      ]);
    });

    it('should throw on SSE error event', async () => {
      const fetchFn = vi.fn().mockResolvedValue(sseResponse({
        type: 'error',
        message: 'Model not available',
        statusCode: 503,
        errorType: 'service_unavailable',
      }));

      const model = createModel(fetchFn);
      await expect(model.doGenerate(baseCallOptions)).rejects.toThrow(
        'Video API error (503): Model not available',
      );
    });

    it('should throw on empty SSE stream', async () => {
      const fetchFn = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/event-stream' }),
        text: async () => '\n',
      } as unknown as Response);

      const model = createModel(fetchFn);
      await expect(model.doGenerate(baseCallOptions)).rejects.toThrow(
        'SSE stream ended without a data event',
      );
    });

    it('should throw on HTTP error responses', async () => {
      const fetchFn = vi.fn().mockResolvedValue(errorResponse(
        { error: { message: 'Unauthorized' } },
        401,
      ));

      const model = createModel(fetchFn);
      await expect(model.doGenerate(baseCallOptions)).rejects.toThrow(
        'Video API error (401): Unauthorized',
      );
    });

    it('should send correct request body with video-specific fields', async () => {
      const fetchFn = vi.fn().mockResolvedValue(sseResponse({
        type: 'result',
        videos: [],
      }));

      const model = createModel(fetchFn);
      await model.doGenerate({
        ...baseCallOptions,
        aspectRatio: '16:9',
        resolution: '1280x720',
        duration: 5,
        fps: 24,
        seed: 42,
      });

      const body = JSON.parse(fetchFn.mock.calls[0][1].body);
      expect(body.prompt).toBe('A cat walking across a room');
      expect(body.n).toBe(1);
      expect(body.aspectRatio).toBe('16:9');
      expect(body.resolution).toBe('1280x720');
      expect(body.duration).toBe(5);
      expect(body.fps).toBe(24);
      expect(body.seed).toBe(42);
    });

    it('should omit undefined optional fields from request body', async () => {
      const fetchFn = vi.fn().mockResolvedValue(sseResponse({
        type: 'result',
        videos: [],
      }));

      const model = createModel(fetchFn);
      await model.doGenerate({
        prompt: 'A cat walking across a room',
        n: 1,
        aspectRatio: undefined,
        resolution: undefined,
        duration: undefined,
        fps: undefined,
        seed: undefined,
        image: undefined,
        providerOptions: undefined,
      } as any);

      const body = JSON.parse(fetchFn.mock.calls[0][1].body);
      expect(body).toEqual({ prompt: 'A cat walking across a room', n: 1 });
    });

    it('should send correct headers', async () => {
      const fetchFn = vi.fn().mockResolvedValue(sseResponse({
        type: 'result',
        videos: [],
      }));

      const model = createModel(fetchFn);
      await model.doGenerate(baseCallOptions);

      const headers = fetchFn.mock.calls[0][1].headers;
      expect(headers['ai-video-model-specification-version']).toBe('3');
      expect(headers['ai-model-id']).toBe('google/veo-3');
      expect(headers['accept']).toBe('text/event-stream');
      expect(headers['Content-Type']).toBe('application/json');
    });

    it('should POST to /video-model endpoint', async () => {
      const fetchFn = vi.fn().mockResolvedValue(sseResponse({
        type: 'result',
        videos: [],
      }));

      const model = createModel(fetchFn);
      await model.doGenerate(baseCallOptions);

      expect(fetchFn.mock.calls[0][0]).toBe('https://test.example.com/v3/ai/video-model');
    });

    it('should use 120s default timeout', async () => {
      const fetchFn = vi.fn().mockResolvedValue(sseResponse({
        type: 'result',
        videos: [],
      }));

      const model = createModel(fetchFn);
      await model.doGenerate(baseCallOptions);

      const signal = fetchFn.mock.calls[0][1].signal as AbortSignal;
      expect(signal).toBeDefined();
    });

    it('should encode Uint8Array image input to base64', async () => {
      const fetchFn = vi.fn().mockResolvedValue(sseResponse({
        type: 'result',
        videos: [],
      }));

      const model = createModel(fetchFn);
      const imageData = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
      await model.doGenerate({
        ...baseCallOptions,
        image: { type: 'file', mediaType: 'image/png', data: imageData },
      });

      const body = JSON.parse(fetchFn.mock.calls[0][1].body);
      expect(body.image.type).toBe('file');
      expect(body.image.data).toBe(btoa('Hello'));
      expect(body.image.mediaType).toBe('image/png');
    });

    it('should pass URL image input as-is', async () => {
      const fetchFn = vi.fn().mockResolvedValue(sseResponse({
        type: 'result',
        videos: [],
      }));

      const model = createModel(fetchFn);
      await model.doGenerate({
        ...baseCallOptions,
        image: { type: 'url', url: 'https://example.com/image.png' },
      });

      const body = JSON.parse(fetchFn.mock.calls[0][1].body);
      expect(body.image).toEqual({ type: 'url', url: 'https://example.com/image.png' });
    });

    it('should pass through provider metadata', async () => {
      const fetchFn = vi.fn().mockResolvedValue(sseResponse({
        type: 'result',
        videos: [{ type: 'url', url: 'https://cdn.example.com/v.mp4', mediaType: 'video/mp4' }],
        providerMetadata: {
          'eigen-gateway': {
            videos: [{ duration: 5.0, fps: 24, width: 1280, height: 720 }],
          },
        },
      }));

      const model = createModel(fetchFn);
      const result = await model.doGenerate(baseCallOptions);

      expect(result.providerMetadata).toEqual({
        'eigen-gateway': {
          videos: [{ duration: 5.0, fps: 24, width: 1280, height: 720 }],
        },
      });
    });

    it('should return empty videos array when result has no videos', async () => {
      const fetchFn = vi.fn().mockResolvedValue(sseResponse({
        type: 'result',
      }));

      const model = createModel(fetchFn);
      const result = await model.doGenerate(baseCallOptions);

      expect(result.videos).toEqual([]);
    });
  });
});
