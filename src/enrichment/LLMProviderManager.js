/**
 * LLM Provider Manager
 * 
 * Central manager for all LLM providers with failover capabilities,
 * provider selection logic, and health monitoring.
 */

const OpenAIProvider = require('./providers/OpenAIProvider');
const AnthropicProvider = require('./providers/AnthropicProvider');
const logger = require('../utils/logger');

class LLMProviderManager {
  constructor(config = {}) {
    this.providers = {};
    this.providerHealth = {};
    this.config = {
      healthCheckInterval: 300000, // 5 minutes
      failoverThreshold: 3, // Number of consecutive failures before failover
      ...config
    };
    
    this.initializeProviders(config);
    this.startHealthMonitoring();
  }

  initializeProviders(config) {
    // Initialize OpenAI provider if configured
    if (config.openai?.apiKey) {
      try {
        this.providers.openai = new OpenAIProvider(config.openai);
        this.providerHealth.openai = {
          consecutiveFailures: 0,
          lastFailure: null,
          isAvailable: true
        };
        logger.info('OpenAI provider initialized');
      } catch (error) {
        logger.error('Failed to initialize OpenAI provider', { error: error.message });
      }
    }

    // Initialize Anthropic provider if configured
    if (config.anthropic?.apiKey) {
      try {
        this.providers.anthropic = new AnthropicProvider(config.anthropic);
        this.providerHealth.anthropic = {
          consecutiveFailures: 0,
          lastFailure: null,
          isAvailable: true
        };
        logger.info('Anthropic provider initialized');
      } catch (error) {
        logger.error('Failed to initialize Anthropic provider', { error: error.message });
      }
    }

    if (Object.keys(this.providers).length === 0) {
      throw new Error('No LLM providers configured. Please provide API keys for at least one provider.');
    }
  }

  /**
   * Get the best available provider for a given task
   * @param {string} taskType - Type of task (e.g., 'summarization', 'extraction')
   * @param {number} documentSize - Size of document in characters
   * @param {Array<string>} excludeProviders - Providers to exclude from selection
   * @returns {Object} Selected provider
   */
  async getProvider(taskType = 'general', documentSize = 0, excludeProviders = []) {
    const availableProviders = this.getAvailableProviders(excludeProviders);
    
    if (availableProviders.length === 0) {
      throw new Error('No available providers for task execution');
    }

    // Provider selection strategy based on task type and document size
    const selectedProvider = this.selectProviderByStrategy(
      availableProviders,
      taskType,
      documentSize
    );

    logger.info('Provider selected for task', {
      provider: selectedProvider.getName(),
      taskType,
      documentSize,
      availableProviders: availableProviders.map(p => p.getName())
    });

    return selectedProvider;
  }

  /**
   * Execute a completion with automatic failover
   * @param {Object} request - Completion request
   * @param {string} taskType - Type of task
   * @returns {Promise<Object>} Completion result
   */
  async executeWithFailover(request, taskType = 'general') {
    const excludeProviders = [];
    let lastError;

    while (excludeProviders.length < Object.keys(this.providers).length) {
      try {
        const provider = await this.getProvider(
          taskType,
          request.prompt?.length || 0,
          excludeProviders
        );

        const result = await this.executeWithProvider(provider, request);
        
        // Reset failure count on success
        this.providerHealth[provider.getName()].consecutiveFailures = 0;
        
        return result;

      } catch (error) {
        lastError = error;
        
        // Find which provider failed and update health
        const failedProvider = this.findProviderFromError(error, excludeProviders);
        if (failedProvider) {
          this.handleProviderFailure(failedProvider, error);
          excludeProviders.push(failedProvider);
        }

        logger.warn('Provider execution failed, attempting failover', {
          error: error.message,
          failedProvider,
          excludeProviders,
          taskType
        });
      }
    }

    // All providers failed
    logger.error('All providers failed for task execution', {
      error: lastError?.message,
      taskType,
      totalProviders: Object.keys(this.providers).length
    });

    throw new Error(`All providers failed. Last error: ${lastError?.message}`);
  }

  /**
   * Execute completion with a specific provider
   * @param {Object} provider - Provider instance
   * @param {Object} request - Completion request
   * @returns {Promise<Object>} Completion result with metadata
   */
  async executeWithProvider(provider, request) {
    const startTime = Date.now();
    
    try {
      const result = await provider.complete(request);
      const totalDuration = Date.now() - startTime;
      
      // Add execution metadata
      result.metadata = {
        ...result.metadata,
        totalDuration,
        executionTimestamp: new Date().toISOString()
      };

      logger.info('Provider execution successful', {
        provider: provider.getName(),
        model: result.model,
        totalDuration,
        cost: result.cost.total
      });

      return result;

    } catch (error) {
      const totalDuration = Date.now() - startTime;
      
      logger.error('Provider execution failed', {
        provider: provider.getName(),
        error: error.message,
        totalDuration
      });

      // Enhance error with provider context
      error.provider = provider.getName();
      error.duration = totalDuration;
      throw error;
    }
  }

  /**
   * Get list of available (healthy) providers
   * @param {Array<string>} excludeProviders - Providers to exclude
   * @returns {Array<Object>} Available provider instances
   */
  getAvailableProviders(excludeProviders = []) {
    return Object.entries(this.providers)
      .filter(([name, provider]) => {
        if (excludeProviders.includes(name)) return false;
        
        const health = this.providerHealth[name];
        return health?.isAvailable && provider.isHealthy;
      })
      .map(([name, provider]) => provider);
  }

  /**
   * Select provider based on task requirements
   * @param {Array<Object>} providers - Available providers
   * @param {string} taskType - Task type
   * @param {number} documentSize - Document size
   * @returns {Object} Selected provider
   */
  selectProviderByStrategy(providers, taskType, documentSize) {
    // Strategy 1: For large documents, prefer providers with higher token limits
    if (documentSize > 50000) {
      const preferredOrder = ['anthropic', 'openai'];
      for (const providerName of preferredOrder) {
        const provider = providers.find(p => p.getName() === providerName);
        if (provider) return provider;
      }
    }

    // Strategy 2: For cost-sensitive tasks, prefer cheaper providers
    if (taskType === 'bulk_processing') {
      const preferredOrder = ['anthropic', 'openai']; // Anthropic Haiku is cheaper
      for (const providerName of preferredOrder) {
        const provider = providers.find(p => p.getName() === providerName);
        if (provider) return provider;
      }
    }

    // Strategy 3: For high-quality tasks, prefer premium models
    if (taskType === 'critical_analysis') {
      const preferredOrder = ['openai', 'anthropic']; // GPT-4 for critical tasks
      for (const providerName of preferredOrder) {
        const provider = providers.find(p => p.getName() === providerName);
        if (provider) return provider;
      }
    }

    // Default: Return provider with lowest error rate
    return providers.reduce((best, current) => {
      const bestHealth = this.providerHealth[best.getName()];
      const currentHealth = this.providerHealth[current.getName()];
      
      return currentHealth.consecutiveFailures < bestHealth.consecutiveFailures 
        ? current 
        : best;
    });
  }

  /**
   * Handle provider failure and update health status
   * @param {string} providerName - Name of failed provider
   * @param {Error} error - Error that occurred
   */
  handleProviderFailure(providerName, error) {
    const health = this.providerHealth[providerName];
    if (!health) return;

    health.consecutiveFailures++;
    health.lastFailure = new Date();

    // Mark provider as unavailable if it exceeds failure threshold
    if (health.consecutiveFailures >= this.config.failoverThreshold) {
      health.isAvailable = false;
      logger.warn('Provider marked as unavailable due to consecutive failures', {
        provider: providerName,
        consecutiveFailures: health.consecutiveFailures,
        threshold: this.config.failoverThreshold
      });
    }
  }

  /**
   * Find which provider failed based on error context
   * @param {Error} error - Error object
   * @param {Array<string>} excludeProviders - Already excluded providers
   * @returns {string|null} Provider name
   */
  findProviderFromError(error, excludeProviders) {
    if (error.provider) {
      return error.provider;
    }

    // Try to infer from available providers
    const availableProviders = Object.keys(this.providers)
      .filter(name => !excludeProviders.includes(name));
    
    return availableProviders[0] || null;
  }

  /**
   * Start periodic health monitoring
   */
  startHealthMonitoring() {
    this.healthCheckInterval = setInterval(async () => {
      await this.performHealthChecks();
    }, this.config.healthCheckInterval);

    logger.info('Health monitoring started', {
      interval: this.config.healthCheckInterval
    });
  }

  /**
   * Perform health checks on all providers
   */
  async performHealthChecks() {
    const healthPromises = Object.entries(this.providers).map(async ([name, provider]) => {
      try {
        const health = await provider.healthCheck();
        
        if (health.healthy) {
          // Reset availability if provider is healthy again
          this.providerHealth[name].isAvailable = true;
          this.providerHealth[name].consecutiveFailures = 0;
        }

        return { name, health };
      } catch (error) {
        logger.error('Health check failed', { provider: name, error: error.message });
        return { name, health: { healthy: false, error: error.message } };
      }
    });

    const results = await Promise.allSettled(healthPromises);
    
    logger.debug('Health check completed', {
      results: results.map(r => r.status === 'fulfilled' ? r.value : { error: r.reason })
    });
  }

  /**
   * Get overall system health and statistics
   * @returns {Object} Health and stats summary
   */
  getSystemHealth() {
    const providerStats = Object.entries(this.providers).map(([name, provider]) => ({
      name,
      ...provider.getStats(),
      health: this.providerHealth[name]
    }));

    const totalRequests = providerStats.reduce((sum, p) => sum + p.requestCount, 0);
    const totalErrors = providerStats.reduce((sum, p) => sum + p.errorCount, 0);
    const availableProviders = providerStats.filter(p => p.health.isAvailable).length;

    return {
      totalProviders: Object.keys(this.providers).length,
      availableProviders,
      totalRequests,
      totalErrors,
      errorRate: totalRequests > 0 ? (totalErrors / totalRequests) : 0,
      providers: providerStats
    };
  }

  /**
   * Shutdown the provider manager
   */
  shutdown() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    logger.info('LLM Provider Manager shutdown completed');
  }
}

module.exports = LLMProviderManager;
