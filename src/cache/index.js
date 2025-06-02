/**
 * Cache Module for TheWell Pipeline
 * 
 * Provides multi-level caching capabilities including:
 * - Query result caching
 * - Document embedding caching
 * - LLM response caching
 * - Intelligent cache invalidation
 * - Cache warming strategies
 */

const CacheManager = require('./CacheManager');
const QueryCache = require('./QueryCache');
const EmbeddingCache = require('./EmbeddingCache');
const ResponseCache = require('./ResponseCache');
const CacheIntegration = require('./CacheIntegration');

module.exports = {
  CacheManager,
  QueryCache,
  EmbeddingCache,
  ResponseCache,
  CacheIntegration,
  
  /**
   * Create a unified cache integration instance
   */
  createCacheIntegration: (config = {}) => {
    return new CacheIntegration(config);
  },
  
  /**
   * Create individual cache managers
   */
  createQueryCache: (config = {}) => {
    return new QueryCache(config);
  },
  
  createEmbeddingCache: (config = {}) => {
    return new EmbeddingCache(config);
  },
  
  createResponseCache: (config = {}) => {
    return new ResponseCache(config);
  },
  
  /**
   * Default cache configuration
   */
  defaultConfig: {
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      password: process.env.REDIS_PASSWORD,
      db: 1 // Use different DB than QueueManager
    },
    ttl: {
      queryResults: 3600, // 1 hour
      searchResults: 1800, // 30 minutes
      embeddings: 86400, // 24 hours
      responses: 1800, // 30 minutes
      enrichments: 3600, // 1 hour
      summaries: 7200, // 2 hours
      translations: 86400, // 24 hours
      default: 3600
    },
    maxMemoryUsage: '100mb',
    evictionPolicy: 'allkeys-lru',
    enableCompression: true,
    invalidation: {
      onDocumentUpdate: true,
      onSourceUpdate: true,
      onModelUpdate: true
    },
    warmup: {
      enabled: true,
      queries: [],
      responses: []
    }
  }
};
