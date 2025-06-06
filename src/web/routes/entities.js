const express = require('express');
const router = express.Router();
const EntityExtractionService = require('../../services/EntityExtractionService');
const DocumentDAO = require('../../database/DocumentDAO');
const { requireAuth, requirePermission } = require('../middleware/rbac');
const logger = require('../../utils/logger');

// Initialize services
const entityService = new EntityExtractionService();
const documentDAO = new DocumentDAO();

/**
 * @route POST /api/v1/entities/extract/batch
 * @desc Extract entities from multiple documents
 * @access Private - requires documents:read permission
 */
router.post('/extract/batch',
  requireAuth(),
  requirePermission('documents', 'read'),
  async (req, res) => {
    try {
      const { documentIds } = req.body;
      
      if (!documentIds || !Array.isArray(documentIds)) {
        return res.status(400).json({
          success: false,
          error: 'documentIds array is required'
        });
      }
      
      // Get documents
      const documents = await Promise.all(
        documentIds.map(id => documentDAO.getById(id))
      );
      
      const validDocuments = documents.filter(doc => doc !== null);
      
      if (validDocuments.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'No valid documents found'
        });
      }
      
      // Process batch
      const results = await entityService.processBatch(validDocuments);
      
      res.json({
        success: true,
        data: results,
        processed: results.length,
        successful: results.filter(r => r.success).length
      });
    } catch (error) {
      logger.error('Batch entity extraction failed:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to process batch'
      });
    }
  }
);

/**
 * @route POST /api/v1/entities/extract/:documentId
 * @desc Extract entities from a specific document
 * @access Private - requires documents:read permission
 */
router.post('/extract/:documentId',
  requireAuth(),
  requirePermission('documents', 'read'),
  async (req, res) => {
    try {
      const documentId = parseInt(req.params.documentId);
      
      // Get document
      const document = await documentDAO.getById(documentId);
      if (!document) {
        return res.status(404).json({
          success: false,
          error: 'Document not found'
        });
      }
      
      // Process document
      const result = await entityService.processDocument(document);
      
      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      logger.error('Entity extraction failed:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to extract entities'
      });
    }
  }
);

/**
 * @route GET /api/v1/entities/document/:documentId
 * @desc Get entities for a specific document
 * @access Private - requires documents:read permission
 */
router.get('/document/:documentId',
  requireAuth(),
  requirePermission('documents', 'read'),
  async (req, res) => {
    try {
      const documentId = parseInt(req.params.documentId);
      const {
        types,
        minConfidence = 0.7,
        limit = 100,
        offset = 0
      } = req.query;
      
      const options = {
        minConfidence: parseFloat(minConfidence),
        limit: parseInt(limit),
        offset: parseInt(offset)
      };
      
      // Handle types parameter
      if (types) {
        options.types = Array.isArray(types) ? types : [types];
      }
      
      const entities = await entityService.getDocumentEntities(documentId, options);
      
      res.json({
        success: true,
        data: entities,
        count: entities.length
      });
    } catch (error) {
      logger.error('Failed to get document entities:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve entities'
      });
    }
  }
);

/**
 * @route GET /api/v1/entities/search
 * @desc Search entities across all documents
 * @access Private - requires documents:search permission
 */
router.get('/search',
  requireAuth(),
  requirePermission('documents', 'search'),
  async (req, res) => {
    try {
      const {
        q: searchText,
        types,
        minConfidence = 0.7,
        limit = 20
      } = req.query;
      
      if (!searchText) {
        return res.status(400).json({
          success: false,
          error: 'Search text (q) is required'
        });
      }
      
      const options = {
        minConfidence: parseFloat(minConfidence),
        limit: parseInt(limit)
      };
      
      if (types) {
        options.types = Array.isArray(types) ? types : [types];
      }
      
      const results = await entityService.searchEntities(searchText, options);
      
      res.json({
        success: true,
        data: results,
        count: results.length
      });
    } catch (error) {
      logger.error('Entity search failed:', error);
      res.status(500).json({
        success: false,
        error: 'Search failed'
      });
    }
  }
);

/**
 * @route GET /api/v1/entities/statistics
 * @desc Get entity extraction statistics
 * @access Private - requires reports:read permission
 */
router.get('/statistics',
  requireAuth(),
  requirePermission('reports', 'read'),
  async (req, res) => {
    try {
      const { documentId } = req.query;
      
      const options = {};
      if (documentId) {
        options.documentId = parseInt(documentId);
      }
      
      const statistics = await entityService.getEntityStatistics(options);
      
      res.json({
        success: true,
        data: statistics
      });
    } catch (error) {
      logger.error('Failed to get statistics:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get statistics'
      });
    }
  }
);

/**
 * @route POST /api/v1/entities/patterns
 * @desc Create custom entity extraction pattern
 * @access Private - requires system:admin permission
 */
router.post('/patterns',
  requireAuth(),
  requirePermission('system', 'admin'),
  async (req, res) => {
    try {
      const { name, pattern, entityType, description } = req.body;
      
      if (!name || !pattern || !entityType) {
        return res.status(400).json({
          success: false,
          error: 'name, pattern, and entityType are required'
        });
      }
      
      const result = await entityService.addCustomPattern({
        name,
        pattern,
        entityType,
        description
      });
      
      res.status(201).json({
        success: true,
        data: result
      });
    } catch (error) {
      logger.error('Failed to create pattern:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to create pattern'
      });
    }
  }
);

/**
 * @route GET /api/v1/entities/patterns
 * @desc Get custom entity patterns
 * @access Private - requires system:admin permission
 */
router.get('/patterns',
  requireAuth(),
  requirePermission('system', 'admin'),
  async (req, res) => {
    try {
      const { activeOnly = 'true' } = req.query;
      
      const patterns = await entityService.getCustomPatterns(
        activeOnly === 'true'
      );
      
      res.json({
        success: true,
        data: patterns,
        count: patterns.length
      });
    } catch (error) {
      logger.error('Failed to get patterns:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get patterns'
      });
    }
  }
);

/**
 * @route POST /api/v1/entities/relationships
 * @desc Create relationship between entities
 * @access Private - requires documents:update permission
 */
router.post('/relationships',
  requireAuth(),
  requirePermission('documents', 'update'),
  async (req, res) => {
    try {
      const {
        sourceEntityId,
        targetEntityId,
        relationshipType,
        confidence = 0.8,
        metadata = {}
      } = req.body;
      
      if (!sourceEntityId || !targetEntityId || !relationshipType) {
        return res.status(400).json({
          success: false,
          error: 'sourceEntityId, targetEntityId, and relationshipType are required'
        });
      }
      
      const relationship = await entityService.createEntityRelationship(
        sourceEntityId,
        targetEntityId,
        relationshipType,
        confidence,
        metadata
      );
      
      res.status(201).json({
        success: true,
        data: relationship
      });
    } catch (error) {
      logger.error('Failed to create relationship:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to create relationship'
      });
    }
  }
);

/**
 * @route GET /api/v1/entities/:entityId/relationships
 * @desc Get relationships for an entity
 * @access Private - requires documents:read permission
 */
router.get('/:entityId/relationships',
  requireAuth(),
  requirePermission('documents', 'read'),
  async (req, res) => {
    try {
      const entityId = parseInt(req.params.entityId);
      
      const relationships = await entityService.getEntityRelationships(entityId);
      
      res.json({
        success: true,
        data: relationships,
        count: relationships.length
      });
    } catch (error) {
      logger.error('Failed to get relationships:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get relationships'
      });
    }
  }
);

/**
 * @route POST /api/v1/entities/process-pending
 * @desc Process pending entity extraction jobs
 * @access Private - requires system:admin permission
 */
router.post('/process-pending',
  requireAuth(),
  requirePermission('system', 'admin'),
  async (req, res) => {
    try {
      const results = await entityService.processPendingJobs();
      
      res.json({
        success: true,
        data: {
          processed: results.length,
          successful: results.filter(r => r.success).length,
          failed: results.filter(r => !r.success).length
        }
      });
    } catch (error) {
      logger.error('Failed to process pending jobs:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to process pending jobs'
      });
    }
  }
);

module.exports = router;