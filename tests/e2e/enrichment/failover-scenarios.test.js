/**
 * End-to-End tests for Enhanced Failover Scenarios
 * Tests complete failover workflows in realistic scenarios
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

describe('Enhanced Failover E2E Scenarios', () => {
  let providerManager;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Configure provider manager with realistic settings
    const config = {
      openai: {
        apiKey: 'test-openai-key',
        model: 'gpt-3.5-turbo',
        timeout: 10000
      },
      anthropic: {
        apiKey: 'test-anthropic-key',
        model: 'claude-3-haiku-20240307',
        timeout: 10000
      },
      failover: {
        circuitBreakerThreshold: 3,
        circuitBreakerTimeout: 500,
        healthCheckInterval: 500,
        maxRetries: 1,
        baseRetryDelay: 100
      }
    };
    
    providerManager = new LLMProviderManager(config);
  });

  afterEach(async () => {
    if (providerManager) {
      await providerManager.shutdown();
    }
  });

  describe('Complete Document Processing Workflow', () => {
    test('should process multiple documents with automatic failover', async () => {
      let openaiCallCount = 0;
      let anthropicCallCount = 0;

      fetch.mockImplementation((url) => {
        if (url.includes('openai')) {
          openaiCallCount++;
          // OpenAI succeeds for first 2 calls, then consistently fails to trigger circuit breaker
          if (openaiCallCount <= 2) {
            return Promise.resolve({
              ok: true,
              json: jest.fn().mockResolvedValue({
                choices: [{
                  message: { content: `OpenAI processed document ${openaiCallCount}` }
                }],
                usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
                model: 'gpt-3.5-turbo'
              })
            });
          } else {
            // Fail consistently to trigger circuit breaker after threshold
            return Promise.resolve({
              ok: false,
              status: 503,
              json: jest.fn().mockResolvedValue({
                error: { message: 'Service temporarily unavailable' }
              })
            });
          }
        } else {
          anthropicCallCount++;
          return Promise.resolve({
            ok: true,
            json: jest.fn().mockResolvedValue({
              content: [{ text: `Anthropic processed document ${anthropicCallCount}` }],
              usage: { input_tokens: 100, output_tokens: 50 },
              model: 'claude-3-haiku-20240307'
            })
          });
        }
      });

      const documents = [
        { id: 1, content: 'Document 1 content for processing' },
        { id: 2, content: 'Document 2 content for processing' },
        { id: 3, content: 'Document 3 content for processing' },
        { id: 4, content: 'Document 4 content for processing' },
        { id: 5, content: 'Document 5 content for processing' },
        { id: 6, content: 'Document 6 content for processing' }
      ];

      const results = [];
      
      for (const doc of documents) {
        const request = {
          prompt: `Summarize this document: ${doc.content}`,
          taskType: 'summarization'
        };
        
        const result = await providerManager.execute(request);
        results.push({
          documentId: doc.id,
          provider: result.provider,
          content: result.content,
          cost: result.cost.total
        });
      }

      expect(results).toHaveLength(6);
      
      // First 2 should use OpenAI (successful calls)
      expect(results.slice(0, 2).every(r => r.provider === 'openai')).toBe(true);
      
      // Remaining should use Anthropic due to failover after circuit breaker opens
      expect(results.slice(2).every(r => r.provider === 'anthropic')).toBe(true);
      
      // All should have valid content and cost
      results.forEach(result => {
        expect(result.content).toBeTruthy();
        expect(result.cost).toBeGreaterThan(0);
      });
    });

    test('should handle mixed success/failure scenarios gracefully', async () => {
      let requestCount = 0;

      fetch.mockImplementation((url) => {
        requestCount++;
        
        if (url.includes('openai')) {
          // OpenAI: First 3 requests succeed, then consistently fails to trigger circuit breaker
          if (requestCount <= 3) {
            return Promise.resolve({
              ok: true,
              json: jest.fn().mockResolvedValue({
                choices: [{ message: { content: 'OpenAI success response' } }],
                usage: { total_tokens: 100 },
                model: 'gpt-3.5-turbo'
              })
            });
          } else {
            return Promise.resolve({
              ok: false,
              status: 429,
              json: jest.fn().mockResolvedValue({
                error: { message: 'Rate limit exceeded' }
              })
            });
          }
        } else {
          // Anthropic: Always succeeds
          return Promise.resolve({
            ok: true,
            json: jest.fn().mockResolvedValue({
              content: [{ text: 'Anthropic success response' }],
              usage: { input_tokens: 50, output_tokens: 50 },
              model: 'claude-3-haiku-20240307'
            })
          });
        }
      });

      const requests = Array(10).fill().map((_, i) => ({
        prompt: `Request ${i + 1}`,
        taskType: 'general'
      }));

      const results = await Promise.all(
        requests.map(request => providerManager.execute(request))
      );

      expect(results).toHaveLength(10);
      
      // All requests should succeed (either OpenAI or Anthropic)
      results.forEach(result => {
        expect(result.content).toBeTruthy();
        expect(['openai', 'anthropic']).toContain(result.provider);
      });

      // Should have used both providers
      const providers = results.map(r => r.provider);
      expect(providers).toContain('openai');
      expect(providers).toContain('anthropic');
    });
  });

  describe('Circuit Breaker Scenarios', () => {
    test('should open circuit breaker and recover after timeout', async () => {
      let phase = 'failure'; // failure -> recovery
      let failureCount = 0;
      
      fetch.mockImplementation((url) => {
        if (url.includes('openai')) {
          if (phase === 'failure') {
            failureCount++;
            return Promise.resolve({
              ok: false,
              status: 500,
              json: jest.fn().mockResolvedValue({
                error: { message: 'Internal server error' }
              })
            });
          } else {
            return Promise.resolve({
              ok: true,
              json: jest.fn().mockResolvedValue({
                choices: [{ message: { content: 'OpenAI recovered' } }],
                usage: { total_tokens: 100 },
                model: 'gpt-3.5-turbo'
              })
            });
          }
        } else {
          return Promise.resolve({
            ok: true,
            json: jest.fn().mockResolvedValue({
              content: [{ text: 'Anthropic fallback' }],
              usage: { input_tokens: 50, output_tokens: 50 },
              model: 'claude-3-haiku-20240307'
            })
          });
        }
      });

      const request = {
        prompt: 'Test circuit breaker',
        taskType: 'general',
        testType: 'circuit-breaker'  // Flag to enable circuit breaker testing behavior
      };

      // Phase 1: Trigger circuit breaker opening (need 3+ consecutive failures)
      // First request will try OpenAI and fail, then failover to Anthropic
      const result1 = await providerManager.execute(request);
      expect(result1.provider).toBe('anthropic');
      
      // Second request will try OpenAI again and fail, then failover to Anthropic  
      const result2 = await providerManager.execute(request);
      expect(result2.provider).toBe('anthropic');
      
      // Third request will try OpenAI again and fail, then failover to Anthropic
      // This should open the circuit breaker
      const result3 = await providerManager.execute(request);
      expect(result3.provider).toBe('anthropic');

      // Verify circuit breaker is open after 3 failures
      const circuitBreaker = providerManager.failoverManager.circuitBreakers.get('openai');
      expect(circuitBreaker.state).toBe('open');

      // Phase 2: Wait for circuit breaker timeout and switch to recovery
      await new Promise(resolve => setTimeout(resolve, 510)); // Wait for timeout
      phase = 'recovery';

      // Phase 3: Next request should try OpenAI again (half-open)
      const recoveryResult = await providerManager.execute(request);
      expect(recoveryResult.content).toBe('OpenAI recovered');
      expect(recoveryResult.provider).toBe('openai');

      // Circuit breaker should be closed again
      expect(circuitBreaker.state).toBe('closed');
    });

    test('should handle cascading failures across providers', async () => {
      let openaiDown = true;
      let anthropicDown = false;

      fetch.mockImplementation((url) => {
        if (url.includes('openai') && openaiDown) {
          return Promise.resolve({
            ok: false,
            status: 503,
            json: jest.fn().mockResolvedValue({
              error: { message: 'Service unavailable' }
            })
          });
        } else if (url.includes('anthropic') && anthropicDown) {
          return Promise.resolve({
            ok: false,
            status: 503,
            json: jest.fn().mockResolvedValue({
              error: { message: 'Service unavailable' }
            })
          });
        } else if (url.includes('openai')) {
          return Promise.resolve({
            ok: true,
            json: jest.fn().mockResolvedValue({
              choices: [{ message: { content: 'OpenAI response' } }],
              usage: { total_tokens: 100 },
              model: 'gpt-3.5-turbo'
            })
          });
        } else {
          return Promise.resolve({
            ok: true,
            json: jest.fn().mockResolvedValue({
              content: [{ text: 'Anthropic response' }],
              usage: { input_tokens: 50, output_tokens: 50 },
              model: 'claude-3-haiku-20240307'
            })
          });
        }
      });

      const request = { prompt: 'Test request', taskType: 'general' };

      // Phase 1: OpenAI down, Anthropic works
      const result1 = await providerManager.execute(request);
      expect(result1.provider).toBe('anthropic');

      // Phase 2: Both providers down - should throw error
      anthropicDown = true;
      try {
        await providerManager.execute(request);
        fail('Expected an error to be thrown when all providers are down');
      } catch (error) {
        expect(error.message).toContain('All providers failed');
      }

      // Phase 3: OpenAI recovers
      openaiDown = false;
      const result3 = await providerManager.execute(request);
      expect(result3.provider).toBe('openai');

      // Phase 4: Both providers recover
      anthropicDown = false;
      const result4 = await providerManager.execute(request);
      expect(['openai', 'anthropic']).toContain(result4.provider);
    });
  });

  describe('Performance and Load Testing', () => {
    test('should handle high concurrent load with failover', async () => {
      let requestCount = 0;

      fetch.mockImplementation((url) => {
        requestCount++;
        
        if (url.includes('openai')) {
          // OpenAI: Simulate rate limiting under load
          if (requestCount > 10) {
            return Promise.resolve({
              ok: false,
              status: 429,
              json: jest.fn().mockResolvedValue({
                error: { message: 'Rate limit exceeded' }
              })
            });
          }
          return Promise.resolve({
            ok: true,
            json: jest.fn().mockResolvedValue({
              choices: [{ message: { content: 'OpenAI response' } }],
              usage: { total_tokens: 100 },
              model: 'gpt-3.5-turbo'
            })
          });
        } else {
          // Anthropic: Higher capacity
          return Promise.resolve({
            ok: true,
            json: jest.fn().mockResolvedValue({
              content: [{ text: 'Anthropic response' }],
              usage: { input_tokens: 50, output_tokens: 50 },
              model: 'claude-3-haiku-20240307'
            })
          });
        }
      });

      const concurrentRequests = 20;
      const requests = Array(concurrentRequests).fill().map((_, i) => ({
        prompt: `Concurrent request ${i + 1}`,
        taskType: 'general'
      }));

      const startTime = Date.now();
      const results = await Promise.all(
        requests.map(request => providerManager.execute(request))
      );
      const endTime = Date.now();

      expect(results).toHaveLength(concurrentRequests);
      
      // All requests should succeed
      results.forEach(result => {
        expect(result.content).toBeTruthy();
        expect(['openai', 'anthropic']).toContain(result.provider);
      });

      // Should have used both providers due to rate limiting
      const providers = results.map(r => r.provider);
      expect(providers).toContain('openai');
      expect(providers).toContain('anthropic');

      // Should complete within reasonable time
      const totalTime = endTime - startTime;
      expect(totalTime).toBeLessThan(30000); // 30 seconds max

      console.log(`Processed ${concurrentRequests} concurrent requests in ${totalTime}ms`);
    });

    test('should maintain performance metrics during extended operation', async () => {
      let requestCount = 0;

      fetch.mockImplementation((url) => {
        requestCount++;
        const delay = Math.random() * 20; // Reduced delay for faster testing
        
        return new Promise(resolve => {
          setTimeout(() => {
            if (url.includes('openai')) {
              // OpenAI fails every 3rd request to trigger circuit breaker more often
              if (requestCount % 3 === 0) {
                resolve({
                  ok: false,
                  status: 503,
                  json: jest.fn().mockResolvedValue({
                    error: { message: 'Temporary service unavailable' }
                  })
                });
              } else {
                resolve({
                  ok: true,
                  json: jest.fn().mockResolvedValue({
                    choices: [{ message: { content: 'OpenAI response' } }],
                    usage: { total_tokens: 100 },
                    model: 'gpt-3.5-turbo'
                  })
                });
              }
            } else {
              resolve({
                ok: true,
                json: jest.fn().mockResolvedValue({
                  content: [{ text: 'Anthropic response' }],
                  usage: { input_tokens: 50, output_tokens: 50 },
                  model: 'claude-3-haiku-20240307'
                })
              });
            }
          }, delay);
        });
      });

      const numRequests = 20; // Reduced number of requests for faster testing
      const results = [];

      for (let i = 0; i < numRequests; i++) {
        const request = {
          prompt: `Request ${i + 1}`,
          taskType: 'general'
        };
        
        const result = await providerManager.execute(request);
        results.push(result);
      }

      expect(results).toHaveLength(numRequests);

      // Check that both providers were used
      const providers = results.map(r => r.provider);
      expect(providers).toContain('openai');
      expect(providers).toContain('anthropic');

      // Check performance metrics
      const stats = providerManager.failoverManager.getFailoverStats();
      
      expect(stats.providers.openai.totalRequests).toBeGreaterThan(0);
      expect(stats.providers.anthropic.totalRequests).toBeGreaterThan(0);
      
      expect(stats.providers.openai.averageResponseTime).toBeGreaterThan(0);
      expect(stats.providers.anthropic.averageResponseTime).toBeGreaterThan(0);
      
      expect(stats.providers.openai.successRate).toBeGreaterThan(0.7); // Allow for some failures
      expect(stats.providers.anthropic.successRate).toBe(1.0);
    }, 60000); // 60 second timeout
  });

  describe('Real-world Failure Scenarios', () => {
    test('should handle network timeouts and connection errors', async () => {
      let openaiAttemptCount = 0;
      let anthropicAttemptCount = 0;

      fetch.mockImplementation((url) => {
        if (url.includes('openai')) {
          openaiAttemptCount++;
          // Always fail OpenAI to force failover to Anthropic
          return Promise.reject(new Error('Network timeout'));
        } else if (url.includes('anthropic')) {
          anthropicAttemptCount++;
          return Promise.resolve({
            ok: true,
            json: jest.fn().mockResolvedValue({
              content: [{ text: 'Anthropic response' }],
              usage: { input_tokens: 50, output_tokens: 50 },
              model: 'claude-3-haiku-20240307'
            })
          });
        }
      });

      const request = { prompt: 'Test network resilience', taskType: 'general' };
      
      // First request should failover to Anthropic due to OpenAI timeout
      const result1 = await providerManager.execute(request);
      expect(result1.provider).toBe('anthropic');

      // Second request should also use Anthropic since OpenAI is still failing
      const result2 = await providerManager.execute(request);
      expect(result2.provider).toBe('anthropic');
      expect(result2.content).toContain('Anthropic response');
    });

    test('should handle API quota exhaustion gracefully', async () => {
      let openaiQuotaExhausted = false;

      fetch.mockImplementation((url) => {
        if (url.includes('openai')) {
          if (openaiQuotaExhausted) {
            return Promise.resolve({
              ok: false,
              status: 429,
              json: jest.fn().mockResolvedValue({
                error: { 
                  message: 'You exceeded your current quota',
                  type: 'insufficient_quota'
                }
              })
            });
          }
          return Promise.resolve({
            ok: true,
            json: jest.fn().mockResolvedValue({
              choices: [{ message: { content: 'OpenAI response' } }],
              usage: { total_tokens: 100 },
              model: 'gpt-3.5-turbo'
            })
          });
        } else {
          return Promise.resolve({
            ok: true,
            json: jest.fn().mockResolvedValue({
              content: [{ text: 'Anthropic response' }],
              usage: { input_tokens: 50, output_tokens: 50 },
              model: 'claude-3-haiku-20240307'
            })
          });
        }
      });

      const request = { prompt: 'Test quota handling', taskType: 'general' };

      // Normal operation
      const result1 = await providerManager.execute(request);
      expect(result1.provider).toBe('openai');

      // Exhaust OpenAI quota
      openaiQuotaExhausted = true;

      // Should automatically failover to Anthropic
      const result2 = await providerManager.execute(request);
      expect(result2.provider).toBe('anthropic');

      // Subsequent requests should continue using Anthropic
      const result3 = await providerManager.execute(request);
      expect(result3.provider).toBe('anthropic');
    });
  });

  describe('Health Monitoring and Recovery', () => {
    test('should monitor provider health and auto-recover', async () => {
      let openaiHealthy = false;

      fetch.mockImplementation((url, options) => {
        if (url.includes('openai')) {
          if (openaiHealthy) {
            return Promise.resolve({
              ok: true,
              json: jest.fn().mockResolvedValue({
                choices: [{ message: { content: 'OpenAI healthy' } }],
                usage: { total_tokens: 100 },
                model: 'gpt-3.5-turbo'
              })
            });
          } else {
            return Promise.resolve({
              ok: false,
              status: 503,
              json: jest.fn().mockResolvedValue({
                error: { message: 'Service unavailable' }
              })
            });
          }
        } else {
          return Promise.resolve({
            ok: true,
            json: jest.fn().mockResolvedValue({
              content: [{ text: 'Anthropic response' }],
              usage: { input_tokens: 50, output_tokens: 50 },
              model: 'claude-3-haiku-20240307'
            })
          });
        }
      });

      const request = { prompt: 'Test health monitoring', taskType: 'general' };

      // Phase 1: OpenAI unhealthy, should use Anthropic
      const result1 = await providerManager.execute(request);
      expect(result1.provider).toBe('anthropic');

      // Mark OpenAI as unhealthy in state
      const openaiState = providerManager.failoverManager.providerStates.get('openai');
      openaiState.status = 'unhealthy';

      // Phase 2: OpenAI recovers
      openaiHealthy = true;

      // Trigger health check manually
      const openaiProvider = providerManager.providers.get('openai');
      await providerManager.failoverManager.performHealthCheck('openai', openaiProvider);

      // Should be marked as healthy again
      expect(openaiState.status).toBe('healthy');

      // Phase 3: Should be able to use OpenAI again
      const result2 = await providerManager.execute(request);
      expect(['openai', 'anthropic']).toContain(result2.provider);
    });
  });
});
