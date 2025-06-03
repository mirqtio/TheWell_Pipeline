/**
 * Unit tests for QualityMetrics
 */

const QualityMetrics = require('../../../src/monitoring/QualityMetrics');

// Mock logger
jest.mock('../../../src/utils/logger', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn()
}));

describe('QualityMetrics', () => {
  let qualityMetrics;
  let mockDAO;

  beforeEach(() => {
    mockDAO = {
      saveQualityReport: jest.fn(),
      saveSLOViolation: jest.fn()
    };
    qualityMetrics = new QualityMetrics(mockDAO);
    
    // Clear any existing metrics
    qualityMetrics.metrics.clear();
    
    // Stop cleanup interval to avoid interference
    if (qualityMetrics.stopCleanup) {
      qualityMetrics.stopCleanup();
    }
  });

  afterEach(() => {
    jest.clearAllMocks();
    // Clean up any remaining intervals
    if (qualityMetrics && qualityMetrics.stopCleanup) {
      qualityMetrics.stopCleanup();
    }
  });

  describe('Constructor', () => {
    test('should initialize with default SLOs', () => {
      expect(qualityMetrics.slos.size).toBeGreaterThan(0);
      expect(qualityMetrics.slos.has('api_response_time_p95')).toBe(true);
      expect(qualityMetrics.slos.has('api_error_rate')).toBe(true);
      expect(qualityMetrics.slos.has('service_availability')).toBe(true);
    });

    test('should initialize time windows', () => {
      expect(qualityMetrics.windows).toEqual({
        '1m': 60 * 1000,
        '5m': 5 * 60 * 1000,
        '15m': 15 * 60 * 1000,
        '1h': 60 * 60 * 1000,
        '24h': 24 * 60 * 60 * 1000
      });
    });
  });

  describe('recordMetric', () => {
    test('should record metric with timestamp', () => {
      const labels = { endpoint: '/api/test' };
      qualityMetrics.recordMetric('response_time', 150, labels);
      
      const metricKey = qualityMetrics.getMetricKey('response_time', labels);
      const metrics = qualityMetrics.metrics.get(metricKey);
      
      expect(metrics).toHaveLength(1);
      expect(metrics[0]).toMatchObject({
        value: 150,
        labels
      });
      expect(metrics[0].timestamp).toBeCloseTo(Date.now(), -2);
    });

    test('should emit metric event', (done) => {
      qualityMetrics.on('metric', (event) => {
        expect(event).toMatchObject({
          type: 'response_time',
          value: 150,
          labels: { endpoint: '/api/test' }
        });
        done();
      });
      
      qualityMetrics.recordMetric('response_time', 150, { endpoint: '/api/test' });
    });

    test('should keep only recent metrics', () => {
      const oldTimestamp = Date.now() - (25 * 60 * 60 * 1000); // 25 hours ago
      
      // Manually add old metric
      qualityMetrics.metrics.set('test|', [
        { timestamp: oldTimestamp, value: 100, labels: {} }
      ]);
      
      // Record new metric
      qualityMetrics.recordMetric('test', 200, {});
      
      const metrics = qualityMetrics.metrics.get('test|');
      expect(metrics).toHaveLength(1);
      expect(metrics[0].value).toBe(200);
    });
  });

  describe('recordAPIRequest', () => {
    test('should record response time and request count', () => {
      qualityMetrics.recordAPIRequest('/api/test', 'GET', 200, 150, 'user123');
      
      const responseTimeKey = qualityMetrics.getMetricKey('response_time', {
        endpoint: '/api/test',
        method: 'GET',
        userId: 'user123'
      });
      
      const requestCountKey = qualityMetrics.getMetricKey('request_count', {
        endpoint: '/api/test',
        method: 'GET',
        userId: 'user123'
      });
      
      expect(qualityMetrics.metrics.get(responseTimeKey)).toHaveLength(1);
      expect(qualityMetrics.metrics.get(requestCountKey)).toHaveLength(1);
    });

    test('should record error for 4xx/5xx status codes', () => {
      qualityMetrics.recordAPIRequest('/api/test', 'POST', 404, 100);
      
      const errorKey = qualityMetrics.getMetricKey('error_count', {
        endpoint: '/api/test',
        method: 'POST',
        userId: null,
        statusCode: 404
      });
      
      expect(qualityMetrics.metrics.get(errorKey)).toHaveLength(1);
    });

    test('should record success for 2xx/3xx status codes', () => {
      qualityMetrics.recordAPIRequest('/api/test', 'GET', 200, 100);
      
      const successKey = qualityMetrics.getMetricKey('success_count', {
        endpoint: '/api/test',
        method: 'GET',
        userId: null
      });
      
      expect(qualityMetrics.metrics.get(successKey)).toHaveLength(1);
    });

    test('should record availability based on status code', () => {
      qualityMetrics.recordAPIRequest('/api/test', 'GET', 200, 100);
      qualityMetrics.recordAPIRequest('/api/test', 'GET', 500, 100);
      
      const availabilityKey = qualityMetrics.getMetricKey('availability', {
        endpoint: '/api/test',
        method: 'GET',
        userId: null
      });
      
      const metrics = qualityMetrics.metrics.get(availabilityKey);
      expect(metrics).toHaveLength(2);
      expect(metrics[0].value).toBe(1); // 200 -> available
      expect(metrics[1].value).toBe(0); // 500 -> unavailable
    });
  });

  describe('recordLLMProcessing', () => {
    test('should record processing time and success rate', () => {
      qualityMetrics.recordLLMProcessing('openai', 'gpt-4', 'completion', 2000, true);
      
      const timeKey = qualityMetrics.getMetricKey('llm_processing_time', {
        provider: 'openai',
        model: 'gpt-4',
        operation: 'completion'
      });
      
      const successKey = qualityMetrics.getMetricKey('llm_success_rate', {
        provider: 'openai',
        model: 'gpt-4',
        operation: 'completion'
      });
      
      expect(qualityMetrics.metrics.get(timeKey)).toHaveLength(1);
      expect(qualityMetrics.metrics.get(successKey)).toHaveLength(1);
      expect(qualityMetrics.metrics.get(successKey)[0].value).toBe(1);
    });

    test('should record error on failure', () => {
      const error = new Error('API timeout');
      qualityMetrics.recordLLMProcessing('openai', 'gpt-4', 'completion', 5000, false, error);
      
      const errorKey = qualityMetrics.getMetricKey('llm_error_count', {
        provider: 'openai',
        model: 'gpt-4',
        operation: 'completion',
        error: 'API timeout'
      });
      
      expect(qualityMetrics.metrics.get(errorKey)).toHaveLength(1);
    });
  });

  describe('calculateMetrics', () => {
    beforeEach(() => {
      // Add test data
      const now = Date.now();
      const labels = { endpoint: '/api/test' };
      
      qualityMetrics.metrics.set(qualityMetrics.getMetricKey('response_time', labels), [
        { timestamp: now - 1000, value: 100, labels },
        { timestamp: now - 2000, value: 200, labels },
        { timestamp: now - 3000, value: 150, labels },
        { timestamp: now - 4000, value: 300, labels },
        { timestamp: now - 5000, value: 50, labels }
      ]);
    });

    test('should calculate basic statistics', () => {
      const metrics = qualityMetrics.calculateMetrics('response_time', { endpoint: '/api/test' }, '5m');
      
      expect(metrics.count).toBe(5);
      expect(metrics.min).toBe(50);
      expect(metrics.max).toBe(300);
      expect(metrics.avg).toBe(160);
      expect(metrics.sum).toBe(800);
    });

    test('should calculate percentiles', () => {
      const metrics = qualityMetrics.calculateMetrics('response_time', { endpoint: '/api/test' }, '5m');
      
      expect(metrics.p50).toBe(150);
      expect(metrics.p95).toBe(300);
      expect(metrics.p99).toBe(300);
    });

    test('should return zeros for no data', () => {
      const metrics = qualityMetrics.calculateMetrics('nonexistent', {}, '5m');
      
      expect(metrics).toEqual({
        count: 0,
        avg: 0,
        min: 0,
        max: 0,
        p50: 0,
        p95: 0,
        p99: 0,
        sum: 0
      });
    });

    test('should filter by time window', () => {
      // Add metrics with specific timestamps for 1-minute window test
      const now = Date.now();
      const labels = { endpoint: '/api/recent' };
      
      qualityMetrics.metrics.set(qualityMetrics.getMetricKey('response_time', labels), [
        { timestamp: now - 30000, value: 100, labels }, // 30 seconds ago - should be included
        { timestamp: now - 90000, value: 200, labels }  // 90 seconds ago - should be excluded
      ]);
      
      const metrics = qualityMetrics.calculateMetrics('response_time', { endpoint: '/api/recent' }, '1m');
      
      expect(metrics.count).toBe(1); // Only the recent metric should be included
    });
  });

  describe('calculateErrorRate', () => {
    test('should calculate error rate correctly', () => {
      const labels = { endpoint: '/api/test' };
      
      // Add error and success metrics
      qualityMetrics.metrics.set(qualityMetrics.getMetricKey('error_count', labels), [
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels }
      ]);
      
      qualityMetrics.metrics.set(qualityMetrics.getMetricKey('success_count', labels), [
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels }
      ]);
      
      const errorRate = qualityMetrics.calculateErrorRate(labels, '5m');
      expect(errorRate).toBe(0.2); // 2 errors out of 10 total requests
    });

    test('should return 0 for no requests', () => {
      const errorRate = qualityMetrics.calculateErrorRate({}, '5m');
      expect(errorRate).toBe(0);
    });
  });

  describe('checkSLOCompliance', () => {
    test('should check response time SLO', () => {
      // Add response time data that violates SLO (all high values to ensure P95 violation)
      const labels = {};
      const highValues = [];
      for (let i = 0; i < 20; i++) {
        highValues.push({ timestamp: Date.now(), value: 3000 + i * 100, labels }); // All above 2s target
      }
      qualityMetrics.metrics.set(qualityMetrics.getMetricKey('response_time', labels), highValues);
      
      const compliance = qualityMetrics.checkSLOCompliance('api_response_time_p95');
      
      expect(compliance.sloId).toBe('api_response_time_p95');
      expect(compliance.current).toBeGreaterThan(2000);
      expect(compliance.isCompliant).toBe(false);
    });

    test('should check error rate SLO', () => {
      // Add data that meets error rate SLO
      const labels = {};
      qualityMetrics.metrics.set(qualityMetrics.getMetricKey('error_count', labels), [
        { timestamp: Date.now(), value: 1, labels }
      ]);
      qualityMetrics.metrics.set(qualityMetrics.getMetricKey('success_count', labels), [
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels },
        { timestamp: Date.now(), value: 1, labels }
      ]);
      
      const compliance = qualityMetrics.checkSLOCompliance('api_error_rate');
      
      expect(compliance.sloId).toBe('api_error_rate');
      expect(compliance.current).toBeLessThan(0.01); // Less than 1%
      expect(compliance.isCompliant).toBe(true);
    });

    test('should throw error for unknown SLO', () => {
      expect(() => {
        qualityMetrics.checkSLOCompliance('unknown_slo');
      }).toThrow('SLO not found: unknown_slo');
    });
  });

  describe('generateQualityReport', () => {
    test('should generate comprehensive report', async () => {
      mockDAO.saveQualityReport.mockResolvedValue('report-id');
      
      // Add some test data
      qualityMetrics.recordAPIRequest('/api/test', 'GET', 200, 150);
      qualityMetrics.recordLLMProcessing('openai', 'gpt-4', 'completion', 2000, true);
      
      const report = await qualityMetrics.generateQualityReport('5m');
      
      expect(report).toMatchObject({
        window: '5m',
        metrics: {
          api: expect.any(Object),
          llm: expect.any(Object),
          database: expect.any(Object)
        },
        slos: expect.any(Array),
        summary: expect.any(Object)
      });
      
      expect(report.timestamp).toBeDefined();
      expect(mockDAO.saveQualityReport).toHaveBeenCalledWith(report);
    });

    test('should handle DAO save failure gracefully', async () => {
      mockDAO.saveQualityReport.mockRejectedValue(new Error('DB error'));
      
      const report = await qualityMetrics.generateQualityReport('5m');
      
      expect(report).toBeDefined();
      expect(mockDAO.saveQualityReport).toHaveBeenCalled();
    });
  });

  describe('SLO Violation Events', () => {
    test('should emit SLO violation event', (done) => {
      const timeout = setTimeout(() => {
        done(new Error('SLO violation event not emitted within timeout'));
      }, 5000);
      
      let eventReceived = false;
      
      qualityMetrics.on('sloViolation', (violation) => {
        if (!eventReceived) {
          eventReceived = true;
          clearTimeout(timeout);
          expect(violation).toMatchObject({
            sloId: expect.any(String),
            slo: expect.any(Object),
            compliance: expect.any(Object),
            labels: expect.any(Object),
            timestamp: expect.any(Number)
          });
          done();
        }
      });
      
      // Add multiple high response time values to ensure SLO violation
      // Need enough data points to trigger P95 calculation
      for (let i = 0; i < 20; i++) {
        qualityMetrics.recordMetric('response_time', 5000 + i * 100, {});
      }
    });
  });

  describe('Helper Methods', () => {
    test('getMetricKey should generate consistent keys', () => {
      const key1 = qualityMetrics.getMetricKey('test', { b: '2', a: '1' });
      const key2 = qualityMetrics.getMetricKey('test', { a: '1', b: '2' });
      
      expect(key1).toBe(key2);
      expect(key1).toBe('test|a:1,b:2');
    });

    test('percentile should calculate correctly', () => {
      const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      
      expect(qualityMetrics.percentile(values, 50)).toBe(5);
      expect(qualityMetrics.percentile(values, 95)).toBe(10);
      expect(qualityMetrics.percentile([], 50)).toBe(0);
    });
  });
});
