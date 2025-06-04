const express = require('express');
const FeedbackDAO = require('../../database/FeedbackDAO'); // eslint-disable-line no-unused-vars
const FeedbackProcessor = require('../../services/FeedbackProcessor');

const router = express.Router();

/**
 * Feedback API Routes
 * Provides endpoints for managing user feedback on documents
 */

// Middleware to get FeedbackDAO from app
router.use((req, res, next) => {
  req.feedbackDAO = req.app.get('feedbackDAO');
  if (!req.feedbackDAO) {
    return res.status(503).json({ 
      error: 'Feedback service unavailable',
      message: 'Database connection not available'
    });
  }
  next();
});

/**
 * POST /api/feedback
 * Create new feedback entry
 */
router.post('/', async (req, res) => {
  try {
    const { documentId, appId, feedbackType, content, userId, sessionId } = req.body;

    // Validate required fields
    if (!documentId || !appId || !feedbackType || !content) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields'
      });
    }

    // Validate feedback type
    const validTypes = ['rating', 'annotation', 'chat_log', 'quality', 'relevance', 'accuracy', 'usefulness'];
    if (!validTypes.includes(feedbackType)) {
      return res.status(400).json({
        success: false,
        error: `Invalid feedback type. Must be one of: ${validTypes.join(', ')}`
      });
    }

    const feedback = await req.feedbackDAO.createFeedback({
      documentId,
      appId,
      feedbackType,
      content,
      userId,
      sessionId
    });

    res.status(201).json({
      success: true,
      data: { feedback }
    });
  } catch (error) {
    console.error('Error creating feedback:', error);
    console.error('Error stack:', error.stack);
    
    // Handle document not found error specifically
    if (error.message && error.message.includes('not found')) {
      return res.status(404).json({
        success: false,
        error: 'Document not found',
        message: error.message
      });
    }
    
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * GET /api/feedback/document/:documentId
 * Get feedback for a specific document
 */
router.get('/document/:documentId', async (req, res) => {
  try {
    const { documentId } = req.params;
    const { feedbackType, limit = 50, offset = 0 } = req.query;

    const feedback = await req.feedbackDAO.getFeedbackByDocumentId(documentId, {
      feedbackType,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    // Get total count for pagination
    let countQuery = 'SELECT COUNT(*) FROM feedback WHERE document_id = $1';
    const countValues = [documentId];
    
    if (feedbackType) {
      countQuery += ' AND feedback_type = $2';
      countValues.push(feedbackType);
    }
    
    const countResult = await req.feedbackDAO.db.query(countQuery, countValues);
    const total = parseInt(countResult.rows[0].count);

    res.json({
      success: true,
      data: {
        feedback: feedback,
        pagination: {
          total,
          limit: parseInt(limit),
          offset: parseInt(offset)
        }
      }
    });
  } catch (error) {
    console.error('Error getting document feedback:', error);
    console.error('Error stack:', error.stack);
    
    // Handle document not found error specifically
    if (error.message && error.message.includes('not found')) {
      return res.status(404).json({
        success: false,
        error: 'Document not found',
        message: error.message
      });
    }
    
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * GET /api/feedback/user/:userId
 * Get feedback by user ID
 */
router.get('/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit = 50, offset = 0 } = req.query;

    const feedback = await req.feedbackDAO.getFeedbackByUserId(userId, {
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    res.json({
      success: true,
      data: {
        feedback,
        pagination: {
          limit: parseInt(limit),
          offset: parseInt(offset)
        }
      }
    });
  } catch (error) {
    console.error('Error getting user feedback:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * GET /api/feedback/statistics
 * Get feedback statistics
 */
router.get('/statistics', async (req, res) => {
  try {
    const { documentIds } = req.query;
    const documentIdArray = documentIds ? documentIds.split(',') : null;

    const statistics = await req.feedbackDAO.getFeedbackStatistics(documentIdArray);

    res.json({
      success: true,
      data: { statistics }
    });
  } catch (error) {
    console.error('Error getting feedback statistics:', error);
    console.error('Error stack:', error.stack);
    
    // Handle document not found error specifically
    if (error.message && error.message.includes('not found')) {
      return res.status(404).json({
        success: false,
        error: 'Document not found',
        message: error.message
      });
    }
    
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * GET /api/feedback/trends
 * Get feedback trends over time
 */
router.get('/trends', async (req, res) => {
  try {
    const { documentId, feedbackType, startDate, endDate, groupBy = 'day' } = req.query;

    const trends = await req.feedbackDAO.getFeedbackTrends({
      documentId,
      feedbackType,
      startDate,
      endDate,
      groupBy
    });

    res.json({
      success: true,
      data: { trends }
    });
  } catch (error) {
    console.error('Error getting feedback trends:', error);
    console.error('Error stack:', error.stack);
    
    // Handle document not found error specifically
    if (error.message && error.message.includes('not found')) {
      return res.status(404).json({
        success: false,
        error: 'Document not found',
        message: error.message
      });
    }
    
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * GET /api/feedback/document/:documentId/aggregates
 * Get feedback aggregates for a document
 */
router.get('/document/:documentId/aggregates', async (req, res) => {
  try {
    const { documentId } = req.params;
    const aggregates = await req.feedbackDAO.getFeedbackAggregates(documentId);

    if (!aggregates) {
      return res.status(404).json({
        success: false,
        error: 'No feedback aggregates found for this document'
      });
    }

    res.json({
      success: true,
      data: { aggregates }
    });
  } catch (error) {
    console.error('Error getting feedback aggregates:', error);
    console.error('Error stack:', error.stack);
    
    // Handle document not found error specifically
    if (error.message && error.message.includes('not found')) {
      return res.status(404).json({
        success: false,
        error: 'Document not found',
        message: error.message
      });
    }
    
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * POST /api/feedback/bulk
 * Create multiple feedback entries
 */
router.post('/bulk', async (req, res) => {
  try {
    const { feedback } = req.body;
    console.log('Bulk feedback request:', { feedback });

    if (!Array.isArray(feedback) || feedback.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid feedback data'
      });
    }

    console.log('Calling bulkCreateFeedback with:', feedback);
    const results = await req.feedbackDAO.bulkCreateFeedback(feedback);
    console.log('Bulk feedback results:', results);

    res.status(201).json({
      success: true,
      data: { 
        results,
        created: results.length
      }
    });
  } catch (error) {
    console.error('Error creating bulk feedback:', error);
    console.error('Error stack:', error.stack);
    
    // Handle document not found error specifically
    if (error.message && error.message.includes('not found')) {
      return res.status(404).json({
        success: false,
        error: 'Document not found',
        message: error.message
      });
    }
    
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * GET /api/feedback/:id
 * Get feedback by ID
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    console.log('GET feedback by ID:', id);
    console.log('feedbackDAO available:', !!req.feedbackDAO);
    
    const feedback = await req.feedbackDAO.getFeedbackById(id);
    console.log('Feedback result:', feedback);

    if (!feedback) {
      return res.status(404).json({
        success: false,
        error: 'Feedback not found'
      });
    }

    res.json({
      success: true,
      data: { feedback }
    });
  } catch (error) {
    console.error('Error getting feedback:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * PUT /api/feedback/:id
 * Update feedback entry
 */
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    // Remove read-only fields
    delete updateData.id;
    delete updateData.created_at;
    delete updateData.updated_at;

    const feedback = await req.feedbackDAO.updateFeedback(id, updateData);

    res.json({
      success: true,
      data: { feedback }
    });
  } catch (error) {
    console.error('Error updating feedback:', error);
    console.error('Error stack:', error.stack);
    if (error.message === 'Feedback not found') {
      return res.status(404).json({
        success: false,
        error: 'Feedback not found'
      });
    }
    if (error.message === 'No valid fields to update') {
      return res.status(400).json({
        success: false,
        error: 'No valid fields to update'
      });
    }
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * DELETE /api/feedback/:id
 * Delete feedback entry
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await req.feedbackDAO.deleteFeedback(id);

    res.json({
      success: true,
      message: 'Feedback deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting feedback:', error);
    console.error('Error stack:', error.stack);
    if (error.message === 'Feedback not found') {
      return res.status(404).json({
        success: false,
        error: 'Feedback not found'
      });
    }
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Initialize feedback processor
let feedbackProcessor = null;

// Middleware to get or create feedback processor
router.use((req, res, next) => {
  if (!feedbackProcessor) {
    feedbackProcessor = new FeedbackProcessor({
      enableRealTimeProcessing: process.env.NODE_ENV === 'production',
      batchSize: 50,
      processingInterval: 60000,
      trendingThreshold: 5
    });
    
    feedbackProcessor.initialize().catch(error => {
      console.error('Failed to initialize feedback processor:', error);
    });
  }
  req.feedbackProcessor = feedbackProcessor;
  next();
});

/**
 * POST /api/v1/feedback/enhanced
 * Enhanced feedback submission with real-time processing
 */
router.post('/enhanced', async (req, res) => {
  try {
    const feedbackData = {
      ...req.body,
      timestamp: new Date(),
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    };

    // Process through enhanced feedback processor
    const processedFeedback = await req.feedbackProcessor.processFeedback(feedbackData);
    
    // Store in database
    if (req.feedbackDAO) {
      const storedFeedback = await req.feedbackDAO.createFeedback({
        documentId: feedbackData.documentId,
        appId: feedbackData.appId || 'rag-system',
        feedbackType: feedbackData.type,
        content: feedbackData.content,
        userId: feedbackData.userId,
        sessionId: feedbackData.sessionId,
        metadata: {
          ...feedbackData.metadata,
          processingId: processedFeedback.id,
          sentiment: processedFeedback.sentiment,
          topics: processedFeedback.topics
        }
      });
      
      processedFeedback.databaseId = storedFeedback.id;
    }

    res.status(201).json({
      success: true,
      data: {
        feedback: processedFeedback,
        insights: processedFeedback.insights || [],
        processing: {
          id: processedFeedback.id,
          sentiment: processedFeedback.sentiment,
          topics: processedFeedback.topics,
          enrichedAt: processedFeedback.enrichedAt
        }
      }
    });
  } catch (error) {
    console.error('Error processing enhanced feedback:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process feedback',
      message: error.message
    });
  }
});

/**
 * GET /api/v1/feedback/patterns
 * Get detected feedback patterns and trends
 */
router.get('/patterns', async (req, res) => {
  try {
    const { type, severity, limit = 20 } = req.query;
    
    const patterns = req.feedbackProcessor.getFeedbackPatterns();
    const trendingIssues = req.feedbackProcessor.getTrendingIssues();
    
    let filteredPatterns = patterns;
    let filteredTrending = trendingIssues;
    
    if (type) {
      filteredPatterns = patterns.filter(p => p.pattern.includes(type));
      filteredTrending = trendingIssues.filter(t => t.pattern.includes(type));
    }
    
    if (severity) {
      filteredTrending = filteredTrending.filter(t => t.severity === severity);
    }
    
    res.json({
      success: true,
      data: {
        patterns: filteredPatterns.slice(0, parseInt(limit)),
        trendingIssues: filteredTrending.slice(0, parseInt(limit)),
        summary: {
          totalPatterns: patterns.length,
          totalTrending: trendingIssues.length,
          criticalIssues: trendingIssues.filter(t => t.severity === 'critical').length
        }
      }
    });
  } catch (error) {
    console.error('Error getting feedback patterns:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get feedback patterns',
      message: error.message
    });
  }
});

/**
 * GET /api/v1/feedback/insights
 * Get real-time insights from feedback analysis
 */
router.get('/insights', async (req, res) => {
  try {
    const { timeframe = '1h', category } = req.query; // eslint-disable-line no-unused-vars
    
    const metrics = req.feedbackProcessor.getPerformanceMetrics();
    const patterns = req.feedbackProcessor.getFeedbackPatterns();
    const trends = req.feedbackProcessor.getTrendingIssues();
    
    // Calculate insights based on recent data
    const insights = {
      performance: {
        totalProcessed: metrics.totalProcessed,
        averageProcessingTime: metrics.averageResponseTime,
        queueLength: metrics.queueLength,
        throughput: metrics.totalProcessed / (Date.now() / 3600000) // per hour
      },
      quality: {
        patternsDetected: metrics.patternsDetected,
        trendingIssues: metrics.trendingIssues,
        criticalIssues: trends.filter(t => t.severity === 'critical').length,
        averageSentiment: calculateAverageSentiment(patterns)
      },
      recommendations: generateInsightRecommendations(trends, patterns),
      alerts: trends.filter(t => ['critical', 'high'].includes(t.severity))
    };
    
    if (category) {
      const categoryInsights = filterInsightsByCategory(insights, category);
      return res.json({
        success: true,
        data: categoryInsights
      });
    }
    
    res.json({
      success: true,
      data: insights
    });
  } catch (error) {
    console.error('Error getting feedback insights:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get feedback insights',
      message: error.message
    });
  }
});

/**
 * POST /api/v1/feedback/trend/:trendId/acknowledge
 * Acknowledge a trending issue
 */
router.post('/trend/:trendId/acknowledge', async (req, res) => {
  try {
    const { trendId } = req.params;
    const { userId, notes, action } = req.body;
    
    const trends = req.feedbackProcessor.getTrendingIssues();
    const trend = trends.find(t => t.id === trendId);
    
    if (!trend) {
      return res.status(404).json({
        success: false,
        error: 'Trend not found'
      });
    }
    
    // Update trend with acknowledgment
    trend.acknowledged = {
      userId,
      notes,
      action,
      timestamp: new Date()
    };
    
    res.json({
      success: true,
      data: {
        trend,
        message: 'Trend acknowledged successfully'
      }
    });
  } catch (error) {
    console.error('Error acknowledging trend:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to acknowledge trend',
      message: error.message
    });
  }
});

/**
 * GET /api/v1/feedback/analytics/dashboard
 * Get comprehensive feedback analytics for dashboard
 */
router.get('/analytics/dashboard', async (req, res) => {
  try {
    const { timeframe = '7d' } = req.query;
    
    const metrics = req.feedbackProcessor.getPerformanceMetrics();
    const patterns = req.feedbackProcessor.getFeedbackPatterns();
    const trends = req.feedbackProcessor.getTrendingIssues();
    
    // Get database analytics if available
    let dbAnalytics = {};
    if (req.feedbackDAO) {
      try {
        const recentFeedback = await req.feedbackDAO.getRecentFeedback(timeframe);
        dbAnalytics = {
          totalFeedback: recentFeedback.length,
          feedbackByType: groupFeedbackByType(recentFeedback),
          feedbackByDocument: groupFeedbackByDocument(recentFeedback),
          averageRating: calculateAverageRating(recentFeedback)
        };
      } catch (error) {
        console.warn('Could not fetch database analytics:', error.message);
      }
    }
    
    const dashboard = {
      overview: {
        processed: metrics.totalProcessed,
        pending: metrics.queueLength,
        patterns: metrics.patternsDetected,
        trending: metrics.trendingIssues
      },
      sentiment: {
        distribution: calculateSentimentDistribution(patterns),
        trend: calculateSentimentTrend(patterns),
        average: calculateAverageSentiment(patterns)
      },
      issues: {
        critical: trends.filter(t => t.severity === 'critical'),
        high: trends.filter(t => t.severity === 'high'),
        medium: trends.filter(t => t.severity === 'medium'),
        low: trends.filter(t => t.severity === 'low')
      },
      performance: {
        processingTime: metrics.averageResponseTime,
        throughput: metrics.totalProcessed,
        efficiency: calculateProcessingEfficiency(metrics)
      },
      database: dbAnalytics,
      recommendations: generateDashboardRecommendations(trends, patterns, metrics)
    };
    
    res.json({
      success: true,
      data: dashboard,
      timestamp: new Date(),
      timeframe
    });
  } catch (error) {
    console.error('Error getting feedback analytics dashboard:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get analytics dashboard',
      message: error.message
    });
  }
});

// Helper functions for analytics
function calculateAverageSentiment(patterns) {
  if (!patterns || patterns.length === 0) return 0;
  
  const sentiments = patterns
    .map(p => p.items?.[0]?.sentiment?.score)
    .filter(s => typeof s === 'number');
    
  return sentiments.length > 0 ? 
    sentiments.reduce((sum, s) => sum + s, 0) / sentiments.length : 0;
}

function calculateSentimentDistribution(patterns) {
  const distribution = { positive: 0, neutral: 0, negative: 0 };
  
  patterns.forEach(pattern => {
    if (pattern.items) {
      pattern.items.forEach(item => {
        if (item.sentiment) {
          if (item.sentiment.score > 0.1) distribution.positive++;
          else if (item.sentiment.score < -0.1) distribution.negative++;
          else distribution.neutral++;
        }
      });
    }
  });
  
  return distribution;
}

function calculateSentimentTrend(patterns) {
  // Simplified trend calculation
  const recent = patterns.filter(p => 
    p.detectedAt && Date.now() - new Date(p.detectedAt).getTime() < 24 * 60 * 60 * 1000
  );
  
  const older = patterns.filter(p => 
    p.detectedAt && Date.now() - new Date(p.detectedAt).getTime() >= 24 * 60 * 60 * 1000
  );
  
  const recentAvg = calculateAverageSentiment(recent);
  const olderAvg = calculateAverageSentiment(older);
  
  return {
    current: recentAvg,
    previous: olderAvg,
    change: recentAvg - olderAvg,
    direction: recentAvg > olderAvg ? 'improving' : recentAvg < olderAvg ? 'declining' : 'stable'
  };
}

function calculateProcessingEfficiency(metrics) {
  if (metrics.totalProcessed === 0) return 0;
  return Math.min(100, (metrics.totalProcessed / (metrics.averageResponseTime + 1)) * 100);
}

function generateInsightRecommendations(trends, patterns) {
  const recommendations = [];
  
  const criticalTrends = trends.filter(t => t.severity === 'critical');
  if (criticalTrends.length > 0) {
    recommendations.push({
      priority: 'high',
      type: 'immediate_action',
      message: `${criticalTrends.length} critical issues require immediate attention`,
      action: 'Review critical trends and implement fixes'
    });
  }
  
  const performancePatterns = patterns.filter(p => 
    p.pattern?.includes('speed') || p.pattern?.includes('performance')
  );
  if (performancePatterns.length > 2) {
    recommendations.push({
      priority: 'medium',
      type: 'performance',
      message: 'Multiple performance-related feedback patterns detected',
      action: 'Optimize system performance and response times'
    });
  }
  
  return recommendations;
}

function generateDashboardRecommendations(trends, patterns, metrics) {
  const recommendations = [];
  
  if (metrics.queueLength > 100) {
    recommendations.push({
      type: 'processing',
      message: 'High feedback queue length detected',
      action: 'Consider increasing processing capacity'
    });
  }
  
  if (metrics.averageResponseTime > 1000) {
    recommendations.push({
      type: 'performance',
      message: 'Slow feedback processing detected',
      action: 'Optimize processing algorithms'
    });
  }
  
  return recommendations;
}

function groupFeedbackByType(feedback) {
  return feedback.reduce((acc, fb) => {
    acc[fb.feedback_type] = (acc[fb.feedback_type] || 0) + 1;
    return acc;
  }, {});
}

function groupFeedbackByDocument(feedback) {
  return feedback.reduce((acc, fb) => {
    acc[fb.document_id] = (acc[fb.document_id] || 0) + 1;
    return acc;
  }, {});
}

function calculateAverageRating(feedback) {
  const ratings = feedback
    .filter(fb => fb.content && !isNaN(parseFloat(fb.content)))
    .map(fb => parseFloat(fb.content));
    
  return ratings.length > 0 ? 
    ratings.reduce((sum, r) => sum + r, 0) / ratings.length : 0;
}

function filterInsightsByCategory(insights, category) {
  const categories = {
    performance: insights.performance,
    quality: insights.quality,
    alerts: insights.alerts,
    recommendations: insights.recommendations
  };
  
  return categories[category] || insights;
}

module.exports = router;
