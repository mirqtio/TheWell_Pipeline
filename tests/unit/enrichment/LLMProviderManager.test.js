/**
 * LLMProviderManager Unit Tests
 */

const LLMProviderManager = require('../../../src/enrichment/LLMProviderManager');
const OpenAIProvider = require('../../../src/enrichment/providers/OpenAIProvider');
const AnthropicProvider = require('../../../src/enrichment/providers/AnthropicProvider');

// Mock the providers
jest.mock('../../../src/enrichment/providers/OpenAIProvider');
jest.mock('../../../src/enrichment/providers/AnthropicProvider');

describe('LLMProviderManager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    
    // Clear timers
    jest.clearAllTimers();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  describe('constructor', () => {
    it('should throw error with no providers configured', () => {
      expect(() => new LLMProviderManager({}))
        .toThrow('No LLM providers configured. Please provide API keys for at least one provider.');
    });

    it('should initialize OpenAI provider when configured', () => {
      const config = {
        openai: { apiKey: 'test-openai-key' }
      };

      const manager = new LLMProviderManager(config);

      expect(OpenAIProvider).toHaveBeenCalledWith(config.openai);
      expect(manager.providers.openai).toBeDefined();
      expect(manager.providerHealth.openai).toEqual({
        consecutiveFailures: 0,
        lastFailure: null,
        isAvailable: true
      });
    });

    it('should initialize Anthropic provider when configured', () => {
      const config = {
        anthropic: { apiKey: 'test-anthropic-key' }
      };

      const manager = new LLMProviderManager(config);

      expect(AnthropicProvider).toHaveBeenCalledWith(config.anthropic);
      expect(manager.providers.anthropic).toBeDefined();
      expect(manager.providerHealth.anthropic).toEqual({
        consecutiveFailures: 0,
        lastFailure: null,
        isAvailable: true
      });
    });

    it('should initialize both providers when both configured', () => {
      const config = {
        openai: { apiKey: 'test-openai-key' },
        anthropic: { apiKey: 'test-anthropic-key' }
      };

      const manager = new LLMProviderManager(config);

      expect(OpenAIProvider).toHaveBeenCalledWith(config.openai);
      expect(AnthropicProvider).toHaveBeenCalledWith(config.anthropic);
      expect(Object.keys(manager.providers)).toHaveLength(2);
    });

    it('should handle provider initialization errors gracefully', () => {
      OpenAIProvider.mockImplementation(() => {
        throw new Error('Invalid API key');
      });

      const config = {
        openai: { apiKey: 'invalid-key' },
        anthropic: { apiKey: 'test-anthropic-key' }
      };

      const manager = new LLMProviderManager(config);

      expect(manager.providers.openai).toBeUndefined();
      expect(manager.providers.anthropic).toBeDefined();
    });

    it('should start health monitoring', () => {
      const mockOpenAI = {
        getName: () => 'openai',
        isHealthy: true
      };

      OpenAIProvider.mockImplementation(() => mockOpenAI);

      const config = {
        openai: { apiKey: 'test-key' },
        healthCheckInterval: 60000
      };

      const manager = new LLMProviderManager(config);

      expect(manager.healthCheckInterval).toBeDefined();
    });
  });

  describe('getProvider', () => {
    let manager;
    let mockOpenAI;
    let mockAnthropic;

    beforeEach(() => {
      mockOpenAI = {
        getName: () => 'openai',
        isHealthy: true
      };
      
      mockAnthropic = {
        getName: () => 'anthropic',
        isHealthy: true
      };

      OpenAIProvider.mockImplementation(() => mockOpenAI);
      AnthropicProvider.mockImplementation(() => mockAnthropic);

      const config = {
        openai: { apiKey: 'test-openai-key' },
        anthropic: { apiKey: 'test-anthropic-key' }
      };

      manager = new LLMProviderManager(config);
    });

    it('should return available provider', async () => {
      const provider = await manager.getProvider();
      expect(provider).toBeDefined();
      expect(['openai', 'anthropic']).toContain(provider.getName());
    });

    it('should exclude specified providers', async () => {
      const provider = await manager.getProvider('general', 0, ['openai']);
      expect(provider.getName()).toBe('anthropic');
    });

    it('should throw error when no providers available', async () => {
      manager.providerHealth.openai.isAvailable = false;
      manager.providerHealth.anthropic.isAvailable = false;

      await expect(manager.getProvider())
        .rejects.toThrow('No available providers for task execution');
    });

    it('should select provider based on document size strategy', async () => {
      const provider = await manager.getProvider('general', 60000); // Large document
      // Should prefer anthropic for large documents
      expect(provider.getName()).toBe('anthropic');
    });

    it('should select provider based on task type strategy', async () => {
      const provider = await manager.getProvider('critical_analysis');
      // Should prefer openai for critical analysis
      expect(provider.getName()).toBe('openai');
    });

    it('should select provider with lowest error rate as fallback', async () => {
      manager.providerHealth.openai.consecutiveFailures = 2;
      manager.providerHealth.anthropic.consecutiveFailures = 1;

      const provider = await manager.getProvider();
      expect(provider.getName()).toBe('anthropic');
    });
  });

  describe('executeWithFailover', () => {
    let manager;
    let mockOpenAI;
    let mockAnthropic;

    beforeEach(() => {
      mockOpenAI = {
        getName: () => 'openai',
        isHealthy: true,
        complete: jest.fn()
      };
      
      mockAnthropic = {
        getName: () => 'anthropic',
        isHealthy: true,
        complete: jest.fn()
      };

      OpenAIProvider.mockImplementation(() => mockOpenAI);
      AnthropicProvider.mockImplementation(() => mockAnthropic);

      const config = {
        openai: { apiKey: 'test-openai-key' },
        anthropic: { apiKey: 'test-anthropic-key' }
      };

      manager = new LLMProviderManager(config);
    });

    it('should execute successfully with first provider', async () => {
      const mockResult = {
        content: 'Test response',
        model: 'gpt-4-turbo',
        cost: { total: 0.01 },
        metadata: {}
      };

      mockOpenAI.complete.mockResolvedValueOnce(mockResult);

      const result = await manager.executeWithFailover({
        prompt: 'Test prompt'
      });

      expect(result.content).toBe('Test response');
      expect(result.metadata.totalDuration).toBeDefined();
      expect(result.metadata.executionTimestamp).toBeDefined();
      expect(manager.providerHealth.openai.consecutiveFailures).toBe(0);
    });

    it('should failover to second provider on first provider failure', async () => {
      const error = new Error('First provider failed');
      error.provider = 'openai';
      
      const mockResult = {
        content: 'Fallback response',
        model: 'claude-3-sonnet',
        cost: { total: 0.005 },
        metadata: {}
      };

      mockOpenAI.complete.mockRejectedValueOnce(error);
      mockAnthropic.complete.mockResolvedValueOnce(mockResult);

      const result = await manager.executeWithFailover({
        prompt: 'Test prompt'
      });

      expect(result.content).toBe('Fallback response');
      expect(manager.providerHealth.openai.consecutiveFailures).toBe(1);
    });

    it('should throw error when all providers fail', async () => {
      const error1 = new Error('OpenAI failed');
      error1.provider = 'openai';
      
      const error2 = new Error('Anthropic failed');
      error2.provider = 'anthropic';

      mockOpenAI.complete.mockRejectedValueOnce(error1);
      mockAnthropic.complete.mockRejectedValueOnce(error2);

      await expect(manager.executeWithFailover({
        prompt: 'Test prompt'
      })).rejects.toThrow('All providers failed. Last error: Anthropic failed');
    });

    it('should handle provider failure and update health', async () => {
      const error = new Error('Provider failed');
      error.provider = 'openai';

      mockOpenAI.complete.mockRejectedValueOnce(error);
      mockAnthropic.complete.mockResolvedValueOnce({
        content: 'Success',
        cost: { total: 0.01 },
        metadata: {}
      });

      await manager.executeWithFailover({ prompt: 'Test' });

      expect(manager.providerHealth.openai.consecutiveFailures).toBe(1);
      expect(manager.providerHealth.openai.lastFailure).toBeInstanceOf(Date);
    });
  });

  describe('executeWithProvider', () => {
    let manager;
    let mockProvider;

    beforeEach(() => {
      mockProvider = {
        getName: () => 'test-provider',
        complete: jest.fn()
      };

      const config = {
        openai: { apiKey: 'test-key' }
      };

      manager = new LLMProviderManager(config);
    });

    it('should execute and add metadata', async () => {
      const mockResult = {
        content: 'Test response',
        model: 'test-model',
        cost: { total: 0.01 },
        metadata: { provider: 'test-provider' }
      };

      mockProvider.complete.mockResolvedValueOnce(mockResult);

      const result = await manager.executeWithProvider(mockProvider, {
        prompt: 'Test'
      });

      expect(result.metadata.totalDuration).toBeDefined();
      expect(result.metadata.executionTimestamp).toBeDefined();
      expect(result.metadata.provider).toBe('test-provider');
    });

    it('should enhance error with provider context', async () => {
      const error = new Error('Provider error');
      mockProvider.complete.mockRejectedValueOnce(error);

      await expect(manager.executeWithProvider(mockProvider, {
        prompt: 'Test'
      })).rejects.toThrow('Provider error');

      expect(error.provider).toBe('test-provider');
      expect(error.duration).toBeDefined();
    });
  });

  describe('getAvailableProviders', () => {
    let manager;

    beforeEach(() => {
      const mockOpenAI = {
        getName: () => 'openai',
        isHealthy: true
      };
      
      const mockAnthropic = {
        getName: () => 'anthropic',
        isHealthy: false
      };

      OpenAIProvider.mockImplementation(() => mockOpenAI);
      AnthropicProvider.mockImplementation(() => mockAnthropic);

      const config = {
        openai: { apiKey: 'test-openai-key' },
        anthropic: { apiKey: 'test-anthropic-key' }
      };

      manager = new LLMProviderManager(config);
    });

    it('should return only healthy and available providers', () => {
      const available = manager.getAvailableProviders();
      expect(available).toHaveLength(1);
      expect(available[0].getName()).toBe('openai');
    });

    it('should exclude specified providers', () => {
      const available = manager.getAvailableProviders(['openai']);
      expect(available).toHaveLength(0);
    });

    it('should exclude unavailable providers', () => {
      manager.providerHealth.openai.isAvailable = false;
      
      const available = manager.getAvailableProviders();
      expect(available).toHaveLength(0);
    });
  });

  describe('handleProviderFailure', () => {
    let manager;

    beforeEach(() => {
      const config = {
        openai: { apiKey: 'test-key' },
        failoverThreshold: 3
      };

      manager = new LLMProviderManager(config);
    });

    it('should increment consecutive failures', () => {
      manager.handleProviderFailure('openai', new Error('Test error'));
      
      expect(manager.providerHealth.openai.consecutiveFailures).toBe(1);
      expect(manager.providerHealth.openai.lastFailure).toBeInstanceOf(Date);
      expect(manager.providerHealth.openai.isAvailable).toBe(true);
    });

    it('should mark provider unavailable after threshold', () => {
      // Simulate multiple failures
      for (let i = 0; i < 3; i++) {
        manager.handleProviderFailure('openai', new Error('Test error'));
      }
      
      expect(manager.providerHealth.openai.consecutiveFailures).toBe(3);
      expect(manager.providerHealth.openai.isAvailable).toBe(false);
    });

    it('should handle unknown provider gracefully', () => {
      expect(() => manager.handleProviderFailure('unknown', new Error('Test')))
        .not.toThrow();
    });
  });

  describe('performHealthChecks', () => {
    let manager;
    let mockOpenAI;

    beforeEach(() => {
      mockOpenAI = {
        getName: () => 'openai',
        healthCheck: jest.fn()
      };

      OpenAIProvider.mockImplementation(() => mockOpenAI);

      const config = {
        openai: { apiKey: 'test-key' }
      };

      manager = new LLMProviderManager(config);
    });

    it('should perform health checks on all providers', async () => {
      mockOpenAI.healthCheck.mockResolvedValueOnce({
        healthy: true,
        responseTime: 100
      });

      await manager.performHealthChecks();

      expect(mockOpenAI.healthCheck).toHaveBeenCalled();
      expect(manager.providerHealth.openai.isAvailable).toBe(true);
      expect(manager.providerHealth.openai.consecutiveFailures).toBe(0);
    });

    it('should handle health check failures', async () => {
      mockOpenAI.healthCheck.mockRejectedValueOnce(new Error('Health check failed'));

      await manager.performHealthChecks();

      expect(mockOpenAI.healthCheck).toHaveBeenCalled();
      // Should not throw, just log the error
    });
  });

  describe('getSystemHealth', () => {
    let manager;

    beforeEach(() => {
      const mockOpenAI = {
        getName: () => 'openai',
        getStats: () => ({
          name: 'openai',
          requestCount: 10,
          errorCount: 2,
          isHealthy: true
        })
      };

      OpenAIProvider.mockImplementation(() => mockOpenAI);

      const config = {
        openai: { apiKey: 'test-key' }
      };

      manager = new LLMProviderManager(config);
    });

    it('should return system health summary', () => {
      const health = manager.getSystemHealth();

      expect(health.totalProviders).toBe(1);
      expect(health.availableProviders).toBe(1);
      expect(health.totalRequests).toBe(10);
      expect(health.totalErrors).toBe(2);
      expect(health.errorRate).toBe(0.2);
      expect(health.providers).toHaveLength(1);
    });
  });

  describe('shutdown', () => {
    it('should clear health check interval', () => {
      const config = {
        openai: { apiKey: 'test-key' }
      };

      const manager = new LLMProviderManager(config);
      const intervalId = manager.healthCheckInterval;

      manager.shutdown();

      expect(manager.healthCheckInterval).toBeNull();
    });
  });
});
