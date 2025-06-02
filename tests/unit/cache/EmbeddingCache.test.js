const CacheManager = require('../../../src/cache/CacheManager');
const EmbeddingCache = require('../../../src/cache/EmbeddingCache');

// Mock CacheManager
jest.mock('../../../src/cache/CacheManager');

// Mock logger
jest.mock('../../../src/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

describe('EmbeddingCache', () => {
  let embeddingCache;
  let mockCacheManager;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Create mock CacheManager instance
    mockCacheManager = {
      initialize: jest.fn().mockResolvedValue(),
      shutdown: jest.fn().mockResolvedValue(),
      get: jest.fn(),
      set: jest.fn(),
      delete: jest.fn(),
      clear: jest.fn().mockResolvedValue(3),
      generateKey: jest.fn().mockImplementation((...args) => `cache-key-${args.join('-')}`),
      warmCache: jest.fn().mockResolvedValue(),
      getStats: jest.fn().mockResolvedValue({
        hits: 0,
        misses: 0,
        sets: 0,
        deletes: 0,
        memory: { size: 0, keys: 0 }
      }),
      healthCheck: jest.fn().mockResolvedValue({ status: 'healthy' }),
      on: jest.fn(),
      emit: jest.fn(),
      isInitialized: true,
      isConnected: true
    };
    
    // Mock CacheManager constructor to return a proper class instance
    CacheManager.mockImplementation(function(config) {
      // Copy all mock methods to this instance
      Object.keys(mockCacheManager).forEach(key => {
        this[key] = mockCacheManager[key];
      });
      
      // Ensure the instance has the config
      this.config = config;
      
      return this;
    });
    
    embeddingCache = new EmbeddingCache({
      ttl: {
        embeddings: 86400
      }
    });
  });

  afterEach(async () => {
    if (embeddingCache) {
      await embeddingCache.shutdown();
    }
  });

  describe('Initialization', () => {
    test('should initialize with default TTL configuration', () => {
      const cache = new EmbeddingCache();
      expect(cache.config.ttl.embeddings).toBe(86400);
    });

    test('should initialize with custom TTL configuration', () => {
      const cache = new EmbeddingCache({
        ttl: {
          embeddings: 172800
        }
      });
      expect(cache.config.ttl.embeddings).toBe(172800);
    });

    test('should initialize embedding statistics', () => {
      expect(embeddingCache.embeddingStats).toEqual({
        totalEmbeddings: 0,
        cachedEmbeddings: 0,
        cacheHitRate: 0,
        vectorComparisons: 0,
        totalVectorSize: 0,
        avgVectorSize: 0
      });
    });
  });

  describe('Document Embedding Caching', () => {
    beforeEach(() => {
      mockCacheManager.generateKey.mockImplementation((...parts) => parts.join(':'));
    });

    test('should cache document embedding', async () => {
      const documentId = 'doc123';
      const model = 'text-embedding-ada-002';
      const embedding = [0.1, 0.2, 0.3, 0.4];
      const metadata = { dimensions: 4 };
      
      mockCacheManager.set.mockResolvedValue();
      
      const key = await embeddingCache.cacheDocumentEmbedding(documentId, model, embedding, metadata);
      
      expect(key).toBeDefined();
      expect(mockCacheManager.set).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          documentId,
          model,
          embedding,
          metadata: expect.objectContaining({
            ...metadata,
            cachedAt: expect.any(String),
            vectorSize: 4,
            dimensions: 4
          })
        }),
        expect.objectContaining({ ttl: expect.any(Number) })
      );
    });

    test('should get cached document embedding', async () => {
      const documentId = 'doc123';
      const model = 'text-embedding-ada-002';
      const cachedData = {
        documentId,
        model,
        embedding: [0.1, 0.2, 0.3],
        metadata: {
          cachedAt: new Date().toISOString(),
          vectorSize: 3,
          dimensions: 3
        }
      };
      
      mockCacheManager.get.mockResolvedValue(cachedData);
      
      const result = await embeddingCache.getCachedDocumentEmbedding(documentId, model);
      
      expect(result).toEqual({
        embedding: cachedData.embedding,
        metadata: cachedData.metadata,
        fromCache: true
      });
      expect(embeddingCache.embeddingStats.cachedEmbeddings).toBe(1);
    });

    test('should return null for cache miss', async () => {
      mockCacheManager.get.mockResolvedValue(null);
      
      const result = await embeddingCache.getCachedDocumentEmbedding('doc123', 'model');
      
      expect(result).toBeNull();
      expect(embeddingCache.embeddingStats.totalEmbeddings).toBe(1);
    });

    test('should update embedding statistics on cache hit', async () => {
      const cachedData = {
        embedding: [0.1, 0.2, 0.3],
        metadata: { vectorSize: 3, cachedAt: new Date().toISOString() }
      };
      
      mockCacheManager.get.mockResolvedValue(cachedData);
      
      await embeddingCache.getCachedDocumentEmbedding('doc123', 'model');
      
      expect(embeddingCache.embeddingStats.cachedEmbeddings).toBe(1);
      expect(embeddingCache.embeddingStats.totalEmbeddings).toBe(1);
      expect(embeddingCache.embeddingStats.cacheHitRate).toBe(1);
      expect(embeddingCache.embeddingStats.totalVectorSize).toBe(3);
    });
  });

  describe('Text Embedding Caching', () => {
    beforeEach(() => {
      mockCacheManager.generateKey.mockImplementation((...parts) => parts.join(':'));
    });

    test('should cache text embedding', async () => {
      const text = 'sample text';
      const model = 'text-embedding-ada-002';
      const embedding = [0.1, 0.2, 0.3];
      
      mockCacheManager.set.mockResolvedValue();
      
      const key = await embeddingCache.cacheTextEmbedding(text, model, embedding);
      
      expect(mockCacheManager.set).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          text,
          model,
          embedding,
          metadata: expect.objectContaining({
            cachedAt: expect.any(String),
            textLength: text.length,
            vectorSize: 3
          })
        }),
        expect.objectContaining({ ttl: expect.any(Number) })
      );
    });

    test('should get cached text embedding', async () => {
      const text = 'sample text';
      const model = 'text-embedding-ada-002';
      const cachedData = {
        text,
        model,
        embedding: [0.1, 0.2, 0.3],
        metadata: {
          cachedAt: new Date().toISOString(),
          textLength: text.length,
          vectorSize: 3
        }
      };
      
      mockCacheManager.get.mockResolvedValue(cachedData);
      
      const result = await embeddingCache.getCachedTextEmbedding(text, model);
      
      expect(result).toEqual({
        embedding: cachedData.embedding,
        metadata: cachedData.metadata,
        fromCache: true
      });
    });

    test('should generate consistent keys for same text and model', () => {
      const text = 'sample text';
      const model = 'text-embedding-ada-002';
      
      const key1 = embeddingCache.generateTextEmbeddingKey(text, model);
      const key2 = embeddingCache.generateTextEmbeddingKey(text, model);
      
      expect(key1).toBe(key2);
    });

    test('should generate different keys for different text', () => {
      const model = 'text-embedding-ada-002';
      
      const key1 = embeddingCache.generateTextEmbeddingKey('text 1', model);
      const key2 = embeddingCache.generateTextEmbeddingKey('text 2', model);
      
      expect(key1).not.toBe(key2);
    });
  });

  describe('Similarity Results Caching', () => {
    beforeEach(() => {
      mockCacheManager.generateKey.mockImplementation((...parts) => parts.join(':'));
    });

    test('should cache similarity results', async () => {
      const queryEmbedding = [0.1, 0.2, 0.3];
      const documentIds = ['doc1', 'doc2'];
      const model = 'text-embedding-ada-002';
      const results = [
        { documentId: 'doc1', similarity: 0.95 },
        { documentId: 'doc2', similarity: 0.87 }
      ];
      
      mockCacheManager.set.mockResolvedValue();
      
      const key = await embeddingCache.cacheSimilarityResults(
        queryEmbedding, 
        documentIds, 
        model, 
        results
      );
      
      expect(mockCacheManager.set).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          queryEmbedding,
          documentIds,
          model,
          results,
          metadata: expect.objectContaining({
            cachedAt: expect.any(String),
            resultCount: 2,
            queryVectorSize: 3
          })
        }),
        expect.objectContaining({ ttl: expect.any(Number) })
      );
    });

    test('should get cached similarity results', async () => {
      const queryEmbedding = [0.1, 0.2, 0.3];
      const documentIds = ['doc1', 'doc2'];
      const model = 'text-embedding-ada-002';
      const cachedData = {
        queryEmbedding,
        documentIds,
        model,
        results: [{ documentId: 'doc1', similarity: 0.95 }],
        metadata: {
          cachedAt: new Date().toISOString(),
          resultCount: 1,
          queryVectorSize: 3
        }
      };
      
      mockCacheManager.get.mockResolvedValue(cachedData);
      
      const result = await embeddingCache.getCachedSimilarityResults(
        queryEmbedding, 
        documentIds, 
        model
      );
      
      expect(result).toEqual({
        results: cachedData.results,
        metadata: cachedData.metadata,
        fromCache: true
      });
    });
  });

  describe('Batch Operations', () => {
    beforeEach(() => {
      mockCacheManager.generateKey.mockImplementation((...parts) => parts.join(':'));
      mockCacheManager.set.mockResolvedValue();
    });

    test('should cache multiple embeddings in batch', async () => {
      const embeddings = [
        { documentId: 'doc1', model: 'model1', embedding: [0.1, 0.2] },
        { documentId: 'doc2', model: 'model1', embedding: [0.3, 0.4] }
      ];
      
      const results = await embeddingCache.batchCacheEmbeddings(embeddings);
      
      expect(results).toHaveLength(2);
      expect(results[0].status).toBe('success');
      expect(results[1].status).toBe('success');
      expect(mockCacheManager.set).toHaveBeenCalledTimes(2);
    });

    test('should handle batch caching errors gracefully', async () => {
      const embeddings = [
        { documentId: 'doc1', model: 'model1', embedding: [0.1, 0.2] },
        { documentId: null, model: 'model1', embedding: [0.3, 0.4] } // Invalid
      ];
      
      mockCacheManager.set.mockImplementationOnce(() => Promise.resolve())
        .mockImplementationOnce(() => Promise.reject(new Error('Cache error')));
      
      const results = await embeddingCache.batchCacheEmbeddings(embeddings);
      
      expect(results).toHaveLength(2);
      expect(results[0].status).toBe('success');
      expect(results[1].status).toBe('error');
    });

    test('should get multiple embeddings in batch', async () => {
      const requests = [
        { documentId: 'doc1', model: 'model1' },
        { documentId: 'doc2', model: 'model1' }
      ];
      
      mockCacheManager.get.mockImplementationOnce(() => Promise.resolve({
        embedding: [0.1, 0.2],
        metadata: { cachedAt: new Date().toISOString() }
      })).mockImplementationOnce(() => Promise.resolve(null));
      
      const results = await embeddingCache.batchGetEmbeddings(requests);
      
      expect(results).toHaveLength(2);
      expect(results[0].embedding).toEqual([0.1, 0.2]);
      expect(results[0].fromCache).toBe(true);
      expect(results[1]).toBeNull();
    });
  });

  describe('Cache Invalidation', () => {
    test('should invalidate document embeddings', async () => {
      mockCacheManager.clear.mockResolvedValue(3);
      
      const count = await embeddingCache.invalidateDocumentEmbeddings('doc123');
      
      expect(count).toBe(3);
      expect(mockCacheManager.clear).toHaveBeenCalledWith(
        expect.stringContaining('doc123')
      );
    });

    test('should invalidate embeddings by model', async () => {
      mockCacheManager.clear.mockResolvedValue(5);
      
      const count = await embeddingCache.invalidateEmbeddingsByModel('text-embedding-ada-002');
      
      expect(count).toBe(5);
      expect(mockCacheManager.clear).toHaveBeenCalledWith(
        expect.stringContaining('text-embedding-ada-002')
      );
    });

    test('should invalidate all embeddings for document', async () => {
      mockCacheManager.clear.mockResolvedValue(2);
      
      const count = await embeddingCache.invalidateDocumentEmbeddings('doc123', '*');
      
      expect(count).toBe(2);
      expect(mockCacheManager.clear).toHaveBeenCalledWith(
        expect.stringContaining('doc123')
      );
    });
  });

  describe('Cache Warming', () => {
    test('should warm embedding cache', async () => {
      const embeddings = [
        { documentId: 'doc1', model: 'model1', embedding: [0.1, 0.2] },
        { documentId: 'doc2', model: 'model1', embedding: [0.3, 0.4] }
      ];
      
      mockCacheManager.get.mockResolvedValue(null); // Not cached
      
      const results = await embeddingCache.warmEmbeddingCache(embeddings);
      
      expect(results).toHaveLength(2);
      expect(results[0].status).toBe('needs_generation');
      expect(results[1].status).toBe('needs_generation');
    });

    test('should identify already cached embeddings', async () => {
      const embeddings = [
        { documentId: 'doc1', model: 'model1', embedding: [0.1, 0.2] }
      ];
      
      mockCacheManager.get.mockResolvedValue({
        embedding: [0.1, 0.2],
        metadata: { cachedAt: new Date().toISOString() }
      });
      
      const results = await embeddingCache.warmEmbeddingCache(embeddings);
      
      expect(results[0].status).toBe('already_cached');
    });
  });

  describe('Statistics and Metrics', () => {
    test('should get embedding-specific statistics', async () => {
      mockCacheManager.getStats.mockResolvedValue({
        hits: 10,
        misses: 5,
        sets: 8,
        deletes: 2
      });
      
      // Set some embedding stats
      embeddingCache.embeddingStats.totalEmbeddings = 15;
      embeddingCache.embeddingStats.cachedEmbeddings = 10;
      embeddingCache.embeddingStats.cacheHitRate = 0.67;
      embeddingCache.embeddingStats.totalVectorSize = 1500;
      embeddingCache.embeddingStats.avgVectorSize = 100;
      
      const stats = await embeddingCache.getEmbeddingStats();
      
      expect(stats.embeddings).toEqual(embeddingCache.embeddingStats);
      expect(stats.hits).toBe(10);
      expect(stats.misses).toBe(5);
    });

    test('should estimate cache size', async () => {
      embeddingCache.embeddingStats.totalVectorSize = 1000;
      embeddingCache.embeddingStats.cachedEmbeddings = 10;
      
      const size = await embeddingCache.estimateCacheSize();
      
      expect(size.totalVectors).toBe(10);
      expect(size.totalDimensions).toBe(1000);
      expect(size.estimatedMemoryUsage).toBeGreaterThan(0);
    });

    test('should calculate cache efficiency', async () => {
      embeddingCache.embeddingStats.totalEmbeddings = 100;
      embeddingCache.embeddingStats.cachedEmbeddings = 75;
      embeddingCache.embeddingStats.cacheHitRate = 0.75;
      
      const efficiency = await embeddingCache.getCacheEfficiency();
      
      expect(efficiency.hitRate).toBe(0.75);
      expect(efficiency.totalEmbeddings).toBe(100);
      expect(efficiency.cachedEmbeddings).toBe(75);
    });
  });

  describe('Error Handling', () => {
    test('should handle cache set errors gracefully', async () => {
      mockCacheManager.set.mockRejectedValue(new Error('Cache error'));
      
      const key = await embeddingCache.cacheDocumentEmbedding('doc1', 'model1', [0.1, 0.2]);
      
      expect(key).toBeNull();
    });

    test('should handle cache get errors gracefully', async () => {
      mockCacheManager.get.mockRejectedValue(new Error('Cache error'));
      
      const result = await embeddingCache.getCachedDocumentEmbedding('doc1', 'model1');
      
      expect(result).toBeNull();
    });

    test('should handle invalidation errors gracefully', async () => {
      mockCacheManager.clear.mockRejectedValue(new Error('Clear error'));
      
      const count = await embeddingCache.invalidateDocumentEmbeddings('doc1');
      
      expect(count).toBe(0);
    });
  });

  describe('Vector Operations', () => {
    test('should calculate vector size correctly', () => {
      const embedding = [0.1, 0.2, 0.3, 0.4, 0.5];
      const size = embeddingCache.calculateVectorSize(embedding);
      
      expect(size).toBe(5);
    });

    test('should handle empty vectors', () => {
      const size = embeddingCache.calculateVectorSize([]);
      
      expect(size).toBe(0);
    });

    test('should handle invalid vectors', () => {
      const size = embeddingCache.calculateVectorSize(null);
      
      expect(size).toBe(0);
    });
  });

  describe('Integration with CacheManager', () => {
    test('should extend CacheManager functionality', () => {
      expect(embeddingCache).toBeInstanceOf(Object);
      expect(typeof embeddingCache.initialize).toBe('function');
      expect(typeof embeddingCache.shutdown).toBe('function');
    });

    test('should call parent methods', async () => {
      await embeddingCache.initialize();
      expect(mockCacheManager.initialize).toHaveBeenCalled();
      
      await embeddingCache.shutdown();
      expect(mockCacheManager.shutdown).toHaveBeenCalled();
    });
  });
});