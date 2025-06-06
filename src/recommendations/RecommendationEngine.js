const logger = require('../utils/logger');
const { EventEmitter } = require('events');

/**
 * Core recommendation engine supporting multiple algorithms
 */
class RecommendationEngine extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      minSimilarityScore: 0.5,
      maxRecommendations: 10,
      cacheTimeout: 3600, // 1 hour
      ...options
    };
    
    this.algorithms = new Map();
    this.cache = new Map();
    
    // Register default algorithms
    this._registerDefaultAlgorithms();
  }
  
  /**
   * Register a recommendation algorithm
   */
  registerAlgorithm(name, algorithm) {
    if (typeof algorithm.recommend !== 'function') {
      throw new Error('Algorithm must have a recommend method');
    }
    
    this.algorithms.set(name, algorithm);
    logger.info('Registered recommendation algorithm', { name });
  }
  
  /**
   * Get recommendations using specified algorithm
   */
  async getRecommendations(userId, algorithm = 'hybrid', options = {}) {
    try {
      const cacheKey = `${userId}-${algorithm}-${JSON.stringify(options)}`;
      
      // Check cache
      if (this.cache.has(cacheKey)) {
        const cached = this.cache.get(cacheKey);
        if (Date.now() - cached.timestamp < this.options.cacheTimeout * 1000) {
          return cached.recommendations;
        }
      }
      
      const algo = this.algorithms.get(algorithm);
      if (!algo) {
        throw new Error(`Unknown algorithm: ${algorithm}`);
      }
      
      const recommendations = await algo.recommend(userId, {
        ...this.options,
        ...options
      });
      
      // Cache results
      this.cache.set(cacheKey, {
        recommendations,
        timestamp: Date.now()
      });
      
      this.emit('recommendations:generated', {
        userId,
        algorithm,
        count: recommendations.length
      });
      
      return recommendations;
    } catch (error) {
      logger.error('Failed to get recommendations', { userId, algorithm, error });
      throw error;
    }
  }
  
  /**
   * Get similar documents
   */
  async getSimilarDocuments(documentId, options = {}) {
    const limit = options.limit || this.options.maxRecommendations;
    const minScore = options.minScore || this.options.minSimilarityScore;
    
    try {
      // This would use document embeddings in a real implementation
      const mockSimilar = [];
      for (let i = 1; i <= limit; i++) {
        mockSimilar.push({
          id: `doc-${Math.random().toString(36).substr(2, 9)}`,
          score: Math.random() * 0.5 + 0.5,
          title: `Similar Document ${i}`,
          reason: 'content_similarity'
        });
      }
      
      return mockSimilar
        .filter(doc => doc.score >= minScore)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
    } catch (error) {
      logger.error('Failed to get similar documents', { documentId, error });
      throw error;
    }
  }
  
  /**
   * Get trending content
   */
  async getTrendingContent(options = {}) {
    const timeWindow = options.timeWindow || 24 * 60 * 60 * 1000; // 24 hours
    const limit = options.limit || this.options.maxRecommendations;
    
    try {
      // Mock trending calculation
      const trending = [];
      for (let i = 1; i <= limit; i++) {
        trending.push({
          id: `doc-${Math.random().toString(36).substr(2, 9)}`,
          score: Math.random() * 100,
          title: `Trending Document ${i}`,
          views: Math.floor(Math.random() * 1000),
          interactions: Math.floor(Math.random() * 100),
          reason: 'trending'
        });
      }
      
      return trending.sort((a, b) => b.score - a.score);
    } catch (error) {
      logger.error('Failed to get trending content', { error });
      throw error;
    }
  }
  
  /**
   * Update user interaction
   */
  async recordInteraction(userId, documentId, interactionType, metadata = {}) {
    try {
      this.emit('interaction:recorded', {
        userId,
        documentId,
        interactionType,
        metadata,
        timestamp: new Date()
      });
      
      // Clear user's recommendation cache
      for (const [key, _] of this.cache) {
        if (key.startsWith(`${userId}-`)) {
          this.cache.delete(key);
        }
      }
      
      logger.info('Recorded user interaction', { userId, documentId, interactionType });
    } catch (error) {
      logger.error('Failed to record interaction', { userId, documentId, error });
      throw error;
    }
  }
  
  /**
   * Clear recommendation cache
   */
  clearCache(userId = null) {
    if (userId) {
      // Clear specific user's cache
      for (const [key, _] of this.cache) {
        if (key.startsWith(`${userId}-`)) {
          this.cache.delete(key);
        }
      }
    } else {
      // Clear all cache
      this.cache.clear();
    }
  }
  
  /**
   * Register default recommendation algorithms
   */
  _registerDefaultAlgorithms() {
    // Content-based filtering
    this.registerAlgorithm('content', {
      recommend: async (userId, options) => {
        // Simplified content-based recommendation
        const recommendations = [];
        const limit = options.maxRecommendations || 10;
        
        for (let i = 1; i <= limit; i++) {
          recommendations.push({
            id: `doc-${Math.random().toString(36).substr(2, 9)}`,
            score: Math.random(),
            title: `Content Recommendation ${i}`,
            reason: 'similar_content',
            explanation: 'Based on content you\'ve viewed'
          });
        }
        
        return recommendations.sort((a, b) => b.score - a.score);
      }
    });
    
    // Collaborative filtering
    this.registerAlgorithm('collaborative', {
      recommend: async (userId, options) => {
        // Simplified collaborative filtering
        const recommendations = [];
        const limit = options.maxRecommendations || 10;
        
        for (let i = 1; i <= limit; i++) {
          recommendations.push({
            id: `doc-${Math.random().toString(36).substr(2, 9)}`,
            score: Math.random(),
            title: `Collaborative Recommendation ${i}`,
            reason: 'users_also_liked',
            explanation: 'Users with similar interests also liked this'
          });
        }
        
        return recommendations.sort((a, b) => b.score - a.score);
      }
    });
    
    // Hybrid approach
    this.registerAlgorithm('hybrid', {
      recommend: async (userId, options) => {
        // Combine content and collaborative
        const content = await this.algorithms.get('content').recommend(userId, options);
        const collaborative = await this.algorithms.get('collaborative').recommend(userId, options);
        
        // Merge and deduplicate
        const merged = new Map();
        
        // Add content-based with weight
        content.forEach(rec => {
          merged.set(rec.id, {
            ...rec,
            score: rec.score * 0.5,
            sources: ['content']
          });
        });
        
        // Add collaborative with weight
        collaborative.forEach(rec => {
          if (merged.has(rec.id)) {
            const existing = merged.get(rec.id);
            existing.score += rec.score * 0.5;
            existing.sources.push('collaborative');
            existing.explanation = 'Recommended by multiple factors';
          } else {
            merged.set(rec.id, {
              ...rec,
              score: rec.score * 0.5,
              sources: ['collaborative']
            });
          }
        });
        
        // Convert to array and sort
        return Array.from(merged.values())
          .sort((a, b) => b.score - a.score)
          .slice(0, options.maxRecommendations || 10);
      }
    });
    
    // Popular/trending
    this.registerAlgorithm('popular', {
      recommend: async (userId, options) => {
        return this.getTrendingContent(options);
      }
    });
  }
}

module.exports = RecommendationEngine;