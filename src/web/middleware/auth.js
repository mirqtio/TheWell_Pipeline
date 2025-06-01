/**
 * Authentication Middleware
 * Handles authentication for the manual review interface
 */

const logger = require('../../utils/logger');

/**
 * Simple authentication middleware
 * In production, this should integrate with your authentication system
 */
function authMiddleware(req, res, next) {
  // Skip authentication for health checks and public endpoints
  if (req.path === '/health' || req.path.startsWith('/public')) {
    return next();
  }

  // Check for API key in header or query parameter
  const apiKey = req.headers['x-api-key'] || req.query.apiKey;
  const expectedApiKey = process.env.REVIEW_API_KEY || 'dev-review-key';

  // In development mode, allow bypass
  if (process.env.NODE_ENV === 'development' && !apiKey) {
    logger.warn('Authentication bypassed in development mode');
    req.user = {
      id: 'dev-user',
      role: 'reviewer',
      permissions: ['read', 'write', 'approve', 'reject', 'flag']
    };
    return next();
  }

  // Validate API key
  if (!apiKey || apiKey !== expectedApiKey) {
    logger.warn('Authentication failed', {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      path: req.path
    });

    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Valid API key required',
      timestamp: new Date().toISOString()
    });
  }

  // Set user context (in production, decode from JWT or lookup in database)
  req.user = {
    id: 'api-user',
    role: 'reviewer',
    permissions: ['read', 'write', 'approve', 'reject', 'flag']
  };

  logger.debug('User authenticated', {
    userId: req.user.id,
    role: req.user.role
  });

  next();
}

/**
 * Check if user has required permission
 */
function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication required'
      });
    }

    if (!req.user.permissions || !req.user.permissions.includes(permission)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: `Permission '${permission}' required`
      });
    }

    next();
  };
}

/**
 * Check if user has required role
 */
function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication required'
      });
    }

    if (req.user.role !== role && req.user.role !== 'admin') {
      return res.status(403).json({
        error: 'Forbidden',
        message: `Role '${role}' required`
      });
    }

    next();
  };
}

/**
 * Utility function to check if user has specific permission
 */
function hasPermission(user, permission) {
  if (!user || !user.permissions) {
    return false;
  }
  return user.permissions.includes(permission);
}

/**
 * Utility function to check if user has specific role
 */
function hasRole(user, role) {
  if (!user || !user.role) {
    return false;
  }
  return user.role === role;
}

module.exports = authMiddleware;
module.exports.authenticateRequest = authMiddleware; // Alias for tests
module.exports.requirePermission = requirePermission;
module.exports.requireRole = requireRole;
module.exports.hasPermission = hasPermission;
module.exports.hasRole = hasRole;
