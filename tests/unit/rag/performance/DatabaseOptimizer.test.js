/**
 * Unit tests for DatabaseOptimizer
 */

const DatabaseOptimizer = require('../../../../src/rag/performance/DatabaseOptimizer');

describe('DatabaseOptimizer', () => {
  let databaseOptimizer;
  let mockDatabaseManager;

  beforeEach(() => {
    mockDatabaseManager = {
      query: jest.fn(),
      getPool: jest.fn().mockReturnValue({
        query: jest.fn()
      })
    };

    databaseOptimizer = new DatabaseOptimizer({
      databaseManager: mockDatabaseManager,
      enableQueryCaching: true,
      cacheSize: 100,
      cacheTTL: 300000
    });
  });

  afterEach(async () => {
    if (databaseOptimizer.isInitialized) {
      await databaseOptimizer.shutdown();
    }
    jest.clearAllMocks();
    mockDatabaseManager.query.mockClear();
  });

  describe('constructor', () => {
    it('should initialize with default options', () => {
      const optimizer = new DatabaseOptimizer({
        databaseManager: mockDatabaseManager
      });

      expect(optimizer.databaseManager).toBe(mockDatabaseManager);
      expect(optimizer.enableQueryCaching).toBe(true);
      expect(optimizer.cacheSize).toBe(1000);
      expect(optimizer.cacheTTL).toBe(300000);
      expect(optimizer.isInitialized).toBe(false);
    });

    it('should initialize with custom options', () => {
      expect(databaseOptimizer.enableQueryCaching).toBe(true);
      expect(databaseOptimizer.cacheSize).toBe(100);
      expect(databaseOptimizer.cacheTTL).toBe(300000);
    });
  });

  describe('initialize', () => {
    it('should initialize successfully', async () => {
      mockDatabaseManager.query.mockResolvedValue({ rows: [] });

      await databaseOptimizer.initialize();
      expect(databaseOptimizer.isInitialized).toBe(true);
    });

    it('should throw error if database manager is missing', async () => {
      const optimizer = new DatabaseOptimizer({});
      await expect(optimizer.initialize()).rejects.toThrow('Database manager is required');
    });

    it('should create indexes during initialization', async () => {
      mockDatabaseManager.query.mockResolvedValue({ rows: [] });

      await databaseOptimizer.initialize();

      // Should have called createOptimizedIndexes
      expect(mockDatabaseManager.query).toHaveBeenCalled();
    });
  });

  describe('createOptimizedIndexes', () => {
    beforeEach(async () => {
      mockDatabaseManager.query.mockResolvedValue({ rows: [] });
      await databaseOptimizer.initialize();
    });

    it('should create vector search indexes', async () => {
      await databaseOptimizer.createOptimizedIndexes();

      const calls = mockDatabaseManager.query.mock.calls;
      const indexQueries = calls.filter(call => 
        call[0].includes('CREATE INDEX') && call[0].includes('CONCURRENTLY')
      );

      expect(indexQueries.length).toBeGreaterThan(0);
    });

    it('should handle index creation errors gracefully', async () => {
      mockDatabaseManager.query.mockRejectedValue(new Error('Index creation failed'));

      // Should not throw, just log the error
      await expect(databaseOptimizer.createOptimizedIndexes()).resolves.not.toThrow();
    });
  });

  describe('optimizedVectorSearch', () => {
    beforeEach(async () => {
      mockDatabaseManager.query.mockResolvedValue({ rows: [] });
      await databaseOptimizer.initialize();
      mockDatabaseManager.query.mockClear(); // Clear calls from initialization
    });

    it('should perform vector search with caching', async () => {
      const embedding = [0.1, 0.2, 0.3];
      const filters = { category: 'test' };
      const userAuth = { userId: 'user1', groupIds: ['group1'] };
      const limit = 10;

      const mockResults = [
        { id: '1', title: 'Test Doc 1', similarity: 0.9 }
      ];

      mockDatabaseManager.query.mockResolvedValue({ rows: mockResults });

      const results = await databaseOptimizer.optimizedVectorSearch(
        embedding, filters, userAuth, limit
      );

      expect(results).toEqual(mockResults);
      expect(mockDatabaseManager.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
        expect.arrayContaining([JSON.stringify(embedding), limit])
      );
    });

    it('should return cached results when available', async () => {
      const embedding = [0.1, 0.2, 0.3];
      const filters = {};
      const userAuth = { userId: 'user1' };
      const limit = 10;

      const mockResults = [
        { id: '1', title: 'Cached Doc 1', similarity: 0.9 }
      ];

      // First call - cache miss
      mockDatabaseManager.query.mockResolvedValue({ rows: mockResults });
      const results1 = await databaseOptimizer.optimizedVectorSearch(
        embedding, filters, userAuth, limit
      );

      // Second call - should use cache
      const results2 = await databaseOptimizer.optimizedVectorSearch(
        embedding, filters, userAuth, limit
      );

      expect(results1).toEqual(mockResults);
      expect(results2).toEqual(mockResults);
      expect(mockDatabaseManager.query).toHaveBeenCalledTimes(1); // Only called once due to caching
    });

    it('should handle query errors', async () => {
      const embedding = [0.1, 0.2, 0.3];
      const userAuth = { userId: 'user1' };

      mockDatabaseManager.query.mockRejectedValue(new Error('Database error'));

      await expect(
        databaseOptimizer.optimizedVectorSearch(embedding, {}, userAuth, 10)
      ).rejects.toThrow('Database error');
    });
  });

  describe('optimizedKeywordSearch', () => {
    beforeEach(async () => {
      mockDatabaseManager.query.mockResolvedValue({ rows: [] });
      await databaseOptimizer.initialize();
      mockDatabaseManager.query.mockClear(); // Clear calls from initialization
    });

    it('should perform keyword search with caching', async () => {
      const query = 'test search';
      const filters = { category: 'test' };
      const userAuth = { userId: 'user1', groupIds: ['group1'] };
      const limit = 10;

      const mockResults = [
        { id: '1', title: 'Test Doc 1', rank: 0.9 }
      ];

      mockDatabaseManager.query.mockResolvedValue({ rows: mockResults });

      const results = await databaseOptimizer.optimizedKeywordSearch(
        query, filters, userAuth, limit
      );

      expect(results).toEqual(mockResults);
      expect(mockDatabaseManager.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
        expect.arrayContaining([query, limit])
      );
    });

    it('should return cached results when available', async () => {
      const query = 'test search';
      const filters = {};
      const userAuth = { userId: 'user1' };
      const limit = 10;

      const mockResults = [
        { id: '1', title: 'Cached Doc 1', rank: 0.9 }
      ];

      // First call - cache miss
      mockDatabaseManager.query.mockResolvedValue({ rows: mockResults });
      const results1 = await databaseOptimizer.optimizedKeywordSearch(
        query, filters, userAuth, limit
      );

      // Second call - should use cache
      const results2 = await databaseOptimizer.optimizedKeywordSearch(
        query, filters, userAuth, limit
      );

      expect(results1).toEqual(mockResults);
      expect(results2).toEqual(mockResults);
      expect(mockDatabaseManager.query).toHaveBeenCalledTimes(1); // Only called once due to caching
    });
  });

  describe('getQueryPerformanceMetrics', () => {
    beforeEach(async () => {
      mockDatabaseManager.query.mockResolvedValue({ rows: [] });
      await databaseOptimizer.initialize();
    });

    it('should return performance metrics', () => {
      const metrics = databaseOptimizer.getQueryPerformanceMetrics();
      expect(metrics).toEqual({
        totalQueries: 0,
        cacheHits: 0,
        cacheMisses: 0,
        cacheHitRate: 0,
        averageQueryTime: 0,
        totalQueryTime: 0
      });
    });

    it('should track metrics after queries', async () => {
      mockDatabaseManager.query.mockResolvedValue({ rows: [] });

      await databaseOptimizer.optimizedVectorSearch([0.1, 0.2], {}, { userId: 'user1' }, 10);
      await databaseOptimizer.optimizedKeywordSearch('test', {}, { userId: 'user1' }, 10);

      const metrics = databaseOptimizer.getQueryPerformanceMetrics();
      expect(metrics.totalQueries).toBe(2);
      expect(metrics.cacheMisses).toBe(2);
      expect(metrics.cacheHitRate).toBe(0);
    });
  });

  describe('getCacheStats', () => {
    beforeEach(async () => {
      mockDatabaseManager.query.mockResolvedValue({ rows: [] });
      await databaseOptimizer.initialize();
    });

    it('should return cache statistics', () => {
      const stats = databaseOptimizer.getCacheStats();
      expect(stats).toEqual({
        size: 0,
        maxSize: 100,
        hitRate: 0,
        hits: 0,
        misses: 0
      });
    });
  });

  describe('clearCache', () => {
    beforeEach(async () => {
      mockDatabaseManager.query.mockResolvedValue({ rows: [] });
      await databaseOptimizer.initialize();
    });

    it('should clear the cache', async () => {
      // Add something to cache first
      await databaseOptimizer.optimizedVectorSearch([0.1, 0.2], {}, { userId: 'user1' }, 10);
      
      let stats = databaseOptimizer.getCacheStats();
      expect(stats.size).toBe(1);

      databaseOptimizer.clearCache();
      
      stats = databaseOptimizer.getCacheStats();
      expect(stats.size).toBe(0);
    });
  });

  describe('getStatus', () => {
    it('should return status when not initialized', async () => {
      const status = await databaseOptimizer.getStatus();
      expect(status).toEqual({
        initialized: false,
        enableQueryCaching: true,
        cacheSize: 100,
        cacheTTL: 300000,
        databaseManager: 'available',
        cacheStats: {
          size: 0,
          maxSize: 100,
          hitRate: 0,
          hits: 0,
          misses: 0
        },
        performanceMetrics: {
          totalQueries: 0,
          cacheHits: 0,
          cacheMisses: 0,
          cacheHitRate: 0,
          averageQueryTime: 0,
          totalQueryTime: 0
        }
      });
    });

    it('should return status when initialized', async () => {
      mockDatabaseManager.query.mockResolvedValue({ rows: [] });
      await databaseOptimizer.initialize();

      const status = await databaseOptimizer.getStatus();
      expect(status.initialized).toBe(true);
    });

    it('should indicate missing database manager', async () => {
      const optimizer = new DatabaseOptimizer({});
      const status = await optimizer.getStatus();
      expect(status.databaseManager).toBe('missing');
    });
  });

  describe('shutdown', () => {
    it('should shutdown gracefully', async () => {
      mockDatabaseManager.query.mockResolvedValue({ rows: [] });
      await databaseOptimizer.initialize();
      
      await databaseOptimizer.shutdown();
      expect(databaseOptimizer.isInitialized).toBe(false);
    });

    it('should handle shutdown when not initialized', async () => {
      await expect(databaseOptimizer.shutdown()).resolves.not.toThrow();
    });
  });

  describe('cache key generation', () => {
    beforeEach(async () => {
      mockDatabaseManager.query.mockResolvedValue({ rows: [] });
      await databaseOptimizer.initialize();
    });

    it('should generate consistent cache keys', () => {
      const key1 = databaseOptimizer.generateCacheKey('vector', [0.1, 0.2], {}, { userId: 'user1' }, 10);
      const key2 = databaseOptimizer.generateCacheKey('vector', [0.1, 0.2], {}, { userId: 'user1' }, 10);
      
      expect(key1).toBe(key2);
    });

    it('should generate different keys for different parameters', () => {
      const key1 = databaseOptimizer.generateCacheKey('vector', [0.1, 0.2], {}, { userId: 'user1' }, 10);
      const key2 = databaseOptimizer.generateCacheKey('vector', [0.1, 0.3], {}, { userId: 'user1' }, 10);
      
      expect(key1).not.toBe(key2);
    });
  });
});