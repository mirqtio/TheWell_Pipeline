/**
 * DocumentRetriever Unit Tests
 * Tests hybrid search functionality including vector and keyword search
 */

const DocumentRetriever = require('../../../src/rag/components/DocumentRetriever');
const EmbeddingService = require('../../../src/enrichment/EmbeddingService');

// Mock the EmbeddingService
jest.mock('../../../src/enrichment/EmbeddingService');

// Mock logger to prevent console output during tests
jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
}));

describe('DocumentRetriever', () => {
  let documentRetriever;
  let mockDatabaseManager;
  let mockVisibilityDatabase;
  let mockEmbeddingService;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Create mock database manager
    mockDatabaseManager = {
      query: jest.fn(),
      isInitialized: true
    };

    // Create mock visibility database
    mockVisibilityDatabase = {
      filterByVisibility: jest.fn(),
      isInitialized: true
    };

    // Create mock embedding service
    mockEmbeddingService = {
      generateEmbedding: jest.fn(),
      getEmbeddingDimensions: jest.fn().mockReturnValue(1536),
      isReady: jest.fn().mockReturnValue(true)
    };

    EmbeddingService.mockImplementation(() => mockEmbeddingService);
  });

  describe('Constructor', () => {
    it('should initialize with default options', () => {
      documentRetriever = new DocumentRetriever({
        databaseManager: mockDatabaseManager,
        visibilityDatabase: mockVisibilityDatabase
      });

      expect(documentRetriever.maxResults).toBe(10);
      expect(documentRetriever.similarityThreshold).toBe(0.7);
      expect(documentRetriever.embeddingService).toBeNull();
    });

    it('should initialize with embedding service when API key provided', () => {
      documentRetriever = new DocumentRetriever({
        databaseManager: mockDatabaseManager,
        visibilityDatabase: mockVisibilityDatabase,
        openaiApiKey: 'test-api-key'
      });

      expect(EmbeddingService).toHaveBeenCalledWith({
        apiKey: 'test-api-key',
        model: 'text-embedding-ada-002'
      });
      expect(documentRetriever.embeddingService).toBe(mockEmbeddingService);
    });

    it('should use custom embedding model when specified', () => {
      documentRetriever = new DocumentRetriever({
        databaseManager: mockDatabaseManager,
        visibilityDatabase: mockVisibilityDatabase,
        openaiApiKey: 'test-api-key',
        embeddingModel: 'text-embedding-3-small'
      });

      expect(EmbeddingService).toHaveBeenCalledWith({
        apiKey: 'test-api-key',
        model: 'text-embedding-3-small'
      });
    });
  });

  describe('Initialization', () => {
    beforeEach(() => {
      documentRetriever = new DocumentRetriever({
        databaseManager: mockDatabaseManager,
        visibilityDatabase: mockVisibilityDatabase
      });
    });

    it('should initialize successfully', async () => {
      await documentRetriever.initialize();
      expect(documentRetriever.isInitialized).toBe(true);
    });

    it('should throw error if database manager is missing', async () => {
      documentRetriever = new DocumentRetriever({
        visibilityDatabase: mockVisibilityDatabase
      });

      await expect(documentRetriever.initialize()).rejects.toThrow('Database manager is required');
    });
  });

  describe('Query Embedding Generation', () => {
    beforeEach(() => {
      documentRetriever = new DocumentRetriever({
        databaseManager: mockDatabaseManager,
        visibilityDatabase: mockVisibilityDatabase,
        openaiApiKey: 'test-api-key'
      });
    });

    it('should generate real embeddings when service is available', async () => {
      const mockEmbedding = new Array(1536).fill(0.1);
      mockEmbeddingService.generateEmbedding.mockResolvedValue(mockEmbedding);

      const result = await documentRetriever.generateQueryEmbedding('test query');

      expect(mockEmbeddingService.generateEmbedding).toHaveBeenCalledWith('test query');
      expect(result).toEqual(mockEmbedding);
    });

    it('should fall back to mock embeddings when service is not available', async () => {
      documentRetriever = new DocumentRetriever({
        databaseManager: mockDatabaseManager,
        visibilityDatabase: mockVisibilityDatabase
      });

      const result = await documentRetriever.generateQueryEmbedding('test query');

      expect(result).toHaveLength(1536);
      expect(Array.isArray(result)).toBe(true);
    });

    it('should handle embedding service errors gracefully', async () => {
      mockEmbeddingService.generateEmbedding.mockRejectedValue(new Error('API Error'));

      await expect(documentRetriever.generateQueryEmbedding('test query'))
        .rejects.toThrow('API Error');
    });
  });

  describe('Vector Search', () => {
    beforeEach(async () => {
      documentRetriever = new DocumentRetriever({
        databaseManager: mockDatabaseManager,
        visibilityDatabase: mockVisibilityDatabase
      });
      await documentRetriever.initialize();
    });

    it('should perform vector search with similarity threshold', async () => {
      const mockEmbedding = new Array(1536).fill(0.1);
      const mockResults = {
        rows: [
          {
            id: 'doc1',
            title: 'Test Document 1',
            content: 'Test content 1',
            similarity: 0.85,
            metadata: { source: 'test' }
          },
          {
            id: 'doc2',
            title: 'Test Document 2',
            content: 'Test content 2',
            similarity: 0.75,
            metadata: { source: 'test' }
          }
        ]
      };

      mockDatabaseManager.query.mockResolvedValue(mockResults);

      const results = await documentRetriever.performVectorSearch(mockEmbedding, 5);

      expect(mockDatabaseManager.query).toHaveBeenCalledWith(
        expect.stringContaining('1 - (d.embedding <=> $1::vector) as similarity'),
        expect.arrayContaining([JSON.stringify(mockEmbedding)])
      );
      expect(results).toEqual(mockResults.rows);
    });

    it('should handle empty vector search results', async () => {
      const mockEmbedding = new Array(1536).fill(0.1);
      mockDatabaseManager.query.mockResolvedValue({ rows: [] });

      const results = await documentRetriever.performVectorSearch(mockEmbedding, 5);

      expect(results).toEqual([]);
    });
  });

  describe('Keyword Search', () => {
    beforeEach(async () => {
      documentRetriever = new DocumentRetriever({
        databaseManager: mockDatabaseManager,
        visibilityDatabase: mockVisibilityDatabase
      });
      await documentRetriever.initialize();
    });

    it('should perform keyword search with ranking', async () => {
      const mockResults = {
        rows: [
          {
            id: 'doc1',
            title: 'Test Document 1',
            content: 'Test content with keywords',
            rank: 0.9,
            metadata: { source: 'test' }
          },
          {
            id: 'doc2',
            title: 'Test Document 2',
            content: 'Another test content',
            rank: 0.7,
            metadata: { source: 'test' }
          }
        ]
      };

      mockDatabaseManager.query.mockResolvedValue(mockResults);

      const results = await documentRetriever.performKeywordSearch('test keywords', 5);

      expect(mockDatabaseManager.query).toHaveBeenCalledWith(
        expect.stringContaining('ts_rank'),
        expect.arrayContaining(['test keywords'])
      );
      expect(results).toEqual(mockResults.rows);
    });

    it('should handle special characters in search query', async () => {
      mockDatabaseManager.query.mockResolvedValue({ rows: [] });

      await documentRetriever.performKeywordSearch('test & query | special', 5);

      expect(mockDatabaseManager.query).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['test & query | special'])
      );
    });
  });

  describe('Hybrid Search', () => {
    beforeEach(async () => {
      documentRetriever = new DocumentRetriever({
        databaseManager: mockDatabaseManager,
        visibilityDatabase: mockVisibilityDatabase,
        openaiApiKey: 'test-api-key'
      });
      await documentRetriever.initialize();
    });

    it('should combine vector and keyword search results using RRF', async () => {
      const mockEmbedding = new Array(1536).fill(0.1);
      mockEmbeddingService.generateEmbedding.mockResolvedValue(mockEmbedding);

      // Mock vector search results
      const vectorResults = [
        { id: 'doc1', title: 'Doc 1', similarity: 0.9 },
        { id: 'doc2', title: 'Doc 2', similarity: 0.8 },
        { id: 'doc3', title: 'Doc 3', similarity: 0.7 }
      ];

      // Mock keyword search results
      const keywordResults = [
        { id: 'doc2', title: 'Doc 2', rank: 0.95 },
        { id: 'doc4', title: 'Doc 4', rank: 0.85 },
        { id: 'doc1', title: 'Doc 1', rank: 0.75 }
      ];

      // Mock visibility filtering
      mockVisibilityDatabase.filterByVisibility.mockImplementation(docs => docs);

      // Mock database calls
      mockDatabaseManager.query
        .mockResolvedValueOnce({ rows: vectorResults })  // Vector search
        .mockResolvedValueOnce({ rows: keywordResults }) // Keyword search
        .mockResolvedValue({ rows: [] }); // Document enrichment

      const results = await documentRetriever.retrieve('test query', {}, { userId: 'user1' });

      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
      expect(mockEmbeddingService.generateEmbedding).toHaveBeenCalledWith('test query');
      expect(mockVisibilityDatabase.filterByVisibility).toHaveBeenCalled();
    });

    it('should handle empty search results gracefully', async () => {
      const mockEmbedding = new Array(1536).fill(0.1);
      mockEmbeddingService.generateEmbedding.mockResolvedValue(mockEmbedding);
      mockDatabaseManager.query.mockResolvedValue({ rows: [] });
      mockVisibilityDatabase.filterByVisibility.mockReturnValue([]);

      const results = await documentRetriever.retrieve('test query', {}, { userId: 'user1' });

      expect(results).toEqual([]);
    });

    it('should respect maxResults parameter', async () => {
      documentRetriever = new DocumentRetriever({
        databaseManager: mockDatabaseManager,
        visibilityDatabase: mockVisibilityDatabase,
        openaiApiKey: 'test-api-key',
        maxResults: 3
      });
      await documentRetriever.initialize();

      const mockEmbedding = new Array(1536).fill(0.1);
      mockEmbeddingService.generateEmbedding.mockResolvedValue(mockEmbedding);

      // Mock many results
      const manyResults = Array.from({ length: 10 }, (_, i) => ({
        id: `doc${i}`,
        title: `Document ${i}`,
        similarity: 0.9 - i * 0.1
      }));

      mockDatabaseManager.query.mockResolvedValue({ rows: manyResults });
      mockVisibilityDatabase.filterByVisibility.mockImplementation(docs => docs);

      const results = await documentRetriever.retrieve('test query', {}, { userId: 'user1' });

      expect(results.length).toBeLessThanOrEqual(3);
    });
  });

  describe('Result Ranking and Fusion', () => {
    beforeEach(async () => {
      documentRetriever = new DocumentRetriever({
        databaseManager: mockDatabaseManager,
        visibilityDatabase: mockVisibilityDatabase
      });
      await documentRetriever.initialize();
    });

    it('should implement Reciprocal Rank Fusion correctly', () => {
      const vectorResults = [
        { id: 'doc1', score: 0.9 },
        { id: 'doc2', score: 0.8 },
        { id: 'doc3', score: 0.7 }
      ];

      const keywordResults = [
        { id: 'doc2', score: 0.95 },
        { id: 'doc4', score: 0.85 },
        { id: 'doc1', score: 0.75 }
      ];

      const fusedResults = documentRetriever.fuseResults(vectorResults, keywordResults);

      expect(fusedResults).toBeDefined();
      expect(Array.isArray(fusedResults)).toBe(true);
      expect(fusedResults.length).toBeGreaterThan(0);
      
      // Results should be sorted by combined score
      for (let i = 1; i < fusedResults.length; i++) {
        expect(fusedResults[i-1].combinedScore).toBeGreaterThanOrEqual(fusedResults[i].combinedScore);
      }
    });

    it('should handle results with only vector matches', () => {
      const vectorResults = [
        { id: 'doc1', score: 0.9 },
        { id: 'doc2', score: 0.8 }
      ];

      const keywordResults = [];

      const fusedResults = documentRetriever.fuseResults(vectorResults, keywordResults);

      expect(fusedResults).toHaveLength(2);
      expect(fusedResults[0].id).toBe('doc1');
    });

    it('should handle results with only keyword matches', () => {
      const vectorResults = [];

      const keywordResults = [
        { id: 'doc1', score: 0.9 },
        { id: 'doc2', score: 0.8 }
      ];

      const fusedResults = documentRetriever.fuseResults(vectorResults, keywordResults);

      expect(fusedResults).toHaveLength(2);
      expect(fusedResults[0].id).toBe('doc1');
    });
  });

  describe('Error Handling', () => {
    beforeEach(async () => {
      documentRetriever = new DocumentRetriever({
        databaseManager: mockDatabaseManager,
        visibilityDatabase: mockVisibilityDatabase
      });
      await documentRetriever.initialize();
    });

    it('should handle database errors gracefully', async () => {
      mockDatabaseManager.query.mockRejectedValue(new Error('Database connection failed'));

      await expect(documentRetriever.retrieve('test query', {}, { userId: 'user1' }))
        .rejects.toThrow('Database connection failed');
    });

    it('should handle visibility filtering errors', async () => {
      mockDatabaseManager.query.mockResolvedValue({ rows: [{ id: 'doc1' }] });
      mockVisibilityDatabase.filterByVisibility.mockRejectedValue(new Error('Visibility error'));

      await expect(documentRetriever.retrieve('test query', {}, { userId: 'user1' }))
        .rejects.toThrow('Visibility error');
    });

    it('should validate query parameter', async () => {
      await expect(documentRetriever.retrieve('', { userId: 'user1' }))
        .rejects.toThrow('Query is required');

      await expect(documentRetriever.retrieve(null, { userId: 'user1' }))
        .rejects.toThrow('Query is required');
    });

    it('should validate user authentication', async () => {
      await expect(documentRetriever.retrieve('test query', null))
        .rejects.toThrow('User authentication is required');

      await expect(documentRetriever.retrieve('test query', {}))
        .rejects.toThrow('User authentication is required');
    });
  });
});
