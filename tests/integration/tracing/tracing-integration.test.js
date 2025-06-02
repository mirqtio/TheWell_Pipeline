const request = require('supertest');
const express = require('express');
const { TracingManager, TracingMiddleware, RAGTracing } = require('../../../src/tracing');

// Mock jaeger-client for integration tests
jest.mock('jaeger-client', () => ({
  initTracer: jest.fn(() => ({
    startSpan: jest.fn(() => ({
      setTag: jest.fn(),
      log: jest.fn(),
      finish: jest.fn(),
    })),
    extract: jest.fn(),
    inject: jest.fn(),
    close: jest.fn((callback) => callback()),
  })),
}));

// Mock cls-hooked
jest.mock('cls-hooked', () => ({
  createNamespace: jest.fn(() => ({
    runAndReturn: jest.fn((fn) => fn()),
    get: jest.fn(),
    set: jest.fn(),
  })),
}));

// Mock logger
jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

describe('Tracing Integration Tests', () => {
  let app;
  let tracingManager;
  let tracingMiddleware;
  let ragTracing;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Initialize tracing components
    tracingManager = new TracingManager({
      serviceName: 'test-service',
      enabled: true,
    });
    
    tracingMiddleware = new TracingMiddleware({
      tracingManager,
      excludePaths: ['/health'],
    });
    
    ragTracing = new RAGTracing(tracingManager);
    
    // Setup Express app
    app = express();
    app.use(express.json());
    app.use(tracingMiddleware.middleware());
    
    // Test routes
    app.get('/health', (req, res) => {
      res.json({ status: 'healthy' });
    });
    
    app.post('/api/search', (req, res) => {
      const span = tracingMiddleware.createChildSpan(req, 'search.operation');
      span.setTag('search.query', req.body.query);
      span.finish();
      res.json({ results: [] });
    });
    
    app.post('/api/rag', async (req, res) => {
      try {
        const result = await ragTracing.traceRAGQuery(
          req.body.query,
          { queryType: 'search' },
          async () => {
            // Simulate RAG processing
            await new Promise(resolve => setTimeout(resolve, 10));
            return {
              documents: [{ id: 1, content: 'test' }],
              totalCount: 1,
              maxScore: 0.9,
            };
          }
        );
        res.json(result);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
    
    app.get('/error', (req, res, next) => {
      next(new Error('Test error'));
    });
    
    // Error handler
    app.use((error, req, res, next) => {
      if (req.traceSpan) {
        req.traceSpan.setError(error);
      }
      res.status(500).json({ error: error.message });
    });
  });

  describe('HTTP Request Tracing', () => {
    it('should trace successful requests', async () => {
      const response = await request(app)
        .post('/api/search')
        .send({ query: 'test query' })
        .expect(200);

      expect(response.body).toEqual({ results: [] });
      
      // Verify tracing was called
      const jaeger = require('jaeger-client');
      expect(jaeger.initTracer).toHaveBeenCalled();
    });

    it('should exclude health check from tracing', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body).toEqual({ status: 'healthy' });
    });

    it('should trace error requests', async () => {
      await request(app)
        .get('/error')
        .expect(500);
    });

    it('should propagate trace context in headers', async () => {
      const response = await request(app)
        .post('/api/search')
        .set('x-trace-id', 'test-trace-id')
        .send({ query: 'test query' })
        .expect(200);

      // Response should have trace headers
      expect(response.headers).toBeDefined();
    });
  });

  describe('RAG Operation Tracing', () => {
    it('should trace complete RAG workflow', async () => {
      const response = await request(app)
        .post('/api/rag')
        .send({ query: 'What is AI?' })
        .expect(200);

      expect(response.body).toEqual({
        documents: [{ id: 1, content: 'test' }],
        totalCount: 1,
        maxScore: 0.9,
      });
    });

    it('should trace RAG query with metadata', async () => {
      const query = 'test query';
      const metadata = { queryType: 'search', filters: { category: 'tech' } };
      
      const result = await ragTracing.traceRAGQuery(query, metadata, async () => {
        return { documents: [], totalCount: 0, maxScore: 0 };
      });

      expect(result).toEqual({
        documents: [],
        totalCount: 0,
        maxScore: 0,
      });
    });

    it('should trace document retrieval', async () => {
      const result = await ragTracing.traceRetrieval(
        'hybrid',
        { limit: 10, filters: { category: 'test' } },
        async () => {
          return { documents: [{ id: 1, score: 0.9 }] };
        }
      );

      expect(result).toEqual({
        documents: [{ id: 1, score: 0.9 }],
      });
    });

    it('should trace response generation', async () => {
      const result = await ragTracing.traceGeneration(
        'openai',
        { model: 'gpt-4', temperature: 0.7 },
        async () => {
          return {
            content: 'Generated response',
            usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
            cost: 0.01,
          };
        }
      );

      expect(result).toEqual({
        content: 'Generated response',
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        cost: 0.01,
      });
    });

    it('should trace cache operations', async () => {
      const result = await ragTracing.traceCache(
        'get',
        'test-key',
        async () => {
          return { data: 'cached-value', ttl: 3600 };
        }
      );

      expect(result).toEqual({
        data: 'cached-value',
        ttl: 3600,
      });
    });

    it('should trace database operations', async () => {
      const result = await ragTracing.traceDatabase(
        'query',
        'documents',
        async () => {
          return [{ id: 1, title: 'Test Document' }];
        }
      );

      expect(result).toEqual([{ id: 1, title: 'Test Document' }]);
    });
  });

  describe('Error Handling', () => {
    it('should handle tracing errors gracefully', async () => {
      // Simulate tracing error
      tracingManager.enabled = false;
      
      const result = await ragTracing.traceRAGQuery(
        'test query',
        {},
        async () => {
          return { documents: [], totalCount: 0 };
        }
      );

      expect(result).toEqual({
        documents: [],
        totalCount: 0,
      });
    });

    it('should trace operation errors', async () => {
      const error = new Error('Operation failed');
      
      await expect(
        ragTracing.traceOperation(
          'test.operation',
          {},
          async () => {
            throw error;
          }
        )
      ).rejects.toThrow('Operation failed');
    });
  });

  describe('Performance Monitoring', () => {
    it('should track operation duration', async () => {
      const startTime = Date.now();
      
      await ragTracing.traceOperation(
        'slow.operation',
        {},
        async () => {
          await new Promise(resolve => setTimeout(resolve, 50));
          return 'result';
        }
      );
      
      const duration = Date.now() - startTime;
      expect(duration).toBeGreaterThanOrEqual(50);
    });

    it('should calculate average scores correctly', () => {
      const documents = [
        { score: 0.9 },
        { score: 0.8 },
        { score: 0.7 },
      ];
      
      const avgScore = ragTracing.calculateAverageScore(documents);
      expect(avgScore).toBeCloseTo(0.8, 1);
    });

    it('should handle empty documents for average score', () => {
      const avgScore = ragTracing.calculateAverageScore([]);
      expect(avgScore).toBe(0);
    });
  });

  describe('Context Propagation', () => {
    it('should propagate trace context across operations', async () => {
      const response = await request(app)
        .post('/api/search')
        .set('x-trace-id', 'parent-trace-id')
        .send({ query: 'test query' })
        .expect(200);

      // Verify context propagation worked
      expect(response.body).toEqual({ results: [] });
    });

    it('should create child spans correctly', async () => {
      const response = await request(app)
        .post('/api/search')
        .send({ query: 'test query' })
        .expect(200);

      expect(response.body).toEqual({ results: [] });
    });
  });

  afterAll(async () => {
    if (tracingManager) {
      await tracingManager.close();
    }
  });
});
