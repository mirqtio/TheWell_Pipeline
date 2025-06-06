const { EventEmitter } = require('events');
const logger = require('../utils/logger');
const CategoryManager = require('../categorization/CategoryManager');
const AutoCategorizationEngine = require('../categorization/AutoCategorizationEngine');

/**
 * High-level categorization service
 */
class CategorizationService extends EventEmitter {
  constructor({ database, embeddingService, llmProvider }) {
    super();
    this.db = database;
    this.categoryManager = new CategoryManager(database);
    this.engine = new AutoCategorizationEngine({
      categoryManager: this.categoryManager,
      embeddingService,
      llmProvider
    });
    
    this.batchSize = 100;
    this.isProcessing = false;
  }

  /**
   * Initialize the service
   */
  async initialize() {
    try {
      await this.categoryManager.initialize();
      await this.engine.initialize();
      
      // Set up feedback loop
      this.setupFeedbackLoop();
      
      logger.info('CategorizationService initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize CategorizationService:', error);
      throw error;
    }
  }

  /**
   * Categorize a single document
   */
  async categorizeDocument(documentId, options = {}) {
    try {
      const document = await this.getDocument(documentId);
      if (!document) {
        throw new Error('Document not found');
      }

      const categories = await this.engine.categorizeDocument(document, options);
      
      // Save categorization results
      await this.saveCategorization(documentId, categories, options.isManual || false);
      
      // Track metrics
      await this.trackCategorizationMetrics(documentId, categories);
      
      this.emit('documentCategorized', { documentId, categories });
      
      return categories;

    } catch (error) {
      logger.error('Failed to categorize document:', error);
      throw error;
    }
  }

  /**
   * Batch categorize multiple documents
   */
  async batchCategorize(documentIds, options = {}) {
    if (this.isProcessing) {
      throw new Error('Batch categorization already in progress');
    }

    this.isProcessing = true;
    const results = [];
    const errors = [];

    try {
      // Process in batches
      for (let i = 0; i < documentIds.length; i += this.batchSize) {
        const batch = documentIds.slice(i, i + this.batchSize);
        
        const batchResults = await Promise.allSettled(
          batch.map(id => this.categorizeDocument(id, options))
        );

        batchResults.forEach((result, index) => {
          if (result.status === 'fulfilled') {
            results.push({
              documentId: batch[index],
              categories: result.value
            });
          } else {
            errors.push({
              documentId: batch[index],
              error: result.reason.message
            });
          }
        });

        // Emit progress
        this.emit('batchProgress', {
          processed: i + batch.length,
          total: documentIds.length,
          percentage: ((i + batch.length) / documentIds.length) * 100
        });
      }

      return { results, errors };

    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Real-time categorization for new content
   */
  async categorizeRealtime(content, options = {}) {
    try {
      // Create temporary document object
      const tempDoc = {
        id: `temp_${Date.now()}`,
        content: content.text || content,
        title: content.title || '',
        metadata: content.metadata || {},
        source_type: content.source_type || 'realtime'
      };

      const categories = await this.engine.categorizeDocument(tempDoc, {
        ...options,
        threshold: options.threshold || 0.5 // Lower threshold for real-time
      });

      return categories;

    } catch (error) {
      logger.error('Failed to categorize real-time content:', error);
      throw error;
    }
  }

  /**
   * Get category suggestions for a document
   */
  async suggestCategories(documentId, limit = 10) {
    try {
      const document = await this.getDocument(documentId);
      if (!document) {
        throw new Error('Document not found');
      }

      // Get all possible categories with lower threshold
      const suggestions = await this.engine.categorizeDocument(document, {
        threshold: 0.3,
        maxCategories: limit
      });

      // Get existing categories
      const existingCategories = await this.getDocumentCategories(documentId);
      const existingIds = new Set(existingCategories.map(c => c.category_id));

      // Filter out existing categories and enhance with usage stats
      const enhancedSuggestions = [];
      
      for (const suggestion of suggestions) {
        if (!existingIds.has(suggestion.categoryId)) {
          const stats = await this.categoryManager.getCategoryStats(suggestion.categoryId);
          enhancedSuggestions.push({
            ...suggestion,
            usageCount: stats.document_count,
            popularity: await this.calculateCategoryPopularity(suggestion.categoryId)
          });
        }
      }

      return enhancedSuggestions;

    } catch (error) {
      logger.error('Failed to suggest categories:', error);
      throw error;
    }
  }

  /**
   * Submit feedback for categorization
   */
  async submitFeedback(documentId, categoryId, feedback) {
    const client = await this.db.getClient();

    try {
      await client.query('BEGIN');

      // Record feedback
      const feedbackQuery = `
        INSERT INTO categorization_feedback 
        (document_id, category_id, feedback_type, is_correct, confidence_delta, user_id, metadata)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id
      `;

      const feedbackResult = await client.query(feedbackQuery, [
        documentId,
        categoryId,
        feedback.type, // 'accept', 'reject', 'adjust'
        feedback.isCorrect,
        feedback.confidenceDelta || 0,
        feedback.userId || null,
        JSON.stringify(feedback.metadata || {})
      ]);

      // Update document-category relationship if needed
      if (feedback.type === 'accept') {
        await client.query(
          `UPDATE document_categories 
           SET is_manual = true, confidence = 1.0, updated_at = CURRENT_TIMESTAMP
           WHERE document_id = $1 AND category_id = $2`,
          [documentId, categoryId]
        );
      } else if (feedback.type === 'reject') {
        await client.query(
          `DELETE FROM document_categories 
           WHERE document_id = $1 AND category_id = $2`,
          [documentId, categoryId]
        );
      } else if (feedback.type === 'adjust' && feedback.newConfidence !== undefined) {
        await client.query(
          `UPDATE document_categories 
           SET confidence = $3, updated_at = CURRENT_TIMESTAMP
           WHERE document_id = $1 AND category_id = $2`,
          [documentId, categoryId, feedback.newConfidence]
        );
      }

      await client.query('COMMIT');

      // Update model if enough feedback accumulated
      await this.checkAndUpdateModel();

      return { success: true, feedbackId: feedbackResult.rows[0].id };

    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Failed to submit feedback:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get categorization history for a document
   */
  async getCategorization History(documentId) {
    const query = `
      SELECT 
        dc.*,
        c.name as category_name,
        c.path as category_path,
        cf.feedback_type,
        cf.is_correct,
        cf.created_at as feedback_at
      FROM document_categories dc
      JOIN categories c ON dc.category_id = c.id
      LEFT JOIN categorization_feedback cf ON 
        cf.document_id = dc.document_id AND 
        cf.category_id = dc.category_id
      WHERE dc.document_id = $1
      ORDER BY dc.created_at DESC
    `;

    const result = await this.db.query(query, [documentId]);
    return result.rows;
  }

  /**
   * Get categorization analytics
   */
  async getAnalytics(options = {}) {
    const { startDate, endDate, categoryId } = options;
    
    const analytics = {
      summary: await this.getCategorizationSummary(startDate, endDate),
      accuracy: await this.getAccuracyMetrics(startDate, endDate),
      performance: await this.getPerformanceMetrics(startDate, endDate),
      trends: await this.getCategorizationTrends(startDate, endDate),
      topCategories: await this.getTopCategories(startDate, endDate)
    };

    if (categoryId) {
      analytics.categoryDetail = await this.getCategoryAnalytics(categoryId, startDate, endDate);
    }

    return analytics;
  }

  /**
   * Save categorization results
   */
  async saveCategorization(documentId, categories, isManual = false) {
    const client = await this.db.getClient();

    try {
      await client.query('BEGIN');

      // Remove existing auto-categorizations if this is manual
      if (isManual) {
        await client.query(
          'DELETE FROM document_categories WHERE document_id = $1 AND is_manual = false',
          [documentId]
        );
      }

      // Insert new categorizations
      for (const category of categories) {
        const insertQuery = `
          INSERT INTO document_categories 
          (document_id, category_id, confidence, is_manual, method, explanation, metadata)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (document_id, category_id) 
          DO UPDATE SET 
            confidence = $3,
            is_manual = $4,
            method = $5,
            explanation = $6,
            metadata = $7,
            updated_at = CURRENT_TIMESTAMP
        `;

        await client.query(insertQuery, [
          documentId,
          category.categoryId,
          category.confidence,
          isManual,
          category.methods ? category.methods.join(',') : category.method,
          category.explanation || null,
          JSON.stringify(category.details || {})
        ]);
      }

      await client.query('COMMIT');

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get document from database
   */
  async getDocument(documentId) {
    const result = await this.db.query(
      'SELECT * FROM documents WHERE id = $1',
      [documentId]
    );
    return result.rows[0];
  }

  /**
   * Get document categories
   */
  async getDocumentCategories(documentId) {
    const result = await this.db.query(
      'SELECT * FROM document_categories WHERE document_id = $1',
      [documentId]
    );
    return result.rows;
  }

  /**
   * Track categorization metrics
   */
  async trackCategorizationMetrics(documentId, categories) {
    const metrics = {
      document_id: documentId,
      category_count: categories.length,
      avg_confidence: categories.reduce((sum, c) => sum + c.confidence, 0) / categories.length,
      methods_used: [...new Set(categories.flatMap(c => c.methods || [c.method]))],
      timestamp: new Date()
    };

    const query = `
      INSERT INTO categorization_metrics 
      (document_id, category_count, avg_confidence, methods_used, processing_time)
      VALUES ($1, $2, $3, $4, $5)
    `;

    await this.db.query(query, [
      metrics.document_id,
      metrics.category_count,
      metrics.avg_confidence,
      JSON.stringify(metrics.methods_used),
      0 // Processing time would be calculated in real implementation
    ]);
  }

  /**
   * Calculate category popularity
   */
  async calculateCategoryPopularity(categoryId) {
    const query = `
      SELECT 
        COUNT(DISTINCT dc.document_id) as usage_count,
        AVG(dc.confidence) as avg_confidence,
        COUNT(DISTINCT cf.id) as feedback_count,
        AVG(CASE WHEN cf.is_correct THEN 1 ELSE 0 END) as accuracy
      FROM document_categories dc
      LEFT JOIN categorization_feedback cf ON 
        cf.category_id = dc.category_id
      WHERE dc.category_id = $1
      AND dc.created_at > CURRENT_DATE - INTERVAL '30 days'
    `;

    const result = await this.db.query(query, [categoryId]);
    const stats = result.rows[0];

    // Calculate popularity score (0-1)
    const usageScore = Math.min(stats.usage_count / 100, 1);
    const confidenceScore = stats.avg_confidence || 0;
    const accuracyScore = stats.accuracy || 0.5;

    return (usageScore * 0.5 + confidenceScore * 0.3 + accuracyScore * 0.2);
  }

  /**
   * Setup feedback loop for continuous improvement
   */
  setupFeedbackLoop() {
    // Check for model updates every hour
    setInterval(async () => {
      try {
        await this.checkAndUpdateModel();
      } catch (error) {
        logger.error('Feedback loop error:', error);
      }
    }, 60 * 60 * 1000);
  }

  /**
   * Check and update model based on feedback
   */
  async checkAndUpdateModel() {
    const recentFeedback = await this.getRecentFeedback(100);
    
    if (recentFeedback.length >= 50) {
      // Update strategy weights
      await this.engine.updateStrategyWeights(recentFeedback);
      
      // Retrain classifier if needed
      const accuracyDrop = await this.detectAccuracyDrop();
      if (accuracyDrop) {
        await this.retrainModels();
      }
    }
  }

  /**
   * Get recent feedback
   */
  async getRecentFeedback(limit = 100) {
    const query = `
      SELECT cf.*, dc.method
      FROM categorization_feedback cf
      JOIN document_categories dc ON 
        cf.document_id = dc.document_id AND 
        cf.category_id = dc.category_id
      WHERE cf.created_at > CURRENT_TIMESTAMP - INTERVAL '7 days'
      ORDER BY cf.created_at DESC
      LIMIT $1
    `;

    const result = await this.db.query(query, [limit]);
    return result.rows;
  }

  /**
   * Detect accuracy drop
   */
  async detectAccuracyDrop() {
    const query = `
      SELECT 
        DATE_TRUNC('day', created_at) as day,
        AVG(CASE WHEN is_correct THEN 1 ELSE 0 END) as accuracy
      FROM categorization_feedback
      WHERE created_at > CURRENT_DATE - INTERVAL '14 days'
      GROUP BY day
      ORDER BY day
    `;

    const result = await this.db.query(query);
    const accuracies = result.rows.map(r => r.accuracy);
    
    // Simple trend detection
    if (accuracies.length >= 7) {
      const recentAvg = accuracies.slice(-3).reduce((a, b) => a + b) / 3;
      const overallAvg = accuracies.reduce((a, b) => a + b) / accuracies.length;
      
      return recentAvg < overallAvg * 0.9; // 10% drop
    }
    
    return false;
  }

  /**
   * Retrain models with recent data
   */
  async retrainModels() {
    logger.info('Starting model retraining...');
    
    // Get recent manually categorized documents
    const query = `
      SELECT d.id, d.title, d.content, dc.category_id
      FROM documents d
      JOIN document_categories dc ON d.id = dc.document_id
      WHERE dc.is_manual = true
      AND dc.created_at > CURRENT_DATE - INTERVAL '30 days'
      ORDER BY dc.created_at DESC
      LIMIT 1000
    `;

    const result = await this.db.query(query);
    
    if (result.rows.length > 100) {
      const trainingData = result.rows.map(row => ({
        content: `${row.title || ''} ${row.content || ''}`,
        categoryId: row.category_id
      }));
      
      await this.engine.trainClassifier(trainingData);
      logger.info('Model retraining completed');
    }
  }

  /**
   * Get categorization summary
   */
  async getCategorizationSummary(startDate, endDate) {
    const query = `
      SELECT 
        COUNT(DISTINCT document_id) as documents_categorized,
        COUNT(*) as total_categorizations,
        AVG(confidence) as avg_confidence,
        COUNT(DISTINCT category_id) as categories_used,
        SUM(CASE WHEN is_manual THEN 1 ELSE 0 END) as manual_categorizations,
        SUM(CASE WHEN is_manual THEN 0 ELSE 1 END) as auto_categorizations
      FROM document_categories
      WHERE created_at BETWEEN $1 AND $2
    `;

    const result = await this.db.query(query, [startDate, endDate]);
    return result.rows[0];
  }

  /**
   * Get accuracy metrics
   */
  async getAccuracyMetrics(startDate, endDate) {
    const query = `
      SELECT 
        method,
        COUNT(*) as total,
        SUM(CASE WHEN is_correct THEN 1 ELSE 0 END) as correct,
        AVG(CASE WHEN is_correct THEN 1 ELSE 0 END) as accuracy
      FROM categorization_feedback cf
      JOIN document_categories dc ON 
        cf.document_id = dc.document_id AND 
        cf.category_id = dc.category_id
      WHERE cf.created_at BETWEEN $1 AND $2
      GROUP BY method
    `;

    const result = await this.db.query(query, [startDate, endDate]);
    return result.rows;
  }

  /**
   * Get performance metrics
   */
  async getPerformanceMetrics(startDate, endDate) {
    const query = `
      SELECT 
        AVG(processing_time) as avg_processing_time,
        MIN(processing_time) as min_processing_time,
        MAX(processing_time) as max_processing_time,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY processing_time) as median_processing_time,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY processing_time) as p95_processing_time
      FROM categorization_metrics
      WHERE created_at BETWEEN $1 AND $2
    `;

    const result = await this.db.query(query, [startDate, endDate]);
    return result.rows[0];
  }

  /**
   * Get categorization trends
   */
  async getCategorizationTrends(startDate, endDate) {
    const query = `
      SELECT 
        DATE_TRUNC('day', created_at) as day,
        COUNT(DISTINCT document_id) as documents_categorized,
        AVG(confidence) as avg_confidence,
        COUNT(DISTINCT category_id) as categories_used
      FROM document_categories
      WHERE created_at BETWEEN $1 AND $2
      GROUP BY day
      ORDER BY day
    `;

    const result = await this.db.query(query, [startDate, endDate]);
    return result.rows;
  }

  /**
   * Get top categories
   */
  async getTopCategories(startDate, endDate, limit = 10) {
    const query = `
      SELECT 
        c.id,
        c.name,
        c.path,
        COUNT(DISTINCT dc.document_id) as document_count,
        AVG(dc.confidence) as avg_confidence,
        COUNT(DISTINCT cf.id) as feedback_count,
        AVG(CASE WHEN cf.is_correct THEN 1 ELSE 0 END) as accuracy
      FROM categories c
      JOIN document_categories dc ON dc.category_id = c.id
      LEFT JOIN categorization_feedback cf ON 
        cf.category_id = c.id AND 
        cf.document_id = dc.document_id
      WHERE dc.created_at BETWEEN $1 AND $2
      GROUP BY c.id, c.name, c.path
      ORDER BY document_count DESC
      LIMIT $3
    `;

    const result = await this.db.query(query, [startDate, endDate, limit]);
    return result.rows;
  }

  /**
   * Get detailed analytics for a specific category
   */
  async getCategoryAnalytics(categoryId, startDate, endDate) {
    const [usage, accuracy, distribution, related] = await Promise.all([
      this.getCategoryUsage(categoryId, startDate, endDate),
      this.getCategoryAccuracy(categoryId, startDate, endDate),
      this.getCategoryDistribution(categoryId, startDate, endDate),
      this.getRelatedCategories(categoryId)
    ]);

    return { usage, accuracy, distribution, related };
  }

  /**
   * Get category usage over time
   */
  async getCategoryUsage(categoryId, startDate, endDate) {
    const query = `
      SELECT 
        DATE_TRUNC('day', created_at) as day,
        COUNT(*) as usage_count,
        AVG(confidence) as avg_confidence
      FROM document_categories
      WHERE category_id = $1
      AND created_at BETWEEN $2 AND $3
      GROUP BY day
      ORDER BY day
    `;

    const result = await this.db.query(query, [categoryId, startDate, endDate]);
    return result.rows;
  }

  /**
   * Get category accuracy metrics
   */
  async getCategoryAccuracy(categoryId, startDate, endDate) {
    const query = `
      SELECT 
        feedback_type,
        COUNT(*) as count,
        AVG(CASE WHEN is_correct THEN 1 ELSE 0 END) as accuracy
      FROM categorization_feedback
      WHERE category_id = $1
      AND created_at BETWEEN $2 AND $3
      GROUP BY feedback_type
    `;

    const result = await this.db.query(query, [categoryId, startDate, endDate]);
    return result.rows;
  }

  /**
   * Get category distribution by confidence
   */
  async getCategoryDistribution(categoryId, startDate, endDate) {
    const query = `
      SELECT 
        WIDTH_BUCKET(confidence, 0, 1, 10) as confidence_bucket,
        COUNT(*) as count
      FROM document_categories
      WHERE category_id = $1
      AND created_at BETWEEN $2 AND $3
      GROUP BY confidence_bucket
      ORDER BY confidence_bucket
    `;

    const result = await this.db.query(query, [categoryId, startDate, endDate]);
    return result.rows.map(row => ({
      range: `${(row.confidence_bucket - 1) * 0.1}-${row.confidence_bucket * 0.1}`,
      count: row.count
    }));
  }

  /**
   * Get related categories (often co-occurring)
   */
  async getRelatedCategories(categoryId, limit = 5) {
    const query = `
      SELECT 
        c.id,
        c.name,
        c.path,
        COUNT(*) as co_occurrence_count
      FROM document_categories dc1
      JOIN document_categories dc2 ON dc1.document_id = dc2.document_id
      JOIN categories c ON dc2.category_id = c.id
      WHERE dc1.category_id = $1
      AND dc2.category_id != $1
      GROUP BY c.id, c.name, c.path
      ORDER BY co_occurrence_count DESC
      LIMIT $2
    `;

    const result = await this.db.query(query, [categoryId, limit]);
    return result.rows;
  }
}

module.exports = CategorizationService;