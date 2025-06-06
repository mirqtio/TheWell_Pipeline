/**
 * Unit tests for SearchService
 */

const SearchService = require('../../../src/services/SearchService');
const IntelligentSearchEngine = require('../../../src/search/IntelligentSearchEngine');
const EmbeddingService = require('../../../src/enrichment/EmbeddingService');
const CacheManager = require('../../../src/cache/CacheManager');

// Mock dependencies
jest.mock('../../../src/search/IntelligentSearchEngine');
jest.mock('../../../src/enrichment/EmbeddingService');
jest.mock('../../../src/cache/CacheManager');
jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn()
}));

describe('SearchService', () => {
  let searchService;
  let mockPool;
  let mockSearchEngine;
  let mockEmbeddingService;
  let mockCacheManager;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Mock database pool
    mockPool = {
      query: jest.fn(),
      end: jest.fn()
    };

    // Mock search engine
    mockSearchEngine = {
      initialize: jest.fn().mockResolvedValue(true),
      search: jest.fn(),
      getSuggestions: jest.fn(),
      shutdown: jest.fn().mockResolvedValue(true)
    };
    IntelligentSearchEngine.mockImplementation(() => mockSearchEngine);

    // Mock embedding service
    mockEmbeddingService = {
      generateEmbedding: jest.fn(),
      config: { model: 'text-embedding-3-small' }
    };
    EmbeddingService.mockImplementation(() => mockEmbeddingService);

    // Mock cache manager
    mockCacheManager = {
      initialize: jest.fn().mockResolvedValue(true),
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(true),
      healthCheck: jest.fn().mockResolvedValue({ status: 'healthy' }),
      shutdown: jest.fn().mockResolvedValue(true)
    };
    CacheManager.mockImplementation(() => mockCacheManager);

    // Create search service instance
    searchService = new SearchService({
      database: {},
      embedding: { apiKey: 'test-key' },
      cache: {},
      analytics: { enabled: true }
    });

    // Override pool creation
    searchService.pool = mockPool;
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('initialize', () => {
    it('should initialize all components successfully', async () => {
      await searchService.initialize();

      expect(searchService.isInitialized).toBe(true);
      expect(mockCacheManager.initialize).toHaveBeenCalled();
      expect(mockSearchEngine.initialize).toHaveBeenCalled();
      expect(EmbeddingService).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'test-key' }));
    });

    it('should start analytics processor when enabled', async () => {
      await searchService.initialize();

      expect(searchService.analyticsTimer).toBeDefined();
    });

    it('should start index update processor', async () => {
      await searchService.initialize();

      expect(searchService.indexUpdateTimer).toBeDefined();
    });

    it('should handle initialization errors', async () => {
      mockCacheManager.initialize.mockRejectedValue(new Error('Cache init failed'));

      await expect(searchService.initialize()).rejects.toThrow('Cache init failed');
      expect(searchService.isInitialized).toBe(false);
    });
  });

  describe('search', () => {
    beforeEach(async () => {
      await searchService.initialize();
    });

    it('should perform search using search engine', async () => {
      const mockResults = {
        items: [{ id: '1', title: 'Test Result' }],
        total: 1,
        mode: 'hybrid'
      };
      mockSearchEngine.search.mockResolvedValue(mockResults);

      const results = await searchService.search('test query', {
        mode: 'hybrid',
        userId: 'user123'
      });

      expect(results).toEqual(mockResults);
      expect(mockSearchEngine.search).toHaveBeenCalledWith('test query', expect.any(Object));
    });

    it('should track search interaction when userId provided', async () => {
      const mockResults = { items: [], total: 0 };
      mockSearchEngine.search.mockResolvedValue(mockResults);

      await searchService.search('test query', { userId: 'user123' });

      expect(searchService.analyticsQueue).toHaveLength(1);
      expect(searchService.analyticsQueue[0]).toMatchObject({
        userId: 'user123',
        query: 'test query',
        resultCount: 0
      });
    });

    it('should throw error if service not initialized', async () => {
      searchService.isInitialized = false;

      await expect(
        searchService.search('test query')
      ).rejects.toThrow('SearchService not initialized');
    });
  });

  describe('getSuggestions', () => {
    beforeEach(async () => {
      await searchService.initialize();
    });

    it('should return cached suggestions if available', async () => {
      const cachedSuggestions = [
        { suggestion_text: 'cached suggestion', relevance_score: 0.9 }
      ];
      mockCacheManager.get.mockResolvedValue(cachedSuggestions);

      const suggestions = await searchService.getSuggestions('test');

      expect(suggestions).toEqual(cachedSuggestions);
      expect(mockSearchEngine.getSuggestions).not.toHaveBeenCalled();
    });

    it('should get suggestions from search engine and cache them', async () => {
      const mockSuggestions = [
        { suggestion_text: 'test suggestion', relevance_score: 0.8 }
      ];
      mockSearchEngine.getSuggestions.mockResolvedValue(mockSuggestions);

      const suggestions = await searchService.getSuggestions('test', { limit: 5 });

      expect(suggestions).toEqual(mockSuggestions);
      expect(mockSearchEngine.getSuggestions).toHaveBeenCalledWith('test', 5);
      expect(mockCacheManager.set).toHaveBeenCalledWith(
        'suggestions:test:5',
        mockSuggestions,
        { ttl: 300 }
      );
    });

    it('should handle errors gracefully', async () => {
      mockSearchEngine.getSuggestions.mockRejectedValue(new Error('Suggestions failed'));

      const suggestions = await searchService.getSuggestions('test');

      expect(suggestions).toEqual([]);
    });
  });

  describe('indexDocument', () => {
    beforeEach(async () => {
      await searchService.initialize();
    });

    it('should index document with embeddings', async () => {
      const document = {
        title: 'Test Document',
        content: 'Test content',
        summary: 'Test summary',
        author: 'John Doe',
        tags: ['test', 'document'],
        published_at: '2024-01-01',
        quality_score: 0.8
      };

      const mockEmbedding = new Array(1536).fill(0.1);
      mockEmbeddingService.generateEmbedding.mockResolvedValue(mockEmbedding);
      mockPool.query.mockResolvedValue({ rowCount: 1 });

      await searchService.indexDocument('doc123', document);

      expect(mockEmbeddingService.generateEmbedding).toHaveBeenCalled();
      expect(mockPool.query).toHaveBeenCalledTimes(2); // Index insert + embedding update
    });

    it('should index document without embeddings if service not available', async () => {
      searchService.embeddingService = null;
      const document = {
        title: 'Test Document',
        content: 'Test content'
      };

      mockPool.query.mockResolvedValue({ rowCount: 1 });

      await searchService.indexDocument('doc123', document);

      expect(mockPool.query).toHaveBeenCalledTimes(1); // Only index insert
    });

    it('should handle indexing errors', async () => {
      mockPool.query.mockRejectedValue(new Error('DB error'));

      await expect(
        searchService.indexDocument('doc123', { title: 'Test' })
      ).rejects.toThrow('DB error');
    });
  });

  describe('batchIndexDocuments', () => {
    beforeEach(async () => {
      await searchService.initialize();
    });

    it('should batch index documents', async () => {
      const documents = [
        { id: '1', title: 'Doc 1', content: 'Content 1' },
        { id: '2', title: 'Doc 2', content: 'Content 2' },
        { id: '3', title: 'Doc 3', content: 'Content 3' }
      ];

      searchService.indexDocument = jest.fn().mockResolvedValue(true);

      const results = await searchService.batchIndexDocuments(documents);

      expect(results.total).toBe(3);
      expect(results.successful).toBe(3);
      expect(results.failed).toBe(0);
      expect(searchService.indexDocument).toHaveBeenCalledTimes(3);
    });

    it('should handle partial failures', async () => {
      const documents = [
        { id: '1', title: 'Doc 1' },
        { id: '2', title: 'Doc 2' },
        { id: '3', title: 'Doc 3' }
      ];

      searchService.indexDocument = jest.fn()
        .mockResolvedValueOnce(true)
        .mockRejectedValueOnce(new Error('Index failed'))
        .mockResolvedValueOnce(true);

      const results = await searchService.batchIndexDocuments(documents);

      expect(results.total).toBe(3);
      expect(results.successful).toBe(2);
      expect(results.failed).toBe(1);
    });
  });

  describe('updateSearchAnalytics', () => {
    beforeEach(async () => {
      await searchService.initialize();
    });

    it('should update search analytics for current hour', async () => {
      const mockAnalytics = {
        total_queries: '100',
        unique_users: '50',
        avg_query_length: '15.5',
        avg_execution_time: '150.2',
        avg_result_count: '20.3',
        zero_result_queries: '5'
      };

      const mockPopularQueries = [
        { query_text: 'popular query', count: '10', avg_results: '15' }
      ];

      mockPool.query
        .mockResolvedValueOnce({ rows: [mockAnalytics] })
        .mockResolvedValueOnce({ rows: mockPopularQueries })
        .mockResolvedValueOnce({ rowCount: 1 });

      await searchService.updateSearchAnalytics();

      expect(mockPool.query).toHaveBeenCalledTimes(3);
      const updateCall = mockPool.query.mock.calls[2];
      expect(updateCall[0]).toContain('INSERT INTO search_analytics');
    });

    it('should handle analytics update errors', async () => {
      mockPool.query.mockRejectedValue(new Error('Analytics error'));

      // Should not throw, just log error
      await expect(searchService.updateSearchAnalytics()).resolves.not.toThrow();
    });
  });

  describe('updateSearchFacets', () => {
    beforeEach(async () => {
      await searchService.initialize();
    });

    it('should update all facet types', async () => {
      const mockFacetData = [
        { value: 'text/html', count: '100' },
        { value: 'text/plain', count: '80' }
      ];

      mockPool.query
        .mockResolvedValueOnce({ rows: mockFacetData }) // content_type
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockResolvedValueOnce({ rows: [] }) // author
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockResolvedValueOnce({ rows: [] }) // tags
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockResolvedValueOnce({ rows: [] }) // quality
        .mockResolvedValueOnce({ rowCount: 1 });

      await searchService.updateSearchFacets();

      // Should update 4 facet types
      expect(mockPool.query).toHaveBeenCalledTimes(8); // 4 selects + 4 updates
    });
  });

  describe('trackSearchClick', () => {
    beforeEach(async () => {
      await searchService.initialize();
    });

    it('should track search result click', async () => {
      mockPool.query.mockResolvedValue({ rowCount: 1 });

      const result = await searchService.trackSearchClick('query123', 'doc456', 'user789');

      expect(result).toBe(true);
      expect(mockPool.query).toHaveBeenCalledTimes(2); // Update query + update popularity
    });

    it('should handle tracking errors', async () => {
      mockPool.query.mockRejectedValue(new Error('Track error'));

      const result = await searchService.trackSearchClick('query123', 'doc456', 'user789');

      expect(result).toBe(false);
    });
  });

  describe('getSearchAnalytics', () => {
    beforeEach(async () => {
      await searchService.initialize();
    });

    it('should get analytics by day', async () => {
      const mockAnalytics = [
        { date: '2024-01-01', total_queries: '500', unique_users: '100' },
        { date: '2024-01-02', total_queries: '600', unique_users: '120' }
      ];

      mockPool.query.mockResolvedValue({ rows: mockAnalytics });

      const analytics = await searchService.getSearchAnalytics({
        startDate: '2024-01-01',
        endDate: '2024-01-02',
        groupBy: 'day'
      });

      expect(analytics).toEqual(mockAnalytics);
      const queryCall = mockPool.query.mock.calls[0];
      expect(queryCall[0]).toContain('GROUP BY date');
    });

    it('should get analytics by hour', async () => {
      const mockAnalytics = [
        { date: '2024-01-01', hour: 10, total_queries: '50' }
      ];

      mockPool.query.mockResolvedValue({ rows: mockAnalytics });

      const analytics = await searchService.getSearchAnalytics({
        groupBy: 'hour'
      });

      expect(analytics).toEqual(mockAnalytics);
      const queryCall = mockPool.query.mock.calls[0];
      expect(queryCall[0]).not.toContain('GROUP BY');
    });
  });

  describe('analytics processing', () => {
    beforeEach(async () => {
      await searchService.initialize();
    });

    it('should flush analytics when batch size reached', async () => {
      searchService.config.analytics.batchSize = 2;
      searchService.flushAnalytics = jest.fn();

      searchService.trackSearchInteraction({ userId: '1', query: 'test1' });
      expect(searchService.flushAnalytics).not.toHaveBeenCalled();

      searchService.trackSearchInteraction({ userId: '2', query: 'test2' });
      expect(searchService.flushAnalytics).toHaveBeenCalled();
    });

    it('should periodically flush analytics', async () => {
      searchService.flushAnalytics = jest.fn();
      searchService.updateSearchAnalytics = jest.fn();

      jest.advanceTimersByTime(searchService.config.analytics.flushInterval);

      expect(searchService.flushAnalytics).toHaveBeenCalled();
      expect(searchService.updateSearchAnalytics).toHaveBeenCalled();
    });
  });

  describe('getStatus', () => {
    beforeEach(async () => {
      await searchService.initialize();
    });

    it('should return service status', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      const status = await searchService.getStatus();

      expect(status).toMatchObject({
        initialized: true,
        searchEngine: 'ready',
        embeddingService: 'ready',
        database: 'connected',
        analytics: {
          enabled: true,
          queueSize: 0
        }
      });
    });

    it('should handle database connection error', async () => {
      mockPool.query.mockRejectedValue(new Error('DB error'));

      const status = await searchService.getStatus();

      expect(status.database).toBe('disconnected');
    });
  });

  describe('shutdown', () => {
    beforeEach(async () => {
      await searchService.initialize();
    });

    it('should clean up all resources', async () => {
      searchService.analyticsQueue = [{ test: 'data' }];
      searchService.flushAnalytics = jest.fn();

      await searchService.shutdown();

      expect(searchService.flushAnalytics).toHaveBeenCalled();
      expect(mockSearchEngine.shutdown).toHaveBeenCalled();
      expect(mockCacheManager.shutdown).toHaveBeenCalled();
      expect(mockPool.end).toHaveBeenCalled();
      expect(searchService.isInitialized).toBe(false);
    });

    it('should clear timers', async () => {
      const clearIntervalSpy = jest.spyOn(global, 'clearInterval');

      await searchService.shutdown();

      expect(clearIntervalSpy).toHaveBeenCalledTimes(2);
    });
  });
});