/**
 * Source Reliability Service
 * 
 * Calculates and manages reliability scores for data sources based on multiple metrics:
 * - Document quality scores
 * - User feedback patterns
 * - Content consistency
 * - Error rates
 * - Historical performance
 */

const logger = require('../utils/logger');
const { ValidationError } = require('../web/middleware/errorHandler'); // eslint-disable-line no-unused-vars

class SourceReliabilityService {
  constructor(options = {}) {
    this.databaseManager = options.databaseManager;
    this.auditService = options.auditService;
    
    // Validate required dependencies
    if (!this.databaseManager) {
      throw new Error('Database manager is required');
    }
    
    if (!this.auditService) {
      throw new Error('Audit service is required');
    }
    
    // Scoring weights for different metrics
    this.weights = {
      documentQuality: 0.30,      // Average quality of documents from source
      userFeedback: 0.25,         // User ratings and feedback
      contentConsistency: 0.20,   // Consistency in content format/structure
      errorRate: 0.15,            // Processing errors and failures
      historicalPerformance: 0.10 // Long-term reliability trends
    };
    
    // Reliability thresholds
    this.thresholds = {
      high: 0.75,    // 75% and above = high reliability
      medium: 0.50,  // 50-74% = medium reliability
      low: 0.0       // Below 50% = low reliability
    };
    
    this.isInitialized = false;
  }

  /**
   * Initialize the service
   */
  async initialize() {
    if (!this.databaseManager) {
      throw new Error('DatabaseManager is required for SourceReliabilityService');
    }
    
    this.isInitialized = true;
    logger.info('SourceReliabilityService initialized');
  }

  /**
   * Calculate comprehensive reliability score for a source
   * @param {string} sourceId - Source identifier
   * @param {Object} options - Calculation options
   * @returns {Object} Reliability score and breakdown
   */
  async calculateReliabilityScore(sourceId, options = {}) {
    if (!this.isInitialized) {
      throw new Error('SourceReliabilityService not initialized');
    }

    try {
      const timeframe = options.timeframe || '30 days';
      
      // Get all metrics for the source
      const [
        qualityMetrics,
        feedbackMetrics,
        consistencyMetrics,
        errorMetrics,
        historicalMetrics
      ] = await Promise.all([
        this.getDocumentQualityMetrics(sourceId, timeframe),
        this.getUserFeedbackMetrics(sourceId, timeframe),
        this.getContentConsistencyMetrics(sourceId, timeframe),
        this.getErrorRateMetrics(sourceId, timeframe),
        this.getHistoricalPerformanceMetrics(sourceId)
      ]);

      // Calculate weighted scores
      const scores = {
        documentQuality: this.calculateQualityScore(qualityMetrics),
        userFeedback: this.calculateFeedbackScore(feedbackMetrics),
        contentConsistency: this.calculateConsistencyScore(consistencyMetrics),
        errorRate: this.calculateErrorScore(errorMetrics),
        historicalPerformance: this.calculateHistoricalScore(historicalMetrics)
      };

      // Calculate overall weighted score
      const overallScore = Object.entries(scores).reduce((total, [metric, score]) => {
        return total + (score * this.weights[metric]);
      }, 0);

      // Determine reliability level
      const reliabilityLevel = this.getReliabilityLevel(overallScore);

      const result = {
        sourceId,
        overallScore: Math.round(overallScore * 100) / 100,
        reliabilityLevel,
        breakdown: scores,
        metrics: {
          quality: qualityMetrics,
          feedback: feedbackMetrics,
          consistency: consistencyMetrics,
          errors: errorMetrics,
          historical: historicalMetrics
        },
        calculatedAt: new Date().toISOString(),
        timeframe
      };

      // Store the calculated score
      await this.storeReliabilityScore(result);

      // Log audit event
      await this.auditService.logEvent('source_reliability_calculated', {
        sourceId,
        score: overallScore,
        level: reliabilityLevel,
        timestamp: new Date().toISOString()
      });

      logger.info('Reliability score calculated', {
        sourceId,
        score: overallScore,
        level: reliabilityLevel
      });

      return result;

    } catch (error) {
      logger.error('Failed to calculate reliability score', {
        sourceId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get document quality metrics for a source
   */
  async getDocumentQualityMetrics(sourceId, timeframe) {
    const query = `
      SELECT 
        COUNT(*) as total_documents,
        AVG(believability_score) as avg_believability,
        AVG(quality_score) as avg_quality,
        COUNT(CASE WHEN believability_score >= 0.7 THEN 1 END) as high_quality_count,
        COUNT(CASE WHEN believability_score < 0.3 THEN 1 END) as low_quality_count
      FROM documents 
      WHERE source_id = $1 
        AND created_at >= NOW() - INTERVAL '${timeframe}'
        AND believability_score IS NOT NULL
    `;

    const result = await this.databaseManager.query(query, [sourceId]);
    const row = result.rows[0];

    return {
      totalDocuments: parseInt(row.total_documents) || 0,
      avgBelievability: parseFloat(row.avg_believability) || 0,
      avgQuality: parseFloat(row.avg_quality) || 0,
      highQualityRatio: row.total_documents > 0 ? 
        parseInt(row.high_quality_count) / parseInt(row.total_documents) : 0,
      lowQualityRatio: row.total_documents > 0 ? 
        parseInt(row.low_quality_count) / parseInt(row.total_documents) : 0
    };
  }

  /**
   * Get user feedback metrics for a source
   */
  async getUserFeedbackMetrics(sourceId, timeframe) {
    const query = `
      SELECT 
        COUNT(*) as total_feedback,
        AVG(rating) as avg_rating,
        COUNT(CASE WHEN rating >= 4 THEN 1 END) as positive_feedback,
        COUNT(CASE WHEN rating <= 2 THEN 1 END) as negative_feedback,
        COUNT(DISTINCT user_id) as unique_users
      FROM document_feedback df
      JOIN documents d ON df.document_id = d.id
      WHERE d.source_id = $1 
        AND df.created_at >= NOW() - INTERVAL '${timeframe}'
        AND df.rating IS NOT NULL
    `;

    const result = await this.databaseManager.query(query, [sourceId]);
    const row = result.rows[0];

    return {
      totalFeedback: parseInt(row.total_feedback) || 0,
      avgRating: parseFloat(row.avg_rating) || 0,
      positiveRatio: row.total_feedback > 0 ? 
        parseInt(row.positive_feedback) / parseInt(row.total_feedback) : 0,
      negativeRatio: row.total_feedback > 0 ? 
        parseInt(row.negative_feedback) / parseInt(row.total_feedback) : 0,
      uniqueUsers: parseInt(row.unique_users) || 0
    };
  }

  /**
   * Get content consistency metrics for a source
   */
  async getContentConsistencyMetrics(sourceId, timeframe) {
    const query = `
      SELECT 
        COUNT(*) as total_documents,
        COUNT(DISTINCT content_type) as content_type_variety,
        AVG(word_count) as avg_word_count,
        STDDEV(word_count) as word_count_stddev,
        COUNT(CASE WHEN metadata IS NOT NULL AND metadata != '{}' THEN 1 END) as documents_with_metadata
      FROM documents 
      WHERE source_id = $1 
        AND created_at >= NOW() - INTERVAL '${timeframe}'
    `;

    const result = await this.databaseManager.query(query, [sourceId]);
    const row = result.rows[0];

    const totalDocs = parseInt(row.total_documents) || 0;
    const avgWordCount = parseFloat(row.avg_word_count) || 0;
    const wordCountStddev = parseFloat(row.word_count_stddev) || 0;

    return {
      totalDocuments: totalDocs,
      contentTypeVariety: parseInt(row.content_type_variety) || 0,
      avgWordCount,
      wordCountVariability: avgWordCount > 0 ? wordCountStddev / avgWordCount : 0,
      metadataCompleteness: totalDocs > 0 ? 
        parseInt(row.documents_with_metadata) / totalDocs : 0
    };
  }

  /**
   * Get error rate metrics for a source
   */
  async getErrorRateMetrics(sourceId, timeframe) {
    const query = `
      SELECT 
        COUNT(*) as total_jobs,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_jobs,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_jobs,
        AVG(CASE WHEN completed_at IS NOT NULL AND started_at IS NOT NULL 
                 THEN EXTRACT(EPOCH FROM (completed_at - started_at)) END) as avg_processing_time
      FROM jobs 
      WHERE source_id = $1 
        AND created_at >= NOW() - INTERVAL '${timeframe}'
    `;

    const result = await this.databaseManager.query(query, [sourceId]);
    const row = result.rows[0];

    const totalJobs = parseInt(row.total_jobs) || 0;

    return {
      totalJobs,
      failureRate: totalJobs > 0 ? parseInt(row.failed_jobs) / totalJobs : 0,
      successRate: totalJobs > 0 ? parseInt(row.completed_jobs) / totalJobs : 0,
      avgProcessingTime: parseFloat(row.avg_processing_time) || 0
    };
  }

  /**
   * Get historical performance metrics for a source
   */
  async getHistoricalPerformanceMetrics(sourceId) {
    const query = `
      SELECT 
        DATE_TRUNC('week', created_at) as week,
        COUNT(*) as document_count,
        AVG(believability_score) as avg_score
      FROM documents 
      WHERE source_id = $1 
        AND created_at >= NOW() - INTERVAL '12 weeks'
        AND believability_score IS NOT NULL
      GROUP BY DATE_TRUNC('week', created_at)
      ORDER BY week DESC
    `;

    const result = await this.databaseManager.query(query, [sourceId]);
    const weeklyData = result.rows;

    if (weeklyData.length === 0) {
      return {
        weeklyTrend: 'stable',
        trendScore: 0.5,
        dataPoints: 0
      };
    }

    // Calculate trend
    const scores = weeklyData.map(row => parseFloat(row.avg_score));
    const trend = this.calculateTrend(scores);

    return {
      weeklyTrend: trend.direction,
      trendScore: trend.score,
      dataPoints: weeklyData.length,
      weeklyData: weeklyData.map(row => ({
        week: row.week,
        documentCount: parseInt(row.document_count),
        avgScore: parseFloat(row.avg_score)
      }))
    };
  }

  /**
   * Calculate quality score from metrics
   */
  calculateQualityScore(metrics) {
    if (metrics.totalDocuments === 0) return 0.5; // Neutral score for no data

    // Weight believability and quality scores
    const believabilityWeight = 0.6;
    const qualityWeight = 0.4;

    const believabilityScore = metrics.avgBelievability;
    const qualityScore = metrics.avgQuality || metrics.avgBelievability; // Fallback to believability

    return (believabilityScore * believabilityWeight) + (qualityScore * qualityWeight);
  }

  /**
   * Calculate feedback score from metrics
   */
  calculateFeedbackScore(metrics) {
    if (metrics.totalFeedback === 0) return 0.5; // Neutral score for no feedback

    // Convert 1-5 rating to 0-1 scale
    const normalizedRating = (metrics.avgRating - 1) / 4;
    
    // Boost score if there's diverse user feedback
    const diversityBonus = Math.min(metrics.uniqueUsers / 10, 0.1); // Up to 10% bonus
    
    return Math.min(normalizedRating + diversityBonus, 1.0);
  }

  /**
   * Calculate consistency score from metrics
   */
  calculateConsistencyScore(metrics) {
    if (metrics.totalDocuments === 0) return 0.5;

    let score = 0.5; // Base score

    // Penalize high content type variety (inconsistency)
    if (metrics.contentTypeVariety <= 2) {
      score += 0.2; // Bonus for consistency
    } else if (metrics.contentTypeVariety > 5) {
      score -= 0.2; // Penalty for inconsistency
    }

    // Penalize high word count variability
    if (metrics.wordCountVariability < 0.5) {
      score += 0.15; // Bonus for consistent length
    } else if (metrics.wordCountVariability > 1.5) {
      score -= 0.15; // Penalty for inconsistent length
    }

    // Bonus for metadata completeness
    score += metrics.metadataCompleteness * 0.2;

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Calculate error score from metrics (lower error rate = higher score)
   */
  calculateErrorScore(metrics) {
    if (metrics.totalJobs === 0) return 0.5;

    // Invert failure rate to get success score
    const successScore = 1 - metrics.failureRate;
    
    // Bonus for fast processing
    const processingBonus = metrics.avgProcessingTime < 30 ? 0.1 : 0; // Bonus for under 30 seconds
    
    return Math.min(successScore + processingBonus, 1.0);
  }

  /**
   * Calculate historical score from metrics
   */
  calculateHistoricalScore(metrics) {
    if (metrics.dataPoints < 3) return 0.5; // Need at least 3 weeks of data

    let score = 0.5;

    // Bonus for improving trend
    if (metrics.weeklyTrend === 'improving') {
      score += 0.3;
    } else if (metrics.weeklyTrend === 'declining') {
      score -= 0.3;
    }

    // Bonus for having consistent data
    if (metrics.dataPoints >= 8) {
      score += 0.2; // Bonus for 8+ weeks of data
    }

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Calculate trend from a series of scores
   */
  calculateTrend(scores) {
    if (scores.length < 2) {
      return { direction: 'stable', score: 0.5 };
    }

    // Simple linear regression to determine trend
    const n = scores.length;
    const x = Array.from({ length: n }, (_, i) => i);
    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = scores.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((sum, xi, i) => sum + xi * scores[i], 0);
    const sumXX = x.reduce((sum, xi) => sum + xi * xi, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);

    let direction, score;
    if (slope > 0.01) {
      direction = 'improving';
      score = 0.5 + Math.min(slope * 10, 0.5); // Scale slope to 0.5-1.0
    } else if (slope < -0.01) {
      direction = 'declining';
      score = 0.5 + Math.max(slope * 10, -0.5); // Scale slope to 0.0-0.5
    } else {
      direction = 'stable';
      score = 0.5;
    }

    return { direction, score };
  }

  /**
   * Calculate linear regression for trend analysis
   * @param {Array} data - Array of {x, y} points
   * @returns {Object} Regression results with slope and trend
   */
  calculateLinearRegression(data) {
    if (!data || data.length < 2) {
      return { slope: 0, trend: 'stable' };
    }

    const n = data.length;
    const sumX = data.reduce((sum, point) => sum + point.x, 0);
    const sumY = data.reduce((sum, point) => sum + point.y, 0);
    const sumXY = data.reduce((sum, point) => sum + (point.x * point.y), 0);
    const sumXX = data.reduce((sum, point) => sum + (point.x * point.x), 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);

    let trend = 'stable';
    if (slope > 0.01) {
      trend = 'improving';
    } else if (slope < -0.01) {
      trend = 'declining';
    }

    return { slope, trend };
  }

  /**
   * Get reliability level from score
   */
  getReliabilityLevel(score) {
    if (score >= this.thresholds.high) return 'high';
    if (score >= this.thresholds.medium) return 'medium';
    return 'low';
  }

  /**
   * Determine reliability level based on score (alias for getReliabilityLevel)
   * @param {number} score - Overall reliability score (0-1)
   * @returns {string} Reliability level ('high', 'medium', 'low')
   */
  determineReliabilityLevel(score) {
    return this.getReliabilityLevel(score);
  }

  /**
   * Store reliability score in database
   */
  async storeReliabilityScore(scoreData) {
    const query = `
      INSERT INTO source_reliability_scores (
        source_id, overall_score, reliability_level, score_breakdown, 
        metrics_data, calculated_at, timeframe
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (source_id) 
      DO UPDATE SET 
        overall_score = EXCLUDED.overall_score,
        reliability_level = EXCLUDED.reliability_level,
        score_breakdown = EXCLUDED.score_breakdown,
        metrics_data = EXCLUDED.metrics_data,
        calculated_at = EXCLUDED.calculated_at,
        timeframe = EXCLUDED.timeframe,
        updated_at = NOW()
      RETURNING id
    `;

    const values = [
      scoreData.sourceId,
      scoreData.overallScore,
      scoreData.reliabilityLevel,
      JSON.stringify(scoreData.breakdown),
      JSON.stringify(scoreData.metrics),
      scoreData.calculatedAt,
      scoreData.timeframe
    ];

    await this.databaseManager.query(query, values);
  }

  /**
   * Get stored reliability score for a source
   */
  async getReliabilityScore(sourceId) {
    const query = `
      SELECT 
        source_id,
        overall_score,
        reliability_level,
        score_breakdown,
        metrics_data,
        calculated_at,
        timeframe,
        updated_at
      FROM source_reliability_scores 
      WHERE source_id = $1
    `;

    const result = await this.databaseManager.query(query, [sourceId]);
    
    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      sourceId: row.source_id,
      overallScore: parseFloat(row.overall_score),
      reliabilityLevel: row.reliability_level,
      breakdown: JSON.parse(row.score_breakdown),
      metrics: JSON.parse(row.metrics_data),
      calculatedAt: row.calculated_at,
      timeframe: row.timeframe,
      updatedAt: row.updated_at
    };
  }

  /**
   * Get reliability scores for all sources
   */
  async getAllReliabilityScores(options = {}) {
    const { limit = 50, offset = 0, orderBy = 'overall_score DESC' } = options;

    const query = `
      SELECT 
        s.id,
        s.name,
        s.type,
        s.status,
        srs.overall_score,
        srs.reliability_level,
        srs.calculated_at,
        srs.updated_at
      FROM sources s
      LEFT JOIN source_reliability_scores srs ON s.id = srs.source_id
      ORDER BY ${orderBy}
      LIMIT $1 OFFSET $2
    `;

    const result = await this.databaseManager.query(query, [limit, offset]);
    
    return result.rows.map(row => ({
      sourceId: row.id,
      sourceName: row.name,
      sourceType: row.type,
      sourceStatus: row.status,
      overallScore: row.overall_score ? parseFloat(row.overall_score) : null,
      reliabilityLevel: row.reliability_level,
      calculatedAt: row.calculated_at,
      updatedAt: row.updated_at
    }));
  }

  /**
   * Update reliability scores for all sources
   */
  async updateAllReliabilityScores(options = {}) {
    const { batchSize = 10 } = options;

    try {
      // Get all active sources
      const sourcesQuery = `
        SELECT id, name FROM sources 
        WHERE status = 'active'
        ORDER BY last_sync_at DESC NULLS LAST
      `;
      
      const sourcesResult = await this.databaseManager.query(sourcesQuery);
      const sources = sourcesResult.rows;

      logger.info('Starting reliability score update for all sources', {
        totalSources: sources.length
      });

      const results = [];
      
      // Process sources in batches
      for (let i = 0; i < sources.length; i += batchSize) {
        const batch = sources.slice(i, i + batchSize);
        
        const batchPromises = batch.map(async (source) => {
          try {
            const score = await this.calculateReliabilityScore(source.id);
            return { sourceId: source.id, sourceName: source.name, success: true, score };
          } catch (error) {
            logger.error('Failed to calculate reliability score', {
              sourceId: source.id,
              sourceName: source.name,
              error: error.message
            });
            return { sourceId: source.id, sourceName: source.name, success: false, error: error.message };
          }
        });

        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);

        logger.info('Completed reliability score batch', {
          batchNumber: Math.floor(i / batchSize) + 1,
          totalBatches: Math.ceil(sources.length / batchSize),
          completed: i + batch.length,
          total: sources.length
        });
      }

      const successful = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;

      logger.info('Completed reliability score update for all sources', {
        totalSources: sources.length,
        successful,
        failed
      });

      return {
        totalSources: sources.length,
        successful,
        failed,
        results
      };

    } catch (error) {
      logger.error('Failed to update all reliability scores', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Update source reliability based on curation decision
   * @param {string} sourceId - Source identifier
   * @param {Object} decisionData - Curation decision data
   */
  async updateSourceReliability(sourceId, decisionData) {
    if (!this.isInitialized) {
      throw new Error('SourceReliabilityService not initialized');
    }

    try {
      const { decision, documentId, curatorId, timestamp } = decisionData;
      
      // Record the curation decision for future score calculations
      const query = `
        INSERT INTO source_curation_decisions (
          source_id, document_id, curator_id, decision, 
          created_at
        ) VALUES ($1, $2, $3, $4, $5)
      `;
      
      await this.databaseManager.query(query, [
        sourceId,
        documentId,
        curatorId,
        decision.toLowerCase(),
        timestamp || new Date()
      ]);

      // Trigger recalculation of reliability score
      await this.calculateReliabilityScore(sourceId);

      logger.info('Source reliability updated', {
        sourceId,
        decision,
        documentId,
        curatorId
      });

    } catch (error) {
      logger.error('Failed to update source reliability', {
        sourceId,
        error: error.message,
        decisionData
      });
      // Don't throw to avoid blocking the curation workflow
    }
  }

  /**
   * Normalize a score to 0-1 range
   * @param {number} value - Value to normalize
   * @param {number} min - Minimum possible value
   * @param {number} max - Maximum possible value
   * @returns {number} Normalized score (0-1)
   */
  normalizeScore(value, min, max) {
    if (max === min) {
      return 0; // Avoid division by zero
    }
    
    const normalized = (value - min) / (max - min);
    return Math.max(0, Math.min(1, normalized)); // Clamp to 0-1 range
  }
}

module.exports = SourceReliabilityService;
