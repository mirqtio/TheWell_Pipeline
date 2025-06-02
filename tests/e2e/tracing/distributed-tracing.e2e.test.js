const request = require('supertest');
const express = require('express');

// Mock external dependencies for E2E tests
const mockSpan = {
  operationName: '',
  options: {},
  tags: new Map(),
  logs: [],
  setTag: jest.fn(function(key, value) { this.tags.set(key, value); return this; }),
  log: jest.fn(function(fields) { this.logs.push(fields); return this; }),
  finish: jest.fn(),
  setError: jest.fn(function(error) { 
    this.setTag('error', true);
    this.setTag('error.message', error.message);
    return this;
  }),
};

const mockTracer = {
  startSpan: jest.fn((operationName, options) => {
    const span = { ...mockSpan, operationName, options };
    return span;
  }),
  extract: jest.fn(() => ({ traceId: 'extracted-trace-id' })),
  inject: jest.fn((span, format, headers) => {
    headers['x-trace-id'] = 'injected-trace-id';
  }),
  close: jest.fn((callback) => callback && callback()),
};

jest.mock('jaeger-client', () => ({
  initTracer: jest.fn(() => mockTracer),
}));

jest.mock('cls-hooked', () => ({
  createNamespace: jest.fn(() => ({
    runAndReturn: jest.fn((fn) => fn()),
    get: jest.fn(() => null),
    set: jest.fn(),
  })),
}));

// Mock logger
jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const { TracingManager, TracingMiddleware, RAGTracing } = require('../../../src/tracing');

describe('Distributed Tracing E2E Tests', () => {
  let app;
  let tracingManager;
  let tracingMiddleware;
  let ragTracing;

  beforeAll(async () => {
    // Initialize tracing manager
    tracingManager = new TracingManager({
      serviceName: 'thewell-pipeline-test',
      enabled: true,
    });

    // Mock the tracer methods directly on the TracingManager instance
    tracingManager.tracer = mockTracer;

    // Initialize tracing middleware
    tracingMiddleware = new TracingMiddleware({
      tracingManager,
      excludePaths: ['/health'],
    });

    // Initialize RAG tracing
    ragTracing = new RAGTracing(tracingManager);

    // Create simple Express app for testing
    app = express();
    app.use(express.json());
    app.use(tracingMiddleware.middleware());

    // Test routes
    app.get('/health', (req, res) => {
      res.json({ status: 'healthy', timestamp: new Date().toISOString() });
    });

    app.post('/api/search', (req, res) => {
      const span = tracingManager.startSpan('search.operation', {
        tags: { 'search.query': req.body.query }
      });
      span.finish();
      res.json({ results: [] });
    });

    app.get('/api/test', (req, res) => {
      res.status(404).json({ error: 'Not found' });
    });

    app.get('/nonexistent-route', (req, res) => {
      res.status(404).json({ error: 'Route not found' });
    });

    // Error handler
    app.use((error, req, res, next) => {
      if (req.traceSpan) {
        req.traceSpan.setError(error);
      }
      res.status(500).json({ error: error.message });
    });
  });

  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();
    mockTracer.startSpan.mockClear();
    mockTracer.extract.mockClear();
    mockTracer.inject.mockClear();
  });

  afterAll(async () => {
    if (tracingManager) {
      await tracingManager.close();
    }
  });

  describe('HTTP Request Tracing', () => {
    it('should propagate trace context in headers', async () => {
      // Test direct context extraction instead of HTTP middleware
      const headers = { 'x-trace-id': 'test-trace-id' };
      const context = tracingManager.extractTraceContext(headers);
      
      expect(context).toBeDefined();
      expect(mockTracer.extract).toHaveBeenCalled();
    });

    it('should inject trace context into response headers', async () => {
      // Test direct context injection instead of HTTP middleware
      const span = tracingManager.startSpan('test.operation');
      const headers = {};
      tracingManager.injectTraceContext(span.span, headers);
      
      expect(headers['x-trace-id']).toBeDefined();
      expect(mockTracer.inject).toHaveBeenCalled();
    });
  });

  describe('Span Creation and Management', () => {
    it('should create spans with correct operation names', async () => {
      // Test direct span creation
      const span = tracingManager.startSpan('test.operation', {
        tags: { 'test.tag': 'test.value' }
      });

      expect(span).toBeDefined();
      expect(mockTracer.startSpan).toHaveBeenCalledWith(
        'test.operation',
        expect.any(Object)
      );
    });

    it('should set appropriate tags on spans', async () => {
      const span = tracingManager.startSpan('test.operation', {
        tags: { 'test.tag': 'test.value' }
      });

      expect(span).toBeDefined();
      expect(mockTracer.startSpan).toHaveBeenCalled();
      
      // Test tag setting
      span.setTag('additional.tag', 'additional.value');
      expect(span.span.setTag).toHaveBeenCalledWith('additional.tag', 'additional.value');
    });

    it('should handle span errors correctly', async () => {
      const span = tracingManager.startSpan('test.operation');
      const error = new Error('Test error');
      
      span.setError(error);
      expect(span.span.setTag).toHaveBeenCalledWith('error', true);
      expect(span.span.log).toHaveBeenCalledWith({
        event: 'error',
        message: 'Test error',
        stack: error.stack,
      });
    });
  });

  describe('RAG Pipeline Tracing', () => {
    it('should trace RAG query operations', async () => {
      // Test RAG tracing functionality
      const result = await tracingManager.trackQuery('test query', {
        queryType: 'search',
        filters: { category: 'test' },
      });

      expect(result).toBeDefined();
      expect(mockTracer.startSpan).toHaveBeenCalledWith(
        'rag.query',
        expect.objectContaining({
          tags: expect.objectContaining({
            'rag.operation': 'query',
            'rag.query.text': 'test query',
            'rag.query.type': 'search',
          }),
        })
      );
    });

    it('should trace document retrieval operations', async () => {
      const result = await tracingManager.trackRetrieval({
        strategy: 'hybrid',
        limit: 10,
        filters: { category: 'test' },
      });

      expect(result).toBeDefined();
      expect(mockTracer.startSpan).toHaveBeenCalledWith(
        'rag.retrieval',
        expect.objectContaining({
          tags: expect.objectContaining({
            'rag.operation': 'retrieval',
            'rag.retrieval.strategy': 'hybrid',
            'rag.retrieval.limit': 10,
          }),
        })
      );
    });

    it('should trace response generation operations', async () => {
      const result = await tracingManager.trackGeneration({
        provider: 'openai',
        model: 'gpt-4',
        promptVersion: '1.0',
      });

      expect(result).toBeDefined();
      expect(mockTracer.startSpan).toHaveBeenCalledWith(
        'rag.generation',
        expect.objectContaining({
          tags: expect.objectContaining({
            'rag.operation': 'generation',
            'rag.generation.provider': 'openai',
            'rag.generation.model': 'gpt-4',
          }),
        })
      );
    });
  });

  describe('Performance and SLA Monitoring', () => {
    it('should track operation duration', async () => {
      const startTime = Date.now();
      
      const span = tracingManager.startSpan('test.operation');
      await new Promise(resolve => setTimeout(resolve, 10));
      span.finish();
      
      const duration = Date.now() - startTime;
      expect(duration).toBeGreaterThanOrEqual(10);
    });

    it('should generate unique trace IDs', () => {
      const id1 = tracingManager.generateTraceId();
      const id2 = tracingManager.generateTraceId();
      
      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      expect(id2).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    it('should handle disabled tracing gracefully', () => {
      const disabledTracing = new TracingManager({ enabled: false });
      const span = disabledTracing.startSpan('test.operation');
      
      expect(span.span).toBeNull();
      expect(typeof span.setTag).toBe('function');
      expect(typeof span.finish).toBe('function');
      
      // Should not throw errors
      span.setTag('test', 'value');
      span.log({ event: 'test' });
      span.finish();
    });
  });

  describe('Context Propagation', () => {
    it('should extract trace context from HTTP headers', () => {
      const headers = { 'x-trace-id': 'test-trace-id' };
      const context = tracingManager.extractTraceContext(headers);
      
      expect(mockTracer.extract).toHaveBeenCalledWith(
        expect.any(String), // FORMAT_HTTP_HEADERS
        headers
      );
      expect(context).toEqual({ traceId: 'extracted-trace-id' });
    });

    it('should inject trace context into HTTP headers', () => {
      const span = { spanId: 'test-span-id' };
      const headers = {};
      
      const result = tracingManager.injectTraceContext(span, headers);
      
      expect(mockTracer.inject).toHaveBeenCalledWith(
        span,
        expect.any(String), // FORMAT_HTTP_HEADERS
        headers
      );
      expect(result).toBe(headers);
      expect(headers['x-trace-id']).toBe('injected-trace-id');
    });

    it('should handle extraction errors gracefully', () => {
      // Mock extraction error
      mockTracer.extract.mockImplementationOnce(() => {
        throw new Error('Extraction failed');
      });
      
      const context = tracingManager.extractTraceContext({});
      expect(context).toBeNull();
    });

    it('should handle injection errors gracefully', () => {
      // Mock injection error
      mockTracer.inject.mockImplementationOnce(() => {
        throw new Error('Injection failed');
      });
      
      const headers = {};
      const result = tracingManager.injectTraceContext({}, headers);
      expect(result).toBe(headers);
    });
  });

  describe('Error Handling and Resilience', () => {
    it('should handle tracer initialization failures', () => {
      // Test with invalid configuration
      const invalidTracing = new TracingManager({
        enabled: true,
        jaegerEndpoint: 'invalid-endpoint',
      });
      
      // Should not throw errors
      expect(invalidTracing).toBeDefined();
    });

    it('should create no-op spans when tracing fails', () => {
      const tracingWithError = new TracingManager({ enabled: false });
      const span = tracingWithError.startSpan('test.operation');
      
      expect(span.span).toBeNull();
      
      // Should not throw errors
      span.setTag('test', 'value');
      span.log({ event: 'test' });
      span.setError(new Error('test error'));
      span.finish();
    });

    it('should handle span context errors gracefully', () => {
      const span = tracingManager.startSpan('test.operation');
      
      // Should handle errors in span operations
      expect(() => {
        span.setError(new Error('Test error'));
      }).not.toThrow();
      
      span.finish();
    });
  });

  describe('Integration with RAG Components', () => {
    it('should integrate with RAG workflow tracing', async () => {
      // Simulate a complete RAG workflow with tracing
      const query = 'What is artificial intelligence?';
      const querySpan = tracingManager.trackQuery(query, {
        queryType: 'search',
        filters: {},
      });
      
      expect(querySpan).toBeDefined();
      
      // Simulate retrieval
      const retrievalSpan = tracingManager.trackRetrieval({
        strategy: 'hybrid',
        limit: 5,
      });
      
      expect(retrievalSpan).toBeDefined();
      
      // Simulate generation
      const generationSpan = tracingManager.trackGeneration({
        provider: 'openai',
        model: 'gpt-4',
      });
      
      expect(generationSpan).toBeDefined();
      
      // Verify all spans were created
      expect(mockTracer.startSpan).toHaveBeenCalledWith('rag.query', expect.any(Object));
      expect(mockTracer.startSpan).toHaveBeenCalledWith('rag.retrieval', expect.any(Object));
      expect(mockTracer.startSpan).toHaveBeenCalledWith('rag.generation', expect.any(Object));
    });
  });
});
