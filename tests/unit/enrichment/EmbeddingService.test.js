/**
 * EmbeddingService Unit Tests
 * Tests OpenAI embedding generation functionality
 */

const EmbeddingService = require('../../../src/enrichment/EmbeddingService');

// Mock fetch globally
global.fetch = jest.fn();

// Mock logger to prevent console output during tests
jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
}));

describe('EmbeddingService', () => {
  let embeddingService;
  const mockApiKey = 'test-api-key';

  beforeEach(() => {
    jest.clearAllMocks();
    fetch.mockClear();
  });

  describe('Constructor', () => {
    it('should initialize with default configuration', () => {
      embeddingService = new EmbeddingService({ apiKey: mockApiKey });

      expect(embeddingService.config.provider).toBe('openai');
      expect(embeddingService.config.model).toBe('text-embedding-3-small');
      expect(embeddingService.config.maxRetries).toBe(3);
      expect(embeddingService.config.timeout).toBe(30000);
      expect(embeddingService.apiKey).toBe(mockApiKey);
    });

    it('should throw error when API key is missing', () => {
      expect(() => new EmbeddingService({})).toThrow('API key is required for embedding service');
    });

    it('should accept custom configuration', () => {
      embeddingService = new EmbeddingService({
        apiKey: mockApiKey,
        model: 'text-embedding-3-small',
        timeout: 60000,
        baseUrl: 'https://custom.openai.com/v1'
      });

      expect(embeddingService.config.model).toBe('text-embedding-3-small');
      expect(embeddingService.config.timeout).toBe(60000);
      expect(embeddingService.baseUrl).toBe('https://custom.openai.com/v1');
    });
  });

  describe('generateEmbedding', () => {
    beforeEach(() => {
      embeddingService = new EmbeddingService({ apiKey: mockApiKey });
    });

    it('should generate embedding for valid text', async () => {
      const mockEmbedding = new Array(1536).fill(0.1);
      const mockResponse = {
        data: [{ embedding: mockEmbedding }],
        usage: { total_tokens: 10 }
      };

      fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      });

      const result = await embeddingService.generateEmbedding('test text');

      expect(fetch).toHaveBeenCalledWith(
        'https://api.openai.com/v1/embeddings',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${mockApiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'text-embedding-3-small',
            input: 'test text',
            encoding_format: 'float'
          })
        })
      );

      expect(result).toEqual(mockEmbedding);
    });

    it('should handle text truncation for long inputs', async () => {
      const longText = 'a'.repeat(50000); // Very long text
      const mockEmbedding = new Array(1536).fill(0.1);
      const mockResponse = {
        data: [{ embedding: mockEmbedding }]
      };

      fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      });

      await embeddingService.generateEmbedding(longText);

      const callArgs = JSON.parse(fetch.mock.calls[0][1].body);
      expect(callArgs.input.length).toBeLessThan(longText.length);
      expect(callArgs.input.length).toBeLessThanOrEqual(8191 * 4); // Max tokens * 4 chars
    });

    it('should validate input text', async () => {
      await expect(embeddingService.generateEmbedding('')).rejects.toThrow('Text must be a non-empty string');
      await expect(embeddingService.generateEmbedding(null)).rejects.toThrow('Text must be a non-empty string');
      await expect(embeddingService.generateEmbedding(123)).rejects.toThrow('Text must be a non-empty string');
    });

    it('should handle API errors', async () => {
      fetch.mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({
          error: { message: 'Invalid API key' }
        })
      });

      await expect(embeddingService.generateEmbedding('test text')).rejects.toThrow('Invalid API key');
    });

    it('should handle network timeouts', async () => {
      embeddingService = new EmbeddingService({ 
        apiKey: mockApiKey,
        timeout: 100 // Very short timeout
      });

      // Mock fetch to simulate an AbortError
      fetch.mockImplementation(() => {
        const error = new Error('The operation was aborted');
        error.name = 'AbortError';
        return Promise.reject(error);
      });

      await expect(embeddingService.generateEmbedding('test text'))
        .rejects.toThrow('Embedding request timeout after 100ms');
    });

    it('should handle invalid response format', async () => {
      fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ invalid: 'response' })
      });

      await expect(embeddingService.generateEmbedding('test text'))
        .rejects.toThrow('Invalid embedding response format');
    });

    it('should work with different models', async () => {
      const mockEmbedding = new Array(3072).fill(0.1); // text-embedding-3-large dimensions
      const mockResponse = {
        data: [{ embedding: mockEmbedding }]
      };

      fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      });

      const result = await embeddingService.generateEmbedding('test text', {
        model: 'text-embedding-3-large'
      });

      const callArgs = JSON.parse(fetch.mock.calls[0][1].body);
      expect(callArgs.model).toBe('text-embedding-3-large');
      expect(result).toEqual(mockEmbedding);
    });

    it('should reject unsupported models', async () => {
      await expect(embeddingService.generateEmbedding('test text', {
        model: 'unsupported-model'
      })).rejects.toThrow('Unsupported embedding model: unsupported-model');
    });
  });

  describe('generateBatchEmbeddings', () => {
    beforeEach(() => {
      embeddingService = new EmbeddingService({ apiKey: mockApiKey });
    });

    it('should generate embeddings for multiple texts', async () => {
      const texts = ['text 1', 'text 2', 'text 3'];
      const mockEmbeddings = [
        new Array(1536).fill(0.1),
        new Array(1536).fill(0.2),
        new Array(1536).fill(0.3)
      ];
      const mockResponse = {
        data: mockEmbeddings.map(embedding => ({ embedding }))
      };

      fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      });

      const results = await embeddingService.generateBatchEmbeddings(texts);

      expect(fetch).toHaveBeenCalledTimes(1);
      const callArgs = JSON.parse(fetch.mock.calls[0][1].body);
      expect(callArgs.input).toEqual(texts);
      expect(results).toEqual(mockEmbeddings);
    });

    it('should handle batch processing for large arrays', async () => {
      const texts = Array.from({ length: 250 }, (_, i) => `text ${i}`);
      const mockEmbedding = new Array(1536).fill(0.1);
      const mockResponse = {
        data: Array.from({ length: 100 }, () => ({ embedding: mockEmbedding }))
      };

      fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      });

      await embeddingService.generateBatchEmbeddings(texts, { batchSize: 100 });

      expect(fetch).toHaveBeenCalledTimes(3); // 250 texts / 100 batch size = 3 batches
    });

    it('should validate input array', async () => {
      await expect(embeddingService.generateBatchEmbeddings([])).rejects.toThrow('Texts must be a non-empty array');
      await expect(embeddingService.generateBatchEmbeddings(null)).rejects.toThrow('Texts must be a non-empty array');
      await expect(embeddingService.generateBatchEmbeddings('not an array')).rejects.toThrow('Texts must be a non-empty array');
    });

    it('should handle batch API errors', async () => {
      const texts = ['text 1', 'text 2'];

      fetch.mockResolvedValue({
        ok: false,
        status: 429,
        json: () => Promise.resolve({
          error: { message: 'Rate limit exceeded' }
        })
      });

      await expect(embeddingService.generateBatchEmbeddings(texts))
        .rejects.toThrow('Rate limit exceeded');
    });
  });

  describe('Utility Methods', () => {
    beforeEach(() => {
      embeddingService = new EmbeddingService({ apiKey: mockApiKey });
    });

    it('should return correct embedding dimensions', () => {
      expect(embeddingService.getEmbeddingDimensions()).toBe(1536);
      expect(embeddingService.getEmbeddingDimensions('text-embedding-3-large')).toBe(3072);
      expect(embeddingService.getEmbeddingDimensions('text-embedding-3-small')).toBe(1536);
    });

    it('should throw error for unknown model dimensions', () => {
      expect(() => embeddingService.getEmbeddingDimensions('unknown-model'))
        .toThrow('Unknown model: unknown-model');
    });

    it('should calculate costs correctly', () => {
      const cost1k = embeddingService.calculateCost(1000);
      expect(cost1k).toBe(0.00002); // text-embedding-3-small cost

      const cost500 = embeddingService.calculateCost(500);
      expect(cost500).toBe(0.00001);

      const cost3Large = embeddingService.calculateCost(1000, 'text-embedding-3-large');
      expect(cost3Large).toBe(0.00013);
    });

    it('should throw error for unknown model costs', () => {
      expect(() => embeddingService.calculateCost(1000, 'unknown-model'))
        .toThrow('Unknown model: unknown-model');
    });

    it('should report readiness status', () => {
      expect(embeddingService.isReady()).toBe(true);

      const incompleteService = new EmbeddingService({ 
        apiKey: mockApiKey,
        model: 'unknown-model'
      });
      expect(incompleteService.isReady()).toBe(false);
    });

    it('should return service status', () => {
      const status = embeddingService.getStatus();

      expect(status).toEqual({
        provider: 'openai',
        model: 'text-embedding-3-small',
        dimensions: 1536,
        ready: true,
        supportedModels: [
          'text-embedding-ada-002',
          'text-embedding-3-small',
          'text-embedding-3-large'
        ]
      });
    });
  });

  describe('Request Handling', () => {
    beforeEach(() => {
      embeddingService = new EmbeddingService({ apiKey: mockApiKey });
    });

    it('should include proper headers in requests', async () => {
      const mockResponse = {
        data: [{ embedding: new Array(1536).fill(0.1) }]
      };

      fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      });

      await embeddingService.generateEmbedding('test text');

      expect(fetch).toHaveBeenCalledWith(
        'https://api.openai.com/v1/embeddings',
        expect.objectContaining({
          headers: {
            'Authorization': `Bearer ${mockApiKey}`,
            'Content-Type': 'application/json'
          }
        })
      );
    });

    it('should handle JSON parsing errors', async () => {
      fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.reject(new Error('Invalid JSON'))
      });

      await expect(embeddingService.generateEmbedding('test text'))
        .rejects.toThrow('Invalid JSON');
    });

    it('should handle network errors', async () => {
      fetch.mockRejectedValue(new Error('Network error'));

      await expect(embeddingService.generateEmbedding('test text'))
        .rejects.toThrow('Network error');
    });
  });
});
