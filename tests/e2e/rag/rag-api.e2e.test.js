/**
 * RAG API End-to-End Tests
 */

const request = require('supertest');
const ManualReviewServer = require('../../../src/web/server');
const DatabaseManager = require('../../../src/database/DatabaseManager');
const LLMProviderManager = require('../../../src/enrichment/LLMProviderManager');
const VisibilityDatabase = require('../../../src/ingestion/VisibilityDatabase');
const RAGManager = require('../../../src/rag/RAGManager');

// Unmock pg for real database connections
jest.unmock('pg');

describe('RAG API E2E Tests', () => {
  let app;
  let server;
  let databaseManager;
  let llmProviderManager;
  let visibilityDatabase;
  let ragManager;

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

      // Mock LLM provider responses
      jest.spyOn(llmProviderManager, 'executeWithFailover').mockResolvedValue({
        content: 'This is a generated response about the query topic.',
        usage: { total_tokens: 25 },
        model: 'gpt-3.5-turbo'
      });

      // Initialize visibility database
      visibilityDatabase = new VisibilityDatabase(databaseManager);
      await visibilityDatabase.initialize();

      // Initialize RAG manager
      ragManager = new RAGManager({
        databaseManager,
        llmProviderManager,
        visibilityDatabase
      });
      await ragManager.initialize();

      // Initialize web server with RAG manager
      server = new ManualReviewServer({
        port: 0, // Use random port for testing
        ragManager,
        databaseManager
      });

      app = server.app;

      // Setup test data
      await setupTestData();

    } catch (error) {
      console.log('Database not available, skipping E2E tests:', error.message);
    }
  }, 30000);

  afterAll(async () => {
    if (databaseManager?.isInitialized) {
      await cleanupTestData();
    }
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
    jest.restoreAllMocks();
  });

  describe('POST /api/v1/rag/search', () => {
    it('should process RAG search request successfully', async () => {
      if (!databaseManager?.isInitialized) {
        console.log('Skipping test - database not available');
        return;
      }

      const searchRequest = {
        query: 'What is machine learning?',
        filters: {
          sources: ['wikipedia'],
          contentTypes: ['article']
        },
        options: {
          maxResults: 5,
          responseFormat: 'json',
          includeMetadata: true,
          includeSources: true
        }
      };

      const response = await request(app)
        .post('/api/v1/rag/search')
        .set('Authorization', 'Bearer test-token')
        .set('x-trace-id', 'test-trace-123')
        .send(searchRequest)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('answer');
      expect(response.body.data).toHaveProperty('confidence');
      expect(response.body.data).toHaveProperty('sources');
      expect(response.body.data).toHaveProperty('metadata');
      expect(response.body.request_metadata).toHaveProperty('trace_id', 'test-trace-123');
      expect(response.body.request_metadata).toHaveProperty('processing_time_ms');
    });

    it('should return error for invalid request', async () => {
      if (!databaseManager?.isInitialized) {
        console.log('Skipping test - database not available');
        return;
      }

      const invalidRequest = {
        query: '', // Empty query
        options: {
          maxResults: 0 // Invalid max results
        }
      };

      const response = await request(app)
        .post('/api/v1/rag/search')
        .set('Authorization', 'Bearer test-token')
        .send(invalidRequest)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toHaveProperty('message');
      expect(response.body.error.type).toBe('ValidationError');
    });

    it('should require authentication', async () => {
      if (!databaseManager?.isInitialized) {
        console.log('Skipping test - database not available');
        return;
      }

      const searchRequest = {
        query: 'What is machine learning?'
      };

      await request(app)
        .post('/api/v1/rag/search')
        .send(searchRequest)
        .expect(401);
    });

    it('should handle different response formats', async () => {
      if (!databaseManager?.isInitialized) {
        console.log('Skipping test - database not available');
        return;
      }

      const formats = ['json', 'text', 'markdown'];

      for (const format of formats) {
        const searchRequest = {
          query: 'What is artificial intelligence?',
          options: {
            responseFormat: format
          }
        };

        const response = await request(app)
          .post('/api/v1/rag/search')
          .set('Authorization', 'Bearer test-token')
          .send(searchRequest)
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.data).toHaveProperty('answer');

        if (format === 'json') {
          expect(response.body.format).toBe('json');
        } else {
          expect(response.body.data.format).toBe(format);
          expect(response.body.data).toHaveProperty('content');
        }
      }
    });

    it('should handle query with filters', async () => {
      if (!databaseManager?.isInitialized) {
        console.log('Skipping test - database not available');
        return;
      }

      const searchRequest = {
        query: 'machine learning algorithms',
        filters: {
          sources: ['academic'],
          dateRange: {
            start: '2023-01-01T00:00:00.000Z',
            end: '2023-12-31T23:59:59.999Z'
          },
          contentTypes: ['research_paper'],
          tags: ['supervised_learning']
        },
        options: {
          maxResults: 10
        }
      };

      const response = await request(app)
        .post('/api/v1/rag/search')
        .set('Authorization', 'Bearer test-token')
        .send(searchRequest)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('answer');
    });

    it('should generate unique trace IDs when not provided', async () => {
      if (!databaseManager?.isInitialized) {
        console.log('Skipping test - database not available');
        return;
      }

      const searchRequest = {
        query: 'What is deep learning?'
      };

      const response = await request(app)
        .post('/api/v1/rag/search')
        .set('Authorization', 'Bearer test-token')
        .send(searchRequest)
        .expect(200);

      expect(response.body.request_metadata.trace_id).toMatch(/^rag_\d+_[a-z0-9]+$/);
    });
  });

  describe('GET /api/v1/rag/health', () => {
    it('should return healthy status when RAG system is initialized', async () => {
      if (!databaseManager?.isInitialized) {
        console.log('Skipping test - database not available');
        return;
      }

      const response = await request(app)
        .get('/api/v1/rag/health')
        .expect(200);

      expect(response.body.status).toBe('healthy');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('components');
      expect(response.body).toHaveProperty('uptime');
      expect(response.body).toHaveProperty('version');
    });

    it('should return unhealthy status when RAG system is not initialized', async () => {
      if (!databaseManager?.isInitialized) {
        console.log('Skipping test - database not available');
        return;
      }

      // Create server without RAG manager
      const unhealthyServer = new ManualReviewServer({
        port: 0,
        databaseManager
      });

      const response = await request(unhealthyServer.app)
        .get('/api/v1/rag/health')
        .expect(503);

      expect(response.body.status).toBe('unhealthy');
    });
  });

  describe('GET /api/v1/rag/capabilities', () => {
    it('should return system capabilities', async () => {
      if (!databaseManager?.isInitialized) {
        console.log('Skipping test - database not available');
        return;
      }

      const response = await request(app)
        .get('/api/v1/rag/capabilities')
        .set('Authorization', 'Bearer test-token')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('search');
      expect(response.body.data).toHaveProperty('filters');
      expect(response.body.data).toHaveProperty('features');
      expect(response.body.data).toHaveProperty('limits');

      expect(response.body.data.search.supported_formats).toContain('json');
      expect(response.body.data.search.supported_formats).toContain('text');
      expect(response.body.data.search.supported_formats).toContain('markdown');
    });

    it('should require authentication for capabilities endpoint', async () => {
      if (!databaseManager?.isInitialized) {
        console.log('Skipping test - database not available');
        return;
      }

      await request(app)
        .get('/api/v1/rag/capabilities')
        .expect(401);
    });
  });

  describe('POST /api/v1/rag/feedback', () => {
    it('should accept feedback on RAG responses', async () => {
      if (!databaseManager?.isInitialized) {
        console.log('Skipping test - database not available');
        return;
      }

      const feedback = {
        trace_id: 'test-trace-123',
        rating: 4,
        feedback_type: 'helpful',
        comment: 'The response was accurate and helpful.',
        suggested_improvement: 'Could include more examples.'
      };

      const response = await request(app)
        .post('/api/v1/rag/feedback')
        .set('Authorization', 'Bearer test-token')
        .send(feedback)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Feedback received successfully');
      expect(response.body).toHaveProperty('feedback_id');
      expect(response.body).toHaveProperty('timestamp');
    });

    it('should validate feedback data', async () => {
      if (!databaseManager?.isInitialized) {
        console.log('Skipping test - database not available');
        return;
      }

      const invalidFeedback = {
        trace_id: 'test-trace-123',
        rating: 6, // Invalid rating (should be 1-5)
        feedback_type: 'invalid_type'
      };

      const response = await request(app)
        .post('/api/v1/rag/feedback')
        .set('Authorization', 'Bearer test-token')
        .send(invalidFeedback)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Invalid feedback');
    });

    it('should require authentication for feedback endpoint', async () => {
      if (!databaseManager?.isInitialized) {
        console.log('Skipping test - database not available');
        return;
      }

      const feedback = {
        trace_id: 'test-trace-123',
        rating: 4,
        feedback_type: 'helpful'
      };

      await request(app)
        .post('/api/v1/rag/feedback')
        .send(feedback)
        .expect(401);
    });
  });

  describe('Error Handling', () => {
    it('should handle RAG system errors gracefully', async () => {
      if (!databaseManager?.isInitialized) {
        console.log('Skipping test - database not available');
        return;
      }

      // Mock an error in the RAG manager
      const originalProcessQuery = ragManager.processQuery;
      ragManager.processQuery = jest.fn().mockRejectedValue(new Error('RAG system error'));

      const searchRequest = {
        query: 'What is machine learning?'
      };

      const response = await request(app)
        .post('/api/v1/rag/search')
        .set('Authorization', 'Bearer test-token')
        .send(searchRequest)
        .expect(500);

      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toBe('RAG system error');
      expect(response.body.error).toHaveProperty('trace_id');

      // Restore original method
      ragManager.processQuery = originalProcessQuery;
    });

    it('should handle 404 for non-existent RAG endpoints', async () => {
      if (!databaseManager?.isInitialized) {
        console.log('Skipping test - database not available');
        return;
      }

      await request(app)
        .get('/api/v1/rag/nonexistent')
        .set('Authorization', 'Bearer test-token')
        .expect(404);
    });
  });

  // Helper functions
  async function setupTestData() {
    if (!databaseManager?.isInitialized) return;

    try {
      // Create test documents table for RAG testing
      await databaseManager.query(`
        CREATE TABLE IF NOT EXISTS rag_test_documents (
          id SERIAL PRIMARY KEY,
          title TEXT NOT NULL,
          content TEXT NOT NULL,
          source_url TEXT,
          source_type TEXT DEFAULT 'article',
          tags TEXT[],
          embedding vector(1536),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Insert test documents
      await databaseManager.query(`
        INSERT INTO rag_test_documents (title, content, source_url, source_type, tags) VALUES
        ('Machine Learning Introduction', 'Machine learning is a method of data analysis that automates analytical model building. It is a branch of artificial intelligence based on the idea that systems can learn from data, identify patterns and make decisions with minimal human intervention.', 'https://example.com/ml-intro', 'article', ARRAY['machine_learning', 'ai']),
        ('Deep Learning Fundamentals', 'Deep learning is part of a broader family of machine learning methods based on artificial neural networks with representation learning. Learning can be supervised, semi-supervised or unsupervised.', 'https://example.com/dl-fundamentals', 'article', ARRAY['deep_learning', 'neural_networks']),
        ('AI Ethics and Bias', 'Artificial intelligence systems can perpetuate and amplify biases present in training data. It is crucial to develop fair and ethical AI systems that do not discriminate against protected groups.', 'https://example.com/ai-ethics', 'research_paper', ARRAY['ai_ethics', 'bias', 'fairness'])
      `);

      console.log('Test data setup completed');
    } catch (error) {
      console.log('Error setting up test data:', error.message);
    }
  }

  async function cleanupTestData() {
    if (!databaseManager?.isInitialized) return;

    try {
      await databaseManager.query('DROP TABLE IF EXISTS rag_test_documents');
      console.log('Test data cleanup completed');
    } catch (error) {
      console.log('Error cleaning up test data:', error.message);
    }
  }
});
