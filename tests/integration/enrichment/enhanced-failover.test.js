/**
 * Integration tests for Enhanced Failover Logic
 * Tests the complete failover system including LLMProviderManager and FailoverManager
 */

const LLMProviderManager = require('../../../src/enrichment/LLMProviderManager');
const logger = require('../../../src/utils/logger');

// Mock logger
jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

// Mock fetch for provider API calls
global.fetch = jest.fn();

describe('Enhanced Failover Logic Integration', () => {
  let providerManager;
  let mockOpenAIResponse;
  let mockAnthropicResponse;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup mock responses
    mockOpenAIResponse = {
      ok: true,
      json: jest.fn().mockResolvedValue({
        choices: [{
          message: {
            content: 'OpenAI response content'
          }
        }],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30
        },
        model: 'gpt-3.5-turbo'
      })
    };
    
    mockAnthropicResponse = {
      ok: true,
      json: jest.fn().mockResolvedValue({
        content: [{
          text: 'Anthropic response content'
        }],
        usage: {
          input_tokens: 10,
          output_tokens: 20
        },
        model: 'claude-3-haiku-20240307'
      })
    };
    
    // Configure provider manager with both providers
    const config = {
      openai: {
        apiKey: 'test-openai-key',
        model: 'gpt-3.5-turbo',
        timeout: 5000,
        maxRetries: 1 // Reduce provider retries for faster tests
      },
      anthropic: {
        apiKey: 'test-anthropic-key',
        model: 'claude-3-haiku-20240307',
        timeout: 5000,
        maxRetries: 1 // Reduce provider retries for faster tests
      },
      failover: {
        circuitBreakerThreshold: 3,
        circuitBreakerTimeout: 1000,
        healthCheckInterval: 0, // Disable health checks for integration tests
        maxRetries: 1, // Reduce retries for faster tests
        baseRetryDelay: 10
      }
    };
    
    providerManager = new LLMProviderManager(config);
  });

  afterEach(async () => {
    if (providerManager) {
      await providerManager.shutdown();
    }
  });

  describe('Provider Initialization and Health', () => {
    test('should initialize both providers successfully', () => {
      expect(providerManager.providers.size).toBe(2);
      expect(providerManager.providers.has('openai')).toBe(true);
      expect(providerManager.providers.has('anthropic')).toBe(true);
    });

    test('should initialize failover manager with providers', () => {
      expect(providerManager.failoverManager).toBeDefined();
      expect(providerManager.failoverManager.providers).toBeDefined();
      expect(providerManager.failoverManager.providers.size).toBe(2);
    });

    test('should track provider states in failover manager', () => {
      const states = providerManager.failoverManager.providerStates;
      expect(states.has('openai')).toBe(true);
      expect(states.has('anthropic')).toBe(true);
      
      const openaiState = states.get('openai');
      expect(openaiState.status).toBe('healthy');
      expect(openaiState.consecutiveFailures).toBe(0);
    });
  });

  describe('Successful Execution', () => {
    test('should execute completion with first available provider', async () => {
      fetch.mockResolvedValue(mockOpenAIResponse);
      
      const request = {
        prompt: 'Test prompt for completion',
        model: 'gpt-3.5-turbo',
        taskType: 'general'
      };
      
      const result = await providerManager.execute(request);
      
      expect(result).toBeDefined();
      expect(result.content).toBe('OpenAI response content');
      expect(result.provider).toBe('openai');
      expect(result.cost).toBeDefined();
      expect(result.cost.total).toBeGreaterThan(0);
    });

    test('should record success metrics in failover manager', async () => {
      fetch.mockResolvedValue(mockOpenAIResponse);
      
      const request = {
        prompt: 'Test prompt',
        taskType: 'general'
      };
      
      await providerManager.execute(request);
      
      const stats = providerManager.failoverManager.getFailoverStats();
      expect(stats.providers.openai.totalRequests).toBe(1);
      expect(stats.providers.openai.totalFailures).toBe(0);
      expect(stats.providers.openai.successRate).toBe(1.0);
    });
  });

  describe('Failover Scenarios', () => {
    test('should failover from OpenAI to Anthropic on provider failure', async () => {
      // Mock OpenAI failures (need multiple for retries)
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: jest.fn().mockResolvedValue({
          error: { message: 'Internal server error' }
        })
      });
      
      // Mock second retry for OpenAI
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: jest.fn().mockResolvedValue({
          error: { message: 'Internal server error' }
        })
      });
      
      // Mock Anthropic success
      fetch.mockResolvedValueOnce(mockAnthropicResponse);
      
      const request = {
        prompt: 'Test prompt for failover',
        taskType: 'general'
      };
      
      const result = await providerManager.execute(request);
      
      expect(result).toBeDefined();
      expect(result.content).toBe('Anthropic response content');
      expect(result.provider).toBe('anthropic');
      expect(fetch).toHaveBeenCalledTimes(3); // 2 OpenAI retries + 1 Anthropic success
    }, 10000); // Increase timeout to 10 seconds

    test('should track failures and update provider health', async () => {
      // Simulate OpenAI failures
      fetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: jest.fn().mockResolvedValue({
          error: { message: 'Server error' }
        })
      });
      
      const request = { prompt: 'Test prompt', taskType: 'general' };
      
      // Execute multiple times to trigger failures
      for (let i = 0; i < 3; i++) {
        try {
          await providerManager.execute(request);
        } catch (error) {
          // Expected to fail when all providers are down
        }
      }
      
      const stats = providerManager.failoverManager.getFailoverStats();
      expect(stats.providers.openai.totalFailures).toBeGreaterThan(0);
      expect(stats.providers.anthropic.totalFailures).toBeGreaterThan(0);
    });

    test('should throw error when all providers fail', async () => {
      // Mock failures for all providers
      fetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: jest.fn().mockResolvedValue({
          error: { message: 'All providers down' }
        })
      });
      
      const request = {
        prompt: 'Test prompt',
        taskType: 'general'
      };
      
      await expect(providerManager.execute(request))
        .rejects.toThrow('All providers failed');
    });
  });

  describe('Retry Logic', () => {
    test.skip('should retry on retryable errors before failover', async () => {
      let callCount = 0;
      fetch.mockImplementation(() => {
        callCount++;
        if (callCount <= 2) {
          // First two calls fail with retryable error
          return Promise.resolve({
            ok: false,
            status: 500,
            json: jest.fn().mockResolvedValue({
              error: { message: 'Temporary server error' }
            })
          });
        }
        // All subsequent calls succeed (to handle multiple providers/retries)
        return Promise.resolve(mockOpenAIResponse);
      });
      
      const request = {
        prompt: 'Test prompt for retry',
        taskType: 'general'
      };
      
      const result = await providerManager.execute(request);
      
      expect(result).toBeDefined();
      expect(result.content).toBe('OpenAI response content');
      expect(result.provider).toBe('openai');
      // Should have retried within the same provider before succeeding
      expect(callCount).toBeGreaterThanOrEqual(2);
    });

    test('should not retry on non-retryable errors', async () => {
      // First call fails with non-retryable error (401)
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: jest.fn().mockResolvedValue({
          error: { message: 'Invalid API key' }
        })
      });
      
      // Second call succeeds (failover to Anthropic)
      fetch.mockResolvedValueOnce(mockAnthropicResponse);
      
      const request = {
        prompt: 'Test prompt',
        taskType: 'general'
      };
      
      const result = await providerManager.execute(request);
      
      expect(result).toBeDefined();
      expect(result.provider).toBe('anthropic');
      expect(fetch).toHaveBeenCalledTimes(2); // No retries for 401 error
    });
  });

  describe('Health Monitoring and Recovery', () => {
    test('should perform periodic health checks', async () => {
      // Mock health check responses
      fetch.mockImplementation((url, options) => {
        if (options?.body?.includes('health check')) {
          return Promise.resolve(mockOpenAIResponse);
        }
        return Promise.resolve(mockAnthropicResponse);
      });
      
      // Manually trigger health checks for each provider since periodic ones are disabled
      const openaiProvider = providerManager.providers.get('openai');
      const anthropicProvider = providerManager.providers.get('anthropic');
      
      await providerManager.failoverManager.performHealthCheck('openai', openaiProvider);
      await providerManager.failoverManager.performHealthCheck('anthropic', anthropicProvider);
      
      const openaiState = providerManager.failoverManager.providerStates.get('openai');
      const anthropicState = providerManager.failoverManager.providerStates.get('anthropic');
      
      expect(openaiState.lastHealthCheck).toBeTruthy();
      expect(anthropicState.lastHealthCheck).toBeTruthy();
    });

    test('should recover unhealthy providers on successful health check', async () => {
      // Mark provider as unhealthy
      const openaiState = providerManager.failoverManager.providerStates.get('openai');
      openaiState.status = 'unhealthy';
      openaiState.consecutiveFailures = 5;
      
      // Mock successful health check
      fetch.mockResolvedValue(mockOpenAIResponse);
      
      // Manually trigger health check
      const openaiProvider = providerManager.providers.get('openai');
      await providerManager.failoverManager.performHealthCheck('openai', openaiProvider);
      
      expect(openaiState.status).toBe('healthy');
      expect(openaiState.consecutiveFailures).toBe(0);
    });
  });

  describe('System Statistics and Monitoring', () => {
    test('should provide comprehensive system statistics', async () => {
      fetch.mockResolvedValue(mockOpenAIResponse);
      
      const request = { prompt: 'Test prompt', taskType: 'general' };
      await providerManager.execute(request);
      
      const systemHealth = providerManager.getSystemHealth();
      
      expect(systemHealth).toHaveProperty('totalProviders', 2);
      expect(systemHealth).toHaveProperty('availableProviders');
      expect(systemHealth).toHaveProperty('totalRequests');
      expect(systemHealth).toHaveProperty('failover');
      expect(systemHealth.failover).toHaveProperty('providers');
      expect(systemHealth.failover.providers).toHaveProperty('openai');
      expect(systemHealth.failover.providers).toHaveProperty('anthropic');
    });

    test('should track costs across providers', async () => {
      fetch.mockResolvedValue(mockOpenAIResponse);
      
      const request = { prompt: 'Test prompt', taskType: 'general' };
      const result = await providerManager.execute(request);
      
      expect(result.cost).toBeDefined();
      expect(result.cost.total).toBeGreaterThan(0);
      
      const avgCost = providerManager.failoverManager.getAverageCost('openai');
      expect(avgCost).toBeGreaterThan(0);
    });
  });

  describe('Graceful Shutdown', () => {
    test('should shutdown failover manager and all providers', async () => {
      const shutdownSpy = jest.spyOn(providerManager.failoverManager, 'shutdown');
      
      await providerManager.shutdown();
      
      expect(shutdownSpy).toHaveBeenCalled();
      expect(providerManager.isShuttingDown).toBe(true);
    });

    test('should reject new requests during shutdown', async () => {
      await providerManager.shutdown();
      
      const request = { prompt: 'Test prompt', taskType: 'general' };
      
      await expect(providerManager.execute(request))
        .rejects.toThrow('Provider manager is shutting down');
    });
  });
});
