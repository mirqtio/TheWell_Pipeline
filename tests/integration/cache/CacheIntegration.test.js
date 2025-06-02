const CacheIntegration = require('../../../src/cache/CacheIntegration');
const QueryCache = require('../../../src/cache/QueryCache');
const EmbeddingCache = require('../../../src/cache/EmbeddingCache');
const ResponseCache = require('../../../src/cache/ResponseCache');

// Mock all cache classes
jest.mock('../../../src/cache/QueryCache');
jest.mock('../../../src/cache/EmbeddingCache');
jest.mock('../../../src/cache/ResponseCache');

// Mock logger
jest.mock('../../../src/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

describe('CacheIntegration', () => {
  let cacheIntegration;
  let mockQueryCache;
  let mockEmbeddingCache;
  let mockResponseCache;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Create mock cache instances
    mockQueryCache = {
      initialize: jest.fn().mockResolvedValue(),
      shutdown: jest.fn().mockResolvedValue(),
      isInitialized: true,
      isConnected: true,
      getQueryStats: jest.fn().mockResolvedValue({
        queries: { totalQueries: 100, cachedQueries: 75 },
        hits: 75,
        misses: 25
      }),
      healthCheck: jest.fn().mockResolvedValue({ status: 'healthy' }),
      warmQueryCache: jest.fn().mockResolvedValue([]),
      invalidateQueriesBySource: jest.fn().mockResolvedValue(5),
      on: jest.fn(),
      emit: jest.fn()
    };
    
    mockEmbeddingCache = {
      initialize: jest.fn().mockResolvedValue(),
      shutdown: jest.fn().mockResolvedValue(),
      isInitialized: true,
      isConnected: true,
      getEmbeddingStats: jest.fn().mockResolvedValue({
        embeddings: { totalEmbeddings: 200, cachedEmbeddings: 150 },
        hits: 150,
        misses: 50
      }),
      healthCheck: jest.fn().mockResolvedValue({ status: 'healthy' }),
      warmEmbeddingCache: jest.fn().mockResolvedValue([]),
      invalidateDocumentEmbeddings: jest.fn().mockResolvedValue(3),
      invalidateEmbeddingsByModel: jest.fn().mockResolvedValue(10),
      on: jest.fn(),
      emit: jest.fn()
    };
    
    mockResponseCache = {
      initialize: jest.fn().mockResolvedValue(),
      shutdown: jest.fn().mockResolvedValue(),
      isInitialized: true,
      isConnected: true,
      getResponseStats: jest.fn().mockResolvedValue({
        responses: { totalResponses: 300, cachedResponses: 200 },
        hits: 200,
        misses: 100
      }),
      healthCheck: jest.fn().mockResolvedValue({ status: 'healthy' }),
      warmResponseCache: jest.fn().mockResolvedValue([]),
      invalidateResponsesByModel: jest.fn().mockResolvedValue(15),
      invalidateDocumentEnrichments: jest.fn().mockResolvedValue(8),
      on: jest.fn(),
      emit: jest.fn()
    };
    
    // Mock constructors
    QueryCache.mockImplementation(() => mockQueryCache);
    EmbeddingCache.mockImplementation(() => mockEmbeddingCache);
    ResponseCache.mockImplementation(() => mockResponseCache);
    
    cacheIntegration = new CacheIntegration({
      redis: {
        host: 'localhost',
        port: 6379
      },
      ttl: {
        queries: 1800,
        embeddings: 86400,
        responses: 3600
      }
    });
  });

  afterEach(async () => {
    if (cacheIntegration) {
      await cacheIntegration.shutdown();
    }
  });

  describe('Initialization', () => {
    test('should initialize all cache managers', async () => {
      await cacheIntegration.initialize();
      
      expect(mockQueryCache.initialize).toHaveBeenCalled();
      expect(mockEmbeddingCache.initialize).toHaveBeenCalled();
      expect(mockResponseCache.initialize).toHaveBeenCalled();
      expect(cacheIntegration.isInitialized).toBe(true);
    });

    test('should handle initialization errors gracefully', async () => {
      mockQueryCache.initialize.mockRejectedValue(new Error('Query cache init failed'));
      
      await expect(cacheIntegration.initialize()).rejects.toThrow('Query cache init failed');
      expect(cacheIntegration.isInitialized).toBe(false);
    });

    test('should set up event listeners during initialization', async () => {
      await cacheIntegration.initialize();
      
      expect(mockQueryCache.on).toHaveBeenCalledWith('cache-hit', expect.any(Function));
      expect(mockQueryCache.on).toHaveBeenCalledWith('cache-miss', expect.any(Function));
      expect(mockQueryCache.on).toHaveBeenCalledWith('cache-error', expect.any(Function));
      
      expect(mockEmbeddingCache.on).toHaveBeenCalledWith('cache-hit', expect.any(Function));
      expect(mockEmbeddingCache.on).toHaveBeenCalledWith('cache-miss', expect.any(Function));
      expect(mockEmbeddingCache.on).toHaveBeenCalledWith('cache-error', expect.any(Function));
      
      expect(mockResponseCache.on).toHaveBeenCalledWith('cache-hit', expect.any(Function));
      expect(mockResponseCache.on).toHaveBeenCalledWith('cache-miss', expect.any(Function));
      expect(mockResponseCache.on).toHaveBeenCalledWith('cache-error', expect.any(Function));
    });
  });

  describe('Connection Status', () => {
    test('should return true when all caches are connected', async () => {
      await cacheIntegration.initialize();
      
      const isConnected = cacheIntegration.isConnected();
      expect(isConnected).toBe(true);
    });

    test('should return false when any cache is disconnected', async () => {
      await cacheIntegration.initialize();
      mockQueryCache.isConnected = false;
      
      const isConnected = cacheIntegration.isConnected();
      expect(isConnected).toBe(false);
    });

    test('should return false when not initialized', () => {
      const isConnected = cacheIntegration.isConnected();
      expect(isConnected).toBe(false);
    });
  });

  describe('Event Forwarding', () => {
    test('should forward cache hit events', async () => {
      await cacheIntegration.initialize();
      const eventSpy = jest.spyOn(cacheIntegration, 'emit');
      
      // Simulate cache hit event from QueryCache
      const hitCallback = mockQueryCache.on.mock.calls.find(call => call[0] === 'cache-hit')[1];
      hitCallback({ cacheType: 'query', key: 'test-key' });
      
      expect(eventSpy).toHaveBeenCalledWith('cache-hit', {
        cacheType: 'query',
        key: 'test-key'
      });
    });

    test('should forward cache miss events', async () => {
      await cacheIntegration.initialize();
      const eventSpy = jest.spyOn(cacheIntegration, 'emit');
      
      // Simulate cache miss event from EmbeddingCache
      const missCallback = mockEmbeddingCache.on.mock.calls.find(call => call[0] === 'cache-miss')[1];
      missCallback({ cacheType: 'embedding', key: 'test-key' });
      
      expect(eventSpy).toHaveBeenCalledWith('cache-miss', {
        cacheType: 'embedding',
        key: 'test-key'
      });
    });

    test('should forward cache error events', async () => {
      await cacheIntegration.initialize();
      const eventSpy = jest.spyOn(cacheIntegration, 'emit');
      
      // Simulate cache error event from ResponseCache
      const errorCallback = mockResponseCache.on.mock.calls.find(call => call[0] === 'cache-error')[1];
      errorCallback({ cacheType: 'response', error: new Error('Cache error') });
      
      expect(eventSpy).toHaveBeenCalledWith('cache-error', {
        cacheType: 'response',
        error: expect.any(Error)
      });
    });
  });

  describe('Cache Warming', () => {
    test('should warm all caches', async () => {
      await cacheIntegration.initialize();
      
      const warmingData = {
        queries: [{ query: 'test', source: 'source1' }],
        embeddings: [{ documentId: 'doc1', model: 'model1', embedding: [0.1, 0.2] }],
        responses: [{ responseType: 'enrichment', prompt: 'prompt1', model: 'gpt-4' }]
      };
      
      const results = await cacheIntegration.warmAllCaches(warmingData);
      
      expect(mockQueryCache.warmQueryCache).toHaveBeenCalledWith(warmingData.queries);
      expect(mockEmbeddingCache.warmEmbeddingCache).toHaveBeenCalledWith(warmingData.embeddings);
      expect(mockResponseCache.warmResponseCache).toHaveBeenCalledWith(warmingData.responses);
      
      expect(results).toHaveProperty('queries');
      expect(results).toHaveProperty('embeddings');
      expect(results).toHaveProperty('responses');
    });

    test('should handle warming errors gracefully', async () => {
      await cacheIntegration.initialize();
      mockQueryCache.warmQueryCache.mockRejectedValue(new Error('Warming failed'));
      
      const warmingData = {
        queries: [{ query: 'test', source: 'source1' }],
        embeddings: [],
        responses: []
      };
      
      const results = await cacheIntegration.warmAllCaches(warmingData);
      
      expect(results.queries).toEqual([]);
      expect(results.embeddings).toEqual([]);
      expect(results.responses).toEqual([]);
    });
  });

  describe('Cache Invalidation', () => {
    beforeEach(async () => {
      await cacheIntegration.initialize();
    });

    test('should invalidate caches on document update', async () => {
      const documentId = 'doc123';
      
      const result = await cacheIntegration.invalidateOnDocumentUpdate(documentId);
      
      expect(mockQueryCache.invalidateQueriesBySource).toHaveBeenCalledWith(documentId);
      expect(mockEmbeddingCache.invalidateDocumentEmbeddings).toHaveBeenCalledWith(documentId);
      expect(mockResponseCache.invalidateDocumentEnrichments).toHaveBeenCalledWith(documentId);
      
      expect(result.queries).toBe(5);
      expect(result.embeddings).toBe(3);
      expect(result.responses).toBe(8);
      expect(result.total).toBe(16);
    });

    test('should invalidate caches on source update', async () => {
      const sourceId = 'source123';
      
      const result = await cacheIntegration.invalidateOnSourceUpdate(sourceId);
      
      expect(mockQueryCache.invalidateQueriesBySource).toHaveBeenCalledWith(sourceId);
      expect(result.queries).toBe(5);
      expect(result.total).toBe(5);
    });

    test('should invalidate caches on model update', async () => {
      const model = 'gpt-4';
      
      const result = await cacheIntegration.invalidateOnModelUpdate(model);
      
      expect(mockEmbeddingCache.invalidateEmbeddingsByModel).toHaveBeenCalledWith(model);
      expect(mockResponseCache.invalidateResponsesByModel).toHaveBeenCalledWith(model);
      
      expect(result.embeddings).toBe(10);
      expect(result.responses).toBe(15);
      expect(result.total).toBe(25);
    });

    test('should handle invalidation errors gracefully', async () => {
      mockQueryCache.invalidateQueriesBySource.mockRejectedValue(new Error('Invalidation failed'));
      
      const result = await cacheIntegration.invalidateOnDocumentUpdate('doc123');
      
      expect(result.queries).toBe(0);
      expect(result.embeddings).toBe(3);
      expect(result.responses).toBe(8);
    });
  });

  describe('Statistics Aggregation', () => {
    test('should get aggregated statistics', async () => {
      await cacheIntegration.initialize();
      
      const stats = await cacheIntegration.getAggregatedStats();
      
      expect(stats).toHaveProperty('queries');
      expect(stats).toHaveProperty('embeddings');
      expect(stats).toHaveProperty('responses');
      expect(stats).toHaveProperty('overall');
      
      expect(stats.overall.totalHits).toBe(425); // 75 + 150 + 200
      expect(stats.overall.totalMisses).toBe(175); // 25 + 50 + 100
      expect(stats.overall.overallHitRate).toBeCloseTo(0.708); // 425/600
    });

    test('should handle statistics errors gracefully', async () => {
      await cacheIntegration.initialize();
      mockQueryCache.getQueryStats.mockRejectedValue(new Error('Stats error'));
      
      const stats = await cacheIntegration.getAggregatedStats();
      
      expect(stats.queries).toEqual({});
      expect(stats.embeddings).toBeDefined();
      expect(stats.responses).toBeDefined();
    });
  });

  describe('Health Checks', () => {
    test('should perform health check on all caches', async () => {
      await cacheIntegration.initialize();
      
      const health = await cacheIntegration.healthCheck();
      
      expect(mockQueryCache.healthCheck).toHaveBeenCalled();
      expect(mockEmbeddingCache.healthCheck).toHaveBeenCalled();
      expect(mockResponseCache.healthCheck).toHaveBeenCalled();
      
      expect(health.status).toBe('healthy');
      expect(health.caches.query.status).toBe('healthy');
      expect(health.caches.embedding.status).toBe('healthy');
      expect(health.caches.response.status).toBe('healthy');
    });

    test('should report unhealthy when any cache is unhealthy', async () => {
      await cacheIntegration.initialize();
      mockQueryCache.healthCheck.mockResolvedValue({ status: 'unhealthy', error: 'Connection lost' });
      
      const health = await cacheIntegration.healthCheck();
      
      expect(health.status).toBe('unhealthy');
      expect(health.caches.query.status).toBe('unhealthy');
      expect(health.caches.query.error).toBe('Connection lost');
    });

    test('should handle health check errors', async () => {
      await cacheIntegration.initialize();
      mockEmbeddingCache.healthCheck.mockRejectedValue(new Error('Health check failed'));
      
      const health = await cacheIntegration.healthCheck();
      
      expect(health.status).toBe('unhealthy');
      expect(health.caches.embedding.status).toBe('error');
      expect(health.caches.embedding.error).toBe('Health check failed');
    });
  });

  describe('Cache Access', () => {
    test('should provide access to individual cache managers', async () => {
      await cacheIntegration.initialize();
      
      expect(cacheIntegration.getQueryCache()).toBe(mockQueryCache);
      expect(cacheIntegration.getEmbeddingCache()).toBe(mockEmbeddingCache);
      expect(cacheIntegration.getResponseCache()).toBe(mockResponseCache);
    });

    test('should return null for cache managers when not initialized', () => {
      expect(cacheIntegration.getQueryCache()).toBeNull();
      expect(cacheIntegration.getEmbeddingCache()).toBeNull();
      expect(cacheIntegration.getResponseCache()).toBeNull();
    });
  });

  describe('Shutdown', () => {
    test('should shutdown all cache managers', async () => {
      await cacheIntegration.initialize();
      await cacheIntegration.shutdown();
      
      expect(mockQueryCache.shutdown).toHaveBeenCalled();
      expect(mockEmbeddingCache.shutdown).toHaveBeenCalled();
      expect(mockResponseCache.shutdown).toHaveBeenCalled();
      expect(cacheIntegration.isInitialized).toBe(false);
    });

    test('should handle shutdown errors gracefully', async () => {
      await cacheIntegration.initialize();
      mockQueryCache.shutdown.mockRejectedValue(new Error('Shutdown failed'));
      
      await cacheIntegration.shutdown();
      
      expect(mockEmbeddingCache.shutdown).toHaveBeenCalled();
      expect(mockResponseCache.shutdown).toHaveBeenCalled();
      expect(cacheIntegration.isInitialized).toBe(false);
    });

    test('should not error when shutting down uninitialized integration', async () => {
      await expect(cacheIntegration.shutdown()).resolves.not.toThrow();
    });
  });

  describe('Configuration', () => {
    test('should pass configuration to individual cache managers', () => {
      const config = {
        redis: { host: 'redis-server', port: 6380 },
        ttl: { queries: 3600, embeddings: 172800, responses: 7200 }
      };
      
      const integration = new CacheIntegration(config);
      
      expect(QueryCache).toHaveBeenCalledWith(expect.objectContaining({
        redis: config.redis,
        ttl: expect.objectContaining({ queries: 3600 })
      }));
      
      expect(EmbeddingCache).toHaveBeenCalledWith(expect.objectContaining({
        redis: config.redis,
        ttl: expect.objectContaining({ embeddings: 172800 })
      }));
      
      expect(ResponseCache).toHaveBeenCalledWith(expect.objectContaining({
        redis: config.redis,
        ttl: expect.objectContaining({ responses: 7200 })
      }));
    });

    test('should use default configuration when none provided', () => {
      const integration = new CacheIntegration();
      
      expect(QueryCache).toHaveBeenCalledWith(expect.objectContaining({
        redis: expect.objectContaining({
          host: 'localhost',
          port: 6379
        })
      }));
    });
  });

  describe('Error Handling', () => {
    test('should emit error events for cache failures', async () => {
      await cacheIntegration.initialize();
      const errorSpy = jest.spyOn(cacheIntegration, 'emit');
      
      // Simulate error during invalidation
      mockQueryCache.invalidateQueriesBySource.mockRejectedValue(new Error('Invalidation error'));
      
      await cacheIntegration.invalidateOnDocumentUpdate('doc123');
      
      expect(errorSpy).toHaveBeenCalledWith('cache-error', expect.objectContaining({
        operation: 'invalidateOnDocumentUpdate',
        error: expect.any(Error)
      }));
    });

    test('should handle missing cache managers gracefully', async () => {
      // Don't initialize
      const stats = await cacheIntegration.getAggregatedStats();
      
      expect(stats.queries).toEqual({});
      expect(stats.embeddings).toEqual({});
      expect(stats.responses).toEqual({});
      expect(stats.overall.totalHits).toBe(0);
    });
  });

  describe('Event Emission', () => {
    test('should emit initialization events', async () => {
      const eventSpy = jest.spyOn(cacheIntegration, 'emit');
      
      await cacheIntegration.initialize();
      
      expect(eventSpy).toHaveBeenCalledWith('initialized', {
        caches: ['query', 'embedding', 'response'],
        timestamp: expect.any(String)
      });
    });

    test('should emit shutdown events', async () => {
      await cacheIntegration.initialize();
      const eventSpy = jest.spyOn(cacheIntegration, 'emit');
      
      await cacheIntegration.shutdown();
      
      expect(eventSpy).toHaveBeenCalledWith('shutdown', {
        caches: ['query', 'embedding', 'response'],
        timestamp: expect.any(String)
      });
    });
  });
});