/**
 * PrometheusExporter Unit Tests
 */

const PrometheusExporter = require('../../../src/monitoring/PrometheusExporter');

describe('PrometheusExporter', () => {
  let exporter;
  let testCounter = 0;

  beforeEach(() => {
    testCounter++;
    exporter = new PrometheusExporter({
      prefix: `test${testCounter}_`,
      enableDefaultMetrics: false
    });
  });

  afterEach(async () => {
    if (exporter) {
      await exporter.shutdown();
    }
  });

  describe('Initialization', () => {
    it('should initialize with default configuration', () => {
      const defaultExporter = new PrometheusExporter();
      expect(defaultExporter.config.prefix).toBe('thewell_');
      expect(defaultExporter.config.enableDefaultMetrics).toBe(true);
    });

    it('should initialize with custom configuration', () => {
      expect(exporter.config.prefix).toMatch(/^test\d+_$/);
      expect(exporter.config.enableDefaultMetrics).toBe(false);
    });

    it('should initialize custom metrics', () => {
      expect(exporter.costMetrics).toBeDefined();
      expect(exporter.qualityMetrics).toBeDefined();
      expect(exporter.systemMetrics).toBeDefined();
    });
  });

  describe('Cost Tracking', () => {
    beforeEach(async () => {
      await exporter.initialize();
    });

    it('should record cost metrics', async () => {
      exporter.recordCost('openai', 'gpt-4', 'test', 0.05);
      
      const metrics = await exporter.getMetrics();
      expect(metrics).toContain('cost_total');
    });

    it('should record token metrics', async () => {
      exporter.recordTokens('openai', 'gpt-4', 'input', 1000);
      
      const metrics = await exporter.getMetrics();
      expect(metrics).toContain('tokens_processed_total');
    });

    it('should update budget utilization', async () => {
      exporter.updateBudgetUtilization('monthly', 'monthly', 75.5);
      
      const metrics = await exporter.getMetrics();
      expect(metrics).toContain('budget_utilization');
    });
  });

  describe('Quality Tracking', () => {
    beforeEach(async () => {
      await exporter.initialize();
    });

    it('should record API response metrics', async () => {
      exporter.recordApiResponse('/api/search', 'POST', '200', 1500);
      
      const metrics = await exporter.getMetrics();
      expect(metrics).toContain('api_response_time_seconds');
    });

    it('should update error rate', async () => {
      exporter.updateErrorRate('api', '/search', 2.5);
      
      const metrics = await exporter.getMetrics();
      expect(metrics).toContain('error_rate');
    });

    it('should update SLO compliance', async () => {
      exporter.updateSloCompliance('api_response_time', '5m', 97.8);
      
      const metrics = await exporter.getMetrics();
      expect(metrics).toContain('slo_compliance');
    });

    it('should record document processing time', async () => {
      exporter.recordDocumentProcessing('monolithic', 'text', 5000);
      
      const metrics = await exporter.getMetrics();
      expect(metrics).toContain('document_processing_time_seconds');
    });
  });

  describe('System Tracking', () => {
    beforeEach(async () => {
      await exporter.initialize();
    });

    it('should update active connections', async () => {
      exporter.updateActiveConnections('api', 25);
      
      const metrics = await exporter.getMetrics();
      expect(metrics).toContain('active_connections');
    });

    it('should update queue size', async () => {
      exporter.updateQueueSize('ingestion', 150);
      
      const metrics = await exporter.getMetrics();
      expect(metrics).toContain('queue_size');
    });

    it('should update cache hit rate', async () => {
      exporter.updateCacheHitRate('query', 85.2);
      
      const metrics = await exporter.getMetrics();
      expect(metrics).toContain('cache_hit_rate');
    });

    it('should record document ingestion', async () => {
      exporter.recordDocumentIngested('static', 'success');
      
      const metrics = await exporter.getMetrics();
      expect(metrics).toContain('documents_ingested_total');
    });
  });

  describe('Integration', () => {
    beforeEach(async () => {
      await exporter.initialize();
    });

    it('should integrate with cost tracker', () => {
      const mockCostTracker = {
        on: jest.fn()
      };

      exporter.integrateWithCostTracker(mockCostTracker);
      
      expect(mockCostTracker.on).toHaveBeenCalledWith('cost_tracked', expect.any(Function));
      expect(mockCostTracker.on).toHaveBeenCalledWith('budget_check', expect.any(Function));
    });

    it('should integrate with quality metrics', () => {
      const mockQualityMetrics = {
        on: jest.fn()
      };

      exporter.integrateWithQualityMetrics(mockQualityMetrics);
      
      expect(mockQualityMetrics.on).toHaveBeenCalledWith('metric_recorded', expect.any(Function));
      expect(mockQualityMetrics.on).toHaveBeenCalledWith('slo_checked', expect.any(Function));
    });

    it('should handle missing integrations gracefully', () => {
      expect(() => {
        exporter.integrateWithCostTracker(null);
        exporter.integrateWithQualityMetrics(undefined);
      }).not.toThrow();
    });
  });

  describe('Status and Health', () => {
    it('should return status when not initialized', () => {
      const status = exporter.getStatus();
      expect(status.initialized).toBe(false);
      expect(status.registeredMetrics).toBeGreaterThan(0); // Metrics are registered during constructor
    });

    it('should return status when initialized', async () => {
      await exporter.initialize();
      const status = exporter.getStatus();
      expect(status.initialized).toBe(true);
      expect(status.registeredMetrics).toBeGreaterThan(0);
    });

    it('should return content type', () => {
      const contentType = exporter.getContentType();
      expect(contentType).toBeDefined();
    });
  });

  describe('Metrics Export', () => {
    beforeEach(async () => {
      await exporter.initialize();
    });

    it('should export metrics', async () => {
      const metrics = await exporter.getMetrics();
      expect(typeof metrics).toBe('string');
    });

    it('should export metrics as string', async () => {
      const metrics = await exporter.getMetricsAsString();
      expect(typeof metrics).toBe('string');
    });
  });

  describe('Shutdown', () => {
    it('should shutdown gracefully', async () => {
      await exporter.initialize();
      expect(exporter.isInitialized).toBe(true);
      
      await exporter.shutdown();
      expect(exporter.isInitialized).toBe(false);
    });

    it('should handle shutdown when not initialized', async () => {
      await expect(exporter.shutdown()).resolves.not.toThrow();
    });
  });
});