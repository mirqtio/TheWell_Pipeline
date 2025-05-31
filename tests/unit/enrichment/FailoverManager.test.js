/**
 * Unit tests for FailoverManager
 * Tests enhanced failover logic, circuit breakers, health monitoring, and provider selection
 */

const FailoverManager = require('../../../src/enrichment/FailoverManager');
const logger = require('../../../src/utils/logger');

// Mock logger
jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

describe('FailoverManager', () => {
  let failoverManager;
  let mockProviders;
  let mockProvider1;
  let mockProvider2;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Create mock providers
    mockProvider1 = {
      getName: jest.fn().mockReturnValue('provider1'),
      complete: jest.fn(),
      healthCheck: jest.fn().mockResolvedValue({ status: 'healthy' })
    };
    
    mockProvider2 = {
      getName: jest.fn().mockReturnValue('provider2'),
      complete: jest.fn(),
      healthCheck: jest.fn().mockResolvedValue({ status: 'healthy' })
    };
    
    mockProviders = new Map([
      ['provider1', mockProvider1],
      ['provider2', mockProvider2]
    ]);
    
    // Create failover manager with test config
    failoverManager = new FailoverManager({
      circuitBreakerThreshold: 3,
      circuitBreakerTimeout: 1000,
      healthCheckInterval: 100,
      maxRetries: 2,
      baseRetryDelay: 10
    });
  });

  afterEach(async () => {
    if (failoverManager) {
      await failoverManager.shutdown();
    }
  });

  describe('Constructor and Initialization', () => {
    test('should initialize with default configuration', () => {
      const manager = new FailoverManager();
      expect(manager.config.circuitBreakerThreshold).toBe(5);
      expect(manager.config.maxRetries).toBe(3);
      expect(manager.config.baseRetryDelay).toBe(1000);
    });

    test('should initialize with custom configuration', () => {
      const config = {
        circuitBreakerThreshold: 10,
        maxRetries: 5,
        baseRetryDelay: 2000
      };
      const manager = new FailoverManager(config);
      expect(manager.config.circuitBreakerThreshold).toBe(10);
      expect(manager.config.maxRetries).toBe(5);
      expect(manager.config.baseRetryDelay).toBe(2000);
    });

    test('should initialize provider states when providers are set', () => {
      failoverManager.initialize(mockProviders);
      
      expect(failoverManager.providerStates.has('provider1')).toBe(true);
      expect(failoverManager.providerStates.has('provider2')).toBe(true);
      expect(failoverManager.circuitBreakers.has('provider1')).toBe(true);
      expect(failoverManager.circuitBreakers.has('provider2')).toBe(true);
    });
  });

  describe('Provider Selection', () => {
    beforeEach(() => {
      failoverManager.initialize(mockProviders);
    });

    test('should select providers based on score', () => {
      const request = { taskType: 'general', prompt: 'test' };
      const providers = failoverManager.selectProvidersForExecution(request);
      
      expect(providers).toContain('provider1');
      expect(providers).toContain('provider2');
      expect(providers.length).toBe(2);
    });

    test('should exclude specified providers', () => {
      const request = { taskType: 'general', prompt: 'test' };
      const providers = failoverManager.selectProvidersForExecution(request, ['provider1']);
      
      expect(providers).not.toContain('provider1');
      expect(providers).toContain('provider2');
      expect(providers.length).toBe(1);
    });

    test('should exclude providers with open circuit breakers', () => {
      // Manually open circuit breaker
      const circuitBreaker = failoverManager.circuitBreakers.get('provider1');
      circuitBreaker.state = 'open';
      circuitBreaker.nextAttemptTime = Date.now() + 10000; // 10 seconds in future
      
      const request = { taskType: 'general', prompt: 'test' };
      const providers = failoverManager.selectProvidersForExecution(request);
      
      expect(providers).not.toContain('provider1');
      expect(providers).toContain('provider2');
    });
  });

  describe('Execution with Failover', () => {
    beforeEach(() => {
      failoverManager.initialize(mockProviders);
    });

    test('should execute successfully with first provider', async () => {
      const mockResult = {
        content: 'test response',
        model: 'test-model',
        cost: { total: 0.01 },
        provider: 'provider1'
      };
      
      mockProvider1.complete.mockResolvedValue(mockResult);
      
      const request = { prompt: 'test prompt' };
      const result = await failoverManager.executeWithFailover(request);
      
      expect(result).toEqual(mockResult);
      expect(mockProvider1.complete).toHaveBeenCalledWith(request);
      expect(mockProvider2.complete).not.toHaveBeenCalled();
    });

    test('should failover to second provider when first fails', async () => {
      const error = new Error('Provider 1 failed');
      error.status = 500;
      
      const mockResult = {
        content: 'test response',
        model: 'test-model',
        cost: { total: 0.01 },
        provider: 'provider2'
      };
      
      mockProvider1.complete.mockRejectedValue(error);
      mockProvider2.complete.mockResolvedValue(mockResult);
      
      const request = { prompt: 'test prompt' };
      const result = await failoverManager.executeWithFailover(request);
      
      expect(result).toEqual(mockResult);
      expect(mockProvider1.complete).toHaveBeenCalledWith(request);
      expect(mockProvider2.complete).toHaveBeenCalledWith(request);
    });

    test('should throw error when all providers fail', async () => {
      const error1 = new Error('Provider 1 failed');
      const error2 = new Error('Provider 2 failed');
      
      mockProvider1.complete.mockRejectedValue(error1);
      mockProvider2.complete.mockRejectedValue(error2);
      
      const request = { prompt: 'test prompt' };
      
      await expect(failoverManager.executeWithFailover(request))
        .rejects.toThrow('All providers failed');
      
      expect(mockProvider1.complete).toHaveBeenCalled();
      expect(mockProvider2.complete).toHaveBeenCalled();
    });

    test('should emit events during execution', async () => {
      const mockResult = {
        content: 'test response',
        cost: { total: 0.01 }
      };
      
      mockProvider1.complete.mockResolvedValue(mockResult);
      
      const successSpy = jest.fn();
      failoverManager.on('execution_success', successSpy);
      
      const request = { prompt: 'test prompt' };
      await failoverManager.executeWithFailover(request);
      
      expect(successSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'provider1',
          cost: 0.01
        })
      );
    });
  });

  describe('Retry Logic', () => {
    beforeEach(() => {
      failoverManager.initialize(mockProviders);
    });

    test('should retry on retryable errors', async () => {
      const retryableError = new Error('Network timeout');
      retryableError.code = 'TIMEOUT';
      
      const mockResult = {
        content: 'test response',
        cost: { total: 0.01 }
      };
      
      mockProvider1.complete
        .mockRejectedValueOnce(retryableError)
        .mockRejectedValueOnce(retryableError)
        .mockResolvedValue(mockResult);
      
      const request = { prompt: 'test prompt' };
      const result = await failoverManager.executeWithFailover(request);
      
      expect(result).toEqual(mockResult);
      expect(mockProvider1.complete).toHaveBeenCalledTimes(3);
    });

    test('should not retry on non-retryable errors', async () => {
      const nonRetryableError = new Error('Invalid API key');
      nonRetryableError.status = 401;
      
      const mockResult = {
        content: 'test response',
        cost: { total: 0.01 }
      };
      
      mockProvider1.complete.mockRejectedValue(nonRetryableError);
      mockProvider2.complete.mockResolvedValue(mockResult);
      
      const request = { prompt: 'test prompt' };
      const result = await failoverManager.executeWithFailover(request);
      
      expect(result).toEqual(mockResult);
      expect(mockProvider1.complete).toHaveBeenCalledTimes(1); // No retries
      expect(mockProvider2.complete).toHaveBeenCalledTimes(1);
    });

    test('should calculate retry delay with exponential backoff', () => {
      // Mock Math.random to ensure consistent jitter
      const originalRandom = Math.random;
      Math.random = jest.fn(() => 0.5); // No jitter (returns 0.5 - 0.5 = 0)
      
      // Create a test manager with known configuration
      const testManager = new FailoverManager({
        baseRetryDelay: 100,
        retryMultiplier: 2,
        maxRetryDelay: 10000
      });
      
      const delay1 = testManager.calculateRetryDelay(0); // 100 * 2^0 = 100
      const delay2 = testManager.calculateRetryDelay(1); // 100 * 2^1 = 200  
      const delay3 = testManager.calculateRetryDelay(2); // 100 * 2^2 = 400
      
      expect(delay1).toBe(100);
      expect(delay2).toBe(200);
      expect(delay3).toBe(400);
      
      // Restore original Math.random
      Math.random = originalRandom;
    });
  });

  describe('Circuit Breaker', () => {
    beforeEach(() => {
      failoverManager.initialize(mockProviders);
    });

    test('should open circuit breaker after threshold failures', async () => {
      // Create failover manager with lower threshold for testing
      const testFailoverManager = new FailoverManager({
        circuitBreakerThreshold: 3,
        maxRetries: 0, // No retries to make failures immediate
        healthCheckInterval: 0 // Disable health checks to prevent hanging
      });
      
      // Don't call initialize to avoid starting health monitoring
      testFailoverManager.providers = mockProviders;
      testFailoverManager.providerStates = new Map();
      testFailoverManager.circuitBreakers = new Map();
      testFailoverManager.performanceMetrics = new Map();
      
      // Manually set up provider states and circuit breakers
      for (const [name] of mockProviders) {
        testFailoverManager.providerStates.set(name, {
          status: 'healthy',
          consecutiveFailures: 0,
          lastSuccessTime: Date.now(),
          lastFailureTime: null,
          lastHealthCheck: null
        });
        
        testFailoverManager.circuitBreakers.set(name, {
          state: 'closed',
          failureCount: 0,
          lastFailureTime: null,
          nextAttemptTime: null
        });
        
        testFailoverManager.performanceMetrics.set(name, {
          requestCount: 0,
          failureCount: 0,
          totalResponseTime: 0,
          totalCost: 0,
          reliability: 1.0,
          costHistory: []
        });
      }
      
      const error = new Error('Persistent failure');
      error.status = 500;
      
      // Directly record failures to trigger circuit breaker
      for (let i = 0; i < 3; i++) {
        testFailoverManager.recordFailure('provider1', error);
        testFailoverManager.updateCircuitBreaker('provider1', error);
      }
      
      const circuitBreaker = testFailoverManager.circuitBreakers.get('provider1');
      expect(circuitBreaker.state).toBe('open');
    });

    test('should transition to half-open after timeout', async () => {
      // Manually set circuit breaker to open with past timeout
      const circuitBreaker = failoverManager.circuitBreakers.get('provider1');
      circuitBreaker.state = 'open';
      circuitBreaker.nextAttemptTime = Date.now() - 1000; // 1 second ago
      
      const canExecute = failoverManager.canExecuteWithProvider('provider1');
      expect(canExecute).toBe(true);
      expect(circuitBreaker.state).toBe('half-open');
    });

    test('should close circuit breaker on successful execution', () => {
      const circuitBreaker = failoverManager.circuitBreakers.get('provider1');
      circuitBreaker.state = 'half-open';
      
      failoverManager.recordSuccess('provider1', 100, 0.01);
      
      expect(circuitBreaker.state).toBe('closed');
      expect(circuitBreaker.failureCount).toBe(0);
    });
  });

  describe('Health Monitoring', () => {
    beforeEach(() => {
      failoverManager.initialize(mockProviders);
    });

    test('should perform health checks on providers', async () => {
      await failoverManager.performHealthCheck('provider1', mockProvider1);
      
      expect(mockProvider1.healthCheck).toHaveBeenCalled();
      
      const state = failoverManager.providerStates.get('provider1');
      expect(state.lastHealthCheck).toBeTruthy();
    });

    test('should restore unhealthy provider to healthy on successful health check', async () => {
      // Mark provider as unhealthy
      const state = failoverManager.providerStates.get('provider1');
      state.status = 'unhealthy';
      
      await failoverManager.performHealthCheck('provider1', mockProvider1);
      
      expect(state.status).toBe('healthy');
      expect(state.consecutiveFailures).toBe(0);
    });

    test('should handle health check failures gracefully', async () => {
      mockProvider1.healthCheck.mockRejectedValue(new Error('Health check failed'));
      
      await failoverManager.performHealthCheck('provider1', mockProvider1);
      
      // Should not throw and should log debug message
      expect(logger.debug).toHaveBeenCalledWith(
        'Health check failed',
        expect.objectContaining({
          provider: 'provider1'
        })
      );
    });
  });

  describe('Performance Metrics', () => {
    beforeEach(() => {
      failoverManager.initialize(mockProviders);
    });

    test('should record success metrics', () => {
      failoverManager.recordSuccess('provider1', 150, 0.02);
      
      const state = failoverManager.providerStates.get('provider1');
      const metrics = failoverManager.performanceMetrics.get('provider1');
      
      expect(state.totalRequests).toBe(1);
      expect(state.averageResponseTime).toBe(150);
      expect(metrics.responseTimeHistory).toContain(150);
      expect(metrics.costHistory).toContain(0.02);
      expect(metrics.successRate).toBe(1.0);
    });

    test('should record failure metrics', () => {
      const error = new Error('Test failure');
      failoverManager.recordFailure('provider1', error);
      
      const state = failoverManager.providerStates.get('provider1');
      const metrics = failoverManager.performanceMetrics.get('provider1');
      
      expect(state.totalRequests).toBe(1);
      expect(state.totalFailures).toBe(1);
      expect(state.consecutiveFailures).toBe(1);
      expect(metrics.successRate).toBe(0);
    });

    test('should calculate provider reliability', () => {
      // Record some successes and failures
      failoverManager.recordSuccess('provider1', 100, 0.01);
      failoverManager.recordSuccess('provider1', 120, 0.01);
      failoverManager.recordFailure('provider1', new Error('test'));
      
      const reliability = failoverManager.calculateReliability('provider1');
      expect(reliability).toBeGreaterThan(0);
      expect(reliability).toBeLessThan(1);
    });

    test('should calculate average cost', () => {
      failoverManager.recordSuccess('provider1', 100, 0.01);
      failoverManager.recordSuccess('provider1', 120, 0.02);
      failoverManager.recordSuccess('provider1', 110, 0.015);
      
      const avgCost = failoverManager.getAverageCost('provider1');
      expect(avgCost).toBeCloseTo(0.015);
    });
  });

  describe('Error Classification', () => {
    test('should identify retryable errors correctly', () => {
      const retryableErrors = [
        { code: 'ECONNRESET' },
        { code: 'TIMEOUT' },
        { status: 500 },
        { status: 502 },
        { status: 429 },
        { message: 'network timeout' }
      ];
      
      retryableErrors.forEach(error => {
        expect(failoverManager.isRetryableError(error)).toBe(true);
      });
    });

    test('should identify non-retryable errors correctly', () => {
      const nonRetryableErrors = [
        { status: 400 },
        { status: 401 },
        { status: 403 },
        { message: 'invalid request' }
      ];
      
      nonRetryableErrors.forEach(error => {
        expect(failoverManager.isRetryableError(error)).toBe(false);
      });
    });
  });

  describe('Statistics and Reporting', () => {
    beforeEach(() => {
      failoverManager.initialize(mockProviders);
    });

    test('should return comprehensive failover statistics', () => {
      // Record some activity
      failoverManager.recordSuccess('provider1', 150, 0.02);
      failoverManager.recordFailure('provider2', new Error('test'));
      
      const stats = failoverManager.getFailoverStats();
      
      expect(stats).toHaveProperty('totalFailovers');
      expect(stats).toHaveProperty('providerFailures');
      expect(stats).toHaveProperty('providers');
      expect(stats.providers).toHaveProperty('provider1');
      expect(stats.providers).toHaveProperty('provider2');
      
      expect(stats.providers.provider1.totalRequests).toBe(1);
      expect(stats.providers.provider1.successRate).toBe(1.0);
      expect(stats.providers.provider2.totalFailures).toBe(1);
    });

    test('should track provider failure counts', () => {
      failoverManager.recordFailure('provider1', new Error('test1'));
      failoverManager.recordFailure('provider1', new Error('test2'));
      failoverManager.recordFailure('provider2', new Error('test3'));
      
      const stats = failoverManager.getFailoverStats();
      expect(stats.providerFailures.get('provider1')).toBe(2);
      expect(stats.providerFailures.get('provider2')).toBe(1);
    });
  });

  describe('Provider Scoring', () => {
    beforeEach(() => {
      failoverManager.initialize(mockProviders);
    });

    test('should calculate provider scores based on performance', () => {
      // Set up different performance metrics
      const state1 = failoverManager.providerStates.get('provider1');
      const state2 = failoverManager.providerStates.get('provider2');
      
      state1.averageResponseTime = 100;
      state2.averageResponseTime = 200;
      
      const score1 = failoverManager.calculateProviderScore('provider1', {});
      const score2 = failoverManager.calculateProviderScore('provider2', {});
      
      expect(score1).toBeGreaterThan(score2); // Better performance = higher score
    });

    test('should penalize providers with recent failures', () => {
      const state = failoverManager.providerStates.get('provider1');
      state.lastFailureTime = Date.now() - 30000; // 30 seconds ago
      
      const scoreWithRecentFailure = failoverManager.calculateProviderScore('provider1', {});
      
      state.lastFailureTime = Date.now() - 120000; // 2 minutes ago
      const scoreWithOldFailure = failoverManager.calculateProviderScore('provider1', {});
      
      expect(scoreWithOldFailure).toBeGreaterThan(scoreWithRecentFailure);
    });
  });

  describe('Shutdown', () => {
    test('should clear health check intervals on shutdown', async () => {
      failoverManager.initialize(mockProviders);
      
      // Verify intervals are set
      expect(failoverManager.healthCheckIntervals.size).toBe(2);
      
      await failoverManager.shutdown();
      
      // Verify intervals are cleared
      expect(failoverManager.healthCheckIntervals.size).toBe(0);
    });
  });

  describe('Event Emission', () => {
    beforeEach(() => {
      failoverManager.initialize(mockProviders);
    });

    test('should emit circuit breaker opened event', () => {
      const eventSpy = jest.fn();
      failoverManager.on('circuit_breaker_opened', eventSpy);
      
      // Trigger circuit breaker
      const error = new Error('test');
      for (let i = 0; i < 3; i++) {
        failoverManager.updateCircuitBreaker('provider1', error);
      }
      
      expect(eventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'provider1',
          failureCount: 3
        })
      );
    });

    test('should emit provider recovered event', async () => {
      const eventSpy = jest.fn();
      failoverManager.on('provider_recovered', eventSpy);
      
      // Mark provider as unhealthy
      const state = failoverManager.providerStates.get('provider1');
      state.status = 'unhealthy';
      
      // Perform successful health check
      await failoverManager.performHealthCheck('provider1', mockProvider1);
      
      expect(eventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'provider1'
        })
      );
    });
  });
});
