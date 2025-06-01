/**
 * Base Provider Interface
 * 
 * Abstract base class that defines the standard interface for all LLM providers.
 * This ensures consistent behavior across different provider implementations.
 */

class BaseProvider {
  constructor(config = {}) {
    if (this.constructor === BaseProvider) {
      throw new Error('BaseProvider is abstract and cannot be instantiated directly');
    }
    
    this.config = {
      maxRetries: 3,
      timeout: 30000,
      ...config
    };
    
    this.isHealthy = true;
    this.lastHealthCheck = null;
    this.errorCount = 0;
    this.requestCount = 0;
  }

  /**
   * Get provider name
   * @returns {string} Provider name
   */
  getName() {
    throw new Error('getName() must be implemented by subclass');
  }

  /**
   * Get supported models for this provider
   * @returns {Array<string>} List of supported model names
   */
  getSupportedModels() {
    throw new Error('getSupportedModels() must be implemented by subclass');
  }

  /**
   * Execute a completion request
   * @param {Object} _request - The completion request
   * @param {string} _request.model - Model to use
   * @param {string} _request.prompt - Input prompt
   * @param {Object} _request.options - Additional options
   * @returns {Promise<Object>} Completion response
   */
  async complete(_request) {
    throw new Error('complete() must be implemented by subclass');
  }

  /**
   * Calculate cost for a request
   * @param {string} _model - Model used
   * @param {number} _inputTokens - Number of input tokens
   * @param {number} _outputTokens - Number of output tokens
   * @returns {Object} Cost breakdown
   */
  calculateCost(_model, _inputTokens, _outputTokens) {
    throw new Error('calculateCost() must be implemented by subclass');
  }

  /**
   * Check provider health
   * @returns {Promise<boolean>} Health status
   */
  async healthCheck() {
    try {
      const startTime = Date.now();
      
      // Simple test request
      const testRequest = {
        model: this.getSupportedModels()[0],
        prompt: 'Hello',
        options: { maxTokens: 5 }
      };
      
      await this.complete(testRequest);
      
      const responseTime = Date.now() - startTime;
      this.isHealthy = true;
      this.lastHealthCheck = new Date();
      
      return {
        healthy: true,
        responseTime,
        timestamp: this.lastHealthCheck
      };
    } catch (error) {
      this.isHealthy = false;
      this.lastHealthCheck = new Date();
      this.errorCount++;
      
      return {
        healthy: false,
        error: error.message,
        timestamp: this.lastHealthCheck
      };
    }
  }

  /**
   * Get provider statistics
   * @returns {Object} Provider stats
   */
  getStats() {
    return {
      name: this.getName(),
      isHealthy: this.isHealthy,
      lastHealthCheck: this.lastHealthCheck,
      errorCount: this.errorCount,
      requestCount: this.requestCount,
      supportedModels: this.getSupportedModels()
    };
  }

  /**
   * Reset error count (useful for recovery scenarios)
   */
  resetErrorCount() {
    this.errorCount = 0;
  }

  /**
   * Increment request counter
   */
  incrementRequestCount() {
    this.requestCount++;
  }

  /**
   * Increment error counter
   */
  incrementErrorCount() {
    this.errorCount++;
  }
}

module.exports = BaseProvider;
