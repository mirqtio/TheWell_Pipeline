const logger = require('../utils/logger');

/**
 * RAG-specific tracing utilities
 * Provides specialized tracing for RAG pipeline operations
 */
class RAGTracing {
  constructor(tracingManager) {
    this.tracingManager = tracingManager;
  }

  /**
   * Trace a complete RAG query operation
   * @param {string} query - The user query
   * @param {object} metadata - Additional metadata
   * @param {function} operation - The operation to trace
   * @returns {Promise<any>} Operation result
   */
  async traceRAGQuery(query, metadata = {}, operation) {
    const spanContext = this.tracingManager.startSpan('rag.query', {
      tags: {
        'rag.operation': 'query',
        'rag.query.text': query,
        'rag.query.type': metadata.type || 'search',
        ...metadata
      }
    });
    
    try {
      const startTime = Date.now();
      const result = await operation();
      const duration = Date.now() - startTime;
      
      // Add result metadata to span
      spanContext.setTag('rag.query.duration_ms', duration);
      spanContext.setTag('rag.query.documents_count', result.totalCount || 0);
      spanContext.setTag('rag.query.max_score', result.maxScore || 0);
      
      // Check for SLA violations
      if (duration > 2000) {
        spanContext.setTag('rag.query.sla_violation', true);
        spanContext.log({
          event: 'rag.query.sla_violation',
          threshold_ms: 2000,
          actual_ms: duration,
        });
      }
      
      return result;
    } catch (error) {
      spanContext.setError(error);
      spanContext.log({
        event: 'rag.query.failed',
        error_type: error.constructor.name,
        error_message: error.message,
      });
      throw error;
    } finally {
      spanContext.finish();
    }
  }

  /**
   * Trace document retrieval operations
   * @param {string} strategy - Retrieval strategy (vector, keyword, hybrid)
   * @param {object} params - Retrieval parameters
   * @param {function} operation - The operation to trace
   * @returns {Promise<any>} Operation result
   */
  async traceRetrieval(strategy, params = {}, operation) {
    const spanContext = this.tracingManager.trackRetrieval({
      strategy,
      limit: params.limit,
      filters: params.filters,
      vectorWeight: params.vectorWeight,
      keywordWeight: params.keywordWeight,
    });

    try {
      const startTime = Date.now();
      const result = await operation();
      const duration = Date.now() - startTime;
      
      // Add retrieval metrics
      spanContext.setTag('rag.retrieval.duration_ms', duration);
      spanContext.setTag('rag.retrieval.documents_found', result.documents?.length || 0);
      spanContext.setTag('rag.retrieval.avg_score', this.calculateAverageScore(result.documents));
      
      if (strategy === 'hybrid') {
        spanContext.setTag('rag.retrieval.vector_weight', params.vectorWeight || 0.7);
        spanContext.setTag('rag.retrieval.keyword_weight', params.keywordWeight || 0.3);
      }

      spanContext.log({
        event: 'rag.retrieval.completed',
        strategy,
        duration_ms: duration,
        documents_found: result.documents?.length || 0,
      });

      return result;
    } catch (error) {
      spanContext.setError(error);
      throw error;
    } finally {
      spanContext.finish();
    }
  }

  /**
   * Trace response generation operations
   * @param {string} provider - LLM provider
   * @param {object} params - Generation parameters
   * @param {function} operation - The operation to trace
   * @returns {Promise<any>} Operation result
   */
  async traceGeneration(provider, params = {}, operation) {
    const spanContext = this.tracingManager.trackGeneration({
      provider,
      model: params.model,
      temperature: params.temperature,
      maxTokens: params.maxTokens,
      promptVersion: params.promptVersion,
    });

    try {
      const startTime = Date.now();
      const result = await operation();
      const duration = Date.now() - startTime;
      
      // Add generation metrics
      spanContext.setTag('rag.generation.duration_ms', duration);
      spanContext.setTag('rag.generation.input_tokens', result.usage?.inputTokens || 0);
      spanContext.setTag('rag.generation.output_tokens', result.usage?.outputTokens || 0);
      spanContext.setTag('rag.generation.total_tokens', result.usage?.totalTokens || 0);
      spanContext.setTag('rag.generation.cost', result.cost || 0);

      spanContext.log({
        event: 'rag.generation.completed',
        provider,
        model: params.model,
        duration_ms: duration,
        tokens_used: result.usage?.totalTokens || 0,
      });

      return result;
    } catch (error) {
      spanContext.setError(error);
      spanContext.log({
        event: 'rag.generation.failed',
        provider,
        error_type: error.constructor.name,
        error_message: error.message,
      });
      throw error;
    } finally {
      spanContext.finish();
    }
  }

  /**
   * Trace cache operations
   * @param {string} operation - Cache operation (get, set, delete)
   * @param {string} key - Cache key
   * @param {function} handler - Cache operation function
   * @returns {Promise<any>} Operation result
   */
  async traceCache(operation, key, handler) {
    return this.traceOperation(
      'rag.cache',
      {
        'cache.operation': operation,
        'cache.key': key,
      },
      handler
    );
  }

  /**
   * Trace database operations
   * @param {string} operation - Database operation (query, insert, update, delete)
   * @param {string} table - Database table
   * @param {function} handler - Database operation function
   * @returns {Promise<any>} Operation result
   */
  async traceDatabase(operation, table, handler) {
    return this.traceOperation(
      'rag.database',
      {
        'db.operation': operation,
        'db.table': table,
      },
      handler
    );
  }

  /**
   * Generic operation tracing
   * @param {string} operationName - Name of the operation
   * @param {object} tags - Additional tags
   * @param {function} handler - Operation function
   * @returns {Promise<any>} Operation result
   */
  async traceOperation(operationName, tags = {}, handler) {
    const spanContext = this.tracingManager.startSpan(operationName);
    
    // Set additional tags
    Object.entries(tags).forEach(([key, value]) => {
      spanContext.setTag(key, value);
    });

    try {
      const startTime = Date.now();
      const result = await handler();
      const duration = Date.now() - startTime;
      
      spanContext.setTag('operation.duration_ms', duration);
      spanContext.log({
        event: `${operationName}.completed`,
        duration_ms: duration,
      });

      return result;
    } catch (error) {
      spanContext.setError(error);
      spanContext.log({
        event: `${operationName}.failed`,
        error_type: error.constructor.name,
        error_message: error.message,
      });
      throw error;
    } finally {
      spanContext.finish();
    }
  }

  /**
   * Calculate average score from documents
   * @param {Array} documents - Array of documents with scores
   * @returns {number} Average score
   */
  calculateAverageScore(documents) {
    if (!documents || documents.length === 0) {
      return 0;
    }
    
    const scores = documents
      .map(doc => doc.score)
      .filter(score => typeof score === 'number');
    
    if (scores.length === 0) {
      return 0;
    }
    
    return scores.reduce((sum, score) => sum + score, 0) / scores.length;
  }
}

module.exports = RAGTracing;
