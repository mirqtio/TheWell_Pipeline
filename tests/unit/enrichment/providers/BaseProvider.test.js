/**
 * BaseProvider Unit Tests
 */

const BaseProvider = require('../../../../src/enrichment/providers/BaseProvider');

describe('BaseProvider', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('constructor', () => {
    it('should throw error when instantiated directly', () => {
      expect(() => new BaseProvider()).toThrow('BaseProvider is abstract and cannot be instantiated directly');
    });

    it('should allow instantiation of subclasses', () => {
      class TestProvider extends BaseProvider {
        getName() { return 'test'; }
        getSupportedModels() { return ['test-model']; }
        async complete() { return {}; }
        calculateCost() { return {}; }
      }

      expect(() => new TestProvider()).not.toThrow();
    });

    it('should set default configuration', () => {
      class TestProvider extends BaseProvider {
        getName() { return 'test'; }
        getSupportedModels() { return ['test-model']; }
        async complete() { return {}; }
        calculateCost() { return {}; }
      }

      const provider = new TestProvider();
      expect(provider.config.maxRetries).toBe(3);
      expect(provider.config.timeout).toBe(30000);
    });

    it('should merge custom configuration', () => {
      class TestProvider extends BaseProvider {
        getName() { return 'test'; }
        getSupportedModels() { return ['test-model']; }
        async complete() { return {}; }
        calculateCost() { return {}; }
      }

      const provider = new TestProvider({ maxRetries: 5, timeout: 60000 });
      expect(provider.config.maxRetries).toBe(5);
      expect(provider.config.timeout).toBe(60000);
    });

    it('should initialize health properties', () => {
      class TestProvider extends BaseProvider {
        getName() { return 'test'; }
        getSupportedModels() { return ['test-model']; }
        async complete() { return {}; }
        calculateCost() { return {}; }
      }

      const provider = new TestProvider();
      expect(provider.isHealthy).toBe(true);
      expect(provider.lastHealthCheck).toBeNull();
      expect(provider.errorCount).toBe(0);
      expect(provider.requestCount).toBe(0);
    });
  });

  describe('abstract methods', () => {
    let provider;

    beforeEach(() => {
      class TestProvider extends BaseProvider {
        // Don't implement abstract methods to test error throwing
      }
      provider = new TestProvider();
    });

    it('should throw error for getName', () => {
      expect(() => provider.getName()).toThrow('getName() must be implemented by subclass');
    });

    it('should throw error for getSupportedModels', () => {
      expect(() => provider.getSupportedModels()).toThrow('getSupportedModels() must be implemented by subclass');
    });

    it('should throw error for complete', async () => {
      await expect(provider.complete({})).rejects.toThrow('complete() must be implemented by subclass');
    });

    it('should throw error for calculateCost', () => {
      expect(() => provider.calculateCost('model', 100, 50)).toThrow('calculateCost() must be implemented by subclass');
    });
  });

  describe('healthCheck', () => {
    let provider;

    beforeEach(() => {
      class TestProvider extends BaseProvider {
        getName() { return 'test'; }
        getSupportedModels() { return ['test-model']; }
        calculateCost() { return {}; }
        
        async complete(request) {
          if (this.shouldFail) {
            throw new Error('Test failure');
          }
          return { content: 'test response' };
        }
      }
      provider = new TestProvider();
    });

    it('should return healthy status on successful completion', async () => {
      const startTime = Date.now();
      jest.advanceTimersByTime(100); // Simulate 100ms elapsed
      
      const result = await provider.healthCheck();
      
      expect(result.healthy).toBe(true);
      expect(result.responseTime).toBeGreaterThanOrEqual(0);
      expect(result.timestamp).toBeInstanceOf(Date);
      expect(provider.isHealthy).toBe(true);
      expect(provider.lastHealthCheck).toBeInstanceOf(Date);
    });

    it('should return unhealthy status on completion failure', async () => {
      provider.shouldFail = true;
      
      const result = await provider.healthCheck();
      
      expect(result.healthy).toBe(false);
      expect(result.error).toBe('Test failure');
      expect(result.timestamp).toBeInstanceOf(Date);
      expect(provider.isHealthy).toBe(false);
      expect(provider.errorCount).toBe(1);
    });

    it('should use first supported model for health check', async () => {
      const completeSpy = jest.spyOn(provider, 'complete');
      
      await provider.healthCheck();
      
      expect(completeSpy).toHaveBeenCalledWith({
        model: 'test-model',
        prompt: 'Hello',
        options: { maxTokens: 5 }
      });
    });
  });

  describe('getStats', () => {
    let provider;

    beforeEach(() => {
      class TestProvider extends BaseProvider {
        getName() { return 'test'; }
        getSupportedModels() { return ['model1', 'model2']; }
        async complete() { return {}; }
        calculateCost() { return {}; }
      }
      provider = new TestProvider();
    });

    it('should return provider statistics', () => {
      provider.errorCount = 5;
      provider.requestCount = 100;
      provider.isHealthy = false;
      provider.lastHealthCheck = new Date('2024-01-01');

      const stats = provider.getStats();

      expect(stats).toEqual({
        name: 'test',
        isHealthy: false,
        lastHealthCheck: new Date('2024-01-01'),
        errorCount: 5,
        requestCount: 100,
        supportedModels: ['model1', 'model2']
      });
    });
  });

  describe('counter methods', () => {
    let provider;

    beforeEach(() => {
      class TestProvider extends BaseProvider {
        getName() { return 'test'; }
        getSupportedModels() { return ['test-model']; }
        async complete() { return {}; }
        calculateCost() { return {}; }
      }
      provider = new TestProvider();
    });

    it('should increment request count', () => {
      expect(provider.requestCount).toBe(0);
      provider.incrementRequestCount();
      expect(provider.requestCount).toBe(1);
      provider.incrementRequestCount();
      expect(provider.requestCount).toBe(2);
    });

    it('should increment error count', () => {
      expect(provider.errorCount).toBe(0);
      provider.incrementErrorCount();
      expect(provider.errorCount).toBe(1);
      provider.incrementErrorCount();
      expect(provider.errorCount).toBe(2);
    });

    it('should reset error count', () => {
      provider.errorCount = 10;
      provider.resetErrorCount();
      expect(provider.errorCount).toBe(0);
    });
  });
});
