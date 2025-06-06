/**
 * Search API Routes
 * 
 * Provides endpoints for intelligent search functionality including
 * semantic search, faceted filtering, and search analytics.
 */

const express = require('express');
const router = express.Router();
const SearchService = require('../../services/SearchService');
const logger = require('../../utils/logger');
const auth = require('../middleware/auth');

// Initialize search service (this would typically be done in app initialization)
let searchService;

/**
 * Initialize search routes with service instance
 */
function initializeSearchRoutes(serviceInstance) {
  searchService = serviceInstance;
  return router;
}

/**
 * Search documents
 * POST /api/search
 * 
 * Request body:
 * {
 *   "query": "search terms",
 *   "mode": "hybrid|semantic|exact|fuzzy",
 *   "filters": {
 *     "author": "author name",
 *     "dateFrom": "2024-01-01",
 *     "dateTo": "2024-12-31",
 *     "visibility": "public|internal|private",
 *     "minQuality": 0.5,
 *     "tags": ["tag1", "tag2"],
 *     "categories": ["category1", "category2"]
 *   },
 *   "sort": {
 *     "field": "relevance|date|quality|title",
 *     "order": "desc|asc"
 *   },
 *   "facets": ["author", "tags", "categories"],
 *   "highlight": true,
 *   "limit": 20,
 *   "offset": 0
 * }
 */
router.post('/search', auth, async (req, res) => {
  try {
    const {
      query,
      mode = 'hybrid',
      filters = {},
      sort = { field: 'relevance', order: 'desc' },
      facets = [],
      highlight = true,
      limit = 20,
      offset = 0
    } = req.body;
    
    // Validate query
    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return res.status(400).json({
        error: 'Invalid query',
        message: 'Query must be a non-empty string'
      });
    }
    
    // Validate mode
    const validModes = ['hybrid', 'semantic', 'exact', 'fuzzy'];
    if (!validModes.includes(mode)) {
      return res.status(400).json({
        error: 'Invalid search mode',
        message: `Mode must be one of: ${validModes.join(', ')}`
      });
    }
    
    // Validate limit and offset
    const parsedLimit = parseInt(limit);
    const parsedOffset = parseInt(offset);
    
    if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
      return res.status(400).json({
        error: 'Invalid limit',
        message: 'Limit must be between 1 and 100'
      });
    }
    
    if (isNaN(parsedOffset) || parsedOffset < 0) {
      return res.status(400).json({
        error: 'Invalid offset',
        message: 'Offset must be a non-negative integer'
      });
    }
    
    // Perform search
    const results = await searchService.search(query, {
      mode,
      filters,
      sort,
      facets,
      highlight,
      limit: parsedLimit,
      offset: parsedOffset,
      userId: req.user.id,
      includeFacets: facets.length > 0
    });
    
    // Format response
    const response = {
      query,
      mode: results.mode || mode,
      total: results.total,
      limit: parsedLimit,
      offset: parsedOffset,
      items: results.items.map(item => ({
        id: item.id,
        title: highlight && item.highlighted_title ? item.highlighted_title : item.title,
        content: highlight && item.highlighted_content ? item.highlighted_content : item.content?.substring(0, 200) + '...',
        url: item.url,
        author: item.author,
        publishedAt: item.published_at,
        metadata: item.metadata,
        relevanceScore: item.relevance_score || item.finalScore,
        qualityScore: item.quality_score,
        believabilityScore: item.believability_score
      })),
      facets: results.facets || {},
      executionTime: results.executionTime
    };
    
    res.json(response);
  } catch (error) {
    logger.error('Search error:', error);
    res.status(500).json({
      error: 'Search failed',
      message: 'An error occurred while processing your search'
    });
  }
});

/**
 * Get search suggestions
 * GET /api/search/suggestions?q=query&limit=10
 */
router.get('/search/suggestions', async (req, res) => {
  try {
    const { q, limit = 10 } = req.query;
    
    if (!q || q.length < 2) {
      return res.json({ suggestions: [] });
    }
    
    const suggestions = await searchService.getSuggestions(q, {
      limit: Math.min(parseInt(limit) || 10, 20)
    });
    
    res.json({
      query: q,
      suggestions: suggestions.map(s => ({
        text: s.suggestion_text,
        type: s.suggestion_type,
        score: s.relevance_score
      }))
    });
  } catch (error) {
    logger.error('Suggestions error:', error);
    res.status(500).json({
      error: 'Failed to get suggestions',
      suggestions: []
    });
  }
});

/**
 * Advanced search with complex queries
 * POST /api/search/advanced
 * 
 * Supports boolean operators (AND, OR, NOT) and field-specific searches
 */
router.post('/search/advanced', auth, async (req, res) => {
  try {
    const {
      queries,
      operator = 'AND',
      filters = {},
      sort = { field: 'relevance', order: 'desc' },
      limit = 20,
      offset = 0
    } = req.body;
    
    // Validate queries
    if (!Array.isArray(queries) || queries.length === 0) {
      return res.status(400).json({
        error: 'Invalid queries',
        message: 'Queries must be a non-empty array'
      });
    }
    
    // Build complex query
    let complexQuery = '';
    if (operator === 'AND') {
      complexQuery = queries.map(q => `(${q.query})`).join(' AND ');
    } else if (operator === 'OR') {
      complexQuery = queries.map(q => `(${q.query})`).join(' OR ');
    } else {
      return res.status(400).json({
        error: 'Invalid operator',
        message: 'Operator must be AND or OR'
      });
    }
    
    // Perform search
    const results = await searchService.search(complexQuery, {
      mode: 'hybrid',
      filters,
      sort,
      limit: parseInt(limit),
      offset: parseInt(offset),
      userId: req.user.id
    });
    
    res.json({
      queries,
      operator,
      total: results.total,
      limit: parseInt(limit),
      offset: parseInt(offset),
      items: results.items,
      facets: results.facets
    });
  } catch (error) {
    logger.error('Advanced search error:', error);
    res.status(500).json({
      error: 'Advanced search failed',
      message: 'An error occurred while processing your search'
    });
  }
});

/**
 * Track search result click
 * POST /api/search/click
 */
router.post('/search/click', auth, async (req, res) => {
  try {
    const { queryId, documentId } = req.body;
    
    if (!queryId || !documentId) {
      return res.status(400).json({
        error: 'Missing parameters',
        message: 'Both queryId and documentId are required'
      });
    }
    
    await searchService.trackSearchClick(queryId, documentId, req.user.id);
    
    res.json({ success: true });
  } catch (error) {
    logger.error('Click tracking error:', error);
    res.status(500).json({
      error: 'Failed to track click',
      message: 'An error occurred while tracking the click'
    });
  }
});

/**
 * Get search analytics
 * GET /api/search/analytics
 */
router.get('/search/analytics', auth, async (req, res) => {
  try {
    // Check if user has admin role
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Admin access required'
      });
    }
    
    const { startDate, endDate, groupBy = 'day' } = req.query;
    
    const analytics = await searchService.getSearchAnalytics({
      startDate,
      endDate,
      groupBy
    });
    
    res.json({
      period: {
        start: startDate || 'all time',
        end: endDate || 'present',
        groupBy
      },
      data: analytics
    });
  } catch (error) {
    logger.error('Analytics error:', error);
    res.status(500).json({
      error: 'Failed to get analytics',
      message: 'An error occurred while retrieving analytics'
    });
  }
});

/**
 * Get popular searches
 * GET /api/search/popular
 */
router.get('/search/popular', async (req, res) => {
  try {
    const { limit = 10, period = 'day' } = req.query;
    
    // This would typically query the search_analytics table
    // For now, return mock data
    const popularSearches = [
      { query: 'artificial intelligence', count: 250 },
      { query: 'machine learning', count: 180 },
      { query: 'data science', count: 150 },
      { query: 'neural networks', count: 120 },
      { query: 'deep learning', count: 100 }
    ].slice(0, parseInt(limit));
    
    res.json({
      period,
      limit: parseInt(limit),
      searches: popularSearches
    });
  } catch (error) {
    logger.error('Popular searches error:', error);
    res.status(500).json({
      error: 'Failed to get popular searches',
      searches: []
    });
  }
});

/**
 * Get search facets
 * GET /api/search/facets
 */
router.get('/search/facets', async (req, res) => {
  try {
    const { types = ['author', 'tags', 'categories', 'quality'] } = req.query;
    
    // This would typically query the search_facets table
    const facets = {};
    
    if (types.includes('author')) {
      facets.author = [
        { value: 'John Doe', count: 45 },
        { value: 'Jane Smith', count: 38 },
        { value: 'Bob Johnson', count: 27 }
      ];
    }
    
    if (types.includes('tags')) {
      facets.tags = [
        { value: 'technology', count: 120 },
        { value: 'science', count: 95 },
        { value: 'business', count: 78 }
      ];
    }
    
    if (types.includes('categories')) {
      facets.categories = [
        { value: 'Articles', count: 200 },
        { value: 'Reports', count: 150 },
        { value: 'News', count: 100 }
      ];
    }
    
    if (types.includes('quality')) {
      facets.quality = [
        { value: 'high', label: 'High Quality', count: 180 },
        { value: 'medium', label: 'Medium Quality', count: 250 },
        { value: 'low', label: 'Low Quality', count: 70 }
      ];
    }
    
    res.json({ facets });
  } catch (error) {
    logger.error('Facets error:', error);
    res.status(500).json({
      error: 'Failed to get facets',
      facets: {}
    });
  }
});

/**
 * Index a document for search
 * POST /api/search/index
 */
router.post('/search/index', auth, async (req, res) => {
  try {
    // Check if user has admin role
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Admin access required'
      });
    }
    
    const { documentId, document } = req.body;
    
    if (!documentId || !document) {
      return res.status(400).json({
        error: 'Missing parameters',
        message: 'Both documentId and document are required'
      });
    }
    
    await searchService.indexDocument(documentId, document);
    
    res.json({
      success: true,
      documentId,
      message: 'Document indexed successfully'
    });
  } catch (error) {
    logger.error('Indexing error:', error);
    res.status(500).json({
      error: 'Indexing failed',
      message: 'An error occurred while indexing the document'
    });
  }
});

/**
 * Batch index documents
 * POST /api/search/index/batch
 */
router.post('/search/index/batch', auth, async (req, res) => {
  try {
    // Check if user has admin role
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Admin access required'
      });
    }
    
    const { documents } = req.body;
    
    if (!Array.isArray(documents) || documents.length === 0) {
      return res.status(400).json({
        error: 'Invalid documents',
        message: 'Documents must be a non-empty array'
      });
    }
    
    const results = await searchService.batchIndexDocuments(documents);
    
    res.json({
      success: true,
      ...results
    });
  } catch (error) {
    logger.error('Batch indexing error:', error);
    res.status(500).json({
      error: 'Batch indexing failed',
      message: 'An error occurred while indexing documents'
    });
  }
});

/**
 * Get search service status
 * GET /api/search/status
 */
router.get('/search/status', auth, async (req, res) => {
  try {
    // Check if user has admin role
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Admin access required'
      });
    }
    
    const status = await searchService.getStatus();
    
    res.json(status);
  } catch (error) {
    logger.error('Status error:', error);
    res.status(500).json({
      error: 'Failed to get status',
      message: 'An error occurred while retrieving service status'
    });
  }
});

module.exports = { router, initializeSearchRoutes };