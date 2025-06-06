const express = require('express');
const router = express.Router();
const ApiKeyService = require('../../services/ApiKeyService');
const PermissionService = require('../../services/PermissionService');
const { requireAuth, requirePermission, auditLog } = require('../middleware/rbac');
const logger = require('../../utils/logger');

// Services
const apiKeyService = ApiKeyService.getInstance();
const permissionService = PermissionService.getInstance();

/**
 * @route GET /api/v1/users/me
 * @desc Get current user info
 * @access Private
 */
router.get('/me', 
  requireAuth(),
  async (req, res) => {
    try {
      const user = req.user;
      const permissions = await permissionService.getUserPermissions(user.id);
      
      res.json({
        success: true,
        data: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          permissions
        }
      });
    } catch (error) {
      logger.error('Failed to get user info:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get user information'
      });
    }
  }
);

/**
 * @route GET /api/v1/users/:id
 * @desc Get user by ID
 * @access Private - requires users:read permission
 */
router.get('/:id',
  requireAuth(),
  requirePermission('users', 'read'),
  async (req, res) => {
    try {
      const userId = parseInt(req.params.id);
      
      // TODO: Implement user lookup
      res.json({
        success: true,
        data: {
          id: userId,
          message: 'User lookup not yet implemented'
        }
      });
    } catch (error) {
      logger.error('Failed to get user:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get user'
      });
    }
  }
);

/**
 * @route PUT /api/v1/users/:id/role
 * @desc Update user role
 * @access Private - requires users:update permission
 */
router.put('/:id/role',
  requireAuth(),
  requirePermission('users', 'update'),
  auditLog(async (entry) => {
    logger.info('Role assignment audit:', entry);
  }),
  async (req, res) => {
    try {
      const userId = parseInt(req.params.id);
      const { role } = req.body;
      
      if (!role) {
        return res.status(400).json({
          success: false,
          error: 'Role is required'
        });
      }
      
      const success = await permissionService.assignRoleToUser(userId, role);
      
      if (!success) {
        return res.status(404).json({
          success: false,
          error: 'User or role not found'
        });
      }
      
      res.json({
        success: true,
        message: 'Role assigned successfully'
      });
    } catch (error) {
      logger.error('Failed to assign role:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to assign role'
      });
    }
  }
);

/**
 * @route GET /api/v1/users/me/api-keys
 * @desc List current user's API keys
 * @access Private
 */
router.get('/me/api-keys',
  requireAuth(),
  async (req, res) => {
    try {
      const keys = await apiKeyService.listUserApiKeys(req.user.id);
      
      res.json({
        success: true,
        data: keys,
        count: keys.length
      });
    } catch (error) {
      logger.error('Failed to list API keys:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to list API keys'
      });
    }
  }
);

/**
 * @route POST /api/v1/users/me/api-keys
 * @desc Generate new API key
 * @access Private
 */
router.post('/me/api-keys',
  requireAuth(),
  auditLog(async (entry) => {
    logger.security('API key created:', entry);
  }),
  async (req, res) => {
    try {
      const { name, expiresIn, metadata } = req.body;
      
      if (!name) {
        return res.status(400).json({
          success: false,
          error: 'Key name is required'
        });
      }
      
      const apiKey = await apiKeyService.generateApiKey(
        req.user.id,
        name,
        { expiresIn, metadata }
      );
      
      res.status(201).json({
        success: true,
        data: apiKey,
        message: 'API key created. Store it securely - it cannot be retrieved again.'
      });
    } catch (error) {
      logger.error('Failed to generate API key:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to generate API key'
      });
    }
  }
);

/**
 * @route POST /api/v1/users/me/api-keys/:id/rotate
 * @desc Rotate API key
 * @access Private
 */
router.post('/me/api-keys/:id/rotate',
  requireAuth(),
  auditLog(async (entry) => {
    logger.security('API key rotated:', entry);
  }),
  async (req, res) => {
    try {
      const keyId = parseInt(req.params.id);
      const { gracePeriodMinutes = 60 } = req.body;
      
      const newKey = await apiKeyService.rotateApiKey(keyId, gracePeriodMinutes);
      
      res.json({
        success: true,
        data: newKey,
        message: `Old key will expire in ${gracePeriodMinutes} minutes`
      });
    } catch (error) {
      logger.error('Failed to rotate API key:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to rotate API key'
      });
    }
  }
);

/**
 * @route DELETE /api/v1/users/me/api-keys/:id
 * @desc Revoke API key
 * @access Private
 */
router.delete('/me/api-keys/:id',
  requireAuth(),
  auditLog(async (entry) => {
    logger.security('API key revoked:', entry);
  }),
  async (req, res) => {
    try {
      const keyId = parseInt(req.params.id);
      
      const success = await apiKeyService.revokeApiKey(keyId, req.user.id);
      
      if (!success) {
        return res.status(404).json({
          success: false,
          error: 'API key not found'
        });
      }
      
      res.json({
        success: true,
        message: 'API key revoked successfully'
      });
    } catch (error) {
      logger.error('Failed to revoke API key:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to revoke API key'
      });
    }
  }
);

module.exports = router;