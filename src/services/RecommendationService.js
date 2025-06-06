const RecommendationEngine = require('../recommendations/RecommendationEngine');
const DatabaseManager = require('../database/DatabaseManager');
const CacheManager = require('../cache/CacheManager');
const logger = require('../utils/logger');

/**
 * High-level service for managing recommendations
 */
class RecommendationService {
  constructor(options = {}) {
    this.engine = new RecommendationEngine(options);
    this.db = null;
    this.cache = CacheManager.getInstance();
    
    // Lazy load database
    this._getDb = () => {
      if (!this.db) {
        this.db = DatabaseManager.getInstance().getDatabase();
      }
      return this.db;
    };
    
    // Listen to engine events
    this.engine.on('recommendations:generated', this._handleRecommendationsGenerated.bind(this));
    this.engine.on('interaction:recorded', this._handleInteractionRecorded.bind(this));
    
    // Initialize service
    this._initialize().catch(err => {
      logger.error('Failed to initialize RecommendationService:', err);
    });
  }
  
  /**
   * Initialize service
   */
  async _initialize() {
    try {
      // Load user preferences
      await this._loadUserPreferences();
      
      // Load custom algorithms
      await this._loadCustomAlgorithms();
      
      logger.info('RecommendationService initialized');
    } catch (error) {
      logger.error('RecommendationService initialization error:', error);
    }
  }
  
  /**
   * Get recommendations for user
   */
  async getRecommendations(userId, options = {}) {
    try {
      const {
        algorithm = 'hybrid',
        limit = 10,
        excludeViewed = true,
        categories = null
      } = options;
      
      // Get user profile
      const profile = await this.getUserProfile(userId);
      
      // Get recommendations from engine
      let recommendations = await this.engine.getRecommendations(
        userId,
        algorithm,
        {
          maxRecommendations: limit * 2, // Get extra for filtering
          userProfile: profile
        }
      );
      
      // Filter based on options
      if (excludeViewed && profile.viewedDocuments) {
        recommendations = recommendations.filter(
          rec => !profile.viewedDocuments.includes(rec.id)
        );
      }
      
      if (categories && categories.length > 0) {
        // Filter by categories (would need category data in real implementation)
        recommendations = recommendations.filter(rec => {
          // Mock category check
          return Math.random() > 0.3;
        });
      }
      
      // Enhance with document metadata
      recommendations = await this._enhanceRecommendations(recommendations);
      
      // Limit results
      recommendations = recommendations.slice(0, limit);
      
      // Track recommendation impression
      await this._trackImpression(userId, recommendations);
      
      return {
        success: true,
        recommendations,
        algorithm,
        timestamp: new Date()
      };
    } catch (error) {
      logger.error('Failed to get recommendations:', error);
      throw error;
    }
  }
  
  /**
   * Get similar documents
   */
  async getSimilarDocuments(documentId, options = {}) {
    try {
      const similar = await this.engine.getSimilarDocuments(documentId, options);
      const enhanced = await this._enhanceRecommendations(similar);
      
      return {
        success: true,
        documentId,
        similar: enhanced
      };
    } catch (error) {
      logger.error('Failed to get similar documents:', error);
      throw error;
    }
  }
  
  /**
   * Get trending content
   */
  async getTrendingContent(options = {}) {
    try {
      const trending = await this.engine.getTrendingContent(options);
      const enhanced = await this._enhanceRecommendations(trending);
      
      return {
        success: true,
        trending: enhanced,
        timeWindow: options.timeWindow || '24h'
      };
    } catch (error) {
      logger.error('Failed to get trending content:', error);
      throw error;
    }
  }
  
  /**
   * Record user interaction
   */
  async recordInteraction(userId, documentId, interactionType, metadata = {}) {
    try {
      // Validate interaction type
      const validTypes = ['view', 'like', 'share', 'save', 'click', 'dwell'];
      if (!validTypes.includes(interactionType)) {
        throw new Error(`Invalid interaction type: ${interactionType}`);
      }
      
      // Record in engine
      await this.engine.recordInteraction(userId, documentId, interactionType, metadata);
      
      // Update user profile
      await this._updateUserProfile(userId, documentId, interactionType);
      
      return {
        success: true,
        interaction: {
          userId,
          documentId,
          type: interactionType,
          timestamp: new Date()
        }
      };
    } catch (error) {
      logger.error('Failed to record interaction:', error);
      throw error;
    }
  }
  
  /**
   * Get user profile
   */
  async getUserProfile(userId) {
    try {
      const cacheKey = `user_profile:${userId}`;
      
      // Check cache
      const cached = await this.cache.get(cacheKey);
      if (cached) {
        return cached;
      }
      
      // Load from database
      const result = await this._getDb().query(
        'SELECT * FROM user_profiles WHERE user_id = $1',
        [userId]
      );
      
      let profile;
      if (result.rows.length > 0) {
        profile = {
          userId,
          preferences: result.rows[0].preferences || {},
          interests: result.rows[0].interests || [],
          viewedDocuments: result.rows[0].viewed_documents || [],
          likedDocuments: result.rows[0].liked_documents || [],
          lastActive: result.rows[0].last_active
        };
      } else {
        // Create default profile
        profile = await this._createDefaultProfile(userId);
      }
      
      // Cache profile
      await this.cache.set(cacheKey, profile, 300); // 5 minutes
      
      return profile;
    } catch (error) {
      logger.error('Failed to get user profile:', error);
      throw error;
    }
  }
  
  /**
   * Update user preferences
   */
  async updateUserPreferences(userId, preferences) {
    try {
      await this._getDb().query(
        `UPDATE user_profiles 
         SET preferences = $2, updated_at = NOW()
         WHERE user_id = $1`,
        [userId, JSON.stringify(preferences)]
      );
      
      // Clear cache
      await this.cache.del(`user_profile:${userId}`);
      this.engine.clearCache(userId);
      
      return {
        success: true,
        userId,
        preferences
      };
    } catch (error) {
      logger.error('Failed to update user preferences:', error);
      throw error;
    }
  }
  
  /**
   * Perform A/B test
   */
  async getABTestRecommendations(userId, testId, options = {}) {
    try {
      // Get test configuration
      const test = await this._getABTest(testId);
      if (!test || !test.is_active) {
        throw new Error('Invalid or inactive A/B test');
      }
      
      // Determine variant for user
      const variant = this._getUserVariant(userId, testId);
      const algorithm = test.variants[variant];
      
      // Get recommendations
      const result = await this.getRecommendations(userId, {
        ...options,
        algorithm
      });
      
      // Track test participation
      await this._trackABTestParticipation(userId, testId, variant);
      
      return {
        ...result,
        testId,
        variant
      };
    } catch (error) {
      logger.error('Failed to get A/B test recommendations:', error);
      throw error;
    }
  }
  
  /**
   * Get recommendation analytics
   */
  async getAnalytics(options = {}) {
    try {
      const { startDate, endDate, metric = 'all' } = options;
      
      const metrics = {};
      
      // Click-through rate
      if (metric === 'all' || metric === 'ctr') {
        const ctr = await this._getDb().query(`
          SELECT 
            COUNT(DISTINCT CASE WHEN clicked = true THEN user_id END)::float / 
            COUNT(DISTINCT user_id) as ctr,
            algorithm
          FROM recommendation_impressions
          WHERE created_at BETWEEN $1 AND $2
          GROUP BY algorithm
        `, [startDate || '1970-01-01', endDate || 'now()']);
        
        metrics.ctr = ctr.rows;
      }
      
      // Engagement metrics
      if (metric === 'all' || metric === 'engagement') {
        const engagement = await this._getDb().query(`
          SELECT 
            interaction_type,
            COUNT(*) as count,
            COUNT(DISTINCT user_id) as unique_users
          FROM user_interactions
          WHERE created_at BETWEEN $1 AND $2
          GROUP BY interaction_type
        `, [startDate || '1970-01-01', endDate || 'now()']);
        
        metrics.engagement = engagement.rows;
      }
      
      return {
        success: true,
        metrics,
        period: { startDate, endDate }
      };
    } catch (error) {
      logger.error('Failed to get analytics:', error);
      throw error;
    }
  }
  
  /**
   * Handle recommendations generated event
   */
  async _handleRecommendationsGenerated(data) {
    // Log for analytics
    logger.info('Recommendations generated', data);
  }
  
  /**
   * Handle interaction recorded event
   */
  async _handleInteractionRecorded(data) {
    try {
      // Save to database
      await this._getDb().query(
        `INSERT INTO user_interactions 
         (user_id, document_id, interaction_type, metadata, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          data.userId,
          data.documentId,
          data.interactionType,
          JSON.stringify(data.metadata),
          data.timestamp
        ]
      );
    } catch (error) {
      logger.error('Failed to save interaction:', error);
    }
  }
  
  /**
   * Load user preferences from database
   */
  async _loadUserPreferences() {
    // This would load any global preferences or settings
    logger.info('Loaded user preferences');
  }
  
  /**
   * Load custom recommendation algorithms
   */
  async _loadCustomAlgorithms() {
    // This would load any custom algorithms from database or config
    logger.info('Loaded custom algorithms');
  }
  
  /**
   * Create default user profile
   */
  async _createDefaultProfile(userId) {
    const profile = {
      userId,
      preferences: {},
      interests: [],
      viewedDocuments: [],
      likedDocuments: [],
      lastActive: new Date()
    };
    
    await this._getDb().query(
      `INSERT INTO user_profiles 
       (user_id, preferences, interests, viewed_documents, liked_documents, last_active)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        userId,
        JSON.stringify(profile.preferences),
        profile.interests,
        profile.viewedDocuments,
        profile.likedDocuments,
        profile.lastActive
      ]
    );
    
    return profile;
  }
  
  /**
   * Update user profile based on interaction
   */
  async _updateUserProfile(userId, documentId, interactionType) {
    try {
      const updates = [];
      const values = [userId];
      let paramCount = 2;
      
      if (interactionType === 'view') {
        updates.push(`viewed_documents = array_append(viewed_documents, $${paramCount})`);
        values.push(documentId);
        paramCount++;
      } else if (interactionType === 'like') {
        updates.push(`liked_documents = array_append(liked_documents, $${paramCount})`);
        values.push(documentId);
        paramCount++;
      }
      
      updates.push('last_active = NOW()');
      
      if (updates.length > 0) {
        await this._getDb().query(
          `UPDATE user_profiles SET ${updates.join(', ')} WHERE user_id = $1`,
          values
        );
        
        // Clear cache
        await this.cache.del(`user_profile:${userId}`);
      }
    } catch (error) {
      logger.error('Failed to update user profile:', error);
    }
  }
  
  /**
   * Enhance recommendations with document metadata
   */
  async _enhanceRecommendations(recommendations) {
    // In a real implementation, this would fetch document details
    return recommendations.map(rec => ({
      ...rec,
      thumbnail: `/images/doc-${rec.id}.jpg`,
      author: 'Sample Author',
      publishedAt: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000),
      readTime: Math.floor(Math.random() * 10) + 1
    }));
  }
  
  /**
   * Track recommendation impression
   */
  async _trackImpression(userId, recommendations) {
    try {
      const values = recommendations.map(rec => 
        `(${userId}, '${rec.id}', '${rec.sources?.[0] || 'unknown'}', NOW())`
      );
      
      await this._getDb().query(
        `INSERT INTO recommendation_impressions 
         (user_id, document_id, algorithm, created_at)
         VALUES ${values.join(',')}`
      );
    } catch (error) {
      logger.error('Failed to track impression:', error);
    }
  }
  
  /**
   * Get A/B test configuration
   */
  async _getABTest(testId) {
    const result = await this._getDb().query(
      'SELECT * FROM ab_tests WHERE id = $1',
      [testId]
    );
    
    return result.rows[0];
  }
  
  /**
   * Determine user variant for A/B test
   */
  _getUserVariant(userId, testId) {
    // Simple hash-based assignment
    const hash = (userId + testId).split('').reduce((acc, char) => 
      acc + char.charCodeAt(0), 0
    );
    
    return hash % 2 === 0 ? 'control' : 'variant';
  }
  
  /**
   * Track A/B test participation
   */
  async _trackABTestParticipation(userId, testId, variant) {
    try {
      await this._getDb().query(
        `INSERT INTO ab_test_participants 
         (test_id, user_id, variant, created_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (test_id, user_id) DO NOTHING`,
        [testId, userId, variant]
      );
    } catch (error) {
      logger.error('Failed to track A/B test participation:', error);
    }
  }
}

module.exports = RecommendationService;