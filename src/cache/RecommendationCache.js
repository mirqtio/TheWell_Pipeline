/**
 * RecommendationCache - Specialized caching for recommendation system
 */

const CacheManager = require('./CacheManager');
const logger = require('../utils/logger');

class RecommendationCache {
  constructor() {
    // Different cache stores for different types of data
    this.caches = {
      recommendations: new CacheManager('recommendations', {
        ttl: 300, // 5 minutes for personalized recommendations
        checkperiod: 60,
        maxKeys: 10000
      }),
      trending: new CacheManager('trending', {
        ttl: 1800, // 30 minutes for trending content
        checkperiod: 300,
        maxKeys: 1000
      }),
      similar: new CacheManager('similar', {
        ttl: 3600, // 1 hour for similar documents
        checkperiod: 600,
        maxKeys: 5000
      }),
      userProfiles: new CacheManager('userProfiles', {
        ttl: 600, // 10 minutes for user profiles
        checkperiod: 120,
        maxKeys: 10000
      }),
      embeddings: new CacheManager('embeddings', {
        ttl: 86400, // 24 hours for document embeddings
        checkperiod: 3600,
        maxKeys: 50000
      })
    };

    // Warm cache settings
    this.warmCacheEnabled = process.env.WARM_CACHE_ENABLED === 'true';
    this.warmCacheInterval = parseInt(process.env.WARM_CACHE_INTERVAL) || 3600000; // 1 hour
    this.warmCacheTimer = null;

    // Cache hit/miss tracking
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      warmups: 0
    };
  }

  /**
   * Initialize cache and start warm cache if enabled
   */
  async initialize() {
    logger.info('Initializing recommendation cache');

    if (this.warmCacheEnabled) {
      await this.warmCache();
      this.warmCacheTimer = setInterval(() => {
        this.warmCache().catch(err => 
          logger.error('Error warming cache', { error: err })
        );
      }, this.warmCacheInterval);
    }
  }

  /**
   * Get recommendations from cache
   * @param {string} userId - User ID
   * @param {Object} options - Cache options
   * @returns {Promise<Object|null>}
   */
  async getRecommendations(userId, options = {}) {
    const key = this.buildKey('rec', userId, options);
    const cached = await this.caches.recommendations.get(key);
    
    if (cached) {
      this.stats.hits++;
      logger.debug('Recommendation cache hit', { userId, key });
      return cached;
    }
    
    this.stats.misses++;
    return null;
  }

  /**
   * Set recommendations in cache
   * @param {string} userId - User ID
   * @param {Object} options - Cache options
   * @param {Object} data - Recommendation data
   * @param {number} ttl - Optional TTL override
   */
  async setRecommendations(userId, options, data, ttl) {
    const key = this.buildKey('rec', userId, options);
    await this.caches.recommendations.set(key, data, ttl);
    logger.debug('Cached recommendations', { userId, key });
  }

  /**
   * Get trending content from cache
   * @param {string} timeWindow - Time window
   * @param {string} category - Optional category
   * @returns {Promise<Array|null>}
   */
  async getTrending(timeWindow, category = null) {
    const key = this.buildKey('trend', timeWindow, { category });
    const cached = await this.caches.trending.get(key);
    
    if (cached) {
      this.stats.hits++;
      return cached;
    }
    
    this.stats.misses++;
    return null;
  }

  /**
   * Set trending content in cache
   * @param {string} timeWindow - Time window
   * @param {string} category - Optional category
   * @param {Array} data - Trending items
   */
  async setTrending(timeWindow, category, data) {
    const key = this.buildKey('trend', timeWindow, { category });
    await this.caches.trending.set(key, data);
  }

  /**
   * Get similar documents from cache
   * @param {string} documentId - Document ID
   * @returns {Promise<Array|null>}
   */
  async getSimilar(documentId) {
    const key = `sim:${documentId}`;
    const cached = await this.caches.similar.get(key);
    
    if (cached) {
      this.stats.hits++;
      return cached;
    }
    
    this.stats.misses++;
    return null;
  }

  /**
   * Set similar documents in cache
   * @param {string} documentId - Document ID
   * @param {Array} similar - Similar documents
   */
  async setSimilar(documentId, similar) {
    const key = `sim:${documentId}`;
    await this.caches.similar.set(key, similar);
  }

  /**
   * Get user profile from cache
   * @param {string} userId - User ID
   * @returns {Promise<Object|null>}
   */
  async getUserProfile(userId) {
    const key = `profile:${userId}`;
    return await this.caches.userProfiles.get(key);
  }

  /**
   * Set user profile in cache
   * @param {string} userId - User ID
   * @param {Object} profile - User profile
   */
  async setUserProfile(userId, profile) {
    const key = `profile:${userId}`;
    await this.caches.userProfiles.set(key, profile);
  }

  /**
   * Get document embedding from cache
   * @param {string} documentId - Document ID
   * @returns {Promise<Array|null>}
   */
  async getEmbedding(documentId) {
    const key = `emb:${documentId}`;
    return await this.caches.embeddings.get(key);
  }

  /**
   * Set document embedding in cache
   * @param {string} documentId - Document ID
   * @param {Array} embedding - Document embedding
   */
  async setEmbedding(documentId, embedding) {
    const key = `emb:${documentId}`;
    await this.caches.embeddings.set(key, embedding);
  }

  /**
   * Batch get embeddings
   * @param {Array<string>} documentIds - Document IDs
   * @returns {Promise<Map>}
   */
  async getEmbeddings(documentIds) {
    const embeddings = new Map();
    
    // Use Promise.all for parallel fetching
    const results = await Promise.all(
      documentIds.map(async id => {
        const embedding = await this.getEmbedding(id);
        return { id, embedding };
      })
    );
    
    results.forEach(({ id, embedding }) => {
      if (embedding) embeddings.set(id, embedding);
    });
    
    return embeddings;
  }

  /**
   * Invalidate user-specific caches
   * @param {string} userId - User ID
   */
  async invalidateUser(userId) {
    const patterns = [
      `rec:${userId}:*`,
      `profile:${userId}`
    ];
    
    for (const pattern of patterns) {
      await this.caches.recommendations.deletePattern(pattern);
      await this.caches.userProfiles.deletePattern(pattern);
    }
    
    this.stats.evictions++;
    logger.info('Invalidated user cache', { userId });
  }

  /**
   * Invalidate document-specific caches
   * @param {string} documentId - Document ID
   */
  async invalidateDocument(documentId) {
    await this.caches.similar.delete(`sim:${documentId}`);
    await this.caches.embeddings.delete(`emb:${documentId}`);
    
    this.stats.evictions++;
    logger.info('Invalidated document cache', { documentId });
  }

  /**
   * Warm cache with popular data
   */
  async warmCache() {
    logger.info('Starting cache warm-up');
    const startTime = Date.now();
    
    try {
      // This would be implemented to pre-load popular items
      // For example:
      // - Top trending items for each time window
      // - Embeddings for frequently accessed documents
      // - Profiles for active users
      
      const { Document, UserProfile } = require('../orm/models');
      
      // Pre-load trending items
      const timeWindows = ['day', 'week', 'month'];
      for (const window of timeWindows) {
        // This would call the trending service to pre-populate cache
        logger.debug(`Warming trending cache for ${window}`);
      }
      
      // Pre-load active user profiles
      const activeUsers = await UserProfile.findAll({
        where: {
          lastUpdated: {
            [Document.sequelize.Op.gte]: new Date(Date.now() - 24 * 60 * 60 * 1000)
          }
        },
        limit: 100
      });
      
      for (const user of activeUsers) {
        await this.setUserProfile(user.userId, user);
      }
      
      this.stats.warmups++;
      const duration = Date.now() - startTime;
      logger.info('Cache warm-up completed', { duration, itemsWarmed: activeUsers.length });
    } catch (error) {
      logger.error('Error during cache warm-up', { error });
    }
  }

  /**
   * Build cache key
   * @param {string} prefix - Key prefix
   * @param {string} id - Primary ID
   * @param {Object} options - Additional options
   * @returns {string}
   */
  buildKey(prefix, id, options = {}) {
    const optStr = Object.entries(options)
      .filter(([_, v]) => v != null)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${v}`)
      .join(':');
    
    return optStr ? `${prefix}:${id}:${optStr}` : `${prefix}:${id}`;
  }

  /**
   * Get cache statistics
   * @returns {Object}
   */
  getStats() {
    const hitRate = this.stats.hits + this.stats.misses > 0
      ? (this.stats.hits / (this.stats.hits + this.stats.misses) * 100).toFixed(2)
      : 0;
    
    return {
      ...this.stats,
      hitRate: `${hitRate}%`,
      cacheInfo: Object.entries(this.caches).reduce((acc, [name, cache]) => {
        acc[name] = {
          keys: cache.getKeyCount(),
          size: cache.getSize()
        };
        return acc;
      }, {})
    };
  }

  /**
   * Clear all caches
   */
  async clearAll() {
    for (const cache of Object.values(this.caches)) {
      await cache.clear();
    }
    
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      warmups: 0
    };
    
    logger.info('All recommendation caches cleared');
  }

  /**
   * Shutdown cache
   */
  shutdown() {
    if (this.warmCacheTimer) {
      clearInterval(this.warmCacheTimer);
    }
    
    for (const cache of Object.values(this.caches)) {
      cache.shutdown();
    }
    
    logger.info('Recommendation cache shut down');
  }
}

module.exports = RecommendationCache;