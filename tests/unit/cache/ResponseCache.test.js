const CacheManager = require('../../../src/cache/CacheManager');
const ResponseCache = require('../../../src/cache/ResponseCache');

// Mock logger
jest.mock('../../../src/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

describe('ResponseCache', () => {
  let responseCache;

  beforeEach(() => {
    jest.clearAllMocks();
    
    responseCache = new ResponseCache({
      ttl: {
        enrichment: 3600,
        summary: 7200,
        translation: 1800,
        classification: 3600,
        extraction: 3600,
        generation: 1800
      }
    });

    // Mock the inherited CacheManager methods
    responseCache.initialize = jest.fn().mockResolvedValue();
    responseCache.shutdown = jest.fn().mockResolvedValue();
    responseCache.get = jest.fn();
    responseCache.set = jest.fn();
    responseCache.delete = jest.fn();
    responseCache.clear = jest.fn();
    responseCache.generateKey = jest.fn((prefix, key) => `${prefix}:${key}`);
    responseCache.getStats = jest.fn().mockResolvedValue({
      hits: 0,
      misses: 0,
      hitRate: 0,
      size: 0
    });
  });

  afterEach(async () => {
    if (responseCache) {
      await responseCache.shutdown();
    }
  });

  describe('Initialization', () => {
    test('should initialize with default TTL configuration', () => {
      const cache = new ResponseCache();
      expect(cache.config.ttl.enrichment).toBe(3600);
      expect(cache.config.ttl.summary).toBe(7200);
      expect(cache.config.ttl.translation).toBe(1800);
      expect(cache.config.ttl.classification).toBe(3600);
      expect(cache.config.ttl.extraction).toBe(3600);
      expect(cache.config.ttl.generation).toBe(1800);
    });

    test('should initialize with custom TTL configuration', () => {
      const cache = new ResponseCache({
        ttl: {
          enrichment: 7200,
          summary: 14400
        }
      });
      expect(cache.config.ttl.enrichment).toBe(7200);
      expect(cache.config.ttl.summary).toBe(14400);
    });

    test('should initialize response statistics', () => {
      expect(responseCache.responseStats).toEqual({
        totalResponses: 0,
        cachedResponses: 0,
        cacheHitRate: 0,
        tokensSaved: 0,
        costSaved: 0,
        responseTypes: {}
      });
    });
  });

  describe('Response Caching', () => {
    beforeEach(() => {
      responseCache.generateKey = jest.fn((...parts) => parts.join(':'));
    });

    test('should cache enrichment response', async () => {
      const prompt = 'Analyze this document';
      const model = 'gpt-4';
      const parameters = { temperature: 0.7 };
      const response = {
        content: 'Document analysis result',
        usage: { total_tokens: 150 },
        model: 'gpt-4'
      };
      
      responseCache.set = jest.fn().mockResolvedValue();
      
      const key = await responseCache.cacheResponse(
        prompt,
        model,
        parameters,
        response,
        { responseType: 'enrichment' }
      );
      
      expect(key).toBeDefined();
      expect(responseCache.set).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          prompt,
          model,
          parameters,
          response,
          metadata: expect.objectContaining({
            cachedAt: expect.any(String),
            responseType: 'enrichment',
            estimatedTokens: expect.any(Object)
          })
        }),
        expect.objectContaining({ ttl: 3600 })
      );
    });

    test('should get cached response', async () => {
      const prompt = 'Summarize this text';
      const model = 'gpt-3.5-turbo';
      const parameters = { max_tokens: 100 };
      const cachedData = {
        responseType: 'summary',
        prompt,
        model,
        parameters,
        response: {
          content: 'Summary result',
          usage: { total_tokens: 75 }
        },
        metadata: {
          cachedAt: new Date().toISOString(),
          estimatedTokens: { total: 75 },
          estimatedCost: 0.0015
        }
      };
      
      responseCache.get = jest.fn().mockResolvedValue(cachedData);
      
      const result = await responseCache.getCachedResponse(
        prompt,
        model,
        parameters
      );
      
      expect(result).toEqual({
        response: cachedData.response,
        metadata: cachedData.metadata,
        fromCache: true
      });
      expect(responseCache.responseStats.cachedResponses).toBe(1);
      expect(responseCache.responseStats.tokensSaved).toBe(75);
    });

    test('should return null for cache miss', async () => {
      responseCache.get = jest.fn().mockResolvedValue(null);
      
      const result = await responseCache.getCachedResponse(
        'prompt',
        'model',
        {}
      );
      
      expect(result).toBeNull();
      expect(responseCache.responseStats.totalResponses).toBe(1);
    });

    test('should update response statistics on cache hit', async () => {
      const cachedData = {
        response: { content: 'test', usage: { total_tokens: 100 } },
        metadata: {
          cachedAt: new Date().toISOString(),
          estimatedTokens: { total: 100 },
          estimatedCost: 0.002
        }
      };
      
      responseCache.get = jest.fn().mockResolvedValue(cachedData);
      
      await responseCache.getCachedResponse('prompt', 'model', {});
      
      expect(responseCache.responseStats.cachedResponses).toBe(1);
      expect(responseCache.responseStats.totalResponses).toBe(1);
      expect(responseCache.responseStats.cacheHitRate).toBe(1);
      expect(responseCache.responseStats.tokensSaved).toBe(100);
      expect(responseCache.responseStats.costSaved).toBeCloseTo(0.002);
    });
  });

  describe('Response Type Specific Caching', () => {
    beforeEach(() => {
      responseCache.generateKey = jest.fn((...parts) => parts.join(':'));
      responseCache.set = jest.fn().mockResolvedValue();
    });

    test('should cache enrichment response with correct TTL', async () => {
      await responseCache.cacheEnrichmentResponse(
        'prompt',
        'gpt-4',
        {},
        { content: 'result' }
      );
      
      expect(responseCache.set).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({ ttl: 3600 })
      );
    });

    test('should cache summary response with correct TTL', async () => {
      await responseCache.cacheSummaryResponse(
        'prompt',
        'gpt-3.5-turbo',
        {},
        { content: 'summary' }
      );
      
      expect(responseCache.set).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({ ttl: 7200 })
      );
    });

    test('should cache translation response with correct TTL', async () => {
      await responseCache.cacheTranslationResponse(
        'prompt',
        'gpt-4',
        { target_language: 'es' },
        { content: 'traducción' }
      );
      
      expect(responseCache.set).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({ ttl: 1800 })
      );
    });

    test('should cache classification response with correct TTL', async () => {
      await responseCache.cacheClassificationResponse(
        'prompt',
        'gpt-3.5-turbo',
        {},
        { content: 'category: technology' }
      );
      
      expect(responseCache.set).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({ ttl: 3600 })
      );
    });

    test('should cache extraction response with correct TTL', async () => {
      await responseCache.cacheExtractionResponse(
        'prompt',
        'gpt-4',
        {},
        { content: 'extracted data' }
      );
      
      expect(responseCache.set).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({ ttl: 3600 })
      );
    });

    test('should cache generation response with correct TTL', async () => {
      await responseCache.cacheGenerationResponse(
        'prompt',
        'gpt-4',
        {},
        { content: 'generated content' }
      );
      
      expect(responseCache.set).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({ ttl: 1800 })
      );
    });
  });

  describe('Key Generation', () => {
    test('should generate consistent keys for same inputs', () => {
      const prompt = 'test prompt';
      const model = 'gpt-4';
      const parameters = { temperature: 0.7 };
      
      const key1 = responseCache.generateResponseKey('enrichment', prompt, model, parameters);
      const key2 = responseCache.generateResponseKey('enrichment', prompt, model, parameters);
      
      expect(key1).toBe(key2);
    });

    test('should generate different keys for different response types', () => {
      const prompt = 'test prompt';
      const model = 'gpt-4';
      const parameters = {};
      
      const key1 = responseCache.generateResponseKey('enrichment', prompt, model, parameters);
      const key2 = responseCache.generateResponseKey('summary', prompt, model, parameters);
      
      expect(key1).not.toBe(key2);
    });

    test('should generate different keys for different parameters', () => {
      const prompt = 'test prompt';
      const model = 'gpt-4';
      
      const key1 = responseCache.generateResponseKey('enrichment', prompt, model, { temperature: 0.7 });
      const key2 = responseCache.generateResponseKey('enrichment', prompt, model, { temperature: 0.9 });
      
      expect(key1).not.toBe(key2);
    });

    test('should handle parameters with different order', () => {
      const prompt = 'test prompt';
      const model = 'gpt-4';
      
      const key1 = responseCache.generateResponseKey('enrichment', prompt, model, { a: 1, b: 2 });
      const key2 = responseCache.generateResponseKey('enrichment', prompt, model, { b: 2, a: 1 });
      
      expect(key1).toBe(key2);
    });
  });

  describe('Cache Invalidation', () => {
    test('should invalidate responses by model', async () => {
      responseCache.clear = jest.fn().mockResolvedValue(5);
      
      const count = await responseCache.invalidateResponsesByModel('gpt-4');
      
      expect(count).toBe(5);
      expect(responseCache.clear).toHaveBeenCalledWith(
        expect.stringContaining('gpt-4')
      );
    });

    test('should invalidate responses by type', async () => {
      responseCache.clear = jest.fn().mockResolvedValue(3);
      
      const count = await responseCache.invalidateResponsesByType('enrichment');
      
      expect(count).toBe(3);
      expect(responseCache.clear).toHaveBeenCalledWith(
        expect.stringContaining('enrichment')
      );
    });

    test('should invalidate document enrichment responses', async () => {
      responseCache.clear = jest.fn().mockResolvedValue(2);
      
      const count = await responseCache.invalidateDocumentEnrichments('doc123');
      
      expect(count).toBe(2);
      expect(responseCache.clear).toHaveBeenCalledWith(
        expect.stringContaining('doc123')
      );
    });

    test('should invalidate all responses', async () => {
      responseCache.clear = jest.fn().mockResolvedValue(10);
      
      const count = await responseCache.invalidateAllResponses();
      
      expect(count).toBe(10);
      expect(responseCache.clear).toHaveBeenCalledWith('response:*');
    });
  });

  describe('Cache Warming', () => {
    test('should warm response cache', async () => {
      const responses = [
        {
          responseType: 'enrichment',
          prompt: 'prompt1',
          model: 'gpt-4',
          parameters: {},
          response: { content: 'result1' }
        },
        {
          responseType: 'summary',
          prompt: 'prompt2',
          model: 'gpt-3.5-turbo',
          parameters: {},
          response: { content: 'result2' }
        }
      ];
      
      responseCache.get = jest.fn().mockResolvedValue(null); // Not cached
      
      const results = await responseCache.warmResponseCache(responses);
      
      expect(results).toHaveLength(2);
      expect(results[0].status).toBe('needs_generation');
      expect(results[1].status).toBe('needs_generation');
    });

    test('should identify already cached responses', async () => {
      const responses = [
        {
          responseType: 'enrichment',
          prompt: 'prompt1',
          model: 'gpt-4',
          parameters: {},
          response: { content: 'result1' }
        }
      ];
      
      responseCache.get = jest.fn().mockResolvedValue({
        response: { content: 'cached result' },
        metadata: { cachedAt: new Date().toISOString() }
      });
      
      const results = await responseCache.warmResponseCache(responses);
      
      expect(results[0].status).toBe('already_cached');
    });

    test('should preload common responses', async () => {
      const commonResponses = [
        {
          responseType: 'classification',
          prompt: 'Classify this document',
          model: 'gpt-3.5-turbo',
          parameters: {},
          response: { content: 'Technology' }
        }
      ];
      
      responseCache.set = jest.fn().mockResolvedValue();
      
      const results = await responseCache.preloadCommonResponses(commonResponses);
      
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('preloaded');
      expect(responseCache.set).toHaveBeenCalled();
    });
  });

  describe('Statistics and Metrics', () => {
    test('should get response-specific statistics', async () => {
      responseCache.getStats = jest.fn().mockResolvedValue({
        hits: 20,
        misses: 10,
        hitRate: 0.67,
        size: 100
      });
      
      // Set some response stats
      responseCache.responseStats.totalResponses = 30;
      responseCache.responseStats.cachedResponses = 20;
      responseCache.responseStats.cacheHitRate = 0.67;
      responseCache.responseStats.tokensSaved = 5000;
      responseCache.responseStats.costSaved = 10.5;
      responseCache.responseStats.responseTypes = {
        enrichment: 15,
        summary: 10,
        translation: 5
      };
      
      const stats = await responseCache.getResponseStats();
      
      expect(stats.responses).toEqual(responseCache.responseStats);
      expect(stats.hits).toBe(20);
      expect(stats.misses).toBe(10);
    });

    test('should calculate cost savings', async () => {
      responseCache.responseStats.tokensSaved = 10000;
      responseCache.responseStats.costSaved = 25.75;
      
      const savings = await responseCache.calculateCostSavings();
      
      expect(savings.tokensSaved).toBe(10000);
      expect(savings.estimatedCostSavings).toBe(25.75);
      expect(savings.averageCostPerToken).toBeCloseTo(0.002575);
    });

    test('should get response type breakdown', async () => {
      responseCache.responseStats.responseTypes = {
        enrichment: 50,
        summary: 30,
        translation: 20,
        classification: 15,
        extraction: 10,
        generation: 5
      };
      responseCache.responseStats.totalResponses = 130;
      
      const breakdown = await responseCache.getResponseTypeBreakdown();
      
      expect(breakdown.enrichment.count).toBe(50);
      expect(breakdown.enrichment.percentage).toBeCloseTo(38.46);
      expect(breakdown.summary.count).toBe(30);
      expect(breakdown.summary.percentage).toBeCloseTo(23.08);
    });
  });

  describe('Cost Estimation', () => {
    test('should estimate cost for GPT-4', () => {
      const cost = responseCache.estimateResponseCost('gpt-4', 1000);
      expect(cost).toBeCloseTo(0.06); // $0.06 per 1K tokens
    });

    test('should estimate cost for GPT-3.5-turbo', () => {
      const cost = responseCache.estimateResponseCost('gpt-3.5-turbo', 1000);
      expect(cost).toBeCloseTo(0.002); // $0.002 per 1K tokens
    });

    test('should use default cost for unknown models', () => {
      const cost = responseCache.estimateResponseCost('unknown-model', 1000);
      expect(cost).toBeCloseTo(0.002); // Default cost
    });

    test('should handle zero tokens', () => {
      const cost = responseCache.estimateResponseCost('gpt-4', 0);
      expect(cost).toBe(0);
    });
  });

  describe('Error Handling', () => {
    test('should handle cache set errors gracefully', async () => {
      responseCache.set = jest.fn().mockRejectedValue(new Error('Cache error'));
      
      const key = await responseCache.cacheResponse(
        'prompt',
        'model',
        {},
        { content: 'response' },
        { responseType: 'enrichment' }
      );
      
      expect(key).toBeNull();
    });

    test('should handle cache get errors gracefully', async () => {
      responseCache.get = jest.fn().mockRejectedValue(new Error('Cache error'));
      
      const result = await responseCache.getCachedResponse(
        'prompt',
        'model',
        {}
      );
      
      expect(result).toBeNull();
    });

    test('should handle invalidation errors gracefully', async () => {
      responseCache.clear = jest.fn().mockRejectedValue(new Error('Clear error'));
      
      const count = await responseCache.invalidateResponsesByModel('gpt-4');
      
      expect(count).toBe(0);
    });

    test('should handle warming errors gracefully', async () => {
      const responses = [
        {
          responseType: 'enrichment',
          prompt: null, // Invalid
          model: 'gpt-4',
          parameters: {},
          response: { content: 'result' }
        }
      ];
      
      const results = await responseCache.warmResponseCache(responses);
      
      expect(results[0].status).toBe('error');
    });
  });

  describe('Token Counting', () => {
    test('should extract token count from response usage', () => {
      const response = {
        content: 'test response',
        usage: { total_tokens: 150 }
      };
      
      const count = responseCache.extractTokenCount(response);
      expect(count).toBe(150);
    });

    test('should estimate token count from content length', () => {
      const response = {
        content: 'This is a test response with some content'
      };
      
      const count = responseCache.extractTokenCount(response);
      expect(count).toBeGreaterThan(0);
    });

    test('should handle responses without content', () => {
      const response = {};
      
      const count = responseCache.extractTokenCount(response);
      expect(count).toBe(0);
    });
  });

  describe('Integration with CacheManager', () => {
    test('should extend CacheManager functionality', () => {
      expect(responseCache).toBeInstanceOf(ResponseCache);
      expect(typeof responseCache.initialize).toBe('function');
      expect(typeof responseCache.shutdown).toBe('function');
    });

    test('should call parent methods', async () => {
      await responseCache.initialize();
      expect(responseCache.initialize).toHaveBeenCalled();
      
      await responseCache.shutdown();
      expect(responseCache.shutdown).toHaveBeenCalled();
    });
  });
});