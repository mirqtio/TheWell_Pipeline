const opentracing = require('opentracing');
const jaeger = require('jaeger-client');
const { v4: uuidv4 } = require('uuid');
const createNamespace = require('cls-hooked').createNamespace;
const logger = require('../utils/logger');

/**
 * TracingManager - Manages distributed tracing across the RAG pipeline
 * 
 * Features:
 * - Jaeger integration for distributed tracing
 * - Automatic span creation and context propagation
 * - RAG-specific attributes and metrics
 * - Performance monitoring and SLA tracking
 */
class TracingManager {
  constructor(options = {}) {
    this.serviceName = options.serviceName || 'thewell-pipeline';
    this.jaegerEndpoint = options.jaegerEndpoint || 'http://localhost:14268/api/traces';
    this.samplingRate = options.samplingRate || 0.1; // 10% sampling by default
    this.tracer = null;
    this.namespace = createNamespace('tracing-context');
    
    // Disable tracing in test environments to prevent timeout issues, unless explicitly enabled
    this.enabled = options.enabled === true || (options.enabled !== false && process.env.NODE_ENV !== 'test');
    
    if (this.enabled) {
      this.initializeTracer();
    }
  }

  /**
   * Initialize Jaeger tracer
   */
  initializeTracer() {
    try {
      const config = {
        serviceName: this.serviceName,
        sampler: {
          type: 'probabilistic',
          param: this.samplingRate,
        },
        reporter: {
          logSpans: false,
          agentHost: process.env.JAEGER_AGENT_HOST || 'localhost',
          agentPort: process.env.JAEGER_AGENT_PORT || 6832,
          collectorEndpoint: this.jaegerEndpoint,
        },
      };

      const options = {
        logger: {
          info: (msg) => logger.debug(`Jaeger: ${msg}`),
          error: (msg) => logger.error(`Jaeger: ${msg}`),
        },
      };

      this.tracer = jaeger.initTracer(config, options);
      opentracing.initGlobalTracer(this.tracer);
      
      logger.info('Distributed tracing initialized with Jaeger');
    } catch (error) {
      logger.error('Failed to initialize tracing:', error);
      this.enabled = false;
    }
  }

  /**
   * Start a new trace span
   * @param {string} operationName - Name of the operation
   * @param {object} options - Span options
   * @returns {object} Span context manager
   */
  startSpan(operationName, options = {}) {
    if (!this.enabled || !this.tracer) {
      return this.createNoOpSpan();
    }

    const parentSpan = this.getCurrentSpan();
    const spanOptions = {
      ...options,
      childOf: parentSpan || options.parentSpan,
    };

    const span = this.tracer.startSpan(operationName, spanOptions);
    
    // Add default tags
    span.setTag('service.name', this.serviceName);
    span.setTag('service.version', process.env.npm_package_version || '1.0.0');
    
    // Add custom tags if provided
    if (options.tags) {
      Object.entries(options.tags).forEach(([key, value]) => {
        span.setTag(key, value);
      });
    }

    return this.createSpanContext(span);
  }

  /**
   * Create a span context manager for automatic lifecycle management
   * @param {object} span - OpenTracing span
   * @returns {object} Context manager
   */
  createSpanContext(span) {
    const self = this;
    
    return {
      span,
      
      // Set tag on the span
      setTag(key, value) {
        span.setTag(key, value);
        return this;
      },
      
      // Log structured data
      log(fields) {
        span.log(fields);
        return this;
      },
      
      // Set error on span
      setError(error) {
        span.setTag('error', true);
        span.log({
          event: 'error',
          message: error.message,
          stack: error.stack,
        });
        return this;
      },
      
      // Execute function within span context
      run(fn) {
        return self.namespace.runAndReturn(() => {
          self.namespace.set('currentSpan', span);
          try {
            const result = fn(this);
            if (result && typeof result.then === 'function') {
              // Handle promises
              return result.catch(error => {
                this.setError(error);
                throw error;
              });
            }
            return result;
          } catch (error) {
            this.setError(error);
            throw error;
          }
        });
      },
      
      // Finish the span
      finish() {
        span.finish();
      }
    };
  }

  /**
   * Create a no-op span when tracing is disabled
   */
  createNoOpSpan() {
    return {
      span: null,
      setTag: () => this,
      log: () => this,
      setError: () => this,
      run: (fn) => fn(this),
      finish: () => {},
    };
  }

  /**
   * Get current active span from context
   */
  getCurrentSpan() {
    if (!this.enabled) return null;
    return this.namespace.get('currentSpan') || null;
  }

  /**
   * Extract trace context from HTTP headers
   * @param {object} headers - HTTP headers
   * @returns {object} Span context
   */
  extractTraceContext(headers) {
    if (!this.enabled || !this.tracer) return null;
    
    try {
      return this.tracer.extract(opentracing.FORMAT_HTTP_HEADERS, headers);
    } catch (error) {
      logger.debug('Failed to extract trace context:', error);
      return null;
    }
  }

  /**
   * Inject trace context into HTTP headers
   * @param {object} span - Current span
   * @param {object} headers - Headers object to inject into
   */
  injectTraceContext(span, headers = {}) {
    if (!this.enabled || !this.tracer || !span) return headers;
    
    try {
      this.tracer.inject(span, opentracing.FORMAT_HTTP_HEADERS, headers);
    } catch (error) {
      logger.debug('Failed to inject trace context:', error);
    }
    
    return headers;
  }

  /**
   * Generate a new trace ID
   */
  generateTraceId() {
    return uuidv4();
  }

  /**
   * Create RAG-specific span with common attributes
   * @param {string} operation - RAG operation (query, retrieval, generation, etc.)
   * @param {object} attributes - RAG-specific attributes
   */
  createRAGSpan(operation, attributes = {}) {
    const span = this.startSpan(`rag.${operation}`, {
      tags: {
        'rag.operation': operation,
        'component': 'rag-pipeline',
        ...attributes
      }
    });

    return span;
  }

  /**
   * Track query processing performance
   * @param {string} query - Search query
   * @param {object} metadata - Query metadata
   */
  trackQuery(query, metadata = {}) {
    return this.createRAGSpan('query', {
      'rag.query.text': query,
      'rag.query.length': query.length,
      'rag.query.type': metadata.queryType || 'unknown',
      'rag.query.filters': JSON.stringify(metadata.filters || {}),
    });
  }

  /**
   * Track document retrieval performance
   * @param {object} retrievalMetadata - Retrieval metadata
   */
  trackRetrieval(retrievalMetadata = {}) {
    return this.createRAGSpan('retrieval', {
      'rag.retrieval.strategy': retrievalMetadata.strategy || 'hybrid',
      'rag.retrieval.limit': retrievalMetadata.limit || 10,
      'rag.retrieval.filters': JSON.stringify(retrievalMetadata.filters || {}),
    });
  }

  /**
   * Track response generation performance
   * @param {object} generationMetadata - Generation metadata
   */
  trackGeneration(generationMetadata = {}) {
    return this.createRAGSpan('generation', {
      'rag.generation.provider': generationMetadata.provider || 'unknown',
      'rag.generation.model': generationMetadata.model || 'unknown',
      'rag.generation.prompt_version': generationMetadata.promptVersion || 'unknown',
    });
  }

  /**
   * Close the tracer and flush remaining spans
   */
  async close() {
    if (this.tracer && this.enabled) {
      return new Promise((resolve) => {
        this.tracer.close(resolve);
      });
    }
  }
}

module.exports = TracingManager;
