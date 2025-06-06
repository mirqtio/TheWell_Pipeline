const express = require('express');
const router = express.Router();
const VersioningService = require('../../services/versioning/VersioningService');
const { requireAuth, requirePermission } = require('../middleware/rbac');
const logger = require('../../utils/logger');

// Initialize service
const versioningService = new VersioningService();

/**
 * @route GET /api/v1/documents/:id/versions
 * @desc Get all versions of a document
 * @access Private - requires documents:read permission
 */
router.get('/documents/:id/versions',
  requireAuth(),
  requirePermission('documents', 'read'),
  async (req, res) => {
    try {
      const documentId = parseInt(req.params.id);
      const { limit = 50, offset = 0 } = req.query;
      
      const versions = await versioningService.getDocumentVersions(documentId, {
        limit: parseInt(limit),
        offset: parseInt(offset)
      });
      
      res.json({
        success: true,
        data: versions
      });
    } catch (error) {
      logger.error('Failed to get document versions:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve versions'
      });
    }
  }
);

/**
 * @route GET /api/v1/documents/:id/versions/:versionId
 * @desc Get specific version of a document
 * @access Private - requires documents:read permission
 */
router.get('/documents/:id/versions/:versionId',
  requireAuth(),
  requirePermission('documents', 'read'),
  async (req, res) => {
    try {
      const versionId = parseInt(req.params.versionId);
      
      const version = await versioningService.getVersion(versionId);
      
      if (!version) {
        return res.status(404).json({
          success: false,
          error: 'Version not found'
        });
      }
      
      res.json({
        success: true,
        data: version
      });
    } catch (error) {
      logger.error('Failed to get version:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve version'
      });
    }
  }
);

/**
 * @route GET /api/v1/documents/:id/versions/:versionId/diff
 * @desc Get diff between version and previous
 * @access Private - requires documents:read permission
 */
router.get('/documents/:id/versions/:versionId/diff',
  requireAuth(),
  requirePermission('documents', 'read'),
  async (req, res) => {
    try {
      const versionId = parseInt(req.params.versionId);
      
      const diff = await versioningService.getVersionDiff(versionId);
      
      if (!diff) {
        return res.status(404).json({
          success: false,
          error: 'Diff not found'
        });
      }
      
      res.json({
        success: true,
        data: diff
      });
    } catch (error) {
      logger.error('Failed to get diff:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve diff'
      });
    }
  }
);

/**
 * @route POST /api/v1/documents/:id/versions/:versionId/restore
 * @desc Restore document to specific version
 * @access Private - requires documents:update permission
 */
router.post('/documents/:id/versions/:versionId/restore',
  requireAuth(),
  requirePermission('documents', 'update'),
  async (req, res) => {
    try {
      const documentId = parseInt(req.params.id);
      const versionId = parseInt(req.params.versionId);
      
      const newVersion = await versioningService.restoreVersion(
        documentId,
        versionId,
        req.user.id
      );
      
      res.json({
        success: true,
        data: newVersion,
        message: 'Document restored to selected version'
      });
    } catch (error) {
      logger.error('Failed to restore version:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to restore version'
      });
    }
  }
);

/**
 * @route GET /api/v1/documents/:id/versions/compare
 * @desc Compare two versions
 * @access Private - requires documents:read permission
 */
router.get('/documents/:id/versions/compare',
  requireAuth(),
  requirePermission('documents', 'read'),
  async (req, res) => {
    try {
      const { from, to } = req.query;
      
      if (!from || !to) {
        return res.status(400).json({
          success: false,
          error: 'Both from and to version IDs are required'
        });
      }
      
      const comparison = await versioningService.compareVersions(
        parseInt(from),
        parseInt(to)
      );
      
      res.json({
        success: true,
        data: comparison
      });
    } catch (error) {
      logger.error('Failed to compare versions:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to compare versions'
      });
    }
  }
);

module.exports = router;