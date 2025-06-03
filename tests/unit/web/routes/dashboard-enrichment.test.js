const request = require('supertest');
const express = require('express');
const dashboardRoutes = require('../../../../src/web/routes/dashboard');

describe('Dashboard Enrichment API', () => {
  let app;
  let mockDashboardManager;

  beforeEach(() => {
    app = express();
    
    // Mock dashboard manager
    mockDashboardManager = {
      enrichmentManager: {
        getStatistics: jest.fn(),
        getProviderStatistics: jest.fn(),
        getQueueStatus: jest.fn()
      }
    };

    // Set up app locals
    app.locals.dashboardManager = mockDashboardManager;
    
    // Use dashboard routes
    app.use('/api/dashboard', dashboardRoutes);
  });

  describe('GET /api/dashboard/admin/data/enrichment', () => {
    it('should return enrichment pipeline data with real statistics when available', async () => {
      // Mock real data
      const mockPipelineStats = {
        documentsIngested: 200,
        ingestedQueue: 5,
        ingestionErrors: 1,
        avgIngestionTime: 1.5,
        ingestionThroughput: 50,
        entitiesExtracted: 180,
        extractionQueue: 10,
        extractionErrors: 2,
        avgExtractionTime: 3.0,
        extractionThroughput: 40,
        documentsEnriched: 150,
        enrichmentQueue: 20,
        enrichmentErrors: 5,
        avgEnrichmentTime: 9.0,
        enrichmentThroughput: 25,
        documentsEmbedded: 145,
        embeddingQueue: 5,
        embeddingErrors: 1,
        avgEmbeddingTime: 2.0,
        embeddingThroughput: 45,
        documentsStored: 145,
        storageQueue: 0,
        storageErrors: 0,
        avgStorageTime: 0.6,
        storageThroughput: 50,
        totalProcessed: 145,
        totalQueued: 40,
        totalErrors: 9,
        overallThroughput: 40,
        avgEndToEndTime: 16.1,
        successRate: 94.1
      };

      const mockProviderStats = [
        {
          id: 'openai',
          name: 'OpenAI',
          status: 'healthy',
          responseTime: 250,
          successRate: 99.1,
          requestsToday: 1300,
          costToday: 19.50,
          modelsUsed: ['gpt-4', 'gpt-3.5-turbo'],
          currentLoad: 0.70
        }
      ];

      const mockQueueStatus = {
        recentActivity: [
          {
            timestamp: new Date().toISOString(),
            type: 'success',
            stage: 'enrichment',
            message: 'Completed batch enrichment of 30 documents',
            provider: 'openai',
            documentsProcessed: 30
          }
        ]
      };

      mockDashboardManager.enrichmentManager.getStatistics.mockResolvedValue(mockPipelineStats);
      mockDashboardManager.enrichmentManager.getProviderStatistics.mockResolvedValue(mockProviderStats);
      mockDashboardManager.enrichmentManager.getQueueStatus.mockResolvedValue(mockQueueStatus);

      const response = await request(app)
        .get('/api/dashboard/admin/data/enrichment')
        .expect(200);

      expect(response.body).toHaveProperty('pipeline');
      expect(response.body).toHaveProperty('providers');
      expect(response.body).toHaveProperty('strategies');
      expect(response.body).toHaveProperty('recentActivity');

      // Check pipeline structure
      expect(response.body.pipeline).toHaveProperty('stages');
      expect(response.body.pipeline).toHaveProperty('metrics');
      expect(response.body.pipeline.stages).toHaveLength(5);

      // Verify stage data uses real statistics
      const ingestionStage = response.body.pipeline.stages[0];
      expect(ingestionStage.processed).toBe(200);
      expect(ingestionStage.queued).toBe(5);
      expect(ingestionStage.errors).toBe(1);

      // Check metrics
      expect(response.body.pipeline.metrics.totalProcessed).toBe(145);
      expect(response.body.pipeline.metrics.successRate).toBe(94.1);

      // Check providers
      expect(response.body.providers).toHaveLength(1);
      expect(response.body.providers[0].name).toBe('OpenAI');
      expect(response.body.providers[0].requestsToday).toBe(1300);

      // Check recent activity
      expect(response.body.recentActivity).toHaveLength(1);
      expect(response.body.recentActivity[0].documentsProcessed).toBe(30);
    });

    it('should return fallback mock data when enrichment manager is not available', async () => {
      // Remove enrichment manager
      app.locals.dashboardManager = {};

      const response = await request(app)
        .get('/api/dashboard/admin/data/enrichment')
        .expect(200);

      expect(response.body).toHaveProperty('pipeline');
      expect(response.body).toHaveProperty('providers');
      expect(response.body).toHaveProperty('strategies');
      expect(response.body).toHaveProperty('recentActivity');

      // Check that fallback data is returned
      expect(response.body.pipeline.stages).toHaveLength(5);
      expect(response.body.providers).toHaveLength(3);
      expect(response.body.strategies.current).toHaveProperty('monolithic');
      expect(response.body.recentActivity).toHaveLength(5);
    });

    it('should return fallback mock data when dashboard manager is not available', async () => {
      // Remove dashboard manager entirely
      app.locals.dashboardManager = null;

      const response = await request(app)
        .get('/api/dashboard/admin/data/enrichment')
        .expect(200);

      expect(response.body).toHaveProperty('pipeline');
      expect(response.body.pipeline.stages).toHaveLength(5);
      expect(response.body.providers).toHaveLength(3);
    });

    it('should handle errors gracefully', async () => {
      // Mock error in statistics retrieval
      mockDashboardManager.enrichmentManager.getStatistics.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .get('/api/dashboard/admin/data/enrichment')
        .expect(500);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toBe('Failed to fetch enrichment pipeline data');
      expect(response.body).toHaveProperty('message');
    });

    it('should include all required pipeline stages', async () => {
      const response = await request(app)
        .get('/api/dashboard/admin/data/enrichment')
        .expect(200);

      const stageIds = response.body.pipeline.stages.map(stage => stage.id);
      expect(stageIds).toEqual(['ingestion', 'extraction', 'enrichment', 'embedding', 'storage']);

      // Check each stage has required properties
      response.body.pipeline.stages.forEach(stage => {
        expect(stage).toHaveProperty('id');
        expect(stage).toHaveProperty('name');
        expect(stage).toHaveProperty('status');
        expect(stage).toHaveProperty('processed');
        expect(stage).toHaveProperty('queued');
        expect(stage).toHaveProperty('errors');
        expect(stage).toHaveProperty('avgProcessingTime');
        expect(stage).toHaveProperty('throughput');
      });
    });

    it('should include strategy information', async () => {
      const response = await request(app)
        .get('/api/dashboard/admin/data/enrichment')
        .expect(200);

      expect(response.body.strategies).toHaveProperty('current');
      expect(response.body.strategies).toHaveProperty('performance');

      // Check strategy distribution
      const strategies = response.body.strategies.current;
      expect(strategies).toHaveProperty('monolithic');
      expect(strategies).toHaveProperty('chunked');
      expect(strategies).toHaveProperty('agent');
      expect(strategies).toHaveProperty('hybrid');

      // Check performance metrics
      const performance = response.body.strategies.performance;
      Object.values(performance).forEach(perf => {
        expect(perf).toHaveProperty('avgTime');
        expect(perf).toHaveProperty('successRate');
        expect(perf).toHaveProperty('cost');
      });
    });

    it('should include provider performance data', async () => {
      const response = await request(app)
        .get('/api/dashboard/admin/data/enrichment')
        .expect(200);

      expect(Array.isArray(response.body.providers)).toBe(true);
      expect(response.body.providers.length).toBeGreaterThan(0);

      // Check provider structure
      response.body.providers.forEach(provider => {
        expect(provider).toHaveProperty('id');
        expect(provider).toHaveProperty('name');
        expect(provider).toHaveProperty('status');
        expect(provider).toHaveProperty('responseTime');
        expect(provider).toHaveProperty('successRate');
        expect(provider).toHaveProperty('requestsToday');
        expect(provider).toHaveProperty('costToday');
        expect(provider).toHaveProperty('modelsUsed');
        expect(provider).toHaveProperty('currentLoad');
      });
    });
  });
});
