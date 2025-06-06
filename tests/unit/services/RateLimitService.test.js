const RateLimitService = require('../../../src/services/RateLimitService');
const DatabaseManager = require('../../../src/database/DatabaseManager');
const Redis = require('ioredis-mock');
const crypto = require('crypto');

// Mock the database
jest.mock('../../../src/database/DatabaseManager');

describe('RateLimitService', () => {
  let service;
  let mockDb;
  let mockRedis;

  beforeEach(() => {
    // Mock database
    mockDb = {
      query: jest.fn().mockResolvedValue({ rows: [] })
    };
    DatabaseManager.getInstance.mockReturnValue(mockDb);

    // Mock Redis
    mockRedis = new Redis();
    
    service = new RateLimitService({ db: mockDb });
    service.rateLimitRedis = mockRedis;
    service.analyticsRedis = mockRedis;
  });

  afterEach(async () => {
    await service.close();
    jest.clearAllMocks();
  });

  describe('checkRateLimit', () => {
    test('should check rate limit for user', async () => {
      const result = await service.checkRateLimit('user123', '/api/test', 'GET', {
        type: 'user',
        tier: 'basic'
      });

      expect(result).toMatchObject({
        allowed: expect.any(Boolean),
        remaining: expect.any(Number),
        limit: expect.any(Number),
        reset: expect.any(Number),
        tier: 'basic',
        cost: expect.any(Number),
        strategy: expect.any(String)
      });
    });

    test('should enforce tier requirements', async () => {
      const result = await service.checkRateLimit('user123', '/api/admin/test', 'GET', {
        type: 'user',
        tier: 'basic'
      });

      expect(result).toMatchObject({
        allowed: false,
        reason: 'insufficient_tier',
        currentTier: 'basic',
        requiredTier: 'admin'
      });
    });

    test('should bypass rate limiting for health endpoint', async () => {
      const result = await service.checkRateLimit('user123', '/api/health', 'GET');

      expect(result).toMatchObject({
        allowed: true,
        unlimited: true
      });
    });

    test('should handle daily limits', async () => {
      // Mock daily limit check
      jest.spyOn(service, 'checkDailyLimit').mockResolvedValue({
        allowed: false,
        dailyLimit: 5000,
        dailyUsed: 5000,
        dailyRemaining: 0,
        dailyReset: Date.now() + 86400000
      });

      const result = await service.checkRateLimit('user123', '/api/test', 'GET', {
        tier: 'basic'
      });

      expect(result).toMatchObject({
        allowed: false,
        reason: 'daily_limit_exceeded'
      });
    });

    test('should track usage for analytics', async () => {
      const trackUsageSpy = jest.spyOn(service, 'trackUsage');

      await service.checkRateLimit('user123', '/api/test', 'GET', {
        tier: 'premium',
        apiKey: 'key123'
      });

      expect(trackUsageSpy).toHaveBeenCalledWith(
        'user123',
        '/api/test',
        'GET',
        expect.objectContaining({
          tier: 'premium',
          apiKey: 'key123',
          cost: expect.any(Number),
          timestamp: expect.any(Number)
        })
      );
    });

    test('should fail open on errors', async () => {
      // Force an error
      jest.spyOn(service.limiters['sliding-window'], 'checkLimit')
        .mockRejectedValue(new Error('Redis error'));

      const result = await service.checkRateLimit('user123', '/api/test');

      expect(result).toMatchObject({
        allowed: true,
        error: true
      });
    });
  });

  describe('API Key Management', () => {
    describe('generateApiKey', () => {
      test('should generate API key', async () => {
        mockDb.query.mockResolvedValueOnce({
          rows: [{ id: 1, created_at: new Date() }]
        });

        const result = await service.generateApiKey('user123', {
          name: 'Test Key',
          tier: 'premium',
          expiresIn: 3600
        });

        expect(result).toMatchObject({
          id: 1,
          apiKey: expect.stringMatching(/^thewell_[\w-]+$/),
          name: 'Test Key',
          tier: 'premium',
          createdAt: expect.any(Date),
          expiresAt: expect.any(Date)
        });

        // Check database call
        expect(mockDb.query).toHaveBeenCalledWith(
          expect.stringContaining('INSERT INTO api_keys'),
          expect.arrayContaining([
            expect.any(String), // key_hash
            'user123',
            'Test Key',
            'premium',
            null, // custom_limits
            expect.any(Date) // expires_at
          ])
        );
      });

      test('should hash API key before storage', async () => {
        mockDb.query.mockResolvedValueOnce({
          rows: [{ id: 1, created_at: new Date() }]
        });

        const result = await service.generateApiKey('user123');
        const keyHash = crypto.createHash('sha256').update(result.apiKey).digest('hex');

        expect(mockDb.query).toHaveBeenCalledWith(
          expect.any(String),
          expect.arrayContaining([keyHash])
        );
      });
    });

    describe('validateApiKey', () => {
      test('should validate valid API key', async () => {
        const apiKey = 'thewell_testkey123';
        const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');

        mockDb.query.mockResolvedValueOnce({
          rows: [{
            id: 1,
            user_id: 'user123',
            name: 'Test Key',
            tier: 'premium',
            custom_limits: null,
            is_active: true,
            expires_at: null,
            rate_limit_override: null,
            email: 'test@example.com',
            role: 'user'
          }]
        });

        const result = await service.validateApiKey(apiKey);

        expect(result).toMatchObject({
          id: 1,
          userId: 'user123',
          name: 'Test Key',
          tier: 'premium',
          user: {
            email: 'test@example.com',
            role: 'user'
          }
        });

        expect(mockDb.query).toHaveBeenCalledWith(
          expect.stringContaining('SELECT'),
          [keyHash]
        );
      });

      test('should reject invalid API key', async () => {
        mockDb.query.mockResolvedValueOnce({ rows: [] });

        const result = await service.validateApiKey('thewell_invalidkey');

        expect(result).toBeNull();
      });

      test('should reject non-thewell API key', async () => {
        const result = await service.validateApiKey('invalid_format');

        expect(result).toBeNull();
        expect(mockDb.query).not.toHaveBeenCalled();
      });

      test('should update last used timestamp', async () => {
        const apiKey = 'thewell_testkey123';

        mockDb.query
          .mockResolvedValueOnce({
            rows: [{
              id: 1,
              user_id: 'user123',
              name: 'Test Key',
              tier: 'premium',
              email: 'test@example.com',
              role: 'user'
            }]
          })
          .mockResolvedValueOnce({ rows: [] });

        await service.validateApiKey(apiKey);

        // Wait for async update
        await new Promise(resolve => setTimeout(resolve, 10));

        expect(mockDb.query).toHaveBeenCalledWith(
          'UPDATE api_keys SET last_used_at = NOW() WHERE id = $1',
          [1]
        );
      });
    });

    describe('rotateApiKey', () => {
      test('should rotate API key', async () => {
        // Mock existing key lookup
        mockDb.query.mockResolvedValueOnce({
          rows: [{
            name: 'Original Key',
            tier: 'premium',
            custom_limits: null
          }]
        });

        // Mock new key creation
        mockDb.query.mockResolvedValueOnce({
          rows: [{ id: 2, created_at: new Date() }]
        });

        // Mock deactivation
        mockDb.query.mockResolvedValueOnce({ rows: [] });

        const result = await service.rotateApiKey(1, 'user123');

        expect(result).toMatchObject({
          id: 2,
          apiKey: expect.stringMatching(/^thewell_/),
          name: 'Original Key (Rotated)',
          tier: 'premium'
        });

        // Check deactivation query
        expect(mockDb.query).toHaveBeenCalledWith(
          'UPDATE api_keys SET is_active = false, rotated_to = $1 WHERE id = $2',
          [2, 1]
        );
      });

      test('should throw error if key not found', async () => {
        mockDb.query.mockResolvedValueOnce({ rows: [] });

        await expect(
          service.rotateApiKey(999, 'user123')
        ).rejects.toThrow('API key not found');
      });
    });
  });

  describe('Usage Tracking', () => {
    test('should buffer usage data', () => {
      service.trackUsage('user123', '/api/test', 'GET', {
        tier: 'basic',
        cost: 1,
        timestamp: Date.now()
      });

      expect(service.usageBuffer.size).toBe(1);
      
      const key = Array.from(service.usageBuffer.keys())[0];
      const data = service.usageBuffer.get(key);
      
      expect(data).toMatchObject({
        count: 1,
        totalCost: 1,
        firstSeen: expect.any(Number),
        lastSeen: expect.any(Number),
        metadata: expect.objectContaining({
          tier: 'basic',
          cost: 1
        })
      });
    });

    test('should aggregate multiple requests', () => {
      const metadata = {
        tier: 'premium',
        cost: 2,
        timestamp: Date.now()
      };

      // Track multiple requests
      for (let i = 0; i < 5; i++) {
        service.trackUsage('user123', '/api/test', 'GET', metadata);
      }

      const key = Array.from(service.usageBuffer.keys())[0];
      const data = service.usageBuffer.get(key);

      expect(data.count).toBe(5);
      expect(data.totalCost).toBe(10); // 5 requests * 2 cost
    });

    test('should flush usage data to database', async () => {
      // Add some usage data
      service.trackUsage('user123', '/api/test', 'GET', {
        tier: 'basic',
        cost: 1,
        apiKey: null
      });

      service.trackUsage('user456', '/api/search', 'POST', {
        tier: 'premium',
        cost: 2,
        apiKey: 'key123'
      });

      // Flush data
      await service.flushUsageData();

      // Check database insert
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO rate_limit_usage'),
        expect.any(Array)
      );

      // Buffer should be cleared
      expect(service.usageBuffer.size).toBe(0);
    });
  });

  describe('IP Management', () => {
    test('should block IP address', async () => {
      mockDb.query.mockResolvedValueOnce({ rows: [] });

      const result = await service.manageIpBlock('1.2.3.4', 'block', {
        reason: 'Suspicious activity',
        duration: 3600,
        userId: 'admin123'
      });

      expect(result).toEqual({
        success: true,
        ip: '1.2.3.4',
        action: 'block'
      });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO ip_blocks'),
        ['1.2.3.4', 'Suspicious activity', expect.any(Date), 'admin123']
      );

      // Check Redis update
      const isBlocked = await mockRedis.sismember('blacklist:ips', '1.2.3.4');
      expect(isBlocked).toBe(1);
    });

    test('should unblock IP address', async () => {
      // First block the IP
      await mockRedis.sadd('blacklist:ips', '1.2.3.4');
      
      mockDb.query.mockResolvedValueOnce({ rows: [] });

      const result = await service.manageIpBlock('1.2.3.4', 'unblock');

      expect(result).toEqual({
        success: true,
        ip: '1.2.3.4',
        action: 'unblock'
      });

      expect(mockDb.query).toHaveBeenCalledWith(
        'DELETE FROM ip_blocks WHERE ip_address = $1',
        ['1.2.3.4']
      );

      // Check Redis update
      const isBlocked = await mockRedis.sismember('blacklist:ips', '1.2.3.4');
      expect(isBlocked).toBe(0);
    });
  });

  describe('Analytics', () => {
    test('should get usage analytics', async () => {
      const mockData = [
        {
          time_bucket: new Date('2024-01-01T12:00:00Z'),
          endpoint: '/api/test',
          method: 'GET',
          tier: 'basic',
          total_requests: 100,
          total_cost: 100,
          active_hours: 1
        }
      ];

      mockDb.query.mockResolvedValueOnce({ rows: mockData });

      const result = await service.getUsageAnalytics('user123', {
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-02'),
        groupBy: 'hour'
      });

      expect(result).toEqual(mockData);
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
        ['hour', 'user123', expect.any(Date), expect.any(Date)]
      );
    });

    test('should get rate limit status', async () => {
      // Mock user tier lookup
      mockDb.query.mockResolvedValueOnce({
        rows: [{ tier: 'premium' }]
      });

      const status = await service.getRateLimitStatus('user123');

      expect(status).toMatchObject({
        limits: expect.any(Object),
        usage: expect.any(Object),
        remaining: expect.any(Object),
        daily: expect.objectContaining({
          used: expect.any(Number),
          limit: expect.any(Number),
          reset: expect.any(Date)
        })
      });
    });
  });

  describe('Helper Methods', () => {
    test('should generate correct keys', () => {
      const key = service.generateKey('user', 'user123', '/api/test/endpoint');
      expect(key).toBe('user:user123::api:test:endpoint');
    });

    test('should check tier sufficiency', () => {
      expect(service.isTierSufficient('basic', 'free')).toBe(true);
      expect(service.isTierSufficient('basic', 'premium')).toBe(false);
      expect(service.isTierSufficient('admin', 'enterprise')).toBe(true);
    });

    test('should get user tier', async () => {
      mockDb.query.mockResolvedValueOnce({
        rows: [{ tier: 'premium' }]
      });

      const tier = await service.getUserTier('user123');
      expect(tier).toBe('premium');

      // Test fallback to anonymous
      mockDb.query.mockResolvedValueOnce({ rows: [] });
      const anonymousTier = await service.getUserTier('unknown');
      expect(anonymousTier).toBe('anonymous');
    });
  });
});