const Redis = require('ioredis');
const crypto = require('crypto');
const RateLimiter = require('../middleware/RateLimiter');
const { rateLimitConfig, getLimitsForEndpoint } = require('../config/rateLimits');
const logger = require('../utils/logger');
const DatabaseManager = require('../database/DatabaseManager');

/**
 * RateLimitService - Manages rate limiting across distributed system
 * Provides usage tracking, analytics, and API key management
 */
class RateLimitService {
  constructor(options = {}) {
    this.db = options.db || DatabaseManager.getInstance();
    
    // Redis clients for different purposes
    this.rateLimitRedis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      db: process.env.REDIS_RATE_LIMIT_DB || 2,
      keyPrefix: 'ratelimit:',
      retryStrategy: (times) => Math.min(times * 50, 2000)
    });

    this.analyticsRedis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      db: process.env.REDIS_ANALYTICS_DB || 3,
      keyPrefix: 'analytics:',
      retryStrategy: (times) => Math.min(times * 50, 2000)
    });

    // Rate limiters for different strategies
    this.limiters = {
      'token-bucket': new RateLimiter({ 
        redis: this.rateLimitRedis, 
        strategy: 'token-bucket' 
      }),
      'sliding-window': new RateLimiter({ 
        redis: this.rateLimitRedis, 
        strategy: 'sliding-window' 
      }),
      'fixed-window': new RateLimiter({ 
        redis: this.rateLimitRedis, 
        strategy: 'fixed-window' 
      })
    };

    // Usage tracking intervals
    this.trackingInterval = null;
    this.flushInterval = 5000; // Flush to DB every 5 seconds
    this.usageBuffer = new Map();
  }

  /**
   * Initialize the service
   */
  async initialize() {
    await this.startUsageTracking();
    logger.info('RateLimitService initialized');
  }

  /**
   * Check rate limit for a request
   */
  async checkRateLimit(identifier, endpoint, method = 'GET', options = {}) {
    try {
      const { type = 'user', tier = 'anonymous', apiKey = null } = options;
      
      // Get limits for this endpoint and tier
      const limits = getLimitsForEndpoint(tier, endpoint, method);
      
      if (!limits) {
        // No rate limiting for this endpoint
        return { allowed: true, unlimited: true };
      }

      // Check tier requirements
      if (limits.minTier && !this.isTierSufficient(tier, limits.minTier)) {
        return {
          allowed: false,
          reason: 'insufficient_tier',
          currentTier: tier,
          requiredTier: limits.minTier
        };
      }

      // Select appropriate limiter
      const limiter = this.limiters[limits.strategy];
      const key = this.generateKey(type, identifier, endpoint);

      // Check the rate limit
      const result = await limiter.checkLimit(key, {
        limit: limits.limit,
        window: limits.window,
        burst: limits.burst,
        cost: limits.cost
      });

      // Check daily limit if applicable
      if (result.allowed && limits.dailyLimit) {
        const dailyResult = await this.checkDailyLimit(
          identifier, 
          limits.dailyLimit, 
          limits.cost
        );
        if (!dailyResult.allowed) {
          return { ...dailyResult, reason: 'daily_limit_exceeded' };
        }
      }

      // Track usage for analytics
      if (result.allowed) {
        this.trackUsage(identifier, endpoint, method, {
          tier,
          apiKey,
          cost: limits.cost,
          timestamp: Date.now()
        });
      }

      return {
        ...result,
        tier,
        cost: limits.cost,
        strategy: limits.strategy
      };
    } catch (error) {
      logger.error('Rate limit check error:', error);
      // Fail open on errors
      return { allowed: true, error: true };
    }
  }

  /**
   * Check daily limit
   */
  async checkDailyLimit(identifier, limit, cost = 1) {
    const today = new Date().toISOString().split('T')[0];
    const key = `daily:${identifier}:${today}`;
    
    try {
      const current = await this.rateLimitRedis.incrby(key, cost);
      
      if (current === cost) {
        await this.rateLimitRedis.expire(key, 86400); // 24 hours
      }

      const allowed = current <= limit;
      if (!allowed && current === cost + limit) {
        // Rollback if we just exceeded
        await this.rateLimitRedis.decrby(key, cost);
      }

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);

      return {
        allowed,
        dailyLimit: limit,
        dailyUsed: allowed ? current : current - cost,
        dailyRemaining: Math.max(0, limit - (allowed ? current : current - cost)),
        dailyReset: tomorrow.getTime()
      };
    } catch (error) {
      logger.error('Daily limit check error:', error);
      return { allowed: true, error: true };
    }
  }

  /**
   * Generate API key
   */
  async generateApiKey(userId, options = {}) {
    const {
      name = 'API Key',
      tier = 'basic',
      customLimits = null,
      expiresIn = null
    } = options;

    try {
      // Generate secure API key
      const keyBuffer = crypto.randomBytes(32);
      const apiKey = `thewell_${keyBuffer.toString('base64url')}`;
      const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');

      // Store in database
      const result = await this.db.query(`
        INSERT INTO api_keys (
          key_hash, 
          user_id, 
          name, 
          tier, 
          custom_limits,
          expires_at,
          created_at,
          last_used_at
        ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NULL)
        RETURNING id, created_at
      `, [
        keyHash,
        userId,
        name,
        tier,
        customLimits ? JSON.stringify(customLimits) : null,
        expiresIn ? new Date(Date.now() + expiresIn * 1000) : null
      ]);

      // Log key generation
      await this.logApiKeyEvent(result.rows[0].id, 'created', { userId });

      return {
        id: result.rows[0].id,
        apiKey, // Only returned once
        name,
        tier,
        createdAt: result.rows[0].created_at,
        expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null
      };
    } catch (error) {
      logger.error('API key generation error:', error);
      throw error;
    }
  }

  /**
   * Validate API key
   */
  async validateApiKey(apiKey) {
    if (!apiKey || !apiKey.startsWith('thewell_')) {
      return null;
    }

    try {
      const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
      
      const result = await this.db.query(`
        SELECT 
          k.id,
          k.user_id,
          k.name,
          k.tier,
          k.custom_limits,
          k.is_active,
          k.expires_at,
          k.rate_limit_override,
          u.email,
          u.role
        FROM api_keys k
        JOIN users u ON k.user_id = u.id
        WHERE k.key_hash = $1 
          AND k.is_active = true
          AND (k.expires_at IS NULL OR k.expires_at > NOW())
      `, [keyHash]);

      if (result.rows.length === 0) {
        return null;
      }

      const keyData = result.rows[0];

      // Update last used timestamp
      this.db.query(
        'UPDATE api_keys SET last_used_at = NOW() WHERE id = $1',
        [keyData.id]
      ).catch(err => logger.error('Failed to update last_used_at:', err));

      return {
        id: keyData.id,
        userId: keyData.user_id,
        name: keyData.name,
        tier: keyData.tier,
        customLimits: keyData.custom_limits,
        rateLimitOverride: keyData.rate_limit_override,
        user: {
          email: keyData.email,
          role: keyData.role
        }
      };
    } catch (error) {
      logger.error('API key validation error:', error);
      return null;
    }
  }

  /**
   * Rotate API key
   */
  async rotateApiKey(keyId, userId) {
    try {
      // Get existing key info
      const existing = await this.db.query(
        'SELECT name, tier, custom_limits FROM api_keys WHERE id = $1 AND user_id = $2',
        [keyId, userId]
      );

      if (existing.rows.length === 0) {
        throw new Error('API key not found');
      }

      const keyInfo = existing.rows[0];

      // Generate new key
      const newKey = await this.generateApiKey(userId, {
        name: `${keyInfo.name} (Rotated)`,
        tier: keyInfo.tier,
        customLimits: keyInfo.custom_limits
      });

      // Deactivate old key
      await this.db.query(
        'UPDATE api_keys SET is_active = false, rotated_to = $1 WHERE id = $2',
        [newKey.id, keyId]
      );

      // Log rotation
      await this.logApiKeyEvent(keyId, 'rotated', { newKeyId: newKey.id });

      return newKey;
    } catch (error) {
      logger.error('API key rotation error:', error);
      throw error;
    }
  }

  /**
   * Track usage for analytics
   */
  trackUsage(identifier, endpoint, method, metadata) {
    const hourKey = new Date().toISOString().slice(0, 13); // YYYY-MM-DDTHH
    const bufferKey = `${identifier}:${endpoint}:${method}:${hourKey}`;
    
    if (!this.usageBuffer.has(bufferKey)) {
      this.usageBuffer.set(bufferKey, {
        count: 0,
        totalCost: 0,
        firstSeen: Date.now(),
        lastSeen: Date.now(),
        metadata
      });
    }

    const entry = this.usageBuffer.get(bufferKey);
    entry.count++;
    entry.totalCost += metadata.cost || 1;
    entry.lastSeen = Date.now();
  }

  /**
   * Start usage tracking
   */
  async startUsageTracking() {
    // Flush usage data periodically
    this.trackingInterval = setInterval(async () => {
      await this.flushUsageData();
    }, this.flushInterval);
  }

  /**
   * Flush usage data to database
   */
  async flushUsageData() {
    if (this.usageBuffer.size === 0) return;

    const entries = Array.from(this.usageBuffer.entries());
    this.usageBuffer.clear();

    try {
      const values = [];
      const placeholders = [];
      let paramIndex = 1;

      entries.forEach(([key, data]) => {
        const [identifier, endpoint, method, hourKey] = key.split(':');
        
        values.push(
          identifier,
          endpoint,
          method,
          hourKey,
          data.count,
          data.totalCost,
          data.metadata.tier || 'anonymous',
          data.metadata.apiKey,
          new Date(data.firstSeen),
          new Date(data.lastSeen)
        );

        placeholders.push(`($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4}, $${paramIndex + 5}, $${paramIndex + 6}, $${paramIndex + 7}, $${paramIndex + 8}, $${paramIndex + 9})`);
        paramIndex += 10;
      });

      await this.db.query(`
        INSERT INTO rate_limit_usage (
          identifier,
          endpoint,
          method,
          hour_bucket,
          request_count,
          total_cost,
          tier,
          api_key_id,
          first_request_at,
          last_request_at
        ) VALUES ${placeholders.join(', ')}
        ON CONFLICT (identifier, endpoint, method, hour_bucket)
        DO UPDATE SET
          request_count = rate_limit_usage.request_count + EXCLUDED.request_count,
          total_cost = rate_limit_usage.total_cost + EXCLUDED.total_cost,
          last_request_at = EXCLUDED.last_request_at
      `, values);

    } catch (error) {
      logger.error('Failed to flush usage data:', error);
    }
  }

  /**
   * Get usage analytics
   */
  async getUsageAnalytics(identifier, options = {}) {
    const {
      startDate = new Date(Date.now() - 24 * 60 * 60 * 1000), // 24 hours ago
      endDate = new Date(),
      groupBy = 'hour'
    } = options;

    try {
      const result = await this.db.query(`
        SELECT 
          DATE_TRUNC($1, first_request_at) as time_bucket,
          endpoint,
          method,
          tier,
          SUM(request_count) as total_requests,
          SUM(total_cost) as total_cost,
          COUNT(DISTINCT hour_bucket) as active_hours
        FROM rate_limit_usage
        WHERE identifier = $2
          AND first_request_at >= $3
          AND first_request_at <= $4
        GROUP BY time_bucket, endpoint, method, tier
        ORDER BY time_bucket DESC
      `, [groupBy, identifier, startDate, endDate]);

      return result.rows;
    } catch (error) {
      logger.error('Failed to get usage analytics:', error);
      throw error;
    }
  }

  /**
   * Block/unblock IP address
   */
  async manageIpBlock(ip, action = 'block', options = {}) {
    const { reason = '', duration = null, userId = null } = options;

    try {
      if (action === 'block') {
        await this.db.query(`
          INSERT INTO ip_blocks (
            ip_address,
            reason,
            blocked_until,
            blocked_by,
            created_at
          ) VALUES ($1, $2, $3, $4, NOW())
          ON CONFLICT (ip_address) 
          DO UPDATE SET
            reason = EXCLUDED.reason,
            blocked_until = EXCLUDED.blocked_until,
            blocked_by = EXCLUDED.blocked_by,
            updated_at = NOW()
        `, [
          ip,
          reason,
          duration ? new Date(Date.now() + duration * 1000) : null,
          userId
        ]);

        // Add to Redis blacklist for immediate effect
        await this.rateLimitRedis.sadd('blacklist:ips', ip);
        if (duration) {
          await this.rateLimitRedis.expire(`blacklist:ip:${ip}`, duration);
        }

      } else if (action === 'unblock') {
        await this.db.query(
          'DELETE FROM ip_blocks WHERE ip_address = $1',
          [ip]
        );

        // Remove from Redis blacklist
        await this.rateLimitRedis.srem('blacklist:ips', ip);
      }

      return { success: true, ip, action };
    } catch (error) {
      logger.error('IP block management error:', error);
      throw error;
    }
  }

  /**
   * Get rate limit status for monitoring
   */
  async getRateLimitStatus(identifier) {
    const status = {
      limits: {},
      usage: {},
      remaining: {}
    };

    try {
      // Check limits for common endpoints
      const endpoints = [
        '/api/rag/search',
        '/api/documents',
        '/api/enrichment/process'
      ];

      for (const endpoint of endpoints) {
        const tier = await this.getUserTier(identifier);
        const limits = getLimitsForEndpoint(tier, endpoint);
        
        if (limits) {
          const limiter = this.limiters[limits.strategy];
          const usage = await limiter.getUsage(
            this.generateKey('user', identifier, endpoint)
          );

          status.limits[endpoint] = limits;
          status.usage[endpoint] = usage;
          status.remaining[endpoint] = usage.remaining;
        }
      }

      // Get daily usage
      const today = new Date().toISOString().split('T')[0];
      const dailyKey = `daily:${identifier}:${today}`;
      const dailyUsed = await this.rateLimitRedis.get(dailyKey) || 0;

      status.daily = {
        used: parseInt(dailyUsed),
        limit: rateLimitConfig.tiers[await this.getUserTier(identifier)].dailyLimit,
        reset: new Date(new Date().setHours(24, 0, 0, 0))
      };

      return status;
    } catch (error) {
      logger.error('Failed to get rate limit status:', error);
      throw error;
    }
  }

  /**
   * Helper: Generate rate limit key
   */
  generateKey(type, identifier, endpoint) {
    return `${type}:${identifier}:${endpoint.replace(/\//g, ':')}`;
  }

  /**
   * Helper: Check if tier is sufficient
   */
  isTierSufficient(currentTier, requiredTier) {
    const tierOrder = ['anonymous', 'free', 'basic', 'premium', 'enterprise', 'admin'];
    const currentIndex = tierOrder.indexOf(currentTier);
    const requiredIndex = tierOrder.indexOf(requiredTier);
    
    return currentIndex >= requiredIndex;
  }

  /**
   * Helper: Get user tier
   */
  async getUserTier(identifier) {
    try {
      const result = await this.db.query(
        'SELECT tier FROM users WHERE id = $1 OR email = $1',
        [identifier]
      );

      return result.rows.length > 0 ? result.rows[0].tier : 'anonymous';
    } catch (error) {
      return 'anonymous';
    }
  }

  /**
   * Helper: Log API key events
   */
  async logApiKeyEvent(keyId, event, metadata = {}) {
    try {
      await this.db.query(`
        INSERT INTO api_key_events (
          api_key_id,
          event_type,
          metadata,
          created_at
        ) VALUES ($1, $2, $3, NOW())
      `, [keyId, event, JSON.stringify(metadata)]);
    } catch (error) {
      logger.error('Failed to log API key event:', error);
    }
  }

  /**
   * Cleanup and close connections
   */
  async close() {
    if (this.trackingInterval) {
      clearInterval(this.trackingInterval);
      await this.flushUsageData();
    }

    await this.rateLimitRedis.quit();
    await this.analyticsRedis.quit();
    
    for (const limiter of Object.values(this.limiters)) {
      await limiter.close();
    }
  }
}

module.exports = RateLimitService;