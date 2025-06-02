const CacheManager = require('../../../src/cache/CacheManager');
const Redis = require('redis');

// Mock Redis
jest.mock('redis', () => ({
  createClient: jest.fn(() => ({
    connect: jest.fn().mockResolvedValue(),
    disconnect: jest.fn().mockResolvedValue(),
    get: jest.fn().mockImplementation((key) => {
      // For health check keys, return 'ok'
      if (key.startsWith('health:check:')) {
        return Promise.resolve('ok');
      }
      return Promise.resolve(null);
    }),
    set: jest.fn(),
    setEx: jest.fn().mockResolvedValue('OK'),
    del: jest.fn(),
    keys: jest.fn().mockResolvedValue([]),
    flushDb: jest.fn(),
    disconnect: jest.fn().mockResolvedValue(),
    ping: jest.fn().mockResolvedValue('PONG'),
    on: jest.fn(),
    isReady: true
  }))
}));

// Mock logger
jest.mock('../../../src/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

describe('CacheManager', () => {
  let cacheManager;
  let mockRedisClient;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockRedisClient = {
      connect: jest.fn().mockResolvedValue(),
      disconnect: jest.fn().mockResolvedValue(),
      get: jest.fn().mockImplementation((key) => {
        // For health check keys, return 'ok'
        if (key.startsWith('health:check:')) {
          return Promise.resolve('ok');
        }
        return Promise.resolve(null);
      }),
      set: jest.fn(),
      setEx: jest.fn().mockResolvedValue('OK'),
      del: jest.fn(),
      keys: jest.fn().mockResolvedValue([]),
      flushDb: jest.fn(),
      disconnect: jest.fn().mockResolvedValue(),
      ping: jest.fn().mockResolvedValue('PONG'),
      on: jest.fn(),
      isReady: true
    };
    
    Redis.createClient.mockReturnValue(mockRedisClient);
    
    cacheManager = new CacheManager({
      redis: {
        host: 'localhost',
        port: 6379,
        db: 1
      },
      ttl: {
        default: 3600
      }
    });
    
    // Add error listener to prevent unhandled errors
    cacheManager.on('error', () => {
      // Silently handle errors in tests
    });
  });

  afterEach(async () => {
    if (cacheManager) {
      await cacheManager.shutdown();
    }
  });

  describe('Initialization', () => {
    test('should initialize with default configuration', () => {
      const cache = new CacheManager();
      expect(cache.config).toBeDefined();
      expect(cache.config.redis.host).toBe('localhost');
      expect(cache.config.redis.port).toBe(6379);
      expect(cache.config.ttl.default).toBe(3600);
    });

    test('should initialize with custom configuration', () => {
      const config = {
        redis: { host: 'redis-server', port: 6380 },
        ttl: { default: 7200 }
      };
      
      const cache = new CacheManager(config);
      expect(cache.config.redis.host).toBe('redis-server');
      expect(cache.config.redis.port).toBe(6380);
      expect(cache.config.ttl.default).toBe(7200);
    });

    test('should initialize Redis client and memory cache', async () => {
      await cacheManager.initialize();
      
      expect(Redis.createClient).toHaveBeenCalledWith({
        host: 'localhost',
        port: 6379,
        db: 1
      });
      expect(mockRedisClient.connect).toHaveBeenCalled();
      expect(cacheManager.isInitialized).toBe(true);
      expect(cacheManager.isConnected).toBe(true);
    });

    test('should handle Redis connection failure gracefully', async () => {
      mockRedisClient.connect.mockRejectedValue(new Error('Connection failed'));
      
      await cacheManager.initialize();
      
      expect(cacheManager.isInitialized).toBe(true);
      expect(cacheManager.isConnected).toBe(false);
    });
  });

  describe('Cache Operations', () => {
    beforeEach(async () => {
      await cacheManager.initialize();
    });

    describe('set', () => {
      test('should set value in memory cache', async () => {
        await cacheManager.set('test-key', 'test-value');
        
        const memoryValue = cacheManager.memoryCache.get('test-key');
        expect(memoryValue).toEqual({
          value: 'test-value',
          expiry: expect.any(Number)
        });
      });

      test('should set value in Redis cache', async () => {
        mockRedisClient.set.mockResolvedValue('OK');
        
        await cacheManager.set('test-key', 'test-value');
        
        expect(mockRedisClient.set).toHaveBeenCalledWith(
          'test-key',
          JSON.stringify('test-value'),
          { EX: 3600 }
        );
      });

      test('should handle custom TTL', async () => {
        await cacheManager.set('test-key', 'test-value', { ttl: 1800 });
        
        const memoryValue = cacheManager.memoryCache.get('test-key');
        expect(memoryValue.expiry).toBeGreaterThan(Date.now() + 1700000);
        
        expect(mockRedisClient.set).toHaveBeenCalledWith(
          'test-key',
          JSON.stringify('test-value'),
          { EX: 1800 }
        );
      });

      test('should emit set event', async () => {
        const setListener = jest.fn();
        cacheManager.on('set', setListener);
        
        await cacheManager.set('test-key', 'test-value');
        
        expect(setListener).toHaveBeenCalledWith({
          key: 'test-key',
          value: 'test-value',
          ttl: 3600
        });
      });

      test('should handle Redis set failure gracefully', async () => {
        mockRedisClient.set.mockRejectedValue(new Error('Redis error'));
        
        await cacheManager.set('test-key', 'test-value');
        
        // Should still set in memory cache
        const memoryValue = cacheManager.memoryCache.get('test-key');
        expect(memoryValue.value).toBe('test-value');
      });
    });

    describe('get', () => {
      test('should get value from memory cache', async () => {
        // Set value in memory cache
        cacheManager.memoryCache.set('test-key', {
          value: 'test-value',
          expiry: Date.now() + 3600000
        });
        
        const result = await cacheManager.get('test-key');
        expect(result).toBe('test-value');
      });

      test('should get value from Redis when not in memory', async () => {
        mockRedisClient.get.mockResolvedValue(JSON.stringify('redis-value'));
        
        const result = await cacheManager.get('test-key');
        expect(result).toBe('redis-value');
        
        // Should also cache in memory
        const memoryValue = cacheManager.memoryCache.get('test-key');
        expect(memoryValue.value).toBe('redis-value');
      });

      test('should return null for non-existent key', async () => {
        mockRedisClient.get.mockResolvedValue(null);
        
        const result = await cacheManager.get('non-existent');
        expect(result).toBeNull();
      });

      test('should handle expired memory cache entries', async () => {
        // Set expired value in memory cache
        cacheManager.memoryCache.set('test-key', {
          value: 'expired-value',
          expiry: Date.now() - 1000
        });
        
        mockRedisClient.get.mockResolvedValue(JSON.stringify('fresh-value'));
        
        const result = await cacheManager.get('test-key');
        expect(result).toBe('fresh-value');
        
        // Expired entry should be removed
        expect(cacheManager.memoryCache.has('test-key')).toBe(true);
        expect(cacheManager.memoryCache.get('test-key').value).toBe('fresh-value');
      });

      test('should emit hit event for memory cache hit', async () => {
        const hitListener = jest.fn();
        cacheManager.on('hit', hitListener);
        
        cacheManager.memoryCache.set('test-key', {
          value: 'test-value',
          expiry: Date.now() + 3600000
        });
        
        await cacheManager.get('test-key');
        
        expect(hitListener).toHaveBeenCalledWith({
          key: 'test-key',
          source: 'memory'
        });
      });

      test('should emit hit event for Redis cache hit', async () => {
        const hitListener = jest.fn();
        cacheManager.on('hit', hitListener);
        
        mockRedisClient.get.mockResolvedValue(JSON.stringify('redis-value'));
        
        await cacheManager.get('test-key');
        
        expect(hitListener).toHaveBeenCalledWith({
          key: 'test-key',
          source: 'redis'
        });
      });

      test('should emit miss event for cache miss', async () => {
        const missListener = jest.fn();
        cacheManager.on('miss', missListener);
        
        mockRedisClient.get.mockResolvedValue(null);
        
        await cacheManager.get('test-key');
        
        expect(missListener).toHaveBeenCalledWith({
          key: 'test-key'
        });
      });

      test('should handle Redis get failure gracefully', async () => {
        mockRedisClient.get.mockRejectedValue(new Error('Redis error'));
        
        const result = await cacheManager.get('test-key');
        expect(result).toBeNull();
      });
    });

    describe('delete', () => {
      test('should delete from both memory and Redis', async () => {
        // Set in memory cache
        cacheManager.memoryCache.set('test-key', {
          value: 'test-value',
          expiry: Date.now() + 3600000
        });
        
        mockRedisClient.del.mockResolvedValue(1);
        
        const result = await cacheManager.delete('test-key');
        
        expect(result).toBe(true);
        expect(cacheManager.memoryCache.has('test-key')).toBe(false);
        expect(mockRedisClient.del).toHaveBeenCalledWith('test-key');
      });

      test('should emit delete event', async () => {
        const deleteListener = jest.fn();
        cacheManager.on('delete', deleteListener);
        
        await cacheManager.delete('test-key');
        
        expect(deleteListener).toHaveBeenCalledWith({
          key: 'test-key'
        });
      });

      test('should handle Redis delete failure gracefully', async () => {
        mockRedisClient.del.mockRejectedValue(new Error('Redis error'));
        
        const result = await cacheManager.delete('test-key');
        expect(result).toBe(true); // Memory delete should still succeed
      });
    });

    describe('clear', () => {
      test('should clear memory cache with pattern', async () => {
        cacheManager.memoryCache.set('test:1', { value: 'value1', expiry: Date.now() + 3600000 });
        cacheManager.memoryCache.set('test:2', { value: 'value2', expiry: Date.now() + 3600000 });
        cacheManager.memoryCache.set('other:1', { value: 'value3', expiry: Date.now() + 3600000 });
        
        const result = await cacheManager.clear('test:*');
        
        expect(result).toBe(2);
        expect(cacheManager.memoryCache.has('test:1')).toBe(false);
        expect(cacheManager.memoryCache.has('test:2')).toBe(false);
        expect(cacheManager.memoryCache.has('other:1')).toBe(true);
      });

      test('should clear Redis cache with pattern', async () => {
        mockRedisClient.keys.mockResolvedValue(['test:1', 'test:2']);
        mockRedisClient.del.mockResolvedValue(2);
        
        await cacheManager.clear('test:*');
        
        expect(mockRedisClient.keys).toHaveBeenCalledWith('test:*');
        expect(mockRedisClient.del).toHaveBeenCalledWith(['test:1', 'test:2']);
      });

      test('should clear all caches when no pattern provided', async () => {
        cacheManager.memoryCache.set('key1', { value: 'value1', expiry: Date.now() + 3600000 });
        cacheManager.memoryCache.set('key2', { value: 'value2', expiry: Date.now() + 3600000 });
        
        mockRedisClient.flushDb.mockResolvedValue('OK');
        
        const result = await cacheManager.clear();
        
        expect(result).toBeGreaterThan(0);
        expect(cacheManager.memoryCache.size).toBe(0);
        expect(mockRedisClient.flushDb).toHaveBeenCalled();
      });
    });
  });

  describe('Statistics', () => {
    beforeEach(async () => {
      await cacheManager.initialize();
    });

    test('should track cache statistics', async () => {
      // Perform cache operations
      await cacheManager.set('key1', 'value1');
      await cacheManager.get('key1'); // hit
      await cacheManager.get('key2'); // miss
      await cacheManager.delete('key1');
      
      const stats = await cacheManager.getStats();
      
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
      expect(stats.sets).toBe(1);
      expect(stats.deletes).toBe(1);
      expect(stats.memory.size).toBe(0);
    });

    test('should calculate memory usage', async () => {
      await cacheManager.set('key1', 'value1');
      await cacheManager.set('key2', { data: 'complex object' });
      
      const stats = await cacheManager.getStats();
      
      expect(stats.memory.size).toBeGreaterThan(0);
      expect(stats.memory.keys).toBe(2);
    });
  });

  describe('Health Check', () => {
    test('should return healthy status when connected', async () => {
      await cacheManager.initialize();
      
      const health = await cacheManager.healthCheck();
      
      expect(health.status).toBe('healthy');
      expect(health.memory.status).toBe('healthy');
      expect(health.redis.status).toBe('healthy');
    });

    test('should return unhealthy status when Redis is disconnected', async () => {
      cacheManager.isConnected = false;
      
      const health = await cacheManager.healthCheck();
      
      expect(health.status).toBe('unhealthy');
      expect(health.redis.status).toBe('unhealthy');
    });

    test('should handle Redis ping failure', async () => {
      await cacheManager.initialize();
      mockRedisClient.get.mockRejectedValue(new Error('Ping failed'));
      
      const health = await cacheManager.healthCheck();
      
      expect(health.redis.status).toBe('unhealthy');
      expect(health.redis.error).toBe('Ping failed');
    });
  });

  describe('Cache Warming', () => {
    beforeEach(async () => {
      await cacheManager.initialize();
    });

    test('should warm cache with provided data', async () => {
      const warmupData = [
        { key: 'key1', value: 'value1' },
        { key: 'key2', value: 'value2' }
      ];
      
      const results = await cacheManager.warmCache(warmupData);
      
      expect(results).toHaveLength(2);
      expect(results[0].status).toBe('success');
      expect(results[1].status).toBe('success');
      
      // Verify data is cached
      const value1 = await cacheManager.get('key1');
      const value2 = await cacheManager.get('key2');
      expect(value1).toBe('value1');
      expect(value2).toBe('value2');
    });

    test('should handle warmup failures gracefully', async () => {
      const warmupData = [
        { key: 'key1', value: 'value1' },
        { key: null, value: 'invalid' } // Invalid key
      ];
      
      const results = await cacheManager.warmCache(warmupData);
      
      expect(results).toHaveLength(2);
      expect(results[0].status).toBe('success');
      expect(results[1].status).toBe('error');
    });
  });

  describe('Key Generation', () => {
    test('should generate keys with prefix', () => {
      const key = cacheManager.generateKey('test', 'id123');
      expect(key).toBe('cache:test:id123');
    });

    test('should generate keys with multiple parts', () => {
      const key = cacheManager.generateKey('test', 'part1', 'part2', 'part3');
      expect(key).toBe('cache:test:part1:part2:part3');
    });

    test('should handle empty parts', () => {
      const key = cacheManager.generateKey('test', '', 'part2');
      expect(key).toBe('cache:test::part2');
    });
  });

  describe('Shutdown', () => {
    test('should shutdown gracefully', async () => {
      await cacheManager.initialize();
      
      await cacheManager.shutdown();
      
      expect(mockRedisClient.disconnect).toHaveBeenCalled();
      expect(cacheManager.isInitialized).toBe(false);
      expect(cacheManager.isConnected).toBe(false);
    });

    test('should handle shutdown errors gracefully', async () => {
      await cacheManager.initialize();
      mockRedisClient.disconnect.mockRejectedValue(new Error('Disconnect failed'));
      
      await expect(cacheManager.shutdown()).resolves.not.toThrow();
    });
  });
});