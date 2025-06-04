/**
 * Database Query Optimizer
 * Optimizes database queries for improved RAG system performance
 */

const logger = require('../../utils/logger');

class DatabaseOptimizer {
  constructor(options = {}) {
    this.databaseManager = options.databaseManager;
    this.enableQueryCaching = options.enableQueryCaching !== false;
    this.cacheSize = options.cacheSize || 1000;
    this.cacheTTL = options.cacheTTL || 300000; // 5 minutes
    
    // Query cache
    this.queryCache = new Map();
    this.cacheStats = {
      hits: 0,
      misses: 0,
      evictions: 0
    };

    // Performance tracking
    this.queryMetrics = {
      totalQueries: 0,
      averageQueryTime: 0,
      slowQueries: [],
      slowQueryThreshold: 1000 // 1 second
    };

    this.isInitialized = false;
    this.cleanupInterval = null;
  }

  /**
   * Initialize the database optimizer
   */
  async initialize() {
    try {
      logger.info('Initializing Database Optimizer...', {
        enableQueryCaching: this.enableQueryCaching,
        cacheSize: this.cacheSize,
        cacheTTL: this.cacheTTL
      });
      
      if (!this.databaseManager) {
        throw new Error('Database manager is required');
      }

      // Create optimized indexes if they don't exist
      await this.createOptimizedIndexes();

      // Start cache cleanup interval
      if (this.enableQueryCaching) {
        this.cleanupInterval = setInterval(() => {
          this.cleanupExpiredCache();
        }, 60000); // Clean up every minute
      }

      this.isInitialized = true;
      logger.info('Database Optimizer initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Database Optimizer:', error);
      throw error;
    }
  }

  /**
   * Create optimized database indexes
   */
  async createOptimizedIndexes() {
    try {
      logger.info('Creating optimized database indexes...');

      const indexQueries = [
        // Document embeddings index for vector similarity search
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_document_embeddings_vector 
         ON document_embeddings USING ivfflat (embedding vector_cosine_ops) 
         WITH (lists = 100)`,

        // Document visibility index for permission filtering
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_document_visibility_user_group 
         ON document_visibility (user_id, group_id, visibility_level)`,

        // Document metadata index for filtering
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_documents_metadata_gin 
         ON documents USING gin (metadata)`,

        // Document content index for full-text search
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_documents_content_fts 
         ON documents USING gin (to_tsvector('english', content))`,

        // Document enrichments index for enriched content search
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_document_enrichments_result_gin 
         ON document_enrichments USING gin (result)`,

        // Jobs index for status and dependency queries
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_jobs_status_created_at 
         ON jobs (status, created_at DESC)`,

        // Jobs dependencies index
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_job_dependencies_parent_child 
         ON job_dependencies (parent_job_id, child_job_id)`
      ];

      for (const query of indexQueries) {
        try {
          await this.databaseManager.query(query);
          logger.debug('Index created successfully', { 
            query: query.substring(0, 100) + '...' 
          });
        } catch (error) {
          // Ignore "already exists" errors
          if (!error.message.includes('already exists')) {
            logger.warn('Failed to create index:', { error: error.message, query });
          }
        }
      }

      logger.info('Database indexes optimization completed');
    } catch (error) {
      logger.error('Failed to create optimized indexes:', error);
      throw error;
    }
  }

  /**
   * Execute optimized vector similarity search
   * @param {Array} queryEmbedding - Query embedding vector
   * @param {Object} filters - Search filters
   * @param {number} limit - Maximum results to return
   * @returns {Promise<Array>} Search results
   */
  async executeOptimizedVectorSearch(queryEmbedding, filters = {}, limit = 10) {
    const startTime = Date.now();
    const cacheKey = this.generateCacheKey('vector_search', { queryEmbedding, filters, limit });

    try {
      // Check cache first
      if (this.enableQueryCaching) {
        const cached = this.getFromCache(cacheKey);
        if (cached) {
          this.cacheStats.hits++;
          return cached;
        }
        this.cacheStats.misses++;
      }

      // Build optimized query with proper indexes
      const query = `
        SELECT 
          d.id,
          d.title,
          d.content,
          d.metadata,
          de.embedding <=> $1::vector as similarity_score
        FROM documents d
        INNER JOIN document_embeddings de ON d.id = de.document_id
        ${this.buildVisibilityFilter(filters)}
        ${this.buildMetadataFilter(filters)}
        ORDER BY de.embedding <=> $1::vector
        LIMIT $${this.getNextParamIndex(filters)}
      `;

      const params = [JSON.stringify(queryEmbedding)];
      this.addFilterParams(params, filters);
      params.push(limit);

      const result = await this.databaseManager.query(query, params);
      
      // Cache the result
      if (this.enableQueryCaching) {
        this.setCache(cacheKey, result.rows);
      }

      // Track performance
      this.trackQueryPerformance('vector_search', startTime, query);

      return result.rows;

    } catch (error) {
      logger.error('Optimized vector search failed:', error);
      throw error;
    }
  }

  /**
   * Execute optimized keyword search
   * @param {string} query - Search query
   * @param {Object} filters - Search filters
   * @param {number} limit - Maximum results to return
   * @returns {Promise<Array>} Search results
   */
  async executeOptimizedKeywordSearch(query, filters = {}, limit = 10) {
    const startTime = Date.now();
    const cacheKey = this.generateCacheKey('keyword_search', { query, filters, limit });

    try {
      // Check cache first
      if (this.enableQueryCaching) {
        const cached = this.getFromCache(cacheKey);
        if (cached) {
          this.cacheStats.hits++;
          return cached;
        }
        this.cacheStats.misses++;
      }

      // Build optimized full-text search query
      const searchQuery = `
        SELECT 
          d.id,
          d.title,
          d.content,
          d.metadata,
          ts_rank(to_tsvector('english', d.content), plainto_tsquery('english', $1)) as rank_score
        FROM documents d
        ${this.buildVisibilityFilter(filters)}
        ${this.buildMetadataFilter(filters)}
        WHERE to_tsvector('english', d.content) @@ plainto_tsquery('english', $1)
        ORDER BY rank_score DESC
        LIMIT $${this.getNextParamIndex(filters)}
      `;

      const params = [query];
      this.addFilterParams(params, filters);
      params.push(limit);

      const result = await this.databaseManager.query(searchQuery, params);
      
      // Cache the result
      if (this.enableQueryCaching) {
        this.setCache(cacheKey, result.rows);
      }

      // Track performance
      this.trackQueryPerformance('keyword_search', startTime, searchQuery);

      return result.rows;

    } catch (error) {
      logger.error('Optimized keyword search failed:', error);
      throw error;
    }
  }

  /**
   * Execute optimized document retrieval with enrichments
   * @param {Array} documentIds - Document IDs to retrieve
   * @returns {Promise<Array>} Documents with enrichments
   */
  async executeOptimizedDocumentRetrieval(documentIds) {
    const startTime = Date.now();
    const cacheKey = this.generateCacheKey('document_retrieval', { documentIds });

    try {
      // Check cache first
      if (this.enableQueryCaching) {
        const cached = this.getFromCache(cacheKey);
        if (cached) {
          this.cacheStats.hits++;
          return cached;
        }
        this.cacheStats.misses++;
      }

      // Optimized query with JOIN to get enrichments in single query
      const query = `
        SELECT 
          d.id,
          d.title,
          d.content,
          d.metadata,
          d.created_at,
          d.updated_at,
          COALESCE(
            json_agg(
              json_build_object(
                'type', de.enrichment_type,
                'result', de.result,
                'created_at', de.created_at
              )
            ) FILTER (WHERE de.id IS NOT NULL),
            '[]'::json
          ) as enrichments
        FROM documents d
        LEFT JOIN document_enrichments de ON d.id = de.document_id
        WHERE d.id = ANY($1::uuid[])
        GROUP BY d.id, d.title, d.content, d.metadata, d.created_at, d.updated_at
        ORDER BY d.created_at DESC
      `;

      const result = await this.databaseManager.query(query, [documentIds]);
      
      // Cache the result
      if (this.enableQueryCaching) {
        this.setCache(cacheKey, result.rows);
      }

      // Track performance
      this.trackQueryPerformance('document_retrieval', startTime, query);

      return result.rows;

    } catch (error) {
      logger.error('Optimized document retrieval failed:', error);
      throw error;
    }
  }

  /**
   * Build visibility filter for queries
   * @param {Object} filters - Search filters
   * @returns {string} SQL WHERE clause
   */
  buildVisibilityFilter(filters) {
    if (!filters.userAuth) {
      return '';
    }

    return `
      INNER JOIN document_visibility dv ON d.id = dv.document_id
      WHERE (
        dv.visibility_level = 'public' OR
        dv.user_id = $${this.getNextParamIndex(filters, 'userId')} OR
        dv.group_id = ANY($${this.getNextParamIndex(filters, 'groupIds')}::text[])
      )
    `;
  }

  /**
   * Build metadata filter for queries
   * @param {Object} filters - Search filters
   * @returns {string} SQL WHERE clause
   */
  buildMetadataFilter(filters) {
    if (!filters.metadata || Object.keys(filters.metadata).length === 0) {
      return '';
    }

    const conditions = [];
    for (const [key, _value] of Object.entries(filters.metadata)) {
      conditions.push(`d.metadata->>'${key}' = $${this.getNextParamIndex(filters, `metadata_${key}`)}`);
    }

    const whereClause = filters.userAuth ? 'AND' : 'WHERE';
    return `${whereClause} (${conditions.join(' AND ')})`;
  }

  /**
   * Add filter parameters to query params array
   * @param {Array} params - Query parameters array
   * @param {Object} filters - Search filters
   */
  addFilterParams(params, filters) {
    if (filters.userAuth) {
      params.push(filters.userAuth.userId);
      params.push(filters.userAuth.groupIds || []);
    }

    if (filters.metadata) {
      for (const value of Object.values(filters.metadata)) {
        params.push(value);
      }
    }
  }

  /**
   * Get next parameter index for query building
   * @param {Object} filters - Search filters
   * @param {string} type - Parameter type
   * @returns {number} Next parameter index
   */
  getNextParamIndex(filters, _type = null) {
    let index = 2; // Start from 2 (after the main query parameter)
    
    if (filters.userAuth) {
      index += 2; // userId and groupIds
    }
    
    if (filters.metadata) {
      index += Object.keys(filters.metadata).length;
    }

    return index;
  }

  /**
   * Generate cache key for query
   * @param {string} queryType - Type of query
   * @param {Object} params - Query parameters
   * @returns {string} Cache key
   */
  generateCacheKey(queryType, params) {
    const key = JSON.stringify({ queryType, ...params });
    return Buffer.from(key).toString('base64').substring(0, 50);
  }

  /**
   * Get result from cache
   * @param {string} key - Cache key
   * @returns {*} Cached result or null
   */
  getFromCache(key) {
    const cached = this.queryCache.get(key);
    if (!cached) return null;

    if (Date.now() > cached.expiresAt) {
      this.queryCache.delete(key);
      return null;
    }

    return cached.data;
  }

  /**
   * Set result in cache
   * @param {string} key - Cache key
   * @param {*} data - Data to cache
   */
  setCache(key, data) {
    if (this.queryCache.size >= this.cacheSize) {
      // Remove oldest entry
      const firstKey = this.queryCache.keys().next().value;
      this.queryCache.delete(firstKey);
      this.cacheStats.evictions++;
    }

    this.queryCache.set(key, {
      data,
      expiresAt: Date.now() + this.cacheTTL
    });
  }

  /**
   * Clean up expired cache entries
   */
  cleanupExpiredCache() {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, cached] of this.queryCache.entries()) {
      if (now > cached.expiresAt) {
        this.queryCache.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug('Cleaned up expired cache entries', { cleaned });
    }
  }

  /**
   * Track query performance
   * @param {string} queryType - Type of query
   * @param {number} startTime - Query start time
   * @param {string} query - SQL query
   */
  trackQueryPerformance(queryType, startTime, query) {
    const duration = Date.now() - startTime;
    
    this.queryMetrics.totalQueries++;
    
    // Update average query time
    const totalTime = this.queryMetrics.averageQueryTime * (this.queryMetrics.totalQueries - 1) + duration;
    this.queryMetrics.averageQueryTime = totalTime / this.queryMetrics.totalQueries;

    // Track slow queries
    if (duration > this.queryMetrics.slowQueryThreshold) {
      this.queryMetrics.slowQueries.push({
        queryType,
        duration,
        query: query.substring(0, 200) + '...',
        timestamp: new Date().toISOString()
      });

      // Keep only last 50 slow queries
      if (this.queryMetrics.slowQueries.length > 50) {
        this.queryMetrics.slowQueries = this.queryMetrics.slowQueries.slice(-50);
      }

      logger.warn('Slow query detected', { queryType, duration, threshold: this.queryMetrics.slowQueryThreshold });
    }

    logger.debug('Query performance tracked', { queryType, duration });
  }

  /**
   * Get performance metrics
   * @returns {Object} Performance metrics
   */
  getPerformanceMetrics() {
    return {
      ...this.queryMetrics,
      cacheStats: this.cacheStats,
      cacheSize: this.queryCache.size,
      cacheHitRate: this.cacheStats.hits / (this.cacheStats.hits + this.cacheStats.misses) || 0
    };
  }

  /**
   * Get health status
   * @returns {Object} Health status
   */
  async getStatus() {
    return {
      initialized: this.isInitialized,
      enableQueryCaching: this.enableQueryCaching,
      cacheSize: this.cacheSize,
      cacheTTL: this.cacheTTL,
      databaseManager: this.databaseManager ? 'available' : 'missing',
      cacheStats: {
        size: this.queryCache.size,
        maxSize: this.cacheSize,
        hitRate: this.cacheStats.hits / (this.cacheStats.hits + this.cacheStats.misses) || 0,
        hits: this.cacheStats.hits,
        misses: this.cacheStats.misses
      },
      performanceMetrics: {
        totalQueries: this.queryMetrics.totalQueries,
        cacheHits: this.cacheStats.hits,
        cacheMisses: this.cacheStats.misses,
        cacheHitRate: this.cacheStats.hits / (this.cacheStats.hits + this.cacheStats.misses) || 0,
        averageQueryTime: this.queryMetrics.averageQueryTime,
        totalQueryTime: this.queryMetrics.averageQueryTime * this.queryMetrics.totalQueries
      }
    };
  }

  /**
   * Shutdown the optimizer
   */
  async shutdown() {
    logger.info('Shutting down Database Optimizer...');
    
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    this.queryCache.clear();
    this.isInitialized = false;

    logger.info('Database Optimizer shutdown complete');
  }

  /**
   * Optimized vector search (wrapper for executeOptimizedVectorSearch)
   * @param {Array} queryEmbedding - Query embedding vector
   * @param {Object} filters - Search filters
   * @param {Object} userAuth - User authentication data
   * @param {number} limit - Maximum results to return
   * @returns {Promise<Array>} Search results
   */
  async optimizedVectorSearch(queryEmbedding, filters = {}, _userAuth = null, limit = 10) {
    return this.executeOptimizedVectorSearch(queryEmbedding, filters, limit);
  }

  /**
   * Optimized keyword search (wrapper for executeOptimizedKeywordSearch)
   * @param {string} query - Search query
   * @param {Object} filters - Search filters
   * @param {Object} userAuth - User authentication data
   * @param {number} limit - Maximum results to return
   * @returns {Promise<Array>} Search results
   */
  async optimizedKeywordSearch(query, filters = {}, _userAuth = null, limit = 10) {
    return this.executeOptimizedKeywordSearch(query, filters, limit);
  }

  /**
   * Get query performance metrics (wrapper for getPerformanceMetrics)
   * @returns {Object} Performance metrics
   */
  getQueryPerformanceMetrics() {
    return {
      totalQueries: this.queryMetrics.totalQueries,
      cacheHits: this.cacheStats.hits,
      cacheMisses: this.cacheStats.misses,
      cacheHitRate: this.cacheStats.hits / (this.cacheStats.hits + this.cacheStats.misses) || 0,
      averageQueryTime: this.queryMetrics.averageQueryTime,
      totalQueryTime: this.queryMetrics.averageQueryTime * this.queryMetrics.totalQueries
    };
  }

  /**
   * Get cache statistics
   * @returns {Object} Cache statistics
   */
  getCacheStats() {
    return {
      size: this.queryCache.size,
      maxSize: this.cacheSize,
      hits: this.cacheStats.hits,
      misses: this.cacheStats.misses,
      hitRate: this.cacheStats.hits / (this.cacheStats.hits + this.cacheStats.misses) || 0
    };
  }

  /**
   * Clear the cache
   */
  clearCache() {
    this.queryCache.clear();
    this.cacheStats.hits = 0;
    this.cacheStats.misses = 0;
    this.cacheStats.evictions = 0;
  }
}

module.exports = DatabaseOptimizer;