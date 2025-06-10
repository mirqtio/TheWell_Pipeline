/**
 * LLM Provider Manager
 * 
 * Central manager for all LLM providers with failover capabilities,
 * provider selection logic, and health monitoring.
 */

const { OpenAIProvider, AnthropicProvider } = require('./providers');
const FailoverManager = require('./FailoverManager');
const PromptTemplateManager = require('./PromptTemplateManager');
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
    
    // Initialize prompt template manager
    this.promptTemplateManager = new PromptTemplateManager(config.prompts || {});
    
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
    for (const [name] of this.providers) {
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
   * Initialize prompt template manager
   */
  async initializePromptTemplates() {
    try {
      await this.promptTemplateManager.initialize();
      logger.info('Prompt template system initialized');
    } catch (error) {
      logger.error('Failed to initialize prompt template system', { error: error.message });
      throw error;
    }
  }

  /**
   * Execute enrichment with versioned prompt template
   * @param {string} promptName - Name of the prompt template to use
   * @param {Object} variables - Variables to substitute in the prompt
   * @param {Object} options - Execution options
   * @returns {Promise<Object>} Enrichment result with prompt metadata
   */
  async executeWithPrompt(promptName, variables = {}, options = {}) {
    try {
      const {
        promptVersion = null,
        taskType = 'enrichment',
        ...executeOptions
      } = options;

      // Get the versioned prompt template
      const template = await this.promptTemplateManager.getTemplate(promptName, promptVersion);
      if (!template) {
        throw new Error(`Prompt template not found: ${promptName}${promptVersion ? ` (version: ${promptVersion})` : ''}`);
      }

      // Validate variables against template requirements
      const missingVars = template.variables.filter(v => !(v in variables));
      if (missingVars.length > 0) {
        throw new Error(`Missing required variables: ${missingVars.join(', ')}`);
      }

      // Substitute variables in prompt content
      const processedContent = this.substitutePromptVariables(template.template, variables);

      // Execute with failover
      const result = await this.executeWithFailover({
        taskType,
        prompt: processedContent,
        ...executeOptions
      });

      // Link template to output
      await this.promptTemplateManager.linkToOutput(template.id, template.version, {
        documentId: executeOptions.documentId,
        enrichmentType: taskType,
        provider: result.provider,
        model: result.model,
        timestamp: new Date().toISOString(),
        inputTokens: result.metadata?.inputTokens,
        outputTokens: result.metadata?.outputTokens,
        cost: result.cost?.total,
        result: result.content || result.text
      });

      // Add prompt metadata to result
      return {
        ...result,
        promptMetadata: {
          templateId: template.id,
          templateName: promptName,
          templateVersion: template.version,
          variables,
          promptHash: this.generatePromptHash(template),
          executionTimestamp: new Date().toISOString()
        }
      };
    } catch (error) {
      logger.error('Failed to execute with prompt template', {
        promptName,
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
   * Generate hash for prompt template reproducibility
   * @param {Object} template - Prompt template object
   * @returns {string} Hash string
   */
  generatePromptHash(template) {
    const crypto = require('crypto');
    const hashData = {
      id: template.id,
      name: template.name,
      version: template.version,
      template: template.template,
      variables: template.variables
    };
    return crypto.createHash('sha256').update(JSON.stringify(hashData)).digest('hex');
  }

  /**
   * Save or update a prompt template
   * @param {Object} templateData - Template content and metadata
   * @param {Object} options - Save options
   * @returns {Promise<Object>} Saved template
   */
  async savePromptTemplate(templateData, _options = {}) {
    try {
      return await this.promptTemplateManager.storeTemplate(templateData);
    } catch (error) {
      logger.error('Failed to save prompt template', { templateName: templateData.name, error: error.message });
      throw error;
    }
  }

  /**
   * Get a prompt template by name and version
   * @param {string} templateName - Template name
   * @param {string} version - Template version (default: latest)
   * @returns {Promise<Object|null>} Template object or null
   */
  async getPromptTemplate(templateName, version = null) {
    try {
      return await this.promptTemplateManager.getTemplate(templateName, version);
    } catch (error) {
      logger.error('Failed to get prompt template', { templateName, version, error: error.message });
      throw error;
    }
  }

  /**
   * Search prompt templates by criteria
   * @param {Object} criteria - Search criteria
   * @returns {Array<Object>} Array of matching templates
   */
  async searchPromptTemplates(criteria = {}) {
    try {
      return await this.promptTemplateManager.searchTemplates(criteria);
    } catch (error) {
      logger.error('Failed to search prompt templates', { criteria, error: error.message });
      throw error;
    }
  }

  /**
   * Get version history for a prompt template
   * @param {string} templateName - Template name
   * @returns {Array<Object>} Version history
   */
  async getPromptTemplateVersions(templateName) {
    try {
      return await this.promptTemplateManager.getTemplateVersions(templateName);
    } catch (error) {
      logger.error('Failed to get template versions', { templateName, error: error.message });
      throw error;
    }
  }

  /**
   * Rollback prompt template to a previous version
   * @param {string} templateName - Template name
   * @param {string} targetVersion - Target version to rollback to
   * @returns {Promise<Object>} Rollback result
   */
  async rollbackPromptTemplate(templateName, targetVersion) {
    try {
      return await this.promptTemplateManager.rollbackToVersion(templateName, targetVersion);
    } catch (error) {
      logger.error('Failed to rollback prompt template', { templateName, targetVersion, error: error.message });
      throw error;
    }
  }

  /**
   * Get outputs linked to a prompt template
   * @param {string} templateId - Template ID
   * @param {string} version - Template version
   * @returns {Array<Object>} Linked outputs
   */
  async getPromptTemplateOutputs(templateId, version) {
    try {
      return await this.promptTemplateManager.getLinkedOutputs(templateId, version);
    } catch (error) {
      logger.error('Failed to get prompt template outputs', { templateId, version, error: error.message });
      throw error;
    }
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
    
    // Shutdown prompt template manager
    await this.promptTemplateManager.cleanup();
    
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
