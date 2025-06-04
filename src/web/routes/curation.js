/**
 * Curation API Routes
 * RESTful API for manual document curation workflow
 */

const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { requireRole } = require('../middleware/auth');
const DocumentDAO = require('../../database/DocumentDAO');
const JobDAO = require('../../database/JobDAO');
const AuditService = require('../../services/AuditService');
const SourceReliabilityService = require('../../services/SourceReliabilityService');
const logger = require('../../utils/logger');

// Middleware for curation routes
router.use(auth);
router.use(requireRole(['curator', 'admin']));

/**
 * GET /api/v1/curation/items
 * Retrieve documents for curation organized by status
 */
router.get('/items', async (req, res) => {
  try {
    const { page = 1, limit = 50, priority, sourceType, status } = req.query; // eslint-disable-line no-unused-vars
    
    const documentDAO = new DocumentDAO();
    
    // Get pending documents
    const pendingDocs = await documentDAO.getCurationQueue({
      status: 'pending',
      priority,
      sourceType,
      limit: Math.floor(limit / 3),
      offset: (page - 1) * Math.floor(limit / 3)
    });
    
    // Get documents in review
    const inReviewDocs = await documentDAO.getCurationQueue({
      status: 'in_review',
      priority,
      sourceType,
      limit: Math.floor(limit / 3),
      offset: (page - 1) * Math.floor(limit / 3)
    });
    
    // Get recently processed documents
    const processedDocs = await documentDAO.getCurationQueue({
      status: 'processed',
      priority,
      sourceType,
      limit: Math.floor(limit / 3),
      offset: (page - 1) * Math.floor(limit / 3)
    });

    const response = {
      items: {
        pending: pendingDocs.map(doc => formatCurationItem(doc)),
        inReview: inReviewDocs.map(doc => formatCurationItem(doc)),
        processed: processedDocs.map(doc => formatCurationItem(doc))
      },
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: pendingDocs.length + inReviewDocs.length + processedDocs.length
      }
    };

    res.json(response);
  } catch (error) {
    logger.error('Error fetching curation items:', error);
    res.status(500).json({ error: 'Failed to fetch curation items' });
  }
});

/**
 * POST /api/v1/curation/items/:id/move
 * Move document between curation stages
 */
router.post('/items/:id/move', async (req, res) => {
  try {
    const { id } = req.params;
    const { from, to, curatorId } = req.body;
    
    const documentDAO = new DocumentDAO();
    const auditService = new AuditService();
    
    // Update document status
    const updatedDoc = await documentDAO.updateCurationStatus(id, {
      status: to,
      curatorId,
      lastStatusChange: new Date()
    });
    
    if (!updatedDoc) {
      return res.status(404).json({ error: 'Document not found' });
    }
    
    // Log audit trail
    await auditService.logAction({
      action: 'curation_status_change',
      entityType: 'document',
      entityId: id,
      userId: curatorId,
      details: {
        previousStatus: from,
        newStatus: to,
        timestamp: new Date()
      }
    });
    
    res.json({
      success: true,
      item: formatCurationItem(updatedDoc)
    });
  } catch (error) {
    logger.error('Error moving curation item:', error);
    res.status(500).json({ error: 'Failed to move curation item' });
  }
});

/**
 * POST /api/v1/curation/decision
 * Make curation decision (approve/reject) with detailed review
 */
router.post('/decision', async (req, res) => {
  try {
    const {
      itemId,
      decision,
      curatorId,
      notes,
      editedContent,
      tags,
      visibilityFlag
    } = req.body;
    
    const documentDAO = new DocumentDAO();
    const auditService = new AuditService();
    const reliabilityService = new SourceReliabilityService();
    
    // Validate decision
    if (!['APPROVE', 'REJECT'].includes(decision)) {
      return res.status(400).json({ error: 'Invalid decision. Must be APPROVE or REJECT' });
    }
    
    const document = await documentDAO.findById(itemId);
    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }
    
    // Process decision
    const updateData = {
      curationStatus: decision === 'APPROVE' ? 'approved' : 'rejected',
      curatorId,
      curationNotes: notes,
      curationDecisionAt: new Date()
    };
    
    if (decision === 'APPROVE') {
      updateData.content = editedContent || document.content;
      updateData.tags = tags || document.tags;
      updateData.visibilityFlag = visibilityFlag || document.visibilityFlag;
      updateData.status = 'published';
    } else {
      updateData.status = 'rejected';
    }
    
    const updatedDoc = await documentDAO.update(itemId, updateData);
    
    // Update source reliability based on decision
    await reliabilityService.updateSourceReliability(document.sourceId, {
      decision,
      documentId: itemId,
      curatorId,
      timestamp: new Date()
    });
    
    // Create detailed audit log
    await auditService.logAction({
      action: 'curation_decision',
      entityType: 'document',
      entityId: itemId,
      userId: curatorId,
      details: {
        decision,
        notes,
        sourceId: document.sourceId,
        previousStatus: document.curationStatus,
        newStatus: updateData.curationStatus,
        contentModified: editedContent !== document.content,
        tagsModified: JSON.stringify(tags) !== JSON.stringify(document.tags),
        visibilityChanged: visibilityFlag !== document.visibilityFlag
      }
    });
    
    // Emit event for other systems
    const eventData = {
      documentId: itemId,
      decision,
      curatorId,
      sourceId: document.sourceId,
      timestamp: new Date()
    };
    
    if (decision === 'APPROVE') {
      // Trigger indexing for search
      const jobDAO = new JobDAO();
      await jobDAO.create({
        type: 'document_indexing',
        status: 'pending',
        data: { documentId: itemId },
        priority: 'medium',
        scheduledAt: new Date()
      });
    }
    
    res.json({
      success: true,
      item: formatCurationItem(updatedDoc),
      event: eventData
    });
  } catch (error) {
    logger.error('Error processing curation decision:', error);
    res.status(500).json({ error: 'Failed to process curation decision' });
  }
});

/**
 * POST /api/v1/curation/bulk
 * Bulk operations on multiple documents
 */
router.post('/bulk', async (req, res) => {
  try {
    const { action, itemIds, reason, curatorId } = req.body;
    
    if (!itemIds || !Array.isArray(itemIds) || itemIds.length === 0) {
      return res.status(400).json({ error: 'Invalid item IDs' });
    }
    
    if (!['approve', 'reject', 'move_to_review'].includes(action)) {
      return res.status(400).json({ error: 'Invalid bulk action' });
    }
    
    const documentDAO = new DocumentDAO();
    const auditService = new AuditService();
    const results = [];
    
    for (const itemId of itemIds) {
      try {
        let updateData = { curatorId, lastModifiedAt: new Date() };
        
        switch (action) {
        case 'approve':
          updateData.curationStatus = 'approved';
          updateData.status = 'published';
          updateData.curationNotes = reason || 'Bulk approved';
          break;
        case 'reject':
          updateData.curationStatus = 'rejected';
          updateData.status = 'rejected';
          updateData.curationNotes = reason || 'Bulk rejected';
          break;
        case 'move_to_review':
          updateData.curationStatus = 'in_review';
          updateData.curationNotes = reason || 'Moved to review';
          break;
        }
        
        const updatedDoc = await documentDAO.update(itemId, updateData);
        
        if (updatedDoc) {
          results.push({
            itemId,
            success: true,
            item: formatCurationItem(updatedDoc)
          });
          
          // Log bulk action
          await auditService.logAction({
            action: `bulk_${action}`,
            entityType: 'document',
            entityId: itemId,
            userId: curatorId,
            details: {
              bulkOperation: true,
              reason,
              timestamp: new Date()
            }
          });
        } else {
          results.push({
            itemId,
            success: false,
            error: 'Document not found'
          });
        }
      } catch (error) {
        logger.error(`Error processing bulk action for item ${itemId}:`, error);
        results.push({
          itemId,
          success: false,
          error: error.message
        });
      }
    }
    
    const successCount = results.filter(r => r.success).length;
    const failureCount = results.length - successCount;
    
    res.json({
      success: true,
      results,
      summary: {
        total: itemIds.length,
        successful: successCount,
        failed: failureCount
      }
    });
  } catch (error) {
    logger.error('Error processing bulk curation action:', error);
    res.status(500).json({ error: 'Failed to process bulk action' });
  }
});

/**
 * GET /api/v1/curation/stats
 * Get curation statistics and metrics
 */
router.get('/stats', async (req, res) => {
  try {
    const { timeframe = '7d' } = req.query;
    const documentDAO = new DocumentDAO();
    
    const stats = await documentDAO.getCurationStats(timeframe);
    
    res.json({
      timeframe,
      stats: {
        totalPending: stats.pending || 0,
        totalInReview: stats.inReview || 0,
        totalProcessed: stats.processed || 0,
        approvalRate: stats.approvalRate || 0,
        avgProcessingTime: stats.avgProcessingTime || 0,
        topCurators: stats.topCurators || [],
        sourceBreakdown: stats.sourceBreakdown || [],
        priorityDistribution: stats.priorityDistribution || {}
      }
    });
  } catch (error) {
    logger.error('Error fetching curation stats:', error);
    res.status(500).json({ error: 'Failed to fetch curation statistics' });
  }
});

/**
 * GET /api/v1/curation/audit/:itemId
 * Get audit trail for a specific document
 */
router.get('/audit/:itemId', async (req, res) => {
  try {
    const { itemId } = req.params;
    const auditService = new AuditService();
    
    const auditTrail = await auditService.getEntityAuditTrail('document', itemId);
    
    res.json({
      itemId,
      auditTrail: auditTrail.map(entry => ({
        id: entry.id,
        action: entry.action,
        userId: entry.userId,
        userName: entry.userName,
        timestamp: entry.timestamp,
        details: entry.details
      }))
    });
  } catch (error) {
    logger.error('Error fetching audit trail:', error);
    res.status(500).json({ error: 'Failed to fetch audit trail' });
  }
});

// Helper function to format document for curation UI
function formatCurationItem(doc) {
  return {
    id: doc.id,
    title: doc.title || `Document ${doc.id}`,
    content: doc.content,
    contentPreview: doc.content ? doc.content.substring(0, 200) : '',
    sourceId: doc.sourceId,
    sourceName: doc.sourceName || 'Unknown Source',
    sourceType: doc.sourceType || 'unknown',
    tags: doc.tags || [],
    priority: doc.priority || 'medium',
    status: doc.curationStatus || 'pending',
    visibility: doc.visibilityFlag || 'internal',
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    curatorId: doc.curatorId,
    curationNotes: doc.curationNotes,
    curationDecisionAt: doc.curationDecisionAt,
    metadata: {
      wordCount: doc.content ? doc.content.split(' ').length : 0,
      lastModified: doc.lastModifiedAt || doc.updatedAt,
      sourceReliabilityScore: doc.sourceReliabilityScore
    }
  };
}

module.exports = router;