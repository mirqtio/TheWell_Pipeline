/**
 * RAG API Routes
 * RESTful API endpoints for Retrieval-Augmented Generation
 */

const express = require('express');
const Joi = require('joi');
const { asyncHandler } = require('../middleware/errorHandler');
const { requirePermission, requireDocumentAccess } = require('../middleware/auth');
const logger = require('../../utils/logger');

module.exports = (dependencies = {}) => {
  const router = express.Router();
  const { ragManager, cacheManager } = dependencies;

  // Request validation schemas
  const searchRequestSchema = Joi.object({
    query: Joi.string().min(1).max(1000).required(),
    context: Joi.object({
      conversationId: Joi.string().optional(),
      previousQueries: Joi.array().items(Joi.string()).max(5).optional(),
      userPreferences: Joi.object().optional(),
      sessionData: Joi.object().optional()
    }).optional(),
    filters: Joi.object({
      sources: Joi.array().items(Joi.string()).optional(),
      dateRange: Joi.object({
        start: Joi.date().optional(),
        end: Joi.date().optional()
      }).optional(),
      contentTypes: Joi.array().items(Joi.string()).optional(),
      tags: Joi.array().items(Joi.string()).optional()
    }).optional(),
    options: Joi.object({
      maxResults: Joi.number().integer().min(1).max(50).default(10),
      includeMetadata: Joi.boolean().default(true),
      includeSources: Joi.boolean().default(true),
      responseFormat: Joi.string().valid('json', 'text', 'markdown').default('json')
    }).optional()
  });

  /**
   * @swagger
   * /api/v1/rag/search:
   *   post:
   *     summary: Perform RAG search
   *     description: Execute a retrieval-augmented generation search query against the knowledge base
   *     tags: [RAG]
   *     security:
   *       - ApiKeyAuth: []
   *       - BearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/RAGSearchRequest'
   *           examples:
   *             simple:
   *               summary: Simple search query
   *               value:
   *                 query: "What is machine learning?"
   *             advanced:
   *               summary: Advanced search with filters
   *               value:
   *                 query: "Explain neural networks"
   *                 context:
   *                   conversationId: "conv-123"
   *                   previousQueries: ["What is AI?"]
   *                 filters:
   *                   sources: ["research-papers", "documentation"]
   *                   contentTypes: ["pdf", "markdown"]
   *                 options:
   *                   maxResults: 5
   *                   includeMetadata: true
   *                   responseFormat: "json"
   *     responses:
   *       200:
   *         description: Successful search response
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/RAGSearchResponse'
   *       400:
   *         description: Invalid request parameters
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       401:
   *         description: Authentication required
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       403:
   *         description: Insufficient permissions
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   */
  router.post('/search', 
    requirePermission('document.read'), 
    requireDocumentAccess('read'),
    asyncHandler(async (req, res) => {
      const traceId = req.headers['x-trace-id'] || generateTraceId();
      const startTime = Date.now();

      try {
        logger.info('RAG search request received', {
          traceId,
          userId: req.user.id,
          queryLength: req.body.query?.length
        });

        // Validate request
        const { error, value } = searchRequestSchema.validate(req.body);
        if (error) {
          return res.status(400).json({
            success: false,
            error: {
              message: `Invalid request: ${error.details[0].message}`,
              type: 'ValidationError',
              trace_id: traceId
            }
          });
        }

        // Add trace ID to request data
        value.traceId = traceId;

        // Check cache if enabled
        let cacheKey = null;
        if (cacheManager && shouldCache(value, req.user)) {
          cacheKey = generateCacheKey(value, req.user);
          const cachedResult = await cacheManager.get(cacheKey);
        
          if (cachedResult) {
            logger.info('Cache hit for RAG search', { traceId, cacheKey });
            return res.json({
              ...cachedResult,
              cached: true,
              cache_hit_at: new Date().toISOString()
            });
          }
        }

        // Process RAG query
        const result = await ragManager.processQuery(value, {
          userId: req.user.id,
          roles: req.user.roles || [],
          permissions: req.user.permissions || []
        });

        // Cache result if appropriate
        if (cacheManager && cacheKey && shouldCacheResult(result)) {
          const ttl = calculateCacheTTL(value, result);
          await cacheManager.setex(cacheKey, ttl, JSON.stringify(result));
          logger.debug('Result cached', { traceId, cacheKey, ttl });
        }

        // Add request metadata
        result.request_metadata = {
          trace_id: traceId,
          processing_time_ms: Date.now() - startTime,
          cached: false
        };

        logger.info('RAG search completed successfully', {
          traceId,
          processingTime: Date.now() - startTime,
          confidence: result.data?.confidence
        });

        res.json(result);

      } catch (error) {
        logger.error('RAG search failed', {
          traceId,
          error: error.message,
          processingTime: Date.now() - startTime
        });

        const errorResponse = {
          success: false,
          error: {
            message: error.message || 'Internal server error',
            type: error.name || 'UnknownError',
            trace_id: traceId,
            timestamp: new Date().toISOString()
          }
        };

        res.status(500).json(errorResponse);
      }
    }));

  /**
   * @swagger
   * /api/v1/rag/health:
   *   get:
   *     summary: Get RAG system health status
   *     description: Retrieve the current health status of the RAG system
   *     tags: [RAG]
   *     responses:
   *       200:
   *         description: Successful health check response
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/HealthStatus'
   *       503:
   *         description: Service unavailable
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   */
  router.get('/health', asyncHandler(async (req, res) => {
    try {
      const health = await ragManager.getHealthStatus();
      
      const status = {
        status: health.initialized ? 'healthy' : 'unhealthy',
        timestamp: new Date().toISOString(),
        components: health.components,
        uptime: process.uptime(),
        version: process.env.npm_package_version || '1.0.0'
      };

      const httpStatus = health.initialized ? 200 : 503;
      res.status(httpStatus).json(status);

    } catch (error) {
      logger.error('Health check failed:', error);
      res.status(503).json({
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }));

  /**
   * @swagger
   * /api/v1/rag/capabilities:
   *   get:
   *     summary: Get RAG system capabilities
   *     description: Retrieve the capabilities and configuration of the RAG system
   *     tags: [RAG]
   *     security:
   *       - ApiKeyAuth: []
   *       - BearerAuth: []
   *     responses:
   *       200:
   *         description: Successful capabilities response
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/RAGCapabilities'
   *       401:
   *         description: Authentication required
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       403:
   *         description: Insufficient permissions
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   */
  router.get('/capabilities', requirePermission('read'), asyncHandler(async (req, res) => {
    try {
      const capabilities = {
        search: {
          max_query_length: 1000,
          max_results: 50,
          supported_formats: ['json', 'text', 'markdown'],
          search_types: ['hybrid', 'vector', 'keyword']
        },
        filters: {
          sources: true,
          date_range: true,
          content_types: true,
          tags: true
        },
        features: {
          caching: !!cacheManager,
          tracing: true,
          metadata: true,
          confidence_scoring: true,
          source_attribution: true
        },
        limits: {
          max_concurrent_requests: 100,
          rate_limit_per_minute: 60,
          max_cache_ttl_seconds: 3600
        }
      };

      res.json({
        success: true,
        data: capabilities,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Failed to get capabilities:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }));

  /**
   * @swagger
   * /api/v1/rag/feedback:
   *   post:
   *     summary: Submit feedback on RAG responses
   *     description: Provide feedback on the relevance and accuracy of RAG search results
   *     tags: [RAG]
   *     security:
   *       - ApiKeyAuth: []
   *       - BearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/RAGFeedback'
   *           examples:
   *             helpful:
   *               summary: Helpful feedback
   *               value:
   *                 trace_id: "trace-123"
   *                 rating: 5
   *                 feedback_type: "helpful"
   *                 comment: "This response was very helpful!"
   *             not-helpful:
   *               summary: Not helpful feedback
   *               value:
   *                 trace_id: "trace-456"
   *                 rating: 1
   *                 feedback_type: "not_helpful"
   *                 comment: "This response was not helpful at all."
   *     responses:
   *       200:
   *         description: Successful feedback submission
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/FeedbackResponse'
   *       400:
   *         description: Invalid feedback parameters
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       401:
   *         description: Authentication required
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       403:
   *         description: Insufficient permissions
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   */
  router.post('/feedback', requirePermission('write'), asyncHandler(async (req, res) => {
    const feedbackSchema = Joi.object({
      trace_id: Joi.string().required(),
      rating: Joi.number().integer().min(1).max(5).required(),
      feedback_type: Joi.string().valid('helpful', 'not_helpful', 'incorrect', 'incomplete').required(),
      comment: Joi.string().max(1000).optional(),
      suggested_improvement: Joi.string().max(1000).optional()
    });

    try {
      const { error, value } = feedbackSchema.validate(req.body);
      if (error) {
        return res.status(400).json({
          success: false,
          error: `Invalid feedback: ${error.details[0].message}`
        });
      }

      // Store feedback (this would typically go to a feedback database)
      logger.info('RAG feedback received', {
        traceId: value.trace_id,
        userId: req.user.id,
        rating: value.rating,
        feedbackType: value.feedback_type
      });

      // For now, just log the feedback
      // In a real implementation, this would be stored in a database
      // and used to improve the RAG system

      res.json({
        success: true,
        message: 'Feedback received successfully',
        feedback_id: `feedback_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Failed to process feedback:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }));

  // Helper functions

  /**
   * Generate a unique trace ID
   */
  function generateTraceId() {
    return `rag_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generate cache key for request
   */
  function generateCacheKey(requestData, user) {
    const keyData = {
      query: requestData.query,
      filters: requestData.filters || {},
      options: requestData.options || {},
      userId: user.id,
      roles: user.roles || []
    };
    
    const keyString = JSON.stringify(keyData);
    const crypto = require('crypto');
    return `rag_cache_${crypto.createHash('md5').update(keyString).digest('hex')}`;
  }

  /**
   * Determine if request should be cached
   */
  function shouldCache(requestData, user) {
    // Don't cache if user has admin role (they might see different data)
    if (user.roles && user.roles.includes('admin')) {
      return false;
    }
    
    // Don't cache very long queries
    if (requestData.query.length > 500) {
      return false;
    }
    
    // Don't cache if custom date filters are used
    if (requestData.filters && requestData.filters.dateRange) {
      return false;
    }
    
    return true;
  }

  /**
   * Determine if result should be cached
   */
  function shouldCacheResult(result) {
    // Don't cache error responses
    if (!result.success) {
      return false;
    }
    
    // Don't cache low-confidence responses
    if (result.data && result.data.confidence < 0.5) {
      return false;
    }
    
    return true;
  }

  /**
   * Calculate cache TTL based on request and result
   */
  function calculateCacheTTL(requestData, result) {
    let baseTTL = 1800; // 30 minutes default
    
    // Longer TTL for high-confidence results
    if (result.data && result.data.confidence > 0.8) {
      baseTTL = 3600; // 1 hour
    }
    
    // Shorter TTL for low-confidence results
    if (result.data && result.data.confidence < 0.6) {
      baseTTL = 600; // 10 minutes
    }
    
    // Shorter TTL for complex queries
    if (requestData.query.length > 200) {
      baseTTL = Math.floor(baseTTL * 0.5);
    }
    
    return baseTTL;
  }

  return router;
};
