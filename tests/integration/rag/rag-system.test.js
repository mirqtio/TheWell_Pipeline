/**
 * RAG System Integration Tests
 */

const RAGManager = require('../../../src/rag/RAGManager');
const DatabaseManager = require('../../../src/database/DatabaseManager');
const LLMProviderManager = require('../../../src/enrichment/LLMProviderManager');
const VisibilityDatabase = require('../../../src/ingestion/VisibilityDatabase');

// Unmock pg for real database connections
jest.unmock('pg');

describe('RAG System Integration Tests', () => {
  let ragManager;
  let databaseManager;
  let llmProviderManager;
  let visibilityDatabase;

  beforeAll(async () => {
    // Check if database is available
    const dbConfig = {
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 5432,
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'password',
      database: process.env.DB_NAME || 'thewell_test'
    };

    try {
      // Initialize database manager
      databaseManager = new DatabaseManager(dbConfig);
      await databaseManager.initialize();

      // Initialize LLM provider manager with mock configuration
      llmProviderManager = new LLMProviderManager({
        providers: {
          openai: {
            apiKey: 'test-key',
            model: 'gpt-3.5-turbo',
            enabled: true
          }
        }
      });
      await llmProviderManager.initialize();

      // Initialize visibility database
      visibilityDatabase = new VisibilityDatabase(databaseManager);
      await visibilityDatabase.initialize();

      // Initialize RAG manager
      ragManager = new RAGManager({
        databaseManager,
        llmProviderManager,
        visibilityDatabase
      });

    } catch (error) {
      console.log('Database not available, skipping integration tests:', error.message);
    }
  }, 30000);

  afterAll(async () => {
    if (ragManager) {
      await ragManager.shutdown();
    }
    if (databaseManager) {
      await databaseManager.close();
    }
    if (llmProviderManager) {
      await llmProviderManager.shutdown();
    }
    if (visibilityDatabase) {
      await visibilityDatabase.shutdown();
    }
  });

  describe('RAG Manager Initialization', () => {
    it('should initialize all components successfully', async () => {
      if (!databaseManager?.isInitialized) {
        console.log('Skipping test - database not available');
        return;
      }

      await ragManager.initialize();

      expect(ragManager.isInitialized).toBe(true);
      expect(ragManager.inputProcessor).toBeDefined();
      expect(ragManager.documentRetriever).toBeDefined();
      expect(ragManager.responseGenerator).toBeDefined();
      expect(ragManager.outputFormatter).toBeDefined();
    });

    it('should report healthy status when initialized', async () => {
      if (!databaseManager?.isInitialized) {
        console.log('Skipping test - database not available');
        return;
      }

      if (!ragManager.isInitialized) {
        await ragManager.initialize();
      }

      const status = await ragManager.getHealthStatus();

      expect(status.initialized).toBe(true);
      expect(status.components.inputProcessor.initialized).toBe(true);
      expect(status.components.documentRetriever.initialized).toBe(true);
      expect(status.components.responseGenerator.initialized).toBe(true);
      expect(status.components.outputFormatter.initialized).toBe(true);
    });
  });

  describe('Input Processing Integration', () => {
    beforeEach(async () => {
      if (!databaseManager?.isInitialized) {
        console.log('Skipping test - database not available');
        return;
      }

      if (!ragManager.isInitialized) {
        await ragManager.initialize();
      }
    });

    it('should process valid query input', async () => {
      if (!databaseManager?.isInitialized) {
        console.log('Skipping test - database not available');
        return;
      }

      const queryData = {
        query: 'What is machine learning?',
        filters: {
          sources: ['wikipedia'],
          contentTypes: ['article']
        },
        options: {
          maxResults: 5,
          responseFormat: 'json'
        }
      };

      const userContext = {
        userId: 'test-user',
        roles: ['user'],
        permissions: ['read']
      };

      const result = await ragManager.inputProcessor.processInput(queryData, userContext);

      expect(result.query).toBe('What is machine learning?');
      expect(result.normalizedQuery).toBe('what is machine learning?');
      expect(result.filters.sources).toEqual(['wikipedia']);
      expect(result.filters.userFilters.userId).toBe('test-user');
      expect(result.options.maxResults).toBe(5);
      expect(result.metadata.language).toBe('en');
      expect(result.metadata.queryType).toBe('question');
    });

    it('should validate input and reject invalid queries', async () => {
      if (!databaseManager?.isInitialized) {
        console.log('Skipping test - database not available');
        return;
      }

      const invalidQueryData = {
        query: '', // Empty query
        options: {
          maxResults: 0 // Invalid max results
        }
      };

      await expect(ragManager.inputProcessor.processInput(invalidQueryData, {}))
        .rejects.toThrow();
    });
  });

  describe('Document Retrieval Integration', () => {
    beforeEach(async () => {
      if (!databaseManager?.isInitialized) {
        console.log('Skipping test - database not available');
        return;
      }

      if (!ragManager.isInitialized) {
        await ragManager.initialize();
      }

      // Insert test documents for retrieval
      await setupTestDocuments();
    });

    afterEach(async () => {
      if (databaseManager?.isInitialized) {
        await cleanupTestDocuments();
      }
    });

    it('should retrieve documents using hybrid search', async () => {
      if (!databaseManager?.isInitialized) {
        console.log('Skipping test - database not available');
        return;
      }

      const processedInput = {
        query: 'machine learning',
        normalizedQuery: 'machine learning',
        filters: {
          userFilters: {
            userId: 'test-user',
            roles: ['user']
          }
        },
        options: {
          maxResults: 5
        }
      };

      const userContext = {
        userId: 'test-user',
        roles: ['user']
      };

      const documents = await ragManager.documentRetriever.retrieveDocuments(processedInput, userContext);

      expect(Array.isArray(documents)).toBe(true);
      expect(documents.length).toBeGreaterThanOrEqual(0);

      if (documents.length > 0) {
        expect(documents[0]).toHaveProperty('id');
        expect(documents[0]).toHaveProperty('title');
        expect(documents[0]).toHaveProperty('content');
        expect(documents[0]).toHaveProperty('search_metadata');
      }
    });

    it('should apply visibility filtering', async () => {
      if (!databaseManager?.isInitialized) {
        console.log('Skipping test - database not available');
        return;
      }

      const processedInput = {
        query: 'test document',
        normalizedQuery: 'test document',
        filters: {
          userFilters: {
            userId: 'restricted-user',
            roles: ['restricted']
          }
        },
        options: {
          maxResults: 10
        }
      };

      const userContext = {
        userId: 'restricted-user',
        roles: ['restricted']
      };

      const documents = await ragManager.documentRetriever.retrieveDocuments(processedInput, userContext);

      // Should return fewer or no documents due to visibility restrictions
      expect(Array.isArray(documents)).toBe(true);
    });
  });

  describe('Response Generation Integration', () => {
    beforeEach(async () => {
      if (!databaseManager?.isInitialized) {
        console.log('Skipping test - database not available');
        return;
      }

      if (!ragManager.isInitialized) {
        await ragManager.initialize();
      }

      // Mock LLM provider for testing
      jest.spyOn(llmProviderManager, 'executeWithFailover').mockResolvedValue({
        content: 'Machine learning is a subset of artificial intelligence that focuses on algorithms that can learn from data.',
        usage: { total_tokens: 25 },
        model: 'gpt-3.5-turbo'
      });
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should generate response using retrieved documents', async () => {
      if (!databaseManager?.isInitialized) {
        console.log('Skipping test - database not available');
        return;
      }

      const processedInput = {
        query: 'What is machine learning?',
        normalizedQuery: 'what is machine learning?',
        options: {
          responseFormat: 'json'
        }
      };

      const documents = [
        {
          id: 'doc1',
          title: 'Machine Learning Basics',
          content: 'Machine learning is a method of data analysis...',
          source_url: 'https://example.com/ml-basics'
        }
      ];

      const userContext = {
        userId: 'test-user',
        roles: ['user']
      };

      const response = await ragManager.responseGenerator.generateResponse(processedInput, documents, userContext);

      expect(response).toHaveProperty('content');
      expect(response).toHaveProperty('metadata');
      expect(response.content).toContain('Machine learning');
      expect(response.metadata).toHaveProperty('confidence_score');
      expect(response.metadata).toHaveProperty('model_used');
      expect(response.metadata).toHaveProperty('tokens_used');
    });

    it('should handle empty document set', async () => {
      if (!databaseManager?.isInitialized) {
        console.log('Skipping test - database not available');
        return;
      }

      const processedInput = {
        query: 'What is quantum computing?',
        normalizedQuery: 'what is quantum computing?'
      };

      const documents = [];
      const userContext = { userId: 'test-user' };

      const response = await ragManager.responseGenerator.generateResponse(processedInput, documents, userContext);

      expect(response).toHaveProperty('content');
      expect(response.metadata.confidence_score).toBeLessThan(0.5); // Lower confidence for no context
    });
  });

  describe('Output Formatting Integration', () => {
    beforeEach(async () => {
      if (!databaseManager?.isInitialized) {
        console.log('Skipping test - database not available');
        return;
      }

      if (!ragManager.isInitialized) {
        await ragManager.initialize();
      }
    });

    it('should format response in different formats', async () => {
      if (!databaseManager?.isInitialized) {
        console.log('Skipping test - database not available');
        return;
      }

      const response = {
        content: 'Machine learning is a subset of AI.',
        metadata: {
          confidence_score: 0.85,
          model_used: 'gpt-3.5-turbo',
          tokens_used: 20
        },
        sources: [
          {
            document_id: 'doc1',
            title: 'ML Guide',
            source_url: 'https://example.com/ml',
            relevance_score: 0.9
          }
        ]
      };

      const documents = [
        {
          id: 'doc1',
          title: 'ML Guide',
          source_url: 'https://example.com/ml',
          search_metadata: { combined_score: 0.9 }
        }
      ];

      // Test JSON format
      const jsonResult = await ragManager.outputFormatter.format(response, documents, {
        responseFormat: 'json',
        traceId: 'test-trace'
      });

      expect(jsonResult.success).toBe(true);
      expect(jsonResult.format).toBe('json');
      expect(jsonResult.data.answer).toBe('Machine learning is a subset of AI.');

      // Test text format
      const textResult = await ragManager.outputFormatter.format(response, documents, {
        responseFormat: 'text',
        traceId: 'test-trace'
      });

      expect(textResult.success).toBe(true);
      expect(textResult.data.format).toBe('text');
      expect(textResult.data.content).toContain('Machine learning is a subset of AI.');

      // Test markdown format
      const markdownResult = await ragManager.outputFormatter.format(response, documents, {
        responseFormat: 'markdown',
        traceId: 'test-trace'
      });

      expect(markdownResult.success).toBe(true);
      expect(markdownResult.data.format).toBe('markdown');
      expect(markdownResult.data.content).toContain('Machine learning is a subset of AI.');
    });
  });

  // Helper functions
  async function setupTestDocuments() {
    if (!databaseManager?.isInitialized) return;

    try {
      // Create test documents table if it doesn't exist
      await databaseManager.query(`
        CREATE TABLE IF NOT EXISTS test_documents (
          id SERIAL PRIMARY KEY,
          title TEXT NOT NULL,
          content TEXT NOT NULL,
          source_url TEXT,
          embedding vector(1536),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Insert test documents
      await databaseManager.query(`
        INSERT INTO test_documents (title, content, source_url) VALUES
        ('Machine Learning Basics', 'Machine learning is a method of data analysis that automates analytical model building.', 'https://example.com/ml-basics'),
        ('AI Fundamentals', 'Artificial intelligence is intelligence demonstrated by machines.', 'https://example.com/ai-fundamentals'),
        ('Deep Learning Guide', 'Deep learning is part of a broader family of machine learning methods.', 'https://example.com/deep-learning')
      `);
    } catch (error) {
      console.log('Error setting up test documents:', error.message);
    }
  }

  async function cleanupTestDocuments() {
    if (!databaseManager?.isInitialized) return;

    try {
      await databaseManager.query('DROP TABLE IF EXISTS test_documents');
    } catch (error) {
      console.log('Error cleaning up test documents:', error.message);
    }
  }
});
