/**
 * Integration tests for Quality Monitoring System
 */

const QualityMetrics = require('../../../src/monitoring/QualityMetrics');
const QualityDAO = require('../../../src/monitoring/QualityDAO');
const QualityMiddleware = require('../../../src/monitoring/QualityMiddleware');

// Mock database pool and client
const mockClient = {
  query: jest.fn(),
  release: jest.fn()
};

const mockPool = {
  connect: jest.fn().mockResolvedValue(mockClient),
  query: jest.fn()
};

// Mock logger
jest.mock('../../../src/utils/logger', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn()
}));

describe('Quality Monitoring Integration', () => {
  let qualityDAO;
  let qualityMetrics;
  let qualityMiddleware;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Create instances with mock pool
    qualityDAO = new QualityDAO(mockPool);
    qualityMetrics = new QualityMetrics(qualityDAO);
    qualityMiddleware = new QualityMiddleware(qualityMetrics);
    
    // Clear metrics
    qualityMetrics.metrics.clear();
    
    // Stop cleanup interval
    clearInterval(qualityMetrics.cleanupInterval);
  });

  describe('End-to-End Quality Monitoring Workflow', () => {
    test('should collect metrics, check SLOs, and generate reports', async () => {
      // Mock DAO responses
      mockClient.query.mockResolvedValue({ rows: [{ id: 'report-123' }] });
      
      // Simulate API requests
      qualityMetrics.recordAPIRequest('/api/users', 'GET', 200, 150, 'user1');
      qualityMetrics.recordAPIRequest('/api/users', 'GET', 200, 180, 'user2');
      qualityMetrics.recordAPIRequest('/api/users', 'POST', 201, 250, 'user1');
      qualityMetrics.recordAPIRequest('/api/users', 'GET', 500, 5000, 'user3');
      
      // Simulate LLM processing
      qualityMetrics.recordLLMProcessing('openai', 'gpt-4', 'completion', 2000, true);
      qualityMetrics.recordLLMProcessing('openai', 'gpt-4', 'completion', 1800, true);
      qualityMetrics.recordLLMProcessing('anthropic', 'claude-3', 'chat', 3000, false, new Error('Timeout'));
      
      // Simulate database operations
      qualityMetrics.recordDatabaseOperation('SELECT', 'documents', 50, true);
      qualityMetrics.recordDatabaseOperation('INSERT', 'documents', 120, true);
      qualityMetrics.recordDatabaseOperation('UPDATE', 'documents', 80, false, new Error('Lock timeout'));
      
      // Check SLO compliance
      const responseTimeSLO = qualityMetrics.checkSLOCompliance('api_response_time_p95');
      const errorRateSLO = qualityMetrics.checkSLOCompliance('api_error_rate');
      const availabilitySLO = qualityMetrics.checkSLOCompliance('service_availability');
      
      expect(responseTimeSLO).toMatchObject({
        sloId: 'api_response_time_p95',
        target: 2000,
        current: expect.any(Number),
        isCompliant: expect.any(Boolean)
      });
      
      expect(errorRateSLO).toMatchObject({
        sloId: 'api_error_rate',
        target: 0.01,
        current: expect.any(Number),
        isCompliant: expect.any(Boolean)
      });
      
      expect(availabilitySLO).toMatchObject({
        sloId: 'service_availability',
        target: 0.999,
        current: expect.any(Number),
        isCompliant: expect.any(Boolean)
      });
      
      // Generate quality report
      const report = await qualityMetrics.generateQualityReport('5m');
      
      expect(report).toMatchObject({
        timestamp: expect.any(Date),
        window: '5m',
        metrics: {
          api: expect.objectContaining({
            responseTime: expect.any(Object),
            requestCount: expect.any(Object),
            errorRate: expect.any(Number)
          }),
          llm: expect.objectContaining({
            processingTime: expect.any(Object),
            successRate: expect.any(Number)
          }),
          database: expect.objectContaining({
            operationTime: expect.any(Object),
            successRate: expect.any(Number)
          })
        },
        slos: expect.any(Array),
        summary: expect.objectContaining({
          totalRequests: expect.any(Number),
          totalErrors: expect.any(Number),
          avgResponseTime: expect.any(Number)
        })
      });
      
      // Verify DAO was called to save report
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO quality_reports'),
        expect.any(Array)
      );
    });

    test('should handle SLO violations and emit events', (done) => {
      let violationCount = 0;
      
      qualityMetrics.on('sloViolation', (violation) => {
        violationCount++;
        expect(violation).toMatchObject({
          sloId: expect.any(String),
          slo: expect.any(Object),
          compliance: expect.objectContaining({
            isCompliant: false
          }),
          labels: expect.any(Object),
          timestamp: expect.any(Number)
        });
        
        // Complete test after receiving violations
        if (violationCount >= 2) {
          done();
        }
      });
      
      // Generate data that violates SLOs
      // High response times (violates response time SLO)
      for (let i = 0; i < 10; i++) {
        qualityMetrics.recordAPIRequest('/api/slow', 'GET', 200, 5000); // 5 seconds
      }
      
      // High error rate (violates error rate SLO)
      for (let i = 0; i < 50; i++) {
        qualityMetrics.recordAPIRequest('/api/error', 'GET', 500, 100);
      }
      for (let i = 0; i < 50; i++) {
        qualityMetrics.recordAPIRequest('/api/success', 'GET', 200, 100);
      }
    });
  });

  describe('Middleware Integration', () => {
    test('should integrate with Express middleware for automatic monitoring', () => {
      const apiMiddleware = qualityMiddleware.apiMonitoring();
      
      const mockReq = {
        method: 'GET',
        route: { path: '/api/test' },
        user: { id: 'user123' }
      };
      
      const mockRes = {
        statusCode: 200,
        send: jest.fn()
      };
      
      const mockNext = jest.fn();
      
      // Apply middleware
      apiMiddleware(mockReq, mockRes, mockNext);
      
      // Simulate response
      mockRes.send('response');
      
      // Verify metrics were recorded
      const responseTimeKey = qualityMetrics.getMetricKey('response_time', {
        endpoint: '/api/test',
        method: 'GET',
        userId: 'user123'
      });
      
      expect(qualityMetrics.metrics.has(responseTimeKey)).toBe(true);
      expect(mockNext).toHaveBeenCalled();
    });

    test('should wrap database operations for monitoring', async () => {
      const mockDbFn = jest.fn().mockResolvedValue('db result');
      const wrappedFn = qualityMiddleware.wrapDatabaseOperation('SELECT', 'users', mockDbFn);
      
      const result = await wrappedFn('query', 'params');
      
      expect(result).toBe('db result');
      expect(mockDbFn).toHaveBeenCalledWith('query', 'params');
      
      // Verify database metrics were recorded
      const dbMetrics = Array.from(qualityMetrics.metrics.keys())
        .filter(key => key.includes('db_operation_time'));
      
      expect(dbMetrics.length).toBeGreaterThan(0);
    });

    test('should wrap LLM operations for monitoring', async () => {
      const mockLLMFn = jest.fn().mockResolvedValue('llm response');
      const wrappedFn = qualityMiddleware.wrapLLMProcessing('openai', 'gpt-4', 'completion', mockLLMFn);
      
      const result = await wrappedFn('prompt');
      
      expect(result).toBe('llm response');
      expect(mockLLMFn).toHaveBeenCalledWith('prompt');
      
      // Verify LLM metrics were recorded
      const llmMetrics = Array.from(qualityMetrics.metrics.keys())
        .filter(key => key.includes('llm_processing_time'));
      
      expect(llmMetrics.length).toBeGreaterThan(0);
    });
  });

  describe('Health Check Integration', () => {
    test('should provide comprehensive health status', async () => {
      // Add some test data
      qualityMetrics.recordAPIRequest('/api/health', 'GET', 200, 50);
      qualityMetrics.recordAPIRequest('/api/status', 'GET', 200, 75);
      qualityMetrics.recordLLMProcessing('openai', 'gpt-4', 'completion', 1500, true);
      
      const healthHandler = qualityMiddleware.healthCheck();
      
      const mockReq = {};
      const mockRes = {
        json: jest.fn()
      };
      
      await healthHandler(mockReq, mockRes);
      
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: expect.stringMatching(/^(healthy|degraded)$/),
          timestamp: expect.any(String),
          metrics: expect.any(Object),
          slos: expect.objectContaining({
            total: expect.any(Number),
            compliant: expect.any(Number),
            violations: expect.any(Number)
          })
        })
      );
    });
  });

  describe('Metrics API Integration', () => {
    test('should provide metrics via API endpoint', async () => {
      // Add test data
      qualityMetrics.recordAPIRequest('/api/test', 'GET', 200, 150);
      qualityMetrics.recordAPIRequest('/api/test', 'GET', 200, 200);
      qualityMetrics.recordAPIRequest('/api/test', 'GET', 404, 100);
      
      const metricsHandler = qualityMiddleware.metricsEndpoint();
      
      const mockReq = {
        query: {
          window: '5m',
          type: 'response_time',
          labels: JSON.stringify({ endpoint: '/api/test' })
        }
      };
      
      const mockRes = {
        json: jest.fn()
      };
      
      await metricsHandler(mockReq, mockRes);
      
      expect(mockRes.json).toHaveBeenCalledWith({
        timestamp: expect.any(String),
        window: '5m',
        data: expect.objectContaining({
          count: expect.any(Number),
          avg: expect.any(Number),
          min: expect.any(Number),
          max: expect.any(Number),
          p50: expect.any(Number),
          p95: expect.any(Number),
          p99: expect.any(Number)
        })
      });
    });

    test('should provide SLO compliance via API endpoint', async () => {
      // Add test data
      qualityMetrics.recordAPIRequest('/api/test', 'GET', 200, 150);
      
      const sloHandler = qualityMiddleware.sloEndpoint();
      
      const mockReq = {
        params: { sloId: 'api_response_time_p95' },
        query: { window: '5m' }
      };
      
      const mockRes = {
        json: jest.fn()
      };
      
      await sloHandler(mockReq, mockRes);
      
      expect(mockRes.json).toHaveBeenCalledWith({
        timestamp: expect.any(String),
        data: expect.objectContaining({
          sloId: 'api_response_time_p95',
          target: expect.any(Number),
          current: expect.any(Number),
          isCompliant: expect.any(Boolean)
        })
      });
    });
  });

  describe('Data Persistence Integration', () => {
    test('should persist quality reports to database', async () => {
      mockClient.query.mockResolvedValue({ rows: [{ id: 'report-456' }] });
      
      // Generate some metrics
      qualityMetrics.recordAPIRequest('/api/test', 'GET', 200, 150);
      qualityMetrics.recordLLMProcessing('openai', 'gpt-4', 'completion', 2000, true);
      
      const report = await qualityMetrics.generateQualityReport('5m');
      
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO quality_reports'),
        expect.arrayContaining([
          expect.any(Date), // timestamp
          '5m', // window
          expect.any(String), // metrics JSON
          expect.any(String), // slos JSON
          expect.any(String)  // summary JSON
        ])
      );
    });

    test('should persist SLO violations to database', async () => {
      mockClient.query.mockResolvedValue({ rows: [{ id: 'violation-789' }] });
      
      let violationSaved = false;
      
      qualityMetrics.on('sloViolation', async (violation) => {
        if (!violationSaved) {
          violationSaved = true;
          
          // Simulate saving violation (this would normally be done by the event handler)
          await qualityDAO.saveSLOViolation({
            sloId: violation.sloId,
            sloName: violation.slo.name,
            targetValue: violation.slo.target,
            currentValue: violation.compliance.current,
            isCompliant: violation.compliance.isCompliant,
            labels: violation.labels,
            timestamp: new Date(violation.timestamp)
          });
          
          expect(mockClient.query).toHaveBeenCalledWith(
            expect.stringContaining('INSERT INTO slo_violations'),
            expect.arrayContaining([
              violation.sloId,
              violation.slo.name,
              violation.slo.target,
              violation.compliance.current,
              violation.compliance.isCompliant,
              expect.any(String), // labels JSON
              expect.any(Date)    // timestamp
            ])
          );
        }
      });
      
      // Generate data that violates SLO
      for (let i = 0; i < 10; i++) {
        qualityMetrics.recordAPIRequest('/api/slow', 'GET', 200, 5000);
      }
    });
  });

  describe('Error Handling Integration', () => {
    test('should handle database errors gracefully during report generation', async () => {
      mockClient.query.mockRejectedValue(new Error('Database connection failed'));
      
      // Should not throw despite database error
      const report = await qualityMetrics.generateQualityReport('5m');
      
      expect(report).toBeDefined();
      expect(report.timestamp).toBeDefined();
      expect(report.metrics).toBeDefined();
    });

    test('should handle metrics collection errors gracefully', () => {
      // Mock a scenario where metrics collection fails
      const originalRecordMetric = qualityMetrics.recordMetric;
      qualityMetrics.recordMetric = jest.fn().mockImplementation(() => {
        throw new Error('Metrics collection failed');
      });
      
      // Should not throw when recording API request
      expect(() => {
        qualityMetrics.recordAPIRequest('/api/test', 'GET', 200, 150);
      }).not.toThrow();
      
      // Restore original method
      qualityMetrics.recordMetric = originalRecordMetric;
    });
  });

  describe('Performance and Memory Management', () => {
    test('should handle large volumes of metrics efficiently', () => {
      const startTime = Date.now();
      
      // Record a large number of metrics
      for (let i = 0; i < 1000; i++) {
        qualityMetrics.recordAPIRequest(`/api/test${i % 10}`, 'GET', 200, Math.random() * 1000);
        qualityMetrics.recordLLMProcessing('openai', 'gpt-4', 'completion', Math.random() * 3000, true);
        qualityMetrics.recordDatabaseOperation('SELECT', 'documents', Math.random() * 100, true);
      }
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      // Should complete within reasonable time (less than 1 second)
      expect(duration).toBeLessThan(1000);
      
      // Should have metrics stored
      expect(qualityMetrics.metrics.size).toBeGreaterThan(0);
    });

    test('should clean up old metrics automatically', () => {
      const oldTimestamp = Date.now() - (25 * 60 * 60 * 1000); // 25 hours ago
      
      // Manually add old metric
      qualityMetrics.metrics.set('old_metric|', [
        { timestamp: oldTimestamp, value: 100, labels: {} }
      ]);
      
      // Record new metric which should trigger cleanup
      qualityMetrics.recordMetric('new_metric', 200, {});
      
      // Old metric should be cleaned up
      const oldMetrics = qualityMetrics.metrics.get('old_metric|');
      expect(oldMetrics).toBeUndefined();
    });
  });
});
