/**
 * Source Reliability Routes
 * 
 * API endpoints for managing and viewing source reliability scores
 */

const express = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { ValidationError } = require('../middleware/errorHandler');
const { requirePermission } = require('../middleware/auth');
const logger = require('../../utils/logger');

module.exports = (dependencies = {}) => {
  const router = express.Router();
  const { sourceReliabilityService } = dependencies;

  // Helper function to check service availability
  const checkServiceAvailability = (res) => {
    if (!sourceReliabilityService) {
      res.status(503).json({
        success: false,
        error: 'Service Unavailable',
        message: 'Source reliability service is not available',
        timestamp: new Date().toISOString()
      });
      return false;
    }
    return true;
  };

  /**
   * Get reliability score for a specific source
   */
  router.get('/sources/:sourceId', requirePermission('read'), asyncHandler(async (req, res) => {
    if (!checkServiceAvailability(res)) return;

    const { sourceId } = req.params;
    const { recalculate = false } = req.query;

    logger.info('Getting source reliability score', {
      sourceId,
      recalculate,
      userId: req.user.id
    });

    try {
      let score;
      
      if (recalculate === 'true') {
        // Force recalculation
        score = await sourceReliabilityService.calculateReliabilityScore(sourceId);
      } else {
        // Try to get stored score first
        score = await sourceReliabilityService.getReliabilityScore(sourceId);
        
        if (!score) {
          // Calculate if no stored score exists
          score = await sourceReliabilityService.calculateReliabilityScore(sourceId);
        }
      }

      res.json({
        success: true,
        data: score
      });

    } catch (error) {
      logger.error('Failed to get source reliability score', {
        sourceId,
        error: error.message,
        userId: req.user.id
      });

      if (error.message.includes('not found')) {
        return res.status(404).json({
          success: false,
          error: 'Source not found'
        });
      }

      throw error;
    }
  }));

  /**
   * Get reliability scores for all sources
   */
  router.get('/sources', requirePermission('read'), asyncHandler(async (req, res) => {
    if (!checkServiceAvailability(res)) return;

    const { 
      page = 1, 
      limit = 50, 
      orderBy = 'overall_score',
      order = 'desc',
      reliabilityLevel 
    } = req.query;

    logger.info('Getting all source reliability scores', {
      page: parseInt(page),
      limit: parseInt(limit),
      orderBy,
      order,
      reliabilityLevel,
      userId: req.user.id
    });

    try {
      const offset = (parseInt(page) - 1) * parseInt(limit);
      const orderClause = `${orderBy} ${order.toUpperCase()}`;

      const options = {
        limit: parseInt(limit),
        offset,
        orderBy: orderClause
      };

      const scores = await sourceReliabilityService.getAllReliabilityScores(options);

      // Filter by reliability level if specified
      const filteredScores = reliabilityLevel ? 
        scores.filter(score => score.reliabilityLevel === reliabilityLevel) : 
        scores;

      res.json({
        success: true,
        data: {
          scores: filteredScores,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: filteredScores.length
          }
        }
      });

    } catch (error) {
      logger.error('Failed to get all source reliability scores', {
        error: error.message,
        userId: req.user.id
      });
      throw error;
    }
  }));

  /**
   * Calculate reliability scores for all sources
   */
  router.post('/calculate-all', requirePermission('write'), asyncHandler(async (req, res) => {
    if (!checkServiceAvailability(res)) return;

    const { batchSize = 10 } = req.body;

    logger.info('Starting bulk reliability score calculation', {
      batchSize,
      userId: req.user.id
    });

    try {
      const result = await sourceReliabilityService.updateAllReliabilityScores({
        batchSize: parseInt(batchSize)
      });

      logger.info('Completed bulk reliability score calculation', {
        result,
        userId: req.user.id
      });

      res.json({
        success: true,
        data: result
      });

    } catch (error) {
      logger.error('Failed to calculate all reliability scores', {
        error: error.message,
        userId: req.user.id
      });
      throw error;
    }
  }));

  /**
   * Get reliability score breakdown for a source
   */
  router.get('/sources/:sourceId/breakdown', requirePermission('read'), asyncHandler(async (req, res) => {
    if (!checkServiceAvailability(res)) return;

    const { sourceId } = req.params;

    logger.info('Getting source reliability breakdown', {
      sourceId,
      userId: req.user.id
    });

    try {
      const score = await sourceReliabilityService.getReliabilityScore(sourceId);
      
      if (!score) {
        return res.status(404).json({
          success: false,
          error: 'Reliability score not found for this source'
        });
      }

      res.json({
        success: true,
        data: {
          sourceId: score.sourceId,
          overallScore: score.overallScore,
          reliabilityLevel: score.reliabilityLevel,
          breakdown: score.breakdown,
          metrics: score.metrics,
          calculatedAt: score.calculatedAt,
          timeframe: score.timeframe
        }
      });

    } catch (error) {
      logger.error('Failed to get source reliability breakdown', {
        sourceId,
        error: error.message,
        userId: req.user.id
      });
      throw error;
    }
  }));

  /**
   * Get reliability statistics summary
   */
  router.get('/statistics', requirePermission('read'), asyncHandler(async (req, res) => {
    if (!checkServiceAvailability(res)) return;

    logger.info('Getting reliability statistics', {
      userId: req.user.id
    });

    try {
      const scores = await sourceReliabilityService.getAllReliabilityScores();
      
      const stats = {
        totalSources: scores.length,
        sourcesWithScores: scores.filter(s => s.overallScore !== null).length,
        reliabilityDistribution: {
          high: scores.filter(s => s.reliabilityLevel === 'high').length,
          medium: scores.filter(s => s.reliabilityLevel === 'medium').length,
          low: scores.filter(s => s.reliabilityLevel === 'low').length,
          unscored: scores.filter(s => s.reliabilityLevel === null).length
        },
        averageScore: scores.length > 0 ? 
          scores.reduce((sum, s) => sum + (s.overallScore || 0), 0) / scores.length : 0
      };

      res.json({
        success: true,
        data: stats
      });

    } catch (error) {
      logger.error('Failed to get reliability statistics', {
        error: error.message,
        userId: req.user.id
      });
      throw error;
    }
  }));

  /**
   * Update reliability score for a specific source
   */
  router.put('/sources/:sourceId', requirePermission('write'), asyncHandler(async (req, res) => {
    if (!checkServiceAvailability(res)) return;

    const { sourceId } = req.params;
    const { timeframe = '30 days' } = req.body;

    logger.info('Updating source reliability score', {
      sourceId,
      timeframe,
      userId: req.user.id
    });

    try {
      const score = await sourceReliabilityService.calculateReliabilityScore(sourceId, {
        timeframe
      });

      res.json({
        success: true,
        data: score
      });

    } catch (error) {
      logger.error('Failed to update source reliability score', {
        sourceId,
        error: error.message,
        userId: req.user.id
      });

      if (error.message.includes('not found')) {
        return res.status(404).json({
          success: false,
          error: 'Source not found'
        });
      }

      throw error;
    }
  }));

  /**
   * Get reliability trends for a source
   */
  router.get('/sources/:sourceId/trends', requirePermission('read'), asyncHandler(async (req, res) => {
    if (!checkServiceAvailability(res)) return;

    const { sourceId } = req.params;
    const { days = 90 } = req.query;

    logger.info('Getting source reliability trends', {
      sourceId,
      days,
      userId: req.user.id
    });

    try {
      // This would require historical data tracking - for now return current score
      const score = await sourceReliabilityService.getReliabilityScore(sourceId);
      
      if (!score) {
        return res.status(404).json({
          success: false,
          error: 'Reliability score not found for this source'
        });
      }

      // Extract historical data from metrics if available
      const trends = {
        sourceId,
        currentScore: score.overallScore,
        currentLevel: score.reliabilityLevel,
        historicalData: score.metrics?.historical?.weeklyData || [],
        trend: score.metrics?.historical?.weeklyTrend || 'stable',
        calculatedAt: score.calculatedAt
      };

      res.json({
        success: true,
        data: trends
      });

    } catch (error) {
      logger.error('Failed to get source reliability trends', {
        sourceId,
        error: error.message,
        userId: req.user.id
      });
      throw error;
    }
  }));

  return router;
};
