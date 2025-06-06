/**
 * Intelligent Search Engine
 * 
 * Provides advanced search capabilities including semantic search,
 * fuzzy matching, synonym expansion, and multi-field weighted scoring.
 */

const { Pool } = require('pg');
const logger = require('../utils/logger');
const EmbeddingService = require('../enrichment/EmbeddingService');
const CacheManager = require('../cache/CacheManager');

class IntelligentSearchEngine {
  constructor(config = {}) {
    this.config = {
      // Database configuration
      database: config.database || {},
      
      // Search configuration
      search: {
        defaultLimit: config.search?.defaultLimit || 20,
        maxLimit: config.search?.maxLimit || 100,
        minScore: config.search?.minScore || 0.3,
        fuzzyThreshold: config.search?.fuzzyThreshold || 0.7,
        semanticWeight: config.search?.semanticWeight || 0.6,
        exactWeight: config.search?.exactWeight || 0.4,
        ...config.search
      },
      
      // Field weights for scoring
      fieldWeights: {
        title: config.fieldWeights?.title || 2.0,
        content: config.fieldWeights?.content || 1.0,
        summary: config.fieldWeights?.summary || 1.5,
        tags: config.fieldWeights?.tags || 1.2,
        author: config.fieldWeights?.author || 0.8,
        ...config.fieldWeights
      },
      
      // Feature flags
      features: {
        enableSemanticSearch: config.features?.enableSemanticSearch !== false,
        enableFuzzyMatching: config.features?.enableFuzzyMatching !== false,
        enableSynonymExpansion: config.features?.enableSynonymExpansion !== false,
        enableFaceting: config.features?.enableFaceting !== false,
        enableHighlighting: config.features?.enableHighlighting !== false,
        ...config.features
      },
      
      ...config
    };
    
    this.pool = null;
    this.embeddingService = null;
    this.cacheManager = null;
    this.synonymCache = new Map();
    this.isInitialized = false;
  }

  /**
   * Initialize the search engine
   */
  async initialize() {
    try {
      logger.info('Initializing IntelligentSearchEngine...');
      
      // Initialize database connection
      this.pool = new Pool(this.config.database);
      
      // Initialize embedding service if semantic search is enabled
      if (this.config.features.enableSemanticSearch && this.config.embeddingApiKey) {
        this.embeddingService = new EmbeddingService({
          apiKey: this.config.embeddingApiKey,
          model: this.config.embeddingModel || 'text-embedding-3-small'
        });
      }
      
      // Initialize cache manager if provided
      if (this.config.cache) {
        this.cacheManager = new CacheManager(this.config.cache);
        await this.cacheManager.initialize();
      }
      
      // Load synonyms into cache
      if (this.config.features.enableSynonymExpansion) {
        await this.loadSynonyms();
      }
      
      this.isInitialized = true;
      logger.info('IntelligentSearchEngine initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize IntelligentSearchEngine:', error);
      throw error;
    }
  }

  /**
   * Main search method supporting multiple search modes
   */
  async search(query, options = {}) {
    try {
      const startTime = Date.now();
      
      // Validate and prepare search parameters
      const searchParams = this.prepareSearchParams(query, options);
      
      // Check cache first
      const cacheKey = this.generateCacheKey(searchParams);
      if (this.cacheManager) {
        const cached = await this.cacheManager.get(cacheKey);
        if (cached) {
          logger.debug('Search cache hit:', cacheKey);
          return cached;
        }
      }
      
      // Execute search based on mode
      let results;
      switch (searchParams.mode) {
      case 'semantic':
        results = await this.semanticSearch(searchParams);
        break;
      case 'exact':
        results = await this.exactSearch(searchParams);
        break;
      case 'fuzzy':
        results = await this.fuzzySearch(searchParams);
        break;
      case 'hybrid':
      default:
        results = await this.hybridSearch(searchParams);
      }
      
      // Apply post-processing
      results = await this.postProcessResults(results, searchParams);
      
      // Track search query for analytics
      await this.trackSearchQuery(searchParams, results, Date.now() - startTime);
      
      // Cache results
      if (this.cacheManager && results.items.length > 0) {
        await this.cacheManager.set(cacheKey, results, {
          ttl: this.config.search.cacheTtl || 300 // 5 minutes
        });
      }
      
      return results;
    } catch (error) {
      logger.error('Search error:', error);
      throw error;
    }
  }

  /**
   * Prepare and validate search parameters
   */
  prepareSearchParams(query, options) {
    const params = {
      query: query.trim(),
      mode: options.mode || 'hybrid',
      filters: options.filters || {},
      facets: options.facets || [],
      sort: options.sort || { field: 'relevance', order: 'desc' },
      limit: Math.min(options.limit || this.config.search.defaultLimit, this.config.search.maxLimit),
      offset: options.offset || 0,
      highlight: options.highlight !== false && this.config.features.enableHighlighting,
      includeFacets: options.includeFacets !== false && this.config.features.enableFaceting,
      userId: options.userId
    };
    
    // Normalize query
    params.normalizedQuery = this.normalizeQuery(params.query);
    
    // Expand query with synonyms if enabled
    if (this.config.features.enableSynonymExpansion) {
      params.expandedQuery = this.expandQueryWithSynonyms(params.normalizedQuery);
    }
    
    return params;
  }

  /**
   * Hybrid search combining semantic and keyword search
   */
  async hybridSearch(params) {
    const [semanticResults, keywordResults] = await Promise.all([
      this.config.features.enableSemanticSearch && this.embeddingService
        ? this.semanticSearch(params)
        : { items: [], total: 0 },
      this.keywordSearch(params)
    ]);
    
    // Merge and re-rank results
    const mergedResults = this.mergeSearchResults(
      semanticResults.items,
      keywordResults.items,
      {
        semanticWeight: this.config.search.semanticWeight,
        keywordWeight: this.config.search.exactWeight
      }
    );
    
    // Apply limit and offset
    const paginatedResults = mergedResults.slice(
      params.offset,
      params.offset + params.limit
    );
    
    return {
      items: paginatedResults,
      total: mergedResults.length,
      facets: semanticResults.facets || keywordResults.facets,
      mode: 'hybrid'
    };
  }

  /**
   * Semantic search using vector embeddings
   */
  async semanticSearch(params) {
    if (!this.embeddingService) {
      throw new Error('Semantic search requires embedding service configuration');
    }
    
    // Generate query embedding
    const queryEmbedding = await this.embeddingService.generateEmbedding(params.query);
    
    // Build and execute semantic search query
    const searchQuery = `
      WITH semantic_search AS (
        SELECT 
          d.id,
          d.title,
          d.content,
          d.url,
          d.author,
          d.published_at,
          d.metadata,
          d.quality_score,
          d.believability_score,
          d.embedding <=> $1::vector AS distance,
          1 - (d.embedding <=> $1::vector) AS similarity_score
        FROM documents d
        LEFT JOIN search_indexes si ON d.id = si.document_id
        WHERE d.embedding IS NOT NULL
          ${this.buildFilterClause(params.filters, 2)}
        ORDER BY distance
        LIMIT $${this.getNextParamIndex(params.filters)} * 2
      )
      SELECT 
        *,
        similarity_score AS relevance_score
      FROM semantic_search
      WHERE similarity_score >= $${this.getNextParamIndex(params.filters) + 1}
      ${this.buildSortClause(params.sort)}
      LIMIT $${this.getNextParamIndex(params.filters) + 2}
      OFFSET $${this.getNextParamIndex(params.filters) + 3}
    `;
    
    const queryParams = [
      JSON.stringify(queryEmbedding),
      ...this.buildFilterParams(params.filters),
      params.limit,
      this.config.search.minScore,
      params.limit,
      params.offset
    ];
    
    const result = await this.pool.query(searchQuery, queryParams);
    
    return {
      items: result.rows,
      total: result.rows.length,
      mode: 'semantic'
    };
  }

  /**
   * Keyword-based search using full-text search
   */
  async keywordSearch(params) {
    const searchQuery = `
      WITH keyword_search AS (
        SELECT 
          d.id,
          d.title,
          d.content,
          d.url,
          d.author,
          d.published_at,
          d.metadata,
          d.quality_score,
          d.believability_score,
          si.search_vector,
          ts_rank_cd(si.search_vector, query) AS rank,
          ts_headline('english', d.title, query, 'StartSel=<mark>, StopSel=</mark>') AS highlighted_title,
          ts_headline('english', d.content, query, 'MaxWords=30, StartSel=<mark>, StopSel=</mark>') AS highlighted_content
        FROM documents d
        JOIN search_indexes si ON d.id = si.document_id,
        plainto_tsquery('english', $1) query
        WHERE si.search_vector @@ query
          ${this.buildFilterClause(params.filters, 2)}
      )
      SELECT 
        *,
        rank AS relevance_score
      FROM keyword_search
      ${this.buildSortClause(params.sort)}
      LIMIT $${this.getNextParamIndex(params.filters) + 1}
      OFFSET $${this.getNextParamIndex(params.filters) + 2}
    `;
    
    const queryParams = [
      params.expandedQuery || params.normalizedQuery,
      ...this.buildFilterParams(params.filters),
      params.limit,
      params.offset
    ];
    
    const result = await this.pool.query(searchQuery, queryParams);
    
    return {
      items: result.rows,
      total: result.rows.length,
      mode: 'keyword'
    };
  }

  /**
   * Exact match search
   */
  async exactSearch(params) {
    const searchQuery = `
      SELECT 
        d.id,
        d.title,
        d.content,
        d.url,
        d.author,
        d.published_at,
        d.metadata,
        d.quality_score,
        d.believability_score,
        1.0 AS relevance_score
      FROM documents d
      LEFT JOIN search_indexes si ON d.id = si.document_id
      WHERE (
        d.title ILIKE $1 OR
        d.content ILIKE $1 OR
        d.author ILIKE $1 OR
        $1 = ANY(si.tags)
      )
      ${this.buildFilterClause(params.filters, 2)}
      ${this.buildSortClause(params.sort)}
      LIMIT $${this.getNextParamIndex(params.filters) + 1}
      OFFSET $${this.getNextParamIndex(params.filters) + 2}
    `;
    
    const queryParams = [
      `%${params.query}%`,
      ...this.buildFilterParams(params.filters),
      params.limit,
      params.offset
    ];
    
    const result = await this.pool.query(searchQuery, queryParams);
    
    return {
      items: result.rows,
      total: result.rows.length,
      mode: 'exact'
    };
  }

  /**
   * Fuzzy search using trigram similarity
   */
  async fuzzySearch(params) {
    const searchQuery = `
      WITH fuzzy_search AS (
        SELECT 
          d.id,
          d.title,
          d.content,
          d.url,
          d.author,
          d.published_at,
          d.metadata,
          d.quality_score,
          d.believability_score,
          GREATEST(
            similarity(d.title, $1),
            similarity(d.content, $1) * 0.7,
            similarity(d.author, $1) * 0.5
          ) AS similarity
        FROM documents d
        LEFT JOIN search_indexes si ON d.id = si.document_id
        WHERE 
          d.title % $1 OR
          d.content % $1 OR
          d.author % $1
          ${this.buildFilterClause(params.filters, 2)}
      )
      SELECT 
        *,
        similarity AS relevance_score
      FROM fuzzy_search
      WHERE similarity >= $${this.getNextParamIndex(params.filters) + 1}
      ${this.buildSortClause(params.sort)}
      LIMIT $${this.getNextParamIndex(params.filters) + 2}
      OFFSET $${this.getNextParamIndex(params.filters) + 3}
    `;
    
    const queryParams = [
      params.normalizedQuery,
      ...this.buildFilterParams(params.filters),
      this.config.search.fuzzyThreshold,
      params.limit,
      params.offset
    ];
    
    const result = await this.pool.query(searchQuery, queryParams);
    
    return {
      items: result.rows,
      total: result.rows.length,
      mode: 'fuzzy'
    };
  }

  /**
   * Build filter clause for SQL query
   */
  buildFilterClause(filters, startParamIndex) {
    const clauses = [];
    let paramIndex = startParamIndex;
    
    if (filters.author) {
      clauses.push(`d.author ILIKE $${paramIndex++}`);
    }
    
    if (filters.dateFrom) {
      clauses.push(`d.published_at >= $${paramIndex++}`);
    }
    
    if (filters.dateTo) {
      clauses.push(`d.published_at <= $${paramIndex++}`);
    }
    
    if (filters.visibility) {
      clauses.push(`d.visibility = $${paramIndex++}`);
    }
    
    if (filters.minQuality) {
      clauses.push(`d.quality_score >= $${paramIndex++}`);
    }
    
    if (filters.tags && filters.tags.length > 0) {
      clauses.push(`si.tags && $${paramIndex++}`);
    }
    
    if (filters.categories && filters.categories.length > 0) {
      clauses.push(`si.categories && $${paramIndex++}`);
    }
    
    return clauses.length > 0 ? `AND ${clauses.join(' AND ')}` : '';
  }

  /**
   * Build filter parameters array
   */
  buildFilterParams(filters) {
    const params = [];
    
    if (filters.author) {
      params.push(`%${filters.author}%`);
    }
    
    if (filters.dateFrom) {
      params.push(filters.dateFrom);
    }
    
    if (filters.dateTo) {
      params.push(filters.dateTo);
    }
    
    if (filters.visibility) {
      params.push(filters.visibility);
    }
    
    if (filters.minQuality) {
      params.push(filters.minQuality);
    }
    
    if (filters.tags && filters.tags.length > 0) {
      params.push(filters.tags);
    }
    
    if (filters.categories && filters.categories.length > 0) {
      params.push(filters.categories);
    }
    
    return params;
  }

  /**
   * Get next parameter index for query building
   */
  getNextParamIndex(filters) {
    return 2 + this.buildFilterParams(filters).length;
  }

  /**
   * Build sort clause
   */
  buildSortClause(sort) {
    const validSortFields = {
      relevance: 'relevance_score',
      date: 'published_at',
      quality: 'quality_score',
      title: 'title'
    };
    
    const field = validSortFields[sort.field] || 'relevance_score';
    const order = sort.order === 'asc' ? 'ASC' : 'DESC';
    
    return `ORDER BY ${field} ${order}`;
  }

  /**
   * Merge results from different search methods
   */
  mergeSearchResults(semanticResults, keywordResults, weights) {
    const scoreMap = new Map();
    
    // Process semantic results
    semanticResults.forEach(result => {
      scoreMap.set(result.id, {
        ...result,
        finalScore: result.relevance_score * weights.semanticWeight
      });
    });
    
    // Process keyword results
    keywordResults.forEach(result => {
      if (scoreMap.has(result.id)) {
        const existing = scoreMap.get(result.id);
        existing.finalScore += result.relevance_score * weights.keywordWeight;
        existing.highlighted_title = result.highlighted_title || existing.highlighted_title;
        existing.highlighted_content = result.highlighted_content || existing.highlighted_content;
      } else {
        scoreMap.set(result.id, {
          ...result,
          finalScore: result.relevance_score * weights.keywordWeight
        });
      }
    });
    
    // Sort by final score
    return Array.from(scoreMap.values())
      .sort((a, b) => b.finalScore - a.finalScore);
  }

  /**
   * Post-process search results
   */
  async postProcessResults(results, params) {
    // Add facets if requested
    if (params.includeFacets) {
      results.facets = await this.computeFacets(params);
    }
    
    // Update popularity scores
    if (results.items.length > 0) {
      await this.updatePopularityScores(results.items.map(item => item.id));
    }
    
    return results;
  }

  /**
   * Compute facets for filtering
   */
  async computeFacets(params) {
    const facetQuery = `
      SELECT 
        'author' AS facet_type,
        author AS facet_value,
        COUNT(*) AS count
      FROM documents d
      LEFT JOIN search_indexes si ON d.id = si.document_id
      WHERE 1=1 ${this.buildFilterClause(params.filters, 1)}
      GROUP BY author
      
      UNION ALL
      
      SELECT 
        'tag' AS facet_type,
        UNNEST(tags) AS facet_value,
        COUNT(*) AS count
      FROM search_indexes si
      JOIN documents d ON si.document_id = d.id
      WHERE tags IS NOT NULL ${this.buildFilterClause(params.filters, 1)}
      GROUP BY facet_value
      
      UNION ALL
      
      SELECT 
        'category' AS facet_type,
        UNNEST(categories) AS facet_value,
        COUNT(*) AS count
      FROM search_indexes si
      JOIN documents d ON si.document_id = d.id
      WHERE categories IS NOT NULL ${this.buildFilterClause(params.filters, 1)}
      GROUP BY facet_value
      
      ORDER BY facet_type, count DESC
    `;
    
    const result = await this.pool.query(facetQuery, this.buildFilterParams(params.filters));
    
    // Group facets by type
    const facets = {};
    result.rows.forEach(row => {
      if (!facets[row.facet_type]) {
        facets[row.facet_type] = [];
      }
      facets[row.facet_type].push({
        value: row.facet_value,
        count: parseInt(row.count)
      });
    });
    
    return facets;
  }

  /**
   * Load synonyms from database
   */
  async loadSynonyms() {
    try {
      const query = 'SELECT term, synonyms FROM search_synonyms WHERE is_active = true';
      const result = await this.pool.query(query);
      
      this.synonymCache.clear();
      result.rows.forEach(row => {
        this.synonymCache.set(row.term.toLowerCase(), row.synonyms);
      });
      
      logger.info(`Loaded ${this.synonymCache.size} synonym mappings`);
    } catch (error) {
      logger.error('Failed to load synonyms:', error);
    }
  }

  /**
   * Expand query with synonyms
   */
  expandQueryWithSynonyms(query) {
    const words = query.toLowerCase().split(/\s+/);
    const expandedWords = new Set(words);
    
    words.forEach(word => {
      const synonyms = this.synonymCache.get(word);
      if (synonyms) {
        synonyms.forEach(syn => expandedWords.add(syn));
      }
    });
    
    return Array.from(expandedWords).join(' ');
  }

  /**
   * Normalize query text
   */
  normalizeQuery(query) {
    return query
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Generate cache key for search results
   */
  generateCacheKey(params) {
    const keyParts = [
      'search',
      params.mode,
      params.normalizedQuery,
      JSON.stringify(params.filters),
      params.sort.field,
      params.sort.order,
      params.limit,
      params.offset
    ];
    
    return keyParts.join(':');
  }

  /**
   * Track search query for analytics
   */
  async trackSearchQuery(params, results, executionTime) {
    try {
      const query = `
        INSERT INTO search_queries (
          user_id, query_text, query_type, query_params,
          normalized_query, result_count, results_returned,
          execution_time_ms, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      `;
      
      await this.pool.query(query, [
        params.userId || null,
        params.query,
        params.mode,
        JSON.stringify({
          filters: params.filters,
          sort: params.sort
        }),
        params.normalizedQuery,
        results.total,
        results.items.length,
        Math.round(executionTime)
      ]);
    } catch (error) {
      logger.error('Failed to track search query:', error);
    }
  }

  /**
   * Update popularity scores for viewed documents
   */
  async updatePopularityScores(documentIds) {
    if (!documentIds || documentIds.length === 0) return;
    
    try {
      const query = `
        UPDATE search_indexes
        SET popularity_score = popularity_score + 0.01
        WHERE document_id = ANY($1)
      `;
      
      await this.pool.query(query, [documentIds]);
    } catch (error) {
      logger.error('Failed to update popularity scores:', error);
    }
  }

  /**
   * Get search suggestions based on query
   */
  async getSuggestions(query, limit = 10) {
    try {
      const normalizedQuery = this.normalizeQuery(query);
      
      const suggestionQuery = `
        SELECT 
          suggestion_text,
          suggestion_type,
          relevance_score
        FROM search_suggestions
        WHERE 
          is_active = true AND
          suggestion_text ILIKE $1
        ORDER BY 
          frequency DESC,
          relevance_score DESC
        LIMIT $2
      `;
      
      const result = await this.pool.query(suggestionQuery, [
        `${normalizedQuery}%`,
        limit
      ]);
      
      return result.rows;
    } catch (error) {
      logger.error('Failed to get search suggestions:', error);
      return [];
    }
  }

  /**
   * Build complex query with boolean operators
   */
  buildComplexQuery(query) {
    // Parse query for AND, OR, NOT operators
    const operators = {
      AND: ' & ',
      OR: ' | ',
      NOT: ' & !'
    };
    
    let processedQuery = query;
    Object.entries(operators).forEach(([op, tsOp]) => {
      processedQuery = processedQuery.replace(new RegExp(`\\b${op}\\b`, 'gi'), tsOp);
    });
    
    return processedQuery;
  }

  /**
   * Shutdown the search engine
   */
  async shutdown() {
    try {
      logger.info('Shutting down IntelligentSearchEngine...');
      
      if (this.pool) {
        await this.pool.end();
      }
      
      if (this.cacheManager) {
        await this.cacheManager.shutdown();
      }
      
      this.isInitialized = false;
      logger.info('IntelligentSearchEngine shutdown complete');
    } catch (error) {
      logger.error('Error during search engine shutdown:', error);
      throw error;
    }
  }
}

module.exports = IntelligentSearchEngine;