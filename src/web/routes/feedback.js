const express = require('express');
const FeedbackDAO = require('../../database/FeedbackDAO');

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

module.exports = router;
