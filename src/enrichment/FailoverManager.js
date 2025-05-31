/**
 * Advanced Failover Manager for LLM Provider Management
 * Provides sophisticated failover logic with circuit breakers, health monitoring, and adaptive retry strategies
 */

const EventEmitter = require('events');
const logger = require('../utils/logger');

class FailoverManager extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      // Circuit breaker configuration
      circuitBreakerThreshold: config.circuitBreakerThreshold || 5, // failures before opening circuit
      circuitBreakerTimeout: config.circuitBreakerTimeout || 30000, // 30 seconds
      circuitBreakerResetTimeout: config.circuitBreakerResetTimeout || 60000, // 1 minute
      
      // Health check configuration
      healthCheckInterval: config.healthCheckInterval !== undefined ? config.healthCheckInterval : 30000, // 30 seconds
      healthCheckTimeout: config.healthCheckTimeout || 5000, // 5 seconds
      
      // Retry configuration
      maxRetries: config.maxRetries || 3,
      baseRetryDelay: config.baseRetryDelay || 1000, // 1 second
      maxRetryDelay: config.maxRetryDelay || 10000, // 10 seconds
      retryMultiplier: config.retryMultiplier || 2,
      
      // Provider selection weights
      defaultWeight: config.defaultWeight || 1.0,
      performanceWeight: config.performanceWeight || 0.3,
      costWeight: config.costWeight || 0.2,
      reliabilityWeight: config.reliabilityWeight || 0.5
    };

    // Provider state tracking
    this.providerStates = new Map();
    this.circuitBreakers = new Map();
    this.performanceMetrics = new Map();
    this.healthCheckIntervals = new Map();
    
    // Failover statistics
    this.failoverStats = {
      totalFailovers: 0,
      providerFailures: new Map(),
      lastFailoverTime: null,
      averageFailoverTime: 0,
      totalRequests: 0,
      totalSuccesses: 0
    };
  }

  /**
   * Initialize failover manager with providers
   * @param {Map} providers - Map of provider instances
   */
  initialize(providers) {
    this.providers = providers;
    
    // Initialize state for each provider
    for (const [name, provider] of providers) {
      this.initializeProviderState(name, provider);
    }
    
    // Start health monitoring
    this.startHealthMonitoring();
    
    logger.info('Failover manager initialized', {
      providerCount: providers.size,
      config: this.config
    });
  }

  /**
   * Initialize state tracking for a provider
   * @param {string} name - Provider name
   * @param {Object} provider - Provider instance
   */
  initializeProviderState(name, provider) {
    this.providerStates.set(name, {
      status: 'healthy',
      consecutiveFailures: 0,
      lastFailureTime: null,
      lastSuccessTime: Date.now(),
      totalRequests: 0,
      totalFailures: 0,
      averageResponseTime: 0,
      lastHealthCheck: null
    });

    this.circuitBreakers.set(name, {
      state: 'closed', // closed, open, half-open
      failureCount: 0,
      lastFailureTime: null,
      nextAttemptTime: null
    });

    this.performanceMetrics.set(name, {
      responseTimeHistory: [],
      costHistory: [],
      successRate: 1.0,
      reliability: 1.0
    });

    this.failoverStats.providerFailures.set(name, 0);
  }

  /**
   * Execute request with failover logic
   * @param {Object} request - Request to execute
   * @param {Array} excludeProviders - Providers to exclude
   * @returns {Promise<Object>} Execution result
   */
  async executeWithFailover(request, excludeProviders = []) {
    const startTime = Date.now();
    let lastError = null;
    
    // Get ordered list of providers based on selection strategy
    const orderedProviders = this.selectProvidersForExecution(request, excludeProviders);
    
    logger.info('Starting failover execution', {
      totalProviders: orderedProviders.length,
      excludeProviders,
      requestType: request.taskType
    });

    for (const providerName of orderedProviders) {
      const provider = this.providers.get(providerName);
      const circuitBreaker = this.circuitBreakers.get(providerName);
      
      // Check circuit breaker state
      if (!this.canExecuteWithProvider(providerName)) {
        logger.debug('Skipping provider due to circuit breaker', { provider: providerName });
        continue;
      }

      try {
        // Execute with retry logic
        const result = await this.executeWithRetry(provider, request, providerName);
        
        // Enhance result with provider information
        const enhancedResult = {
          ...result,
          provider: providerName
        };
        
        // Record success
        this.recordSuccess(providerName, Date.now() - startTime, result.cost?.total || 0);
        
        // Emit success event
        this.emit('execution_success', {
          provider: providerName,
          duration: Date.now() - startTime,
          cost: result.cost?.total || 0
        });

        return enhancedResult;

      } catch (error) {
        lastError = error;
        
        // Record failure
        this.recordFailure(providerName, error);
        
        // Update circuit breaker
        this.updateCircuitBreaker(providerName, error);
        
        // Emit failure event
        this.emit('provider_failure', {
          provider: providerName,
          error: error.message,
          duration: Date.now() - startTime
        });

        logger.warn('Provider execution failed, trying next provider', {
          provider: providerName,
          error: error.message,
          remainingProviders: orderedProviders.length - orderedProviders.indexOf(providerName) - 1
        });
      }
    }

    // All providers failed
    this.failoverStats.totalFailovers++;
    this.failoverStats.lastFailoverTime = Date.now();
    
    this.emit('all_providers_failed', {
      error: lastError?.message,
      duration: Date.now() - startTime,
      attemptedProviders: orderedProviders.length
    });

    throw new Error(`All providers failed. Last error: ${lastError?.message}`);
  }

  /**
   * Execute request with retry logic
   * @param {Object} provider - Provider instance
   * @param {Object} request - Request to execute
   * @param {string} providerName - Provider name
   * @returns {Promise<Object>} Execution result
   */
  async executeWithRetry(provider, request, providerName) {
    let lastError = null;
    
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const result = await provider.complete(request);
        
        // Reset consecutive failures on success
        const state = this.providerStates.get(providerName);
        state.consecutiveFailures = 0;
        state.lastSuccessTime = Date.now();
        
        return result;
        
      } catch (error) {
        lastError = error;
        
        // Check if error is retryable
        if (!this.isRetryableError(error) || attempt === this.config.maxRetries) {
          throw error;
        }
        
        // Calculate retry delay with exponential backoff and jitter
        const delay = this.calculateRetryDelay(attempt);
        
        logger.debug('Retrying provider execution', {
          provider: providerName,
          attempt: attempt + 1,
          maxRetries: this.config.maxRetries,
          delay,
          error: error.message
        });
        
        await this.sleep(delay);
      }
    }
    
    throw lastError;
  }

  /**
   * Select providers for execution based on strategy
   * @param {Object} request - Request to execute
   * @param {Array} excludeProviders - Providers to exclude
   * @returns {Array} Ordered list of provider names
   */
  selectProvidersForExecution(request, excludeProviders = []) {
    const availableProviders = Array.from(this.providers.keys())
      .filter(name => !excludeProviders.includes(name))
      .filter(name => this.canExecuteWithProvider(name));

    // Calculate scores for each provider
    const providerScores = availableProviders.map(name => ({
      name,
      score: this.calculateProviderScore(name, request)
    }));

    // Sort by score (highest first)
    providerScores.sort((a, b) => b.score - a.score);

    return providerScores.map(p => p.name);
  }

  /**
   * Calculate provider score for selection
   * @param {string} providerName - Provider name
   * @param {Object} request - Request context
   * @returns {number} Provider score
   */
  calculateProviderScore(providerName, request) {
    const state = this.providerStates.get(providerName);
    const metrics = this.performanceMetrics.get(providerName);
    
    // Base score
    let score = this.config.defaultWeight;
    
    // Performance factor (lower response time = higher score)
    const avgResponseTime = state.averageResponseTime || 1000;
    const performanceFactor = Math.max(0, 1 - (avgResponseTime / 10000)); // normalize to 10s max
    score += performanceFactor * this.config.performanceWeight;
    
    // Reliability factor
    score += metrics.reliability * this.config.reliabilityWeight;
    
    // Cost factor (lower cost = higher score)
    const avgCost = this.getAverageCost(providerName);
    const costFactor = avgCost > 0 ? Math.max(0, 1 - (avgCost / 0.1)) : 1; // normalize to $0.10 max
    score += costFactor * this.config.costWeight;
    
    // Penalty for recent failures
    const timeSinceFailure = Date.now() - (state.lastFailureTime || 0);
    if (timeSinceFailure < 60000) { // 1 minute penalty
      score *= 0.5;
    }
    
    return score;
  }

  /**
   * Check if provider can execute requests
   * @param {string} providerName - Provider name
   * @returns {boolean} Whether provider can execute
   */
  canExecuteWithProvider(providerName) {
    const state = this.providerStates.get(providerName);
    const circuitBreaker = this.circuitBreakers.get(providerName);
    
    // Check provider health
    if (state.status !== 'healthy') {
      return false;
    }
    
    // Check circuit breaker
    if (circuitBreaker.state === 'open') {
      // Check if we can attempt half-open
      if (Date.now() >= circuitBreaker.nextAttemptTime) {
        circuitBreaker.state = 'half-open';
        logger.info('Circuit breaker transitioning to half-open', { provider: providerName });
        return true;
      }
      return false;
    }
    
    return true;
  }

  /**
   * Record successful execution
   * @param {string} providerName - Provider name
   * @param {number} duration - Execution duration
   * @param {number} cost - Execution cost
   */
  recordSuccess(providerName, duration, cost) {
    const state = this.providerStates.get(providerName);
    const metrics = this.performanceMetrics.get(providerName);
    const circuitBreaker = this.circuitBreakers.get(providerName);
    
    // Safety check - initialize if not exists
    if (!state) {
      logger.warn('Provider state not found, initializing', { providerName });
      this.initializeProviderState(providerName, { getName: () => providerName });
      return this.recordSuccess(providerName, duration, cost);
    }
    
    // Update state
    state.totalRequests++;
    state.lastSuccessTime = Date.now();
    state.consecutiveFailures = 0;
    
    // Update average response time
    const totalTime = state.averageResponseTime * (state.totalRequests - 1) + duration;
    state.averageResponseTime = totalTime / state.totalRequests;
    
    // Update performance metrics
    if (metrics) {
      metrics.responseTimeHistory.push(duration);
      if (metrics.responseTimeHistory.length > 100) {
        metrics.responseTimeHistory.shift();
      }
      
      if (cost) {
        metrics.costHistory.push(cost);
        if (metrics.costHistory.length > 100) {
          metrics.costHistory.shift();
        }
      }
    }
    
    // Reset circuit breaker on success
    if (circuitBreaker && circuitBreaker.state !== 'closed') {
      circuitBreaker.state = 'closed';
      circuitBreaker.failureCount = 0;
      circuitBreaker.lastFailureTime = null;
      
      this.emit('provider_recovered', {
        provider: providerName,
        timestamp: Date.now()
      });
      
      logger.info('Provider recovered, circuit breaker closed', { provider: providerName });
    }
    
    // Update failover stats
    this.failoverStats.totalRequests++;
    this.failoverStats.totalSuccesses++;
    
    this.emit('execution_success', {
      provider: providerName,
      duration,
      cost,
      timestamp: Date.now()
    });
    
    logger.debug('Success recorded for provider', {
      provider: providerName,
      duration,
      cost,
      consecutiveFailures: state.consecutiveFailures
    });
  }

  /**
   * Record failed execution
   * @param {string} providerName - Provider name
   * @param {Error} error - Execution error
   */
  recordFailure(providerName, error) {
    const state = this.providerStates.get(providerName);
    
    // Safety check - initialize if not exists
    if (!state) {
      logger.warn('Provider state not found, initializing', { providerName });
      this.initializeProviderState(providerName, { getName: () => providerName });
      return this.recordFailure(providerName, error);
    }
    
    state.totalRequests++;
    state.totalFailures++;
    state.consecutiveFailures++;
    state.lastFailureTime = Date.now();
    
    // Update success rate
    const metrics = this.performanceMetrics.get(providerName);
    metrics.successRate = 1 - (state.totalFailures / state.totalRequests);
    metrics.reliability = this.calculateReliability(providerName);
    
    // Update failover stats
    const currentFailures = this.failoverStats.providerFailures.get(providerName) || 0;
    this.failoverStats.providerFailures.set(providerName, currentFailures + 1);
    
    // Mark as unhealthy if too many consecutive failures
    if (state.consecutiveFailures >= this.config.circuitBreakerThreshold) {
      state.status = 'unhealthy';
      logger.warn('Provider marked as unhealthy', {
        provider: providerName,
        consecutiveFailures: state.consecutiveFailures
      });
    }
  }

  /**
   * Update circuit breaker state
   * @param {string} providerName - Provider name
   * @param {Error} error - Execution error
   */
  updateCircuitBreaker(providerName, error) {
    const circuitBreaker = this.circuitBreakers.get(providerName);
    
    circuitBreaker.failureCount++;
    circuitBreaker.lastFailureTime = Date.now();
    
    // Open circuit breaker if threshold reached
    if (circuitBreaker.failureCount >= this.config.circuitBreakerThreshold) {
      circuitBreaker.state = 'open';
      circuitBreaker.nextAttemptTime = Date.now() + this.config.circuitBreakerTimeout;
      
      logger.warn('Circuit breaker opened', {
        provider: providerName,
        failureCount: circuitBreaker.failureCount,
        nextAttemptTime: new Date(circuitBreaker.nextAttemptTime).toISOString()
      });
      
      this.emit('circuit_breaker_opened', {
        provider: providerName,
        failureCount: circuitBreaker.failureCount
      });
    }
  }

  /**
   * Start health monitoring for all providers
   */
  startHealthMonitoring() {
    // Skip health monitoring if interval is 0 (for testing)
    if (this.config.healthCheckInterval === 0) {
      logger.info('Health monitoring disabled (interval = 0)');
      return;
    }
    
    for (const [name, provider] of this.providers) {
      const interval = setInterval(async () => {
        await this.performHealthCheck(name, provider);
      }, this.config.healthCheckInterval);
      
      this.healthCheckIntervals.set(name, interval);
    }
    
    logger.info('Health monitoring started for all providers');
  }

  /**
   * Perform health check for a provider
   * @param {string} providerName - Provider name
   * @param {Object} provider - Provider instance
   */
  async performHealthCheck(providerName, provider) {
    const state = this.providerStates.get(providerName);
    
    try {
      const startTime = Date.now();
      await provider.healthCheck();
      const duration = Date.now() - startTime;
      
      state.lastHealthCheck = Date.now();
      
      // Restore to healthy if was unhealthy
      if (state.status === 'unhealthy') {
        state.status = 'healthy';
        state.consecutiveFailures = 0;
        
        logger.info('Provider restored to healthy status', {
          provider: providerName,
          healthCheckDuration: duration
        });
        
        this.emit('provider_recovered', {
          provider: providerName,
          duration
        });
      }
      
    } catch (error) {
      logger.debug('Health check failed', {
        provider: providerName,
        error: error.message
      });
      
      // Don't immediately mark as unhealthy on health check failure
      // Let the circuit breaker handle it during actual requests
    }
  }

  /**
   * Calculate provider reliability score
   * @param {string} providerName - Provider name
   * @returns {number} Reliability score (0-1)
   */
  calculateReliability(providerName) {
    const state = this.providerStates.get(providerName);
    const metrics = this.performanceMetrics.get(providerName);
    
    // Base reliability from success rate
    let reliability = metrics.successRate;
    
    // Factor in recent performance
    const recentFailures = state.consecutiveFailures;
    if (recentFailures > 0) {
      reliability *= Math.max(0.1, 1 - (recentFailures * 0.2));
    }
    
    // Factor in time since last failure
    const timeSinceFailure = Date.now() - (state.lastFailureTime || 0);
    const hoursSinceFailure = timeSinceFailure / (1000 * 60 * 60);
    const recencyBonus = Math.min(0.2, hoursSinceFailure * 0.01);
    reliability += recencyBonus;
    
    return Math.max(0, Math.min(1, reliability));
  }

  /**
   * Get average cost for a provider
   * @param {string} providerName - Provider name
   * @returns {number} Average cost
   */
  getAverageCost(providerName) {
    const metrics = this.performanceMetrics.get(providerName);
    if (!metrics.costHistory.length) return 0;
    
    return metrics.costHistory.reduce((sum, cost) => sum + cost, 0) / metrics.costHistory.length;
  }

  /**
   * Check if error is retryable
   * @param {Error} error - Error to check
   * @returns {boolean} Whether error is retryable
   */
  isRetryableError(error) {
    // Network errors are retryable
    if (error.code === 'ECONNRESET' || error.code === 'ENOTFOUND' || error.code === 'TIMEOUT') {
      return true;
    }
    
    // HTTP 5xx errors are retryable
    if (error.status >= 500 && error.status < 600) {
      return true;
    }
    
    // Rate limit errors are retryable
    if (error.status === 429) {
      return true;
    }
    
    // Specific provider errors that are retryable
    if (error.message && (
      error.message.includes('timeout') ||
      error.message.includes('network') ||
      error.message.includes('connection')
    )) {
      return true;
    }
    
    return false;
  }

  /**
   * Calculate retry delay with exponential backoff and jitter
   * @param {number} attempt - Attempt number
   * @returns {number} Delay in milliseconds
   */
  calculateRetryDelay(attempt) {
    const baseDelay = this.config.baseRetryDelay * Math.pow(this.config.retryMultiplier, attempt);
    const cappedDelay = Math.min(baseDelay, this.config.maxRetryDelay);
    
    // Add jitter (±25%)
    const jitter = cappedDelay * 0.25 * (Math.random() - 0.5);
    
    return Math.max(100, cappedDelay + jitter); // Minimum 100ms
  }

  /**
   * Get failover statistics
   * @returns {Object} Failover statistics
   */
  getFailoverStats() {
    const providerStats = {};
    
    for (const [name, state] of this.providerStates) {
      const metrics = this.performanceMetrics.get(name);
      const circuitBreaker = this.circuitBreakers.get(name);
      
      providerStats[name] = {
        status: state.status,
        totalRequests: state.totalRequests,
        totalFailures: state.totalFailures,
        consecutiveFailures: state.consecutiveFailures,
        successRate: metrics.successRate,
        reliability: metrics.reliability,
        averageResponseTime: state.averageResponseTime,
        averageCost: this.getAverageCost(name),
        circuitBreakerState: circuitBreaker.state,
        lastFailureTime: state.lastFailureTime,
        lastSuccessTime: state.lastSuccessTime,
        lastHealthCheck: state.lastHealthCheck
      };
    }
    
    return {
      ...this.failoverStats,
      providers: providerStats
    };
  }

  /**
   * Sleep for specified duration
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise} Sleep promise
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Shutdown failover manager
   */
  async shutdown() {
    // Clear health check intervals
    for (const interval of this.healthCheckIntervals.values()) {
      clearInterval(interval);
    }
    
    this.healthCheckIntervals.clear();
    
    logger.info('Failover manager shutdown complete');
  }
}

module.exports = FailoverManager;
