/**
 * AuditService - Comprehensive audit trail service for curation workflow
 * Provides application-level audit logging beyond database triggers
 */

const { Op, fn, col } = require('sequelize');
const logger = require('../utils/logger');

class AuditService {
  constructor(ormManager = null) {
    this.ormManager = ormManager;
    this.context = {
      userId: null,
      sessionId: null,
      ipAddress: null,
      userAgent: null
    };
  }

  /**
   * Set audit context for subsequent operations
   */
  setContext(context) {
    this.context = {
      ...this.context,
      ...context
    };
  }

  /**
   * Clear audit context
   */
  clearContext() {
    this.context = {
      userId: null,
      sessionId: null,
      ipAddress: null,
      userAgent: null
    };
  }

  /**
   * Log a curation workflow action
   */
  async logCurationAction(action, documentId, details = {}) {
    try {
      const auditData = {
        tableName: 'curation_workflow',
        operation: action.toUpperCase(),
        recordId: documentId,
        newValues: {
          action,
          documentId,
          timestamp: new Date().toISOString(),
          ...details
        },
        userId: this.context.userId,
        sessionId: this.context.sessionId,
        ipAddress: this.context.ipAddress,
        userAgent: this.context.userAgent
      };

      const auditEntry = await this.AuditLog.create(auditData);
      
      logger.info('Curation action logged', {
        auditId: auditEntry.id,
        action,
        documentId,
        userId: this.context.userId
      });

      return auditEntry;
    } catch (error) {
      logger.error('Failed to log curation action', {
        error: error.message,
        action,
        documentId,
        userId: this.context.userId
      });
      throw error;
    }
  }

  /**
   * Log document review action
   */
  async logReviewAction(documentId, action, reviewData = {}) {
    const details = {
      reviewAction: action,
      reason: reviewData.reason,
      modifications: reviewData.modifications,
      confidenceScore: reviewData.confidenceScore,
      reviewTimeSeconds: reviewData.reviewTimeSeconds,
      sessionId: reviewData.sessionId
    };

    return this.logCurationAction('REVIEW', documentId, details);
  }

  /**
   * Log bulk operation
   */
  async logBulkOperation(operation, documentIds, results = {}) {
    const details = {
      operation,
      documentCount: documentIds.length,
      documentIds,
      successCount: results.successCount || 0,
      errorCount: results.errorCount || 0,
      errors: results.errors || []
    };

    return this.logCurationAction('BULK_OPERATION', null, details);
  }

  /**
   * Log workflow status change
   */
  async logStatusChange(documentId, oldStatus, newStatus, reason = null) {
    const details = {
      oldStatus,
      newStatus,
      reason,
      statusChangeType: 'workflow_status'
    };

    return this.logCurationAction('STATUS_CHANGE', documentId, details);
  }

  /**
   * Log visibility change
   */
  async logVisibilityChange(documentId, oldVisibility, newVisibility, reason = null) {
    const details = {
      oldVisibility,
      newVisibility,
      reason,
      changeType: 'visibility'
    };

    return this.logCurationAction('VISIBILITY_CHANGE', documentId, details);
  }

  /**
   * Log user session activity
   */
  async logSessionActivity(sessionId, activity, details = {}) {
    const auditData = {
      tableName: 'user_sessions',
      operation: 'SESSION_ACTIVITY',
      recordId: sessionId,
      newValues: {
        activity,
        sessionId,
        timestamp: new Date().toISOString(),
        ...details
      },
      userId: this.context.userId,
      sessionId: this.context.sessionId,
      ipAddress: this.context.ipAddress,
      userAgent: this.context.userAgent
    };

    try {
      const auditEntry = await this.AuditLog.create(auditData);
      
      logger.debug('Session activity logged', {
        auditId: auditEntry.id,
        activity,
        sessionId,
        userId: this.context.userId
      });

      return auditEntry;
    } catch (error) {
      logger.error('Failed to log session activity', {
        error: error.message,
        activity,
        sessionId,
        userId: this.context.userId
      });
      throw error;
    }
  }

  /**
   * Get audit trail for a specific document
   */
  async getDocumentAuditTrail(documentId, options = {}) {
    try {
      const {
        limit = 100,
        offset = 0,
        startDate,
        endDate,
        actions = null
      } = options;

      const whereClause = {
        recordId: documentId
      };

      // Filter by date range if provided
      if (startDate || endDate) {
        const { Op } = require('sequelize');
        whereClause.timestamp = {};
        if (startDate) whereClause.timestamp[Op.gte] = startDate;
        if (endDate) whereClause.timestamp[Op.lte] = endDate;
      }

      // Filter by specific actions if provided
      if (actions && Array.isArray(actions)) {
        const { Op } = require('sequelize');
        whereClause.operation = {
          [Op.in]: actions.map(action => action.toUpperCase())
        };
      }

      const auditEntries = await this.AuditLog.findAll({
        where: whereClause,
        order: [['timestamp', 'DESC']],
        limit,
        offset
      });

      return auditEntries;
    } catch (error) {
      logger.error('Failed to get document audit trail', {
        error: error.message,
        documentId
      });
      throw error;
    }
  }

  /**
   * Get audit trail for a user
   */
  async getUserAuditTrail(userId, options = {}) {
    try {
      const {
        limit = 100,
        offset = 0,
        startDate,
        endDate,
        tables = null
      } = options;

      const whereClause = {
        userId
      };

      // Filter by date range if provided
      if (startDate || endDate) {
        const { Op } = require('sequelize');
        whereClause.timestamp = {};
        if (startDate) whereClause.timestamp[Op.gte] = startDate;
        if (endDate) whereClause.timestamp[Op.lte] = endDate;
      }

      // Filter by specific tables if provided
      if (tables && Array.isArray(tables)) {
        const { Op } = require('sequelize');
        whereClause.tableName = {
          [Op.in]: tables
        };
      }

      const auditEntries = await this.AuditLog.findAll({
        where: whereClause,
        order: [['timestamp', 'DESC']],
        limit,
        offset
      });

      return auditEntries;
    } catch (error) {
      logger.error('Failed to get user audit trail', {
        error: error.message,
        userId
      });
      throw error;
    }
  }

  /**
   * Get audit summary statistics
   */
  async getAuditSummary(options = {}) {
    try {
      const {
        startDate,
        endDate,
        groupBy = 'operation'
      } = options;

      const whereClause = {};
      if (startDate || endDate) {
        whereClause.timestamp = {};
        if (startDate) whereClause.timestamp[Op.gte] = startDate;
        if (endDate) whereClause.timestamp[Op.lte] = endDate;
      }

      const summary = await this.AuditLog.findAll({
        attributes: [
          groupBy,
          [fn('COUNT', col('id')), 'count'],
          [fn('COUNT', fn('DISTINCT', col('userId'))), 'uniqueUsers'],
          [fn('MIN', col('timestamp')), 'firstOperation'],
          [fn('MAX', col('timestamp')), 'lastOperation']
        ],
        where: whereClause,
        group: [groupBy],
        order: [[fn('COUNT', col('id')), 'DESC']]
      });

      return summary;
    } catch (error) {
      logger.error('Failed to get audit summary', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Clean old audit logs based on retention policy
   */
  async cleanOldLogs(retentionDays = 90) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

      const deletedCount = await this.AuditLog.destroy({
        where: {
          timestamp: {
            [Op.lt]: cutoffDate
          }
        }
      });

      logger.info('Old audit logs cleaned', {
        deletedCount,
        retentionDays,
        cutoffDate
      });

      return deletedCount;
    } catch (error) {
      logger.error('Failed to clean old audit logs', {
        error: error.message,
        retentionDays
      });
      throw error;
    }
  }
}

// Export singleton instance
module.exports = new AuditService();
