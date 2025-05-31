const EventEmitter = require('events');

/**
 * Document Visibility Management System
 * Handles document visibility states, access controls, and workflow integration
 */
class VisibilityManager extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      defaultVisibility: 'internal',
      allowedVisibilities: ['internal', 'external', 'restricted', 'public'],
      requireApprovalFor: ['external', 'public'],
      ...options
    };

    this.visibilityRules = new Map();
    this.accessPolicies = new Map();
    this.pendingApprovals = new Map();
  }

  /**
   * Visibility states enum
   */
  static VISIBILITY_STATES = {
    INTERNAL: 'internal',     // Only visible to internal users
    EXTERNAL: 'external',     // Visible to external partners
    RESTRICTED: 'restricted', // Requires special permissions
    PUBLIC: 'public',         // Publicly accessible
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

    const visibilityData = {
      documentId,
      visibility,
      previousVisibility: await this.getDocumentVisibility(documentId),
      setBy: metadata.userId || 'system',
      setAt: new Date().toISOString(),
      reason: metadata.reason || 'Manual update',
      approvalRequired: this._requiresApproval(visibility),
      metadata
    };

    // Check if approval is required
    if (visibilityData.approvalRequired) {
      return await this._requestApproval(visibilityData);
    }

    // Apply visibility immediately
    return await this._applyVisibility(visibilityData);
  }

  /**
   * Get document visibility state
   */
  async getDocumentVisibility(documentId) {
    try {
      // In a real implementation, this would query the database
      // For now, return default visibility
      return {
        documentId,
        visibility: this.options.defaultVisibility,
        setBy: 'system',
        setAt: new Date().toISOString(),
        approvalStatus: 'approved'
      };
    } catch (error) {
      this.emit('error', { 
        type: 'visibility_query_failed', 
        documentId, 
        error: error.message 
      });
      throw error;
    }
  }

  /**
   * Check if user has access to document
   */
  async checkAccess(documentId, userId, accessLevel = VisibilityManager.ACCESS_LEVELS.READ) {
    try {
      const visibility = await this.getDocumentVisibility(documentId);
      const userPermissions = await this.getUserPermissions(userId);

      return this._evaluateAccess(visibility, userPermissions, accessLevel);
    } catch (error) {
      this.emit('error', { 
        type: 'access_check_failed', 
        documentId, 
        userId, 
        error: error.message 
      });
      return false;
    }
  }

  /**
   * Bulk update document visibilities
   */
  async bulkUpdateVisibility(updates, metadata = {}) {
    const results = [];
    const errors = [];

    for (const update of updates) {
      try {
        const result = await this.setDocumentVisibility(
          update.documentId, 
          update.visibility, 
          { ...metadata, ...update.metadata }
        );
        results.push(result);
      } catch (error) {
        errors.push({
          documentId: update.documentId,
          error: error.message
        });
      }
    }

    this.emit('bulkUpdate', { 
      successful: results.length, 
      failed: errors.length, 
      errors 
    });

    return { results, errors };
  }

  /**
   * Get documents pending approval
   */
  async getPendingApprovals(filters = {}) {
    const pending = Array.from(this.pendingApprovals.values());
    
    let filtered = pending;
    
    if (filters.visibility) {
      filtered = filtered.filter(item => item.visibility === filters.visibility);
    }
    
    if (filters.requestedBy) {
      filtered = filtered.filter(item => item.setBy === filters.requestedBy);
    }
    
    if (filters.since) {
      const since = new Date(filters.since);
      filtered = filtered.filter(item => new Date(item.setAt) >= since);
    }

    return filtered.sort((a, b) => new Date(b.setAt) - new Date(a.setAt));
  }

  /**
   * Approve visibility change
   */
  async approveVisibilityChange(approvalId, approvedBy, notes = '') {
    const approval = this.pendingApprovals.get(approvalId);
    
    if (!approval) {
      throw new Error(`Approval request ${approvalId} not found`);
    }

    const approvalData = {
      ...approval,
      approvedBy,
      approvedAt: new Date().toISOString(),
      approvalNotes: notes,
      status: 'approved'
    };

    // Apply the visibility change
    const result = await this._applyVisibility(approvalData);
    
    // Remove from pending approvals
    this.pendingApprovals.delete(approvalId);

    this.emit('visibilityApproved', approvalData);
    
    return result;
  }

  /**
   * Reject visibility change
   */
  async rejectVisibilityChange(approvalId, rejectedBy, reason = '') {
    const approval = this.pendingApprovals.get(approvalId);
    
    if (!approval) {
      throw new Error(`Approval request ${approvalId} not found`);
    }

    const rejectionData = {
      ...approval,
      rejectedBy,
      rejectedAt: new Date().toISOString(),
      rejectionReason: reason,
      status: 'rejected'
    };

    // Remove from pending approvals
    this.pendingApprovals.delete(approvalId);

    this.emit('visibilityRejected', rejectionData);
    
    return rejectionData;
  }

  /**
   * Add visibility rule
   */
  addVisibilityRule(ruleId, rule) {
    this._validateRule(rule);
    this.visibilityRules.set(ruleId, {
      ...rule,
      createdAt: new Date().toISOString()
    });
    
    this.emit('ruleAdded', { ruleId, rule });
  }

  /**
   * Remove visibility rule
   */
  removeVisibilityRule(ruleId) {
    const removed = this.visibilityRules.delete(ruleId);
    if (removed) {
      this.emit('ruleRemoved', { ruleId });
    }
    return removed;
  }

  /**
   * Get user permissions
   */
  async getUserPermissions(userId) {
    // In a real implementation, this would query user roles/permissions
    // For now, return basic permissions
    return {
      userId,
      roles: ['reviewer'],
      permissions: [
        VisibilityManager.ACCESS_LEVELS.READ,
        VisibilityManager.ACCESS_LEVELS.WRITE
      ],
      visibilityLevels: ['internal', 'external']
    };
  }

  /**
   * Apply visibility rules to document
   */
  async applyVisibilityRules(documentId, documentMetadata) {
    const applicableRules = this._findApplicableRules(documentMetadata);
    
    if (applicableRules.length === 0) {
      return this.options.defaultVisibility;
    }

    // Apply rules in priority order
    const sortedRules = applicableRules.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    
    for (const rule of sortedRules) {
      if (this._evaluateRuleConditions(rule, documentMetadata)) {
        this.emit('ruleApplied', { 
          documentId, 
          ruleId: rule.id, 
          visibility: rule.visibility 
        });
        
        return rule.visibility;
      }
    }

    return this.options.defaultVisibility;
  }

  /**
   * Private methods
   */

  _validateVisibility(visibility) {
    if (!this.options.allowedVisibilities.includes(visibility)) {
      throw new Error(`Invalid visibility: ${visibility}. Allowed: ${this.options.allowedVisibilities.join(', ')}`);
    }
  }

  _requiresApproval(visibility) {
    return this.options.requireApprovalFor.includes(visibility);
  }

  async _requestApproval(visibilityData) {
    const approvalId = `approval_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const approvalRequest = {
      ...visibilityData,
      approvalId,
      status: 'pending',
      requestedAt: new Date().toISOString()
    };

    this.pendingApprovals.set(approvalId, approvalRequest);
    
    this.emit('approvalRequested', approvalRequest);
    
    return {
      success: true,
      approvalId,
      status: 'pending_approval',
      message: `Visibility change to '${visibilityData.visibility}' requires approval`
    };
  }

  async _applyVisibility(visibilityData) {
    try {
      // In a real implementation, this would update the database
      // For now, emit the change event
      
      this.emit('visibilityChanged', {
        documentId: visibilityData.documentId,
        oldVisibility: visibilityData.previousVisibility?.visibility,
        newVisibility: visibilityData.visibility,
        changedBy: visibilityData.setBy,
        changedAt: visibilityData.setAt,
        reason: visibilityData.reason
      });

      return {
        success: true,
        documentId: visibilityData.documentId,
        visibility: visibilityData.visibility,
        appliedAt: new Date().toISOString()
      };
    } catch (error) {
      this.emit('error', { 
        type: 'visibility_apply_failed', 
        documentId: visibilityData.documentId, 
        error: error.message 
      });
      throw error;
    }
  }

  _evaluateAccess(visibility, userPermissions, accessLevel) {
    // Check if user has required access level
    if (!userPermissions.permissions.includes(accessLevel)) {
      return false;
    }

    // Check if user can access this visibility level
    if (!userPermissions.visibilityLevels.includes(visibility.visibility)) {
      return false;
    }

    return true;
  }

  _validateRule(rule) {
    if (!rule.conditions || !rule.visibility) {
      throw new Error('Rule must have conditions and visibility');
    }
    
    this._validateVisibility(rule.visibility);
  }

  _findApplicableRules(documentMetadata) {
    return Array.from(this.visibilityRules.values()).filter(rule => {
      return this._ruleMatchesDocument(rule, documentMetadata);
    });
  }

  _ruleMatchesDocument(rule, documentMetadata) {
    // Simple rule matching - can be extended for complex conditions
    if (rule.conditions.sourceType && documentMetadata.sourceType !== rule.conditions.sourceType) {
      return false;
    }
    
    if (rule.conditions.fileType && documentMetadata.fileType !== rule.conditions.fileType) {
      return false;
    }
    
    if (rule.conditions.tags && rule.conditions.tags.length > 0) {
      const documentTags = documentMetadata.tags || [];
      const hasRequiredTags = rule.conditions.tags.every(tag => documentTags.includes(tag));
      if (!hasRequiredTags) {
        return false;
      }
    }

    return true;
  }

  _evaluateRuleConditions(rule, documentMetadata) {
    // Additional condition evaluation logic
    // For now, if the rule matches the document, conditions are met
    return true;
  }
}

module.exports = VisibilityManager;
