/**
 * Audit Middleware - Automatically sets audit context for requests
 * Captures user, session, IP, and user agent information for audit trails
 */

const auditService = require('../../services/AuditService');
const logger = require('../../utils/logger');

/**
 * Middleware to set audit context from request
 */
function auditMiddleware(req, res, next) {
  try {
    // Extract audit context from request
    const auditContext = {
      userId: req.user?.id || req.headers['x-user-id'] || 'anonymous',
      sessionId: req.sessionID || req.headers['x-session-id'] || generateSessionId(),
      ipAddress: getClientIP(req),
      userAgent: req.headers['user-agent'] || 'unknown'
    };

    // Set context in audit service
    auditService.setContext(auditContext);

    // Add audit context to request for route handlers
    req.auditContext = auditContext;

    // Add audit logging helper to request
    req.auditLog = {
      logAction: (action, documentId, details) => 
        auditService.logCurationAction(action, documentId, details),
      logReview: (documentId, action, reviewData) => 
        auditService.logReviewAction(documentId, action, reviewData),
      logBulkOperation: (operation, documentIds, results) => 
        auditService.logBulkOperation(operation, documentIds, results),
      logStatusChange: (documentId, oldStatus, newStatus, reason) => 
        auditService.logStatusChange(documentId, oldStatus, newStatus, reason),
      logVisibilityChange: (documentId, oldVisibility, newVisibility, reason) => 
        auditService.logVisibilityChange(documentId, oldVisibility, newVisibility, reason)
    };

    logger.debug('Audit context set', {
      userId: auditContext.userId,
      sessionId: auditContext.sessionId,
      ipAddress: auditContext.ipAddress,
      path: req.path,
      method: req.method
    });

    next();
  } catch (error) {
    logger.error('Failed to set audit context', {
      error: error.message,
      path: req.path,
      method: req.method
    });
    
    // Don't fail the request if audit setup fails
    next();
  }
}

/**
 * Middleware to log HTTP requests for audit trail
 */
function auditRequestMiddleware(req, res, next) {
  // Skip audit logging for health checks and static assets
  if (shouldSkipAuditLogging(req)) {
    return next();
  }

  const startTime = Date.now();
  
  // Log request start
  logger.debug('Request started', {
    method: req.method,
    path: req.path,
    userId: req.auditContext?.userId,
    sessionId: req.auditContext?.sessionId,
    ipAddress: req.auditContext?.ipAddress
  });

  // Override res.end to capture response
  const originalEnd = res.end;
  res.end = function(chunk, encoding) {
    const duration = Date.now() - startTime;
    
    // Log request completion
    logger.info('Request completed', {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration,
      userId: req.auditContext?.userId,
      sessionId: req.auditContext?.sessionId,
      ipAddress: req.auditContext?.ipAddress
    });

    // Log significant actions for audit trail
    if (isCurationAction(req)) {
      auditService.logSessionActivity(
        req.auditContext?.sessionId,
        'HTTP_REQUEST',
        {
          method: req.method,
          path: req.path,
          statusCode: res.statusCode,
          duration,
          body: sanitizeRequestBody(req.body),
          query: req.query
        }
      ).catch(error => {
        logger.error('Failed to log session activity', {
          error: error.message,
          path: req.path
        });
      });
    }

    originalEnd.call(this, chunk, encoding);
  };

  next();
}

/**
 * Get client IP address from request
 */
function getClientIP(req) {
  return req.ip || 
         req.connection?.remoteAddress || 
         req.socket?.remoteAddress ||
         req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
         req.headers['x-real-ip'] ||
         'unknown';
}

/**
 * Generate a session ID if none exists
 */
function generateSessionId() {
  return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Check if request should skip audit logging
 */
function shouldSkipAuditLogging(req) {
  const skipPaths = [
    '/health',
    '/metrics',
    '/favicon.ico',
    '/static/',
    '/assets/',
    '/css/',
    '/js/',
    '/images/'
  ];

  return skipPaths.some(path => req.path.startsWith(path));
}

/**
 * Check if request is a curation-related action
 */
function isCurationAction(req) {
  const curationPaths = [
    '/api/review/',
    '/api/curation/',
    '/api/workflow/',
    '/review/',
    '/curation/'
  ];

  return curationPaths.some(path => req.path.startsWith(path)) ||
         (req.method !== 'GET' && req.path.includes('document'));
}

/**
 * Sanitize request body for audit logging
 */
function sanitizeRequestBody(body) {
  if (!body) return null;

  // Remove sensitive fields
  const sensitiveFields = ['password', 'token', 'secret', 'key', 'auth'];
  const sanitized = { ...body };

  sensitiveFields.forEach(field => {
    if (sanitized[field]) {
      sanitized[field] = '[REDACTED]';
    }
  });

  // Limit size to prevent huge audit logs
  const bodyString = JSON.stringify(sanitized);
  if (bodyString.length > 1000) {
    return bodyString.substring(0, 1000) + '... [TRUNCATED]';
  }

  return sanitized;
}

/**
 * Cleanup middleware to clear audit context after request
 */
function auditCleanupMiddleware(req, res, next) {
  // Clear audit context after request completes
  res.on('finish', () => {
    auditService.clearContext();
  });

  next();
}

module.exports = {
  auditMiddleware,
  auditRequestMiddleware,
  auditCleanupMiddleware
};
