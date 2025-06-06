const express = require('express');
const router = express.Router();
const PermissionService = require('../../services/PermissionService');
const { requireAuth, requirePermission, auditLog } = require('../middleware/rbac');
const logger = require('../../utils/logger');

// Services
const permissionService = PermissionService.getInstance();

/**
 * @route GET /api/v1/roles
 * @desc List all roles
 * @access Private - requires roles:manage permission
 */
router.get('/',
  requireAuth(),
  requirePermission('roles', 'manage'),
  async (req, res) => {
    try {
      const roles = await permissionService.listRoles();
      
      res.json({
        success: true,
        data: roles,
        count: roles.length
      });
    } catch (error) {
      logger.error('Failed to list roles:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to list roles'
      });
    }
  }
);

/**
 * @route GET /api/v1/roles/:id
 * @desc Get role by ID
 * @access Private - requires roles:manage permission
 */
router.get('/:id',
  requireAuth(),
  requirePermission('roles', 'manage'),
  async (req, res) => {
    try {
      const roleId = parseInt(req.params.id);
      const permissions = await permissionService.getRolePermissions(roleId);
      
      if (permissions.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Role not found'
        });
      }
      
      res.json({
        success: true,
        data: {
          id: roleId,
          permissions
        }
      });
    } catch (error) {
      logger.error('Failed to get role:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get role'
      });
    }
  }
);

/**
 * @route POST /api/v1/roles
 * @desc Create new role
 * @access Private - requires roles:manage permission
 */
router.post('/',
  requireAuth(),
  requirePermission('roles', 'manage'),
  auditLog(async (entry) => {
    logger.info('Role created audit:', entry);
  }),
  async (req, res) => {
    try {
      const { name, description, permissions } = req.body;
      
      if (!name || !permissions || !Array.isArray(permissions)) {
        return res.status(400).json({
          success: false,
          error: 'Name and permissions array are required'
        });
      }
      
      const role = await permissionService.createRole({
        name,
        description,
        permissions
      });
      
      res.status(201).json({
        success: true,
        data: role
      });
    } catch (error) {
      logger.error('Failed to create role:', error);
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to create role'
      });
    }
  }
);

/**
 * @route PUT /api/v1/roles/:id/permissions
 * @desc Update role permissions
 * @access Private - requires roles:manage permission
 */
router.put('/:id/permissions',
  requireAuth(),
  requirePermission('roles', 'manage'),
  auditLog(async (entry) => {
    logger.info('Role permissions updated audit:', entry);
  }),
  async (req, res) => {
    try {
      const roleId = parseInt(req.params.id);
      const { permissions } = req.body;
      
      if (!permissions || !Array.isArray(permissions)) {
        return res.status(400).json({
          success: false,
          error: 'Permissions array is required'
        });
      }
      
      await permissionService.updateRolePermissions(roleId, permissions);
      
      res.json({
        success: true,
        message: 'Role permissions updated successfully'
      });
    } catch (error) {
      logger.error('Failed to update role permissions:', error);
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to update role permissions'
      });
    }
  }
);

/**
 * @route DELETE /api/v1/roles/:id
 * @desc Delete role
 * @access Private - requires roles:manage permission
 */
router.delete('/:id',
  requireAuth(),
  requirePermission('roles', 'manage'),
  auditLog(async (entry) => {
    logger.info('Role deleted audit:', entry);
  }),
  async (req, res) => {
    try {
      const roleId = parseInt(req.params.id);
      
      await permissionService.deleteRole(roleId);
      
      res.json({
        success: true,
        message: 'Role deleted successfully'
      });
    } catch (error) {
      logger.error('Failed to delete role:', error);
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to delete role'
      });
    }
  }
);

/**
 * @route GET /api/v1/roles/permissions/list
 * @desc List all available permissions
 * @access Private - requires roles:manage permission
 */
router.get('/permissions/list',
  requireAuth(),
  requirePermission('roles', 'manage'),
  async (req, res) => {
    try {
      // Get valid permissions from service
      const permissions = permissionService.validPermissions.map(perm => {
        const [resource, action] = perm.split(':');
        return {
          permission: perm,
          resource,
          action,
          description: getPermissionDescription(perm)
        };
      });
      
      res.json({
        success: true,
        data: permissions,
        count: permissions.length
      });
    } catch (error) {
      logger.error('Failed to list permissions:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to list permissions'
      });
    }
  }
);

/**
 * Get human-readable description for permission
 */
function getPermissionDescription(permission) {
  const descriptions = {
    'documents:create': 'Create new documents',
    'documents:read': 'View documents',
    'documents:update': 'Update existing documents',
    'documents:delete': 'Delete documents',
    'documents:search': 'Search documents',
    'documents:export': 'Export documents',
    'documents:approve': 'Approve document changes',
    'visibility:manage': 'Manage document visibility',
    'sources:create': 'Create data sources',
    'sources:read': 'View data sources',
    'sources:update': 'Update data sources',
    'sources:delete': 'Delete data sources',
    'users:create': 'Create users',
    'users:read': 'View users',
    'users:update': 'Update users',
    'users:delete': 'Delete users',
    'roles:manage': 'Manage roles and permissions',
    'reports:create': 'Create reports',
    'reports:read': 'View reports',
    'api_keys:manage': 'Manage API keys',
    'system:admin': 'System administration',
    '*': 'All permissions'
  };
  
  return descriptions[permission] || permission;
}

module.exports = router;