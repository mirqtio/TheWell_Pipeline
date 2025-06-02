/**
 * LLM Provider Manager
 * 
 * Central manager for all LLM providers with failover capabilities,
 * provider selection logic, and health monitoring.
 */

const { OpenAIProvider, AnthropicProvider } = require('./providers');
const FailoverManager = require('./FailoverManager');
const PromptVersionManager = require('./PromptVersionManager');
const logger = require('../utils/logger');

class LLMProviderManager {
  constructor(config = {}) {
    this.config = {
      healthCheckInterval: 30000, // 30 seconds
      maxConsecutiveFailures: 3,
      providerTimeout: 30000, // 30 seconds
      ...config
    };
    
    this.providers = new Map();
    this.healthCheckInterval = null;
    this.isShuttingDown = false;
    
    // Initialize prompt version manager
    this.promptVersionManager = new PromptVersionManager(config.prompts || {});
    
    // Initialize enhanced failover manager
    this.failoverManager = new FailoverManager(config.failover || {});
    
    // Set up event listeners for failover events
    this.setupFailoverEventListeners();
    
    this.initializeProviders(config);
    
    // Initialize failover manager with providers
    this.failoverManager.initialize(this.providers);
    
    this.startHealthMonitoring();
  }

  /**
   * Set up event listeners for failover manager
   */
  setupFailoverEventListeners() {
    this.failoverManager.on('execution_success', (data) => {
      logger.debug('Provider execution succeeded', data);
    });
    
    this.failoverManager.on('provider_failure', (data) => {
      logger.warn('Provider execution failed', data);
      // Update local health tracking when provider fails
      this.handleProviderFailure(data.provider, new Error(data.error));
    });
    
    this.failoverManager.on('all_providers_failed', (data) => {
      logger.error('All providers failed', data);
    });
    
    this.failoverManager.on('circuit_breaker_opened', (data) => {
      logger.error('Circuit breaker opened for provider', data);
    });
    
    this.failoverManager.on('provider_recovered', (data) => {
      logger.info('Provider recovered from failure', data);
      // Reset local health tracking when provider recovers
      const health = this.providerHealth[data.provider];
      if (health) {
        health.consecutiveFailures = 0;
        health.isAvailable = true;
        health.lastFailure = null;
      }
    });
  }

  initializeProviders(config) {
    // Initialize OpenAI provider if configured
    if (config.openai?.apiKey) {
      try {
        const provider = new OpenAIProvider(config.openai);
        this.providers.set('openai', provider);
        // Also set as property for backward compatibility with tests
        this.providers.openai = provider;
        logger.info('OpenAI provider initialized');
      } catch (error) {
        logger.error('Failed to initialize OpenAI provider', { error: error.message });
      }
    }

    // Initialize Anthropic provider if configured
    if (config.anthropic?.apiKey) {
      try {
        const provider = new AnthropicProvider(config.anthropic);
        this.providers.set('anthropic', provider);
        // Also set as property for backward compatibility with tests
        this.providers.anthropic = provider;
        logger.info('Anthropic provider initialized');
      } catch (error) {
        logger.error('Failed to initialize Anthropic provider', { error: error.message });
      }
    }

    if (this.providers.size === 0) {
      throw new Error('No LLM providers configured. Please provide API keys for at least one provider.');
    }

    // Initialize provider health tracking for backward compatibility
    this.providerHealth = {};
    for (const [name, _provider] of this.providers) {
      this.providerHealth[name] = {
        consecutiveFailures: 0,
        lastFailure: null,
        isAvailable: true
      };
    }
  }

  /**
   * Execute a completion request with automatic failover
   * @param {Object} request - Completion request
   * @returns {Promise<Object>} Completion result with metadata
   */
  async execute(request) {
    return this.executeWithFailover(request);
  }

  /**
   * Execute a completion request with automatic failover
   * @param {Object} request - Completion request
   * @returns {Promise<Object>} Completion result with metadata
   */
  async executeWithFailover(request) {
    if (this.isShuttingDown) {
      throw new Error('Provider manager is shutting down');
    }

    const { taskType = 'general', ...completionRequest } = request;
    
    logger.info('Executing completion request', {
      taskType,
      model: completionRequest.model,
      hasPrompt: !!completionRequest.prompt
    });

    try {
      const startTime = Date.now();
      
      // Use enhanced failover manager for execution
      const result = await this.failoverManager.executeWithFailover(completionRequest);
      
      const endTime = Date.now();
      
      // Enhance result with expected metadata
      const enhancedResult = {
        ...result,
        metadata: {
          ...result.metadata,
          totalDuration: endTime - startTime,
          executionTimestamp: endTime
        }
      };
      
      logger.info('Completion request executed successfully', {
        provider: result.provider,
        model: result.model,
        cost: result.cost?.total || 0,
        duration: endTime - startTime
      });
      
      return enhancedResult;
      
    } catch (error) {
      logger.error('All providers failed for completion request', {
        error: error.message,
        taskType
      });
      
      throw error;
    }
  }

  /**
   * Execute request with a specific provider
   * @param {Object} provider - Provider instance
   * @param {Object} request - Completion request
   * @returns {Promise<Object>} Completion result with metadata
   */
  async executeWithProvider(provider, request) {
    if (this.isShuttingDown) {
      throw new Error('Provider manager is shutting down');
    }

    try {
      const startTime = Date.now();
      const result = await provider.complete(request);
      const endTime = Date.now();
      
      // Add provider metadata
      const enhancedResult = {
        ...result,
        provider: provider.getName(),
        metadata: {
          ...result.metadata,
          totalDuration: endTime - startTime,
          executionTime: endTime - startTime,
          executionTimestamp: endTime,
          provider: provider.getName()
        }
      };
      
      // Record success in failover manager
      this.failoverManager.recordSuccess(
        provider.getName(),
        endTime - startTime,
        result.cost?.total || 0
      );
      
      return enhancedResult;
      
    } catch (error) {
      // Enhance error with provider context
      error.provider = provider.getName();
      error.duration = Date.now();
      error.message = `Provider error: ${error.message}`;
      
      // Record failure in failover manager
      this.failoverManager.recordFailure(provider.getName(), error);
      
      throw error;
    }
  }

  /**
   * Handle provider failure and update health tracking
   * @param {string} providerName - Name of the failed provider
   * @param {Error} error - The error that occurred
   */
  handleProviderFailure(providerName, error) {
    const health = this.providerHealth[providerName];
    if (!health) {
      logger.warn('Attempted to handle failure for unknown provider', { providerName });
      return;
    }
    
    health.consecutiveFailures++;
    health.lastFailure = new Date();
    
    // Mark provider as unavailable if too many failures
    if (health.consecutiveFailures >= this.config.maxConsecutiveFailures) {
      health.isAvailable = false;
      logger.warn('Provider marked as unavailable due to consecutive failures', {
        provider: providerName,
        consecutiveFailures: health.consecutiveFailures
      });
    }
    
    // Also record in failover manager
    this.failoverManager.recordFailure(providerName, error);
    
    logger.debug('Provider failure recorded', {
      provider: providerName,
      consecutiveFailures: health.consecutiveFailures,
      isAvailable: health.isAvailable,
      error: error.message
    });
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
   * Get list of available (healthy) providers
   * @param {Array<string>} excludeProviders - Providers to exclude
   * @returns {Array<Object>} Available provider instances
   */
  getAvailableProviders(excludeProviders = []) {
    return Array.from(this.providers.values())
      .filter(provider => {
        if (excludeProviders.includes(provider.getName())) return false;
        
        const health = this.providerHealth[provider.getName()];
        return health?.isAvailable && provider.isHealthy;
      });
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
   * Start periodic health monitoring
   */
  startHealthMonitoring() {
    // Skip health monitoring if interval is 0 (for testing)
    if (this.config.healthCheckInterval === 0) {
      logger.info('Health monitoring disabled (interval = 0)');
      return;
    }
    
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
    const healthPromises = Array.from(this.providers.entries()).map(async ([name, provider]) => {
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
   * Get system health and statistics
   * @returns {Object} Health and stats summary
   */
  getSystemHealth() {
    const providerStats = Array.from(this.providers.entries()).map(([name, provider]) => ({
      name,
      ...provider.getStats(),
      health: this.providerHealth[name]
    }));
    
    const totalRequests = providerStats.reduce((sum, p) => sum + p.requestCount, 0);
    const totalErrors = providerStats.reduce((sum, p) => sum + p.errorCount, 0);
    const availableProviders = providerStats.filter(p => p.health.isAvailable).length;

    // Get enhanced failover statistics
    const failoverStats = this.failoverManager.getFailoverStats();

    return {
      totalProviders: this.providers.size,
      availableProviders,
      totalRequests,
      totalErrors,
      errorRate: totalRequests > 0 ? (totalErrors / totalRequests) : 0,
      providers: providerStats,
      failover: failoverStats
    };
  }

  /**
   * Initialize prompt version manager
   */
  async initializePromptVersioning() {
    try {
      await this.promptVersionManager.initialize();
      logger.info('Prompt versioning system initialized');
    } catch (error) {
      logger.error('Failed to initialize prompt versioning', { error: error.message });
      throw error;
    }
  }

  /**
   * Execute enrichment with versioned prompt
   * @param {string} promptId - ID of the prompt to use
   * @param {Object} variables - Variables to substitute in the prompt
   * @param {Object} options - Execution options
   * @returns {Promise<Object>} Enrichment result with prompt metadata
   */
  async executeWithPrompt(promptId, variables = {}, options = {}) {
    try {
      const {
        promptVersion = 'latest',
        provider: _provider = null,
        taskType = 'enrichment',
        ...executeOptions
      } = options;

      // Get the versioned prompt
      const prompt = await this.promptVersionManager.getPrompt(promptId, promptVersion);
      if (!prompt) {
        throw new Error(`Prompt not found: ${promptId} (version: ${promptVersion})`);
      }

      // Substitute variables in prompt content
      const processedContent = this.substitutePromptVariables(prompt.content, variables);

      // Execute with failover
      const result = await this.executeWithFailover({
        taskType,
        prompt: processedContent,
        ...executeOptions
      });

      // Add prompt metadata to result
      return {
        ...result,
        promptMetadata: {
          promptId,
          promptVersion: prompt.version,
          variables,
          promptHash: this.generatePromptHash(prompt),
          executionTimestamp: new Date().toISOString()
        }
      };
    } catch (error) {
      logger.error('Failed to execute with prompt', {
        promptId,
        promptVersion: options.promptVersion,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Substitute variables in prompt content
   * @param {string} content - Prompt content with variables
   * @param {Object} variables - Variables to substitute
   * @returns {string} Processed content
   */
  substitutePromptVariables(content, variables) {
    let processedContent = content;
    
    for (const [key, value] of Object.entries(variables)) {
      const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
      processedContent = processedContent.replace(regex, String(value));
    }

    // Check for unsubstituted variables
    const unsubstituted = processedContent.match(/\{\{\w+\}\}/g);
    if (unsubstituted) {
      logger.warn('Unsubstituted variables found in prompt', { 
        variables: unsubstituted,
        promptContent: processedContent.substring(0, 100) + '...'
      });
    }

    return processedContent;
  }

  /**
   * Generate hash for prompt reproducibility
   * @param {Object} prompt - Prompt object
   * @returns {string} Hash string
   */
  generatePromptHash(prompt) {
    const crypto = require('crypto');
    const hashData = {
      id: prompt.id,
      version: prompt.version,
      content: prompt.content
    };
    return crypto.createHash('sha256').update(JSON.stringify(hashData)).digest('hex');
  }

  /**
   * Save or update a prompt
   * @param {string} promptId - Prompt identifier
   * @param {Object} promptData - Prompt content and metadata
   * @param {Object} options - Save options
   * @returns {Promise<Object>} Saved prompt
   */
  async savePrompt(promptId, promptData, options = {}) {
    try {
      return await this.promptVersionManager.savePrompt(promptId, promptData, options);
    } catch (error) {
      logger.error('Failed to save prompt', { promptId, error: error.message });
      throw error;
    }
  }

  /**
   * Get a prompt by ID and version
   * @param {string} promptId - Prompt identifier
   * @param {string} version - Prompt version (default: 'latest')
   * @returns {Promise<Object|null>} Prompt object or null
   */
  async getPrompt(promptId, version = 'latest') {
    try {
      return await this.promptVersionManager.getPrompt(promptId, version);
    } catch (error) {
      logger.error('Failed to get prompt', { promptId, version, error: error.message });
      throw error;
    }
  }

  /**
   * List all available prompts
   * @returns {Array<string>} Array of prompt IDs
   */
  listPrompts() {
    return this.promptVersionManager.listPrompts();
  }

  /**
   * Get version history for a prompt
   * @param {string} promptId - Prompt identifier
   * @returns {Array<Object>} Version history
   */
  getPromptVersionHistory(promptId) {
    return this.promptVersionManager.getVersionHistory(promptId);
  }

  /**
   * Rollback prompt to a previous version
   * @param {string} promptId - Prompt identifier
   * @param {string} targetVersion - Target version to rollback to
   * @returns {Promise<Object>} Rollback result
   */
  async rollbackPrompt(promptId, targetVersion) {
    try {
      return await this.promptVersionManager.rollbackPrompt(promptId, targetVersion);
    } catch (error) {
      logger.error('Failed to rollback prompt', { promptId, targetVersion, error: error.message });
      throw error;
    }
  }

  /**
   * Get prompt versioning statistics
   * @returns {Object} Statistics
   */
  getPromptStatistics() {
    return this.promptVersionManager.getStatistics();
  }

  /**
   * Gracefully shutdown the provider manager
   */
  async shutdown() {
    this.isShuttingDown = true;
    
    logger.info('Shutting down LLM Provider Manager');
    
    // Stop health monitoring
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    
    // Shutdown failover manager
    await this.failoverManager.shutdown();
    
    // Shutdown prompt version manager
    await this.promptVersionManager.shutdown();
    
    // Shutdown all providers
    const shutdownPromises = Array.from(this.providers.values()).map(async (provider) => {
      try {
        if (typeof provider.shutdown === 'function') {
          await provider.shutdown();
        }
      } catch (error) {
        logger.error('Error shutting down provider', {
          provider: provider.getName(),
          error: error.message
        });
      }
    });
    
    await Promise.all(shutdownPromises);
    
    logger.info('LLM Provider Manager shutdown complete');
  }
}

module.exports = LLMProviderManager;
