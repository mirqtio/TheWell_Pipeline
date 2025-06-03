/**
 * Integration tests for enrichment pipeline visualization
 * Tests the backend API integration
 */

const request = require('supertest');
const express = require('express');
const dashboardRoutes = require('../../../src/web/routes/dashboard');

describe('Enrichment Pipeline API Integration Tests', () => {
  let app;
  let mockDashboardManager;

  beforeAll(() => {
    // Set up Express app
    app = express();
    
    // Mock dashboard manager with default responses
    mockDashboardManager = {
      enrichmentManager: {
        getStatistics: jest.fn().mockResolvedValue({
          documentsIngested: 100,
          ingestedQueue: 5,
          ingestionErrors: 1,
          avgIngestionTime: 1.5,
          ingestionThroughput: 50,
          entitiesExtracted: 95,
          extractionQueue: 3,
          extractionErrors: 2,
          avgExtractionTime: 3.0,
          extractionThroughput: 40,
          documentsEnriched: 90,
          enrichmentQueue: 8,
          enrichmentErrors: 3,
          avgEnrichmentTime: 9.0,
          enrichmentThroughput: 25,
          documentsEmbedded: 85,
          embeddingQueue: 2,
          embeddingErrors: 1,
          avgEmbeddingTime: 2.0,
          embeddingThroughput: 45,
          documentsStored: 85,
          storageQueue: 0,
          storageErrors: 0,
          avgStorageTime: 0.6,
          storageThroughput: 50,
          totalProcessed: 85,
          totalQueued: 18,
          totalErrors: 7,
          overallThroughput: 35,
          avgEndToEndTime: 16.1,
          successRate: 92.4
        }),
        getProviderStatistics: jest.fn().mockResolvedValue([
          {
            id: 'openai',
            name: 'OpenAI',
            status: 'healthy',
            responseTime: 250,
            successRate: 99.1,
            requestsToday: 1200,
            costToday: 18.50,
            modelsUsed: ['gpt-4', 'gpt-3.5-turbo'],
            currentLoad: 0.65
          }
        ]),
        getQueueStatus: jest.fn().mockResolvedValue({
          recentActivity: [
            {
              timestamp: new Date().toISOString(),
              type: 'success',
              stage: 'enrichment',
              message: 'Completed batch enrichment of 25 documents',
              provider: 'openai',
              documentsProcessed: 25
            }
          ]
        })
      }
    };

    app.locals.dashboardManager = mockDashboardManager;
    app.use('/api/dashboard', dashboardRoutes);
  });

  beforeEach(() => {
    // Reset mocks to default values
    jest.clearAllMocks();
    
    // Restore default mock implementations
    mockDashboardManager.enrichmentManager.getStatistics.mockResolvedValue({
      documentsIngested: 100,
      ingestedQueue: 5,
      ingestionErrors: 1,
      avgIngestionTime: 1.5,
      ingestionThroughput: 50,
      entitiesExtracted: 95,
      extractionQueue: 3,
      extractionErrors: 2,
      avgExtractionTime: 3.0,
      extractionThroughput: 40,
      documentsEnriched: 90,
      enrichmentQueue: 8,
      enrichmentErrors: 3,
      avgEnrichmentTime: 9.0,
      enrichmentThroughput: 25,
      documentsEmbedded: 85,
      embeddingQueue: 2,
      embeddingErrors: 1,
      avgEmbeddingTime: 2.0,
      embeddingThroughput: 45,
      documentsStored: 85,
      storageQueue: 0,
      storageErrors: 0,
      avgStorageTime: 0.6,
      storageThroughput: 50,
      totalProcessed: 85,
      totalQueued: 18,
      totalErrors: 7,
      overallThroughput: 35,
      avgEndToEndTime: 16.1,
      successRate: 92.4
    });
    
    mockDashboardManager.enrichmentManager.getProviderStatistics.mockResolvedValue([
      {
        id: 'openai',
        name: 'OpenAI',
        status: 'healthy',
        responseTime: 250,
        successRate: 99.1,
        requestsToday: 1200,
        costToday: 18.50,
        modelsUsed: ['gpt-4', 'gpt-3.5-turbo'],
        currentLoad: 0.65
      }
    ]);
    
    mockDashboardManager.enrichmentManager.getQueueStatus.mockResolvedValue({
      recentActivity: [
        {
          timestamp: new Date().toISOString(),
          type: 'success',
          stage: 'enrichment',
          message: 'Completed batch enrichment of 25 documents',
          provider: 'openai',
          documentsProcessed: 25
        }
      ]
    });
  });

  describe('Enrichment API Endpoint Integration', () => {
    it('should return complete enrichment data structure', async () => {
      const response = await request(app)
        .get('/api/dashboard/admin/data/enrichment')
        .expect(200);

      // Verify complete data structure
      expect(response.body).toHaveProperty('pipeline');
      expect(response.body).toHaveProperty('providers');
      expect(response.body).toHaveProperty('strategies');
      expect(response.body).toHaveProperty('recentActivity');

      // Verify pipeline structure
      expect(response.body.pipeline.stages).toHaveLength(5);
      expect(response.body.pipeline.metrics.totalProcessed).toBe(85);
      expect(response.body.pipeline.metrics.successRate).toBe(92.4);

      // Verify providers
      expect(response.body.providers).toHaveLength(1);
      expect(response.body.providers[0].name).toBe('OpenAI');

      // Verify strategies
      expect(response.body.strategies.current).toHaveProperty('monolithic');
      expect(response.body.strategies.performance).toHaveProperty('monolithic');

      // Verify recent activity
      expect(response.body.recentActivity).toHaveLength(1);
      expect(response.body.recentActivity[0].documentsProcessed).toBe(25);
    });

    it('should handle partial data gracefully', async () => {
      // Mock partial data (only statistics available)
      mockDashboardManager.enrichmentManager.getProviderStatistics.mockResolvedValue([]);
      mockDashboardManager.enrichmentManager.getQueueStatus.mockResolvedValue({ recentActivity: [] });

      const response = await request(app)
        .get('/api/dashboard/admin/data/enrichment')
        .expect(200);

      // Should still return complete structure with fallback data
      expect(response.body.pipeline.stages).toHaveLength(5);
      expect(response.body.providers).toHaveLength(0); // empty array when no providers
      expect(response.body.strategies).toHaveProperty('current');
      expect(response.body.recentActivity).toHaveLength(0); // empty array when no activity
    });

    it('should handle enrichment manager errors', async () => {
      // Mock error in one service
      mockDashboardManager.enrichmentManager.getStatistics.mockRejectedValue(new Error('Stats service down'));

      const response = await request(app)
        .get('/api/dashboard/admin/data/enrichment')
        .expect(500);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toBe('Failed to fetch enrichment pipeline data');
    });

    it('should validate pipeline stage data structure', async () => {
      const response = await request(app)
        .get('/api/dashboard/admin/data/enrichment')
        .expect(200);

      // Validate each stage has required properties
      response.body.pipeline.stages.forEach(stage => {
        expect(stage).toHaveProperty('id');
        expect(stage).toHaveProperty('name');
        expect(stage).toHaveProperty('status');
        expect(stage).toHaveProperty('processed');
        expect(stage).toHaveProperty('queued');
        expect(stage).toHaveProperty('errors');
        expect(stage).toHaveProperty('avgProcessingTime');
        expect(stage).toHaveProperty('throughput');
        
        // Validate data types
        expect(typeof stage.processed).toBe('number');
        expect(typeof stage.queued).toBe('number');
        expect(typeof stage.errors).toBe('number');
        expect(typeof stage.avgProcessingTime).toBe('number');
        expect(typeof stage.throughput).toBe('number');
      });
    });

    it('should validate provider data structure', async () => {
      const response = await request(app)
        .get('/api/dashboard/admin/data/enrichment')
        .expect(200);

      // Validate each provider has required properties
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
        
        // Validate data types
        expect(typeof provider.responseTime).toBe('number');
        expect(typeof provider.successRate).toBe('number');
        expect(typeof provider.requestsToday).toBe('number');
        expect(typeof provider.costToday).toBe('number');
        expect(Array.isArray(provider.modelsUsed)).toBe(true);
        expect(typeof provider.currentLoad).toBe('number');
      });
    });

    it('should validate strategy data structure', async () => {
      const response = await request(app)
        .get('/api/dashboard/admin/data/enrichment')
        .expect(200);

      const strategies = response.body.strategies;
      
      // Validate current strategy distribution
      expect(strategies.current).toHaveProperty('monolithic');
      expect(strategies.current).toHaveProperty('chunked');
      expect(strategies.current).toHaveProperty('agent');
      expect(strategies.current).toHaveProperty('hybrid');
      
      // Validate performance metrics
      Object.keys(strategies.performance).forEach(strategy => {
        const perf = strategies.performance[strategy];
        expect(perf).toHaveProperty('avgTime');
        expect(perf).toHaveProperty('successRate');
        expect(perf).toHaveProperty('cost');
        
        expect(typeof perf.avgTime).toBe('number');
        expect(typeof perf.successRate).toBe('number');
        expect(typeof perf.cost).toBe('number');
      });
    });

    it('should validate recent activity data structure', async () => {
      const response = await request(app)
        .get('/api/dashboard/admin/data/enrichment')
        .expect(200);

      // Validate each activity item
      response.body.recentActivity.forEach(activity => {
        expect(activity).toHaveProperty('timestamp');
        expect(activity).toHaveProperty('type');
        expect(activity).toHaveProperty('stage');
        expect(activity).toHaveProperty('message');
        
        // Validate timestamp format
        expect(() => new Date(activity.timestamp)).not.toThrow();
        
        // Validate type is one of expected values
        expect(['success', 'error', 'warning', 'info']).toContain(activity.type);
      });
    });

    it('should return consistent data across multiple requests', async () => {
      // Make multiple requests
      const response1 = await request(app).get('/api/dashboard/admin/data/enrichment').expect(200);
      const response2 = await request(app).get('/api/dashboard/admin/data/enrichment').expect(200);
      
      // Structure should be consistent
      expect(response1.body.pipeline.stages.length).toBe(response2.body.pipeline.stages.length);
      expect(response1.body.providers.length).toBe(response2.body.providers.length);
      expect(Object.keys(response1.body.strategies.current)).toEqual(Object.keys(response2.body.strategies.current));
    });
  });
});
