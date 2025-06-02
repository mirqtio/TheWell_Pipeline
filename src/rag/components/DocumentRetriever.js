/**
 * Document Retriever
 * Handles document retrieval using hybrid search (vector + keyword)
 */

const logger = require('../../utils/logger');

class DocumentRetriever {
  constructor(options = {}) {
    this.databaseManager = options.databaseManager;
    this.visibilityDatabase = options.visibilityDatabase;
    this.maxResults = options.maxResults || 10;
    this.similarityThreshold = options.similarityThreshold || 0.7;
    this.isInitialized = false;
  }

  /**
   * Initialize the Document Retriever
   */
  async initialize() {
    try {
      logger.info('Initializing Document Retriever...');
      
      if (!this.databaseManager) {
        throw new Error('Database manager is required');
      }
      
      this.isInitialized = true;
      logger.info('Document Retriever initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Document Retriever:', error);
      throw error;
    }
  }

  /**
   * Retrieve relevant documents for a query
   * @param {string} query - The search query
   * @param {Object} filters - Search filters
   * @param {Object} userAuth - User authentication data
   * @returns {Array} Retrieved documents
   */
  async retrieve(query, filters, userAuth) {
    try {
      logger.debug('Retrieving documents', {
        userId: userAuth.userId,
        queryLength: query.length,
        filtersCount: Object.keys(filters).length
      });

      // Generate query embedding for vector search
      const queryEmbedding = await this.generateQueryEmbedding(query);
      
      // Perform hybrid search
      const vectorResults = await this.performVectorSearch(queryEmbedding, filters, userAuth);
      const keywordResults = await this.performKeywordSearch(query, filters, userAuth);
      
      // Combine and rank results
      const combinedResults = await this.combineResults(vectorResults, keywordResults);
      
      // Apply visibility filtering
      const visibleResults = await this.applyVisibilityFiltering(combinedResults, userAuth);
      
      // Limit results and add metadata
      const finalResults = visibleResults
        .slice(0, this.maxResults)
        .map(doc => this.enrichDocument(doc, query));
      
      logger.debug('Documents retrieved successfully', {
        userId: userAuth.userId,
        totalFound: finalResults.length,
        vectorResults: vectorResults.length,
        keywordResults: keywordResults.length
      });
      
      return finalResults;
      
    } catch (error) {
      logger.error('Failed to retrieve documents:', error);
      throw error;
    }
  }

  /**
   * Generate embedding for the query
   * @param {string} query - The search query
   * @returns {Array} Query embedding vector
   */
  async generateQueryEmbedding(query) {
    try {
      // For now, return a mock embedding
      // In a real implementation, this would call an embedding service
      const mockEmbedding = new Array(1536).fill(0).map(() => Math.random() - 0.5);
      return mockEmbedding;
    } catch (error) {
      logger.error('Failed to generate query embedding:', error);
      throw error;
    }
  }

  /**
   * Perform vector similarity search
   * @param {Array} queryEmbedding - Query embedding vector
   * @param {Object} filters - Search filters
   * @param {Object} userAuth - User authentication data
   * @returns {Array} Vector search results
   */
  async performVectorSearch(queryEmbedding, filters, userAuth) {
    try {
      // Build the vector search query
      let query = `
        SELECT 
          d.id,
          d.title,
          d.content,
          d.source_url,
          d.content_type,
          d.created_at,
          d.updated_at,
          d.metadata,
          1 - (d.embedding <=> $1::vector) as similarity_score
        FROM documents d
        WHERE d.embedding <=> $1::vector < $2
      `;
      
      const params = [
        JSON.stringify(queryEmbedding),
        1 - this.similarityThreshold
      ];
      let paramIndex = 3;
      
      // Apply filters
      if (filters.sources && filters.sources.length > 0) {
        query += ` AND d.source_url = ANY($${paramIndex})`;
        params.push(filters.sources);
        paramIndex++;
      }
      
      if (filters.contentTypes && filters.contentTypes.length > 0) {
        query += ` AND d.content_type = ANY($${paramIndex})`;
        params.push(filters.contentTypes);
        paramIndex++;
      }
      
      if (filters.dateRange) {
        if (filters.dateRange.start) {
          query += ` AND d.created_at >= $${paramIndex}`;
          params.push(filters.dateRange.start);
          paramIndex++;
        }
        if (filters.dateRange.end) {
          query += ` AND d.created_at <= $${paramIndex}`;
          params.push(filters.dateRange.end);
          paramIndex++;
        }
      }
      
      query += ` ORDER BY similarity_score DESC LIMIT ${this.maxResults * 2}`;
      
      const result = await this.databaseManager.query(query, params);
      return result.rows || [];
      
    } catch (error) {
      logger.error('Vector search failed:', error);
      // Return empty results on failure rather than throwing
      return [];
    }
  }

  /**
   * Perform keyword search
   * @param {string} searchQuery - The search query
   * @param {Object} filters - Search filters
   * @param {Object} userAuth - User authentication data
   * @returns {Array} Keyword search results
   */
  async performKeywordSearch(searchQuery, filters, userAuth) {
    try {
      // Build the keyword search query using PostgreSQL full-text search
      let query = `
        SELECT 
          d.id,
          d.title,
          d.content,
          d.source_url,
          d.content_type,
          d.created_at,
          d.updated_at,
          d.metadata,
          ts_rank(to_tsvector('english', d.title || ' ' || d.content), plainto_tsquery('english', $1)) as rank_score
        FROM documents d
        WHERE to_tsvector('english', d.title || ' ' || d.content) @@ plainto_tsquery('english', $1)
      `;
      
      const params = [searchQuery];
      let paramIndex = 2;
      
      // Apply same filters as vector search
      if (filters.sources && filters.sources.length > 0) {
        query += ` AND d.source_url = ANY($${paramIndex})`;
        params.push(filters.sources);
        paramIndex++;
      }
      
      if (filters.contentTypes && filters.contentTypes.length > 0) {
        query += ` AND d.content_type = ANY($${paramIndex})`;
        params.push(filters.contentTypes);
        paramIndex++;
      }
      
      if (filters.dateRange) {
        if (filters.dateRange.start) {
          query += ` AND d.created_at >= $${paramIndex}`;
          params.push(filters.dateRange.start);
          paramIndex++;
        }
        if (filters.dateRange.end) {
          query += ` AND d.created_at <= $${paramIndex}`;
          params.push(filters.dateRange.end);
          paramIndex++;
        }
      }
      
      query += ` ORDER BY rank_score DESC LIMIT ${this.maxResults * 2}`;
      
      const result = await this.databaseManager.query(query, params);
      return result.rows || [];
      
    } catch (error) {
      logger.error('Keyword search failed:', error);
      // Return empty results on failure rather than throwing
      return [];
    }
  }

  /**
   * Combine vector and keyword search results using reciprocal rank fusion
   * @param {Array} vectorResults - Vector search results
   * @param {Array} keywordResults - Keyword search results
   * @returns {Array} Combined and ranked results
   */
  async combineResults(vectorResults, keywordResults) {
    const k = 60; // RRF parameter
    const combinedScores = new Map();
    
    // Process vector results
    vectorResults.forEach((doc, index) => {
      const rrf_score = 1 / (k + index + 1);
      combinedScores.set(doc.id, {
        document: doc,
        vector_rank: index + 1,
        vector_score: doc.similarity_score || 0,
        keyword_rank: null,
        keyword_score: 0,
        combined_score: rrf_score
      });
    });
    
    // Process keyword results
    keywordResults.forEach((doc, index) => {
      const rrf_score = 1 / (k + index + 1);
      
      if (combinedScores.has(doc.id)) {
        // Document found in both searches
        const existing = combinedScores.get(doc.id);
        existing.keyword_rank = index + 1;
        existing.keyword_score = doc.rank_score || 0;
        existing.combined_score += rrf_score;
      } else {
        // Document only in keyword search
        combinedScores.set(doc.id, {
          document: doc,
          vector_rank: null,
          vector_score: 0,
          keyword_rank: index + 1,
          keyword_score: doc.rank_score || 0,
          combined_score: rrf_score
        });
      }
    });
    
    // Sort by combined score and return documents
    return Array.from(combinedScores.values())
      .sort((a, b) => b.combined_score - a.combined_score)
      .map(item => ({
        ...item.document,
        search_metadata: {
          vector_rank: item.vector_rank,
          vector_score: item.vector_score,
          keyword_rank: item.keyword_rank,
          keyword_score: item.keyword_score,
          combined_score: item.combined_score
        }
      }));
  }

  /**
   * Apply visibility filtering based on user permissions
   * @param {Array} documents - Documents to filter
   * @param {Object} userAuth - User authentication data
   * @returns {Array} Filtered documents
   */
  async applyVisibilityFiltering(documents, userAuth) {
    if (!this.visibilityDatabase) {
      // If no visibility database, return all documents
      return documents;
    }
    
    try {
      const visibleDocuments = [];
      
      for (const doc of documents) {
        const isVisible = await this.visibilityDatabase.checkDocumentVisibility(
          doc.id,
          userAuth.userId,
          userAuth.roles || []
        );
        
        if (isVisible) {
          visibleDocuments.push(doc);
        }
      }
      
      return visibleDocuments;
      
    } catch (error) {
      logger.error('Visibility filtering failed:', error);
      // Return all documents if filtering fails
      return documents;
    }
  }

  /**
   * Enrich document with additional metadata
   * @param {Object} document - Document to enrich
   * @param {string} query - Original query
   * @returns {Object} Enriched document
   */
  enrichDocument(document, query) {
    return {
      ...document,
      retrieval_metadata: {
        retrieved_at: new Date().toISOString(),
        query_used: query,
        relevance_score: document.search_metadata?.combined_score || 0
      }
    };
  }

  /**
   * Get retriever status
   */
  async getStatus() {
    return {
      initialized: this.isInitialized,
      maxResults: this.maxResults,
      similarityThreshold: this.similarityThreshold,
      databaseConnected: !!this.databaseManager,
      visibilityEnabled: !!this.visibilityDatabase,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Shutdown the retriever
   */
  async shutdown() {
    logger.info('Shutting down Document Retriever...');
    this.isInitialized = false;
  }
}

module.exports = DocumentRetriever;
