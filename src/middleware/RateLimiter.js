const Redis = require('ioredis');
const { promisify } = require('util');

/**
 * RateLimiter - Implements multiple rate limiting strategies
 * Supports token bucket, sliding window, and fixed window algorithms
 */
class RateLimiter {
  constructor(options = {}) {
    this.redis = options.redis || new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      db: process.env.REDIS_RATE_LIMIT_DB || 2,
      retryStrategy: (times) => Math.min(times * 50, 2000)
    });

    this.strategy = options.strategy || 'token-bucket';
    this.keyPrefix = options.keyPrefix || 'ratelimit:';
    this.defaultLimit = options.defaultLimit || 100;
    this.defaultWindow = options.defaultWindow || 3600; // 1 hour in seconds
    this.defaultBurst = options.defaultBurst || 10;
  }

  /**
   * Token Bucket Algorithm
   * Allows burst traffic while maintaining average rate
   */
  async tokenBucket(key, options = {}) {
    const {
      limit = this.defaultLimit,
      window = this.defaultWindow,
      burst = this.defaultBurst
    } = options;

    const now = Date.now();
    const bucketKey = `${this.keyPrefix}tb:${key}`;
    
    // Lua script for atomic token bucket operations
    const luaScript = `
      local key = KEYS[1]
      local limit = tonumber(ARGV[1])
      local window = tonumber(ARGV[2])
      local burst = tonumber(ARGV[3])
      local now = tonumber(ARGV[4])
      local cost = tonumber(ARGV[5]) or 1
      
      local bucket = redis.call('HMGET', key, 'tokens', 'last_refill')
      local tokens = tonumber(bucket[1]) or limit
      local last_refill = tonumber(bucket[2]) or now
      
      -- Calculate tokens to add based on time passed
      local elapsed = math.max(0, now - last_refill)
      local refill_rate = limit / (window * 1000) -- tokens per millisecond
      local new_tokens = elapsed * refill_rate
      
      -- Update tokens, capping at limit + burst
      tokens = math.min(limit + burst, tokens + new_tokens)
      
      -- Check if request can be satisfied
      if tokens >= cost then
        tokens = tokens - cost
        redis.call('HMSET', key, 'tokens', tokens, 'last_refill', now)
        redis.call('EXPIRE', key, window * 2)
        return {1, tokens, limit, burst}
      else
        return {0, tokens, limit, burst}
      end
    `;

    try {
      const result = await this.redis.eval(
        luaScript,
        1,
        bucketKey,
        limit,
        window,
        burst,
        now,
        options.cost || 1
      );

      return {
        allowed: result[0] === 1,
        remaining: Math.floor(result[1]),
        limit: result[2],
        burst: result[3],
        reset: now + window * 1000
      };
    } catch (error) {
      console.error('Token bucket error:', error);
      // Fail open on Redis errors
      return { allowed: true, remaining: limit, limit, burst, reset: now + window * 1000 };
    }
  }

  /**
   * Sliding Window Algorithm
   * Provides smooth rate limiting without sudden resets
   */
  async slidingWindow(key, options = {}) {
    const {
      limit = this.defaultLimit,
      window = this.defaultWindow
    } = options;

    const now = Date.now();
    const windowStart = now - (window * 1000);
    const windowKey = `${this.keyPrefix}sw:${key}`;

    // Lua script for atomic sliding window operations
    const luaScript = `
      local key = KEYS[1]
      local limit = tonumber(ARGV[1])
      local window_start = tonumber(ARGV[2])
      local now = tonumber(ARGV[3])
      local cost = tonumber(ARGV[4]) or 1
      
      -- Remove old entries outside the window
      redis.call('ZREMRANGEBYSCORE', key, 0, window_start)
      
      -- Count requests in current window
      local count = redis.call('ZCARD', key)
      
      -- Check if under limit
      if count + cost <= limit then
        -- Add new request(s)
        for i = 1, cost do
          redis.call('ZADD', key, now, now .. ':' .. i .. ':' .. math.random())
        end
        redis.call('EXPIRE', key, ARGV[5])
        return {1, limit - count - cost, limit}
      else
        return {0, math.max(0, limit - count), limit}
      end
    `;

    try {
      const result = await this.redis.eval(
        luaScript,
        1,
        windowKey,
        limit,
        windowStart,
        now,
        options.cost || 1,
        window * 2
      );

      return {
        allowed: result[0] === 1,
        remaining: result[1],
        limit: result[2],
        reset: now + window * 1000
      };
    } catch (error) {
      console.error('Sliding window error:', error);
      return { allowed: true, remaining: limit, limit, reset: now + window * 1000 };
    }
  }

  /**
   * Fixed Window Algorithm
   * Simple and efficient, resets at fixed intervals
   */
  async fixedWindow(key, options = {}) {
    const {
      limit = this.defaultLimit,
      window = this.defaultWindow
    } = options;

    const now = Date.now();
    const windowId = Math.floor(now / (window * 1000));
    const windowKey = `${this.keyPrefix}fw:${key}:${windowId}`;

    try {
      const cost = options.cost || 1;
      const current = await this.redis.incrby(windowKey, cost);
      
      if (current === cost) {
        await this.redis.expire(windowKey, window);
      }

      const allowed = current <= limit;
      if (!allowed && current === cost + limit) {
        // Rollback if we just exceeded the limit
        await this.redis.decrby(windowKey, cost);
      }

      return {
        allowed,
        remaining: Math.max(0, limit - current + (allowed ? 0 : cost)),
        limit,
        reset: (windowId + 1) * window * 1000
      };
    } catch (error) {
      console.error('Fixed window error:', error);
      return { allowed: true, remaining: limit, limit, reset: now + window * 1000 };
    }
  }

  /**
   * Check rate limit using configured strategy
   */
  async checkLimit(key, options = {}) {
    switch (this.strategy) {
      case 'token-bucket':
        return this.tokenBucket(key, options);
      case 'sliding-window':
        return this.slidingWindow(key, options);
      case 'fixed-window':
        return this.fixedWindow(key, options);
      default:
        throw new Error(`Unknown rate limiting strategy: ${this.strategy}`);
    }
  }

  /**
   * Reset rate limit for a key
   */
  async reset(key) {
    const patterns = [
      `${this.keyPrefix}tb:${key}`,
      `${this.keyPrefix}sw:${key}`,
      `${this.keyPrefix}fw:${key}:*`
    ];

    for (const pattern of patterns) {
      const keys = await this.redis.keys(pattern);
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    }
  }

  /**
   * Get current usage for a key
   */
  async getUsage(key) {
    const result = await this.checkLimit(key, { cost: 0 });
    return {
      used: result.limit - result.remaining,
      limit: result.limit,
      remaining: result.remaining,
      reset: result.reset
    };
  }

  /**
   * Close Redis connection
   */
  async close() {
    await this.redis.quit();
  }
}

module.exports = RateLimiter;