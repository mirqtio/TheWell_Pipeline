const CacheManager = require('./CacheManager');
const QueryCache = require('./QueryCache');
const EmbeddingCache = require('./EmbeddingCache');
const ResponseCache = require('./ResponseCache');
const { EventEmitter } = require('events');
const logger = require('../utils/logger');

/**
 * Unified cache integration layer for TheWell Pipeline
 * Manages multiple cache types and provides invalidation policies
 */
class CacheIntegration extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      redis: config.redis || {},
      ttl: config.ttl || {},
      invalidation: {
        onDocumentUpdate: config.invalidation?.onDocumentUpdate !== false,
        onSourceUpdate: config.invalidation?.onSourceUpdate !== false,
        onModelUpdate: config.invalidation?.onModelUpdate !== false,
        ...config.invalidation
      },
      warmup: {
        enabled: config.warmup?.enabled !== false,
        queries: config.warmup?.queries || [],
        responses: config.warmup?.responses || [],
        ...config.warmup
      },
      ...config
    };

    // Initialize cache managers
    this.queryCache = new QueryCache(this.config);
    this.embeddingCache = new EmbeddingCache(this.config);
    this.responseCache = new ResponseCache(this.config);
    
    this.isInitialized = false;
    this._isConnected = false;
    
    // Track cache statistics
    this.stats = {
      totalOperations: 0,
      invalidations: 0,
      warmupOperations: 0
    };

    // Set up event forwarding
    this.setupEventForwarding();
  }

  /**
   * Set up event forwarding from individual cache managers
   */
  setupEventForwarding() {
    const caches = [this.queryCache, this.embeddingCache, this.responseCache];
    
    caches.forEach((cache, index) => {
      const cacheType = ['query', 'embedding', 'response'][index];
      
      cache.on('cache-hit', (data) => {
        this.stats.totalOperations++;
        this.emit('cache-hit', { ...data, cacheType });
      });
      
      cache.on('cache-miss', (data) => {
        this.stats.totalOperations++;
        this.emit('cache-miss', { ...data, cacheType });
      });
      
      cache.on('cache-set', (data) => {
        this.stats.totalOperations++;
        this.emit('cache-set', { ...data, cacheType });
      });
      
      cache.on('cache-error', (data) => {
        // If data has an error property, extract it, otherwise treat data as the error
        const error = data.error || data;
        this.emit('cache-error', { error, cacheType });
      });
      
      cache.on('connected', () => {
        this.checkConnectionStatus();
      });
      
      cache.on('disconnected', () => {
        this.checkConnectionStatus();
      });
    });
  }

  /**
   * Check overall connection status
   */
  checkConnectionStatus() {
    const connected = this.queryCache.isConnected && 
                     this.embeddingCache.isConnected && 
                     this.responseCache.isConnected;
    
    if (connected !== this._isConnected) {
      this._isConnected = connected;
      this.emit(connected ? 'connected' : 'disconnected');
    }
  }

  /**
   * Get connection status
   * @returns {boolean} True if all caches are connected
   */
  isConnected() {
    return this.isInitialized && 
           this.queryCache.isConnected && 
           this.embeddingCache.isConnected && 
           this.responseCache.isConnected;
  }

  /**
   * Initialize all cache managers
   */
  async initialize() {
    try {
      logger.info('Initializing CacheIntegration...');

      // Initialize all cache managers
      await Promise.all([
        this.queryCache.initialize(),
        this.embeddingCache.initialize(),
        this.responseCache.initialize()
      ]);

      // Set up invalidation listeners
      this.setupInvalidationListeners();

      // Warm up caches if enabled
      if (this.config.warmup.enabled) {
        await this.warmupCaches();
      }

      this.isInitialized = true;
      this.checkConnectionStatus();
      
      logger.info('CacheIntegration initialized successfully');
      this.emit('initialized', {
        caches: ['query', 'embedding', 'response'],
        timestamp: new Date().toISOString()
      });
      
      return true;
    } catch (error) {
      logger.error('Failed to initialize CacheIntegration:', error);
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Set up invalidation listeners for external events
   */
  setupInvalidationListeners() {
    // These would typically listen to events from other system components
    // For now, we'll set up the structure for future integration
    
    if (this.config.invalidation.onDocumentUpdate) {
      // Listen for document update events
      this.on('documentUpdated', async (documentId) => {
        await this.invalidateDocument(documentId);
      });
    }
    
    if (this.config.invalidation.onSourceUpdate) {
      // Listen for source update events
      this.on('sourceUpdated', async (sourceId) => {
        await this.invalidateSource(sourceId);
      });
    }
    
    if (this.config.invalidation.onModelUpdate) {
      // Listen for model update events
      this.on('modelUpdated', async (model) => {
        await this.invalidateModel(model);
      });
    }
  }

  /**
   * Warm up all caches with common data
   */
  async warmupCaches() {
    try {
      logger.info('Warming up caches...');
      
      const warmupPromises = [];
      
      // Warm up query cache
      if (this.config.warmup.queries.length > 0) {
        warmupPromises.push(
          this.queryCache.preloadCommonQueries(this.config.warmup.queries)
        );
      }
      
      // Warm up response cache
      if (this.config.warmup.responses.length > 0) {
        warmupPromises.push(
          this.responseCache.preloadCommonResponses(this.config.warmup.responses)
        );
      }
      
      const results = await Promise.all(warmupPromises);
      
      this.stats.warmupOperations = results.reduce((total, result) => {
        return total + (Array.isArray(result) ? result.length : 0);
      }, 0);
      
      logger.info(`Cache warmup completed: ${this.stats.warmupOperations} operations`);
      this.emit('warmupCompleted', { operations: this.stats.warmupOperations });
      
    } catch (error) {
      logger.error('Cache warmup failed:', error);
      this.emit('warmupFailed', error);
    }
  }

  /**
   * Invalidate all cached data for a document
   */
  async invalidateDocument(documentId) {
    try {
      logger.info(`Invalidating cache for document: ${documentId}`);
      
      const results = await Promise.all([
        this.embeddingCache.invalidateDocumentEmbeddings(documentId),
        this.responseCache.invalidateDocumentEnrichments(documentId),
        this.queryCache.invalidateQueries(`*${documentId}*`)
      ]);
      
      const totalInvalidated = results.reduce((sum, count) => sum + count, 0);
      this.stats.invalidations += totalInvalidated;
      
      logger.info(`Invalidated ${totalInvalidated} cache entries for document: ${documentId}`);
      this.emit('documentInvalidated', { documentId, count: totalInvalidated });
      
      return totalInvalidated;
    } catch (error) {
      logger.error(`Failed to invalidate document cache: ${documentId}`, error);
      return 0;
    }
  }

  /**
   * Invalidate cached data for a source
   */
  async invalidateSource(sourceId) {
    try {
      logger.info(`Invalidating cache for source: ${sourceId}`);
      
      // Invalidate queries related to the source
      const queryPattern = `*source:${sourceId}*`;
      const invalidated = await this.queryCache.invalidateQueries(queryPattern);
      
      this.stats.invalidations += invalidated;
      
      logger.info(`Invalidated ${invalidated} cache entries for source: ${sourceId}`);
      this.emit('sourceInvalidated', { sourceId, count: invalidated });
      
      return invalidated;
    } catch (error) {
      logger.error(`Failed to invalidate source cache: ${sourceId}`, error);
      return 0;
    }
  }

  /**
   * Invalidate cached data for a model
   */
  async invalidateModel(model) {
    try {
      logger.info(`Invalidating cache for model: ${model}`);
      
      const results = await Promise.all([
        this.embeddingCache.invalidateEmbeddingsByModel(model),
        this.responseCache.invalidateResponsesByModel(model)
      ]);
      
      const totalInvalidated = results.reduce((sum, count) => sum + count, 0);
      this.stats.invalidations += totalInvalidated;
      
      logger.info(`Invalidated ${totalInvalidated} cache entries for model: ${model}`);
      this.emit('modelInvalidated', { model, count: totalInvalidated });
      
      return totalInvalidated;
    } catch (error) {
      logger.error(`Failed to invalidate model cache: ${model}`, error);
      return 0;
    }
  }

  /**
   * Clear all caches
   */
  async clearAllCaches() {
    try {
      logger.info('Clearing all caches...');
      
      const results = await Promise.all([
        this.queryCache.clear(),
        this.embeddingCache.clear(),
        this.responseCache.clear()
      ]);
      
      const totalCleared = results.reduce((sum, count) => sum + count, 0);
      
      logger.info(`Cleared ${totalCleared} cache entries`);
      this.emit('allCachesCleared', { count: totalCleared });
      
      return totalCleared;
    } catch (error) {
      logger.error('Failed to clear all caches:', error);
      return 0;
    }
  }

  /**
   * Get comprehensive cache statistics
   */
  async getStats() {
    try {
      const [queryStats, embeddingStats, responseStats] = await Promise.all([
        this.queryCache.getQueryStats(),
        this.embeddingCache.getEmbeddingStats(),
        this.responseCache.getResponseStats()
      ]);

      return {
        overall: {
          isInitialized: this.isInitialized,
          isConnected: this._isConnected,
          totalOperations: this.stats.totalOperations,
          invalidations: this.stats.invalidations,
          warmupOperations: this.stats.warmupOperations
        },
        query: queryStats,
        embedding: embeddingStats,
        response: responseStats,
        summary: {
          totalHits: queryStats.hits + embeddingStats.hits + responseStats.hits,
          totalMisses: queryStats.misses + embeddingStats.misses + responseStats.misses,
          overallHitRate: this.calculateOverallHitRate(queryStats, embeddingStats, responseStats),
          memoryUsage: {
            query: queryStats.memory.size,
            embedding: embeddingStats.memory.size,
            response: responseStats.memory.size,
            total: queryStats.memory.size + embeddingStats.memory.size + responseStats.memory.size
          }
        }
      };
    } catch (error) {
      logger.error('Failed to get cache statistics:', error);
      return {
        overall: { isInitialized: this.isInitialized, isConnected: this._isConnected },
        error: error.message
      };
    }
  }

  /**
   * Calculate overall hit rate across all caches
   */
  calculateOverallHitRate(queryStats, embeddingStats, responseStats) {
    const totalHits = queryStats.hits + embeddingStats.hits + responseStats.hits;
    const totalRequests = totalHits + queryStats.misses + embeddingStats.misses + responseStats.misses;
    
    return totalRequests > 0 ? totalHits / totalRequests : 0;
  }

  /**
   * Health check for all cache systems
   */
  async healthCheck() {
    try {
      const caches = {};
      let overallStatus = 'healthy';

      // Check query cache health
      try {
        caches.query = await this.queryCache.healthCheck();
      } catch (error) {
        caches.query = { status: 'error', error: error.message };
        overallStatus = 'unhealthy';
      }

      // Check embedding cache health
      try {
        caches.embedding = await this.embeddingCache.healthCheck();
      } catch (error) {
        caches.embedding = { status: 'error', error: error.message };
        overallStatus = 'unhealthy';
      }

      // Check response cache health
      try {
        caches.response = await this.responseCache.healthCheck();
      } catch (error) {
        caches.response = { status: 'error', error: error.message };
        overallStatus = 'unhealthy';
      }

      // Check if any cache is unhealthy
      if (Object.values(caches).some(cache => cache.status !== 'healthy')) {
        overallStatus = 'unhealthy';
      }

      return {
        status: overallStatus,
        caches,
        overall: {
          initialized: this.isInitialized,
          connected: this._isConnected
        },
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error('Cache health check failed:', error);
      return {
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Shutdown all cache managers
   */
  async shutdown() {
    try {
      logger.info('Shutting down CacheIntegration...');
      
      const shutdownPromises = [];
      
      if (this.queryCache && this.queryCache.shutdown) {
        shutdownPromises.push(
          this.queryCache.shutdown().catch(error => {
            logger.warn('Failed to shutdown query cache:', error);
          })
        );
      }
      
      if (this.embeddingCache && this.embeddingCache.shutdown) {
        shutdownPromises.push(
          this.embeddingCache.shutdown().catch(error => {
            logger.warn('Failed to shutdown embedding cache:', error);
          })
        );
      }
      
      if (this.responseCache && this.responseCache.shutdown) {
        shutdownPromises.push(
          this.responseCache.shutdown().catch(error => {
            logger.warn('Failed to shutdown response cache:', error);
          })
        );
      }
      
      await Promise.all(shutdownPromises);
      
      this.isInitialized = false;
      this._isConnected = false;
      
      logger.info('CacheIntegration shutdown complete');
      this.emit('shutdown', {
        caches: ['query', 'embedding', 'response'],
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Error during CacheIntegration shutdown:', error);
      this.emit('error', error);
    }
  }

  /**
   * Get individual cache managers for direct access
   */
  getCacheManagers() {
    return {
      query: this.queryCache,
      embedding: this.embeddingCache,
      response: this.responseCache
    };
  }

  /**
   * Get query cache manager
   */
  getQueryCache() {
    return this.isInitialized ? this.queryCache : null;
  }

  /**
   * Get embedding cache manager
   */
  getEmbeddingCache() {
    return this.isInitialized ? this.embeddingCache : null;
  }

  /**
   * Get response cache manager
   */
  getResponseCache() {
    return this.isInitialized ? this.responseCache : null;
  }

  /**
   * Invalidate caches when a document is updated
   */
  async invalidateOnDocumentUpdate(documentId) {
    try {
      const results = {
        queries: 0,
        embeddings: 0,
        responses: 0,
        total: 0
      };

      // Invalidate queries related to the document
      if (this.queryCache && this.queryCache.invalidateQueriesBySource) {
        try {
          const queryResult = await this.queryCache.invalidateQueriesBySource(documentId);
          results.queries = queryResult || 0;
        } catch (error) {
          logger.warn('Failed to invalidate queries for document:', documentId, error);
          this.emit('cache-error', {
            operation: 'invalidateOnDocumentUpdate',
            error: error
          });
        }
      }

      // Invalidate embeddings for the document
      if (this.embeddingCache && this.embeddingCache.invalidateDocumentEmbeddings) {
        try {
          const embeddingResult = await this.embeddingCache.invalidateDocumentEmbeddings(documentId);
          results.embeddings = embeddingResult || 0;
        } catch (error) {
          logger.warn('Failed to invalidate embeddings for document:', documentId, error);
          this.emit('cache-error', {
            operation: 'invalidateOnDocumentUpdate',
            error: error
          });
        }
      }

      // Invalidate responses related to the document
      if (this.responseCache && this.responseCache.invalidateDocumentEnrichments) {
        try {
          const responseResult = await this.responseCache.invalidateDocumentEnrichments(documentId);
          results.responses = responseResult || 0;
        } catch (error) {
          logger.warn('Failed to invalidate responses for document:', documentId, error);
          this.emit('cache-error', {
            operation: 'invalidateOnDocumentUpdate',
            error: error
          });
        }
      }

      results.total = results.queries + results.embeddings + results.responses;
      this.stats.invalidations++;
      
      this.emit('documentInvalidated', {
        documentId,
        results,
        timestamp: new Date().toISOString()
      });

      return results;
    } catch (error) {
      logger.error('Failed to invalidate caches for document:', documentId, error);
      this.emit('cache-error', {
        operation: 'invalidateOnDocumentUpdate',
        documentId,
        error: error
      });
      
      return {
        queries: 0,
        embeddings: 0,
        responses: 0,
        total: 0
      };
    }
  }

  /**
   * Get aggregated statistics from all cache managers
   */
  async getAggregatedStats() {
    try {
      const stats = {
        queries: {},
        embeddings: {},
        responses: {},
        overall: {
          totalOperations: this.stats.totalOperations,
          invalidations: this.stats.invalidations,
          warmupOperations: this.stats.warmupOperations,
          totalHits: 0,
          totalMisses: 0,
          overallHitRate: 0
        }
      };

      // If not initialized, return empty stats
      if (!this.isInitialized) {
        return stats;
      }

      // Get query cache stats
      if (this.queryCache && this.queryCache.getQueryStats) {
        try {
          stats.queries = await this.queryCache.getQueryStats();
        } catch (error) {
          logger.warn('Failed to get query cache stats:', error);
          stats.queries = {};
        }
      } else {
        // If query cache is missing, return empty stats
        stats.queries = {};
      }

      // Get embedding cache stats
      if (this.embeddingCache && this.embeddingCache.getEmbeddingStats) {
        try {
          stats.embeddings = await this.embeddingCache.getEmbeddingStats();
        } catch (error) {
          logger.warn('Failed to get embedding cache stats:', error);
          stats.embeddings = {};
        }
      } else {
        // If embedding cache is missing, return empty stats
        stats.embeddings = {};
      }

      // Get response cache stats
      if (this.responseCache && this.responseCache.getResponseStats) {
        try {
          stats.responses = await this.responseCache.getResponseStats();
        } catch (error) {
          logger.warn('Failed to get response cache stats:', error);
          stats.responses = {};
        }
      } else {
        // If response cache is missing, return empty stats
        stats.responses = {};
      }

      // Only calculate overall statistics if we have valid cache managers
      if (this.queryCache && this.embeddingCache && this.responseCache) {
        // Calculate overall statistics
        const queryHits = stats.queries.hits || 0;
        const queryMisses = stats.queries.misses || 0;
        const embeddingHits = stats.embeddings.hits || 0;
        const embeddingMisses = stats.embeddings.misses || 0;
        const responseHits = stats.responses.hits || 0;
        const responseMisses = stats.responses.misses || 0;

        stats.overall.totalHits = queryHits + embeddingHits + responseHits;
        stats.overall.totalMisses = queryMisses + embeddingMisses + responseMisses;
        
        const totalRequests = stats.overall.totalHits + stats.overall.totalMisses;
        stats.overall.overallHitRate = totalRequests > 0 ? stats.overall.totalHits / totalRequests : 0;
      }

      return stats;
    } catch (error) {
      logger.error('Failed to get aggregated stats:', error);
      return {
        queries: {},
        embeddings: {},
        responses: {},
        overall: {
          totalOperations: this.stats.totalOperations,
          invalidations: this.stats.invalidations,
          warmupOperations: this.stats.warmupOperations,
          totalHits: 0,
          totalMisses: 0,
          overallHitRate: 0
        }
      };
    }
  }

  /**
   * Invalidate caches when a source is updated
   */
  async invalidateOnSourceUpdate(sourceId) {
    try {
      const results = {
        queries: 0,
        total: 0
      };

      // Invalidate queries related to the source
      if (this.queryCache && this.queryCache.invalidateQueriesBySource) {
        try {
          const queryResult = await this.queryCache.invalidateQueriesBySource(sourceId);
          results.queries = queryResult || 0;
          results.total += results.queries;
        } catch (error) {
          logger.warn('Failed to invalidate queries for source:', sourceId, error);
        }
      }

      this.stats.invalidations++;
      
      this.emit('sourceInvalidated', {
        sourceId,
        results,
        timestamp: new Date().toISOString()
      });

      return results;
    } catch (error) {
      logger.error('Failed to invalidate caches for source:', sourceId, error);
      this.emit('cache-error', {
        operation: 'invalidateOnSourceUpdate',
        sourceId,
        error: error.message
      });
      
      return {
        queries: 0,
        total: 0
      };
    }
  }

  /**
   * Invalidate caches when a model is updated
   */
  async invalidateOnModelUpdate(model) {
    try {
      const results = {
        embeddings: 0,
        responses: 0,
        total: 0
      };

      // Invalidate embeddings for the model
      if (this.embeddingCache && this.embeddingCache.invalidateEmbeddingsByModel) {
        try {
          const embeddingResult = await this.embeddingCache.invalidateEmbeddingsByModel(model);
          results.embeddings = embeddingResult || 0;
          results.total += results.embeddings;
        } catch (error) {
          logger.warn('Failed to invalidate embeddings for model:', model, error);
        }
      }

      // Invalidate responses for the model
      if (this.responseCache && this.responseCache.invalidateResponsesByModel) {
        try {
          const responseResult = await this.responseCache.invalidateResponsesByModel(model);
          results.responses = responseResult || 0;
          results.total += results.responses;
        } catch (error) {
          logger.warn('Failed to invalidate responses for model:', model, error);
        }
      }

      this.stats.invalidations++;
      
      this.emit('modelInvalidated', {
        model,
        results,
        timestamp: new Date().toISOString()
      });

      return results;
    } catch (error) {
      logger.error('Failed to invalidate caches for model:', model, error);
      this.emit('cache-error', {
        operation: 'invalidateOnModelUpdate',
        model,
        error: error.message
      });
      
      return {
        embeddings: 0,
        responses: 0,
        total: 0
      };
    }
  }

  /**
   * Warm all caches with provided data
   */
  async warmAllCaches(warmingData = {}) {
    try {
      const results = {
        queries: [],
        embeddings: [],
        responses: []
      };

      // Warm query cache
      if (warmingData.queries && this.queryCache && this.queryCache.warmQueryCache) {
        try {
          results.queries = await this.queryCache.warmQueryCache(warmingData.queries);
        } catch (error) {
          logger.warn('Failed to warm query cache:', error);
          results.queries = [];
        }
      }

      // Warm embedding cache
      if (warmingData.embeddings && this.embeddingCache && this.embeddingCache.warmEmbeddingCache) {
        try {
          results.embeddings = await this.embeddingCache.warmEmbeddingCache(warmingData.embeddings);
        } catch (error) {
          logger.warn('Failed to warm embedding cache:', error);
          results.embeddings = [];
        }
      }

      // Warm response cache
      if (warmingData.responses && this.responseCache && this.responseCache.warmResponseCache) {
        try {
          results.responses = await this.responseCache.warmResponseCache(warmingData.responses);
        } catch (error) {
          logger.warn('Failed to warm response cache:', error);
          results.responses = [];
        }
      }

      const totalWarmed = results.queries.length + results.embeddings.length + results.responses.length;
      this.stats.warmupOperations += totalWarmed;

      this.emit('cacheWarmed', {
        results,
        totalWarmed,
        timestamp: new Date().toISOString()
      });

      return results;
    } catch (error) {
      logger.error('Failed to warm caches:', error);
      this.emit('cache-error', {
        operation: 'warmAllCaches',
        error: error.message
      });
      
      return {
        queries: [],
        embeddings: [],
        responses: []
      };
    }
  }

}

module.exports = CacheIntegration;
