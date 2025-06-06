const RateLimiter = require('../../src/middleware/RateLimiter');
const RateLimitService = require('../../src/services/RateLimitService');
const Redis = require('ioredis');
const { performance } = require('perf_hooks');

describe('Rate Limiting Performance Tests', () => {
  let rateLimiter;
  let rateLimitService;
  let redis;

  beforeAll(async () => {
    redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      db: 14 // Performance test database
    });
    
    await redis.flushall();
    
    rateLimiter = new RateLimiter({ redis });
    rateLimitService = new RateLimitService({ redis });
    await rateLimitService.initialize();
  });

  afterAll(async () => {
    await rateLimitService.close();
    await rateLimiter.close();
    await redis.quit();
  });

  describe('Token Bucket Performance', () => {
    test('should handle high request rate', async () => {
      const iterations = 10000;
      const concurrency = 10;
      const results = [];

      const start = performance.now();

      // Run concurrent requests
      const promises = [];
      for (let i = 0; i < concurrency; i++) {
        const promise = (async () => {
          const localResults = [];
          for (let j = 0; j < iterations / concurrency; j++) {
            const reqStart = performance.now();
            const result = await rateLimiter.tokenBucket(`perf-user-${i}`, {
              limit: 1000,
              window: 60,
              burst: 100
            });
            const reqEnd = performance.now();
            localResults.push({
              duration: reqEnd - reqStart,
              allowed: result.allowed
            });
          }
          return localResults;
        })();
        promises.push(promise);
      }

      const allResults = await Promise.all(promises);
      allResults.forEach(r => results.push(...r));

      const end = performance.now();
      const totalDuration = end - start;

      // Calculate statistics
      const durations = results.map(r => r.duration);
      const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
      const maxDuration = Math.max(...durations);
      const minDuration = Math.min(...durations);
      const requestsPerSecond = iterations / (totalDuration / 1000);

      console.log('Token Bucket Performance:');
      console.log(`Total requests: ${iterations}`);
      console.log(`Total duration: ${totalDuration.toFixed(2)}ms`);
      console.log(`Requests/second: ${requestsPerSecond.toFixed(0)}`);
      console.log(`Avg request time: ${avgDuration.toFixed(2)}ms`);
      console.log(`Min request time: ${minDuration.toFixed(2)}ms`);
      console.log(`Max request time: ${maxDuration.toFixed(2)}ms`);

      // Performance assertions
      expect(requestsPerSecond).toBeGreaterThan(1000); // Should handle >1000 req/s
      expect(avgDuration).toBeLessThan(10); // Avg should be <10ms
      expect(maxDuration).toBeLessThan(100); // Max should be <100ms
    });
  });

  describe('Sliding Window Performance', () => {
    test('should handle high request rate', async () => {
      const iterations = 10000;
      const concurrency = 10;
      const results = [];

      const start = performance.now();

      // Run concurrent requests
      const promises = [];
      for (let i = 0; i < concurrency; i++) {
        const promise = (async () => {
          const localResults = [];
          for (let j = 0; j < iterations / concurrency; j++) {
            const reqStart = performance.now();
            const result = await rateLimiter.slidingWindow(`perf-sw-user-${i}`, {
              limit: 1000,
              window: 60
            });
            const reqEnd = performance.now();
            localResults.push({
              duration: reqEnd - reqStart,
              allowed: result.allowed
            });
          }
          return localResults;
        })();
        promises.push(promise);
      }

      const allResults = await Promise.all(promises);
      allResults.forEach(r => results.push(...r));

      const end = performance.now();
      const totalDuration = end - start;

      // Calculate statistics
      const durations = results.map(r => r.duration);
      const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
      const requestsPerSecond = iterations / (totalDuration / 1000);

      console.log('\nSliding Window Performance:');
      console.log(`Total requests: ${iterations}`);
      console.log(`Total duration: ${totalDuration.toFixed(2)}ms`);
      console.log(`Requests/second: ${requestsPerSecond.toFixed(0)}`);
      console.log(`Avg request time: ${avgDuration.toFixed(2)}ms`);

      // Performance assertions
      expect(requestsPerSecond).toBeGreaterThan(800); // Should handle >800 req/s
      expect(avgDuration).toBeLessThan(15); // Avg should be <15ms
    });
  });

  describe('Memory Usage', () => {
    test('should efficiently handle many unique keys', async () => {
      const uniqueKeys = 10000;
      const requestsPerKey = 10;

      const start = performance.now();
      const initialMemory = process.memoryUsage();

      // Create many unique keys
      for (let i = 0; i < uniqueKeys; i++) {
        for (let j = 0; j < requestsPerKey; j++) {
          await rateLimiter.tokenBucket(`memory-test-${i}`, {
            limit: 100,
            window: 60,
            burst: 10
          });
        }
      }

      const end = performance.now();
      const finalMemory = process.memoryUsage();

      const duration = end - start;
      const memoryIncrease = (finalMemory.heapUsed - initialMemory.heapUsed) / 1024 / 1024;

      console.log('\nMemory Usage Test:');
      console.log(`Unique keys: ${uniqueKeys}`);
      console.log(`Total requests: ${uniqueKeys * requestsPerKey}`);
      console.log(`Duration: ${duration.toFixed(2)}ms`);
      console.log(`Memory increase: ${memoryIncrease.toFixed(2)}MB`);
      console.log(`Memory per key: ${(memoryIncrease / uniqueKeys * 1024).toFixed(2)}KB`);

      // Memory assertions
      expect(memoryIncrease).toBeLessThan(100); // Should use <100MB for 10k keys
    });
  });

  describe('Concurrent Access', () => {
    test('should handle race conditions correctly', async () => {
      const key = 'race-test';
      const limit = 100;
      const concurrentRequests = 200;

      // Reset key
      await rateLimiter.reset(key);

      // Make many concurrent requests
      const promises = [];
      for (let i = 0; i < concurrentRequests; i++) {
        promises.push(
          rateLimiter.tokenBucket(key, {
            limit,
            window: 60,
            burst: 0
          })
        );
      }

      const results = await Promise.all(promises);

      // Count allowed and blocked requests
      const allowed = results.filter(r => r.allowed).length;
      const blocked = results.filter(r => !r.allowed).length;

      console.log('\nConcurrent Access Test:');
      console.log(`Total requests: ${concurrentRequests}`);
      console.log(`Allowed: ${allowed}`);
      console.log(`Blocked: ${blocked}`);

      // Should respect the limit exactly
      expect(allowed).toBe(limit);
      expect(blocked).toBe(concurrentRequests - limit);
    });
  });

  describe('Service Performance', () => {
    test('should efficiently track usage across endpoints', async () => {
      const users = 100;
      const endpoints = ['/api/search', '/api/documents', '/api/enrichment'];
      const requestsPerUserPerEndpoint = 50;

      const start = performance.now();

      // Simulate many users hitting different endpoints
      const promises = [];
      for (let i = 0; i < users; i++) {
        for (const endpoint of endpoints) {
          const promise = (async () => {
            for (let j = 0; j < requestsPerUserPerEndpoint; j++) {
              await rateLimitService.checkRateLimit(
                `user:${i}`,
                endpoint,
                'GET',
                { tier: 'basic' }
              );
            }
          })();
          promises.push(promise);
        }
      }

      await Promise.all(promises);

      const end = performance.now();
      const duration = end - start;
      const totalRequests = users * endpoints.length * requestsPerUserPerEndpoint;
      const requestsPerSecond = totalRequests / (duration / 1000);

      console.log('\nService Performance Test:');
      console.log(`Users: ${users}`);
      console.log(`Endpoints: ${endpoints.length}`);
      console.log(`Total requests: ${totalRequests}`);
      console.log(`Duration: ${duration.toFixed(2)}ms`);
      console.log(`Requests/second: ${requestsPerSecond.toFixed(0)}`);

      // Service should handle high throughput
      expect(requestsPerSecond).toBeGreaterThan(500);
    });
  });

  describe('Analytics Performance', () => {
    test('should efficiently flush usage data', async () => {
      const batchSize = 1000;
      
      // Generate usage data
      for (let i = 0; i < batchSize; i++) {
        rateLimitService.trackUsage(
          `analytics-user-${i % 100}`,
          `/api/endpoint-${i % 10}`,
          'GET',
          {
            tier: 'basic',
            cost: 1,
            timestamp: Date.now()
          }
        );
      }

      const start = performance.now();
      await rateLimitService.flushUsageData();
      const end = performance.now();

      const flushDuration = end - start;

      console.log('\nAnalytics Flush Performance:');
      console.log(`Batch size: ${batchSize}`);
      console.log(`Flush duration: ${flushDuration.toFixed(2)}ms`);
      console.log(`Records/second: ${(batchSize / (flushDuration / 1000)).toFixed(0)}`);

      // Flush should be fast
      expect(flushDuration).toBeLessThan(1000); // Should flush in <1s
    });
  });

  describe('Scalability', () => {
    test('should maintain performance with increasing load', async () => {
      const loads = [100, 500, 1000, 2000];
      const results = [];

      for (const load of loads) {
        const start = performance.now();
        
        const promises = [];
        for (let i = 0; i < load; i++) {
          promises.push(
            rateLimiter.tokenBucket(`scale-test-${i % 100}`, {
              limit: 1000,
              window: 60,
              burst: 100
            })
          );
        }

        await Promise.all(promises);
        
        const end = performance.now();
        const duration = end - start;
        const avgTime = duration / load;

        results.push({
          load,
          duration,
          avgTime,
          throughput: load / (duration / 1000)
        });
      }

      console.log('\nScalability Test:');
      results.forEach(r => {
        console.log(`Load: ${r.load}, Avg time: ${r.avgTime.toFixed(2)}ms, Throughput: ${r.throughput.toFixed(0)} req/s`);
      });

      // Average time should not increase significantly with load
      const firstAvg = results[0].avgTime;
      const lastAvg = results[results.length - 1].avgTime;
      expect(lastAvg / firstAvg).toBeLessThan(2); // Should not double
    });
  });
});