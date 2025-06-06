/**
 * RecommendationBatchProcessor - Handles offline computation of recommendations
 */

const { Document, UserProfile, UserInteraction } = require('../orm/models');
const RecommendationEngine = require('./RecommendationEngine');
const RecommendationCache = require('../cache/RecommendationCache');
const logger = require('../utils/logger');
const { Op } = require('sequelize');

class RecommendationBatchProcessor {
  constructor(options = {}) {
    this.engine = options.engine || new RecommendationEngine(options.embeddingService);
    this.cache = options.cache || new RecommendationCache();
    this.batchSize = options.batchSize || 100;
    this.concurrency = options.concurrency || 5;
    this.processingInterval = options.processingInterval || 3600000; // 1 hour
    this.isProcessing = false;
    this.processingTimer = null;
  }

  /**
   * Start batch processing
   */
  async start() {
    logger.info('Starting recommendation batch processor');
    
    // Initialize cache
    await this.cache.initialize();
    
    // Run initial processing
    await this.processAll();
    
    // Schedule regular processing
    this.processingTimer = setInterval(() => {
      this.processAll().catch(err => 
        logger.error('Error in batch processing', { error: err })
      );
    }, this.processingInterval);
  }

  /**
   * Stop batch processing
   */
  stop() {
    if (this.processingTimer) {
      clearInterval(this.processingTimer);
      this.processingTimer = null;
    }
    logger.info('Stopped recommendation batch processor');
  }

  /**
   * Process all users in batches
   */
  async processAll() {
    if (this.isProcessing) {
      logger.warn('Batch processing already in progress, skipping');
      return;
    }

    this.isProcessing = true;
    const startTime = Date.now();
    let processedCount = 0;
    let errorCount = 0;

    try {
      logger.info('Starting batch recommendation processing');

      // Get active users (those with recent interactions)
      const activeUserIds = await this.getActiveUsers();
      logger.info(`Found ${activeUserIds.length} active users to process`);

      // Process users in batches
      for (let i = 0; i < activeUserIds.length; i += this.batchSize) {
        const batch = activeUserIds.slice(i, i + this.batchSize);
        
        // Process batch with concurrency control
        const results = await this.processBatch(batch);
        
        processedCount += results.filter(r => r.success).length;
        errorCount += results.filter(r => !r.success).length;
        
        logger.info(`Processed batch ${i / this.batchSize + 1}`, {
          processed: processedCount,
          errors: errorCount
        });
      }

      // Process trending items
      await this.processTrending();

      // Process similar documents for popular items
      await this.processSimilarDocuments();

      const duration = Date.now() - startTime;
      logger.info('Batch recommendation processing completed', {
        duration,
        processedUsers: processedCount,
        errors: errorCount
      });
    } catch (error) {
      logger.error('Error in batch processing', { error });
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Get active users to process
   * @returns {Promise<Array>}
   */
  async getActiveUsers() {
    const cutoffDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days
    
    const activeUsers = await UserInteraction.findAll({
      attributes: ['userId'],
      where: {
        timestamp: { [Op.gte]: cutoffDate }
      },
      group: ['userId'],
      having: Document.sequelize.literal('COUNT(*) >= 5'), // At least 5 interactions
      raw: true
    });

    return activeUsers.map(u => u.userId);
  }

  /**
   * Process a batch of users
   * @param {Array<string>} userIds - User IDs to process
   * @returns {Promise<Array>}
   */
  async processBatch(userIds) {
    const promises = userIds.map(userId => 
      this.processUser(userId)
        .then(() => ({ userId, success: true }))
        .catch(error => {
          logger.error('Error processing user', { userId, error });
          return { userId, success: false, error };
        })
    );

    // Control concurrency
    const results = [];
    for (let i = 0; i < promises.length; i += this.concurrency) {
      const batch = promises.slice(i, i + this.concurrency);
      const batchResults = await Promise.all(batch);
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Process recommendations for a single user
   * @param {string} userId - User ID
   */
  async processUser(userId) {
    try {
      // Generate recommendations for different scenarios
      const algorithms = ['collaborative', 'contentBased', 'hybrid'];
      const categories = await this.getUserTopCategories(userId);

      for (const algorithm of algorithms) {
        // General recommendations
        const generalRecs = await this.engine.getRecommendations(userId, {
          algorithm,
          limit: 50,
          excludeSeen: true
        });

        await this.cache.setRecommendations(
          userId,
          { algorithm },
          generalRecs,
          3600 // 1 hour TTL
        );

        // Category-specific recommendations
        for (const category of categories) {
          const categoryRecs = await this.engine.getRecommendations(userId, {
            algorithm,
            limit: 20,
            filters: { category },
            excludeSeen: true
          });

          await this.cache.setRecommendations(
            userId,
            { algorithm, category },
            categoryRecs,
            3600
          );
        }
      }

      logger.debug('Processed recommendations for user', { userId });
    } catch (error) {
      logger.error('Error processing user recommendations', { userId, error });
      throw error;
    }
  }

  /**
   * Get user's top categories
   * @param {string} userId - User ID
   * @returns {Promise<Array>}
   */
  async getUserTopCategories(userId) {
    const interactions = await UserInteraction.findAll({
      where: { userId },
      include: [{
        model: Document,
        attributes: ['category']
      }],
      order: [['timestamp', 'DESC']],
      limit: 100
    });

    const categoryCount = {};
    interactions.forEach(interaction => {
      const category = interaction.Document?.category;
      if (category) {
        categoryCount[category] = (categoryCount[category] || 0) + 1;
      }
    });

    return Object.entries(categoryCount)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .map(([category]) => category);
  }

  /**
   * Process trending items
   */
  async processTrending() {
    try {
      const timeWindows = ['day', 'week', 'month'];
      
      for (const window of timeWindows) {
        // Overall trending
        const trending = await this.engine.algorithms.trending.recommend(
          null,
          100,
          { timeWindow: window },
          {}
        );

        await this.cache.setTrending(window, null, trending);

        // Category-specific trending
        const categories = await Document.findAll({
          attributes: [[Document.sequelize.fn('DISTINCT', Document.sequelize.col('category')), 'category']],
          raw: true
        });

        for (const { category } of categories) {
          if (!category) continue;
          
          const categoryTrending = await this.engine.algorithms.trending.recommend(
            null,
            50,
            { timeWindow: window },
            { category }
          );

          await this.cache.setTrending(window, category, categoryTrending);
        }
      }

      logger.info('Processed trending items');
    } catch (error) {
      logger.error('Error processing trending items', { error });
    }
  }

  /**
   * Process similar documents for popular items
   */
  async processSimilarDocuments() {
    try {
      // Get popular documents from the last week
      const popularDocs = await Document.findAll({
        attributes: ['id'],
        include: [{
          model: UserInteraction,
          attributes: [],
          where: {
            timestamp: { [Op.gte]: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
          }
        }],
        group: ['Document.id'],
        order: [[Document.sequelize.literal('COUNT("UserInteractions"."id")'), 'DESC']],
        limit: 1000
      });

      // Process in batches
      for (let i = 0; i < popularDocs.length; i += this.batchSize) {
        const batch = popularDocs.slice(i, i + this.batchSize);
        
        await Promise.all(batch.map(async doc => {
          try {
            const similar = await this.engine.getSimilarDocuments(doc.id, 20);
            await this.cache.setSimilar(doc.id, similar);
          } catch (error) {
            logger.error('Error processing similar documents', { 
              documentId: doc.id, 
              error 
            });
          }
        }));
      }

      logger.info('Processed similar documents', { 
        count: popularDocs.length 
      });
    } catch (error) {
      logger.error('Error processing similar documents', { error });
    }
  }

  /**
   * Update embeddings for documents
   */
  async updateEmbeddings(documentIds) {
    if (!this.engine.embeddingService) {
      logger.warn('No embedding service available');
      return;
    }

    try {
      const documents = await Document.findAll({
        where: { 
          id: documentIds,
          embedding: null
        }
      });

      for (const doc of documents) {
        try {
          const embedding = await this.engine.embeddingService.generateEmbedding(
            doc.content || doc.title
          );
          
          doc.embedding = JSON.stringify(embedding);
          await doc.save();
          
          await this.cache.setEmbedding(doc.id, embedding);
        } catch (error) {
          logger.error('Error generating embedding', { 
            documentId: doc.id, 
            error 
          });
        }
      }

      logger.info('Updated embeddings', { count: documents.length });
    } catch (error) {
      logger.error('Error updating embeddings', { error });
    }
  }

  /**
   * Get processing status
   * @returns {Object}
   */
  getStatus() {
    return {
      isProcessing: this.isProcessing,
      processingInterval: this.processingInterval,
      batchSize: this.batchSize,
      concurrency: this.concurrency,
      cacheStats: this.cache.getStats()
    };
  }
}

module.exports = RecommendationBatchProcessor;