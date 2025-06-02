const QueryCache = require('../../../src/cache/QueryCache');

// Mock logger
jest.mock('../../../src/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

// Mock CacheManager methods
const mockCacheManager = {
  initialize: jest.fn().mockResolvedValue(),
  shutdown: jest.fn().mockResolvedValue(),
  get: jest.fn(),
  set: jest.fn(),
  delete: jest.fn(),
  clear: jest.fn(),
  generateKey: jest.fn(),
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

describe('QueryCache', () => {
  let queryCache;

  beforeEach(() => {
    jest.clearAllMocks();
    
    queryCache = new QueryCache({
      ttl: {
        queryResults: 3600,
        searchResults: 1800
      }
    });

    // Mock the inherited CacheManager methods
    Object.assign(queryCache, mockCacheManager);
  });

  afterEach(async () => {
    if (queryCache) {
      await queryCache.shutdown();
    }
  });

  describe('Initialization', () => {
    test('should initialize with default TTL configuration', () => {
      const cache = new QueryCache();
      expect(cache.config.ttl.queryResults).toBe(3600);
      expect(cache.config.ttl.searchResults).toBe(1800);
    });

    test('should initialize with custom TTL configuration', () => {
      const cache = new QueryCache({
        ttl: {
          queryResults: 7200,
          searchResults: 3600
        }
      });
      expect(cache.config.ttl.queryResults).toBe(7200);
      expect(cache.config.ttl.searchResults).toBe(3600);
    });

    test('should initialize query statistics', () => {
      expect(queryCache.queryStats).toEqual({
        totalQueries: 0,
        cachedQueries: 0,
        cacheHitRate: 0
      });
    });
  });

  describe('Cache Key Generation', () => {
    beforeEach(() => {
      mockCacheManager.generateKey.mockImplementation((...parts) => parts.join(':'));
    });

    test('should generate query key with basic parameters', () => {
      const key = queryCache.generateQueryKey('test query', {});
      
      expect(key).toBeDefined();
      expect(typeof key).toBe('string');
    });

    test('should generate consistent keys for same query', () => {
      const query = 'test query';
      const options = { limit: 10, offset: 0 };
      
      const key1 = queryCache.generateQueryKey(query, options);
      const key2 = queryCache.generateQueryKey(query, options);
      
      expect(key1).toBe(key2);
    });

    test('should generate different keys for different queries', () => {
      const key1 = queryCache.generateQueryKey('query 1', {});
      const key2 = queryCache.generateQueryKey('query 2', {});
      
      expect(key1).not.toBe(key2);
    });

    test('should generate different keys for different options', () => {
      const query = 'test query';
      const key1 = queryCache.generateQueryKey(query, { limit: 10 });
      const key2 = queryCache.generateQueryKey(query, { limit: 20 });
      
      expect(key1).not.toBe(key2);
    });

    test('should normalize query options for consistent keys', () => {
      const query = 'test query';
      const options1 = { limit: 10, offset: 0, extra: undefined };
      const options2 = { offset: 0, limit: 10 };
      
      const key1 = queryCache.generateQueryKey(query, options1);
      const key2 = queryCache.generateQueryKey(query, options2);
      
      expect(key1).toBe(key2);
    });
  });

  describe('Query Caching', () => {
    beforeEach(() => {
      mockCacheManager.generateKey.mockImplementation((...parts) => parts.join(':'));
    });

    test('should cache query results', async () => {
      const query = 'test query';
      const results = [{ id: 1, content: 'result 1' }];
      const metadata = { source: 'test' };
      
      mockCacheManager.set.mockResolvedValue();
      
      const key = await queryCache.cacheQueryResults(query, {}, results, metadata);
      
      expect(key).toBeDefined();
      expect(mockCacheManager.set).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          results,
          metadata: expect.objectContaining({
            ...metadata,
            cachedAt: expect.any(String),
            resultCount: 1,
            queryHash: expect.any(String)
          }),
          query: expect.objectContaining({
            original: query,
            filters: {},
            options: {}
          })
        }),
        expect.objectContaining({ ttl: expect.any(Number) })
      );
    });

    test('should get cached query results', async () => {
      const query = 'test query';
      const cachedData = {
        query: {
          original: query,
          filters: {},
          options: {}
        },
        results: [{ id: 1, content: 'result 1' }],
        metadata: {
          cachedAt: new Date().toISOString(),
          resultCount: 1,
          queryHash: 'hash'
        }
      };
      
      mockCacheManager.get.mockResolvedValue(cachedData);
      
      const result = await queryCache.getCachedQueryResults(query, {});
      
      expect(result).toEqual({
        results: cachedData.results,
        metadata: cachedData.metadata,
        fromCache: true
      });
      expect(queryCache.queryStats.cachedQueries).toBe(1);
    });

    test('should return null for cache miss', async () => {
      mockCacheManager.get.mockResolvedValue(null);
      
      const result = await queryCache.getCachedQueryResults('test query', {});
      
      expect(result).toBeNull();
      expect(queryCache.queryStats.totalQueries).toBe(1);
    });

    test('should update query statistics on cache hit', async () => {
      const cachedData = {
        query: {
          original: 'test',
          filters: {},
          options: {}
        },
        results: [],
        metadata: { cachedAt: new Date().toISOString() }
      };
      
      mockCacheManager.get.mockResolvedValue(cachedData);
      
      await queryCache.getCachedQueryResults('test', {});
      
      expect(queryCache.queryStats.cachedQueries).toBe(1);
      expect(queryCache.queryStats.totalQueries).toBe(1);
      expect(queryCache.queryStats.cacheHitRate).toBe(1);
    });

    test('should update query statistics on cache miss', async () => {
      mockCacheManager.get.mockResolvedValue(null);
      
      await queryCache.getCachedQueryResults('test', {});
      
      expect(queryCache.queryStats.cachedQueries).toBe(0);
      expect(queryCache.queryStats.totalQueries).toBe(1);
      expect(queryCache.queryStats.cacheHitRate).toBe(0);
    });
  });

  describe('Search Results Caching', () => {
    beforeEach(() => {
      mockCacheManager.generateKey.mockImplementation((...parts) => parts.join(':'));
    });

    test('should cache search results', async () => {
      const searchParams = {
        query: 'search term',
        filters: { type: 'document' },
        sort: 'relevance'
      };
      const results = [{ id: 1, score: 0.9 }];
      
      mockCacheManager.set.mockResolvedValue();
      
      const key = await queryCache.cacheSearchResults(searchParams, results);
      
      expect(mockCacheManager.set).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          searchParams,
          results,
          metadata: expect.objectContaining({
            cachedAt: expect.any(String),
            resultCount: 1
          })
        }),
        expect.objectContaining({ ttl: expect.any(Number) })
      );
    });

    test('should get cached search results', async () => {
      const searchParams = { query: 'test' };
      const cachedData = {
        searchParams,
        results: [{ id: 1 }],
        metadata: { cachedAt: new Date().toISOString() }
      };
      
      mockCacheManager.get.mockResolvedValue(cachedData);
      
      const result = await queryCache.getCachedSearchResults(searchParams);
      
      expect(result).toEqual({
        results: cachedData.results,
        metadata: cachedData.metadata,
        fromCache: true
      });
    });
  });

  describe('TTL Determination', () => {
    test('should return default TTL for simple queries', () => {
      const ttl = queryCache.determineTTL('simple query', {});
      expect(ttl).toBe(3600); // queryResults default
    });

    test('should return longer TTL for complex queries', () => {
      const complexQuery = 'a'.repeat(1000); // Long query
      const ttl = queryCache.determineTTL(complexQuery, {});
      expect(ttl).toBeGreaterThan(3600);
    });

    test('should return shorter TTL for real-time queries', () => {
      const ttl = queryCache.determineTTL('test', { realTime: true });
      expect(ttl).toBeLessThan(3600);
    });

    test('should respect suggested TTL', () => {
      const ttl = queryCache.determineTTL('test', { suggestedTTL: 1800 });
      expect(ttl).toBe(1800);
    });

    test('should use search results TTL for search queries', () => {
      const ttl = queryCache.determineTTL('test', { isSearch: true });
      expect(ttl).toBe(1800); // searchResults TTL
    });
  });

  describe('Cache Invalidation', () => {
    test('should invalidate queries by pattern', async () => {
      mockCacheManager.clear.mockResolvedValue(5);
      
      const count = await queryCache.invalidateQueries('test:*');
      
      expect(count).toBe(5);
      expect(mockCacheManager.clear).toHaveBeenCalledWith('query:test:*');
    });

    test('should invalidate queries by source', async () => {
      mockCacheManager.clear.mockResolvedValue(3);
      
      const count = await queryCache.invalidateQueriesBySource('source1');
      
      expect(count).toBe(3);
      expect(mockCacheManager.clear).toHaveBeenCalledWith(
        expect.stringContaining('source1')
      );
    });

    test('should invalidate queries by document', async () => {
      mockCacheManager.clear.mockResolvedValue(2);
      
      const count = await queryCache.invalidateQueriesByDocument('doc123');
      
      expect(count).toBe(2);
      expect(mockCacheManager.clear).toHaveBeenCalledWith(
        expect.stringContaining('doc123')
      );
    });
  });

  describe('Cache Warming', () => {
    test('should preload common queries', async () => {
      const queries = [
        { query: 'common query 1', options: {} },
        { query: 'common query 2', options: { limit: 10 } }
      ];
      
      mockCacheManager.get.mockResolvedValue(null); // Not cached
      
      const results = await queryCache.preloadCommonQueries(queries);
      
      expect(results).toHaveLength(2);
      expect(results[0].status).toBe('needs_execution');
      expect(results[1].status).toBe('needs_execution');
    });

    test('should identify already cached queries', async () => {
      const queries = [
        { query: 'cached query', options: {} }
      ];
      
      mockCacheManager.get.mockResolvedValue({ 
        query: {
          original: 'cached query',
          filters: {},
          options: {}
        },
        results: []
      });
      
      const results = await queryCache.preloadCommonQueries(queries);
      
      expect(results[0].status).toBe('already_cached');
    });
  });

  describe('Statistics', () => {
    test('should get query-specific statistics', async () => {
      mockCacheManager.getStats.mockResolvedValue({
        hits: 10,
        misses: 5,
        sets: 8,
        deletes: 2
      });
      
      // Set some query stats
      queryCache.queryStats.totalQueries = 15;
      queryCache.queryStats.cachedQueries = 10;
      queryCache.queryStats.cacheHitRate = 0.67;
      
      const stats = await queryCache.getQueryStats();
      
      expect(stats.queries).toEqual(queryCache.queryStats);
      expect(stats.hits).toBe(10);
      expect(stats.misses).toBe(5);
    });

    test('should calculate cache efficiency', async () => {
      queryCache.queryStats.totalQueries = 100;
      queryCache.queryStats.cachedQueries = 75;
      queryCache.queryStats.cacheHitRate = 0.75;
      
      const efficiency = await queryCache.getCacheEfficiency();
      
      expect(efficiency.hitRate).toBe(0.75);
      expect(efficiency.totalQueries).toBe(100);
      expect(efficiency.cachedQueries).toBe(75);
    });
  });

  describe('Error Handling', () => {
    test('should handle cache set errors gracefully', async () => {
      mockCacheManager.set.mockRejectedValue(new Error('Cache error'));
      
      const key = await queryCache.cacheQueryResults('test', {}, [], {});
      
      expect(key).toBeNull();
    });

    test('should handle cache get errors gracefully', async () => {
      mockCacheManager.get.mockRejectedValue(new Error('Cache error'));
      
      const result = await queryCache.getCachedQueryResults('test', {});
      
      expect(result).toBeNull();
    });

    test('should handle invalidation errors gracefully', async () => {
      mockCacheManager.clear.mockRejectedValue(new Error('Clear error'));
      
      const count = await queryCache.invalidateQueries('test:*');
      
      expect(count).toBe(0);
    });
  });

  describe('Integration with CacheManager', () => {
    test('should extend CacheManager functionality', () => {
      expect(queryCache).toBeInstanceOf(QueryCache);
      expect(typeof queryCache.initialize).toBe('function');
      expect(typeof queryCache.shutdown).toBe('function');
    });

    test('should call parent methods', async () => {
      await queryCache.initialize();
      expect(mockCacheManager.initialize).toHaveBeenCalled();
      
      await queryCache.shutdown();
      expect(mockCacheManager.shutdown).toHaveBeenCalled();
    });
  });
});