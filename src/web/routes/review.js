/**
 * Review Routes
 * API endpoints for manual review of ingested documents
 */

const express = require('express');
const { asyncHandler, ValidationError, NotFoundError } = require('../middleware/errorHandler');
const { requirePermission } = require('../middleware/auth');
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
      const jobs = await queueManager.getJobs('manual-review', {
        page: parseInt(page),
        limit: parseInt(limit)
      });

      const documents = jobs.jobs.map(job => ({
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
        pagination: jobs.pagination
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
      success: true,
      message: 'Document approved successfully',
      documentId,
      status: 'approved',
      approvedBy: req.user.id,
      approvedAt: new Date().toISOString()
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
      success: true,
      message: 'Document rejected successfully',
      documentId,
      status: 'rejected',
      reason,
      rejectedBy: req.user.id,
      rejectedAt: new Date().toISOString(),
      permanent
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
      success: true,
      message: 'Document flagged successfully',
      documentId,
      flag: {
        type: flagType,
        reason: flagReason,
        priority,
        flaggedBy: req.user.id,
        flaggedAt: new Date().toISOString()
      }
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
      const queueStats = await queueManager.getQueueStats();
      
      // Get recent completed jobs for analysis
      const timeframeMins = timeframe === '24h' ? 1440 : timeframe === '7d' ? 10080 : 60;
      const since = new Date(Date.now() - timeframeMins * 60 * 1000);
      
      const recentJobs = await queueManager.getJobs('manual-review', {
        status: 'completed',
        since: since.toISOString()
      });

      // Calculate approval/rejection rates
      const completedJobs = recentJobs.jobs || [];
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
            reviewing: queueStats.active || 0,
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

  return router;
}
