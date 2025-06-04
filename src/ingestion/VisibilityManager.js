const EventEmitter = require('events');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

/**
 * Document Visibility Management System
 * Handles document visibility states, access controls, and workflow integration
 * Now uses ORM models instead of raw SQL for better consistency
 */
class VisibilityManager extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      defaultVisibility: 'internal',
      allowedVisibilities: ['internal', 'external', 'restricted', 'public', 'private', 'draft', 'archived'],
      requireApprovalFor: ['external', 'public'],
      ...options
    };

    // ORM models should be injected
    this.models = options.models || {};
    this.sequelize = options.sequelize;
    
    if (!this.models.DocumentVisibility || !this.models.VisibilityApproval || !this.models.VisibilityAuditLog) {
      logger.warn('VisibilityManager initialized without ORM models - some features will be limited');
    }
  }

  /**
   * Visibility states enum
   */
  static VISIBILITY_STATES = {
    INTERNAL: 'internal',     // Only visible to internal users
    EXTERNAL: 'external',     // Visible to external partners
    RESTRICTED: 'restricted', // Requires special permissions
    PUBLIC: 'public',         // Publicly accessible
    PRIVATE: 'private',       // Private documents
    DRAFT: 'draft',          // Work in progress
    ARCHIVED: 'archived'      // Historical/inactive
  };

  /**
   * Access levels enum
   */
  static ACCESS_LEVELS = {
    READ: 'read',
    WRITE: 'write',
    ADMIN: 'admin',
    APPROVE: 'approve'
  };

  /**
   * Set document visibility with validation
   */
  async setDocumentVisibility(documentId, visibility, metadata = {}) {
    this._validateVisibility(visibility);

    const transaction = this.sequelize ? await this.sequelize.transaction() : null;

    try {
      // Get current visibility
      const currentVisibility = await this.getDocumentVisibility(documentId);
      
      // Check if approval is required
      if (this._requiresApproval(visibility)) {
        const approval = await this._requestApproval(
          documentId,
          visibility,
          currentVisibility?.visibility || this.options.defaultVisibility,
          metadata,
          transaction
        );
        
        if (transaction) await transaction.commit();
        return approval;
      }

      // Apply visibility immediately
      const result = await this._applyVisibility(
        documentId,
        visibility,
        currentVisibility?.visibility,
        metadata,
        transaction
      );
      
      if (transaction) await transaction.commit();
      return result;
      
    } catch (error) {
      if (transaction) await transaction.rollback();
      this.emit('error', { 
        type: 'visibility_update_failed', 
        documentId, 
        error: error.message 
      });
      throw error;
    }
  }

  /**
   * Get document visibility state
   */
  async getDocumentVisibility(documentId) {
    if (!this.models.DocumentVisibility) {
      // Fallback for when models aren't available
      return {
        documentId,
        visibility: this.options.defaultVisibility,
        setBy: 'system',
        setAt: new Date(),
        reason: 'Default visibility'
      };
    }

    try {
      const visibility = await this.models.DocumentVisibility.findOne({
        where: { documentId }
      });

      if (!visibility) {
        // Create default visibility record
        return await this.models.DocumentVisibility.create({
          documentId,
          visibility: this.options.defaultVisibility,
          setBy: 'system',
          setAt: new Date(),
          reason: 'Initial visibility'
        });
      }

      return visibility;
    } catch (error) {
      logger.error('Failed to get document visibility:', error);
      throw error;
    }
  }

  /**
   * Check if user has access to document
   */
  async checkAccess(documentId, userId, requiredLevel = VisibilityManager.ACCESS_LEVELS.READ) {
    try {
      const visibility = await this.getDocumentVisibility(documentId);
      
      if (!visibility) {
        return false;
      }

      // Public documents are accessible to everyone
      if (visibility.visibility === 'public') {
        return true;
      }

      // Private documents require explicit permission
      if (visibility.visibility === 'private') {
        // Check user permissions - would need UserPermission model
        return false;
      }

      // Internal documents are accessible to authenticated users
      if (visibility.visibility === 'internal' && userId) {
        return true;
      }

      // For other visibility levels, check specific permissions
      return this._checkUserPermissions(userId, visibility.visibility, requiredLevel);
      
    } catch (error) {
      logger.error('Access check failed:', error);
      return false;
    }
  }

  /**
   * Request approval for visibility change
   */
  async _requestApproval(documentId, requestedVisibility, currentVisibility, metadata, transaction) {
    if (!this.models.VisibilityApproval) {
      throw new Error('VisibilityApproval model not available');
    }

    const approvalId = uuidv4();
    
    const approval = await this.models.VisibilityApproval.create({
      approvalId,
      documentId,
      requestedVisibility,
      currentVisibility,
      requestedBy: metadata.userId || 'system',
      requestedAt: new Date(),
      reason: metadata.reason || 'Visibility change requested',
      status: 'pending',
      metadata: metadata
    }, { transaction });

    // Log the request
    await this._logVisibilityChange(
      documentId,
      'approval_requested',
      {
        approvalId,
        requestedVisibility,
        currentVisibility,
        requestedBy: metadata.userId
      },
      transaction
    );

    this.emit('approval_requested', {
      approvalId,
      documentId,
      requestedVisibility,
      currentVisibility,
      requestedBy: metadata.userId
    });

    return {
      success: true,
      approvalId,
      status: 'pending_approval',
      message: `Visibility change to '${requestedVisibility}' requires approval`
    };
  }

  /**
   * Apply visibility change immediately
   */
  async _applyVisibility(documentId, visibility, previousVisibility, metadata, transaction) {
    if (!this.models.DocumentVisibility) {
      throw new Error('DocumentVisibility model not available');
    }

    // Update or create visibility record
    const [visibilityRecord, created] = await this.models.DocumentVisibility.findOrCreate({
      where: { documentId },
      defaults: {
        documentId,
        visibility,
        previousVisibility,
        setBy: metadata.userId || 'system',
        setAt: new Date(),
        reason: metadata.reason || 'Visibility updated',
        metadata
      },
      transaction
    });

    if (!created) {
      await visibilityRecord.updateVisibility(
        visibility,
        metadata.userId || 'system',
        metadata.reason || 'Visibility updated'
      );
    }

    // Update the main document table if needed
    if (this.models.Document) {
      await this.models.Document.update(
        { visibility },
        { 
          where: { id: documentId },
          transaction
        }
      );
    }

    // Log the change
    await this._logVisibilityChange(
      documentId,
      'visibility_changed',
      {
        visibility,
        previousVisibility,
        setBy: metadata.userId
      },
      transaction
    );

    this.emit('visibility_changed', {
      documentId,
      visibility,
      previousVisibility,
      setBy: metadata.userId
    });

    return {
      success: true,
      documentId,
      visibility,
      previousVisibility,
      message: `Visibility changed to '${visibility}'`
    };
  }

  /**
   * Approve visibility change request
   */
  async approveVisibilityChange(approvalId, reviewedBy, reviewNotes = '') {
    if (!this.models.VisibilityApproval) {
      throw new Error('VisibilityApproval model not available');
    }

    const transaction = this.sequelize ? await this.sequelize.transaction() : null;

    try {
      const approval = await this.models.VisibilityApproval.findOne({
        where: { approvalId }
      });

      if (!approval) {
        throw new Error('Approval request not found');
      }

      if (!approval.isPending()) {
        throw new Error('Approval request is not pending');
      }

      // Update approval status
      await approval.approve(reviewedBy, reviewNotes);

      // Apply the visibility change
      const result = await this._applyVisibility(
        approval.documentId,
        approval.requestedVisibility,
        approval.currentVisibility,
        {
          userId: reviewedBy,
          reason: `Approved: ${reviewNotes}`,
          approvalId
        },
        transaction
      );

      if (transaction) await transaction.commit();

      this.emit('approval_completed', {
        approvalId,
        documentId: approval.documentId,
        status: 'approved',
        reviewedBy
      });

      return result;

    } catch (error) {
      if (transaction) await transaction.rollback();
      throw error;
    }
  }

  /**
   * Reject visibility change request
   */
  async rejectVisibilityChange(approvalId, reviewedBy, reviewNotes = '') {
    if (!this.models.VisibilityApproval) {
      throw new Error('VisibilityApproval model not available');
    }

    const approval = await this.models.VisibilityApproval.findOne({
      where: { approvalId }
    });

    if (!approval) {
      throw new Error('Approval request not found');
    }

    if (!approval.isPending()) {
      throw new Error('Approval request is not pending');
    }

    await approval.reject(reviewedBy, reviewNotes);

    await this._logVisibilityChange(
      approval.documentId,
      'approval_rejected',
      {
        approvalId,
        rejectedBy: reviewedBy,
        reason: reviewNotes
      }
    );

    this.emit('approval_completed', {
      approvalId,
      documentId: approval.documentId,
      status: 'rejected',
      reviewedBy
    });

    return {
      success: true,
      approvalId,
      status: 'rejected',
      message: 'Visibility change request rejected'
    };
  }

  /**
   * Get pending approval requests
   */
  async getPendingApprovals(filters = {}) {
    if (!this.models.VisibilityApproval) {
      return [];
    }

    const whereClause = { status: 'pending' };
    
    if (filters.documentId) {
      whereClause.documentId = filters.documentId;
    }
    
    if (filters.requestedBy) {
      whereClause.requestedBy = filters.requestedBy;
    }

    return await this.models.VisibilityApproval.findAll({
      where: whereClause,
      order: [['requestedAt', 'ASC']]
    });
  }

  /**
   * Log visibility changes for audit trail
   */
  async _logVisibilityChange(documentId, action, details, transaction) {
    if (!this.models.VisibilityAuditLog) {
      logger.warn('VisibilityAuditLog model not available - skipping audit log');
      return;
    }

    try {
      await this.models.VisibilityAuditLog.create({
        entityType: 'document',
        entityId: documentId,
        action,
        performedBy: details.setBy || details.requestedBy || details.rejectedBy || 'system',
        details,
        ipAddress: details.ipAddress,
        userAgent: details.userAgent,
        timestamp: new Date()
      }, { transaction });
    } catch (error) {
      logger.error('Failed to log visibility change:', error);
      // Don't throw - audit logging failure shouldn't break the operation
    }
  }

  /**
   * Validate visibility value
   */
  _validateVisibility(visibility) {
    if (!this.options.allowedVisibilities.includes(visibility)) {
      throw new Error(`Invalid visibility: ${visibility}. Allowed values: ${this.options.allowedVisibilities.join(', ')}`);
    }
  }

  /**
   * Check if visibility change requires approval
   */
  _requiresApproval(visibility) {
    return this.options.requireApprovalFor.includes(visibility);
  }

  /**
   * Check user permissions for visibility level
   */
  async _checkUserPermissions(userId, visibility, requiredLevel) {
    // This would check against UserPermission model
    // For now, return basic logic
    if (!userId) return false;
    
    // Simplified permission check
    switch (visibility) {
    case 'external':
      return requiredLevel === 'read';
    case 'restricted':
      return false; // Would check user groups
    default:
      return true;
    }
  }

  /**
   * Get visibility statistics
   */
  async getVisibilityStats() {
    if (!this.models.DocumentVisibility) {
      return {};
    }

    const stats = await this.models.DocumentVisibility.findAll({
      attributes: [
        'visibility',
        [this.sequelize.fn('COUNT', '*'), 'count']
      ],
      group: ['visibility']
    });

    return stats.reduce((acc, stat) => {
      acc[stat.visibility] = parseInt(stat.dataValues.count);
      return acc;
    }, {});
  }

  /**
   * Initialize visibility for a batch of documents
   */
  async initializeDocumentVisibility(documentIds, visibility = null) {
    if (!this.models.DocumentVisibility || !Array.isArray(documentIds) || documentIds.length === 0) {
      return;
    }

    const visibilityRecords = documentIds.map(documentId => ({
      documentId,
      visibility: visibility || this.options.defaultVisibility,
      setBy: 'system',
      setAt: new Date(),
      reason: 'Initial visibility assignment'
    }));

    try {
      await this.models.DocumentVisibility.bulkCreate(visibilityRecords, {
        ignoreDuplicates: true
      });
      
      logger.info(`Initialized visibility for ${documentIds.length} documents`);
    } catch (error) {
      logger.error('Failed to initialize document visibility:', error);
      throw error;
    }
  }
}

module.exports = VisibilityManager;