import { describe, it, expect } from 'vitest';
import {
  createEigenGateway,
  createEigenGatewayImage,
  EigenGatewayProvider,
  EigenGatewayLanguageModel,
  EigenGatewayImageModel,
} from './index.js';

describe('createEigenGateway', () => {
  it('should return a function that creates language models', () => {
    const gateway = createEigenGateway({
      baseURL: 'https://test.example.com',
    });

    const model = gateway('test-model');
    expect(model).toBeInstanceOf(EigenGatewayLanguageModel);
    expect(model.modelId).toBe('test-model');
    expect(model.provider).toBe('eigen-gateway');
  });

  it('should pass through model ID correctly', () => {
    const gateway = createEigenGateway({
      baseURL: 'https://test.example.com',
    });

    const model1 = gateway('anthropic/claude-sonnet-4.6');
    const model2 = gateway('openai/gpt-4o');

    expect(model1.modelId).toBe('anthropic/claude-sonnet-4.6');
    expect(model2.modelId).toBe('openai/gpt-4o');
  });
});

describe('createEigenGatewayImage', () => {
  it('should return a function that creates image models', () => {
    const gateway = createEigenGatewayImage({
      baseURL: 'https://test.example.com',
    });

    const model = gateway('dall-e-3');
    expect(model).toBeInstanceOf(EigenGatewayImageModel);
    expect(model.modelId).toBe('dall-e-3');
    expect(model.provider).toBe('eigen-gateway');
  });
});

describe('EigenGatewayProvider', () => {
  it('should create language models via model()', () => {
    const provider = new EigenGatewayProvider({
      baseURL: 'https://test.example.com',
    });

    const model = provider.model('test-model');
    expect(model).toBeInstanceOf(EigenGatewayLanguageModel);
    expect(model.modelId).toBe('test-model');
  });

  it('should create language models via chat() (alias)', () => {
    const provider = new EigenGatewayProvider({
      baseURL: 'https://test.example.com',
    });

    const model = provider.chat('test-model');
    expect(model).toBeInstanceOf(EigenGatewayLanguageModel);
    expect(model.modelId).toBe('test-model');
  });

  it('should create image models via image()', () => {
    const provider = new EigenGatewayProvider({
      baseURL: 'https://test.example.com',
    });

    const model = provider.image('dall-e-3');
    expect(model).toBeInstanceOf(EigenGatewayImageModel);
    expect(model.modelId).toBe('dall-e-3');
  });
});
