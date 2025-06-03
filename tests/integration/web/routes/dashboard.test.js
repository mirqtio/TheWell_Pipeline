/**
 * Integration tests for Dashboard API routes
 */

const request = require('supertest');
const express = require('express');
const dashboardRoutes = require('../../../../src/web/routes/dashboard');

describe('Dashboard Routes Integration', () => {
  let app;
  let mockDashboardManager;

  beforeEach(() => {
    // Create mock dashboard manager
    mockDashboardManager = {
      isInitialized: true,
      getAllDashboardData: jest.fn(),
      getCostDashboardData: jest.fn(),
      getQualityDashboardData: jest.fn(),
      getOperationalDashboardData: jest.fn(),
      costTracker: { isInitialized: true },
      qualityMetrics: { isInitialized: true }
    };

    // Create Express app
    app = express();
    app.use(express.json());
    
    // Set up dashboard manager
    app.set('dashboardManager', mockDashboardManager);
    
    // Use dashboard routes
    app.use('/api/dashboard', dashboardRoutes);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/dashboard/overview', () => {
    it('should return dashboard overview', async () => {
      const mockOverviewData = {
        lastRefresh: new Date(),
        cost: {
          realTime: {
            dailySpending: 25.50,
            monthlySpending: 750.00,
            budgetStatus: { utilization: 0.75 },
            trends: { trend: 'increasing' }
          }
        },
        quality: {
          realTime: {
            sloCompliance: { overall: 99.5 },
            errorRates: { overall: 0.1 },
            responseTimeMetrics: { average: 150 },
            trends: { trend: 'stable' }
          }
        },
        operational: {
          realTime: {
            uptime: { percentage: 99.9 },
            systemHealth: { status: 'healthy' },
            throughputMetrics: { requestsPerMinute: 120 },
            activeConnections: { total: 45 }
          }
        }
      };

      mockDashboardManager.getAllDashboardData.mockReturnValue(mockOverviewData);

      const response = await request(app)
        .get('/api/dashboard/overview')
        .expect(200);

      expect(response.body).toEqual({
        status: 'healthy',
        lastUpdated: mockOverviewData.lastRefresh.toISOString(),
        summary: {
          cost: {
            dailySpending: 25.50,
            monthlySpending: 750.00,
            budgetUtilization: 0.75,
            trend: 'increasing'
          },
          quality: {
            overallHealth: 99.5,
            errorRate: 0.1,
            avgResponseTime: 150,
            trend: 'stable'
          },
          operational: {
            uptime: 99.9,
            systemHealth: 'healthy',
            throughput: 120,
            activeConnections: 45
          }
        }
      });

      expect(mockDashboardManager.getAllDashboardData).toHaveBeenCalled();
    });

    it('should handle missing dashboard manager', async () => {
      app.set('dashboardManager', null);

      const response = await request(app)
        .get('/api/dashboard/overview')
        .expect(503);

      expect(response.body).toEqual({
        error: 'Dashboard service not available',
        message: 'Dashboard manager is not initialized'
      });
    });

    it('should handle uninitialized dashboard manager', async () => {
      mockDashboardManager.isInitialized = false;

      const response = await request(app)
        .get('/api/dashboard/overview')
        .expect(503);

      expect(response.body).toEqual({
        error: 'Dashboard service not available',
        message: 'Dashboard manager is not initialized'
      });
    });

    it('should handle dashboard manager errors', async () => {
      mockDashboardManager.getAllDashboardData.mockImplementation(() => {
        throw new Error('Dashboard error');
      });

      const response = await request(app)
        .get('/api/dashboard/overview')
        .expect(500);

      expect(response.body).toEqual({
        error: 'Internal server error',
        message: 'Failed to retrieve dashboard overview'
      });
    });

    it('should handle missing data gracefully', async () => {
      mockDashboardManager.getAllDashboardData.mockReturnValue({
        lastRefresh: new Date(),
        cost: { realTime: null },
        quality: { realTime: null },
        operational: { realTime: null }
      });

      const response = await request(app)
        .get('/api/dashboard/overview')
        .expect(200);

      expect(response.body.summary.cost.dailySpending).toBe(0);
      expect(response.body.summary.quality.overallHealth).toBe(100);
      expect(response.body.summary.operational.uptime).toBe(100);
    });
  });

  describe('GET /api/dashboard/cost', () => {
    it('should return cost dashboard data', async () => {
      const mockCostData = {
        realTime: {
          dailySpending: 25.50,
          monthlySpending: 750.00,
          budgetStatus: { utilization: 0.75 }
        },
        historical: [
          { timestamp: '2024-01-01T10:00:00Z', totalCost: 10.50 },
          { timestamp: '2024-01-01T11:00:00Z', totalCost: 12.25 }
        ],
        lastUpdated: new Date()
      };

      mockDashboardManager.getCostDashboardData.mockReturnValue(mockCostData);

      const response = await request(app)
        .get('/api/dashboard/cost')
        .expect(200);

      expect(response.body).toEqual({
        realTime: mockCostData.realTime,
        historical: expect.any(Array),
        metadata: {
          timeRange: '24h',
          granularity: 'hour',
          lastUpdated: mockCostData.lastUpdated.toISOString(),
          dataPoints: expect.any(Number)
        }
      });

      expect(mockDashboardManager.getCostDashboardData).toHaveBeenCalled();
    });

    it('should handle query parameters', async () => {
      const mockCostData = {
        realTime: { dailySpending: 25.50 },
        historical: [],
        lastUpdated: new Date()
      };

      mockDashboardManager.getCostDashboardData.mockReturnValue(mockCostData);

      const response = await request(app)
        .get('/api/dashboard/cost?timeRange=6h&granularity=minute')
        .expect(200);

      expect(response.body.metadata.timeRange).toBe('6h');
      expect(response.body.metadata.granularity).toBe('minute');
    });

    it('should handle service unavailable', async () => {
      mockDashboardManager.isInitialized = false;

      const response = await request(app)
        .get('/api/dashboard/cost')
        .expect(503);

      expect(response.body).toEqual({
        error: 'Dashboard service not available'
      });
    });
  });

  describe('GET /api/dashboard/quality', () => {
    it('should return quality dashboard data', async () => {
      const mockQualityData = {
        realTime: {
          sloCompliance: { overall: 99.5 },
          errorRates: { overall: 0.1 },
          responseTimeMetrics: { average: 150 }
        },
        historical: [
          { timestamp: '2024-01-01T10:00:00Z', errorRate: 0.1 },
          { timestamp: '2024-01-01T11:00:00Z', errorRate: 0.2 }
        ],
        lastUpdated: new Date()
      };

      mockDashboardManager.getQualityDashboardData.mockReturnValue(mockQualityData);

      const response = await request(app)
        .get('/api/dashboard/quality')
        .expect(200);

      expect(response.body).toEqual({
        realTime: mockQualityData.realTime,
        historical: expect.any(Array),
        metadata: {
          timeRange: '24h',
          granularity: 'hour',
          lastUpdated: mockQualityData.lastUpdated.toISOString(),
          dataPoints: expect.any(Number)
        }
      });

      expect(mockDashboardManager.getQualityDashboardData).toHaveBeenCalled();
    });
  });

  describe('GET /api/dashboard/operational', () => {
    it('should return operational dashboard data', async () => {
      const mockOperationalData = {
        realTime: {
          uptime: { percentage: 99.9 },
          systemHealth: { status: 'healthy' },
          throughputMetrics: { requestsPerMinute: 120 }
        },
        lastUpdated: new Date()
      };

      mockDashboardManager.getOperationalDashboardData.mockReturnValue(mockOperationalData);

      const response = await request(app)
        .get('/api/dashboard/operational')
        .expect(200);

      expect(response.body).toEqual({
        realTime: mockOperationalData.realTime,
        metadata: {
          lastUpdated: mockOperationalData.lastUpdated.toISOString()
        }
      });

      expect(mockDashboardManager.getOperationalDashboardData).toHaveBeenCalled();
    });
  });

  describe('GET /api/dashboard/realtime', () => {
    it('should return all real-time metrics by default', async () => {
      const mockDashboardData = {
        cost: { realTime: { dailySpending: 25.50 } },
        quality: { realTime: { errorRate: 0.1 } },
        operational: { realTime: { uptime: 99.9 } }
      };

      mockDashboardManager.getAllDashboardData.mockReturnValue(mockDashboardData);

      const response = await request(app)
        .get('/api/dashboard/realtime')
        .expect(200);

      expect(response.body).toEqual({
        cost: mockDashboardData.cost.realTime,
        quality: mockDashboardData.quality.realTime,
        operational: mockDashboardData.operational.realTime,
        timestamp: expect.any(String)
      });
    });

    it('should filter metrics based on query parameter', async () => {
      const mockDashboardData = {
        cost: { realTime: { dailySpending: 25.50 } },
        quality: { realTime: { errorRate: 0.1 } },
        operational: { realTime: { uptime: 99.9 } }
      };

      mockDashboardManager.getAllDashboardData.mockReturnValue(mockDashboardData);

      const response = await request(app)
        .get('/api/dashboard/realtime?metrics=cost')
        .expect(200);

      expect(response.body).toEqual({
        cost: mockDashboardData.cost.realTime,
        timestamp: expect.any(String)
      });

      expect(response.body.quality).toBeUndefined();
      expect(response.body.operational).toBeUndefined();
    });
  });

  describe('GET /api/dashboard/health', () => {
    it('should return healthy status when dashboard is initialized', async () => {
      const response = await request(app)
        .get('/api/dashboard/health')
        .expect(200);

      expect(response.body).toEqual({
        status: 'healthy',
        timestamp: expect.any(String),
        services: {
          dashboardManager: 'available',
          costTracker: 'available',
          qualityMetrics: 'available'
        }
      });
    });

    it('should return unhealthy status when dashboard is not initialized', async () => {
      mockDashboardManager.isInitialized = false;

      const response = await request(app)
        .get('/api/dashboard/health')
        .expect(503);

      expect(response.body.status).toBe('unhealthy');
    });

    it('should return unavailable status when dashboard manager is missing', async () => {
      app.set('dashboardManager', null);

      const response = await request(app)
        .get('/api/dashboard/health')
        .expect(503);

      expect(response.body).toEqual({
        status: 'unhealthy',
        timestamp: expect.any(String),
        services: {
          dashboardManager: 'unavailable',
          costTracker: 'unavailable',
          qualityMetrics: 'unavailable'
        }
      });
    });

    it('should handle health check errors', async () => {
      // Simulate an error in health check
      app.set('dashboardManager', {
        get isInitialized() {
          throw new Error('Health check error');
        }
      });

      const response = await request(app)
        .get('/api/dashboard/health')
        .expect(500);

      expect(response.body).toEqual({
        status: 'error',
        timestamp: expect.any(String),
        error: 'Health check error'
      });
    });
  });

  describe('CORS headers', () => {
    it('should include CORS headers in responses', async () => {
      mockDashboardManager.getAllDashboardData.mockReturnValue({
        lastRefresh: new Date(),
        cost: { realTime: {} },
        quality: { realTime: {} },
        operational: { realTime: {} }
      });

      const response = await request(app)
        .get('/api/dashboard/overview')
        .expect(200);

      expect(response.headers['access-control-allow-origin']).toBe('*');
      expect(response.headers['access-control-allow-methods']).toBe('GET, OPTIONS');
      expect(response.headers['access-control-allow-headers']).toBe('Content-Type, Authorization');
    });

    it('should handle OPTIONS requests', async () => {
      const response = await request(app)
        .options('/api/dashboard/overview')
        .expect(200);

      expect(response.headers['access-control-allow-origin']).toBe('*');
    });
  });

  describe('Data filtering and aggregation', () => {
    it('should filter data by time range', async () => {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

      const mockCostData = {
        realTime: { dailySpending: 25.50 },
        historical: [
          { timestamp: twoHoursAgo.toISOString(), totalCost: 10.50 },
          { timestamp: oneHourAgo.toISOString(), totalCost: 12.25 },
          { timestamp: now.toISOString(), totalCost: 15.00 }
        ],
        lastUpdated: new Date()
      };

      mockDashboardManager.getCostDashboardData.mockReturnValue(mockCostData);

      const response = await request(app)
        .get('/api/dashboard/cost?timeRange=1h')
        .expect(200);

      // Should only include data from the last hour
      expect(response.body.historical.length).toBeLessThan(3);
      expect(response.body.metadata.timeRange).toBe('1h');
    });

    it('should aggregate data by granularity', async () => {
      const now = new Date();
      const mockCostData = {
        realTime: { dailySpending: 25.50 },
        historical: [
          { timestamp: now.toISOString(), totalCost: 5.25, cost: 5.25 },
          { timestamp: now.toISOString(), totalCost: 7.50, cost: 7.50 },
          { timestamp: now.toISOString(), totalCost: 3.75, cost: 3.75 }
        ],
        lastUpdated: new Date()
      };

      mockDashboardManager.getCostDashboardData.mockReturnValue(mockCostData);

      const response = await request(app)
        .get('/api/dashboard/cost?granularity=hour')
        .expect(200);

      // Data should be aggregated by hour
      expect(response.body.historical).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            timestamp: expect.any(String),
            totalCost: expect.any(Number),
            averageCost: expect.any(Number),
            count: expect.any(Number),
            items: expect.any(Array)
          })
        ])
      );
    });
  });
});
