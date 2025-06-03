/**
 * Error Handler Middleware
 * Centralized error handling for the manual review interface
 */

let logger;
try {
  logger = require('../../utils/logger');
} catch (err) {
  // Fallback logger for tests
  logger = {
    error: () => {},
    warn: () => {},
    info: () => {},
    debug: () => {}
  };
}

/**
 * Global error handler middleware
 */
function errorHandler(error, req, res, _next) {
  // Log the error
  try {
    logger.error('HTTP Error', {
      error: error.message,
      stack: error.stack,
      method: req.method,
      url: req.url,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      body: req.body
    });
  } catch (logError) {
    console.error('Logger error:', logError);
  }

  // Default error response
  let statusCode = 500;
  let message = 'Internal Server Error';
  let details = null;

  // Handle specific error types
  if (error.name === 'ValidationError') {
    statusCode = 400;
    message = error.message; // Use original message, not generic
  } else if (error.name === 'UnauthorizedError') {
    statusCode = 401;
    message = error.message;
  } else if (error.name === 'ForbiddenError') {
    statusCode = 403;
    message = error.message;
  } else if (error.name === 'NotFoundError') {
    statusCode = 404;
    message = error.message;
  } else if (error.name === 'ConflictError') {
    statusCode = 409;
    message = error.message;
  } else if (error.name === 'AuthenticationError') {
    statusCode = 401;
    message = error.message;
  } else if (error.name === 'AuthorizationError') {
    statusCode = 403;
    message = error.message;
  } else if (error.statusCode) {
    statusCode = error.statusCode;
    message = error.message;
  }

  // Don't expose internal error details in production
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  const errorResponse = {
    error: message,
    type: error.name || 'Error',
    timestamp: new Date().toISOString(),
    requestId: req.headers['x-request-id'] || 'unknown'
  };

  if (details) {
    errorResponse.details = details;
  }

  if (isDevelopment) {
    errorResponse.message = error.message; // Add message field for development
    errorResponse.stack = error.stack;
  }

  res.status(statusCode).json(errorResponse);
}

/**
 * Async error wrapper
 * Wraps async route handlers to catch errors
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Create custom error classes
 */
class ValidationError extends Error {
  constructor(message, details = null) {
    super(message);
    this.name = 'ValidationError';
    this.statusCode = 400;
    this.details = details;
  }
}

class UnauthorizedError extends Error {
  constructor(message = 'Unauthorized') {
    super(message);
    this.name = 'UnauthorizedError';
    this.statusCode = 401;
  }
}

class ForbiddenError extends Error {
  constructor(message = 'Forbidden') {
    super(message);
    this.name = 'ForbiddenError';
    this.statusCode = 403;
  }
}

class NotFoundError extends Error {
  constructor(message = 'Not Found') {
    super(message);
    this.name = 'NotFoundError';
    this.statusCode = 404;
  }
}

class ConflictError extends Error {
  constructor(message = 'Conflict') {
    super(message);
    this.name = 'ConflictError';
    this.statusCode = 409;
  }
}

// Aliases for test compatibility
class AuthenticationError extends UnauthorizedError {
  constructor(message = 'Authentication failed') {
    super(message);
    this.name = 'AuthenticationError';
  }
}

class AuthorizationError extends ForbiddenError {
  constructor(message = 'Authorization failed') {
    super(message);
    this.name = 'AuthorizationError';
  }
}

module.exports = errorHandler;
module.exports.errorHandler = errorHandler; 
module.exports.asyncHandler = asyncHandler;
module.exports.ValidationError = ValidationError;
module.exports.UnauthorizedError = UnauthorizedError;
module.exports.ForbiddenError = ForbiddenError;
module.exports.NotFoundError = NotFoundError;
module.exports.ConflictError = ConflictError;
module.exports.AuthenticationError = AuthenticationError;
module.exports.AuthorizationError = AuthorizationError;
