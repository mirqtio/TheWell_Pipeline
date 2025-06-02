const Redis = require('redis');
const { EventEmitter } = require('events');
const logger = require('../utils/logger');

/**
 * Multi-level caching system for TheWell Pipeline
 * Provides intelligent caching for queries, embeddings, and responses
 */
class CacheManager extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      redis: {
        host: config.redis?.host || process.env.REDIS_HOST || 'localhost',
        port: config.redis?.port || process.env.REDIS_PORT || 6379,
        password: config.redis?.password || process.env.REDIS_PASSWORD,
        db: config.redis?.db || 1 // Use different DB than QueueManager
      },
      ttl: {
        queryResults: config.ttl?.queryResults || 3600, // 1 hour
        embeddings: config.ttl?.embeddings || 86400, // 24 hours
        responses: config.ttl?.responses || 1800, // 30 minutes
        metadata: config.ttl?.metadata || 7200, // 2 hours
        default: config.ttl?.default || 3600
      },
      maxMemoryUsage: config.maxMemoryUsage || '100mb',
      evictionPolicy: config.evictionPolicy || 'allkeys-lru',
      enableCompression: config.enableCompression !== false,
      warmupQueries: config.warmupQueries || [],
      ...config
    };

    this.redisClient = null;
    this.isInitialized = false;
    this.isConnected = false;
    
    // In-memory cache for frequently accessed items
    this.memoryCache = new Map();
    this.memoryCacheStats = {
      hits: 0,
      misses: 0,
      size: 0
    };
    
    // Cache statistics
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      evictions: 0,
      memory: {
        hits: 0,
        misses: 0
      },
      redis: {
        hits: 0,
        misses: 0
      }
    };

    // Cache key prefixes for different data types
    this.keyPrefixes = {
      query: 'query:',
      embedding: 'embed:',
      response: 'resp:',
      metadata: 'meta:',
      document: 'doc:',
      similarity: 'sim:'
    };
  }

  /**
   * Initialize the cache manager
   */
  async initialize() {
    try {
      logger.info('Initializing CacheManager...');

      // Create Redis client
      const redisConfig = {
        host: this.config.redis.host,
        port: this.config.redis.port
      };

      if (this.config.redis.password) {
        redisConfig.password = this.config.redis.password;
      }

      if (this.config.redis.db !== undefined) {
        redisConfig.db = this.config.redis.db;
      }

      this.redisClient = Redis.createClient(redisConfig);

      // Set up Redis event handlers
      this.redisClient.on('error', (err) => {
        logger.error('Redis cache client error:', err);
        this.isConnected = false;
        this.emit('error', err);
      });

      this.redisClient.on('connect', () => {
        logger.info('Redis cache client connected');
        this.isConnected = true;
        this.emit('connected');
      });

      this.redisClient.on('ready', () => {
        logger.info('Redis cache client ready');
        this.emit('ready');
      });

      this.redisClient.on('end', () => {
        logger.info('Redis cache client disconnected');
        this.isConnected = false;
        this.emit('disconnected');
      });

      // Connect to Redis
      try {
        await this.redisClient.connect();
        this.isConnected = true;

        // Configure Redis for caching
        await this.configureRedis();

        // Warm up cache with common queries
        await this.warmupCache();
      } catch (redisError) {
        logger.warn('Redis connection failed, continuing with memory cache only:', redisError);
        this.isConnected = false;
      }

      this.isInitialized = true;
      logger.info('CacheManager initialized successfully');

      this.emit('initialized');
      return true;
    } catch (error) {
      logger.error('Failed to initialize CacheManager:', error);
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Configure Redis for optimal caching performance
   */
  async configureRedis() {
    try {
      // Set memory policy for cache eviction
      await this.redisClient.configSet('maxmemory-policy', this.config.evictionPolicy);
      
      // Set max memory usage if specified
      if (this.config.maxMemoryUsage) {
        await this.redisClient.configSet('maxmemory', this.config.maxMemoryUsage);
      }

      logger.info('Redis configured for caching with policy:', this.config.evictionPolicy);
    } catch (error) {
      logger.warn('Failed to configure Redis settings:', error.message);
    }
  }

  /**
   * Warm up cache with common queries
   */
  async warmupCache() {
    if (!this.config.warmupQueries.length) {
      return;
    }

    logger.info(`Warming up cache with ${this.config.warmupQueries.length} queries`);
    
    for (const query of this.config.warmupQueries) {
      try {
        // This would typically involve executing the query and caching results
        // For now, we'll just log the warmup attempt
        logger.debug('Warming up query:', query);
      } catch (error) {
        logger.warn('Failed to warm up query:', query, error.message);
      }
    }
  }

  /**
   * Generate cache key with prefix
   */
  generateKey(type, identifier, ...parts) {
    const keyParts = ['cache', type, identifier, ...parts].filter(part => part !== undefined && part !== null);
    return keyParts.join(':');
  }

  /**
   * Get item from cache (memory first, then Redis)
   */
  async get(key, options = {}) {
    try {
      // Check memory cache first
      if (this.memoryCache.has(key)) {
        this.stats.hits++;
        this.stats.memory.hits++;
        this.memoryCacheStats.hits++;
        
        const cached = this.memoryCache.get(key);
        if (cached.expiry && Date.now() > cached.expiry) {
          // Expired, remove from memory cache
          this.memoryCache.delete(key);
          this.memoryCacheStats.size--;
        } else {
          logger.debug('Cache hit (memory):', key);
          this.emit('hit', { key, source: 'memory' });
          return cached.value;
        }
      }

      // Check Redis cache
      if (this.isConnected) {
        const value = await this.redisClient.get(key);
        if (value !== null) {
          this.stats.hits++;
          this.stats.redis.hits++;
          
          let parsed;
          try {
            parsed = JSON.parse(value);
          } catch (parseError) {
            parsed = value; // Return as string if not JSON
          }

          // Store in memory cache for faster future access
          this.setMemoryCache(key, parsed, options.ttl);

          logger.debug('Cache hit (Redis):', key);
          this.emit('hit', { key, source: 'redis' });
          return parsed;
        }
      }

      // Cache miss
      this.stats.misses++;
      this.memoryCacheStats.misses++;
      this.stats.redis.misses++;
      
      logger.debug('Cache miss:', key);
      this.emit('miss', { key });
      return null;
    } catch (error) {
      logger.error('Cache get error:', error);
      this.emit('error', error);
      return null;
    }
  }

  /**
   * Set item in cache (both memory and Redis)
   */
  async set(key, value, options = {}) {
    try {
      const ttl = options.ttl || this.config.ttl.default;
      
      // Set in memory cache
      this.setMemoryCache(key, value, ttl);

      // Set in Redis cache
      if (this.isConnected) {
        const serialized = JSON.stringify(value);
        
        if (ttl > 0) {
          await this.redisClient.set(key, serialized, { EX: ttl });
        } else {
          await this.redisClient.set(key, serialized);
        }
      }

      this.stats.sets++;
      logger.debug('Cache set:', key, 'TTL:', ttl);
      this.emit('set', { key, value, ttl });
      
      return true;
    } catch (error) {
      logger.error('Cache set error:', error);
      this.emit('error', error);
      return false;
    }
  }

  /**
   * Set item in memory cache with TTL
   */
  setMemoryCache(key, value, ttl) {
    const expiry = ttl > 0 ? Date.now() + (ttl * 1000) : null;
    this.memoryCache.set(key, { value, expiry });
    this.memoryCacheStats.size = this.memoryCache.size;
  }

  /**
   * Delete item from cache
   */
  async delete(key) {
    try {
      // Remove from memory cache
      this.memoryCache.delete(key);
      this.memoryCacheStats.size = this.memoryCache.size;

      // Remove from Redis cache
      if (this.isConnected) {
        try {
          await this.redisClient.del(key);
        } catch (redisError) {
          logger.warn('Redis delete failed, continuing with memory delete:', redisError);
          this.emit('error', redisError);
        }
      }

      this.stats.deletes++;
      logger.debug('Cache delete:', key);
      this.emit('delete', { key });
      
      return true;
    } catch (error) {
      logger.error('Cache delete error:', error);
      this.emit('error', error);
      return false;
    }
  }

  /**
   * Clear cache by pattern
   */
  async clear(pattern = '*') {
    try {
      let deletedCount = 0;

      // Clear memory cache
      if (pattern === '*') {
        deletedCount = this.memoryCache.size;
        this.memoryCache.clear();
        this.memoryCacheStats.size = 0;
      } else {
        // Pattern matching for memory cache
        for (const key of this.memoryCache.keys()) {
          if (this.matchPattern(key, pattern)) {
            this.memoryCache.delete(key);
            deletedCount++;
          }
        }
        this.memoryCacheStats.size = this.memoryCache.size;
      }

      // Clear Redis cache
      if (this.isConnected) {
        if (pattern === '*') {
          await this.redisClient.flushDb();
        } else {
          const keys = await this.redisClient.keys(pattern);
          if (keys.length > 0) {
            await this.redisClient.del(keys);
            deletedCount += keys.length;
          }
        }
      }
      
      logger.info(`Cache cleared: ${deletedCount} keys matching pattern '${pattern}'`);
      this.emit('clear', { pattern, deletedCount });
      
      return deletedCount;
    } catch (error) {
      logger.error('Cache clear error:', error);
      this.emit('error', error);
      return 0;
    }
  }

  /**
   * Simple pattern matching for cache keys
   */
  matchPattern(key, pattern) {
    if (pattern === '*') return true;
    
    // Convert glob pattern to regex
    const regex = new RegExp(
      '^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
    );
    return regex.test(key);
  }

  /**
   * Get cache statistics
   */
  async getStats() {
    const redisInfo = this.isConnected ? await this.getRedisInfo() : {};
    
    return {
      ...this.stats,
      memory: {
        ...this.stats.memory,
        size: this.memoryCacheStats.size,
        keys: this.memoryCache.size,
        hitRate: this.memoryCacheStats.hits / (this.memoryCacheStats.hits + this.memoryCacheStats.misses) || 0
      },
      redis: {
        ...this.stats.redis,
        hitRate: this.stats.redis.hits / (this.stats.redis.hits + this.stats.redis.misses) || 0,
        info: redisInfo
      },
      overall: {
        hitRate: this.stats.hits / (this.stats.hits + this.stats.misses) || 0,
        totalOperations: this.stats.hits + this.stats.misses + this.stats.sets + this.stats.deletes
      },
      isConnected: this.isConnected,
      isInitialized: this.isInitialized
    };
  }

  /**
   * Get Redis information
   */
  async getRedisInfo() {
    try {
      if (!this.isConnected) return {};
      
      const info = await this.redisClient.info('memory');
      const lines = info.split('\r\n');
      const memoryInfo = {};
      
      lines.forEach(line => {
        if (line.includes(':')) {
          const [key, value] = line.split(':');
          memoryInfo[key] = value;
        }
      });
      
      return memoryInfo;
    } catch (error) {
      logger.error('Failed to get Redis info:', error);
      return {};
    }
  }

  /**
   * Health check for cache system
   */
  async healthCheck() {
    try {
      const testKey = 'health:check:' + Date.now();
      const testValue = 'ok';
      
      // Test memory cache
      this.setMemoryCache(testKey, testValue, 10);
      const memoryResult = this.memoryCache.get(testKey);
      
      // Test Redis cache
      let redisResult = null;
      let redisError = null;
      if (this.isConnected) {
        try {
          await this.redisClient.setEx(testKey, 10, testValue);
          redisResult = await this.redisClient.get(testKey);
          await this.redisClient.del(testKey);
        } catch (error) {
          redisError = error.message;
        }
      }
      
      // Clean up memory cache
      this.memoryCache.delete(testKey);
      
      const health = {
        status: 'healthy',
        memory: {
          status: memoryResult?.value === testValue ? 'healthy' : 'unhealthy',
          size: this.memoryCacheStats.size
        },
        redis: {
          status: this.isConnected ? (redisResult === testValue ? 'healthy' : 'unhealthy') : 'unhealthy',
          connected: this.isConnected,
          ...(redisError && { error: redisError })
        },
        initialized: this.isInitialized,
        timestamp: new Date().toISOString()
      };
      
      if (health.memory.status === 'unhealthy' || 
          health.redis.status === 'unhealthy') {
        health.status = 'unhealthy';
      }
      
      return health;
    } catch (error) {
      logger.error('Cache health check failed:', error);
      return {
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Shutdown cache manager
   */
  async shutdown() {
    try {
      logger.info('Shutting down CacheManager...');
      
      // Clear memory cache
      this.memoryCache.clear();
      this.memoryCacheStats.size = 0;
      
      // Close Redis connection
      if (this.redisClient && this.isConnected) {
        await this.redisClient.disconnect();
      }
      
      this.isInitialized = false;
      this.isConnected = false;
      
      logger.info('CacheManager shutdown complete');
      this.emit('shutdown');
    } catch (error) {
      logger.error('Error during CacheManager shutdown:', error);
      this.emit('error', error);
    }
  }

  /**
   * Warm cache with provided data
   */
  async warmCache(warmupData) {
    const results = [];
    
    for (const item of warmupData) {
      try {
        if (!item.key) {
          results.push({
            key: item.key,
            status: 'error',
            error: 'Invalid key'
          });
          continue;
        }
        
        await this.set(item.key, item.value, item.options || {});
        results.push({
          key: item.key,
          status: 'success'
        });
      } catch (error) {
        results.push({
          key: item.key,
          status: 'error',
          error: error.message
        });
      }
    }
    
    return results;
  }
}

module.exports = CacheManager;
