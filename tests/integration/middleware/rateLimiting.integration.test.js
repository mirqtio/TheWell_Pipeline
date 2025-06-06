const request = require('supertest');
const express = require('express');
const { createRateLimitMiddleware, cleanup } = require('../../../src/middleware/rateLimitMiddleware');
const DatabaseManager = require('../../../src/database/DatabaseManager');
const { setupTestDatabase } = require('../../helpers/database');
const Redis = require('ioredis');

describe('Rate Limiting Middleware Integration', () => {
  let app;
  let db;
  let redis;
  let testUser;

  beforeAll(async () => {
    db = await setupTestDatabase();
    redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      db: 15 // Test database
    });
    await redis.flushall();
  });

  afterAll(async () => {
    await cleanup();
    await redis.quit();
    await db.close();
  });

  beforeEach(async () => {
    // Clear data
    await db.query('DELETE FROM rate_limit_usage');
    await db.query('DELETE FROM rate_limit_violations');
    await db.query('DELETE FROM api_keys');
    await db.query('DELETE FROM users WHERE email LIKE $1', ['%@test.com']);
    await redis.flushall();

    // Create test user
    const userResult = await db.query(`
      INSERT INTO users (email, password_hash, role, tier)
      VALUES ($1, $2, $3, $4)
      RETURNING id, email, role, tier
    `, ['test@test.com', 'hash', 'user', 'basic']);
    testUser = userResult.rows[0];

    // Create test app
    app = express();
    app.use(express.json());
    app.locals.db = db;

    // Add rate limiting middleware
    app.use(createRateLimitMiddleware({ db }));

    // Test routes
    app.get('/api/test', (req, res) => {
      res.json({ message: 'success' });
    });

    app.get('/api/health', (req, res) => {
      res.json({ status: 'ok' });
    });

    app.post('/api/expensive', (req, res) => {
      res.json({ message: 'expensive operation' });
    });

    // Auth simulation middleware
    app.use((req, res, next) => {
      if (req.headers.authorization === `Bearer user:${testUser.id}`) {
        req.user = testUser;
      }
      next();
    });
  });

  describe('Basic Rate Limiting', () => {
    test('should allow requests within limit', async () => {
      const requests = 10;
      const responses = [];

      for (let i = 0; i < requests; i++) {
        const res = await request(app)
          .get('/api/test')
          .set('X-Real-IP', '1.2.3.4');
        responses.push(res);
      }

      // All requests should succeed
      responses.forEach(res => {
        expect(res.status).toBe(200);
        expect(res.headers['x-ratelimit-limit']).toBeDefined();
        expect(res.headers['x-ratelimit-remaining']).toBeDefined();
        expect(res.headers['x-ratelimit-reset']).toBeDefined();
      });

      // Check decreasing remaining count
      const remainingCounts = responses.map(r => 
        parseInt(r.headers['x-ratelimit-remaining'])
      );
      for (let i = 1; i < remainingCounts.length; i++) {
        expect(remainingCounts[i]).toBeLessThan(remainingCounts[i - 1]);
      }
    });

    test('should block requests exceeding limit', async () => {
      // Make many requests to exceed limit
      const responses = [];
      for (let i = 0; i < 150; i++) {
        const res = await request(app)
          .get('/api/test')
          .set('X-Real-IP', '1.2.3.5');
        responses.push(res);
        
        if (res.status === 429) break;
      }

      // Find the blocked request
      const blockedResponse = responses.find(r => r.status === 429);
      expect(blockedResponse).toBeDefined();
      expect(blockedResponse.headers['retry-after']).toBeDefined();
      expect(blockedResponse.body).toEqual({
        error: 'rate_limit_exceeded',
        message: expect.stringContaining('Rate limit exceeded'),
        retryAfter: expect.any(Number),
        limit: expect.any(Number),
        reset: expect.any(Number),
        tier: 'anonymous'
      });
    });
  });

  describe('Authenticated Rate Limiting', () => {
    test('should use higher limits for authenticated users', async () => {
      // Anonymous request
      const anonRes = await request(app)
        .get('/api/test')
        .set('X-Real-IP', '1.2.3.6');

      // Authenticated request
      const authRes = await request(app)
        .get('/api/test')
        .set('Authorization', `Bearer user:${testUser.id}`);

      expect(parseInt(anonRes.headers['x-ratelimit-limit'])).toBeLessThan(
        parseInt(authRes.headers['x-ratelimit-limit'])
      );
      expect(authRes.headers['x-ratelimit-tier']).toBe('basic');
    });
  });

  describe('API Key Rate Limiting', () => {
    let apiKey;

    beforeEach(async () => {
      // Generate API key
      const keyResult = await db.query(`
        INSERT INTO api_keys (key_hash, user_id, name, tier, is_active)
        VALUES ($1, $2, $3, $4, true)
        RETURNING id
      `, [
        require('crypto').createHash('sha256').update('thewell_testkey123').digest('hex'),
        testUser.id,
        'Test Key',
        'premium'
      ]);

      apiKey = 'thewell_testkey123';
    });

    test('should authenticate with API key', async () => {
      const res = await request(app)
        .get('/api/test')
        .set('Authorization', `Bearer ${apiKey}`);

      expect(res.status).toBe(200);
      expect(res.headers['x-ratelimit-tier']).toBe('premium');
    });

    test('should reject invalid API key', async () => {
      const res = await request(app)
        .get('/api/test')
        .set('Authorization', 'Bearer thewell_invalidkey');

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('unauthorized');
    });
  });

  describe('Endpoint-Specific Limits', () => {
    test('should bypass rate limiting for health endpoint', async () => {
      // Make many requests to health endpoint
      for (let i = 0; i < 200; i++) {
        const res = await request(app)
          .get('/api/health')
          .set('X-Real-IP', '1.2.3.7');

        expect(res.status).toBe(200);
        expect(res.headers['x-ratelimit-limit']).toBe('unlimited');
      }
    });

    test('should apply different costs for different endpoints', async () => {
      // Regular endpoint
      const regularRes = await request(app)
        .get('/api/test')
        .set('X-Real-IP', '1.2.3.8');

      const remainingAfterRegular = parseInt(regularRes.headers['x-ratelimit-remaining']);

      // Expensive endpoint (should cost more)
      const expensiveRes = await request(app)
        .post('/api/expensive')
        .set('X-Real-IP', '1.2.3.8')
        .send({});

      const remainingAfterExpensive = parseInt(expensiveRes.headers['x-ratelimit-remaining']);

      // Expensive operation should consume more tokens
      expect(remainingAfterRegular - remainingAfterExpensive).toBeGreaterThan(1);
    });
  });

  describe('Headers and Responses', () => {
    test('should include proper rate limit headers', async () => {
      const res = await request(app)
        .get('/api/test')
        .set('X-Real-IP', '1.2.3.9');

      expect(res.headers['x-ratelimit-limit']).toBeDefined();
      expect(res.headers['x-ratelimit-remaining']).toBeDefined();
      expect(res.headers['x-ratelimit-reset']).toBeDefined();
      expect(res.headers['x-ratelimit-tier']).toBeDefined();
    });

    test('should show warning when approaching limit', async () => {
      // Consume most of the rate limit
      const limit = 100; // Anonymous limit
      const threshold = Math.floor(limit * 0.8);

      for (let i = 0; i < threshold + 5; i++) {
        const res = await request(app)
          .get('/api/test')
          .set('X-Real-IP', '1.2.3.10');

        if (i >= threshold) {
          expect(res.headers['x-ratelimit-warning']).toBe('Approaching rate limit');
        }
      }
    });
  });

  describe('IP-Based Limiting', () => {
    test('should track limits per IP for anonymous users', async () => {
      // Requests from different IPs should have separate limits
      const res1 = await request(app)
        .get('/api/test')
        .set('X-Real-IP', '1.2.3.11');

      const res2 = await request(app)
        .get('/api/test')
        .set('X-Real-IP', '1.2.3.12');

      expect(res1.headers['x-ratelimit-remaining']).toBe(
        res2.headers['x-ratelimit-remaining']
      );
    });

    test('should whitelist localhost', async () => {
      // Localhost should bypass rate limiting
      for (let i = 0; i < 200; i++) {
        const res = await request(app)
          .get('/api/test')
          .set('X-Real-IP', '127.0.0.1');

        expect(res.status).toBe(200);
      }
    });
  });

  describe('Usage Tracking', () => {
    test('should track usage in database', async () => {
      // Make some requests
      for (let i = 0; i < 5; i++) {
        await request(app)
          .get('/api/test')
          .set('X-Real-IP', '1.2.3.13');
      }

      // Wait for usage to be flushed
      await new Promise(resolve => setTimeout(resolve, 6000));

      // Check usage was recorded
      const usage = await db.query(`
        SELECT * FROM rate_limit_usage
        WHERE identifier = $1 AND endpoint = $2
      `, ['ip:1.2.3.13', '/api/test']);

      expect(usage.rows.length).toBeGreaterThan(0);
      expect(usage.rows[0].request_count).toBeGreaterThanOrEqual(5);
    });

    test('should track violations', async () => {
      // Exceed rate limit
      for (let i = 0; i < 150; i++) {
        const res = await request(app)
          .get('/api/test')
          .set('X-Real-IP', '1.2.3.14');
        
        if (res.status === 429) break;
      }

      // Wait a bit for async operations
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Check violation was recorded
      const violations = await db.query(`
        SELECT * FROM rate_limit_violations
        WHERE identifier LIKE $1
      `, ['%1.2.3.14%']);

      expect(violations.rows.length).toBeGreaterThan(0);
    });
  });

  describe('Error Handling', () => {
    test('should fail open on Redis connection issues', async () => {
      // Temporarily break Redis connection
      await redis.quit();

      // Requests should still work
      const res = await request(app)
        .get('/api/test')
        .set('X-Real-IP', '1.2.3.15');

      expect(res.status).toBe(200);

      // Reconnect for cleanup
      redis = new Redis({
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379,
        db: 15
      });
    });
  });
});