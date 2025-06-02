/**
 * Parallel Search Manager
 * Optimizes RAG search performance through parallel processing
 */

const logger = require('../../utils/logger');

class ParallelSearchManager {
  constructor(options = {}) {
    this.documentRetriever = options.documentRetriever;
    this.embeddingService = options.embeddingService;
    this.maxConcurrency = options.maxConcurrency || 3;
    this.timeoutMs = options.timeoutMs || 5000;
    this.isInitialized = false;
  }

  /**
   * Initialize the parallel search manager
   */
  async initialize() {
    try {
      logger.info('Initializing Parallel Search Manager...');
      
      if (!this.documentRetriever) {
        throw new Error('Document retriever is required');
      }
      
      this.isInitialized = true;
      logger.info('Parallel Search Manager initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Parallel Search Manager:', error);
      throw error;
    }
  }

  /**
   * Perform optimized parallel search
   * @param {string} query - The search query
   * @param {Object} filters - Search filters
   * @param {Object} userAuth - User authentication data
   * @returns {Array} Combined search results (compatible with DocumentRetriever.retrieve)
   */
  async performParallelSearch(query, filters = {}, userAuth = null) {
    const startTime = Date.now();
    
    try {
      if (!this.isInitialized) {
        throw new Error('Parallel Search Manager not initialized');
      }

      // Validate inputs
      if (!query || typeof query !== 'string' || query.trim().length === 0) {
        throw new Error('Query is required');
      }

      if (!userAuth || !userAuth.userId) {
        throw new Error('User authentication is required');
      }

      logger.debug('Starting parallel search', {
        userId: userAuth?.userId,
        queryLength: query.length,
        filtersCount: Object.keys(filters).length
      });

      // Create promises for parallel execution
      const searchPromises = [];
      
      // 1. Generate query embedding (required for vector search)
      const embeddingPromise = this.generateQueryEmbeddingWithTimeout(query);
      searchPromises.push(embeddingPromise);

      // 2. Start keyword search immediately (doesn't need embedding)
      const keywordPromise = this.performKeywordSearchWithTimeout(query, filters, userAuth);
      searchPromises.push(keywordPromise);

      // Wait for embedding to complete, then start vector search
      const [queryEmbedding, keywordResults] = await Promise.allSettled([
        embeddingPromise,
        keywordPromise
      ]);

      // Handle embedding result
      let embedding = null;
      if (queryEmbedding.status === 'fulfilled') {
        embedding = queryEmbedding.value;
      } else {
        logger.warn('Embedding generation failed, falling back to keyword-only search', {
          error: queryEmbedding.reason?.message
        });
      }

      // Start vector search if embedding is available
      let vectorResults = [];
      if (embedding) {
        try {
          const vectorPromise = this.performVectorSearchWithTimeout(embedding, filters, userAuth);
          const vectorResult = await Promise.race([
            vectorPromise,
            this.createTimeoutPromise('Vector search timeout')
          ]);
          
          if (vectorResult && !vectorResult.timeout) {
            vectorResults = vectorResult;
          }
        } catch (error) {
          logger.warn('Vector search failed:', error);
        }
      }

      // Get keyword results
      const keywordResultsArray = keywordResults.status === 'fulfilled' ? keywordResults.value : [];

      // Combine and rank results using DocumentRetriever's logic
      const combinedResults = await this.documentRetriever.combineResults(vectorResults, keywordResultsArray);
      
      // Apply visibility filtering
      const visibleResults = await this.documentRetriever.applyVisibilityFiltering(combinedResults, userAuth);
      
      // Limit results and add metadata
      const maxResults = filters.limit || this.documentRetriever.maxResults || 10;
      const finalResults = visibleResults
        .slice(0, maxResults)
        .map(doc => this.documentRetriever.enrichDocument(doc, query));

      // Calculate performance metrics
      const totalTime = Date.now() - startTime;
      const parallelEfficiency = this.calculateParallelEfficiency(
        keywordResultsArray.length,
        vectorResults.length,
        totalTime
      );

      logger.debug('Parallel search completed', {
        userId: userAuth?.userId,
        totalTime,
        keywordResults: keywordResultsArray.length,
        vectorResults: vectorResults.length,
        finalResults: finalResults.length,
        efficiency: parallelEfficiency
      });

      return finalResults;

    } catch (error) {
      logger.error('Parallel search failed:', error);
      throw error;
    }
  }

  /**
   * Generate query embedding with timeout
   * @param {string} query - The search query
   * @returns {Promise<Array>} Query embedding vector
   */
  async generateQueryEmbeddingWithTimeout(query) {
    const startTime = Date.now();
    
    try {
      const embedding = await Promise.race([
        this.documentRetriever.generateQueryEmbedding(query),
        this.createTimeoutPromise('Embedding generation timeout')
      ]);
      
      const duration = Date.now() - startTime;
      logger.debug('Query embedding generated', { duration });
      
      return embedding;
    } catch (error) {
      logger.warn('Query embedding generation failed:', error);
      throw error;
    }
  }

  /**
   * Perform vector search with timeout
   * @param {Array} queryEmbedding - Query embedding vector
   * @param {Object} filters - Search filters
   * @param {Object} userAuth - User authentication data
   * @returns {Promise<Array>} Vector search results
   */
  async performVectorSearchWithTimeout(queryEmbedding, filters, userAuth) {
    const startTime = Date.now();
    
    try {
      const results = await Promise.race([
        this.documentRetriever.performVectorSearch(queryEmbedding, filters, userAuth),
        this.createTimeoutPromise('Vector search timeout')
      ]);
      
      const duration = Date.now() - startTime;
      logger.debug('Vector search completed', { duration, resultsCount: results.length });
      
      return results;
    } catch (error) {
      logger.warn('Vector search failed:', error);
      return [];
    }
  }

  /**
   * Perform keyword search with timeout
   * @param {string} query - The search query
   * @param {Object} filters - Search filters
   * @param {Object} userAuth - User authentication data
   * @returns {Promise<Array>} Keyword search results
   */
  async performKeywordSearchWithTimeout(query, filters, userAuth) {
    const startTime = Date.now();
    
    try {
      const results = await Promise.race([
        this.documentRetriever.performKeywordSearch(query, filters, userAuth),
        this.createTimeoutPromise('Keyword search timeout')
      ]);
      
      const duration = Date.now() - startTime;
      logger.debug('Keyword search completed', { duration, resultsCount: results.length });
      
      return results;
    } catch (error) {
      logger.warn('Keyword search failed:', error);
      return [];
    }
  }

  /**
   * Create a timeout promise
   * @param {string} message - Timeout message
   * @returns {Promise} Timeout promise
   */
  createTimeoutPromise(message) {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(message));
      }, this.timeoutMs);
    });
  }

  /**
   * Calculate parallel processing efficiency
   * @param {number} keywordCount - Number of keyword results
   * @param {number} vectorCount - Number of vector results
   * @param {number} totalTime - Total processing time
   * @returns {number} Efficiency score (0-1)
   */
  calculateParallelEfficiency(keywordCount, vectorCount, totalTime) {
    // Simple efficiency calculation based on results per time
    const totalResults = keywordCount + vectorCount;
    const resultsPerMs = totalResults / totalTime;
    
    // Normalize to 0-1 scale (assuming 1 result per 100ms is baseline)
    const baselineEfficiency = 0.01; // 1 result per 100ms
    return Math.min(resultsPerMs / baselineEfficiency, 1.0);
  }

  /**
   * Get performance statistics
   * @returns {Object} Performance statistics
   */
  getPerformanceStats() {
    return {
      maxConcurrency: this.maxConcurrency,
      timeoutMs: this.timeoutMs,
      isInitialized: this.isInitialized
    };
  }

  /**
   * Get status information
   * @returns {Object} Status information
   */
  async getStatus() {
    return {
      initialized: this.isInitialized,
      documentRetriever: this.documentRetriever ? 'available' : 'missing',
      maxConcurrency: this.maxConcurrency,
      timeoutMs: this.timeoutMs
    };
  }

  /**
   * Shutdown the parallel search manager
   */
  async shutdown() {
    this.isInitialized = false;
  }
}

module.exports = ParallelSearchManager;