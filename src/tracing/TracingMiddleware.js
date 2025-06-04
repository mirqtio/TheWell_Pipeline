const TracingManager = require('./TracingManager');
const logger = require('../utils/logger'); // eslint-disable-line no-unused-vars

/**
 * TracingMiddleware - Express middleware for automatic request tracing
 * 
 * Features:
 * - Automatic span creation for HTTP requests
 * - Trace context propagation across services
 * - Request/response metadata capture
 * - Error tracking and performance monitoring
 */
class TracingMiddleware {
  constructor(options = {}) {
    this.tracingManager = options.tracingManager || new TracingManager(options);
    this.excludePaths = options.excludePaths || ['/health', '/metrics', '/favicon.ico'];
    this.includeRequestBody = options.includeRequestBody || false;
    this.includeResponseBody = options.includeResponseBody || false;
    this.maxBodySize = options.maxBodySize || 1024; // Max body size to log (bytes)
  }

  /**
   * Express middleware function for request tracing
   */
  middleware() {
    return (req, res, next) => {
      // Skip tracing for excluded paths
      if (this.shouldSkipTracing(req.path)) {
        return next();
      }

      const startTime = Date.now();
      
      // Extract trace context from headers
      const parentContext = this.tracingManager.extractTraceContext(req.headers);
      
      // Start request span
      const span = this.tracingManager.startSpan('http.request', {
        parentSpan: parentContext,
        tags: {
          'http.method': req.method,
          'http.url': req.url,
          'http.path': req.path,
          'http.user_agent': req.get('User-Agent') || '',
          'http.remote_addr': req.ip || req.connection.remoteAddress,
          'component': 'http-server',
        }
      });

      // Add request metadata
      if (req.query && Object.keys(req.query).length > 0) {
        span.setTag('http.query', JSON.stringify(req.query));
      }

      if (this.includeRequestBody && req.body) {
        const bodyStr = this.truncateBody(JSON.stringify(req.body));
        span.setTag('http.request.body', bodyStr);
      }

      // Store span in request for access by route handlers
      req.traceSpan = span;
      req.tracingManager = this.tracingManager;

      // Inject trace context into response headers for downstream services
      const traceHeaders = {};
      this.tracingManager.injectTraceContext(span.span, traceHeaders);
      Object.entries(traceHeaders).forEach(([key, value]) => {
        res.set(key, value);
      });

      // Override res.json to capture response data
      const originalJson = res.json;
      res.json = (body) => {
        if (this.includeResponseBody && body) {
          const bodyStr = this.truncateBody(JSON.stringify(body));
          span.setTag('http.response.body', bodyStr);
        }
        return originalJson.call(res, body);
      };

      // Handle response completion
      const finishSpan = () => {
        const duration = Date.now() - startTime;
        
        span.setTag('http.status_code', res.statusCode);
        span.setTag('http.duration_ms', duration);
        
        // Mark as error if status code indicates error
        if (res.statusCode >= 400) {
          span.setTag('error', true);
          span.setTag('http.error', true);
        }

        // Log performance metrics
        span.log({
          event: 'request.completed',
          duration_ms: duration,
          status_code: res.statusCode,
        });

        span.finish();
      };

      // Listen for response events
      res.on('finish', finishSpan);
      res.on('close', finishSpan);

      // Handle errors
      const originalNext = next;
      next = (error) => {
        if (error) {
          span.setError(error);
          span.setTag('http.status_code', res.statusCode || 500);
        }
        originalNext(error);
      };

      next();
    };
  }

  /**
   * Check if tracing should be skipped for this path
   * @param {string} path - Request path
   * @returns {boolean} Whether to skip tracing
   */
  shouldSkipTracing(path) {
    return this.excludePaths.some(excludePath => {
      if (excludePath.includes('*')) {
        const pattern = excludePath.replace(/\*/g, '.*');
        return new RegExp(`^${pattern}$`).test(path);
      }
      return path === excludePath;
    });
  }

  /**
   * Truncate body content for logging
   * @param {string} body - Body content
   * @returns {string} Truncated body
   */
  truncateBody(body) {
    if (!body || body.length <= this.maxBodySize) {
      return body;
    }
    return body.substring(0, this.maxBodySize) + '... (truncated)';
  }

  /**
   * Create a child span for a specific operation within a request
   * @param {object} req - Express request object
   * @param {string} operationName - Name of the operation
   * @param {object} tags - Additional tags
   * @returns {object} Span context
   */
  createChildSpan(req, operationName, tags = {}) {
    if (!req.tracingManager || !req.traceSpan) {
      return this.tracingManager.createNoOpSpan();
    }

    return req.tracingManager.startSpan(operationName, {
      parentSpan: req.traceSpan.span,
      tags: {
        'component': 'application',
        ...tags
      }
    });
  }

  /**
   * Get the TracingManager instance
   * @returns {TracingManager} The tracing manager
   */
  getTracingManager() {
    return this.tracingManager;
  }
}

module.exports = TracingMiddleware;
