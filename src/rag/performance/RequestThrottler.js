/**
 * Request Throttler
 * Implements request throttling and queue management for RAG API
 */

const logger = require('../../utils/logger');

class RequestThrottler {
  constructor(options = {}) {
    this.maxConcurrentRequests = options.maxConcurrentRequests || 10;
    this.maxQueueSize = options.maxQueueSize || 50;
    this.requestTimeoutMs = options.requestTimeoutMs || 30000;
    this.rateLimitPerMinute = options.rateLimitPerMinute || 60;
    
    // Request tracking
    this.activeRequests = new Map();
    this.requestQueue = [];
    this.rateLimitTracker = new Map();
    
    // Metrics
    this.metrics = {
      totalRequests: 0,
      completedRequests: 0,
      failedRequests: 0,
      queuedRequests: 0,
      rejectedRequests: 0,
      averageProcessingTime: 0,
      currentActiveRequests: 0
    };

    this.isInitialized = false;
    this.cleanupInterval = null;
  }

  /**
   * Initialize the request throttler
   */
  async initialize() {
    try {
      logger.info('Initializing Request Throttler...', {
        maxConcurrentRequests: this.maxConcurrentRequests,
        maxQueueSize: this.maxQueueSize,
        rateLimitPerMinute: this.rateLimitPerMinute
      });
      
      // Start cleanup interval for rate limit tracking
      this.cleanupInterval = setInterval(() => {
        this.cleanupRateLimitTracker();
      }, 60000); // Clean up every minute

      this.isInitialized = true;
      logger.info('Request Throttler initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Request Throttler:', error);
      throw error;
    }
  }

  /**
   * Express middleware for request throttling
   * @returns {Function} Express middleware function
   */
  middleware() {
    return async (req, res, next) => {
      if (!this.isInitialized) {
        return res.status(503).json({
          error: 'Service temporarily unavailable',
          message: 'Request throttler not initialized'
        });
      }

      const clientId = this.getClientId(req);
      const requestId = this.generateRequestId();

      try {
        // Check rate limit
        if (!this.checkRateLimit(clientId)) {
          this.metrics.rejectedRequests++;
          return res.status(429).json({
            error: 'Rate limit exceeded',
            message: `Maximum ${this.rateLimitPerMinute} requests per minute allowed`,
            retryAfter: 60
          });
        }

        // Check if we can process immediately
        if (this.activeRequests.size < this.maxConcurrentRequests) {
          await this.processRequest(requestId, clientId, req, res, next);
        } else {
          // Queue the request
          await this.queueRequest(requestId, clientId, req, res, next);
        }

      } catch (error) {
        logger.error('Request throttling error:', error);
        this.metrics.failedRequests++;
        
        if (!res.headersSent) {
          res.status(500).json({
            error: 'Internal server error',
            message: 'Request processing failed'
          });
        }
      }
    };
  }

  /**
   * Process a request immediately
   * @param {string} requestId - Unique request ID
   * @param {string} clientId - Client identifier
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next function
   */
  async processRequest(requestId, clientId, req, res, next) {
    const startTime = Date.now();
    
    // Track active request
    this.activeRequests.set(requestId, {
      clientId,
      startTime,
      timeout: setTimeout(() => {
        this.handleRequestTimeout(requestId, res);
      }, this.requestTimeoutMs)
    });

    this.metrics.totalRequests++;
    this.metrics.currentActiveRequests = this.activeRequests.size;

    // Override res.end to track completion
    const originalEnd = res.end;
    res.end = (...args) => {
      this.completeRequest(requestId, startTime);
      originalEnd.apply(res, args);
    };

    // Override res.json to track completion
    const originalJson = res.json;
    res.json = (...args) => {
      this.completeRequest(requestId, startTime);
      return originalJson.apply(res, args);
    };

    // Continue to next middleware
    next();
  }

  /**
   * Queue a request for later processing
   * @param {string} requestId - Unique request ID
   * @param {string} clientId - Client identifier
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next function
   */
  async queueRequest(requestId, clientId, req, res, next) {
    // Check queue size
    if (this.requestQueue.length >= this.maxQueueSize) {
      this.metrics.rejectedRequests++;
      return res.status(503).json({
        error: 'Service overloaded',
        message: 'Request queue is full, please try again later',
        queueSize: this.requestQueue.length,
        maxQueueSize: this.maxQueueSize
      });
    }

    // Add to queue
    this.requestQueue.push({
      requestId,
      clientId,
      req,
      res,
      next,
      queuedAt: Date.now()
    });

    this.metrics.queuedRequests++;

    logger.debug('Request queued', {
      requestId,
      clientId,
      queuePosition: this.requestQueue.length,
      activeRequests: this.activeRequests.size
    });

    // Set queue position header
    res.set('X-Queue-Position', this.requestQueue.length.toString());
    res.set('X-Estimated-Wait-Time', this.estimateWaitTime().toString());
  }

  /**
   * Complete a request and process queue
   * @param {string} requestId - Request ID
   * @param {number} startTime - Request start time
   */
  completeRequest(requestId, startTime) {
    const request = this.activeRequests.get(requestId);
    if (!request) return;

    // Clear timeout
    if (request.timeout) {
      clearTimeout(request.timeout);
    }

    // Remove from active requests
    this.activeRequests.delete(requestId);
    
    // Update metrics
    const processingTime = Date.now() - startTime;
    this.metrics.completedRequests++;
    this.metrics.currentActiveRequests = this.activeRequests.size;
    
    // Update average processing time
    const totalProcessingTime = this.metrics.averageProcessingTime * (this.metrics.completedRequests - 1) + processingTime;
    this.metrics.averageProcessingTime = totalProcessingTime / this.metrics.completedRequests;

    logger.debug('Request completed', {
      requestId,
      processingTime,
      activeRequests: this.activeRequests.size,
      queueLength: this.requestQueue.length
    });

    // Process next request in queue
    this.processNextInQueue();
  }

  /**
   * Process the next request in the queue
   */
  async processNextInQueue() {
    if (this.requestQueue.length === 0 || this.activeRequests.size >= this.maxConcurrentRequests) {
      return;
    }

    const queuedRequest = this.requestQueue.shift();
    if (!queuedRequest) return;

    const { requestId, clientId, req, res, next } = queuedRequest;

    // Check if response is still valid
    if (res.headersSent || res.finished) {
      logger.warn('Skipping queued request with closed response', { requestId });
      this.processNextInQueue(); // Try next request
      return;
    }

    // Check queue timeout
    const queueTime = Date.now() - queuedRequest.queuedAt;
    if (queueTime > this.requestTimeoutMs) {
      logger.warn('Queued request timed out', { requestId, queueTime });
      if (!res.headersSent) {
        res.status(408).json({
          error: 'Request timeout',
          message: 'Request was queued too long and timed out'
        });
      }
      this.processNextInQueue(); // Try next request
      return;
    }

    // Process the request
    await this.processRequest(requestId, clientId, req, res, next);
  }

  /**
   * Handle request timeout
   * @param {string} requestId - Request ID
   * @param {Object} res - Express response object
   */
  handleRequestTimeout(requestId, res) {
    const request = this.activeRequests.get(requestId);
    if (!request) return;

    logger.warn('Request timed out', { requestId, timeout: this.requestTimeoutMs });

    // Remove from active requests
    this.activeRequests.delete(requestId);
    this.metrics.failedRequests++;
    this.metrics.currentActiveRequests = this.activeRequests.size;

    // Send timeout response if not already sent
    if (!res.headersSent) {
      res.status(408).json({
        error: 'Request timeout',
        message: `Request exceeded ${this.requestTimeoutMs}ms timeout`
      });
    }

    // Process next request in queue
    this.processNextInQueue();
  }

  /**
   * Check rate limit for client
   * @param {string} clientId - Client identifier
   * @returns {boolean} Whether request is within rate limit
   */
  checkRateLimit(clientId) {
    const now = Date.now();
    const windowStart = now - 60000; // 1 minute window

    if (!this.rateLimitTracker.has(clientId)) {
      this.rateLimitTracker.set(clientId, []);
    }

    const requests = this.rateLimitTracker.get(clientId);
    
    // Remove old requests outside the window
    const recentRequests = requests.filter(timestamp => timestamp > windowStart);
    this.rateLimitTracker.set(clientId, recentRequests);

    // Check if under limit
    if (recentRequests.length < this.rateLimitPerMinute) {
      recentRequests.push(now);
      return true;
    }

    return false;
  }

  /**
   * Get client identifier from request
   * @param {Object} req - Express request object
   * @returns {string} Client identifier
   */
  getClientId(req) {
    // Use API key, user ID, or IP address as client identifier
    if (req.headers['x-api-key']) {
      return `api:${req.headers['x-api-key']}`;
    }
    if (req.user?.id) {
      return `user:${req.user.id}`;
    }
    if (req.ip) {
      return `ip:${req.ip}`;
    }
    return 'anonymous';
  }

  /**
   * Generate unique request ID
   * @returns {string} Unique request ID
   */
  generateRequestId() {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Estimate wait time for queued requests
   * @returns {number} Estimated wait time in milliseconds
   */
  estimateWaitTime() {
    if (this.requestQueue.length === 0) return 0;
    
    const avgProcessingTime = this.metrics.averageProcessingTime || 5000; // Default 5s
    const queuePosition = this.requestQueue.length;
    const availableSlots = Math.max(0, this.maxConcurrentRequests - this.activeRequests.size);
    
    if (availableSlots > 0) {
      return Math.ceil(queuePosition / availableSlots) * avgProcessingTime;
    }
    
    return queuePosition * avgProcessingTime;
  }

  /**
   * Clean up old rate limit tracking data
   */
  cleanupRateLimitTracker() {
    const now = Date.now();
    const windowStart = now - 60000; // 1 minute window

    for (const [clientId, requests] of this.rateLimitTracker.entries()) {
      const recentRequests = requests.filter(timestamp => timestamp > windowStart);
      
      if (recentRequests.length === 0) {
        this.rateLimitTracker.delete(clientId);
      } else {
        this.rateLimitTracker.set(clientId, recentRequests);
      }
    }
  }

  /**
   * Get current metrics
   * @returns {Object} Current throttling metrics
   */
  getMetrics() {
    return {
      activeRequests: this.activeRequests.size,
      queueSize: this.requestQueue.length,
      totalRequests: this.metrics.totalRequests,
      rejectedRequests: this.metrics.rejectedRequests,
      timeoutRequests: this.metrics.failedRequests,
      averageResponseTime: this.metrics.averageProcessingTime
    };
  }

  /**
   * Get health status
   * @returns {Object} Health status
   */
  async getStatus() {
    return {
      initialized: this.isInitialized,
      maxConcurrentRequests: this.maxConcurrentRequests,
      maxQueueSize: this.maxQueueSize,
      rateLimitPerMinute: this.rateLimitPerMinute,
      requestTimeoutMs: this.requestTimeoutMs,
      metrics: this.getMetrics()
    };
  }

  /**
   * Shutdown the throttler
   */
  async shutdown() {
    logger.info('Shutting down Request Throttler...');
    
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    // Clear all active request timeouts
    for (const [requestId, request] of this.activeRequests.entries()) {
      if (request.timeout) {
        clearTimeout(request.timeout);
      }
    }

    this.activeRequests.clear();
    this.requestQueue.length = 0;
    this.rateLimitTracker.clear();
    this.isInitialized = false;

    logger.info('Request Throttler shutdown complete');
  }
}

module.exports = RequestThrottler;