const DatabaseManager = require('../database/DatabaseManager');
const logger = require('../utils/logger');

/**
 * Service for managing permissions and roles
 */
class PermissionService {
  constructor(database = null, options = {}) {
    this.db = database || DatabaseManager.getInstance().getDatabase();
    this.enableAuditLog = options.enableAuditLog || false;
    this.cache = new Map();
    this.cacheTTL = options.cacheTTL || 5 * 60 * 1000; // 5 minutes
    
    // System roles that cannot be modified
    this.systemRoles = ['admin', 'analyst', 'researcher', 'reviewer', 'viewer'];
    
    // Valid permissions
    this.validPermissions = [
      'documents:create', 'documents:read', 'documents:update', 'documents:delete',
      'documents:search', 'documents:export', 'documents:approve',
      'visibility:manage',
      'sources:create', 'sources:read', 'sources:update', 'sources:delete',
      'users:create', 'users:read', 'users:update', 'users:delete',
      'roles:manage',
      'reports:create', 'reports:read',
      'api_keys:manage',
      'system:admin',
      '*' // Wildcard for all permissions
    ];
  }
  
  /**
   * Get singleton instance
   */
  static getInstance() {
    if (!PermissionService.instance) {
      PermissionService.instance = new PermissionService();
    }
    return PermissionService.instance;
  }
  
  /**
   * Check if user has permission
   */
  async checkPermission(userId, resource, action) {
    try {
      // Check cache first
      const cacheKey = `${userId}:${resource}:${action}`;
      const cached = this.cache.get(cacheKey);
      
      if (cached && cached.expires > Date.now()) {
        return cached.value;
      }
      
      // Use database function
      const result = await this.db.query(
        'SELECT check_permission($1, $2, $3)',
        [userId, resource, action]
      );
      
      const hasPermission = result.rows[0]?.check_permission || false;
      
      // Cache result
      this.cache.set(cacheKey, {
        value: hasPermission,
        expires: Date.now() + this.cacheTTL
      });
      
      // Audit log if enabled
      if (this.enableAuditLog) {
        await this.logPermissionCheck(userId, resource, action, hasPermission);
      }
      
      return hasPermission;
      
    } catch (error) {
      logger.error('Permission check error:', error);
      return false; // Fail closed
    }
  }
  
  /**
   * Get all permissions for a user
   */
  async getUserPermissions(userId) {
    try {
      const result = await this.db.query(`
        SELECT r.permissions
        FROM users u
        JOIN roles r ON u.role_id = r.id
        WHERE u.id = $1 AND u.is_active = TRUE
      `, [userId]);
      
      if (result.rows.length === 0) {
        return [];
      }
      
      const permissions = result.rows[0].permissions;
      
      // Handle JSONB array or string array
      if (Array.isArray(permissions)) {
        return permissions;
      } else if (typeof permissions === 'string') {
        try {
          return JSON.parse(permissions);
        } catch {
          return [];
        }
      }
      
      return [];
      
    } catch (error) {
      logger.error('Failed to get user permissions:', error);
      return [];
    }
  }
  
  /**
   * Get permissions for a role
   */
  async getRolePermissions(roleNameOrId) {
    try {
      const isId = typeof roleNameOrId === 'number';
      const query = isId
        ? 'SELECT permissions FROM roles WHERE id = $1'
        : 'SELECT permissions FROM roles WHERE name = $1';
      
      const result = await this.db.query(query, [roleNameOrId]);
      
      if (result.rows.length === 0) {
        return [];
      }
      
      const permissions = result.rows[0].permissions;
      
      if (Array.isArray(permissions)) {
        return permissions;
      } else if (typeof permissions === 'string') {
        try {
          return JSON.parse(permissions);
        } catch {
          return [];
        }
      }
      
      return [];
      
    } catch (error) {
      logger.error('Failed to get role permissions:', error);
      return [];
    }
  }
  
  /**
   * Assign role to user
   */
  async assignRoleToUser(userId, roleNameOrId) {
    try {
      // First get role ID if name provided
      let roleId = roleNameOrId;
      
      if (typeof roleNameOrId === 'string') {
        const roleResult = await this.db.query(
          'SELECT id FROM roles WHERE name = $1',
          [roleNameOrId]
        );
        
        if (roleResult.rows.length === 0) {
          logger.warn('Role not found:', roleNameOrId);
          return false;
        }
        
        roleId = roleResult.rows[0].id;
      }
      
      // Update user's role
      const result = await this.db.query(`
        UPDATE users
        SET role_id = $2, updated_at = NOW()
        WHERE id = $1
        RETURNING id, role_id
      `, [userId, roleId]);
      
      if (result.rows.length === 0) {
        return false;
      }
      
      // Clear permission cache for user
      this.clearUserCache(userId);
      
      logger.info('Role assigned to user', {
        userId,
        roleId
      });
      
      return true;
      
    } catch (error) {
      logger.error('Failed to assign role:', error);
      throw error;
    }
  }
  
  /**
   * Create a new role
   */
  async createRole(roleData) {
    try {
      const { name, description, permissions } = roleData;
      
      // Prevent creating system roles
      if (this.systemRoles.includes(name)) {
        throw new Error('Cannot create system role');
      }
      
      // Validate permissions
      for (const perm of permissions) {
        if (!this.validPermissions.includes(perm)) {
          throw new Error(`Invalid permission: ${perm}`);
        }
      }
      
      const result = await this.db.query(`
        INSERT INTO roles (name, description, permissions, is_system)
        VALUES ($1, $2, $3, FALSE)
        RETURNING id, name, description, permissions
      `, [name, description, JSON.stringify(permissions)]);
      
      logger.info('Role created', {
        roleId: result.rows[0].id,
        name
      });
      
      return result.rows[0];
      
    } catch (error) {
      logger.error('Failed to create role:', error);
      throw error;
    }
  }
  
  /**
   * Update role permissions
   */
  async updateRolePermissions(roleId, permissions) {
    try {
      // Check if system role
      const roleResult = await this.db.query(
        'SELECT is_system FROM roles WHERE id = $1',
        [roleId]
      );
      
      if (roleResult.rows.length === 0) {
        throw new Error('Role not found');
      }
      
      if (roleResult.rows[0].is_system) {
        throw new Error('Cannot modify system role');
      }
      
      // Validate permissions
      for (const perm of permissions) {
        if (!this.validPermissions.includes(perm)) {
          throw new Error(`Invalid permission: ${perm}`);
        }
      }
      
      // Update permissions
      const result = await this.db.query(`
        UPDATE roles
        SET permissions = $2, updated_at = NOW()
        WHERE id = $1
        RETURNING id, permissions
      `, [roleId, JSON.stringify(permissions)]);
      
      // Clear cache for all users with this role
      await this.clearRoleCache(roleId);
      
      logger.info('Role permissions updated', {
        roleId,
        permissions
      });
      
      return true;
      
    } catch (error) {
      logger.error('Failed to update role permissions:', error);
      throw error;
    }
  }
  
  /**
   * Delete a role
   */
  async deleteRole(roleId) {
    try {
      // Check if system role
      const roleResult = await this.db.query(
        'SELECT is_system, name FROM roles WHERE id = $1',
        [roleId]
      );
      
      if (roleResult.rows.length === 0) {
        throw new Error('Role not found');
      }
      
      if (roleResult.rows[0].is_system) {
        throw new Error('Cannot delete system role');
      }
      
      // Delete role (users will have role_id set to NULL due to ON DELETE SET NULL)
      await this.db.query('DELETE FROM roles WHERE id = $1', [roleId]);
      
      logger.info('Role deleted', {
        roleId,
        name: roleResult.rows[0].name
      });
      
      return true;
      
    } catch (error) {
      logger.error('Failed to delete role:', error);
      throw error;
    }
  }
  
  /**
   * List all roles
   */
  async listRoles() {
    try {
      const result = await this.db.query(`
        SELECT 
          r.id, 
          r.name, 
          r.description, 
          r.permissions,
          r.is_system,
          COUNT(u.id) AS user_count
        FROM roles r
        LEFT JOIN users u ON u.role_id = r.id
        GROUP BY r.id
        ORDER BY r.name
      `);
      
      return result.rows.map(role => ({
        id: role.id,
        name: role.name,
        description: role.description,
        permissions: role.permissions,
        is_system: role.is_system,
        user_count: parseInt(role.user_count)
      }));
      
    } catch (error) {
      logger.error('Failed to list roles:', error);
      throw error;
    }
  }
  
  /**
   * Check if permissions array contains required permission
   */
  _hasPermission(permissions, resource, action) {
    // Check for wildcard
    if (permissions.includes('*')) {
      return true;
    }
    
    // Check for exact match
    const permission = `${resource}:${action}`;
    if (permissions.includes(permission)) {
      return true;
    }
    
    // Check for resource wildcard
    const resourceWildcard = `${resource}:*`;
    if (permissions.includes(resourceWildcard)) {
      return true;
    }
    
    return false;
  }
  
  /**
   * Clear cache for a user
   */
  clearUserCache(userId) {
    for (const [key] of this.cache) {
      if (key.startsWith(`${userId}:`)) {
        this.cache.delete(key);
      }
    }
  }
  
  /**
   * Clear cache for all users with a role
   */
  async clearRoleCache(roleId) {
    // Get all users with this role
    const result = await this.db.query(
      'SELECT id FROM users WHERE role_id = $1',
      [roleId]
    );
    
    for (const row of result.rows) {
      this.clearUserCache(row.id);
    }
  }
  
  /**
   * Log permission check for audit
   */
  async logPermissionCheck(userId, resource, action, granted) {
    try {
      await this.db.query(`
        INSERT INTO rbac_audit_log (user_id, action, resource_type, resource_id, new_value)
        VALUES ($1, $2, $3, $4, $5)
      `, [
        userId,
        'permission_check',
        resource,
        null,
        JSON.stringify({ action, granted })
      ]);
    } catch (error) {
      logger.warn('Failed to log permission check:', error);
    }
  }
}

module.exports = PermissionService;