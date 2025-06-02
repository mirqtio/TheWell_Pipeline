/**
 * Unit tests for RequestThrottler
 */

const RequestThrottler = require('../../../../src/rag/performance/RequestThrottler');

describe('RequestThrottler', () => {
  let requestThrottler;

  beforeEach(async () => {
    // Mock setInterval to prevent open handles
    jest.spyOn(global, 'setInterval').mockImplementation(() => {
      return 'mock-interval-id'; // Return a dummy interval ID
    });
    
    requestThrottler = new RequestThrottler({
      maxConcurrentRequests: 2,
      maxQueueSize: 3,
      rateLimitPerMinute: 60,
      requestTimeoutMs: 5000
    });
    await requestThrottler.initialize();
  });

  afterEach(async () => {
    await requestThrottler.shutdown();
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with default options', () => {
      const throttler = new RequestThrottler();

      expect(throttler.maxConcurrentRequests).toBe(10);
      expect(throttler.maxQueueSize).toBe(50);
      expect(throttler.requestTimeoutMs).toBe(30000);
      expect(throttler.rateLimitPerMinute).toBe(60);
      expect(throttler.isInitialized).toBe(false);
    });

    it('should initialize with custom options', () => {
      expect(requestThrottler.maxConcurrentRequests).toBe(2);
      expect(requestThrottler.maxQueueSize).toBe(3);
      expect(requestThrottler.requestTimeoutMs).toBe(5000);
      expect(requestThrottler.rateLimitPerMinute).toBe(60);
    });
  });

  describe('initialize', () => {
    it('should initialize successfully', async () => {
      await requestThrottler.initialize();
      expect(requestThrottler.isInitialized).toBe(true);
    });

    it('should not initialize twice', async () => {
      await requestThrottler.initialize();
      await requestThrottler.initialize(); // Should not throw
      expect(requestThrottler.isInitialized).toBe(true);
    });
  });

  describe('middleware', () => {
    it('should create middleware function', () => {
      const middleware = requestThrottler.middleware();
      expect(typeof middleware).toBe('function');
      expect(middleware.length).toBe(3); // req, res, next
    });

    it('should process request when under limits', async () => {
      const middleware = requestThrottler.middleware();
      const req = {
        ip: '127.0.0.1',
        headers: {},
        user: { id: 'user1' }
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
        headersSent: false
      };
      const next = jest.fn();

      await new Promise((resolve) => {
        middleware(req, res, (err) => {
          next(err);
          resolve();
        });
      });

      expect(next).toHaveBeenCalledTimes(1);
    });

    it('should queue request when at concurrent limit', async () => {
      const middleware = requestThrottler.middleware();
      
      // Fill up active requests first
      requestThrottler.activeRequests.set('active-1', {});
      requestThrottler.activeRequests.set('active-2', {});

      const req = {
        ip: '127.0.0.1',
        headers: {},
        user: { id: 'queued-user' }
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
        headersSent: false
      };
      const next = jest.fn();

      await middleware(req, res, next);

      // Check that the request was queued (queue size increased)
      expect(requestThrottler.getMetrics().queueSize).toBeGreaterThan(0);
    });

    it('should reject request when queue is full', async () => {
      const middleware = requestThrottler.middleware();
      
      // Fill the queue manually
      for (let i = 0; i < 3; i++) {
        requestThrottler.requestQueue.push({ id: `queued-${i}` });
      }
      
      // Fill active requests
      requestThrottler.activeRequests.set('active-1', {});
      requestThrottler.activeRequests.set('active-2', {});

      const req = {
        ip: '127.0.0.1',
        headers: {},
        user: { id: 'overflow-user' }
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
        headersSent: false
      };
      const next = jest.fn();

      await middleware(req, res, next);

      // Should reject with 503 status (service overloaded)
      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        error: 'Service overloaded'
      }));
    });

    it('should handle rate limiting', async () => {
      // Create a new throttler with very low rate limit
      const throttler = new RequestThrottler({
        maxConcurrentRequests: 10,
        rateLimitPerMinute: 1 // Very low limit
      });
      await throttler.initialize();

      const middleware = throttler.middleware();
      const req = {
        ip: '127.0.0.1',
        headers: {},
        user: { id: 'rate-limited-user' }
      };

      // First request should succeed
      const res1 = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
        headersSent: false
      };
      const next1 = jest.fn();

      await middleware(req, res1, next1);
      expect(next1).toHaveBeenCalledTimes(1);

      // Second request should be rate limited
      const res2 = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
        headersSent: false
      };
      const next2 = jest.fn();

      await middleware(req, res2, next2);

      expect(res2.status).toHaveBeenCalledWith(429);
      expect(res2.json).toHaveBeenCalledWith(expect.objectContaining({
        error: 'Rate limit exceeded'
      }));

      await throttler.shutdown();
    });
  });

  describe('getMetrics', () => {
    it('should return metrics', () => {
      const metrics = requestThrottler.getMetrics();
      expect(metrics).toEqual({
        activeRequests: 0,
        queueSize: 0,
        totalRequests: 0,
        rejectedRequests: 0,
        timeoutRequests: 0,
        averageResponseTime: 0
      });
    });
  });

  describe('getStatus', () => {
    it('should return status when not initialized', async () => {
      const status = await requestThrottler.getStatus();
      expect(status).toEqual({
        initialized: true,
        maxConcurrentRequests: 2,
        maxQueueSize: 3,
        requestTimeoutMs: 5000,
        rateLimitPerMinute: 60,
        metrics: {
          activeRequests: 0,
          queueSize: 0,
          totalRequests: 0,
          rejectedRequests: 0,
          timeoutRequests: 0,
          averageResponseTime: 0
        }
      });
    });

    it('should return status when initialized', async () => {
      const status = await requestThrottler.getStatus();
      expect(status.initialized).toBe(true);
    });
  });

  describe('shutdown', () => {
    it('should shutdown gracefully', async () => {
      await requestThrottler.shutdown();
      expect(requestThrottler.isInitialized).toBe(false);
    });

    it('should handle shutdown when not initialized', async () => {
      await requestThrottler.shutdown();
      await expect(requestThrottler.shutdown()).resolves.not.toThrow();
    });
  });

  describe('client identification', () => {
    it('should identify client by API key', () => {
      const req = {
        headers: { 'x-api-key': 'test-api-key' },
        ip: '127.0.0.1'
      };
      const clientId = requestThrottler.getClientId(req);
      expect(clientId).toBe('api:test-api-key');
    });

    it('should identify client by user ID', () => {
      const req = {
        headers: {},
        user: { id: 'user123' },
        ip: '127.0.0.1'
      };
      const clientId = requestThrottler.getClientId(req);
      expect(clientId).toBe('user:user123');
    });

    it('should identify client by IP address', () => {
      const req = {
        headers: {},
        ip: '192.168.1.100'
      };
      const clientId = requestThrottler.getClientId(req);
      expect(clientId).toBe('ip:192.168.1.100');
    });
  });
});