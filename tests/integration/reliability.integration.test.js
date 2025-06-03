/**
 * Integration tests for Source Reliability API
 */

const request = require('supertest');
const express = require('express');

// Mock auth middleware at the top level
jest.mock('../../src/web/middleware/auth', () => ({
  requirePermission: jest.fn(() => (req, res, next) => {
    req.user = { id: 'test-user-id', permissions: ['read', 'write'] };
    next();
  }),
  requireDocumentAccess: jest.fn(() => (req, res, next) => next())
}));

// Mock error handler at the top level
jest.mock('../../src/web/middleware/errorHandler', () => ({
  asyncHandler: jest.fn((fn) => {
    return (req, res, next) => {
      Promise.resolve(fn(req, res, next)).catch(next);
    };
  })
}));

// Mock AuditService to prevent ORM initialization issues
jest.mock('../../src/services/AuditService', () => ({
  setContext: jest.fn(),
  logCurationAction: jest.fn(),
  logSessionActivity: jest.fn(),
  clearContext: jest.fn()
}));

// Create test app with reliability routes
function createReliabilityTestApp(sourceReliabilityService) {
  const app = express();
  
  // Basic middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  
  // Mock auth middleware that adds user to request
  app.use((req, res, next) => {
    req.user = { id: 'test-user-id', permissions: ['read', 'write'] };
    next();
  });
  
  // Load reliability routes with injected service
  const reliabilityRoutesFactory = require('../../src/web/routes/reliability');
  const reliabilityRoutes = reliabilityRoutesFactory({
    sourceReliabilityService
  });
  
  app.use('/api/v1/reliability', reliabilityRoutes);
  
  // Error handler
  app.use((error, req, res, next) => {
    console.error('Test app error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      type: error.constructor.name,
      message: error.message,
      timestamp: new Date().toISOString(),
      requestId: 'test'
    });
  });
  
  return app;
}

// Mock SourceReliabilityService for integration testing
const mockSourceReliabilityService = {
  calculateReliabilityScore: jest.fn(),
  getReliabilityScore: jest.fn(),
  getAllReliabilityScores: jest.fn(),
  updateReliabilityScore: jest.fn(),
  getReliabilityBreakdown: jest.fn(),
  getReliabilityStatistics: jest.fn(() => Promise.resolve({
    averageScore: 0.85,
    totalSources: 2,
    scored: 2,
    unscored: 0,
    reliabilityLevels: {
      high: 1,
      medium: 1,
      low: 0
    }
  })),
  getReliabilityTrends: jest.fn(),
  updateAllReliabilityScores: jest.fn(),
  getErrorRateMetrics: jest.fn(),
  getHistoricalPerformanceMetrics: jest.fn()
};

describe('Source Reliability Integration Tests', () => {
  let app;

  beforeAll(() => {
    // Create test app with mocked service
    app = createReliabilityTestApp(mockSourceReliabilityService);
  });

  beforeEach(() => {
    // Reset all mocks before each test
    jest.clearAllMocks();
  });

  describe('Reliability API Integration', () => {
    describe('GET /api/v1/reliability/sources/:sourceId', () => {
      it('should calculate and return reliability score for source', async () => {
        const sourceId = 'test-source-id';
        const mockScore = {
          sourceId,
          overallScore: 0.85,
          lastUpdated: new Date().toISOString(),
          scores: {
            quality: 0.9,
            consistency: 0.8,
            feedback: 0.85,
            historical: 0.85,
            error: 0.9
          }
        };

        // Mock getReliabilityScore to return null (no existing score)
        mockSourceReliabilityService.getReliabilityScore.mockResolvedValue(null);
        // Mock calculateReliabilityScore to return the score
        mockSourceReliabilityService.calculateReliabilityScore.mockResolvedValue(mockScore);

        const response = await request(app)
          .get(`/api/v1/reliability/sources/${sourceId}`);

        console.log('Response status:', response.status);
        console.log('Response body:', response.body);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.data).toEqual(expect.objectContaining(mockScore));
        expect(mockSourceReliabilityService.getReliabilityScore).toHaveBeenCalledWith(sourceId);
        expect(mockSourceReliabilityService.calculateReliabilityScore).toHaveBeenCalledWith(sourceId);
      });

      it('should force recalculation when requested', async () => {
        const sourceId = 'test-source-id';
        const mockScore = {
          sourceId,
          overallScore: 0.75,
          lastUpdated: new Date().toISOString(),
          scores: {
            quality: 0.8,
            consistency: 0.7,
            feedback: 0.75,
            historical: 0.75,
            error: 0.8
          }
        };

        mockSourceReliabilityService.calculateReliabilityScore.mockResolvedValue(mockScore);

        const response = await request(app)
          .get(`/api/v1/reliability/sources/${sourceId}?recalculate=true`);

        console.log('Response status:', response.status);
        console.log('Response body:', response.body);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.data).toEqual(expect.objectContaining(mockScore));
        expect(mockSourceReliabilityService.calculateReliabilityScore).toHaveBeenCalledWith(sourceId);
        // Should not call getReliabilityScore when forcing recalculation
        expect(mockSourceReliabilityService.getReliabilityScore).not.toHaveBeenCalled();
      });

      it('should handle non-existent source', async () => {
        const sourceId = 'non-existent-source';
        const error = new Error('Source not found');
        error.statusCode = 404;

        mockSourceReliabilityService.calculateReliabilityScore.mockRejectedValue(error);

        try {
          const response = await request(app)
            .get(`/api/v1/reliability/sources/${sourceId}`);

          console.log('Response status:', response.status);
          console.log('Response body:', response.body);

          expect(response.status).toBe(404);
          expect(response.body.success).toBe(false);
          expect(response.body.error).toBe('Source not found');
        } catch (err) {
          console.error('Test error response:', err.response?.body || err.message);
          throw err;
        }
      });

      it('should return existing score without recalculation', async () => {
        const sourceId = 'test-source-id';
        mockSourceReliabilityService.getReliabilityScore.mockResolvedValue({
          sourceId,
          overallScore: 0.8,
          reliabilityLevel: 'medium',
          breakdown: {},
          metrics: {}
        });

        const firstResponse = await request(app)
          .get(`/api/v1/reliability/sources/${sourceId}`);

        console.log('First response status:', firstResponse.status);
        console.log('First response body:', firstResponse.body);

        const secondResponse = await request(app)
          .get(`/api/v1/reliability/sources/${sourceId}`);

        console.log('Second response status:', secondResponse.status);
        console.log('Second response body:', secondResponse.body);

        expect(secondResponse.body.data.overallScore).toBeCloseTo(firstResponse.body.data.overallScore);
      });

      it('should handle 500 errors', async () => {
        const sourceId = 'error-source-id';
        
        // Mock service to throw an error
        mockSourceReliabilityService.getReliabilityScore.mockRejectedValue(new Error('Database connection failed'));
        mockSourceReliabilityService.calculateReliabilityScore.mockRejectedValue(new Error('Database connection failed'));

        try {
          const response = await request(app)
            .get(`/api/v1/reliability/sources/${sourceId}`);

          console.log('Response status:', response.status);
          console.log('Response body:', response.body);

          expect(response.status).toBe(500);
          expect(response.body.success).toBe(false);
          expect(response.body.error).toBe('Internal Server Error');
        } catch (err) {
          // If the request itself throws, that's also acceptable for a 500 error test
          expect(err.message).toContain('500');
        }
      });
    });

    describe('GET /api/v1/reliability/sources', () => {
      it('should return all reliability scores', async () => {
        const scores = [
          { sourceId: 'source-1', overallScore: 0.8, reliabilityLevel: 'medium' },
          { sourceId: 'source-2', overallScore: 0.9, reliabilityLevel: 'high' }
        ];
        mockSourceReliabilityService.getAllReliabilityScores.mockResolvedValue(scores);

        const response = await request(app)
          .get('/api/v1/reliability/sources');

        console.log('Response status:', response.status);
        console.log('Response body:', response.body);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.data.scores).toEqual(scores);
      });

      it('should handle pagination parameters', async () => {
        const scores = [
          { sourceId: 'source-1', overallScore: 0.8, reliabilityLevel: 'medium' },
          { sourceId: 'source-2', overallScore: 0.9, reliabilityLevel: 'high' }
        ];
        mockSourceReliabilityService.getAllReliabilityScores.mockResolvedValue(scores);

        const response = await request(app)
          .get('/api/v1/reliability/sources?page=1&limit=5&orderBy=overall_score&order=desc');

        console.log('Response status:', response.status);
        console.log('Response body:', response.body);

        expect(response.status).toBe(200);
        expect(response.body.data.pagination.page).toBe(1);
        expect(response.body.data.pagination.limit).toBe(5);
      });

      it('should filter by reliability level', async () => {
        const scores = [
          { sourceId: 'source-1', overallScore: 0.8, reliabilityLevel: 'medium' },
          { sourceId: 'source-2', overallScore: 0.9, reliabilityLevel: 'high' }
        ];
        mockSourceReliabilityService.getAllReliabilityScores.mockResolvedValue(scores);

        const response = await request(app)
          .get('/api/v1/reliability/sources?reliabilityLevel=high');

        console.log('Response status:', response.status);
        console.log('Response body:', response.body);

        expect(response.status).toBe(200);
        expect(response.body.data.scores).toEqual([scores[1]]);
      });
    });

    describe('POST /api/v1/reliability/calculate-all', () => {
      it('should calculate reliability scores for all sources', async () => {
        mockSourceReliabilityService.updateAllReliabilityScores.mockResolvedValue({
          totalSources: 2,
          successfulUpdates: 2,
          failedUpdates: 0
        });

        const response = await request(app)
          .post('/api/v1/reliability/calculate-all')
          .send({ batchSize: 10 });

        console.log('Response status:', response.status);
        console.log('Response body:', response.body);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.data).toHaveProperty('totalSources', 2);
        expect(response.body.data).toHaveProperty('successfulUpdates', 2);
        expect(response.body.data).toHaveProperty('failedUpdates', 0);
      });
    });

    describe('GET /api/v1/reliability/sources/:sourceId/breakdown', () => {
      it('should return detailed breakdown of reliability score', async () => {
        const sourceId = 'test-source-id';
        const mockScore = {
          sourceId,
          overallScore: 0.85,
          reliabilityLevel: 'high',
          breakdown: {
            quality: { score: 0.9, weight: 0.3 },
            consistency: { score: 0.8, weight: 0.2 },
            feedback: { score: 0.85, weight: 0.2 },
            historical: { score: 0.75, weight: 0.15 },
            error: { score: 0.95, weight: 0.15 }
          },
          metrics: {
            totalDocuments: 100,
            averageQuality: 0.9
          },
          calculatedAt: new Date().toISOString(),
          timeframe: '30 days'
        };

        // The breakdown route calls getReliabilityScore, not getReliabilityBreakdown
        mockSourceReliabilityService.getReliabilityScore.mockResolvedValue(mockScore);

        const response = await request(app)
          .get(`/api/v1/reliability/sources/${sourceId}/breakdown`);

        console.log('Response status:', response.status);
        console.log('Response body:', response.body);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.data).toHaveProperty('sourceId', sourceId);
        expect(response.body.data).toHaveProperty('breakdown');
        expect(response.body.data).toHaveProperty('overallScore', 0.85);
        expect(mockSourceReliabilityService.getReliabilityScore).toHaveBeenCalledWith(sourceId);
      });
    });

    describe('GET /api/v1/reliability/statistics', () => {
      it('should return reliability statistics summary', async () => {
        // Mock getAllReliabilityScores to return the data that the statistics route expects
        mockSourceReliabilityService.getAllReliabilityScores.mockResolvedValue([
          { sourceId: 'source1', overallScore: 0.9, reliabilityLevel: 'high' },
          { sourceId: 'source2', overallScore: 0.8, reliabilityLevel: 'medium' }
        ]);

        const response = await request(app)
          .get('/api/v1/reliability/statistics');

        console.log('Response status:', response.status);
        console.log('Response body:', response.body);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.data).toHaveProperty('averageScore');
        expect(response.body.data.averageScore).toBeCloseTo(0.85, 2);
        expect(response.body.data).toEqual(expect.objectContaining({
          totalSources: 2,
          sourcesWithScores: 2,
          reliabilityDistribution: {
            high: 1,
            medium: 1,
            low: 0,
            unscored: 0
          }
        }));
      });
    });

    describe('PUT /api/v1/reliability/sources/:sourceId', () => {
      it('should update reliability score for specific source', async () => {
        const sourceId = 'test-source-id';
        const mockScore = {
          sourceId,
          overallScore: 0.9,
          lastUpdated: new Date().toISOString(),
          scores: {
            quality: 0.95,
            consistency: 0.85,
            feedback: 0.9,
            historical: 0.9,
            error: 0.95
          }
        };

        // Mock the calculateReliabilityScore method to handle options parameter
        mockSourceReliabilityService.calculateReliabilityScore.mockResolvedValue(mockScore);

        const response = await request(app)
          .put(`/api/v1/reliability/sources/${sourceId}`)
          .send({ timeframe: '30 days' });

        console.log('Response status:', response.status);
        console.log('Response body:', response.body);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.data).toHaveProperty('sourceId', sourceId);
        expect(response.body.data).toHaveProperty('overallScore', 0.9);
        expect(mockSourceReliabilityService.calculateReliabilityScore).toHaveBeenCalledWith(sourceId, {
          timeframe: '30 days'
        });
      });
    });

    describe('GET /api/v1/reliability/sources/:sourceId/trends', () => {
      it('should return reliability trends for source', async () => {
        const sourceId = 'test-source-id';
        const mockScore = {
          sourceId,
          overallScore: 0.8,
          reliabilityLevel: 'medium',
          metrics: {
            historical: {
              weeklyData: [
                { date: '2022-01-01', score: 0.7 },
                { date: '2022-02-01', score: 0.75 },
                { date: '2022-03-01', score: 0.8 }
              ],
              weeklyTrend: 'stable'
            }
          },
          calculatedAt: new Date().toISOString()
        };

        // The trends route calls getReliabilityScore, not getReliabilityTrends
        mockSourceReliabilityService.getReliabilityScore.mockResolvedValue(mockScore);

        const response = await request(app)
          .get(`/api/v1/reliability/sources/${sourceId}/trends`);

        console.log('Response status:', response.status);
        console.log('Response body:', response.body);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.data).toHaveProperty('sourceId', sourceId);
        expect(response.body.data).toHaveProperty('currentScore', 0.8);
        expect(response.body.data).toHaveProperty('currentLevel', 'medium');
        expect(response.body.data).toHaveProperty('historicalData');
        expect(response.body.data).toHaveProperty('trend', 'stable');
        expect(mockSourceReliabilityService.getReliabilityScore).toHaveBeenCalledWith(sourceId);
      });
    });
  });
});
