/**
 * Search Service
 * 
 * Service layer for search functionality, integrating with embedding service,
 * cache management, and search analytics.
 */

const { Pool } = require('pg');
const logger = require('../utils/logger');
const IntelligentSearchEngine = require('../search/IntelligentSearchEngine');
const EmbeddingService = require('../enrichment/EmbeddingService');
const CacheManager = require('../cache/CacheManager');

class SearchService {
  constructor(config = {}) {
    this.config = {
      database: config.database || {},
      embedding: config.embedding || {},
      cache: config.cache || {},
      analytics: {
        enabled: config.analytics?.enabled !== false,
        batchSize: config.analytics?.batchSize || 100,
        flushInterval: config.analytics?.flushInterval || 60000, // 1 minute
        ...config.analytics
      },
      indexing: {
        batchSize: config.indexing?.batchSize || 50,
        updateInterval: config.indexing?.updateInterval || 300000, // 5 minutes
        ...config.indexing
      },
      ...config
    };
    
    this.pool = null;
    this.searchEngine = null;
    this.embeddingService = null;
    this.cacheManager = null;
    this.analyticsQueue = [];
    this.analyticsTimer = null;
    this.indexUpdateTimer = null;
    this.isInitialized = false;
  }

  /**
   * Initialize the search service
   */
  async initialize() {
    try {
      logger.info('Initializing SearchService...');
      
      // Initialize database connection
      this.pool = new Pool(this.config.database);
      
      // Initialize embedding service
      if (this.config.embedding.apiKey) {
        this.embeddingService = new EmbeddingService(this.config.embedding);
      }
      
      // Initialize cache manager
      this.cacheManager = new CacheManager(this.config.cache);
      await this.cacheManager.initialize();
      
      // Initialize search engine
      this.searchEngine = new IntelligentSearchEngine({
        database: this.config.database,
        embeddingApiKey: this.config.embedding.apiKey,
        embeddingModel: this.config.embedding.model,
        cache: this.config.cache,
        ...this.config.searchEngine
      });
      await this.searchEngine.initialize();
      
      // Start analytics processing if enabled
      if (this.config.analytics.enabled) {
        this.startAnalyticsProcessor();
      }
      
      // Start index update processor
      this.startIndexUpdateProcessor();
      
      this.isInitialized = true;
      logger.info('SearchService initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize SearchService:', error);
      throw error;
    }
  }

  /**
   * Main search method
   */
  async search(query, options = {}) {
    if (!this.isInitialized) {
      throw new Error('SearchService not initialized');
    }
    
    try {
      // Perform search using the search engine
      const results = await this.searchEngine.search(query, options);
      
      // Track search interaction
      if (options.userId && this.config.analytics.enabled) {
        this.trackSearchInteraction({
          userId: options.userId,
          query,
          resultCount: results.total,
          timestamp: new Date()
        });
      }
      
      return results;
    } catch (error) {
      logger.error('Search error:', error);
      throw error;
    }
  }

  /**
   * Get search suggestions
   */
  async getSuggestions(query, options = {}) {
    try {
      const cacheKey = `suggestions:${query}:${options.limit || 10}`;
      
      // Check cache
      const cached = await this.cacheManager.get(cacheKey);
      if (cached) {
        return cached;
      }
      
      // Get suggestions from search engine
      const suggestions = await this.searchEngine.getSuggestions(query, options.limit);
      
      // Cache suggestions
      await this.cacheManager.set(cacheKey, suggestions, { ttl: 300 }); // 5 minutes
      
      return suggestions;
    } catch (error) {
      logger.error('Failed to get suggestions:', error);
      return [];
    }
  }

  /**
   * Index a document for search
   */
  async indexDocument(documentId, document) {
    try {
      logger.debug(`Indexing document ${documentId}`);
      
      // Generate embeddings if enabled
      let embedding = null;
      if (this.embeddingService && document.content) {
        embedding = await this.embeddingService.generateEmbedding(
          `${document.title} ${document.content}`.substring(0, 8000)
        );
      }
      
      // Prepare search index data
      const indexData = {
        document_id: documentId,
        title_tokens: this.generateTsvector(document.title),
        content_tokens: this.generateTsvector(document.content),
        summary_tokens: this.generateTsvector(document.summary),
        author_normalized: this.normalizeAuthor(document.author),
        tags: document.tags || [],
        categories: document.categories || [],
        entities: document.entities || {},
        published_date: document.published_at,
        published_year: document.published_at ? new Date(document.published_at).getFullYear() : null,
        published_month: document.published_at ? new Date(document.published_at).getMonth() + 1 : null,
        quality_score: document.quality_score,
        believability_score: document.believability_score
      };
      
      // Insert or update search index
      const query = `
        INSERT INTO search_indexes (
          document_id, title_tokens, content_tokens, summary_tokens,
          author_normalized, tags, categories, entities,
          published_date, published_year, published_month,
          quality_score, believability_score, last_indexed_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
        ON CONFLICT (document_id) DO UPDATE SET
          title_tokens = EXCLUDED.title_tokens,
          content_tokens = EXCLUDED.content_tokens,
          summary_tokens = EXCLUDED.summary_tokens,
          author_normalized = EXCLUDED.author_normalized,
          tags = EXCLUDED.tags,
          categories = EXCLUDED.categories,
          entities = EXCLUDED.entities,
          published_date = EXCLUDED.published_date,
          published_year = EXCLUDED.published_year,
          published_month = EXCLUDED.published_month,
          quality_score = EXCLUDED.quality_score,
          believability_score = EXCLUDED.believability_score,
          last_indexed_at = NOW()
      `;
      
      await this.pool.query(query, [
        indexData.document_id,
        indexData.title_tokens,
        indexData.content_tokens,
        indexData.summary_tokens,
        indexData.author_normalized,
        indexData.tags,
        indexData.categories,
        indexData.entities,
        indexData.published_date,
        indexData.published_year,
        indexData.published_month,
        indexData.quality_score,
        indexData.believability_score
      ]);
      
      // Update document embedding if generated
      if (embedding) {
        await this.pool.query(
          'UPDATE documents SET embedding = $1, embedding_model = $2 WHERE id = $3',
          [JSON.stringify(embedding), this.embeddingService.config.model, documentId]
        );
      }
      
      logger.info(`Document ${documentId} indexed successfully`);
      return true;
    } catch (error) {
      logger.error(`Failed to index document ${documentId}:`, error);
      throw error;
    }
  }

  /**
   * Batch index multiple documents
   */
  async batchIndexDocuments(documents) {
    const results = [];
    const batches = this.chunkArray(documents, this.config.indexing.batchSize);
    
    for (const batch of batches) {
      const batchResults = await Promise.allSettled(
        batch.map(doc => this.indexDocument(doc.id, doc))
      );
      
      results.push(...batchResults);
    }
    
    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;
    
    logger.info(`Batch indexing complete: ${successful} successful, ${failed} failed`);
    
    return {
      total: documents.length,
      successful,
      failed,
      results
    };
  }

  /**
   * Update search analytics
   */
  async updateSearchAnalytics() {
    try {
      const date = new Date();
      const hour = date.getHours();
      
      // Get analytics for current hour
      const analyticsQuery = `
        SELECT 
          COUNT(DISTINCT id) as total_queries,
          COUNT(DISTINCT user_id) as unique_users,
          AVG(LENGTH(query_text)) as avg_query_length,
          AVG(execution_time_ms) as avg_execution_time,
          AVG(result_count) as avg_result_count,
          COUNT(CASE WHEN result_count = 0 THEN 1 END) as zero_result_queries
        FROM search_queries
        WHERE 
          DATE(created_at) = CURRENT_DATE AND
          EXTRACT(HOUR FROM created_at) = $1
      `;
      
      const analyticsResult = await this.pool.query(analyticsQuery, [hour]);
      const analytics = analyticsResult.rows[0];
      
      // Get popular queries
      const popularQuery = `
        SELECT 
          query_text,
          COUNT(*) as count,
          AVG(result_count) as avg_results
        FROM search_queries
        WHERE 
          DATE(created_at) = CURRENT_DATE AND
          EXTRACT(HOUR FROM created_at) = $1
        GROUP BY query_text
        ORDER BY count DESC
        LIMIT 100
      `;
      
      const popularResult = await this.pool.query(popularQuery, [hour]);
      
      // Update or insert analytics
      const updateQuery = `
        INSERT INTO search_analytics (
          date, hour, total_queries, unique_users, avg_query_length,
          avg_execution_time_ms, avg_result_count, zero_result_queries,
          popular_queries
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (date, hour) DO UPDATE SET
          total_queries = EXCLUDED.total_queries,
          unique_users = EXCLUDED.unique_users,
          avg_query_length = EXCLUDED.avg_query_length,
          avg_execution_time_ms = EXCLUDED.avg_execution_time_ms,
          avg_result_count = EXCLUDED.avg_result_count,
          zero_result_queries = EXCLUDED.zero_result_queries,
          popular_queries = EXCLUDED.popular_queries,
          updated_at = NOW()
      `;
      
      await this.pool.query(updateQuery, [
        date.toISOString().split('T')[0],
        hour,
        analytics.total_queries || 0,
        analytics.unique_users || 0,
        analytics.avg_query_length || 0,
        analytics.avg_execution_time || 0,
        analytics.avg_result_count || 0,
        analytics.zero_result_queries || 0,
        JSON.stringify(popularResult.rows)
      ]);
      
      logger.debug('Search analytics updated');
    } catch (error) {
      logger.error('Failed to update search analytics:', error);
    }
  }

  /**
   * Update search facets
   */
  async updateSearchFacets() {
    try {
      const facetTypes = ['content_type', 'author', 'tags', 'quality'];
      
      for (const facetType of facetTypes) {
        let facetQuery;
        
        switch (facetType) {
          case 'content_type':
            facetQuery = `
              SELECT 
                content_type as value,
                COUNT(*) as count
              FROM documents
              WHERE visibility != 'private'
              GROUP BY content_type
              ORDER BY count DESC
            `;
            break;
            
          case 'author':
            facetQuery = `
              SELECT 
                author as value,
                COUNT(*) as count
              FROM documents
              WHERE author IS NOT NULL AND visibility != 'private'
              GROUP BY author
              ORDER BY count DESC
              LIMIT 50
            `;
            break;
            
          case 'tags':
            facetQuery = `
              SELECT 
                UNNEST(tags) as value,
                COUNT(*) as count
              FROM search_indexes si
              JOIN documents d ON si.document_id = d.id
              WHERE tags IS NOT NULL AND visibility != 'private'
              GROUP BY value
              ORDER BY count DESC
              LIMIT 100
            `;
            break;
            
          case 'quality':
            facetQuery = `
              SELECT 
                CASE 
                  WHEN quality_score >= 0.8 THEN 'high'
                  WHEN quality_score >= 0.5 THEN 'medium'
                  ELSE 'low'
                END as value,
                COUNT(*) as count
              FROM documents
              WHERE quality_score IS NOT NULL AND visibility != 'private'
              GROUP BY value
              ORDER BY 
                CASE value
                  WHEN 'high' THEN 1
                  WHEN 'medium' THEN 2
                  WHEN 'low' THEN 3
                END
            `;
            break;
        }
        
        const result = await this.pool.query(facetQuery);
        
        // Update facets table
        await this.pool.query(
          `INSERT INTO search_facets (facet_name, facet_type, facet_values, last_computed_at)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (facet_name) DO UPDATE SET
             facet_values = EXCLUDED.facet_values,
             last_computed_at = NOW()`,
          [facetType, facetType, JSON.stringify(result.rows)]
        );
      }
      
      logger.debug('Search facets updated');
    } catch (error) {
      logger.error('Failed to update search facets:', error);
    }
  }

  /**
   * Track user click on search result
   */
  async trackSearchClick(queryId, documentId, userId) {
    try {
      // Update search query with clicked result
      await this.pool.query(
        `UPDATE search_queries 
         SET clicked_results = array_append(clicked_results, $1)
         WHERE id = $2 AND user_id = $3`,
        [documentId, queryId, userId]
      );
      
      // Update document popularity
      await this.pool.query(
        `UPDATE search_indexes 
         SET popularity_score = popularity_score + 0.05
         WHERE document_id = $1`,
        [documentId]
      );
      
      return true;
    } catch (error) {
      logger.error('Failed to track search click:', error);
      return false;
    }
  }

  /**
   * Get search analytics
   */
  async getSearchAnalytics(options = {}) {
    try {
      const { startDate, endDate, groupBy = 'day' } = options;
      
      let query;
      let params = [];
      
      if (groupBy === 'hour') {
        query = `
          SELECT 
            date,
            hour,
            total_queries,
            unique_users,
            avg_query_length,
            avg_execution_time_ms,
            zero_result_queries,
            click_through_rate
          FROM search_analytics
          WHERE 1=1
        `;
      } else {
        query = `
          SELECT 
            date,
            SUM(total_queries) as total_queries,
            SUM(unique_users) as unique_users,
            AVG(avg_query_length) as avg_query_length,
            AVG(avg_execution_time_ms) as avg_execution_time_ms,
            SUM(zero_result_queries) as zero_result_queries,
            AVG(click_through_rate) as click_through_rate
          FROM search_analytics
          WHERE 1=1
        `;
      }
      
      if (startDate) {
        params.push(startDate);
        query += ` AND date >= $${params.length}`;
      }
      
      if (endDate) {
        params.push(endDate);
        query += ` AND date <= $${params.length}`;
      }
      
      if (groupBy !== 'hour') {
        query += ' GROUP BY date';
      }
      
      query += ' ORDER BY date DESC';
      
      const result = await this.pool.query(query, params);
      
      return result.rows;
    } catch (error) {
      logger.error('Failed to get search analytics:', error);
      throw error;
    }
  }

  /**
   * Generate tsvector for full-text search
   */
  generateTsvector(text) {
    if (!text) return null;
    // This would typically be done in PostgreSQL, but we return the text
    // and let PostgreSQL convert it to tsvector
    return text;
  }

  /**
   * Normalize author name
   */
  normalizeAuthor(author) {
    if (!author) return null;
    return author.toLowerCase().replace(/[^\w\s]/g, '').trim();
  }

  /**
   * Track search interaction for analytics
   */
  trackSearchInteraction(interaction) {
    this.analyticsQueue.push(interaction);
    
    // Flush if queue is full
    if (this.analyticsQueue.length >= this.config.analytics.batchSize) {
      this.flushAnalytics();
    }
  }

  /**
   * Start analytics processor
   */
  startAnalyticsProcessor() {
    // Set up periodic analytics flush
    this.analyticsTimer = setInterval(() => {
      this.flushAnalytics();
      this.updateSearchAnalytics();
    }, this.config.analytics.flushInterval);
  }

  /**
   * Start index update processor
   */
  startIndexUpdateProcessor() {
    // Set up periodic index updates
    this.indexUpdateTimer = setInterval(() => {
      this.updateSearchFacets();
    }, this.config.indexing.updateInterval);
  }

  /**
   * Flush analytics queue
   */
  async flushAnalytics() {
    if (this.analyticsQueue.length === 0) return;
    
    const queue = [...this.analyticsQueue];
    this.analyticsQueue = [];
    
    try {
      // Process analytics queue
      // This could involve aggregating data and updating various analytics tables
      logger.debug(`Flushed ${queue.length} analytics events`);
    } catch (error) {
      logger.error('Failed to flush analytics:', error);
      // Re-add failed items to queue
      this.analyticsQueue.unshift(...queue);
    }
  }

  /**
   * Chunk array into smaller arrays
   */
  chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Get service status
   */
  async getStatus() {
    try {
      const status = {
        initialized: this.isInitialized,
        searchEngine: this.searchEngine ? 'ready' : 'not initialized',
        embeddingService: this.embeddingService ? 'ready' : 'not configured',
        cacheManager: this.cacheManager ? await this.cacheManager.healthCheck() : null,
        analytics: {
          enabled: this.config.analytics.enabled,
          queueSize: this.analyticsQueue.length
        }
      };
      
      // Check database connection
      try {
        await this.pool.query('SELECT 1');
        status.database = 'connected';
      } catch (error) {
        status.database = 'disconnected';
      }
      
      return status;
    } catch (error) {
      logger.error('Failed to get service status:', error);
      return {
        initialized: this.isInitialized,
        error: error.message
      };
    }
  }

  /**
   * Shutdown the search service
   */
  async shutdown() {
    try {
      logger.info('Shutting down SearchService...');
      
      // Stop timers
      if (this.analyticsTimer) {
        clearInterval(this.analyticsTimer);
      }
      
      if (this.indexUpdateTimer) {
        clearInterval(this.indexUpdateTimer);
      }
      
      // Flush remaining analytics
      await this.flushAnalytics();
      
      // Shutdown components
      if (this.searchEngine) {
        await this.searchEngine.shutdown();
      }
      
      if (this.cacheManager) {
        await this.cacheManager.shutdown();
      }
      
      if (this.pool) {
        await this.pool.end();
      }
      
      this.isInitialized = false;
      logger.info('SearchService shutdown complete');
    } catch (error) {
      logger.error('Error during SearchService shutdown:', error);
      throw error;
    }
  }
}

module.exports = SearchService;