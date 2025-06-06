const RateLimitService = require('../services/RateLimitService');
const { rateLimitConfig } = require('../config/rateLimits');
const logger = require('../utils/logger');

// Singleton instance
let rateLimitService = null;

/**
 * Express middleware for rate limiting
 * Provides rate limiting with custom headers and error responses
 */
function createRateLimitMiddleware(options = {}) {
  // Initialize service if not already done
  if (!rateLimitService) {
    rateLimitService = new RateLimitService(options);
    rateLimitService.initialize().catch(err => {
      logger.error('Failed to initialize RateLimitService:', err);
    });
  }

  return async function rateLimitMiddleware(req, res, next) {
    try {
      // Skip rate limiting for whitelisted IPs
      const clientIp = getClientIp(req);
      if (isIpWhitelisted(clientIp)) {
        return next();
      }

      // Check if IP is blocked
      if (await isIpBlocked(clientIp)) {
        return sendBlockedResponse(res);
      }

      // Get identifier and tier
      const identifier = getIdentifier(req);
      const tier = await getUserTier(req);
      const apiKey = getApiKey(req);

      // Validate API key if provided
      let apiKeyData = null;
      if (apiKey) {
        apiKeyData = await rateLimitService.validateApiKey(apiKey);
        if (!apiKeyData) {
          return sendUnauthorizedResponse(res, 'Invalid or expired API key');
        }
      }

      // Check rate limit
      const endpoint = req.path;
      const method = req.method;
      
      const result = await rateLimitService.checkRateLimit(
        identifier,
        endpoint,
        method,
        {
          type: apiKeyData ? 'api_key' : 'user',
          tier: apiKeyData ? apiKeyData.tier : tier,
          apiKey: apiKeyData ? apiKeyData.id : null
        }
      );

      // Add rate limit headers
      addRateLimitHeaders(res, result);

      // Store rate limit info in request for logging
      req.rateLimit = {
        identifier,
        tier: result.tier,
        cost: result.cost,
        remaining: result.remaining,
        limit: result.limit
      };

      // Check if request is allowed
      if (!result.allowed) {
        return sendRateLimitResponse(res, result);
      }

      // Check for soft limit warning
      if (result.remaining / result.limit < 0.2) {
        res.setHeader('X-RateLimit-Warning', 'Approaching rate limit');
      }

      next();
    } catch (error) {
      logger.error('Rate limit middleware error:', error);
      // Fail open on errors
      next();
    }
  };
}

/**
 * Get client IP address
 */
function getClientIp(req) {
  // Trust proxy headers if configured
  if (process.env.TRUST_PROXY === 'true') {
    return req.headers['x-real-ip'] ||
           req.headers['x-forwarded-for']?.split(',')[0].trim() ||
           req.connection.remoteAddress ||
           req.socket.remoteAddress;
  }
  
  return req.connection.remoteAddress || req.socket.remoteAddress;
}

/**
 * Get identifier for rate limiting
 */
function getIdentifier(req) {
  // Prefer authenticated user ID
  if (req.user && req.user.id) {
    return `user:${req.user.id}`;
  }
  
  // Fall back to API key if present
  const apiKey = getApiKey(req);
  if (apiKey) {
    return `apikey:${apiKey.substring(0, 16)}`;
  }
  
  // Finally, use IP address
  return `ip:${getClientIp(req)}`;
}

/**
 * Get API key from request
 */
function getApiKey(req) {
  // Check Authorization header
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (match && match[1].startsWith('thewell_')) {
      return match[1];
    }
  }
  
  // Check X-API-Key header
  if (req.headers['x-api-key']) {
    return req.headers['x-api-key'];
  }
  
  // Check query parameter (less secure, but sometimes necessary)
  if (req.query.api_key) {
    return req.query.api_key;
  }
  
  return null;
}

/**
 * Get user tier
 */
async function getUserTier(req) {
  if (req.user) {
    return req.user.tier || 'free';
  }
  
  return 'anonymous';
}

/**
 * Check if IP is whitelisted
 */
function isIpWhitelisted(ip) {
  const { whitelist } = rateLimitConfig.ipLimits;
  
  // Check exact matches
  if (whitelist.ips.includes(ip)) {
    return true;
  }
  
  // Check CIDR ranges (simplified check)
  // In production, use proper CIDR matching
  if (ip.startsWith('127.') || ip === '::1') {
    return true;
  }
  
  return false;
}

/**
 * Check if IP is blocked
 */
async function isIpBlocked(ip) {
  try {
    // Check Redis first for quick lookup
    const isBlocked = await rateLimitService.rateLimitRedis.sismember('blacklist:ips', ip);
    return isBlocked === 1;
  } catch (error) {
    logger.error('IP block check error:', error);
    return false;
  }
}

/**
 * Add rate limit headers to response
 */
function addRateLimitHeaders(res, result) {
  const headers = rateLimitConfig.headers;
  
  if (result.unlimited) {
    res.setHeader(headers.limit, 'unlimited');
    return;
  }
  
  res.setHeader(headers.limit, result.limit);
  res.setHeader(headers.remaining, Math.max(0, result.remaining));
  res.setHeader(headers.reset, Math.floor(result.reset / 1000));
  
  if (result.cost && result.cost > 1) {
    res.setHeader(headers.cost, result.cost);
  }
  
  if (result.tier) {
    res.setHeader(headers.tier, result.tier);
  }
  
  // Add daily limit headers if applicable
  if (result.dailyLimit) {
    res.setHeader('X-RateLimit-Daily-Limit', result.dailyLimit);
    res.setHeader('X-RateLimit-Daily-Remaining', result.dailyRemaining || 0);
    res.setHeader('X-RateLimit-Daily-Reset', Math.floor(result.dailyReset / 1000));
  }
}

/**
 * Send rate limit exceeded response
 */
function sendRateLimitResponse(res, result) {
  const retryAfter = Math.ceil((result.reset - Date.now()) / 1000);
  
  res.setHeader(rateLimitConfig.headers.retryAfter, retryAfter);
  
  let message;
  if (result.reason === 'daily_limit_exceeded') {
    const resetTime = new Date(result.dailyReset).toLocaleString();
    message = rateLimitConfig.messages.dailyLimitExceeded
      .replace('{resetTime}', resetTime);
  } else if (result.reason === 'insufficient_tier') {
    message = rateLimitConfig.messages.tierUpgrade
      .replace('{currentTier}', result.currentTier)
      .replace('{requiredTier}', result.requiredTier);
  } else {
    message = rateLimitConfig.messages.rateLimitExceeded
      .replace('{retryAfter}', retryAfter);
  }
  
  res.status(429).json({
    error: 'rate_limit_exceeded',
    message,
    retryAfter,
    limit: result.limit,
    reset: result.reset,
    tier: result.tier
  });
}

/**
 * Send blocked IP response
 */
function sendBlockedResponse(res) {
  res.status(403).json({
    error: 'access_denied',
    message: 'Your IP address has been blocked. Please contact support if you believe this is an error.'
  });
}

/**
 * Send unauthorized response
 */
function sendUnauthorizedResponse(res, message) {
  res.status(401).json({
    error: 'unauthorized',
    message: message || rateLimitConfig.messages.unauthorized
  });
}

/**
 * Middleware for API key authentication
 */
function requireApiKey(options = {}) {
  return async function(req, res, next) {
    const apiKey = getApiKey(req);
    
    if (!apiKey) {
      return sendUnauthorizedResponse(res, 'API key required');
    }
    
    try {
      const apiKeyData = await rateLimitService.validateApiKey(apiKey);
      
      if (!apiKeyData) {
        return sendUnauthorizedResponse(res, 'Invalid or expired API key');
      }
      
      // Check minimum tier if specified
      if (options.minTier) {
        const tierOrder = ['anonymous', 'free', 'basic', 'premium', 'enterprise', 'admin'];
        const currentIndex = tierOrder.indexOf(apiKeyData.tier);
        const requiredIndex = tierOrder.indexOf(options.minTier);
        
        if (currentIndex < requiredIndex) {
          return res.status(403).json({
            error: 'insufficient_tier',
            message: `This operation requires ${options.minTier} tier or higher`,
            currentTier: apiKeyData.tier,
            requiredTier: options.minTier
          });
        }
      }
      
      // Attach API key data to request
      req.apiKey = apiKeyData;
      req.user = req.user || apiKeyData.user;
      
      next();
    } catch (error) {
      logger.error('API key validation error:', error);
      return sendUnauthorizedResponse(res);
    }
  };
}

/**
 * Get rate limit service instance (for testing and direct access)
 */
function getRateLimitService() {
  return rateLimitService;
}

/**
 * Cleanup function
 */
async function cleanup() {
  if (rateLimitService) {
    await rateLimitService.close();
    rateLimitService = null;
  }
}

module.exports = {
  createRateLimitMiddleware,
  requireApiKey,
  getRateLimitService,
  cleanup
};