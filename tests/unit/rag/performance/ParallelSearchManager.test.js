/**
 * Unit tests for ParallelSearchManager
 */

const ParallelSearchManager = require('../../../../src/rag/performance/ParallelSearchManager');

describe('ParallelSearchManager', () => {
  let parallelSearchManager;
  let mockDocumentRetriever;

  beforeEach(() => {
    jest.useFakeTimers();
    
    mockDocumentRetriever = {
      generateQueryEmbedding: jest.fn(),
      performVectorSearch: jest.fn(),
      performKeywordSearch: jest.fn(),
      combineResults: jest.fn(),
      applyVisibilityFiltering: jest.fn(),
      enrichDocument: jest.fn(),
      maxResults: 10
    };

    parallelSearchManager = new ParallelSearchManager({
      documentRetriever: mockDocumentRetriever,
      maxConcurrency: 3,
      timeoutMs: 1000
    });
  });

  afterEach(async () => {
    jest.useRealTimers();
    if (parallelSearchManager.isInitialized) {
      await parallelSearchManager.shutdown();
    }
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with default options', () => {
      const manager = new ParallelSearchManager({
        documentRetriever: mockDocumentRetriever
      });

      expect(manager.documentRetriever).toBe(mockDocumentRetriever);
      expect(manager.maxConcurrency).toBe(3);
      expect(manager.timeoutMs).toBe(5000);
      expect(manager.isInitialized).toBe(false);
    });

    it('should initialize with custom options', () => {
      const manager = new ParallelSearchManager({
        documentRetriever: mockDocumentRetriever,
        maxConcurrency: 5,
        timeoutMs: 10000
      });

      expect(manager.maxConcurrency).toBe(5);
      expect(manager.timeoutMs).toBe(10000);
    });
  });

  describe('initialize', () => {
    it('should initialize successfully', async () => {
      await parallelSearchManager.initialize();
      expect(parallelSearchManager.isInitialized).toBe(true);
    });

    it('should throw error if document retriever is missing', async () => {
      const manager = new ParallelSearchManager({});
      await expect(manager.initialize()).rejects.toThrow('Document retriever is required');
    });
  });

  describe('performParallelSearch', () => {
    beforeEach(async () => {
      await parallelSearchManager.initialize();
    });

    it('should throw error if not initialized', async () => {
      const manager = new ParallelSearchManager({
        documentRetriever: mockDocumentRetriever
      });

      await expect(
        manager.performParallelSearch('test query', {}, { userId: 'user1' })
      ).rejects.toThrow('Parallel Search Manager not initialized');
    });

    it('should throw error for invalid query', async () => {
      await expect(
        parallelSearchManager.performParallelSearch('', {}, { userId: 'user1' })
      ).rejects.toThrow('Query is required');

      await expect(
        parallelSearchManager.performParallelSearch(null, {}, { userId: 'user1' })
      ).rejects.toThrow('Query is required');
    });

    it('should throw error for missing user auth', async () => {
      await expect(
        parallelSearchManager.performParallelSearch('test query', {}, null)
      ).rejects.toThrow('User authentication is required');

      await expect(
        parallelSearchManager.performParallelSearch('test query', {}, {})
      ).rejects.toThrow('User authentication is required');
    });

    it('should perform parallel search successfully', async () => {
      const query = 'test query';
      const filters = { category: 'test' };
      const userAuth = { userId: 'user1', groupIds: ['group1'] };

      const mockEmbedding = [0.1, 0.2, 0.3];
      const mockVectorResults = [{ id: '1', title: 'Vector Doc 1' }];
      const mockKeywordResults = [{ id: '2', title: 'Keyword Doc 1' }];
      const mockCombinedResults = [
        { id: '1', title: 'Vector Doc 1' },
        { id: '2', title: 'Keyword Doc 1' }
      ];
      const mockVisibleResults = [{ id: '1', title: 'Vector Doc 1' }];
      const mockEnrichedDoc = { id: '1', title: 'Vector Doc 1', enriched: true };

      mockDocumentRetriever.generateQueryEmbedding.mockResolvedValue(mockEmbedding);
      mockDocumentRetriever.performVectorSearch.mockResolvedValue(mockVectorResults);
      mockDocumentRetriever.performKeywordSearch.mockResolvedValue(mockKeywordResults);
      mockDocumentRetriever.combineResults.mockResolvedValue(mockCombinedResults);
      mockDocumentRetriever.applyVisibilityFiltering.mockResolvedValue(mockVisibleResults);
      mockDocumentRetriever.enrichDocument.mockReturnValue(mockEnrichedDoc);

      const results = await parallelSearchManager.performParallelSearch(query, filters, userAuth);

      expect(results).toEqual([mockEnrichedDoc]);
      expect(mockDocumentRetriever.generateQueryEmbedding).toHaveBeenCalledWith(query);
      expect(mockDocumentRetriever.performVectorSearch).toHaveBeenCalledWith(mockEmbedding, filters, userAuth);
      expect(mockDocumentRetriever.performKeywordSearch).toHaveBeenCalledWith(query, filters, userAuth);
      expect(mockDocumentRetriever.combineResults).toHaveBeenCalledWith(mockVectorResults, mockKeywordResults);
      expect(mockDocumentRetriever.applyVisibilityFiltering).toHaveBeenCalledWith(mockCombinedResults, userAuth);
      expect(mockDocumentRetriever.enrichDocument).toHaveBeenCalledWith(mockVisibleResults[0], query);
    });

    it('should handle embedding generation failure gracefully', async () => {
      const query = 'test query';
      const userAuth = { userId: 'user1' };

      const mockKeywordResults = [{ id: '2', title: 'Keyword Doc 1' }];
      const mockCombinedResults = [{ id: '2', title: 'Keyword Doc 1' }];
      const mockVisibleResults = [{ id: '2', title: 'Keyword Doc 1' }];
      const mockEnrichedDoc = { id: '2', title: 'Keyword Doc 1', enriched: true };

      mockDocumentRetriever.generateQueryEmbedding.mockRejectedValue(new Error('Embedding failed'));
      mockDocumentRetriever.performKeywordSearch.mockResolvedValue(mockKeywordResults);
      mockDocumentRetriever.combineResults.mockResolvedValue(mockCombinedResults);
      mockDocumentRetriever.applyVisibilityFiltering.mockResolvedValue(mockVisibleResults);
      mockDocumentRetriever.enrichDocument.mockReturnValue(mockEnrichedDoc);

      const results = await parallelSearchManager.performParallelSearch(query, {}, userAuth);

      expect(results).toEqual([mockEnrichedDoc]);
      expect(mockDocumentRetriever.performVectorSearch).not.toHaveBeenCalled();
      expect(mockDocumentRetriever.combineResults).toHaveBeenCalledWith([], mockKeywordResults);
    });

    it('should handle vector search failure gracefully', async () => {
      const query = 'test query';
      const userAuth = { userId: 'user1' };

      const mockEmbedding = [0.1, 0.2, 0.3];
      const mockKeywordResults = [{ id: '2', title: 'Keyword Doc 1' }];
      const mockCombinedResults = [{ id: '2', title: 'Keyword Doc 1' }];
      const mockVisibleResults = [{ id: '2', title: 'Keyword Doc 1' }];
      const mockEnrichedDoc = { id: '2', title: 'Keyword Doc 1', enriched: true };

      mockDocumentRetriever.generateQueryEmbedding.mockResolvedValue(mockEmbedding);
      mockDocumentRetriever.performVectorSearch.mockRejectedValue(new Error('Vector search failed'));
      mockDocumentRetriever.performKeywordSearch.mockResolvedValue(mockKeywordResults);
      mockDocumentRetriever.combineResults.mockResolvedValue(mockCombinedResults);
      mockDocumentRetriever.applyVisibilityFiltering.mockResolvedValue(mockVisibleResults);
      mockDocumentRetriever.enrichDocument.mockReturnValue(mockEnrichedDoc);

      const results = await parallelSearchManager.performParallelSearch(query, {}, userAuth);

      expect(results).toEqual([mockEnrichedDoc]);
      expect(mockDocumentRetriever.combineResults).toHaveBeenCalledWith([], mockKeywordResults);
    });

    it('should respect custom limit from filters', async () => {
      const query = 'test query';
      const filters = { limit: 5 };
      const userAuth = { userId: 'user1' };

      const mockEmbedding = [0.1, 0.2, 0.3];
      const mockVectorResults = [];
      const mockKeywordResults = [];
      const mockCombinedResults = [];
      const mockVisibleResults = Array.from({ length: 10 }, (_, i) => ({ id: i.toString(), title: `Doc ${i}` }));

      mockDocumentRetriever.generateQueryEmbedding.mockResolvedValue(mockEmbedding);
      mockDocumentRetriever.performVectorSearch.mockResolvedValue(mockVectorResults);
      mockDocumentRetriever.performKeywordSearch.mockResolvedValue(mockKeywordResults);
      mockDocumentRetriever.combineResults.mockResolvedValue(mockCombinedResults);
      mockDocumentRetriever.applyVisibilityFiltering.mockResolvedValue(mockVisibleResults);
      mockDocumentRetriever.enrichDocument.mockImplementation(doc => ({ ...doc, enriched: true }));

      const results = await parallelSearchManager.performParallelSearch(query, filters, userAuth);

      expect(results).toHaveLength(5);
    });

    it('should handle timeout during parallel search', async () => {
      await parallelSearchManager.initialize();

      const query = 'test query';
      const filters = {};
      const userAuth = { userId: 'user1' };

      // Mock methods to never resolve (simulate timeout)
      mockDocumentRetriever.generateQueryEmbedding.mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );
      mockDocumentRetriever.performKeywordSearch.mockResolvedValue([
        { id: 'doc1', title: 'Document 1', score: 0.8 }
      ]);
      mockDocumentRetriever.combineResults.mockResolvedValue([
        { id: 'doc1', title: 'Document 1', score: 0.8 }
      ]);
      mockDocumentRetriever.applyVisibilityFiltering.mockResolvedValue([
        { id: 'doc1', title: 'Document 1', score: 0.8 }
      ]);
      mockDocumentRetriever.enrichDocument.mockReturnValue(
        { id: 'doc1', title: 'Document 1', score: 0.8, enriched: true }
      );

      // Start the parallel search
      const searchPromise = parallelSearchManager.performParallelSearch(query, filters, userAuth);
      
      // Fast-forward time to trigger timeout
      jest.advanceTimersByTime(1000);
      
      const results = await searchPromise;

      // Should fall back to keyword-only search
      expect(results).toEqual([
        { id: 'doc1', title: 'Document 1', score: 0.8, enriched: true }
      ]);
      expect(mockDocumentRetriever.performKeywordSearch).toHaveBeenCalled();
    });

    it('should handle embedding generation timeout', async () => {
      await parallelSearchManager.initialize();

      const query = 'test query';
      const filters = {};
      const userAuth = { userId: 'user1' };

      // Mock embedding generation to timeout
      mockDocumentRetriever.generateQueryEmbedding.mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );
      mockDocumentRetriever.performKeywordSearch.mockResolvedValue([
        { id: 'doc1', title: 'Document 1', score: 0.8 }
      ]);
      mockDocumentRetriever.combineResults.mockResolvedValue([
        { id: 'doc1', title: 'Document 1', score: 0.8 }
      ]);
      mockDocumentRetriever.applyVisibilityFiltering.mockResolvedValue([
        { id: 'doc1', title: 'Document 1', score: 0.8 }
      ]);
      mockDocumentRetriever.enrichDocument.mockReturnValue(
        { id: 'doc1', title: 'Document 1', score: 0.8, enriched: true }
      );

      // Start the search
      const searchPromise = parallelSearchManager.performParallelSearch(query, filters, userAuth);
      
      // Fast-forward time to trigger timeout
      jest.advanceTimersByTime(1000);
      
      const results = await searchPromise;

      // Should fall back to keyword search only
      expect(results).toEqual([
        { id: 'doc1', title: 'Document 1', score: 0.8, enriched: true }
      ]);
    });

    it('should handle vector search timeout', async () => {
      await parallelSearchManager.initialize();

      const query = 'test query';
      const filters = {};
      const userAuth = { userId: 'user1' };

      // Mock embedding generation to succeed
      mockDocumentRetriever.generateQueryEmbedding.mockResolvedValue([0.1, 0.2, 0.3]);
      
      // Mock vector search to throw timeout error
      mockDocumentRetriever.performVectorSearch.mockRejectedValue(new Error('Vector search timeout'));
      
      // Mock keyword search to succeed
      mockDocumentRetriever.performKeywordSearch.mockResolvedValue([
        { id: 'doc1', title: 'Document 1', score: 0.8 }
      ]);
      mockDocumentRetriever.combineResults.mockResolvedValue([
        { id: 'doc1', title: 'Document 1', score: 0.8 }
      ]);
      mockDocumentRetriever.applyVisibilityFiltering.mockResolvedValue([
        { id: 'doc1', title: 'Document 1', score: 0.8 }
      ]);
      mockDocumentRetriever.enrichDocument.mockReturnValue(
        { id: 'doc1', title: 'Document 1', score: 0.8, enriched: true }
      );

      const results = await parallelSearchManager.performParallelSearch(query, filters, userAuth);

      // Should still get keyword results even when vector search times out
      expect(results).toBeDefined();
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('doc1');
    });
  });

  describe('calculateParallelEfficiency', () => {
    it('should calculate efficiency correctly', () => {
      const efficiency = parallelSearchManager.calculateParallelEfficiency(5, 3, 1000);
      expect(efficiency).toBeGreaterThan(0);
      expect(efficiency).toBeLessThanOrEqual(1);
    });

    it('should handle zero results', () => {
      const efficiency = parallelSearchManager.calculateParallelEfficiency(0, 0, 1000);
      expect(efficiency).toBe(0);
    });
  });

  describe('getPerformanceStats', () => {
    it('should return performance statistics', () => {
      const stats = parallelSearchManager.getPerformanceStats();
      expect(stats).toEqual({
        maxConcurrency: 3,
        timeoutMs: 1000,
        isInitialized: false
      });
    });
  });

  describe('getStatus', () => {
    it('should return status information', async () => {
      const status = await parallelSearchManager.getStatus();
      expect(status).toEqual({
        initialized: false,
        maxConcurrency: 3,
        timeoutMs: 1000,
        documentRetriever: 'available'
      });
    });

    it('should indicate missing document retriever', async () => {
      const manager = new ParallelSearchManager({});
      const status = await manager.getStatus();
      expect(status.documentRetriever).toBe('missing');
    });
  });
});