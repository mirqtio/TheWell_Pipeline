/**
 * Unit tests for QualityMiddleware
 */

const QualityMiddleware = require('../../../src/monitoring/QualityMiddleware');

// Mock logger
jest.mock('../../../src/utils/logger', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn()
}));

describe('QualityMiddleware', () => {
  let qualityMiddleware;
  let mockQualityMetrics;

  beforeEach(() => {
    mockQualityMetrics = {
      recordAPIRequest: jest.fn(),
      recordDatabaseOperation: jest.fn(),
      recordLLMProcessing: jest.fn(),
      recordMetric: jest.fn(),
      getMetricsSummary: jest.fn(),
      getAllSLOCompliance: jest.fn(),
      calculateMetrics: jest.fn(),
      generateQualityReport: jest.fn(),
      checkSLOCompliance: jest.fn()
    };

    qualityMiddleware = new QualityMiddleware(mockQualityMetrics);
    jest.clearAllMocks();
  });

  describe('apiMonitoring middleware', () => {
    test('should record API request metrics', () => {
      const middleware = qualityMiddleware.apiMonitoring();
      
      const mockReq = {
        method: 'GET',
        route: { path: '/api/test' },
        path: '/api/test',
        user: { id: 'user123' }
      };
      
      const mockRes = {
        statusCode: 200,
        send: jest.fn()
      };
      
      const mockNext = jest.fn();
      
      // Call middleware
      middleware(mockReq, mockRes, mockNext);
      
      // Simulate response
      mockRes.send('test response');
      
      expect(mockNext).toHaveBeenCalled();
      expect(mockQualityMetrics.recordAPIRequest).toHaveBeenCalledWith(
        '/api/test',
        'GET',
        200,
        expect.any(Number), // responseTime
        'user123'
      );
    });

    test('should handle requests without user', () => {
      const middleware = qualityMiddleware.apiMonitoring();
      
      const mockReq = {
        method: 'POST',
        route: { path: '/api/public' },
        path: '/api/public'
      };
      
      const mockRes = {
        statusCode: 201,
        send: jest.fn()
      };
      
      const mockNext = jest.fn();
      
      middleware(mockReq, mockRes, mockNext);
      mockRes.send('created');
      
      expect(mockQualityMetrics.recordAPIRequest).toHaveBeenCalledWith(
        '/api/public',
        'POST',
        201,
        expect.any(Number),
        null
      );
    });

    test('should handle requests without route', () => {
      const middleware = qualityMiddleware.apiMonitoring();
      
      const mockReq = {
        method: 'GET',
        path: '/static/file.js'
      };
      
      const mockRes = {
        statusCode: 404,
        send: jest.fn()
      };
      
      const mockNext = jest.fn();
      
      middleware(mockReq, mockRes, mockNext);
      mockRes.send('not found');
      
      expect(mockQualityMetrics.recordAPIRequest).toHaveBeenCalledWith(
        '/static/file.js',
        'GET',
        404,
        expect.any(Number),
        null
      );
    });

    test('should handle metrics recording errors gracefully', () => {
      mockQualityMetrics.recordAPIRequest.mockImplementation(() => {
        throw new Error('Metrics error');
      });
      
      const middleware = qualityMiddleware.apiMonitoring();
      
      const mockReq = {
        method: 'GET',
        route: { path: '/api/test' }
      };
      
      const mockRes = {
        statusCode: 200,
        send: jest.fn()
      };
      
      const mockNext = jest.fn();
      
      // Should not throw
      expect(() => {
        middleware(mockReq, mockRes, mockNext);
        mockRes.send('response');
      }).not.toThrow();
      
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('wrapDatabaseOperation', () => {
    test('should record successful database operation', async () => {
      const mockFn = jest.fn().mockResolvedValue('result');
      const wrappedFn = qualityMiddleware.wrapDatabaseOperation('SELECT', 'users', mockFn);
      
      const result = await wrappedFn('arg1', 'arg2');
      
      expect(result).toBe('result');
      expect(mockFn).toHaveBeenCalledWith('arg1', 'arg2');
      expect(mockQualityMetrics.recordDatabaseOperation).toHaveBeenCalledWith(
        'SELECT',
        'users',
        expect.any(Number), // duration
        true, // success
        null // no error
      );
    });

    test('should record failed database operation', async () => {
      const error = new Error('Database error');
      const mockFn = jest.fn().mockRejectedValue(error);
      const wrappedFn = qualityMiddleware.wrapDatabaseOperation('INSERT', 'documents', mockFn);
      
      await expect(wrappedFn()).rejects.toThrow('Database error');
      
      expect(mockQualityMetrics.recordDatabaseOperation).toHaveBeenCalledWith(
        'INSERT',
        'documents',
        expect.any(Number),
        false, // failed
        error
      );
    });

    test('should handle metrics recording errors gracefully', async () => {
      mockQualityMetrics.recordDatabaseOperation.mockImplementation(() => {
        throw new Error('Metrics error');
      });
      
      const mockFn = jest.fn().mockResolvedValue('result');
      const wrappedFn = qualityMiddleware.wrapDatabaseOperation('SELECT', 'users', mockFn);
      
      // Should still return the result despite metrics error
      const result = await wrappedFn();
      expect(result).toBe('result');
    });
  });

  describe('wrapLLMProcessing', () => {
    test('should record successful LLM processing', async () => {
      const mockFn = jest.fn().mockResolvedValue('llm response');
      const wrappedFn = qualityMiddleware.wrapLLMProcessing('openai', 'gpt-4', 'completion', mockFn);
      
      const result = await wrappedFn('prompt');
      
      expect(result).toBe('llm response');
      expect(mockFn).toHaveBeenCalledWith('prompt');
      expect(mockQualityMetrics.recordLLMProcessing).toHaveBeenCalledWith(
        'openai',
        'gpt-4',
        'completion',
        expect.any(Number), // processingTime
        true, // success
        null // no error
      );
    });

    test('should record failed LLM processing', async () => {
      const error = new Error('LLM timeout');
      const mockFn = jest.fn().mockRejectedValue(error);
      const wrappedFn = qualityMiddleware.wrapLLMProcessing('anthropic', 'claude-3', 'chat', mockFn);
      
      await expect(wrappedFn()).rejects.toThrow('LLM timeout');
      
      expect(mockQualityMetrics.recordLLMProcessing).toHaveBeenCalledWith(
        'anthropic',
        'claude-3',
        'chat',
        expect.any(Number),
        false, // failed
        error
      );
    });
  });

  describe('wrapOperation', () => {
    test('should record successful generic operation', async () => {
      const mockFn = jest.fn().mockResolvedValue('operation result');
      const labels = { component: 'search', type: 'vector' };
      const wrappedFn = qualityMiddleware.wrapOperation('search_time', labels, mockFn);
      
      const result = await wrappedFn('query');
      
      expect(result).toBe('operation result');
      expect(mockQualityMetrics.recordMetric).toHaveBeenCalledWith(
        'search_time',
        expect.any(Number), // duration
        {
          ...labels,
          success: true,
          error: null
        }
      );
    });

    test('should record failed generic operation', async () => {
      const error = new Error('Operation failed');
      const mockFn = jest.fn().mockRejectedValue(error);
      const labels = { component: 'indexing' };
      const wrappedFn = qualityMiddleware.wrapOperation('index_time', labels, mockFn);
      
      await expect(wrappedFn()).rejects.toThrow('Operation failed');
      
      expect(mockQualityMetrics.recordMetric).toHaveBeenCalledWith(
        'index_time',
        expect.any(Number),
        {
          ...labels,
          success: false,
          error: 'Operation failed'
        }
      );
    });
  });

  describe('errorMonitoring middleware', () => {
    test('should record error metrics', () => {
      const middleware = qualityMiddleware.errorMonitoring();
      
      const error = new Error('Test error');
      error.status = 400;
      error.name = 'ValidationError';
      
      const mockReq = {
        method: 'POST',
        route: { path: '/api/test' }
      };
      
      const mockRes = {};
      const mockNext = jest.fn();
      
      middleware(error, mockReq, mockRes, mockNext);
      
      expect(mockQualityMetrics.recordMetric).toHaveBeenCalledWith(
        'error_count',
        1,
        {
          endpoint: '/api/test',
          method: 'POST',
          errorType: 'ValidationError',
          errorMessage: 'Test error',
          statusCode: 400
        }
      );
      
      expect(mockNext).toHaveBeenCalledWith(error);
    });

    test('should handle errors without status', () => {
      const middleware = qualityMiddleware.errorMonitoring();
      
      const error = new Error('Unknown error');
      const mockReq = {
        method: 'GET',
        path: '/api/unknown'
      };
      
      const mockRes = {};
      const mockNext = jest.fn();
      
      middleware(error, mockReq, mockRes, mockNext);
      
      expect(mockQualityMetrics.recordMetric).toHaveBeenCalledWith(
        'error_count',
        1,
        expect.objectContaining({
          statusCode: 500 // default
        })
      );
    });
  });

  describe('healthCheck endpoint', () => {
    test('should return healthy status', async () => {
      const mockSummary = { totalRequests: 100, avgResponseTime: 150 };
      const mockSLOs = [
        { name: 'API Response Time', isCompliant: true },
        { name: 'Error Rate', isCompliant: true }
      ];
      
      mockQualityMetrics.getMetricsSummary.mockReturnValue(mockSummary);
      mockQualityMetrics.getAllSLOCompliance.mockReturnValue(mockSLOs);
      
      const handler = qualityMiddleware.healthCheck();
      
      const mockReq = {};
      const mockRes = {
        json: jest.fn()
      };
      
      await handler(mockReq, mockRes);
      
      expect(mockRes.json).toHaveBeenCalledWith({
        status: 'healthy',
        timestamp: expect.any(String),
        metrics: mockSummary,
        slos: {
          total: 2,
          compliant: 2,
          violations: 0
        }
      });
    });

    test('should return degraded status for critical violations', async () => {
      const mockSLOs = [
        { name: 'API Availability', isCompliant: false },
        { name: 'Error Rate', isCompliant: false },
        { name: 'Response Time', isCompliant: true }
      ];
      
      mockQualityMetrics.getMetricsSummary.mockReturnValue({});
      mockQualityMetrics.getAllSLOCompliance.mockReturnValue(mockSLOs);
      
      const handler = qualityMiddleware.healthCheck();
      
      const mockReq = {};
      const mockRes = {
        json: jest.fn()
      };
      
      await handler(mockReq, mockRes);
      
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'degraded',
          criticalViolations: expect.arrayContaining([
            expect.objectContaining({ name: 'API Availability' }),
            expect.objectContaining({ name: 'Error Rate' })
          ])
        })
      );
    });

    test('should handle errors gracefully', async () => {
      mockQualityMetrics.getMetricsSummary.mockImplementation(() => {
        throw new Error('Metrics error');
      });
      
      const handler = qualityMiddleware.healthCheck();
      
      const mockReq = {};
      const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };
      
      await handler(mockReq, mockRes);
      
      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        status: 'unhealthy',
        timestamp: expect.any(String),
        error: 'Metrics error'
      });
    });
  });

  describe('metricsEndpoint', () => {
    test('should return specific metric data', async () => {
      const mockMetrics = { avg: 150, p95: 300, count: 100 };
      mockQualityMetrics.calculateMetrics.mockReturnValue(mockMetrics);
      
      const handler = qualityMiddleware.metricsEndpoint();
      
      const mockReq = {
        query: {
          window: '5m',
          type: 'response_time',
          labels: '{"endpoint": "/api/test"}'
        }
      };
      
      const mockRes = {
        json: jest.fn()
      };
      
      await handler(mockReq, mockRes);
      
      expect(mockQualityMetrics.calculateMetrics).toHaveBeenCalledWith(
        'response_time',
        { endpoint: '/api/test' },
        '5m'
      );
      
      expect(mockRes.json).toHaveBeenCalledWith({
        timestamp: expect.any(String),
        window: '5m',
        data: mockMetrics
      });
    });

    test('should return quality report when no specific metric requested', async () => {
      const mockReport = { metrics: {}, slos: [], summary: {} };
      mockQualityMetrics.generateQualityReport.mockResolvedValue(mockReport);
      
      const handler = qualityMiddleware.metricsEndpoint();
      
      const mockReq = {
        query: { window: '1h' }
      };
      
      const mockRes = {
        json: jest.fn()
      };
      
      await handler(mockReq, mockRes);
      
      expect(mockQualityMetrics.generateQualityReport).toHaveBeenCalledWith('1h');
      expect(mockRes.json).toHaveBeenCalledWith({
        timestamp: expect.any(String),
        window: '1h',
        data: mockReport
      });
    });

    test('should handle errors gracefully', async () => {
      mockQualityMetrics.calculateMetrics.mockImplementation(() => {
        throw new Error('Calculation error');
      });
      
      const handler = qualityMiddleware.metricsEndpoint();
      
      const mockReq = {
        query: { type: 'response_time' }
      };
      
      const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };
      
      await handler(mockReq, mockRes);
      
      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Calculation error',
        timestamp: expect.any(String)
      });
    });
  });

  describe('sloEndpoint', () => {
    test('should return specific SLO compliance', async () => {
      const mockCompliance = { sloId: 'api_response_time', isCompliant: true };
      mockQualityMetrics.checkSLOCompliance.mockReturnValue(mockCompliance);
      
      const handler = qualityMiddleware.sloEndpoint();
      
      const mockReq = {
        params: { sloId: 'api_response_time' },
        query: { window: '5m' }
      };
      
      const mockRes = {
        json: jest.fn()
      };
      
      await handler(mockReq, mockRes);
      
      expect(mockQualityMetrics.checkSLOCompliance).toHaveBeenCalledWith(
        'api_response_time',
        '5m'
      );
      
      expect(mockRes.json).toHaveBeenCalledWith({
        timestamp: expect.any(String),
        data: mockCompliance
      });
    });

    test('should return all SLO compliance when no specific SLO requested', async () => {
      const mockCompliance = [
        { sloId: 'api_response_time', isCompliant: true },
        { sloId: 'error_rate', isCompliant: false }
      ];
      mockQualityMetrics.getAllSLOCompliance.mockReturnValue(mockCompliance);
      
      const handler = qualityMiddleware.sloEndpoint();
      
      const mockReq = {
        params: {},
        query: {}
      };
      
      const mockRes = {
        json: jest.fn()
      };
      
      await handler(mockReq, mockRes);
      
      expect(mockQualityMetrics.getAllSLOCompliance).toHaveBeenCalled();
      expect(mockRes.json).toHaveBeenCalledWith({
        timestamp: expect.any(String),
        data: mockCompliance
      });
    });

    test('should handle errors gracefully', async () => {
      mockQualityMetrics.checkSLOCompliance.mockImplementation(() => {
        throw new Error('SLO check error');
      });
      
      const handler = qualityMiddleware.sloEndpoint();
      
      const mockReq = {
        params: { sloId: 'invalid_slo' },
        query: {}
      };
      
      const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };
      
      await handler(mockReq, mockRes);
      
      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'SLO check error',
        timestamp: expect.any(String)
      });
    });
  });
});
