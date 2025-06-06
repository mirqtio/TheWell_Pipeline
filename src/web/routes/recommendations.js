const express = require('express');
const router = express.Router();
const RecommendationService = require('../../services/RecommendationService');
const { requirePermission } = require('../middleware/auth');
const logger = require('../../utils/logger');

// Initialize recommendation service
let recommendationService;

/**
 * Initialize recommendations router
 */
function initializeRecommendationsRouter() {
  recommendationService = new RecommendationService();
  return router;
}

/**
 * @swagger
 * components:
 *   schemas:
 *     Recommendation:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *         title:
 *           type: string
 *         score:
 *           type: number
 *         reason:
 *           type: string
 *         explanation:
 *           type: string
 */

/**
 * @swagger
 * /api/recommendations:
 *   get:
 *     summary: Get personalized recommendations
 *     tags: [Recommendations]
 *     parameters:
 *       - in: query
 *         name: algorithm
 *         schema:
 *           type: string
 *           enum: [hybrid, content, collaborative, popular]
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *       - in: query
 *         name: excludeViewed
 *         schema:
 *           type: boolean
 */
router.get('/', requirePermission('recommendations.view'), async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const result = await recommendationService.getRecommendations(userId, req.query);
    
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/recommendations/similar/{documentId}:
 *   get:
 *     summary: Get similar documents
 *     tags: [Recommendations]
 *     parameters:
 *       - in: path
 *         name: documentId
 *         required: true
 *         schema:
 *           type: string
 */
router.get('/similar/:documentId', requirePermission('recommendations.view'), async (req, res, next) => {
  try {
    const result = await recommendationService.getSimilarDocuments(
      req.params.documentId,
      req.query
    );
    
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/recommendations/trending:
 *   get:
 *     summary: Get trending content
 *     tags: [Recommendations]
 *     parameters:
 *       - in: query
 *         name: timeWindow
 *         schema:
 *           type: string
 *           enum: [1h, 6h, 24h, 7d, 30d]
 */
router.get('/trending', async (req, res, next) => {
  try {
    const result = await recommendationService.getTrendingContent(req.query);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/recommendations/interactions:
 *   post:
 *     summary: Record user interaction
 *     tags: [Recommendations]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - documentId
 *               - interactionType
 *             properties:
 *               documentId:
 *                 type: string
 *               interactionType:
 *                 type: string
 *                 enum: [view, like, share, save, click, dwell]
 *               metadata:
 *                 type: object
 */
router.post('/interactions', requirePermission('recommendations.interact'), async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const { documentId, interactionType, metadata } = req.body;
    
    const result = await recommendationService.recordInteraction(
      userId,
      documentId,
      interactionType,
      metadata
    );
    
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/recommendations/preferences:
 *   get:
 *     summary: Get user preferences
 *     tags: [Recommendations]
 */
router.get('/preferences', requirePermission('recommendations.view'), async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const profile = await recommendationService.getUserProfile(userId);
    
    res.json({
      success: true,
      preferences: profile.preferences,
      interests: profile.interests
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/recommendations/preferences:
 *   put:
 *     summary: Update user preferences
 *     tags: [Recommendations]
 */
router.put('/preferences', requirePermission('recommendations.update'), async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const result = await recommendationService.updateUserPreferences(
      userId,
      req.body
    );
    
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/recommendations/ab-test/{testId}:
 *   get:
 *     summary: Get A/B test recommendations
 *     tags: [Recommendations]
 */
router.get('/ab-test/:testId', requirePermission('recommendations.view'), async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const result = await recommendationService.getABTestRecommendations(
      userId,
      req.params.testId,
      req.query
    );
    
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/recommendations/analytics:
 *   get:
 *     summary: Get recommendation analytics
 *     tags: [Recommendations]
 *     parameters:
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: metric
 *         schema:
 *           type: string
 *           enum: [all, ctr, engagement]
 */
router.get('/analytics', requirePermission('recommendations.analytics'), async (req, res, next) => {
  try {
    const result = await recommendationService.getAnalytics(req.query);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/recommendations/feedback:
 *   post:
 *     summary: Submit recommendation feedback
 *     tags: [Recommendations]
 */
router.post('/feedback', requirePermission('recommendations.interact'), async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const { documentId, algorithm, feedbackType, feedbackText } = req.body;
    
    // Record feedback
    await recommendationService._getDb().query(
      `INSERT INTO recommendation_feedback 
       (user_id, document_id, algorithm, feedback_type, feedback_text)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, documentId, algorithm, feedbackType, feedbackText]
    );
    
    res.json({
      success: true,
      message: 'Feedback recorded successfully'
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/recommendations/profile:
 *   get:
 *     summary: Get full user profile
 *     tags: [Recommendations]
 */
router.get('/profile', requirePermission('recommendations.view'), async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const profile = await recommendationService.getUserProfile(userId);
    
    res.json({
      success: true,
      profile
    });
  } catch (error) {
    next(error);
  }
});

module.exports = initializeRecommendationsRouter;