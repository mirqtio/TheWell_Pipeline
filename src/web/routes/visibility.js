/**
 * Document Visibility Management API Routes
 * Handles document visibility states, access controls, and approval workflows
 */

const express = require('express');
const logger = require('../../utils/logger');

/**
 * Create visibility routes
 */
function createVisibilityRoutes(options = {}) {
  const router = express.Router();
  const { ingestionEngine } = options;

  // Middleware to check if visibility management is enabled
  const checkVisibilityEnabled = (req, res, next) => {
    if (!ingestionEngine?.options?.enableVisibilityManagement) {
      return res.status(503).json({
        error: 'Visibility management is not enabled',
        code: 'VISIBILITY_DISABLED'
      });
    }
    next();
  };

  // Apply middleware to all routes
  router.use(checkVisibilityEnabled);

  /**
   * GET /api/visibility/document/:documentId
   * Get document visibility state
   */
  router.get('/document/:documentId', async (req, res) => {
    try {
      const { documentId } = req.params;
      const userId = req.user?.id || 'anonymous';

      logger.info('Getting document visibility', { documentId, userId });

      const visibility = await ingestionEngine.getDocumentVisibility(documentId);
      
      res.json({
        success: true,
        data: visibility
      });

    } catch (error) {
      logger.error('Failed to get document visibility', {
        documentId: req.params.documentId,
        error: error.message
      });

      res.status(500).json({
        error: 'Failed to get document visibility',
        message: error.message,
        code: 'VISIBILITY_GET_FAILED'
      });
    }
  });

  /**
   * PUT /api/visibility/document/:documentId
   * Set document visibility
   */
  router.put('/document/:documentId', async (req, res) => {
    try {
      const { documentId } = req.params;
      const { visibility, reason, metadata = {} } = req.body;
      const userId = req.user?.id || 'anonymous';

      logger.info('Setting document visibility', { 
        documentId, 
        visibility, 
        userId, 
        reason 
      });

      // Validate required fields
      if (!visibility) {
        return res.status(400).json({
          error: 'Visibility is required',
          code: 'MISSING_VISIBILITY'
        });
      }

      const result = await ingestionEngine.setDocumentVisibility(
        documentId,
        visibility,
        userId,
        reason,
        metadata
      );

      res.json({
        success: true,
        data: result
      });

    } catch (error) {
      logger.error('Failed to set document visibility', {
        documentId: req.params.documentId,
        visibility: req.body.visibility,
        error: error.message
      });

      res.status(500).json({
        error: 'Failed to set document visibility',
        message: error.message,
        code: 'VISIBILITY_SET_FAILED'
      });
    }
  });

  /**
   * POST /api/visibility/check-access
   * Check if user has access to document
   */
  router.post('/check-access', async (req, res) => {
    try {
      const { documentId, accessLevel = 'read' } = req.body;
      const userId = req.user?.id || 'anonymous';

      logger.info('Checking document access', { 
        documentId, 
        userId, 
        accessLevel 
      });

      // Validate required fields
      if (!documentId) {
        return res.status(400).json({
          error: 'Document ID is required',
          code: 'MISSING_DOCUMENT_ID'
        });
      }

      const hasAccess = await ingestionEngine.checkDocumentAccess(
        documentId,
        userId,
        accessLevel
      );

      res.json({
        success: true,
        data: {
          documentId,
          userId,
          accessLevel,
          hasAccess
        }
      });

    } catch (error) {
      logger.error('Failed to check document access', {
        documentId: req.body.documentId,
        userId: req.user?.id,
        error: error.message
      });

      res.status(500).json({
        error: 'Failed to check document access',
        message: error.message,
        code: 'ACCESS_CHECK_FAILED'
      });
    }
  });

  /**
   * PUT /api/visibility/bulk-update
   * Bulk update document visibilities
   */
  router.put('/bulk-update', async (req, res) => {
    try {
      const { updates, reason = 'Bulk update' } = req.body;
      const userId = req.user?.id || 'anonymous';

      logger.info('Bulk updating document visibilities', { 
        updateCount: updates?.length,
        userId, 
        reason 
      });

      // Validate required fields
      if (!updates || !Array.isArray(updates) || updates.length === 0) {
        return res.status(400).json({
          error: 'Updates array is required and must not be empty',
          code: 'MISSING_UPDATES'
        });
      }

      // Validate update structure
      for (const update of updates) {
        if (!update.documentId || !update.visibility) {
          return res.status(400).json({
            error: 'Each update must have documentId and visibility',
            code: 'INVALID_UPDATE_STRUCTURE'
          });
        }
      }

      const result = await ingestionEngine.bulkUpdateVisibility(
        updates,
        userId,
        reason
      );

      res.json({
        success: true,
        data: result
      });

    } catch (error) {
      logger.error('Failed to bulk update visibilities', {
        updateCount: req.body.updates?.length,
        error: error.message
      });

      res.status(500).json({
        error: 'Failed to bulk update visibilities',
        message: error.message,
        code: 'BULK_UPDATE_FAILED'
      });
    }
  });

  /**
   * GET /api/visibility/approvals
   * Get pending visibility approvals
   */
  router.get('/approvals', async (req, res) => {
    try {
      const { visibility, requestedBy, since } = req.query;
      const userId = req.user?.id || 'anonymous';

      logger.info('Getting pending approvals', { 
        filters: { visibility, requestedBy, since },
        userId 
      });

      const filters = {};
      if (visibility) filters.visibility = visibility;
      if (requestedBy) filters.requestedBy = requestedBy;
      if (since) filters.since = since;

      const approvals = await ingestionEngine.getPendingApprovals(filters);

      res.json({
        success: true,
        data: approvals
      });

    } catch (error) {
      logger.error('Failed to get pending approvals', {
        error: error.message
      });

      res.status(500).json({
        error: 'Failed to get pending approvals',
        message: error.message,
        code: 'GET_APPROVALS_FAILED'
      });
    }
  });

  /**
   * POST /api/visibility/approvals/:approvalId/approve
   * Approve visibility change
   */
  router.post('/approvals/:approvalId/approve', async (req, res) => {
    try {
      const { approvalId } = req.params;
      const { notes = '' } = req.body;
      const userId = req.user?.id || 'anonymous';

      logger.info('Approving visibility change', { 
        approvalId, 
        userId, 
        notes 
      });

      const result = await ingestionEngine.approveVisibilityChange(
        approvalId,
        userId,
        notes
      );

      res.json({
        success: true,
        data: result
      });

    } catch (error) {
      logger.error('Failed to approve visibility change', {
        approvalId: req.params.approvalId,
        error: error.message
      });

      res.status(500).json({
        error: 'Failed to approve visibility change',
        message: error.message,
        code: 'APPROVAL_FAILED'
      });
    }
  });

  /**
   * POST /api/visibility/approvals/:approvalId/reject
   * Reject visibility change
   */
  router.post('/approvals/:approvalId/reject', async (req, res) => {
    try {
      const { approvalId } = req.params;
      const { reason = '' } = req.body;
      const userId = req.user?.id || 'anonymous';

      logger.info('Rejecting visibility change', { 
        approvalId, 
        userId, 
        reason 
      });

      const result = await ingestionEngine.rejectVisibilityChange(
        approvalId,
        userId,
        reason
      );

      res.json({
        success: true,
        data: result
      });

    } catch (error) {
      logger.error('Failed to reject visibility change', {
        approvalId: req.params.approvalId,
        error: error.message
      });

      res.status(500).json({
        error: 'Failed to reject visibility change',
        message: error.message,
        code: 'REJECTION_FAILED'
      });
    }
  });

  /**
   * GET /api/visibility/audit/:documentId
   * Get visibility audit log for document
   */
  router.get('/audit/:documentId', async (req, res) => {
    try {
      const { documentId } = req.params;
      const { limit = 50 } = req.query;
      const userId = req.user?.id || 'anonymous';

      logger.info('Getting visibility audit log', { 
        documentId, 
        limit, 
        userId 
      });

      const auditLog = await ingestionEngine.getVisibilityAuditLog(
        documentId,
        parseInt(limit)
      );

      res.json({
        success: true,
        data: auditLog
      });

    } catch (error) {
      logger.error('Failed to get visibility audit log', {
        documentId: req.params.documentId,
        error: error.message
      });

      res.status(500).json({
        error: 'Failed to get visibility audit log',
        message: error.message,
        code: 'AUDIT_LOG_FAILED'
      });
    }
  });

  /**
   * POST /api/visibility/rules
   * Add visibility rule
   */
  router.post('/rules', async (req, res) => {
    try {
      const { ruleId, rule } = req.body;
      const userId = req.user?.id || 'anonymous';

      logger.info('Adding visibility rule', { 
        ruleId, 
        rule, 
        userId 
      });

      // Validate required fields
      if (!ruleId || !rule) {
        return res.status(400).json({
          error: 'Rule ID and rule are required',
          code: 'MISSING_RULE_DATA'
        });
      }

      ingestionEngine.addVisibilityRule(ruleId, rule);

      res.json({
        success: true,
        data: {
          ruleId,
          message: 'Visibility rule added successfully'
        }
      });

    } catch (error) {
      logger.error('Failed to add visibility rule', {
        ruleId: req.body.ruleId,
        error: error.message
      });

      res.status(500).json({
        error: 'Failed to add visibility rule',
        message: error.message,
        code: 'ADD_RULE_FAILED'
      });
    }
  });

  /**
   * DELETE /api/visibility/rules/:ruleId
   * Remove visibility rule
   */
  router.delete('/rules/:ruleId', async (req, res) => {
    try {
      const { ruleId } = req.params;
      const userId = req.user?.id || 'anonymous';

      logger.info('Removing visibility rule', { 
        ruleId, 
        userId 
      });

      const removed = ingestionEngine.removeVisibilityRule(ruleId);

      if (!removed) {
        return res.status(404).json({
          error: 'Visibility rule not found',
          code: 'RULE_NOT_FOUND'
        });
      }

      res.json({
        success: true,
        data: {
          ruleId,
          message: 'Visibility rule removed successfully'
        }
      });

    } catch (error) {
      logger.error('Failed to remove visibility rule', {
        ruleId: req.params.ruleId,
        error: error.message
      });

      res.status(500).json({
        error: 'Failed to remove visibility rule',
        message: error.message,
        code: 'REMOVE_RULE_FAILED'
      });
    }
  });

  return router;
}

module.exports = createVisibilityRoutes;
