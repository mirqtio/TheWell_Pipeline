const RateLimiter = require('../../../src/middleware/RateLimiter');
const Redis = require('ioredis-mock');

jest.mock('../../../src/database/DatabaseManager', () => ({
  getInstance: jest.fn(() => ({
    query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    connect: jest.fn().mockResolvedValue({
      query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: jest.fn()
    }),
    transaction: jest.fn((callback) => {
      const mockTrx = {
        query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
        commit: jest.fn(),
        rollback: jest.fn()
      };
      return callback(mockTrx);
    })
  }))
}));

describe('RateLimiter', () => {
  let rateLimiter;
  let redis;

  beforeEach(() => {
    redis = new Redis();
    rateLimiter = new RateLimiter({ redis });
  });

  afterEach(async () => {
    await redis.flushall();
    await rateLimiter.close();
  });

  describe('Token Bucket Algorithm', () => {
    beforeEach(() => {
      rateLimiter.strategy = 'token-bucket';
    });

    test('should allow requests within limit', async () => {
      const key = 'test-user';
      const options = { limit: 10, window: 60, burst: 5 };

      for (let i = 0; i < 10; i++) {
        const result = await rateLimiter.tokenBucket(key, options);
        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(9 - i);
        expect(result.limit).toBe(10);
        expect(result.burst).toBe(5);
      }
    });

    test('should block requests exceeding limit', async () => {
      const key = 'test-user';
      const options = { limit: 5, window: 60, burst: 2 };

      // Consume all tokens including burst
      for (let i = 0; i < 7; i++) {
        await rateLimiter.tokenBucket(key, options);
      }

      // Next request should be blocked
      const result = await rateLimiter.tokenBucket(key, options);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    test('should handle burst traffic', async () => {
      const key = 'test-user';
      const options = { limit: 10, window: 3600, burst: 5 };

      // Should allow limit + burst requests immediately
      for (let i = 0; i < 15; i++) {
        const result = await rateLimiter.tokenBucket(key, options);
        expect(result.allowed).toBe(true);
      }

      // 16th request should be blocked
      const result = await rateLimiter.tokenBucket(key, options);
      expect(result.allowed).toBe(false);
    });

    test('should handle custom cost', async () => {
      const key = 'test-user';
      const options = { limit: 10, window: 60, burst: 0, cost: 5 };

      // First request costs 5 tokens
      let result = await rateLimiter.tokenBucket(key, options);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(5);

      // Second request costs 5 tokens
      result = await rateLimiter.tokenBucket(key, options);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(0);

      // Third request should be blocked
      result = await rateLimiter.tokenBucket(key, options);
      expect(result.allowed).toBe(false);
    });
  });

  describe('Sliding Window Algorithm', () => {
    beforeEach(() => {
      rateLimiter.strategy = 'sliding-window';
    });

    test('should allow requests within limit', async () => {
      const key = 'test-user';
      const options = { limit: 10, window: 60 };

      for (let i = 0; i < 10; i++) {
        const result = await rateLimiter.slidingWindow(key, options);
        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(9 - i);
        expect(result.limit).toBe(10);
      }
    });

    test('should block requests exceeding limit', async () => {
      const key = 'test-user';
      const options = { limit: 5, window: 60 };

      // Consume all allowed requests
      for (let i = 0; i < 5; i++) {
        await rateLimiter.slidingWindow(key, options);
      }

      // Next request should be blocked
      const result = await rateLimiter.slidingWindow(key, options);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    test('should remove old entries outside window', async () => {
      const key = 'test-user';
      const options = { limit: 5, window: 1 }; // 1 second window

      // Make 5 requests
      for (let i = 0; i < 5; i++) {
        await rateLimiter.slidingWindow(key, options);
      }

      // Wait for window to pass
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Should allow new requests
      const result = await rateLimiter.slidingWindow(key, options);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4);
    });

    test('should handle custom cost', async () => {
      const key = 'test-user';
      const options = { limit: 10, window: 60, cost: 3 };

      // First request costs 3
      let result = await rateLimiter.slidingWindow(key, options);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(7);

      // Second request costs 3
      result = await rateLimiter.slidingWindow(key, options);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4);

      // Third request costs 3
      result = await rateLimiter.slidingWindow(key, options);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(1);

      // Fourth request should be blocked (would exceed limit)
      result = await rateLimiter.slidingWindow(key, options);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(1);
    });
  });

  describe('Fixed Window Algorithm', () => {
    beforeEach(() => {
      rateLimiter.strategy = 'fixed-window';
    });

    test('should allow requests within limit', async () => {
      const key = 'test-user';
      const options = { limit: 10, window: 60 };

      for (let i = 0; i < 10; i++) {
        const result = await rateLimiter.fixedWindow(key, options);
        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(9 - i);
        expect(result.limit).toBe(10);
      }
    });

    test('should block requests exceeding limit', async () => {
      const key = 'test-user';
      const options = { limit: 5, window: 60 };

      // Consume all allowed requests
      for (let i = 0; i < 5; i++) {
        await rateLimiter.fixedWindow(key, options);
      }

      // Next request should be blocked
      const result = await rateLimiter.fixedWindow(key, options);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    test('should reset at window boundaries', async () => {
      const key = 'test-user';
      const options = { limit: 5, window: 1 }; // 1 second window

      // Get current window
      const now = Date.now();
      const windowId = Math.floor(now / 1000);

      // Make 5 requests
      for (let i = 0; i < 5; i++) {
        await rateLimiter.fixedWindow(key, options);
      }

      // Wait for next window
      const nextWindow = (windowId + 1) * 1000;
      const waitTime = nextWindow - Date.now() + 100;
      await new Promise(resolve => setTimeout(resolve, waitTime));

      // Should allow new requests in new window
      const result = await rateLimiter.fixedWindow(key, options);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4);
    });

    test('should handle custom cost', async () => {
      const key = 'test-user';
      const options = { limit: 10, window: 60, cost: 4 };

      // First request costs 4
      let result = await rateLimiter.fixedWindow(key, options);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(6);

      // Second request costs 4
      result = await rateLimiter.fixedWindow(key, options);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(2);

      // Third request should be blocked (would exceed limit)
      result = await rateLimiter.fixedWindow(key, options);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(2);
    });
  });

  describe('checkLimit', () => {
    test('should use configured strategy', async () => {
      const key = 'test-user';
      const options = { limit: 10, window: 60 };

      // Test token bucket
      rateLimiter.strategy = 'token-bucket';
      let result = await rateLimiter.checkLimit(key, options);
      expect(result).toHaveProperty('allowed');
      expect(result).toHaveProperty('burst');

      // Test sliding window
      rateLimiter.strategy = 'sliding-window';
      result = await rateLimiter.checkLimit(key, options);
      expect(result).toHaveProperty('allowed');
      expect(result).not.toHaveProperty('burst');

      // Test fixed window
      rateLimiter.strategy = 'fixed-window';
      result = await rateLimiter.checkLimit(key, options);
      expect(result).toHaveProperty('allowed');
      expect(result).not.toHaveProperty('burst');
    });

    test('should throw error for unknown strategy', async () => {
      rateLimiter.strategy = 'unknown';
      await expect(
        rateLimiter.checkLimit('test-user', {})
      ).rejects.toThrow('Unknown rate limiting strategy: unknown');
    });
  });

  describe('reset', () => {
    test('should reset all rate limits for a key', async () => {
      const key = 'test-user';
      const options = { limit: 5, window: 60 };

      // Create limits with different strategies
      await rateLimiter.tokenBucket(key, options);
      await rateLimiter.slidingWindow(key, options);
      await rateLimiter.fixedWindow(key, options);

      // Reset
      await rateLimiter.reset(key);

      // All strategies should allow requests again
      let result = await rateLimiter.tokenBucket(key, options);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4);

      result = await rateLimiter.slidingWindow(key, options);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4);

      result = await rateLimiter.fixedWindow(key, options);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4);
    });
  });

  describe('getUsage', () => {
    test('should return current usage statistics', async () => {
      const key = 'test-user';
      const options = { limit: 10, window: 60 };

      // Make some requests
      for (let i = 0; i < 3; i++) {
        await rateLimiter.checkLimit(key, options);
      }

      const usage = await rateLimiter.getUsage(key);
      expect(usage.used).toBe(3);
      expect(usage.limit).toBe(10);
      expect(usage.remaining).toBe(7);
      expect(usage.reset).toBeGreaterThan(Date.now());
    });
  });

  describe('Error handling', () => {
    test('should fail open on Redis errors', async () => {
      // Create limiter with failing Redis
      const failingRedis = {
        eval: jest.fn().mockRejectedValue(new Error('Redis error')),
        incrby: jest.fn().mockRejectedValue(new Error('Redis error')),
        expire: jest.fn().mockRejectedValue(new Error('Redis error')),
        keys: jest.fn().mockRejectedValue(new Error('Redis error')),
        del: jest.fn().mockRejectedValue(new Error('Redis error')),
        quit: jest.fn().mockResolvedValue()
      };

      const failingLimiter = new RateLimiter({ redis: failingRedis });

      // Should allow requests even with Redis errors
      const result = await failingLimiter.checkLimit('test-user', {});
      expect(result.allowed).toBe(true);

      await failingLimiter.close();
    });
  });
});