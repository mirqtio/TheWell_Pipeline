/**
 * Review Routes
 * API endpoints for manual review of ingested documents
 */

const express = require('express');
const { asyncHandler, ValidationError, NotFoundError } = require('../middleware/errorHandler');
const { requirePermission } = require('../middleware/auth');
const auditService = require('../../services/AuditService');
const logger = require('../../utils/logger');

module.exports = (dependencies = {}) => {
  const router = express.Router();
  const { queueManager, ingestionEngine } = dependencies;

  if (!queueManager) {
    throw new Error('QueueManager is required for review routes');
  }

  /**
   * Get pending documents for review
   */
  router.get('/pending', requirePermission('read'), asyncHandler(async (req, res) => {
    const { page = 1, limit = 20, search = '', filter = 'all' } = req.query;
    
    logger.info('Getting pending documents', {
      page: parseInt(page),
      limit: parseInt(limit),
      search,
      filter,
      userId: req.user.id
    });

    // Use ingestionEngine if available, fallback to queueManager
    let result;
    if (ingestionEngine && ingestionEngine.getPendingDocuments) {
      result = await ingestionEngine.getPendingDocuments({
        page: parseInt(page),
        limit: parseInt(limit),
        search,
        filter
      });
    } else {
      // Fallback to queueManager implementation
      const jobs = await queueManager.getJobs('manual-review', ['waiting', 'active']);

      const documents = jobs.map(job => ({
        id: job.id,
        jobId: job.id,
        title: job.data.document?.title || 'Untitled Document',
        contentPreview: job.data.document?.content?.substring(0, 200) + '...' || '',
        source: {
          id: job.data.source?.id,
          name: job.data.source?.name,
          type: job.data.source?.type
        },
        metadata: {
          fileType: job.data.document?.fileType,
          fileSize: job.data.document?.fileSize,
          extractedAt: job.data.document?.extractedAt
        },
        status: 'pending',
        assignedTo: job.data.assignedTo || null,
        flags: job.data.flags || [],
        createdAt: job.timestamp,
        updatedAt: job.data.updatedAt || job.timestamp
      }));

      result = {
        documents,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: documents.length
        }
      };
    }

    res.json(result);
  }));

  /**
   * Get document details for review
   */
  router.get('/document/:id', requirePermission('read'), asyncHandler(async (req, res) => {
    const documentId = req.params.id;
    
    logger.info('Getting document details', {
      documentId,
      userId: req.user.id
    });

    // Use ingestionEngine if available, fallback to queueManager
    let result;
    if (ingestionEngine && ingestionEngine.getDocument) {
      result = await ingestionEngine.getDocument(documentId);
    } else {
      // Fallback to queueManager implementation
      const job = await queueManager.getJob('manual-review', documentId);
      
      if (!job) {
        throw new NotFoundError(`Document ${documentId} not found`);
      }

      const document = {
        id: job.id,
        jobId: job.id,
        title: job.data.document?.title || 'Untitled Document',
        content: job.data.document?.content || '',
        source: {
          id: job.data.source?.id,
          name: job.data.source?.name,
          type: job.data.source?.type,
          url: job.data.source?.url,
          config: job.data.source?.config
        },
        metadata: {
          fileType: job.data.document?.fileType,
          fileSize: job.data.document?.fileSize,
          filePath: job.data.document?.filePath,
          extractedAt: job.data.document?.extractedAt,
          language: job.data.document?.language,
          wordCount: job.data.document?.wordCount,
          encoding: job.data.document?.encoding,
          checksum: job.data.document?.checksum
        },
        processing: {
          attempts: job.attemptsMade,
          maxAttempts: job.opts.attempts,
          delay: job.opts.delay,
          priority: job.opts.priority,
          processedOn: job.processedOn,
          finishedOn: job.finishedOn,
          failedReason: job.failedReason
        },
        status: job.opts.jobId ? 'pending' : 'new',
        assignedTo: job.data.assignedTo || null,
        flags: job.data.flags || [],
        reviewNotes: job.data.reviewNotes || [],
        createdAt: job.timestamp,
        updatedAt: job.data.updatedAt || job.timestamp
      };

      result = { document };
    }

    res.json(result);
  }));

  /**
   * Approve document
   */
  router.post('/approve/:id', requirePermission('approve'), asyncHandler(async (req, res) => {
    const documentId = req.params.id;
    const { notes, visibility = 'internal', tags = [] } = req.body;

    logger.info('Approving document', {
      documentId,
      notes,
      visibility,
      tags,
      userId: req.user.id
    });

    // Use ingestionEngine if available, fallback to queueManager
    let result;
    if (ingestionEngine && ingestionEngine.approveDocument) {
      result = await ingestionEngine.approveDocument(documentId, {
        notes,
        visibility,
        tags,
        approvedBy: req.user.id
      });
    } else {
      // Fallback to queueManager implementation
      const job = await queueManager.getJob('manual-review', documentId);
      
      if (!job) {
        throw new NotFoundError(`Document ${documentId} not found`);
      }

      // Update job data with approval
      const approvalData = {
        status: 'approved',
        approvedBy: req.user.id,
        approvedAt: new Date().toISOString(),
        reviewNotes: notes || '',
        visibility,
        tags,
        decision: 'approve'
      };

      await job.update({
        ...job.data,
        ...approvalData
      });

      // Move to approved queue for further processing
      await queueManager.addJob('document-processing', {
        ...job.data,
        ...approvalData
      }, {
        priority: job.opts.priority || 0,
        attempts: 3
      });

      // Complete the review job
      await job.moveToCompleted('approved', true);

      result = { success: true };
    }

    logger.info('Document approved successfully', {
      documentId,
      userId: req.user.id
    });

    res.json({
      success: result?.success || true,
      message: 'Document approved successfully',
      documentId,
      status: 'approved',
      approvedBy: req.user.id,
      approvedAt: new Date().toISOString(),
      ...result
    });
  }));

  /**
   * Reject document
   */
  router.post('/reject/:id', requirePermission('reject'), asyncHandler(async (req, res) => {
    const documentId = req.params.id;
    const { reason, notes, permanent = false } = req.body;

    if (!reason) {
      throw new ValidationError('Rejection reason is required');
    }

    logger.info('Rejecting document', {
      documentId,
      reason,
      notes,
      permanent,
      userId: req.user.id
    });

    // Use ingestionEngine if available, fallback to queueManager
    let result;
    if (ingestionEngine && ingestionEngine.rejectDocument) {
      result = await ingestionEngine.rejectDocument(documentId, {
        reason,
        notes,
        permanent,
        rejectedBy: req.user.id
      });
    } else {
      // Fallback to queueManager implementation
      const job = await queueManager.getJob('manual-review', documentId);
      
      if (!job) {
        throw new NotFoundError(`Document ${documentId} not found`);
      }

      // Update job data with rejection
      const rejectionData = {
        status: 'rejected',
        rejectedBy: req.user.id,
        rejectedAt: new Date().toISOString(),
        rejectionReason: reason,
        reviewNotes: notes || '',
        permanent,
        decision: 'reject'
      };

      await job.update({
        ...job.data,
        ...rejectionData
      });

      if (permanent) {
        // Move to failed queue permanently
        await job.moveToFailed(new Error(`Rejected: ${reason}`), true);
      } else {
        // Move to rejected queue for potential re-review
        await queueManager.addJob('rejected-documents', {
          ...job.data,
          ...rejectionData
        }, {
          priority: 0,
          attempts: 1
        });
        
        await job.moveToCompleted('rejected', true);
      }

      result = { success: true };
    }

    logger.info('Document rejected successfully', {
      documentId,
      reason,
      permanent,
      userId: req.user.id
    });

    res.json({
      success: result?.success || true,
      message: 'Document rejected successfully',
      documentId,
      status: 'rejected',
      reason,
      rejectedBy: req.user.id,
      rejectedAt: new Date().toISOString(),
      permanent,
      ...result
    });
  }));

  /**
   * Flag document for special attention
   */
  router.post('/flag/:id', requirePermission('flag'), asyncHandler(async (req, res) => {
    const documentId = req.params.id;
    const { flag, type, notes, reason, priority = 1 } = req.body;

    // Accept either 'flag' or 'type' for the flag type
    const flagType = flag || type;
    // Accept either 'notes' or 'reason' for the flag reason
    const flagReason = notes || reason;

    if (!flagType) {
      throw new ValidationError('Flag type is required');
    }

    logger.info('Flagging document', {
      documentId,
      type: flagType,
      reason: flagReason,
      priority,
      userId: req.user.id
    });

    // Use ingestionEngine if available, fallback to queueManager
    let result;
    if (ingestionEngine && ingestionEngine.flagDocument) {
      result = await ingestionEngine.flagDocument(documentId, {
        flag: flagType,
        notes: flagReason,
        priority,
        flaggedBy: req.user.id
      });
    } else {
      // Fallback to queueManager implementation
      const job = await queueManager.getJob('manual-review', documentId);
      
      if (!job) {
        throw new NotFoundError(`Document ${documentId} not found`);
      }

      // Add flag to document
      const flag = {
        id: `flag-${Date.now()}`,
        type: flagType,
        reason: flagReason || '',
        flaggedBy: req.user.id,
        flaggedAt: new Date().toISOString(),
        priority,
        resolved: false
      };

      const flags = job.data.flags || [];
      flags.push(flag);

      await job.update({
        ...job.data,
        flags
      });

      // Change job priority if specified
      if (priority > job.opts.priority) {
        await job.changePriority(priority);
      }

      result = { success: true };
    }

    logger.info('Document flagged successfully', {
      documentId,
      type: flagType,
      priority,
      userId: req.user.id
    });

    res.json({
      success: result?.success || true,
      message: 'Document flagged successfully',
      documentId,
      flag: {
        type: flagType,
        reason: flagReason,
        priority,
        flaggedBy: req.user.id,
        flaggedAt: new Date().toISOString()
      },
      ...result
    });
  }));

  /**
   * Assign document to reviewer
   */
  router.post('/assign/:id', requirePermission('write'), asyncHandler(async (req, res) => {
    const documentId = req.params.id;
    const { assignTo } = req.body;

    logger.info('Assigning document', {
      documentId,
      assignTo,
      assignedBy: req.user.id
    });

    // Get job from queue
    const job = await queueManager.getJob('manual-review', documentId);
    
    if (!job) {
      throw new NotFoundError(`Document ${documentId} not found`);
    }

    await job.update({
      ...job.data,
      assignedTo: assignTo,
      assignedBy: req.user.id,
      assignedAt: new Date().toISOString()
    });

    res.json({
      success: true,
      message: 'Document assigned successfully',
      documentId,
      assignedTo: assignTo,
      timestamp: new Date().toISOString()
    });
  }));

  /**
   * Get review statistics
   */
  router.get('/stats', requirePermission('read'), asyncHandler(async (req, res) => {
    const { timeframe = '24h' } = req.query;

    logger.info('Getting review statistics', {
      timeframe,
      userId: req.user.id
    });

    // Use ingestionEngine if available, fallback to queueManager
    let result;
    if (ingestionEngine && ingestionEngine.getReviewStats) {
      result = await ingestionEngine.getReviewStats({ timeframe });
    } else {
      // Fallback to queueManager implementation
      const queueStats = await queueManager.getQueueStats('manual-review');
      
      // Get recent completed jobs for analysis
      const timeframeMins = timeframe === '24h' ? 1440 : timeframe === '7d' ? 10080 : 60;
      const since = new Date(Date.now() - timeframeMins * 60 * 1000); // eslint-disable-line no-unused-vars
      
      const recentJobs = await queueManager.getJobs('manual-review', ['completed'], 0, -1);

      // Calculate approval/rejection rates
      const completedJobs = recentJobs || [];
      const approved = completedJobs.filter(job => job.data?.decision === 'approve').length;
      const rejected = completedJobs.filter(job => job.data?.decision === 'reject').length;
      const flagged = completedJobs.filter(job => job.data?.flags?.length > 0).length;
      const total = approved + rejected;
      
      const approvalRate = total > 0 ? Math.round((approved / total) * 100) : 0;

      // Calculate average processing time
      const processingTimes = completedJobs
        .filter(job => job.finishedOn && job.processedOn)
        .map(job => job.finishedOn - job.processedOn);
      
      const avgProcessingTime = processingTimes.length > 0 
        ? Math.round(processingTimes.reduce((a, b) => a + b, 0) / processingTimes.length / 1000)
        : 0;

      result = {
        stats: {
          queue: {
            waiting: queueStats.waiting || 0,
            active: queueStats.active || 0,
            completed: queueStats.completed || 0
          },
          recent: {
            approved,
            rejected,
            flagged,
            approvalRate
          },
          performance: {
            avgReviewTime: avgProcessingTime,
            avgProcessingTime,
            documentsPerHour: avgProcessingTime > 0 ? Math.round(3600 / avgProcessingTime) : 0
          }
        }
      };
    }

    res.json(result);
  }));

  /**
   * Start review workflow for a document
   */
  router.post('/start-review/:id', requirePermission('write'), asyncHandler(async (req, res) => {
    const documentId = req.params.id;
    const { notes, priority } = req.body;

    logger.info('Starting review workflow', {
      documentId,
      notes,
      priority,
      userId: req.user.id
    });

    // Get job from queue
    const job = await queueManager.getJob('manual-review', documentId);
    
    if (!job) {
      throw new NotFoundError(`Document ${documentId} not found`);
    }

    // Log the start of review workflow
    await auditService.logCurationAction('START_REVIEW', documentId, {
      reviewStartedBy: req.user.id,
      notes: notes || '',
      priority: priority || job.opts?.priority,
      previousStatus: job.data.status || 'pending'
    });

    // Update job status to in-review
    const workflowData = {
      status: 'in-review',
      reviewStartedBy: req.user.id,
      reviewStartedAt: new Date().toISOString(),
      reviewNotes: notes || '',
      workflowStage: 'review',
      assignedTo: req.user.id
    };

    if (priority) {
      await job.changePriority(priority);
    }

    await job.update({
      ...job.data,
      ...workflowData
    });

    logger.info('Review workflow started successfully', {
      documentId,
      userId: req.user.id
    });

    res.json({
      success: true,
      message: 'Review workflow started',
      documentId,
      status: 'in-review',
      assignedTo: req.user.id,
      startedAt: new Date().toISOString()
    });
  }));

  /**
   * Bulk approve documents
   */
  router.post('/bulk/approve', requirePermission('approve'), asyncHandler(async (req, res) => {
    const { documentIds, notes, visibility = 'internal', tags = [] } = req.body;

    if (!documentIds || !Array.isArray(documentIds) || documentIds.length === 0) {
      throw new ValidationError('Document IDs array is required');
    }

    logger.info('Bulk approving documents', {
      documentIds,
      count: documentIds.length,
      notes,
      visibility,
      tags,
      userId: req.user.id
    });

    const results = [];
    const errors = [];

    for (const documentId of documentIds) {
      try {
        const job = await queueManager.getJob('manual-review', documentId);
        
        if (!job) {
          errors.push({ documentId, error: 'Document not found' });
          continue;
        }

        // Update job data with approval
        const approvalData = {
          status: 'approved',
          approvedBy: req.user.id,
          approvedAt: new Date().toISOString(),
          reviewNotes: notes || '',
          visibility,
          tags,
          decision: 'approve',
          bulkOperation: true
        };

        await job.update({
          ...job.data,
          ...approvalData
        });

        // Move to approved queue for further processing
        await queueManager.addJob('document-processing', {
          ...job.data,
          ...approvalData
        }, {
          priority: job.opts.priority || 0,
          attempts: 3
        });

        // Complete the review job
        await job.moveToCompleted('approved', true);

        results.push({ documentId, status: 'approved' });

      } catch (error) {
        logger.error('Error in bulk approve', { documentId, error: error.message });
        errors.push({ documentId, error: error.message });
      }
    }

    logger.info('Bulk approve completed', {
      successful: results.length,
      failed: errors.length,
      userId: req.user.id
    });

    res.json({
      success: true,
      message: `Bulk approval completed: ${results.length} successful, ${errors.length} failed`,
      results,
      errors,
      summary: {
        total: documentIds.length,
        successful: results.length,
        failed: errors.length
      }
    });
  }));

  /**
   * Bulk reject documents
   */
  router.post('/bulk/reject', requirePermission('reject'), asyncHandler(async (req, res) => {
    const { documentIds, reason, notes, permanent = false } = req.body;

    if (!documentIds || !Array.isArray(documentIds) || documentIds.length === 0) {
      throw new ValidationError('Document IDs array is required');
    }

    if (!reason) {
      throw new ValidationError('Rejection reason is required');
    }

    logger.info('Bulk rejecting documents', {
      documentIds,
      count: documentIds.length,
      reason,
      notes,
      permanent,
      userId: req.user.id
    });

    const results = [];
    const errors = [];

    for (const documentId of documentIds) {
      try {
        const job = await queueManager.getJob('manual-review', documentId);
        
        if (!job) {
          errors.push({ documentId, error: 'Document not found' });
          continue;
        }

        // Update job data with rejection
        const rejectionData = {
          status: 'rejected',
          rejectedBy: req.user.id,
          rejectedAt: new Date().toISOString(),
          rejectionReason: reason,
          reviewNotes: notes || '',
          permanent,
          decision: 'reject',
          bulkOperation: true
        };

        await job.update({
          ...job.data,
          ...rejectionData
        });

        if (permanent) {
          // Move to failed queue permanently
          await job.moveToFailed(new Error(`Rejected: ${reason}`), true);
        } else {
          // Move to rejected queue for potential re-review
          await queueManager.addJob('rejected-documents', {
            ...job.data,
            ...rejectionData
          }, {
            priority: 0,
            attempts: 1
          });
          
          await job.moveToCompleted('rejected', true);
        }

        results.push({ documentId, status: 'rejected' });

      } catch (error) {
        logger.error('Error in bulk reject', { documentId, error: error.message });
        errors.push({ documentId, error: error.message });
      }
    }

    logger.info('Bulk reject completed', {
      successful: results.length,
      failed: errors.length,
      userId: req.user.id
    });

    res.json({
      success: true,
      message: `Bulk rejection completed: ${results.length} successful, ${errors.length} failed`,
      results,
      errors,
      summary: {
        total: documentIds.length,
        successful: results.length,
        failed: errors.length
      }
    });
  }));

  /**
   * Bulk start review for documents
   */
  router.post('/bulk/start-review', requirePermission('write'), asyncHandler(async (req, res) => {
    const { documentIds, notes, assignTo } = req.body;

    if (!documentIds || !Array.isArray(documentIds) || documentIds.length === 0) {
      throw new ValidationError('Document IDs array is required');
    }

    logger.info('Bulk starting review', {
      documentIds,
      count: documentIds.length,
      notes,
      assignTo,
      userId: req.user.id
    });

    const results = [];
    const errors = [];

    for (const documentId of documentIds) {
      try {
        const job = await queueManager.getJob('manual-review', documentId);
        
        if (!job) {
          errors.push({ documentId, error: 'Document not found' });
          continue;
        }

        // Update job status to in-review
        const workflowData = {
          status: 'in-review',
          reviewStartedBy: req.user.id,
          reviewStartedAt: new Date().toISOString(),
          reviewNotes: notes || '',
          workflowStage: 'review',
          assignedTo: assignTo || req.user.id,
          bulkOperation: true
        };

        await job.update({
          ...job.data,
          ...workflowData
        });

        results.push({ documentId, status: 'in-review' });

      } catch (error) {
        logger.error('Error in bulk start review', { documentId, error: error.message });
        errors.push({ documentId, error: error.message });
      }
    }

    logger.info('Bulk start review completed', {
      successful: results.length,
      failed: errors.length,
      userId: req.user.id
    });

    res.json({
      success: true,
      message: `Bulk start review completed: ${results.length} successful, ${errors.length} failed`,
      results,
      errors,
      summary: {
        total: documentIds.length,
        successful: results.length,
        failed: errors.length
      }
    });
  }));

  /**
   * Bulk flag documents
   */
  router.post('/bulk/flag', requirePermission('write'), asyncHandler(async (req, res) => {
    const { documentIds, flag, type, notes, reason, priority = 1 } = req.body;

    if (!documentIds || !Array.isArray(documentIds) || documentIds.length === 0) {
      throw new ValidationError('Document IDs array is required');
    }

    // Accept either 'flag' or 'type' for the flag type
    const flagType = flag || type;
    // Accept either 'notes' or 'reason' for the flag reason
    const flagReason = notes || reason;

    if (!flagType) {
      throw new ValidationError('Flag type is required');
    }

    logger.info('Bulk flagging documents', {
      documentIds,
      count: documentIds.length,
      type: flagType,
      reason: flagReason,
      priority,
      userId: req.user.id
    });

    const results = [];
    const errors = [];

    for (const documentId of documentIds) {
      try {
        const job = await queueManager.getJob('manual-review', documentId);
        
        if (!job) {
          errors.push({ documentId, error: 'Document not found' });
          continue;
        }

        // Add flag to document
        const flagData = {
          id: `flag-${Date.now()}-${documentId}`,
          type: flagType,
          reason: flagReason || '',
          flaggedBy: req.user.id,
          flaggedAt: new Date().toISOString(),
          priority,
          resolved: false,
          bulkOperation: true
        };

        const flags = job.data.flags || [];
        flags.push(flagData);

        await job.update({
          ...job.data,
          flags
        });

        // Change job priority if specified
        if (priority > job.opts.priority) {
          await job.changePriority(priority);
        }

        // Log audit trail
        await auditService.logCurationAction({
          action: 'flag',
          resourceType: 'document',
          resourceId: documentId,
          userId: req.user.id,
          metadata: {
            flagType,
            reason: flagReason,
            priority,
            bulkOperation: true
          }
        });

        results.push({ documentId, status: 'flagged' });

      } catch (error) {
        logger.error('Error in bulk flag', { documentId, error: error.message });
        errors.push({ documentId, error: error.message });
      }
    }

    logger.info('Bulk flag completed', {
      successful: results.length,
      failed: errors.length,
      userId: req.user.id
    });

    res.json({
      success: true,
      message: `Bulk flagging completed: ${results.length} successful, ${errors.length} failed`,
      results,
      errors,
      summary: {
        total: documentIds.length,
        successful: results.length,
        failed: errors.length
      }
    });
  }));

  /**
   * Bulk assign documents
   */
  router.post('/bulk/assign', requirePermission('write'), asyncHandler(async (req, res) => {
    const { documentIds, assignTo, notes } = req.body;

    if (!documentIds || !Array.isArray(documentIds) || documentIds.length === 0) {
      throw new ValidationError('Document IDs array is required');
    }

    if (!assignTo) {
      throw new ValidationError('Assignee is required');
    }

    logger.info('Bulk assigning documents', {
      documentIds,
      count: documentIds.length,
      assignTo,
      notes,
      userId: req.user.id
    });

    const results = [];
    const errors = [];

    for (const documentId of documentIds) {
      try {
        const job = await queueManager.getJob('manual-review', documentId);
        
        if (!job) {
          errors.push({ documentId, error: 'Document not found' });
          continue;
        }

        // Update job with assignment
        await job.update({
          ...job.data,
          assignedTo: assignTo,
          assignedBy: req.user.id,
          assignedAt: new Date().toISOString(),
          assignmentNotes: notes || '',
          bulkOperation: true
        });

        // Log audit trail
        await auditService.logCurationAction({
          action: 'assign',
          resourceType: 'document',
          resourceId: documentId,
          userId: req.user.id,
          metadata: {
            assignTo,
            assignedBy: req.user.id,
            notes,
            bulkOperation: true
          }
        });

        results.push({ documentId, status: 'assigned', assignedTo: assignTo });

      } catch (error) {
        logger.error('Error in bulk assign', { documentId, error: error.message });
        errors.push({ documentId, error: error.message });
      }
    }

    logger.info('Bulk assign completed', {
      successful: results.length,
      failed: errors.length,
      userId: req.user.id
    });

    res.json({
      success: true,
      message: `Bulk assignment completed: ${results.length} successful, ${errors.length} failed`,
      results,
      errors,
      summary: {
        total: documentIds.length,
        successful: results.length,
        failed: errors.length
      }
    });
  }));

  /**
   * Bulk add tags to documents
   */
  router.post('/bulk/add-tags', requirePermission('write'), asyncHandler(async (req, res) => {
    const { documentIds, tags, notes } = req.body;

    if (!documentIds || !Array.isArray(documentIds) || documentIds.length === 0) {
      throw new ValidationError('Document IDs array is required');
    }

    if (!tags || !Array.isArray(tags) || tags.length === 0) {
      throw new ValidationError('Tags array is required');
    }

    logger.info('Bulk adding tags to documents', {
      documentIds,
      count: documentIds.length,
      tags,
      notes,
      userId: req.user.id
    });

    const results = [];
    const errors = [];

    for (const documentId of documentIds) {
      try {
        const job = await queueManager.getJob('manual-review', documentId);
        
        if (!job) {
          errors.push({ documentId, error: 'Document not found' });
          continue;
        }

        // Merge new tags with existing tags
        const existingTags = job.data.tags || [];
        const newTags = [...new Set([...existingTags, ...tags])]; // Remove duplicates

        await job.update({
          ...job.data,
          tags: newTags,
          lastTaggedBy: req.user.id,
          lastTaggedAt: new Date().toISOString(),
          taggingNotes: notes || '',
          bulkOperation: true
        });

        // Log audit trail
        await auditService.logCurationAction({
          action: 'add_tags',
          resourceType: 'document',
          resourceId: documentId,
          userId: req.user.id,
          metadata: {
            addedTags: tags,
            allTags: newTags,
            notes,
            bulkOperation: true
          }
        });

        results.push({ documentId, status: 'tagged', addedTags: tags, allTags: newTags });

      } catch (error) {
        logger.error('Error in bulk add tags', { documentId, error: error.message });
        errors.push({ documentId, error: error.message });
      }
    }

    logger.info('Bulk add tags completed', {
      successful: results.length,
      failed: errors.length,
      userId: req.user.id
    });

    res.json({
      success: true,
      message: `Bulk tagging completed: ${results.length} successful, ${errors.length} failed`,
      results,
      errors,
      summary: {
        total: documentIds.length,
        successful: results.length,
        failed: errors.length
      }
    });
  }));

  /**
   * Bulk remove tags from documents
   */
  router.post('/bulk/remove-tags', requirePermission('write'), asyncHandler(async (req, res) => {
    const { documentIds, tags, notes } = req.body;

    if (!documentIds || !Array.isArray(documentIds) || documentIds.length === 0) {
      throw new ValidationError('Document IDs array is required');
    }

    if (!tags || !Array.isArray(tags) || tags.length === 0) {
      throw new ValidationError('Tags array is required');
    }

    logger.info('Bulk removing tags from documents', {
      documentIds,
      count: documentIds.length,
      tags,
      notes,
      userId: req.user.id
    });

    const results = [];
    const errors = [];

    for (const documentId of documentIds) {
      try {
        const job = await queueManager.getJob('manual-review', documentId);
        
        if (!job) {
          errors.push({ documentId, error: 'Document not found' });
          continue;
        }

        // Remove specified tags from existing tags
        const existingTags = job.data.tags || [];
        const remainingTags = existingTags.filter(tag => !tags.includes(tag));

        await job.update({
          ...job.data,
          tags: remainingTags,
          lastTaggedBy: req.user.id,
          lastTaggedAt: new Date().toISOString(),
          taggingNotes: notes || '',
          bulkOperation: true
        });

        // Log audit trail
        await auditService.logCurationAction({
          action: 'remove_tags',
          resourceType: 'document',
          resourceId: documentId,
          userId: req.user.id,
          metadata: {
            removedTags: tags,
            remainingTags,
            notes,
            bulkOperation: true
          }
        });

        results.push({ documentId, status: 'untagged', removedTags: tags, remainingTags });

      } catch (error) {
        logger.error('Error in bulk remove tags', { documentId, error: error.message });
        errors.push({ documentId, error: error.message });
      }
    }

    logger.info('Bulk remove tags completed', {
      successful: results.length,
      failed: errors.length,
      userId: req.user.id
    });

    res.json({
      success: true,
      message: `Bulk tag removal completed: ${results.length} successful, ${errors.length} failed`,
      results,
      errors,
      summary: {
        total: documentIds.length,
        successful: results.length,
        failed: errors.length
      }
    });
  }));

  /**
   * Get workflow status for documents
   */
  router.get('/workflow/status', requirePermission('read'), asyncHandler(async (req, res) => {
    const { documentIds } = req.query;

    if (!documentIds) {
      throw new ValidationError('Document IDs are required');
    }

    const ids = Array.isArray(documentIds) ? documentIds : documentIds.split(',');

    logger.info('Getting workflow status', {
      documentIds: ids,
      count: ids.length,
      userId: req.user.id
    });

    const statuses = [];

    for (const documentId of ids) {
      try {
        const job = await queueManager.getJob('manual-review', documentId);
        
        if (!job) {
          statuses.push({
            documentId,
            status: 'not-found',
            error: 'Document not found'
          });
          continue;
        }

        statuses.push({
          documentId,
          status: job.data.status || 'pending',
          workflowStage: job.data.workflowStage || 'pending',
          assignedTo: job.data.assignedTo,
          reviewStartedAt: job.data.reviewStartedAt,
          lastUpdated: job.data.updatedAt || job.timestamp
        });

      } catch (error) {
        logger.error('Error getting workflow status', { documentId, error: error.message });
        statuses.push({
          documentId,
          status: 'error',
          error: error.message
        });
      }
    }

    res.json({
      success: true,
      statuses
    });
  }));

  /**
   * Get curation workflow metrics
   */
  router.get('/workflow/metrics', requirePermission('read'), asyncHandler(async (req, res) => {
    const { timeframe = '24h' } = req.query;

    logger.info('Getting workflow metrics', {
      timeframe,
      userId: req.user.id
    });

    // Get queue statistics
    const queueStats = await queueManager.getQueueStats('manual-review');
    
    // Get recent jobs for analysis
    const timeframeMins = timeframe === '24h' ? 1440 : timeframe === '7d' ? 10080 : 60;
    const since = new Date(Date.now() - timeframeMins * 60 * 1000); // eslint-disable-line no-unused-vars
    
    const recentJobs = await queueManager.getJobs('manual-review', ['completed', 'active'], 0, -1);
    const completedJobs = recentJobs || [];

    // Calculate workflow metrics
    const pending = completedJobs.filter(job => !job.data?.status || job.data.status === 'pending').length;
    const inReview = completedJobs.filter(job => job.data?.status === 'in-review').length;
    const approved = completedJobs.filter(job => job.data?.status === 'approved').length;
    const rejected = completedJobs.filter(job => job.data?.status === 'rejected').length;
    const flagged = completedJobs.filter(job => job.data?.flags?.length > 0).length;

    // Calculate throughput
    const total = approved + rejected;
    const approvalRate = total > 0 ? Math.round((approved / total) * 100) : 0;
    const rejectionRate = total > 0 ? Math.round((rejected / total) * 100) : 0;

    // Calculate average review times
    const reviewTimes = completedJobs
      .filter(job => job.data?.reviewStartedAt && job.finishedOn)
      .map(job => {
        const startTime = new Date(job.data.reviewStartedAt).getTime();
        return job.finishedOn - startTime;
      });
    
    const avgReviewTime = reviewTimes.length > 0 
      ? Math.round(reviewTimes.reduce((a, b) => a + b, 0) / reviewTimes.length / 1000)
      : 0;

    // Get assignee workload
    const assigneeWorkload = {};
    completedJobs.forEach(job => {
      const assignee = job.data?.assignedTo || 'unassigned';
      if (!assigneeWorkload[assignee]) {
        assigneeWorkload[assignee] = { pending: 0, inReview: 0, completed: 0 };
      }
      
      const status = job.data?.status || 'pending';
      if (status === 'pending') assigneeWorkload[assignee].pending++;
      else if (status === 'in-review') assigneeWorkload[assignee].inReview++;
      else assigneeWorkload[assignee].completed++;
    });

    const metrics = {
      queue: {
        waiting: queueStats.waiting || 0,
        active: queueStats.active || 0,
        completed: queueStats.completed || 0
      },
      workflow: {
        pending,
        inReview,
        approved,
        rejected,
        flagged
      },
      performance: {
        approvalRate,
        rejectionRate,
        avgReviewTime,
        throughputPerHour: avgReviewTime > 0 ? Math.round(3600 / avgReviewTime) : 0
      },
      workload: assigneeWorkload
    };

    res.json({
      success: true,
      metrics,
      timeframe
    });
  }));

  // ===== END CURATION WORKFLOW ENDPOINTS =====

  return router;
};
