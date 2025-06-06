/**
 * Rate Limit Configuration
 * Defines tiered limits, endpoint-specific rules, and role-based allowances
 */

const rateLimitConfig = {
  // Default limits by user role
  tiers: {
    anonymous: {
      strategy: 'sliding-window',
      requests: 100,
      window: 3600, // 1 hour
      burst: 10,
      dailyLimit: 1000
    },
    free: {
      strategy: 'token-bucket',
      requests: 500,
      window: 3600,
      burst: 50,
      dailyLimit: 5000
    },
    basic: {
      strategy: 'token-bucket',
      requests: 2000,
      window: 3600,
      burst: 200,
      dailyLimit: 20000
    },
    premium: {
      strategy: 'token-bucket',
      requests: 10000,
      window: 3600,
      burst: 1000,
      dailyLimit: 100000
    },
    enterprise: {
      strategy: 'token-bucket',
      requests: 50000,
      window: 3600,
      burst: 5000,
      dailyLimit: 1000000
    },
    admin: {
      strategy: 'token-bucket',
      requests: 100000,
      window: 3600,
      burst: 10000,
      dailyLimit: null // No daily limit
    }
  },

  // Endpoint-specific limits (override tier defaults)
  endpoints: {
    // Search endpoints - higher limits due to interactive nature
    '/api/rag/search': {
      multiplier: 1.5,
      cost: 1
    },
    '/api/rag/query': {
      multiplier: 1.0,
      cost: 2 // More expensive operation
    },
    
    // Document operations - moderate limits
    '/api/documents': {
      GET: { multiplier: 1.0, cost: 1 },
      POST: { multiplier: 0.5, cost: 5 },
      PUT: { multiplier: 0.5, cost: 3 },
      DELETE: { multiplier: 0.3, cost: 2 }
    },
    
    // Enrichment operations - lower limits due to high cost
    '/api/enrichment/process': {
      multiplier: 0.2,
      cost: 10
    },
    '/api/enrichment/embed': {
      multiplier: 0.3,
      cost: 8
    },
    
    // Admin operations - restricted but high limits when allowed
    '/api/admin/*': {
      multiplier: 2.0,
      cost: 1,
      requiresAuth: true,
      minTier: 'admin'
    },
    
    // Feedback endpoints - encourage usage
    '/api/feedback': {
      multiplier: 2.0,
      cost: 0.5
    },
    
    // Health checks - no limits
    '/api/health': {
      bypass: true
    },
    '/api/metrics': {
      bypass: true,
      requiresAuth: true
    }
  },

  // Burst allowances for specific operations
  burstAllowances: {
    authentication: {
      endpoints: ['/api/auth/login', '/api/auth/refresh'],
      burst: 5,
      window: 300, // 5 minutes
      lockoutAfter: 10, // Lock after 10 failed attempts
      lockoutDuration: 900 // 15 minutes
    },
    upload: {
      endpoints: ['/api/documents/upload', '/api/sources/import'],
      burst: 3,
      window: 60
    },
    export: {
      endpoints: ['/api/export/*'],
      burst: 2,
      window: 300
    }
  },

  // Grace periods for rate limit violations
  gracePeriods: {
    soft: {
      threshold: 0.8, // Warn at 80% usage
      allowExcess: 1.1 // Allow 10% over limit during grace
    },
    hard: {
      threshold: 1.0,
      allowExcess: 1.0,
      retryAfter: 60 // Seconds to wait before retry
    }
  },

  // IP-based limits (for DDoS protection)
  ipLimits: {
    global: {
      requests: 10000,
      window: 3600,
      strategy: 'fixed-window'
    },
    blacklist: {
      // IPs that are permanently blocked
      ips: [],
      cidrs: []
    },
    whitelist: {
      // IPs that bypass rate limiting
      ips: ['127.0.0.1', '::1'],
      cidrs: ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16']
    }
  },

  // API key specific configurations
  apiKeys: {
    defaultLimits: {
      strategy: 'token-bucket',
      requests: 1000,
      window: 3600,
      burst: 100,
      dailyLimit: 10000
    },
    customKeys: {
      // Specific API keys with custom limits
      // Format: 'api_key_prefix': { limits }
    }
  },

  // Cost calculation for complex operations
  operationCosts: {
    // Base costs for different operation types
    read: 1,
    write: 3,
    delete: 2,
    search: 2,
    aggregate: 5,
    
    // Modifiers based on payload size
    sizeModifiers: {
      small: 1.0,   // < 10KB
      medium: 1.5,  // 10KB - 100KB
      large: 2.0,   // 100KB - 1MB
      xlarge: 5.0   // > 1MB
    },
    
    // Modifiers based on processing complexity
    complexityModifiers: {
      simple: 1.0,
      moderate: 2.0,
      complex: 5.0,
      intensive: 10.0
    }
  },

  // Response headers configuration
  headers: {
    limit: 'X-RateLimit-Limit',
    remaining: 'X-RateLimit-Remaining',
    reset: 'X-RateLimit-Reset',
    retryAfter: 'Retry-After',
    cost: 'X-RateLimit-Cost',
    tier: 'X-RateLimit-Tier'
  },

  // Error messages
  messages: {
    rateLimitExceeded: 'Rate limit exceeded. Please retry after {retryAfter} seconds.',
    dailyLimitExceeded: 'Daily limit exceeded. Limit resets at {resetTime}.',
    burstLimitExceeded: 'Too many requests in a short period. Please slow down.',
    unauthorized: 'API key is invalid or has been revoked.',
    tierUpgrade: 'Your current tier ({currentTier}) does not allow this operation. Please upgrade to {requiredTier}.'
  }
};

// Helper function to get limits for a specific tier and endpoint
function getLimitsForEndpoint(tier, endpoint, method = 'GET') {
  const tierConfig = rateLimitConfig.tiers[tier] || rateLimitConfig.tiers.anonymous;
  let endpointConfig = rateLimitConfig.endpoints[endpoint];
  
  // Check for wildcard endpoints
  if (!endpointConfig) {
    const wildcardKey = Object.keys(rateLimitConfig.endpoints).find(key => {
      if (key.includes('*')) {
        const regex = new RegExp(key.replace('*', '.*'));
        return regex.test(endpoint);
      }
      return false;
    });
    
    if (wildcardKey) {
      endpointConfig = rateLimitConfig.endpoints[wildcardKey];
    }
  }
  
  // Handle method-specific configuration
  if (endpointConfig && typeof endpointConfig === 'object' && endpointConfig[method]) {
    endpointConfig = endpointConfig[method];
  }
  
  if (!endpointConfig || endpointConfig.bypass) {
    return null; // No rate limiting for this endpoint
  }
  
  // Calculate final limits
  const multiplier = endpointConfig.multiplier || 1.0;
  const cost = endpointConfig.cost || 1;
  
  return {
    strategy: tierConfig.strategy,
    limit: Math.floor(tierConfig.requests * multiplier),
    window: tierConfig.window,
    burst: Math.floor((tierConfig.burst || 0) * multiplier),
    cost,
    dailyLimit: tierConfig.dailyLimit ? Math.floor(tierConfig.dailyLimit * multiplier) : null,
    requiresAuth: endpointConfig.requiresAuth || false,
    minTier: endpointConfig.minTier || null
  };
}

// Helper function to check if IP is whitelisted
function isIpWhitelisted(ip) {
  const { whitelist } = rateLimitConfig.ipLimits;
  
  // Check exact IP matches
  if (whitelist.ips.includes(ip)) {
    return true;
  }
  
  // Check CIDR ranges
  // Note: In production, use a proper CIDR matching library
  return false;
}

// Helper function to check if IP is blacklisted
function isIpBlacklisted(ip) {
  const { blacklist } = rateLimitConfig.ipLimits;
  
  // Check exact IP matches
  if (blacklist.ips.includes(ip)) {
    return true;
  }
  
  // Check CIDR ranges
  // Note: In production, use a proper CIDR matching library
  return false;
}

module.exports = {
  rateLimitConfig,
  getLimitsForEndpoint,
  isIpWhitelisted,
  isIpBlacklisted
};