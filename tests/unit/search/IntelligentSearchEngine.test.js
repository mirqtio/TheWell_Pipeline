/**
 * Unit tests for IntelligentSearchEngine
 */

const IntelligentSearchEngine = require('../../../src/search/IntelligentSearchEngine');
const EmbeddingService = require('../../../src/enrichment/EmbeddingService');
const CacheManager = require('../../../src/cache/CacheManager');

// Mock dependencies
jest.mock('../../../src/enrichment/EmbeddingService');
jest.mock('../../../src/cache/CacheManager');
// Mock pg module - define outside describe block to be accessible
let mockPoolInstance;
jest.mock('pg', () => {
  return {
    Pool: jest.fn(() => mockPoolInstance)
  };
});
jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn()
}));

describe('IntelligentSearchEngine', () => {
  let searchEngine;
  let mockPool;
  let mockEmbeddingService;
  let mockCacheManager;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Mock database pool
    mockPool = {
      query: jest.fn().mockResolvedValue({ rows: [] }),
      end: jest.fn().mockResolvedValue(undefined),
      on: jest.fn()
    };
    
    // Set the mock pool instance for pg module to use
    mockPoolInstance = mockPool;

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
      shutdown: jest.fn().mockResolvedValue(true)
    };
    CacheManager.mockImplementation(() => mockCacheManager);

    // Create search engine instance
    searchEngine = new IntelligentSearchEngine({
      database: {},
      embeddingApiKey: 'test-key',
      cache: {}
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('initialize', () => {
    it('should initialize successfully with all components', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      await searchEngine.initialize();

      expect(searchEngine.isInitialized).toBe(true);
      expect(mockCacheManager.initialize).toHaveBeenCalled();
      expect(searchEngine.embeddingService).toBeDefined();
    });

    it('should initialize without embedding service if no API key provided', async () => {
      searchEngine = new IntelligentSearchEngine({
        database: {},
        cache: {}
      });

      await searchEngine.initialize();

      expect(searchEngine.isInitialized).toBe(true);
      expect(searchEngine.embeddingService).toBeNull();
    });

    it('should load synonyms if synonym expansion is enabled', async () => {
      // Create a search engine with synonym expansion enabled
      const searchEngineWithSynonyms = new IntelligentSearchEngine({
        database: {},
        embeddingApiKey: 'test-key',
        cache: {},
        features: {
          enableSynonymExpansion: true
        }
      });
      // Pool will be created during initialize
      
      const synonymRows = [
        { term: 'ai', synonyms: ['artificial intelligence', 'machine learning'] },
        { term: 'db', synonyms: ['database', 'data store'] }
      ];
      mockPool.query.mockResolvedValue({ rows: synonymRows });

      await searchEngineWithSynonyms.initialize();

      expect(searchEngineWithSynonyms.synonymCache.size).toBe(2);
      expect(searchEngineWithSynonyms.synonymCache.get('ai')).toEqual(['artificial intelligence', 'machine learning']);
    });
  });

  describe('search', () => {
    beforeEach(async () => {
      await searchEngine.initialize();
    });

    it('should perform hybrid search by default', async () => {
      const mockResults = [
        {
          id: '1',
          title: 'Test Document',
          content: 'Test content',
          url: 'https://test.com/doc1',
          author: 'Test Author',
          published_at: new Date(),
          metadata: {},
          quality_score: 0.8,
          believability_score: 0.9,
          relevance_score: 0.9
        }
      ];

      mockEmbeddingService.generateEmbedding.mockResolvedValue(new Array(1536).fill(0));
      mockPool.query.mockResolvedValue({ rows: mockResults });

      const results = await searchEngine.search('test query');

      expect(results.mode).toBe('hybrid');
      expect(results.items).toHaveLength(1);
      expect(mockEmbeddingService.generateEmbedding).toHaveBeenCalledWith('test query');
    });

    it('should use cache when available', async () => {
      const cachedResults = {
        items: [{ id: '1', title: 'Cached Result' }],
        total: 1,
        mode: 'hybrid'
      };
      mockCacheManager.get.mockResolvedValue(cachedResults);
      
      // Reset query mock after initialization
      mockPool.query.mockClear();

      const results = await searchEngine.search('cached query');

      expect(results).toEqual(cachedResults);
      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it('should perform exact search when mode is specified', async () => {
      const mockResults = [
        {
          id: '2',
          title: 'Exact Match',
          content: 'Exact content match',
          url: 'https://test.com/doc2',
          author: 'Test Author',
          published_at: new Date(),
          metadata: {},
          quality_score: 1.0,
          believability_score: 1.0,
          relevance_score: 1.0
        }
      ];
      mockPool.query.mockResolvedValue({ rows: mockResults });

      const results = await searchEngine.search('exact match', { mode: 'exact' });

      expect(results.mode).toBe('exact');
      expect(results.items).toHaveLength(1);
      expect(results.items[0].title).toBe('Exact Match');
    });

    it('should apply filters correctly', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });
      
      // Clear mock after initialization
      mockPool.query.mockClear();

      await searchEngine.search('test', {
        filters: {
          author: 'John Doe',
          dateFrom: '2024-01-01',
          dateTo: '2024-12-31',
          visibility: 'public',
          minQuality: 0.7
        }
      });

      // Find the search query call (not the synonyms query)
      const searchQueryCall = mockPool.query.mock.calls.find(call => 
        call[0].includes('SELECT') && call[0].includes('FROM documents')
      );
      expect(searchQueryCall).toBeDefined();
      expect(searchQueryCall[0]).toContain('d.author ILIKE');
      expect(searchQueryCall[0]).toContain('d.published_at >=');
      expect(searchQueryCall[0]).toContain('d.published_at <=');
      expect(searchQueryCall[0]).toContain('d.visibility =');
      expect(searchQueryCall[0]).toContain('d.quality_score >=');
    });

    it('should handle pagination correctly', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });
      
      // Clear mock after initialization
      mockPool.query.mockClear();

      await searchEngine.search('test', {
        limit: 50,
        offset: 100
      });

      // Find the search query call
      const searchQueryCall = mockPool.query.mock.calls.find(call => 
        call[0].includes('SELECT') && call[0].includes('FROM documents')
      );
      expect(searchQueryCall).toBeDefined();
      expect(searchQueryCall[0]).toContain('LIMIT');
      expect(searchQueryCall[0]).toContain('OFFSET');
      expect(searchQueryCall[1]).toContain(50);
      expect(searchQueryCall[1]).toContain(100);
    });
  });

  describe('semanticSearch', () => {
    beforeEach(async () => {
      await searchEngine.initialize();
    });

    it('should generate embedding and search by similarity', async () => {
      const mockEmbedding = new Array(1536).fill(0.1);
      mockEmbeddingService.generateEmbedding.mockResolvedValue(mockEmbedding);

      const mockResults = [
        {
          id: '3',
          title: 'Semantic Result',
          content: 'Semantic content',
          url: 'https://test.com/doc3',
          author: 'Test Author',
          published_at: new Date(),
          metadata: {},
          quality_score: 0.8,
          believability_score: 0.8,
          similarity_score: 0.85
        }
      ];
      mockPool.query.mockResolvedValue({ rows: mockResults });

      const results = await searchEngine.semanticSearch({
        query: 'semantic test',
        filters: {},
        limit: 10,
        offset: 0,
        sort: { field: 'relevance', order: 'desc' }
      });

      expect(mockEmbeddingService.generateEmbedding).toHaveBeenCalledWith('semantic test');
      expect(results.items).toHaveLength(1);
      expect(results.mode).toBe('semantic');
    });

    it('should throw error if embedding service is not configured', async () => {
      searchEngine.embeddingService = null;

      await expect(
        searchEngine.semanticSearch({ query: 'test' })
      ).rejects.toThrow('Semantic search requires embedding service configuration');
    });
  });

  describe('fuzzySearch', () => {
    beforeEach(async () => {
      await searchEngine.initialize();
    });

    it('should use trigram similarity for fuzzy matching', async () => {
      const mockResults = [
        {
          id: '4',
          title: 'Fuzzy Match',
          content: 'Fuzzy content',
          url: 'https://test.com/doc4',
          author: 'Test Author',
          published_at: new Date(),
          metadata: {},
          quality_score: 0.7,
          believability_score: 0.7,
          similarity: 0.8
        }
      ];
      mockPool.query.mockResolvedValue({ rows: mockResults });

      const results = await searchEngine.fuzzySearch({
        normalizedQuery: 'fuzy match',
        filters: {},
        limit: 10,
        offset: 0,
        sort: { field: 'relevance', order: 'desc' }
      });

      // Find the fuzzy search query call (not the synonyms query)
      const fuzzyQueryCall = mockPool.query.mock.calls.find(call => 
        call[0].includes('similarity(') || call[0].includes('fuzzy_search')
      );
      expect(fuzzyQueryCall).toBeDefined();
      expect(fuzzyQueryCall[0]).toContain('similarity(');
      expect(fuzzyQueryCall[0]).toContain('%');
      expect(results.items).toHaveLength(1);
      expect(results.mode).toBe('fuzzy');
    });
  });

  describe('query expansion', () => {
    beforeEach(async () => {
      searchEngine.synonymCache.set('ai', ['artificial intelligence', 'machine learning']);
      searchEngine.synonymCache.set('fast', ['quick', 'rapid', 'speedy']);
    });

    it('should expand query with synonyms', () => {
      const expanded = searchEngine.expandQueryWithSynonyms('ai is fast');

      expect(expanded).toContain('ai');
      expect(expanded).toContain('artificial intelligence');
      expect(expanded).toContain('machine learning');
      expect(expanded).toContain('fast');
      expect(expanded).toContain('quick');
      expect(expanded).toContain('rapid');
    });

    it('should handle queries without synonyms', () => {
      const expanded = searchEngine.expandQueryWithSynonyms('unique term');

      expect(expanded).toBe('unique term');
    });
  });

  describe('result merging', () => {
    it('should merge semantic and keyword results correctly', () => {
      const semanticResults = [
        { id: '1', title: 'Doc 1', content: 'Content 1', relevance_score: 0.9 },
        { id: '2', title: 'Doc 2', content: 'Content 2', relevance_score: 0.8 }
      ];

      const keywordResults = [
        { id: '2', title: 'Doc 2', content: 'Content 2', relevance_score: 0.7, highlighted_title: '<mark>Doc 2</mark>' },
        { id: '3', title: 'Doc 3', content: 'Content 3', relevance_score: 0.6 }
      ];

      const merged = searchEngine.mergeSearchResults(semanticResults, keywordResults, {
        semanticWeight: 0.6,
        keywordWeight: 0.4
      });

      expect(merged).toHaveLength(3);
      expect(merged[0].id).toBe('2'); // Should be first due to combined score
      expect(merged[0].finalScore).toBeCloseTo(0.76); // (0.8 * 0.6) + (0.7 * 0.4)
      expect(merged[0].highlighted_title).toBe('<mark>Doc 2</mark>');
    });
  });

  describe('getSuggestions', () => {
    beforeEach(async () => {
      await searchEngine.initialize();
    });

    it('should retrieve search suggestions', async () => {
      const mockSuggestions = [
        { suggestion_text: 'artificial intelligence', suggestion_type: 'query', relevance_score: 0.9 },
        { suggestion_text: 'artificial neural networks', suggestion_type: 'completion', relevance_score: 0.8 }
      ];
      
      // Clear mock after initialization
      mockPool.query.mockClear();
      mockPool.query.mockResolvedValue({ rows: mockSuggestions });

      const suggestions = await searchEngine.getSuggestions('artif', 5);

      expect(suggestions).toHaveLength(2);
      expect(suggestions[0].suggestion_text).toBe('artificial intelligence');
      const queryCall = mockPool.query.mock.calls[0];
      expect(queryCall[1]).toContain('artif%');
    });
  });

  describe('facet computation', () => {
    beforeEach(async () => {
      await searchEngine.initialize();
    });

    it('should compute facets for search results', async () => {
      const mockFacetRows = [
        { facet_type: 'author', facet_value: 'John Doe', count: '10' },
        { facet_type: 'author', facet_value: 'Jane Smith', count: '8' },
        { facet_type: 'tag', facet_value: 'technology', count: '15' },
        { facet_type: 'category', facet_value: 'Articles', count: '20' }
      ];
      mockPool.query.mockResolvedValue({ rows: mockFacetRows });

      const facets = await searchEngine.computeFacets({ filters: {} });

      expect(facets.author).toHaveLength(2);
      expect(facets.tag).toHaveLength(1);
      expect(facets.category).toHaveLength(1);
      expect(facets.author[0].value).toBe('John Doe');
      expect(facets.author[0].count).toBe(10);
    });
  });

  describe('analytics tracking', () => {
    beforeEach(async () => {
      await searchEngine.initialize();
    });

    it('should track search queries for analytics', async () => {
      await searchEngine.trackSearchQuery(
        {
          query: 'test query',
          normalizedQuery: 'test query',
          mode: 'hybrid',
          filters: {},
          sort: { field: 'relevance', order: 'desc' },
          userId: 'user123'
        },
        { items: [{ id: '1' }], total: 1 },
        150
      );

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO search_queries'),
        expect.arrayContaining(['user123', 'test query', 'hybrid'])
      );
    });
  });

  describe('cache key generation', () => {
    it('should generate consistent cache keys', () => {
      const params1 = {
        mode: 'hybrid',
        normalizedQuery: 'test query',
        filters: { author: 'John' },
        sort: { field: 'date', order: 'desc' },
        limit: 20,
        offset: 0
      };

      const params2 = {
        mode: 'hybrid',
        normalizedQuery: 'test query',
        filters: { author: 'John' },
        sort: { field: 'date', order: 'desc' },
        limit: 20,
        offset: 0
      };

      const key1 = searchEngine.generateCacheKey(params1);
      const key2 = searchEngine.generateCacheKey(params2);

      expect(key1).toBe(key2);
    });

    it('should generate different keys for different parameters', () => {
      const params1 = {
        mode: 'hybrid',
        normalizedQuery: 'test query',
        filters: {},
        sort: { field: 'date', order: 'desc' },
        limit: 20,
        offset: 0
      };

      const params2 = {
        mode: 'semantic',
        normalizedQuery: 'test query',
        filters: {},
        sort: { field: 'date', order: 'desc' },
        limit: 20,
        offset: 0
      };

      const key1 = searchEngine.generateCacheKey(params1);
      const key2 = searchEngine.generateCacheKey(params2);

      expect(key1).not.toBe(key2);
    });
  });

  describe('shutdown', () => {
    it('should clean up resources on shutdown', async () => {
      await searchEngine.initialize();

      await searchEngine.shutdown();

      expect(mockPool.end).toHaveBeenCalled();
      expect(mockCacheManager.shutdown).toHaveBeenCalled();
      expect(searchEngine.isInitialized).toBe(false);
    });
  });
});