const { Pool } = require('pg');
const EventEmitter = require('events');

/**
 * Database adapter for Document Visibility Management
 * Handles all database operations for visibility states, approvals, and access control
 */
class VisibilityDatabase extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || 5432),
      database: process.env.DB_NAME || 'thewell_pipeline',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || '',
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
      ...options
    };

    this.pool = new Pool(this.options);
    this.isConnected = false;
  }

  /**
   * Initialize database connection and create tables
   */
  async initialize() {
    try {
      // Test connection
      const client = await this.pool.connect();
      client.release();
      
      this.isConnected = true;
      this.emit('connected');
      
      // Initialize schema if needed
      await this.initializeSchema();
      
    } catch (error) {
      this.emit('error', error);
      throw new Error(`Failed to initialize visibility database: ${error.message}`);
    }
  }

  /**
   * Initialize database schema
   */
  async initializeSchema() {
    const fs = require('fs');
    const path = require('path');
    
    try {
      const schemaPath = path.join(__dirname, 'schemas', 'visibility.sql');
      const schema = fs.readFileSync(schemaPath, 'utf8');
      
      await this.pool.query(schema);
      this.emit('schemaInitialized');
      
    } catch (error) {
      this.emit('error', error);
      throw new Error(`Failed to initialize schema: ${error.message}`);
    }
  }

  /**
   * Set document visibility
   */
  async setDocumentVisibility(documentId, visibility, setBy, reason = null, metadata = {}) {
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Get current visibility
      const currentResult = await client.query(
        'SELECT visibility FROM document_visibility WHERE document_id = $1',
        [documentId]
      );
      
      const previousVisibility = currentResult.rows[0]?.visibility || null;
      
      // Insert or update visibility
      const visibilityResult = await client.query(`
        INSERT INTO document_visibility (document_id, visibility, previous_visibility, set_by, reason, metadata)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (document_id) 
        UPDATE SET 
          visibility = $2,
          previous_visibility = document_visibility.visibility,
          set_by = $4,
          set_at = CURRENT_TIMESTAMP,
          reason = $5,
          metadata = $6,
          updated_at = CURRENT_TIMESTAMP
        RETURNING *
      `, [documentId, visibility, previousVisibility, setBy, reason, JSON.stringify(metadata)]);
      
      // Log the change
      await client.query(`
        INSERT INTO visibility_audit_log (document_id, action, old_visibility, new_visibility, changed_by, reason, metadata)
        VALUES ($1, 'visibility_changed', $2, $3, $4, $5, $6)
      `, [documentId, previousVisibility, visibility, setBy, reason, JSON.stringify(metadata)]);
      
      await client.query('COMMIT');
      
      const result = visibilityResult.rows[0];
      this.emit('visibilityChanged', {
        documentId,
        oldVisibility: previousVisibility,
        newVisibility: visibility,
        changedBy: setBy,
        reason
      });
      
      return result;
      
    } catch (error) {
      await client.query('ROLLBACK');
      this.emit('error', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get document visibility
   */
  async getDocumentVisibility(documentId) {
    try {
      const result = await this.pool.query(
        'SELECT * FROM document_visibility WHERE document_id = $1',
        [documentId]
      );
      
      return result.rows[0] || null;
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Get multiple document visibilities
   */
  async getDocumentVisibilities(documentIds) {
    try {
      const result = await this.pool.query(
        'SELECT * FROM document_visibility WHERE document_id = ANY($1)',
        [documentIds]
      );
      
      return result.rows;
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Create approval request
   */
  async createApprovalRequest(approvalData) {
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Insert approval request
      const approvalResult = await client.query(`
        INSERT INTO visibility_approvals (
          approval_id, document_id, requested_visibility, current_visibility,
          requested_by, reason, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
      `, [
        approvalData.approvalId,
        approvalData.documentId,
        approvalData.visibility,
        approvalData.previousVisibility?.visibility,
        approvalData.setBy,
        approvalData.reason,
        JSON.stringify(approvalData.metadata)
      ]);
      
      // Log the approval request
      await client.query(`
        INSERT INTO visibility_audit_log (
          document_id, action, old_visibility, new_visibility, changed_by, reason, approval_id, metadata
        ) VALUES ($1, 'approval_requested', $2, $3, $4, $5, $6, $7)
      `, [
        approvalData.documentId,
        approvalData.previousVisibility?.visibility,
        approvalData.visibility,
        approvalData.setBy,
        approvalData.reason,
        approvalData.approvalId,
        JSON.stringify(approvalData.metadata)
      ]);
      
      await client.query('COMMIT');
      
      const result = approvalResult.rows[0];
      this.emit('approvalRequested', result);
      
      return result;
      
    } catch (error) {
      await client.query('ROLLBACK');
      this.emit('error', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get pending approvals
   */
  async getPendingApprovals(filters = {}) {
    try {
      let query = 'SELECT * FROM visibility_approvals WHERE status = $1';
      const params = ['pending'];
      let paramIndex = 2;
      
      if (filters.visibility) {
        query += ` AND requested_visibility = $${paramIndex}`;
        params.push(filters.visibility);
        paramIndex++;
      }
      
      if (filters.requestedBy) {
        query += ` AND requested_by = $${paramIndex}`;
        params.push(filters.requestedBy);
        paramIndex++;
      }
      
      if (filters.since) {
        query += ` AND requested_at >= $${paramIndex}`;
        params.push(filters.since);
        paramIndex++;
      }
      
      query += ' ORDER BY requested_at DESC';
      
      const result = await this.pool.query(query, params);
      return result.rows;
      
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Approve visibility change
   */
  async approveVisibilityChange(approvalId, approvedBy, notes = '') {
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Get approval request
      const approvalResult = await client.query(
        'SELECT * FROM visibility_approvals WHERE approval_id = $1 AND status = $2',
        [approvalId, 'pending']
      );
      
      if (approvalResult.rows.length === 0) {
        throw new Error(`Approval request ${approvalId} not found or already processed`);
      }
      
      const approval = approvalResult.rows[0];
      
      // Update approval status
      await client.query(`
        UPDATE visibility_approvals 
        SET status = 'approved', reviewed_by = $1, reviewed_at = CURRENT_TIMESTAMP, review_notes = $2, updated_at = CURRENT_TIMESTAMP
        WHERE approval_id = $3
      `, [approvedBy, notes, approvalId]);
      
      // Apply the visibility change
      await client.query(`
        INSERT INTO document_visibility (document_id, visibility, previous_visibility, set_by, reason, metadata)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (document_id) 
        UPDATE SET 
          visibility = $2,
          previous_visibility = document_visibility.visibility,
          set_by = $4,
          set_at = CURRENT_TIMESTAMP,
          reason = $5,
          metadata = $6,
          updated_at = CURRENT_TIMESTAMP
      `, [
        approval.document_id,
        approval.requested_visibility,
        approval.current_visibility,
        approvedBy,
        `Approved visibility change: ${notes}`,
        JSON.stringify({ approvalId, approvedBy, originalRequestedBy: approval.requested_by })
      ]);
      
      // Log the approval
      await client.query(`
        INSERT INTO visibility_audit_log (
          document_id, action, old_visibility, new_visibility, changed_by, reason, approval_id, metadata
        ) VALUES ($1, 'approval_granted', $2, $3, $4, $5, $6, $7)
      `, [
        approval.document_id,
        approval.current_visibility,
        approval.requested_visibility,
        approvedBy,
        notes,
        approvalId,
        JSON.stringify({ originalRequestedBy: approval.requested_by })
      ]);
      
      await client.query('COMMIT');
      
      this.emit('visibilityApproved', {
        approvalId,
        documentId: approval.document_id,
        oldVisibility: approval.current_visibility,
        newVisibility: approval.requested_visibility,
        approvedBy,
        notes
      });
      
      return {
        success: true,
        documentId: approval.document_id,
        visibility: approval.requested_visibility,
        approvedBy,
        approvedAt: new Date().toISOString()
      };
      
    } catch (error) {
      await client.query('ROLLBACK');
      this.emit('error', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Reject visibility change
   */
  async rejectVisibilityChange(approvalId, rejectedBy, reason = '') {
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Get approval request
      const approvalResult = await client.query(
        'SELECT * FROM visibility_approvals WHERE approval_id = $1 AND status = $2',
        [approvalId, 'pending']
      );
      
      if (approvalResult.rows.length === 0) {
        throw new Error(`Approval request ${approvalId} not found or already processed`);
      }
      
      const approval = approvalResult.rows[0];
      
      // Update approval status
      await client.query(`
        UPDATE visibility_approvals 
        SET status = 'rejected', reviewed_by = $1, reviewed_at = CURRENT_TIMESTAMP, review_notes = $2, updated_at = CURRENT_TIMESTAMP
        WHERE approval_id = $3
      `, [rejectedBy, reason, approvalId]);
      
      // Log the rejection
      await client.query(`
        INSERT INTO visibility_audit_log (
          document_id, action, old_visibility, new_visibility, changed_by, reason, approval_id, metadata
        ) VALUES ($1, 'approval_rejected', $2, $3, $4, $5, $6, $7)
      `, [
        approval.document_id,
        approval.current_visibility,
        approval.requested_visibility,
        rejectedBy,
        reason,
        approvalId,
        JSON.stringify({ originalRequestedBy: approval.requested_by })
      ]);
      
      await client.query('COMMIT');
      
      this.emit('visibilityRejected', {
        approvalId,
        documentId: approval.document_id,
        requestedVisibility: approval.requested_visibility,
        rejectedBy,
        reason
      });
      
      return {
        success: true,
        approvalId,
        status: 'rejected',
        rejectedBy,
        rejectedAt: new Date().toISOString(),
        reason
      };
      
    } catch (error) {
      await client.query('ROLLBACK');
      this.emit('error', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get user permissions
   */
  async getUserPermissions(userId) {
    try {
      const result = await this.pool.query(
        'SELECT * FROM user_permissions WHERE user_id = $1 AND active = true AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)',
        [userId]
      );
      
      if (result.rows.length === 0) {
        return null;
      }
      
      // Combine permissions from all roles
      const permissions = new Set();
      const visibilityLevels = new Set();
      const roles = [];
      
      for (const row of result.rows) {
        roles.push(row.role);
        
        if (row.permissions) {
          row.permissions.forEach(perm => permissions.add(perm));
        }
        
        if (row.visibility_levels) {
          row.visibility_levels.forEach(level => visibilityLevels.add(level));
        }
      }
      
      return {
        userId,
        roles,
        permissions: Array.from(permissions),
        visibilityLevels: Array.from(visibilityLevels)
      };
      
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Log document access
   */
  async logDocumentAccess(documentId, userId, accessType, accessGranted, metadata = {}) {
    try {
      await this.pool.query(`
        INSERT INTO document_access_log (
          document_id, user_id, access_type, access_granted, 
          document_visibility, user_permissions, ip_address, user_agent, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [
        documentId,
        userId,
        accessType,
        accessGranted,
        metadata.documentVisibility || null,
        JSON.stringify(metadata.userPermissions || {}),
        metadata.ipAddress || null,
        metadata.userAgent || null,
        JSON.stringify(metadata)
      ]);
      
    } catch (error) {
      this.emit('error', error);
      // Don't throw here as access logging shouldn't break the main flow
    }
  }

  /**
   * Get visibility audit log
   */
  async getVisibilityAuditLog(documentId, limit = 50) {
    try {
      const result = await this.pool.query(
        'SELECT * FROM visibility_audit_log WHERE document_id = $1 ORDER BY changed_at DESC LIMIT $2',
        [documentId, limit]
      );
      
      return result.rows;
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Close database connection
   */
  async close() {
    try {
      await this.pool.end();
      this.isConnected = false;
      this.emit('disconnected');
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }
}

module.exports = VisibilityDatabase;
