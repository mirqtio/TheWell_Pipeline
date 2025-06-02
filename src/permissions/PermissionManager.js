/**
 * Permission Manager
 * Comprehensive permission enforcement system for document-level access control
 */

const logger = require('../utils/logger');
const DatabaseManager = require('../database/DatabaseManager');

class PermissionManager {
  constructor(options = {}) {
    this.db = options.db || new DatabaseManager();
    this.cacheEnabled = options.cacheEnabled !== false;
    this.cacheTTL = options.cacheTTL || 3600; // 1 hour default
    this.permissionCache = new Map();
  }

  /**
   * Initialize the permission manager
   */
  async initialize() {
    try {
      await this.db.initialize();
      logger.info('PermissionManager initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize PermissionManager', { error: error.message });
      throw error;
    }
  }

  /**
   * Check if user has permission for a specific action on a resource
   */
  async hasPermission(userId, permissionName, resourceType = null, resourceId = null) {
    try {
      // Check cache first
      const cacheKey = this._getCacheKey(userId, permissionName, resourceType, resourceId);
      if (this.cacheEnabled && this.permissionCache.has(cacheKey)) {
        const cached = this.permissionCache.get(cacheKey);
        if (cached.expires > Date.now()) {
          logger.debug('Permission check cache hit', { userId, permissionName, resourceType, resourceId });
          return cached.granted;
        }
        this.permissionCache.delete(cacheKey);
      }

      // Check database
      const granted = await this._checkPermissionInDatabase(userId, permissionName, resourceType, resourceId);

      // Cache result
      if (this.cacheEnabled) {
        this.permissionCache.set(cacheKey, {
          granted,
          expires: Date.now() + (this.cacheTTL * 1000)
        });
      }

      logger.debug('Permission check completed', { 
        userId, 
        permissionName, 
        resourceType, 
        resourceId, 
        granted 
      });

      return granted;
    } catch (error) {
      logger.error('Permission check failed', { 
        userId, 
        permissionName, 
        resourceType, 
        resourceId, 
        error: error.message 
      });
      return false; // Fail closed
    }
  }

  /**
   * Filter documents based on user's access permissions
   */
  async filterDocumentsByPermission(userId, documentIds, action = 'read') {
    try {
      if (!documentIds || documentIds.length === 0) {
        return [];
      }

      const client = await this.db.pool.connect();
      
      try {
        // Get documents that user can access
        const result = await client.query(`
          WITH user_document_access AS (
            -- Direct document access grants
            SELECT DISTINCT dag.document_id, 'direct' as access_source
            FROM document_access_grants dag
            WHERE dag.user_id = $1 
            AND dag.permission_type = $2
            AND dag.is_active = true
            AND (dag.expires_at IS NULL OR dag.expires_at > NOW())
            AND dag.document_id = ANY($3)
            
            UNION
            
            -- Role-based document access grants
            SELECT DISTINCT dag.document_id, 'role' as access_source
            FROM document_access_grants dag
            JOIN user_roles ur ON dag.role_id = ur.role_id
            WHERE ur.user_id = $1 
            AND dag.permission_type = $2
            AND dag.is_active = true
            AND ur.is_active = true
            AND (dag.expires_at IS NULL OR dag.expires_at > NOW())
            AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
            AND dag.document_id = ANY($3)
            
            UNION
            
            -- Policy-based access (public/internal documents)
            SELECT DISTINCT dap.document_id, 'policy' as access_source
            FROM document_access_policies dap
            WHERE dap.document_id = ANY($3)
            AND (
              dap.access_level = 'public'
              OR (dap.access_level = 'internal' AND EXISTS (
                SELECT 1 FROM user_roles ur 
                JOIN roles r ON ur.role_id = r.id 
                WHERE ur.user_id = $1 AND ur.is_active = true
                AND r.name != 'guest'
              ))
            )
          )
          SELECT document_id FROM user_document_access
        `, [userId, action, documentIds]);

        return result.rows.map(row => row.document_id);
      } finally {
        client.release();
      }
    } catch (error) {
      logger.error('Failed to filter documents by permission', { 
        userId, 
        documentCount: documentIds.length, 
        action, 
        error: error.message 
      });
      return []; // Fail closed - return no documents on error
    }
  }

  /**
   * Check document access permission
   */
  async canAccessDocument(userId, documentId, action = 'read') {
    try {
      const accessibleDocs = await this.filterDocumentsByPermission(userId, [documentId], action);
      return accessibleDocs.includes(documentId);
    } catch (error) {
      logger.error('Failed to check document access', { userId, documentId, action, error: error.message });
      return false;
    }
  }

  /**
   * Log access attempt for audit trail
   */
  async logAccess(userId, resourceType, resourceId, action, granted, metadata = {}) {
    try {
      const client = await this.db.pool.connect();
      
      try {
        await client.query(`
          INSERT INTO access_logs (
            user_id, resource_type, resource_id, action, access_granted,
            ip_address, user_agent, endpoint, method, trace_id,
            status_code, response_time_ms, denial_reason
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        `, [
          userId,
          resourceType,
          resourceId,
          action,
          granted,
          metadata.ipAddress || null,
          metadata.userAgent || null,
          metadata.endpoint || null,
          metadata.method || null,
          metadata.traceId || null,
          metadata.statusCode || null,
          metadata.responseTimeMs || null,
          metadata.denialReason || null
        ]);
      } finally {
        client.release();
      }
    } catch (error) {
      logger.error('Failed to log access', { 
        userId, 
        resourceType, 
        resourceId, 
        action, 
        granted, 
        error: error.message 
      });
      // Don't throw - logging failure shouldn't break the main flow
    }
  }

  /**
   * Clear permission cache for user
   */
  clearUserCache(userId) {
    if (!this.cacheEnabled) return;
    
    const keysToDelete = [];
    for (const [key] of this.permissionCache) {
      if (key.startsWith(`${userId}:`)) {
        keysToDelete.push(key);
      }
    }
    
    keysToDelete.forEach(key => this.permissionCache.delete(key));
    logger.debug('Cleared permission cache for user', { userId, keysCleared: keysToDelete.length });
  }

  /**
   * Clear all permission cache
   */
  clearCache() {
    if (this.cacheEnabled) {
      this.permissionCache.clear();
      logger.debug('Cleared all permission cache');
    }
  }

  // Private methods
  _getCacheKey(userId, permissionName, resourceType, resourceId) {
    return `${userId}:${permissionName}:${resourceType || ''}:${resourceId || ''}`;
  }

  async _checkPermissionInDatabase(userId, permissionName, resourceType, resourceId) {
    const client = await this.db.pool.connect();
    
    try {
      // Check for explicit user permission (grants or denials)
      const userPermissionResult = await client.query(`
        SELECT up.is_granted
        FROM user_permissions up
        JOIN permissions p ON up.permission_id = p.id
        WHERE up.user_id = $1 
        AND p.name = $2
        AND (up.resource_type = $3 OR up.resource_type IS NULL)
        AND (up.resource_id = $4 OR up.resource_id IS NULL)
        AND (up.expires_at IS NULL OR up.expires_at > NOW())
        ORDER BY up.resource_id IS NOT NULL DESC, up.resource_type IS NOT NULL DESC
        LIMIT 1
      `, [userId, permissionName, resourceType, resourceId]);

      if (userPermissionResult.rows.length > 0) {
        return userPermissionResult.rows[0].is_granted;
      }

      // Check role-based permissions
      const rolePermissionResult = await client.query(`
        SELECT 1
        FROM user_roles ur
        JOIN role_permissions rp ON ur.role_id = rp.role_id
        JOIN permissions p ON rp.permission_id = p.id
        WHERE ur.user_id = $1 
        AND p.name = $2
        AND ur.is_active = true
        AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
        AND (rp.resource_type = $3 OR rp.resource_type IS NULL)
        AND (rp.resource_id = $4 OR rp.resource_id IS NULL)
        LIMIT 1
      `, [userId, permissionName, resourceType, resourceId]);

      return rolePermissionResult.rows.length > 0;
    } finally {
      client.release();
    }
  }
}

module.exports = PermissionManager;
