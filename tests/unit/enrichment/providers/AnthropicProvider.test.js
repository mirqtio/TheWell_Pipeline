/**
 * AnthropicProvider Unit Tests
 */

const AnthropicProvider = require('../../../../src/enrichment/providers/AnthropicProvider');

// Mock fetch globally
global.fetch = jest.fn();

describe('AnthropicProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should throw error without API key', () => {
      expect(() => new AnthropicProvider()).toThrow('Anthropic API key is required');
    });

    it('should initialize with API key', () => {
      const provider = new AnthropicProvider({ apiKey: 'test-key' });
      expect(provider.apiKey).toBe('test-key');
      expect(provider.getName()).toBe('anthropic');
    });

    it('should use default configuration', () => {
      const provider = new AnthropicProvider({ apiKey: 'test-key' });
      expect(provider.baseUrl).toBe('https://api.anthropic.com/v1');
      expect(provider.defaultModel).toBe('claude-3-sonnet-20240229');
      expect(provider.version).toBe('2023-06-01');
    });

    it('should use custom configuration', () => {
      const provider = new AnthropicProvider({
        apiKey: 'test-key',
        baseUrl: 'https://custom.api.com',
        model: 'claude-3-haiku-20240307',
        version: '2024-01-01'
      });
      expect(provider.baseUrl).toBe('https://custom.api.com');
      expect(provider.defaultModel).toBe('claude-3-haiku-20240307');
      expect(provider.version).toBe('2024-01-01');
    });
  });

  describe('getSupportedModels', () => {
    it('should return list of supported models', () => {
      const provider = new AnthropicProvider({ apiKey: 'test-key' });
      const models = provider.getSupportedModels();
      
      expect(models).toContain('claude-3-opus-20240229');
      expect(models).toContain('claude-3-sonnet-20240229');
      expect(models).toContain('claude-3-haiku-20240307');
      expect(models).toContain('claude-2.1');
      expect(models).toContain('claude-2.0');
    });
  });

  describe('calculateCost', () => {
    let provider;

    beforeEach(() => {
      provider = new AnthropicProvider({ apiKey: 'test-key' });
    });

    it('should calculate cost for claude-3-sonnet', () => {
      const cost = provider.calculateCost('claude-3-sonnet-20240229', 1000, 500);
      
      expect(cost.inputCost).toBe(0.003); // 1000 tokens * $0.003/1k
      expect(cost.outputCost).toBe(0.0075); // 500 tokens * $0.015/1k
      expect(cost.total).toBe(0.0105);
      expect(cost.currency).toBe('USD');
    });

    it('should calculate cost for claude-3-haiku', () => {
      const cost = provider.calculateCost('claude-3-haiku-20240307', 2000, 1000);
      
      expect(cost.inputCost).toBe(0.0005); // 2000 tokens * $0.00025/1k
      expect(cost.outputCost).toBe(0.00125); // 1000 tokens * $0.00125/1k
      expect(cost.total).toBe(0.00175);
    });

    it('should calculate cost for claude-3-opus', () => {
      const cost = provider.calculateCost('claude-3-opus-20240229', 1000, 500);
      
      expect(cost.inputCost).toBe(0.015); // 1000 tokens * $0.015/1k
      expect(cost.outputCost).toBe(0.0375); // 500 tokens * $0.075/1k
      expect(cost.total).toBe(0.0525);
    });

    it('should throw error for unsupported model', () => {
      expect(() => provider.calculateCost('unsupported-model', 100, 50))
        .toThrow('No pricing information for model: unsupported-model');
    });

    it('should handle fractional costs correctly', () => {
      const cost = provider.calculateCost('claude-3-sonnet-20240229', 123, 456);
      
      expect(cost.inputCost).toBe(0.000369);
      expect(cost.outputCost).toBe(0.00684);
      expect(cost.total).toBe(0.007209);
    });
  });

  describe('complete', () => {
    let provider;

    beforeEach(() => {
      provider = new AnthropicProvider({ apiKey: 'test-key' });
      fetch.mockClear();
    });

    it('should complete successfully with default model', async () => {
      const mockResponse = {
        content: [{ text: 'Test response' }],
        model: 'claude-3-sonnet-20240229',
        usage: {
          input_tokens: 10,
          output_tokens: 5
        },
        stop_reason: 'end_turn'
      };

      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      });

      const result = await provider.complete({
        prompt: 'Test prompt'
      });

      expect(result.content).toBe('Test response');
      expect(result.model).toBe('claude-3-sonnet-20240229');
      expect(result.usage.inputTokens).toBe(10);
      expect(result.usage.outputTokens).toBe(5);
      expect(result.usage.totalTokens).toBe(15);
      expect(result.cost.total).toBe(0.000105); // (10 * 0.003 + 5 * 0.015) / 1000
      expect(result.metadata.provider).toBe('anthropic');
      expect(result.metadata.finishReason).toBe('end_turn');
    });

    it('should complete with custom model and options', async () => {
      const mockResponse = {
        content: [{ text: 'Response' }],
        model: 'claude-3-haiku-20240307',
        usage: { input_tokens: 5, output_tokens: 3 },
        stop_reason: 'end_turn'
      };

      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      });

      const result = await provider.complete({
        model: 'claude-3-haiku-20240307',
        prompt: 'Test',
        options: {
          maxTokens: 100,
          temperature: 0.5,
          topP: 0.9,
          topK: 20
        }
      });

      expect(result.model).toBe('claude-3-haiku-20240307');
      
      // Verify request was made with correct parameters
      const [url, options] = fetch.mock.calls[0];
      const body = JSON.parse(options.body);
      
      expect(body.model).toBe('claude-3-haiku-20240307');
      expect(body.max_tokens).toBe(100);
      expect(body.temperature).toBe(0.5);
      expect(body.top_p).toBe(0.9);
      expect(body.top_k).toBe(20);
    });

    it('should throw error for unsupported model', async () => {
      await expect(provider.complete({
        model: 'unsupported-model',
        prompt: 'Test'
      })).rejects.toThrow('Unsupported model: unsupported-model');
    });

    it.skip('should handle timeout', async () => {
      const provider = new AnthropicProvider({ 
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
      // First call fails with network error, second succeeds
      fetch
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            content: [{ text: 'Success' }],
            model: 'claude-3-sonnet-20240229',
            usage: { input_tokens: 5, output_tokens: 3 },
            stop_reason: 'end_turn'
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
      error.type = 'authentication_error';
      
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
      provider = new AnthropicProvider({ apiKey: 'test-key' });
    });

    it('should make request with correct headers', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: 'test' })
      });

      await provider.makeRequest('/messages', { test: 'data' });

      const [url, options] = fetch.mock.calls[0];
      
      expect(url).toBe('https://api.anthropic.com/v1/messages');
      expect(options.method).toBe('POST');
      expect(options.headers['x-api-key']).toBe('test-key');
      expect(options.headers['anthropic-version']).toBe('2023-06-01');
      expect(options.headers['Content-Type']).toBe('application/json');
      expect(JSON.parse(options.body)).toEqual({ test: 'data' });
    });

    it('should handle HTTP errors', async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve({
          error: { message: 'Bad request', type: 'invalid_request_error' }
        })
      });

      await expect(provider.makeRequest('/messages', {}))
        .rejects.toThrow('Bad request');
    });

    it('should handle network errors', async () => {
      fetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(provider.makeRequest('/messages', {}))
        .rejects.toThrow('Network error');
    });
  });

  describe('isNonRetryableError', () => {
    let provider;

    beforeEach(() => {
      provider = new AnthropicProvider({ apiKey: 'test-key' });
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

    it('should identify non-retryable error types', () => {
      const invalidError = new Error('Invalid request');
      invalidError.type = 'invalid_request_error';
      
      const authError = new Error('Authentication failed');
      authError.type = 'authentication_error';
      
      const permError = new Error('Permission denied');
      permError.type = 'permission_error';

      expect(provider.isNonRetryableError(invalidError)).toBe(true);
      expect(provider.isNonRetryableError(authError)).toBe(true);
      expect(provider.isNonRetryableError(permError)).toBe(true);
    });

    it('should identify retryable errors', () => {
      const error500 = new Error('Server error');
      error500.status = 500;
      
      const error502 = new Error('Bad gateway');
      error502.status = 502;
      
      const errorNoStatus = new Error('Network error');
      
      const rateLimitError = new Error('Rate limited');
      rateLimitError.type = 'rate_limit_error';

      expect(provider.isNonRetryableError(error500)).toBe(false);
      expect(provider.isNonRetryableError(error502)).toBe(false);
      expect(provider.isNonRetryableError(errorNoStatus)).toBe(false);
      expect(provider.isNonRetryableError(rateLimitError)).toBe(false);
    });
  });
});
