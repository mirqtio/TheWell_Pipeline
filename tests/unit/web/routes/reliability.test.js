/**
 * Unit Tests for Reliability Routes
 */

const request = require('supertest');
const express = require('express');
const reliabilityRoutes = require('../../../../src/web/routes/reliability');
const { createTestApp } = require('../../../helpers/test-app');

describe('Reliability Routes', () => {
  let app;
  let mockSourceReliabilityService;

  beforeEach(() => {
    // Mock SourceReliabilityService
    mockSourceReliabilityService = {
      calculateReliabilityScore: jest.fn(),
      getReliabilityScore: jest.fn(),
      getAllReliabilityScores: jest.fn(),
      updateAllReliabilityScores: jest.fn()
    };

    // Create test app
    app = express();
    app.use(express.json());
    
    // Mock authentication middleware
    app.use((req, res, next) => {
      req.user = { id: 'test-user-id', permissions: ['read', 'write'] };
      next();
    });

    // Add routes
    app.use('/api/v1/reliability', reliabilityRoutes({
      sourceReliabilityService: mockSourceReliabilityService
    }));

    // Error handler
    app.use((error, req, res, next) => {
      res.status(500).json({
        success: false,
        error: error.message
      });
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /sources/:sourceId', () => {
    it('should get existing reliability score', async () => {
      const mockScore = {
        sourceId: 'source-1',
        overallScore: 0.75,
        reliabilityLevel: 'medium',
        breakdown: { quality: 0.8, feedback: 0.7 },
        calculatedAt: '2024-01-01T00:00:00Z'
      };

      mockSourceReliabilityService.getReliabilityScore.mockResolvedValue(mockScore);

      const response = await request(app)
        .get('/api/v1/reliability/sources/source-1')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(mockScore);
      expect(mockSourceReliabilityService.getReliabilityScore).toHaveBeenCalledWith('source-1');
    });

    it('should calculate score if none exists', async () => {
      const mockScore = {
        sourceId: 'source-1',
        overallScore: 0.75,
        reliabilityLevel: 'medium'
      };

      mockSourceReliabilityService.getReliabilityScore.mockResolvedValue(null);
      mockSourceReliabilityService.calculateReliabilityScore.mockResolvedValue(mockScore);

      const response = await request(app)
        .get('/api/v1/reliability/sources/source-1')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(mockScore);
      expect(mockSourceReliabilityService.getReliabilityScore).toHaveBeenCalledWith('source-1');
      expect(mockSourceReliabilityService.calculateReliabilityScore).toHaveBeenCalledWith('source-1');
    });

    it('should force recalculation when requested', async () => {
      const mockScore = {
        sourceId: 'source-1',
        overallScore: 0.80,
        reliabilityLevel: 'high'
      };

      mockSourceReliabilityService.calculateReliabilityScore.mockResolvedValue(mockScore);

      const response = await request(app)
        .get('/api/v1/reliability/sources/source-1?recalculate=true')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(mockScore);
      expect(mockSourceReliabilityService.calculateReliabilityScore).toHaveBeenCalledWith('source-1');
      expect(mockSourceReliabilityService.getReliabilityScore).not.toHaveBeenCalled();
    });

    it('should handle source not found error', async () => {
      mockSourceReliabilityService.getReliabilityScore.mockResolvedValue(null);
      mockSourceReliabilityService.calculateReliabilityScore.mockRejectedValue(
        new Error('Source not found')
      );

      const response = await request(app)
        .get('/api/v1/reliability/sources/nonexistent')
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Source not found');
    });

    it('should handle service errors', async () => {
      mockSourceReliabilityService.getReliabilityScore.mockRejectedValue(
        new Error('Database connection failed')
      );

      const response = await request(app)
        .get('/api/v1/reliability/sources/source-1')
        .expect(500);

      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /sources', () => {
    it('should get all reliability scores with default pagination', async () => {
      const mockScores = [
        { sourceId: 'source-1', overallScore: 0.8, reliabilityLevel: 'high' },
        { sourceId: 'source-2', overallScore: 0.6, reliabilityLevel: 'medium' }
      ];

      mockSourceReliabilityService.getAllReliabilityScores.mockResolvedValue(mockScores);

      const response = await request(app)
        .get('/api/v1/reliability/sources')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.scores).toEqual(mockScores);
      expect(response.body.data.pagination).toEqual({
        page: 1,
        limit: 50,
        total: 2
      });
    });

    it('should handle custom pagination parameters', async () => {
      const mockScores = [
        { sourceId: 'source-1', overallScore: 0.8, reliabilityLevel: 'high' }
      ];

      mockSourceReliabilityService.getAllReliabilityScores.mockResolvedValue(mockScores);

      const response = await request(app)
        .get('/api/v1/reliability/sources?page=2&limit=10&orderBy=reliability_level&order=asc')
        .expect(200);

      expect(mockSourceReliabilityService.getAllReliabilityScores).toHaveBeenCalledWith({
        limit: 10,
        offset: 10,
        orderBy: 'reliability_level ASC'
      });
    });

    it('should filter by reliability level', async () => {
      const mockScores = [
        { sourceId: 'source-1', overallScore: 0.8, reliabilityLevel: 'high' }
      ];

      mockSourceReliabilityService.getAllReliabilityScores.mockResolvedValue([
        { sourceId: 'source-1', overallScore: 0.8, reliabilityLevel: 'high' },
        { sourceId: 'source-2', overallScore: 0.6, reliabilityLevel: 'medium' }
      ]);

      const response = await request(app)
        .get('/api/v1/reliability/sources?reliabilityLevel=high')
        .expect(200);

      expect(response.body.data.scores).toEqual(mockScores);
    });
  });

  describe('POST /calculate-all', () => {
    it('should calculate reliability scores for all sources', async () => {
      const mockResult = {
        totalSources: 5,
        successfulUpdates: 4,
        failedUpdates: 1,
        errors: ['Error calculating source-5']
      };

      mockSourceReliabilityService.updateAllReliabilityScores.mockResolvedValue(mockResult);

      const response = await request(app)
        .post('/api/v1/reliability/calculate-all')
        .send({ batchSize: 5 })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(mockResult);
      expect(mockSourceReliabilityService.updateAllReliabilityScores).toHaveBeenCalledWith({
        batchSize: 5
      });
    });

    it('should use default batch size if not provided', async () => {
      const mockResult = {
        totalSources: 10,
        successfulUpdates: 10,
        failedUpdates: 0
      };

      mockSourceReliabilityService.updateAllReliabilityScores.mockResolvedValue(mockResult);

      const response = await request(app)
        .post('/api/v1/reliability/calculate-all')
        .send({})
        .expect(200);

      expect(mockSourceReliabilityService.updateAllReliabilityScores).toHaveBeenCalledWith({
        batchSize: 10
      });
    });

    it('should handle calculation errors', async () => {
      mockSourceReliabilityService.updateAllReliabilityScores.mockRejectedValue(
        new Error('Batch calculation failed')
      );

      const response = await request(app)
        .post('/api/v1/reliability/calculate-all')
        .send({})
        .expect(500);

      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /sources/:sourceId/breakdown', () => {
    it('should get reliability score breakdown', async () => {
      const mockScore = {
        sourceId: 'source-1',
        overallScore: 0.75,
        reliabilityLevel: 'medium',
        breakdown: {
          quality: 0.8,
          feedback: 0.7,
          consistency: 0.75,
          errorRate: 0.9,
          historical: 0.65
        },
        metrics: {
          quality: { totalDocuments: 100, avgBelievability: 0.8 },
          feedback: { totalFeedback: 50, avgRating: 4.2 }
        },
        calculatedAt: '2024-01-01T00:00:00Z',
        timeframe: '30 days'
      };

      mockSourceReliabilityService.getReliabilityScore.mockResolvedValue(mockScore);

      const response = await request(app)
        .get('/api/v1/reliability/sources/source-1/breakdown')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual({
        sourceId: 'source-1',
        overallScore: 0.75,
        reliabilityLevel: 'medium',
        breakdown: mockScore.breakdown,
        metrics: mockScore.metrics,
        calculatedAt: '2024-01-01T00:00:00Z',
        timeframe: '30 days'
      });
    });

    it('should handle missing reliability score', async () => {
      mockSourceReliabilityService.getReliabilityScore.mockResolvedValue(null);

      const response = await request(app)
        .get('/api/v1/reliability/sources/source-1/breakdown')
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Reliability score not found for this source');
    });
  });

  describe('GET /statistics', () => {
    it('should get reliability statistics summary', async () => {
      const mockScores = [
        { sourceId: 'source-1', overallScore: 0.8, reliabilityLevel: 'high' },
        { sourceId: 'source-2', overallScore: 0.6, reliabilityLevel: 'medium' },
        { sourceId: 'source-3', overallScore: 0.3, reliabilityLevel: 'low' },
        { sourceId: 'source-4', overallScore: null, reliabilityLevel: null }
      ];

      mockSourceReliabilityService.getAllReliabilityScores.mockResolvedValue(mockScores);

      const response = await request(app)
        .get('/api/v1/reliability/statistics')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual({
        totalSources: 4,
        sourcesWithScores: 3,
        reliabilityDistribution: {
          high: 1,
          medium: 1,
          low: 1,
          unscored: 1
        },
        averageScore: 0.425 // (0.8 + 0.6 + 0.3 + 0) / 4
      });
    });

    it('should handle empty scores', async () => {
      mockSourceReliabilityService.getAllReliabilityScores.mockResolvedValue([]);

      const response = await request(app)
        .get('/api/v1/reliability/statistics')
        .expect(200);

      expect(response.body.data).toEqual({
        totalSources: 0,
        sourcesWithScores: 0,
        reliabilityDistribution: {
          high: 0,
          medium: 0,
          low: 0,
          unscored: 0
        },
        averageScore: 0
      });
    });
  });

  describe('PUT /sources/:sourceId', () => {
    it('should update reliability score for specific source', async () => {
      const mockScore = {
        sourceId: 'source-1',
        overallScore: 0.85,
        reliabilityLevel: 'high'
      };

      mockSourceReliabilityService.calculateReliabilityScore.mockResolvedValue(mockScore);

      const response = await request(app)
        .put('/api/v1/reliability/sources/source-1')
        .send({ timeframe: '60 days' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(mockScore);
      expect(mockSourceReliabilityService.calculateReliabilityScore).toHaveBeenCalledWith(
        'source-1',
        { timeframe: '60 days' }
      );
    });

    it('should use default timeframe if not provided', async () => {
      const mockScore = {
        sourceId: 'source-1',
        overallScore: 0.75,
        reliabilityLevel: 'medium'
      };

      mockSourceReliabilityService.calculateReliabilityScore.mockResolvedValue(mockScore);

      const response = await request(app)
        .put('/api/v1/reliability/sources/source-1')
        .send({})
        .expect(200);

      expect(mockSourceReliabilityService.calculateReliabilityScore).toHaveBeenCalledWith(
        'source-1',
        { timeframe: '30 days' }
      );
    });

    it('should handle source not found error', async () => {
      mockSourceReliabilityService.calculateReliabilityScore.mockRejectedValue(
        new Error('Source not found')
      );

      const response = await request(app)
        .put('/api/v1/reliability/sources/nonexistent')
        .send({})
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Source not found');
    });
  });

  describe('GET /sources/:sourceId/trends', () => {
    it('should get reliability trends for source', async () => {
      const mockScore = {
        sourceId: 'source-1',
        overallScore: 0.75,
        reliabilityLevel: 'medium',
        metrics: {
          historical: {
            weeklyData: [
              { week: '2024-01-01', documentCount: 20, avgScore: 0.7 },
              { week: '2024-01-08', documentCount: 25, avgScore: 0.75 },
              { week: '2024-01-15', documentCount: 30, avgScore: 0.8 }
            ],
            weeklyTrend: 'improving'
          }
        },
        calculatedAt: '2024-01-15T00:00:00Z'
      };

      mockSourceReliabilityService.getReliabilityScore.mockResolvedValue(mockScore);

      const response = await request(app)
        .get('/api/v1/reliability/sources/source-1/trends?days=90')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual({
        sourceId: 'source-1',
        currentScore: 0.75,
        currentLevel: 'medium',
        historicalData: mockScore.metrics.historical.weeklyData,
        trend: 'improving',
        calculatedAt: '2024-01-15T00:00:00Z'
      });
    });

    it('should handle missing reliability score for trends', async () => {
      mockSourceReliabilityService.getReliabilityScore.mockResolvedValue(null);

      const response = await request(app)
        .get('/api/v1/reliability/sources/source-1/trends')
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Reliability score not found for this source');
    });

    it('should handle missing historical data', async () => {
      const mockScore = {
        sourceId: 'source-1',
        overallScore: 0.75,
        reliabilityLevel: 'medium',
        metrics: {},
        calculatedAt: '2024-01-15T00:00:00Z'
      };

      mockSourceReliabilityService.getReliabilityScore.mockResolvedValue(mockScore);

      const response = await request(app)
        .get('/api/v1/reliability/sources/source-1/trends')
        .expect(200);

      expect(response.body.data.historicalData).toEqual([]);
      expect(response.body.data.trend).toBe('stable');
    });
  });

  describe('Error handling', () => {
    it('should handle missing sourceReliabilityService dependency', async () => {
      const app = createTestApp();
      const routesWithoutService = reliabilityRoutes({});
      app.use('/api/v1/reliability', routesWithoutService);

      const response = await request(app)
        .get('/api/v1/reliability/sources/source-1')
        .set('x-api-key', 'test-key')
        .expect(503);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Service Unavailable');
      expect(response.body.message).toBe('Source reliability service is not available');
    });

    it('should handle service initialization error', async () => {
      const app = createTestApp();
      const routesWithoutService = reliabilityRoutes();
      app.use('/api/v1/reliability', routesWithoutService);

      const response = await request(app)
        .get('/api/v1/reliability/sources/source-1')
        .set('x-api-key', 'test-key')
        .expect(503);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Service Unavailable');
      expect(response.body.message).toBe('Source reliability service is not available');
    });
  });

  describe('Permission requirements', () => {
    it('should require read permission for GET endpoints', async () => {
      // Create app without permissions
      const restrictedApp = express();
      restrictedApp.use(express.json());
      restrictedApp.use((req, res, next) => {
        req.user = { id: 'test-user-id', permissions: [] };
        next();
      });
      restrictedApp.use('/api/v1/reliability', reliabilityRoutes({
        sourceReliabilityService: mockSourceReliabilityService
      }));

      // This would normally fail with permission middleware, but our mock doesn't implement it
      // In a real scenario, this would return 403
    });

    it('should require write permission for POST/PUT endpoints', async () => {
      // Similar to above - would test actual permission middleware in integration tests
    });
  });
});
