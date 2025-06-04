/**
 * OpenAIProvider Unit Tests
 */

const OpenAIProvider = require('../../../../src/enrichment/providers/OpenAIProvider');

// Mock fetch globally
global.fetch = jest.fn();

describe('OpenAIProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should throw error without API key', () => {
      expect(() => new OpenAIProvider()).toThrow('OpenAI API key is required');
    });

    it('should initialize with API key', () => {
      const provider = new OpenAIProvider({ apiKey: 'test-key' });
      expect(provider.apiKey).toBe('test-key');
      expect(provider.getName()).toBe('openai');
    });

    it('should use default configuration', () => {
      const provider = new OpenAIProvider({ apiKey: 'test-key' });
      expect(provider.baseUrl).toBe('https://api.openai.com/v1');
      expect(provider.defaultModel).toBe('gpt-4-turbo');
    });

    it('should use custom configuration', () => {
      const provider = new OpenAIProvider({
        apiKey: 'test-key',
        baseUrl: 'https://custom.api.com',
        model: 'gpt-3.5-turbo'
      });
      expect(provider.baseUrl).toBe('https://custom.api.com');
      expect(provider.defaultModel).toBe('gpt-3.5-turbo');
    });
  });

  describe('getSupportedModels', () => {
    it('should return list of supported models', () => {
      const provider = new OpenAIProvider({ apiKey: 'test-key' });
      const models = provider.getSupportedModels();
      
      expect(models).toContain('gpt-4-turbo');
      expect(models).toContain('gpt-4');
      expect(models).toContain('gpt-3.5-turbo');
      expect(models).toContain('gpt-3.5-turbo-16k');
    });
  });

  describe('calculateCost', () => {
    let provider;

    beforeEach(() => {
      provider = new OpenAIProvider({ apiKey: 'test-key' });
    });

    it('should calculate cost for gpt-4-turbo', () => {
      const cost = provider.calculateCost('gpt-4-turbo', 1000, 500);
      
      expect(cost.inputCost).toBe(0.01); // 1000 tokens * $0.01/1k
      expect(cost.outputCost).toBe(0.015); // 500 tokens * $0.03/1k
      expect(cost.total).toBe(0.025);
      expect(cost.currency).toBe('USD');
    });

    it('should calculate cost for gpt-3.5-turbo', () => {
      const cost = provider.calculateCost('gpt-3.5-turbo', 2000, 1000);
      
      expect(cost.inputCost).toBe(0.003); // 2000 tokens * $0.0015/1k
      expect(cost.outputCost).toBe(0.002); // 1000 tokens * $0.002/1k
      expect(cost.total).toBe(0.005);
    });

    it('should throw error for unsupported model', () => {
      expect(() => provider.calculateCost('unsupported-model', 100, 50))
        .toThrow('No pricing information for model: unsupported-model');
    });

    it('should handle fractional costs correctly', () => {
      const cost = provider.calculateCost('gpt-4-turbo', 123, 456);
      
      expect(cost.inputCost).toBe(0.00123);
      expect(cost.outputCost).toBe(0.01368);
      expect(cost.total).toBe(0.01491);
    });
  });

  describe('complete', () => {
    let provider;

    beforeEach(() => {
      provider = new OpenAIProvider({ apiKey: 'test-key' });
      fetch.mockClear();
    });

    it('should complete successfully with default model', async () => {
      const mockResponse = {
        choices: [{
          message: { content: 'Test response' },
          finish_reason: 'stop'
        }],
        model: 'gpt-4-turbo',
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15
        }
      };

      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      });

      const result = await provider.complete({
        prompt: 'Test prompt'
      });

      expect(result.content).toBe('Test response');
      expect(result.model).toBe('gpt-4-turbo');
      expect(result.usage.inputTokens).toBe(10);
      expect(result.usage.outputTokens).toBe(5);
      expect(result.usage.totalTokens).toBe(15);
      expect(result.cost.total).toBe(0.00025); // (10 * 0.01 + 5 * 0.03) / 1000
      expect(result.metadata.provider).toBe('openai');
      expect(result.metadata.finishReason).toBe('stop');
    });

    it('should complete with custom model and options', async () => {
      const mockResponse = {
        choices: [{ message: { content: 'Response' }, finish_reason: 'stop' }],
        model: 'gpt-3.5-turbo',
        usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 }
      };

      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      });

      const result = await provider.complete({
        model: 'gpt-3.5-turbo',
        prompt: 'Test',
        options: {
          maxTokens: 100,
          temperature: 0.5,
          topP: 0.9
        }
      });

      expect(result.model).toBe('gpt-3.5-turbo');
      
      // Verify request was made with correct parameters
      const [url, options] = fetch.mock.calls[0];
      const body = JSON.parse(options.body);
      
      expect(body.model).toBe('gpt-3.5-turbo');
      expect(body.max_tokens).toBe(100);
      expect(body.temperature).toBe(0.5);
      expect(body.top_p).toBe(0.9);
    });

    it('should throw error for unsupported model', async () => {
      await expect(provider.complete({
        model: 'unsupported-model',
        prompt: 'Test'
      })).rejects.toThrow('Unsupported model: unsupported-model');
    });

    it.skip('should handle timeout', async () => {
      const provider = new OpenAIProvider({ 
        apiKey: 'test-key',
        timeout: 100 
      });

      // Mock fetch to throw AbortError
      fetch.mockImplementationOnce(() => {
        const abortError = new Error('The operation was aborted.');
        abortError.name = 'AbortError';
        return Promise.reject(abortError);
      });

      await expect(provider.complete({ prompt: 'Test' }))
        .rejects.toThrow('Request timeout after 100ms');
    });

    it('should retry on retryable errors', async () => {
      // First call fails with 500, second succeeds
      fetch
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            choices: [{ message: { content: 'Success' }, finish_reason: 'stop' }],
            model: 'gpt-4-turbo',
            usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 }
          })
        });

      const result = await provider.complete({ prompt: 'Test' });
      
      expect(result.content).toBe('Success');
      expect(result.metadata.attempt).toBe(2);
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('should not retry on non-retryable errors', async () => {
      const error = new Error('Invalid API key');
      error.status = 401;
      
      fetch.mockRejectedValueOnce(error);

      await expect(provider.complete({ prompt: 'Test' }))
        .rejects.toThrow('Invalid API key');
      
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('should fail after max retries', async () => {
      const error = new Error('Server error');
      error.status = 500;
      
      fetch.mockRejectedValue(error);

      await expect(provider.complete({ prompt: 'Test' }))
        .rejects.toThrow('Server error');
      
      expect(fetch).toHaveBeenCalledTimes(3); // maxRetries = 3
    });

    it('should increment request and error counters', async () => {
      fetch.mockRejectedValue(new Error('Test error'));

      await expect(provider.complete({ prompt: 'Test' }))
        .rejects.toThrow();
      
      expect(provider.requestCount).toBe(1);
      expect(provider.errorCount).toBe(3); // 3 attempts
    });
  });

  describe('makeRequest', () => {
    let provider;

    beforeEach(() => {
      provider = new OpenAIProvider({ apiKey: 'test-key' });
    });

    it('should make request with correct headers', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: 'test' })
      });

      await provider.makeRequest('/test', { test: 'data' });

      const [url, options] = fetch.mock.calls[0];
      
      expect(url).toBe('https://api.openai.com/v1/test');
      expect(options.method).toBe('POST');
      expect(options.headers['Authorization']).toBe('Bearer test-key');
      expect(options.headers['Content-Type']).toBe('application/json');
      expect(JSON.parse(options.body)).toEqual({ test: 'data' });
    });

    it('should handle HTTP errors', async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve({
          error: { message: 'Bad request', code: 'invalid_request' }
        })
      });

      await expect(provider.makeRequest('/test', {}))
        .rejects.toThrow('Bad request');
    });

    it('should handle network errors', async () => {
      fetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(provider.makeRequest('/test', {}))
        .rejects.toThrow('Network error');
    });
  });

  describe('isNonRetryableError', () => {
    let provider;

    beforeEach(() => {
      provider = new OpenAIProvider({ apiKey: 'test-key' });
    });

    it('should identify non-retryable status codes', () => {
      const error400 = new Error('Bad request');
      error400.status = 400;
      
      const error401 = new Error('Unauthorized');
      error401.status = 401;
      
      const error403 = new Error('Forbidden');
      error403.status = 403;
      
      const error404 = new Error('Not found');
      error404.status = 404;

      expect(provider.isNonRetryableError(error400)).toBe(true);
      expect(provider.isNonRetryableError(error401)).toBe(true);
      expect(provider.isNonRetryableError(error403)).toBe(true);
      expect(provider.isNonRetryableError(error404)).toBe(true);
    });

    it('should identify retryable status codes', () => {
      const error500 = new Error('Server error');
      error500.status = 500;
      
      const error502 = new Error('Bad gateway');
      error502.status = 502;
      
      const errorNoStatus = new Error('Network error');

      expect(provider.isNonRetryableError(error500)).toBe(false);
      expect(provider.isNonRetryableError(error502)).toBe(false);
      expect(provider.isNonRetryableError(errorNoStatus)).toBe(false);
    });
  });
});
