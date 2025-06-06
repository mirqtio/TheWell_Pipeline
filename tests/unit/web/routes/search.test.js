/**
 * Unit tests for search API routes
 */

const request = require('supertest');
const express = require('express');
const { router, initializeSearchRoutes } = require('../../../../src/web/routes/search');
const SearchService = require('../../../../src/services/SearchService');

// Mock SearchService
jest.mock('../../../../src/services/SearchService');

// Mock auth middleware
jest.mock('../../../../src/web/middleware/auth', () => (req, res, next) => {
  req.user = { id: 'test-user', role: req.headers['x-test-role'] || 'user' };
  next();
});

describe('Search API Routes', () => {
  let app;
  let mockSearchService;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Create mock search service
    mockSearchService = {
      search: jest.fn(),
      getSuggestions: jest.fn(),
      trackSearchClick: jest.fn(),
      getSearchAnalytics: jest.fn(),
      indexDocument: jest.fn(),
      batchIndexDocuments: jest.fn(),
      getStatus: jest.fn()
    };

    // Initialize express app with routes
    app = express();
    app.use(express.json());
    app.use('/api', initializeSearchRoutes(mockSearchService));
  });

  describe('POST /api/search', () => {
    it('should perform search with valid parameters', async () => {
      const mockResults = {
        mode: 'hybrid',
        total: 2,
        items: [
          {
            id: '1',
            title: 'Test Document',
            content: 'Test content',
            relevance_score: 0.9,
            quality_score: 0.8
          }
        ],
        facets: {}
      };

      mockSearchService.search.mockResolvedValue(mockResults);

      const response = await request(app)
        .post('/api/search')
        .send({
          query: 'test query',
          mode: 'hybrid',
          limit: 20,
          offset: 0
        });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        query: 'test query',
        mode: 'hybrid',
        total: 2,
        limit: 20,
        offset: 0,
        items: expect.any(Array)
      });
      expect(mockSearchService.search).toHaveBeenCalledWith('test query', expect.any(Object));
    });

    it('should validate query parameter', async () => {
      const response = await request(app)
        .post('/api/search')
        .send({
          query: '',
          mode: 'hybrid'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid query');
    });

    it('should validate search mode', async () => {
      const response = await request(app)
        .post('/api/search')
        .send({
          query: 'test',
          mode: 'invalid-mode'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid search mode');
    });

    it('should validate limit parameter', async () => {
      const response = await request(app)
        .post('/api/search')
        .send({
          query: 'test',
          limit: 150
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid limit');
    });

    it('should apply filters', async () => {
      mockSearchService.search.mockResolvedValue({ items: [], total: 0 });

      await request(app)
        .post('/api/search')
        .send({
          query: 'test',
          filters: {
            author: 'John Doe',
            dateFrom: '2024-01-01',
            dateTo: '2024-12-31',
            minQuality: 0.7,
            tags: ['ai', 'ml']
          }
        });

      expect(mockSearchService.search).toHaveBeenCalledWith('test', expect.objectContaining({
        filters: expect.objectContaining({
          author: 'John Doe',
          minQuality: 0.7,
          tags: ['ai', 'ml']
        })
      }));
    });

    it('should handle search errors', async () => {
      mockSearchService.search.mockRejectedValue(new Error('Search failed'));

      const response = await request(app)
        .post('/api/search')
        .send({ query: 'test' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Search failed');
    });
  });

  describe('GET /api/search/suggestions', () => {
    it('should get search suggestions', async () => {
      const mockSuggestions = [
        { suggestion_text: 'artificial intelligence', suggestion_type: 'query', relevance_score: 0.9 },
        { suggestion_text: 'artificial neural network', suggestion_type: 'completion', relevance_score: 0.8 }
      ];

      mockSearchService.getSuggestions.mockResolvedValue(mockSuggestions);

      const response = await request(app)
        .get('/api/search/suggestions')
        .query({ q: 'arti', limit: 5 });

      expect(response.status).toBe(200);
      expect(response.body.suggestions).toHaveLength(2);
      expect(response.body.suggestions[0].text).toBe('artificial intelligence');
    });

    it('should return empty suggestions for short queries', async () => {
      const response = await request(app)
        .get('/api/search/suggestions')
        .query({ q: 'a' });

      expect(response.status).toBe(200);
      expect(response.body.suggestions).toEqual([]);
      expect(mockSearchService.getSuggestions).not.toHaveBeenCalled();
    });

    it('should limit suggestions count', async () => {
      mockSearchService.getSuggestions.mockResolvedValue([]);

      await request(app)
        .get('/api/search/suggestions')
        .query({ q: 'test', limit: 30 });

      expect(mockSearchService.getSuggestions).toHaveBeenCalledWith('test', { limit: 20 });
    });
  });

  describe('POST /api/search/advanced', () => {
    it('should perform advanced search with AND operator', async () => {
      mockSearchService.search.mockResolvedValue({ items: [], total: 0 });

      const response = await request(app)
        .post('/api/search/advanced')
        .send({
          queries: [
            { query: 'artificial intelligence' },
            { query: 'machine learning' }
          ],
          operator: 'AND'
        });

      expect(response.status).toBe(200);
      expect(mockSearchService.search).toHaveBeenCalledWith(
        '(artificial intelligence) AND (machine learning)',
        expect.any(Object)
      );
    });

    it('should perform advanced search with OR operator', async () => {
      mockSearchService.search.mockResolvedValue({ items: [], total: 0 });

      const response = await request(app)
        .post('/api/search/advanced')
        .send({
          queries: [
            { query: 'database' },
            { query: 'storage' }
          ],
          operator: 'OR'
        });

      expect(response.status).toBe(200);
      expect(mockSearchService.search).toHaveBeenCalledWith(
        '(database) OR (storage)',
        expect.any(Object)
      );
    });

    it('should validate queries array', async () => {
      const response = await request(app)
        .post('/api/search/advanced')
        .send({
          queries: [],
          operator: 'AND'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid queries');
    });

    it('should validate operator', async () => {
      const response = await request(app)
        .post('/api/search/advanced')
        .send({
          queries: [{ query: 'test' }],
          operator: 'XOR'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid operator');
    });
  });

  describe('POST /api/search/click', () => {
    it('should track search result click', async () => {
      mockSearchService.trackSearchClick.mockResolvedValue(true);

      const response = await request(app)
        .post('/api/search/click')
        .send({
          queryId: 'query123',
          documentId: 'doc456'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockSearchService.trackSearchClick).toHaveBeenCalledWith(
        'query123',
        'doc456',
        'test-user'
      );
    });

    it('should validate required parameters', async () => {
      const response = await request(app)
        .post('/api/search/click')
        .send({ queryId: 'query123' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Missing parameters');
    });
  });

  describe('GET /api/search/analytics', () => {
    it('should get analytics for admin users', async () => {
      const mockAnalytics = [
        { date: '2024-01-01', total_queries: 100, unique_users: 50 }
      ];

      mockSearchService.getSearchAnalytics.mockResolvedValue(mockAnalytics);

      const response = await request(app)
        .get('/api/search/analytics')
        .set('x-test-role', 'admin')
        .query({
          startDate: '2024-01-01',
          endDate: '2024-01-31'
        });

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual(mockAnalytics);
      expect(mockSearchService.getSearchAnalytics).toHaveBeenCalledWith({
        startDate: '2024-01-01',
        endDate: '2024-01-31',
        groupBy: 'day'
      });
    });

    it('should reject non-admin users', async () => {
      const response = await request(app)
        .get('/api/search/analytics')
        .set('x-test-role', 'user');

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Forbidden');
    });
  });

  describe('GET /api/search/popular', () => {
    it('should get popular searches', async () => {
      const response = await request(app)
        .get('/api/search/popular')
        .query({ limit: 5, period: 'week' });

      expect(response.status).toBe(200);
      expect(response.body.searches).toHaveLength(5);
      expect(response.body.period).toBe('week');
    });
  });

  describe('GET /api/search/facets', () => {
    it('should get search facets', async () => {
      const response = await request(app)
        .get('/api/search/facets')
        .query({ types: ['author', 'tags'] });

      expect(response.status).toBe(200);
      expect(response.body.facets).toHaveProperty('author');
      expect(response.body.facets).toHaveProperty('tags');
      expect(response.body.facets).not.toHaveProperty('categories');
    });
  });

  describe('POST /api/search/index', () => {
    it('should index document for admin users', async () => {
      mockSearchService.indexDocument.mockResolvedValue(true);

      const response = await request(app)
        .post('/api/search/index')
        .set('x-test-role', 'admin')
        .send({
          documentId: 'doc123',
          document: {
            title: 'Test Document',
            content: 'Test content'
          }
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockSearchService.indexDocument).toHaveBeenCalledWith('doc123', expect.any(Object));
    });

    it('should reject non-admin users', async () => {
      const response = await request(app)
        .post('/api/search/index')
        .set('x-test-role', 'user')
        .send({
          documentId: 'doc123',
          document: {}
        });

      expect(response.status).toBe(403);
    });

    it('should validate required parameters', async () => {
      const response = await request(app)
        .post('/api/search/index')
        .set('x-test-role', 'admin')
        .send({ documentId: 'doc123' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Missing parameters');
    });
  });

  describe('POST /api/search/index/batch', () => {
    it('should batch index documents for admin users', async () => {
      mockSearchService.batchIndexDocuments.mockResolvedValue({
        total: 3,
        successful: 3,
        failed: 0
      });

      const response = await request(app)
        .post('/api/search/index/batch')
        .set('x-test-role', 'admin')
        .send({
          documents: [
            { id: '1', title: 'Doc 1' },
            { id: '2', title: 'Doc 2' },
            { id: '3', title: 'Doc 3' }
          ]
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.total).toBe(3);
      expect(response.body.successful).toBe(3);
    });

    it('should validate documents array', async () => {
      const response = await request(app)
        .post('/api/search/index/batch')
        .set('x-test-role', 'admin')
        .send({ documents: [] });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid documents');
    });
  });

  describe('GET /api/search/status', () => {
    it('should get service status for admin users', async () => {
      const mockStatus = {
        initialized: true,
        searchEngine: 'ready',
        database: 'connected'
      };

      mockSearchService.getStatus.mockResolvedValue(mockStatus);

      const response = await request(app)
        .get('/api/search/status')
        .set('x-test-role', 'admin');

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockStatus);
    });

    it('should reject non-admin users', async () => {
      const response = await request(app)
        .get('/api/search/status')
        .set('x-test-role', 'user');

      expect(response.status).toBe(403);
    });
  });

  describe('Error Handling', () => {
    it('should handle service errors gracefully', async () => {
      mockSearchService.search.mockRejectedValue(new Error('Service unavailable'));

      const response = await request(app)
        .post('/api/search')
        .send({ query: 'test' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Search failed');
      expect(response.body.message).toBeDefined();
    });
  });
});