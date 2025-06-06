const ApiKeyService = require('../../services/ApiKeyService');
const PermissionService = require('../../services/PermissionService');
const logger = require('../../utils/logger');

/**
 * RBAC (Role-Based Access Control) middleware
 */
class RBACMiddleware {
  constructor() {
    this.apiKeyService = ApiKeyService.getInstance();
    this.permissionService = PermissionService.getInstance();
  }
  
  /**
   * Require authentication via API key
   */
  requireAuth() {
    return async (req, res, next) => {
      try {
        const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');
        
        if (!apiKey) {
          return res.status(401).json({
            success: false,
            error: 'API key required'
          });
        }
        
        // Validate API key
        const isValid = await this.apiKeyService.validateApiKey(apiKey);
        
        if (!isValid) {
          return res.status(401).json({
            success: false,
            error: 'Invalid or expired API key'
          });
        }
        
        // Get user from API key
        const user = await this.apiKeyService.getUserFromApiKey(apiKey);
        
        if (!user) {
          return res.status(401).json({
            success: false,
            error: 'User not found'
          });
        }
        
        // Attach user to request
        req.user = user;
        req.apiKey = apiKey;
        
        // Record API key usage
        await this.apiKeyService.recordApiKeyUsage(apiKey).catch(err => {
          logger.warn('Failed to record API key usage:', err);
        });
        
        next();
      } catch (error) {
        logger.error('Authentication error:', error);
        res.status(500).json({
          success: false,
          error: 'Authentication failed'
        });
      }
    };
  }
  
  /**
   * Require specific permission
   */
  requirePermission(resource, action) {
    return async (req, res, next) => {
      try {
        if (!req.user) {
          return res.status(401).json({
            success: false,
            error: 'Authentication required'
          });
        }
        
        const hasPermission = await this.permissionService.checkPermission(
          req.user.id,
          resource,
          action
        );
        
        if (!hasPermission) {
          logger.warn('Permission denied', {
            userId: req.user.id,
            resource,
            action,
            path: req.path
          });
          
          return res.status(403).json({
            success: false,
            error: 'Insufficient permissions'
          });
        }
        
        next();
      } catch (error) {
        logger.error('Permission check error:', error);
        res.status(500).json({
          success: false,
          error: 'Permission check failed'
        });
      }
    };
  }
  
  /**
   * Require any of the specified permissions (OR logic)
   */
  requireAnyPermission(permissions) {
    return async (req, res, next) => {
      try {
        if (!req.user) {
          return res.status(401).json({
            success: false,
            error: 'Authentication required'
          });
        }
        
        for (const perm of permissions) {
          const hasPermission = await this.permissionService.checkPermission(
            req.user.id,
            perm.resource,
            perm.action
          );
          
          if (hasPermission) {
            return next();
          }
        }
        
        logger.warn('All permissions denied', {
          userId: req.user.id,
          permissions,
          path: req.path
        });
        
        return res.status(403).json({
          success: false,
          error: 'Insufficient permissions'
        });
      } catch (error) {
        logger.error('Permission check error:', error);
        res.status(500).json({
          success: false,
          error: 'Permission check failed'
        });
      }
    };
  }
  
  /**
   * Require all of the specified permissions (AND logic)
   */
  requireAllPermissions(permissions) {
    return async (req, res, next) => {
      try {
        if (!req.user) {
          return res.status(401).json({
            success: false,
            error: 'Authentication required'
          });
        }
        
        for (const perm of permissions) {
          const hasPermission = await this.permissionService.checkPermission(
            req.user.id,
            perm.resource,
            perm.action
          );
          
          if (!hasPermission) {
            logger.warn('Permission denied', {
              userId: req.user.id,
              resource: perm.resource,
              action: perm.action,
              path: req.path
            });
            
            return res.status(403).json({
              success: false,
              error: 'Insufficient permissions'
            });
          }
        }
        
        next();
      } catch (error) {
        logger.error('Permission check error:', error);
        res.status(500).json({
          success: false,
          error: 'Permission check failed'
        });
      }
    };
  }
  
  /**
   * Require specific role
   */
  requireRole(roles) {
    const allowedRoles = Array.isArray(roles) ? roles : [roles];
    
    return async (req, res, next) => {
      try {
        if (!req.user) {
          return res.status(401).json({
            success: false,
            error: 'Authentication required'
          });
        }
        
        if (!allowedRoles.includes(req.user.role)) {
          logger.warn('Role check failed', {
            userId: req.user.id,
            userRole: req.user.role,
            requiredRoles: allowedRoles,
            path: req.path
          });
          
          return res.status(403).json({
            success: false,
            error: 'Insufficient role privileges'
          });
        }
        
        next();
      } catch (error) {
        logger.error('Role check error:', error);
        res.status(500).json({
          success: false,
          error: 'Role check failed'
        });
      }
    };
  }
  
  /**
   * Optional authentication - sets user if API key provided
   */
  checkOptionalAuth() {
    return async (req, res, next) => {
      try {
        const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');
        
        if (!apiKey) {
          req.user = null;
          return next();
        }
        
        // Validate API key
        const isValid = await this.apiKeyService.validateApiKey(apiKey);
        
        if (!isValid) {
          req.user = null;
          return next();
        }
        
        // Get user from API key
        const user = await this.apiKeyService.getUserFromApiKey(apiKey);
        req.user = user;
        req.apiKey = apiKey;
        
        next();
      } catch (error) {
        logger.error('Optional auth error:', error);
        req.user = null;
        next();
      }
    };
  }
  
  /**
   * Audit log middleware
   */
  auditLog(auditLogger) {
    return async (req, res, next) => {
      const startTime = Date.now();
      
      // Capture response
      const originalSend = res.send;
      res.send = function(data) {
        res.body = data;
        originalSend.apply(res, arguments);
      };
      
      res.on('finish', async () => {
        try {
          const duration = Date.now() - startTime;
          
          const auditEntry = {
            user_id: req.user?.id || null,
            method: req.method,
            path: req.path,
            status_code: res.statusCode,
            ip_address: req.ip,
            user_agent: req.get('user-agent'),
            request_body: req.body,
            response_time: duration,
            timestamp: new Date()
          };
          
          if (auditLogger) {
            await auditLogger(auditEntry);
          }
          
          // Log to system logger for security events
          if (res.statusCode === 403 || res.statusCode === 401) {
            logger.security('Access denied', auditEntry);
          }
        } catch (error) {
          logger.error('Audit log error:', error);
        }
      });
      
      next();
    };
  }
  
  /**
   * Rate limiting per API key
   */
  rateLimit(options = {}) {
    const limits = {
      windowMs: options.windowMs || 15 * 60 * 1000, // 15 minutes
      max: options.max || 100,
      message: options.message || 'Too many requests'
    };
    
    const requests = new Map();
    
    return async (req, res, next) => {
      if (!req.apiKey) {
        return next();
      }
      
      const now = Date.now();
      const windowStart = now - limits.windowMs;
      
      // Clean old entries
      for (const [key, timestamps] of requests.entries()) {
        const filtered = timestamps.filter(t => t > windowStart);
        if (filtered.length === 0) {
          requests.delete(key);
        } else {
          requests.set(key, filtered);
        }
      }
      
      // Check rate limit
      const timestamps = requests.get(req.apiKey) || [];
      const recentRequests = timestamps.filter(t => t > windowStart);
      
      if (recentRequests.length >= limits.max) {
        return res.status(429).json({
          success: false,
          error: limits.message
        });
      }
      
      // Record request
      recentRequests.push(now);
      requests.set(req.apiKey, recentRequests);
      
      next();
    };
  }
}

// Export singleton instance
const rbacMiddleware = new RBACMiddleware();

module.exports = {
  requireAuth: rbacMiddleware.requireAuth.bind(rbacMiddleware),
  requirePermission: rbacMiddleware.requirePermission.bind(rbacMiddleware),
  requireAnyPermission: rbacMiddleware.requireAnyPermission.bind(rbacMiddleware),
  requireAllPermissions: rbacMiddleware.requireAllPermissions.bind(rbacMiddleware),
  requireRole: rbacMiddleware.requireRole.bind(rbacMiddleware),
  checkOptionalAuth: rbacMiddleware.checkOptionalAuth.bind(rbacMiddleware),
  auditLog: rbacMiddleware.auditLog.bind(rbacMiddleware),
  rateLimit: rbacMiddleware.rateLimit.bind(rbacMiddleware)
};