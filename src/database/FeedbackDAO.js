const logger = require('../utils/logger');

/**
 * FeedbackDAO - Data Access Object for feedback operations
 * Handles CRUD operations for user feedback and feedback aggregates
 */
class FeedbackDAO {
  constructor(databaseManager) {
    this.db = databaseManager;
  }

  /**
   * Create new feedback entry
   */
  async createFeedback(feedbackData) {
    const {
      documentId,
      userId,
      feedbackType,
      rating,
      comment,
      metadata = {}
    } = feedbackData;

    try {
      const query = `
        INSERT INTO feedback (document_id, user_id, feedback_type, rating, comment, metadata)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `;
      
      const values = [documentId, userId, feedbackType, rating, comment, JSON.stringify(metadata)];
      const result = await this.db.query(query, values);
      
      // Update feedback aggregates
      await this.updateFeedbackAggregates(documentId);
      
      logger.info('Feedback created successfully', { 
        feedbackId: result.rows[0].id,
        documentId,
        feedbackType 
      });
      
      return result.rows[0];
    } catch (error) {
      logger.error('Error creating feedback:', error);
      throw error;
    }
  }

  /**
   * Get feedback by ID
   */
  async getFeedbackById(feedbackId) {
    try {
      const query = 'SELECT * FROM feedback WHERE id = $1';
      const result = await this.db.query(query, [feedbackId]);
      
      if (result.rows.length === 0) {
        return null;
      }
      
      return result.rows[0];
    } catch (error) {
      logger.error('Error getting feedback by ID:', error);
      throw error;
    }
  }

  /**
   * Get all feedback for a document
   */
  async getFeedbackByDocumentId(documentId, options = {}) {
    const {
      feedbackType,
      limit = 50,
      offset = 0,
      orderBy = 'created_at',
      orderDirection = 'DESC'
    } = options;

    try {
      let query = `
        SELECT f.*, d.title as document_title
        FROM feedback f
        LEFT JOIN documents d ON f.document_id = d.id
        WHERE f.document_id = $1
      `;
      
      const values = [documentId];
      let paramCount = 1;

      if (feedbackType) {
        paramCount++;
        query += ` AND f.feedback_type = $${paramCount}`;
        values.push(feedbackType);
      }

      query += ` ORDER BY f.${orderBy} ${orderDirection}`;
      query += ` LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
      values.push(limit, offset);

      const result = await this.db.query(query, values);
      return result.rows;
    } catch (error) {
      logger.error('Error getting feedback by document ID:', error);
      throw error;
    }
  }

  /**
   * Get feedback by user
   */
  async getFeedbackByUserId(userId, options = {}) {
    const {
      limit = 50,
      offset = 0,
      orderBy = 'created_at',
      orderDirection = 'DESC'
    } = options;

    try {
      const query = `
        SELECT f.*, d.title as document_title
        FROM feedback f
        LEFT JOIN documents d ON f.document_id = d.id
        WHERE f.user_id = $1
        ORDER BY f.${orderBy} ${orderDirection}
        LIMIT $2 OFFSET $3
      `;
      
      const result = await this.db.query(query, [userId, limit, offset]);
      return result.rows;
    } catch (error) {
      logger.error('Error getting feedback by user ID:', error);
      throw error;
    }
  }

  /**
   * Update feedback entry
   */
  async updateFeedback(feedbackId, updateData) {
    const allowedFields = ['rating', 'comment', 'metadata'];
    const updates = [];
    const values = [];
    let paramCount = 0;

    for (const [key, value] of Object.entries(updateData)) {
      if (allowedFields.includes(key)) {
        paramCount++;
        updates.push(`${key} = $${paramCount}`);
        values.push(key === 'metadata' ? JSON.stringify(value) : value);
      }
    }

    if (updates.length === 0) {
      throw new Error('No valid fields to update');
    }

    try {
      paramCount++;
      values.push(feedbackId);
      
      const query = `
        UPDATE feedback 
        SET ${updates.join(', ')}, updated_at = NOW()
        WHERE id = $${paramCount}
        RETURNING *
      `;
      
      const result = await this.db.query(query, values);
      
      if (result.rows.length === 0) {
        throw new Error('Feedback not found');
      }

      // Update feedback aggregates
      await this.updateFeedbackAggregates(result.rows[0].document_id);
      
      logger.info('Feedback updated successfully', { feedbackId });
      return result.rows[0];
    } catch (error) {
      logger.error('Error updating feedback:', error);
      throw error;
    }
  }

  /**
   * Delete feedback entry
   */
  async deleteFeedback(feedbackId) {
    try {
      // Get document ID before deletion for aggregate update
      const feedbackQuery = 'SELECT document_id FROM feedback WHERE id = $1';
      const feedbackResult = await this.db.query(feedbackQuery, [feedbackId]);
      
      if (feedbackResult.rows.length === 0) {
        throw new Error('Feedback not found');
      }

      const documentId = feedbackResult.rows[0].document_id;

      const deleteQuery = 'DELETE FROM feedback WHERE id = $1 RETURNING *';
      const result = await this.db.query(deleteQuery, [feedbackId]);
      
      // Update feedback aggregates
      await this.updateFeedbackAggregates(documentId);
      
      logger.info('Feedback deleted successfully', { feedbackId });
      return result.rows[0];
    } catch (error) {
      logger.error('Error deleting feedback:', error);
      throw error;
    }
  }

  /**
   * Get feedback aggregates for a document
   */
  async getFeedbackAggregates(documentId) {
    try {
      const query = 'SELECT * FROM feedback_aggregates WHERE document_id = $1';
      const result = await this.db.query(query, [documentId]);
      
      if (result.rows.length === 0) {
        return null;
      }
      
      return result.rows[0];
    } catch (error) {
      logger.error('Error getting feedback aggregates:', error);
      throw error;
    }
  }

  /**
   * Update feedback aggregates for a document
   */
  async updateFeedbackAggregates(documentId) {
    try {
      // Calculate aggregates from feedback table
      const aggregateQuery = `
        SELECT 
          COUNT(*) as total_feedback_count,
          AVG(CASE WHEN feedback_type = 'quality' THEN rating END) as average_quality_rating,
          AVG(CASE WHEN feedback_type = 'relevance' THEN rating END) as average_relevance_rating,
          AVG(CASE WHEN feedback_type = 'accuracy' THEN rating END) as average_accuracy_rating,
          AVG(CASE WHEN feedback_type = 'usefulness' THEN rating END) as average_usefulness_rating,
          AVG(rating) as overall_score
        FROM feedback 
        WHERE document_id = $1
      `;
      
      const aggregateResult = await this.db.query(aggregateQuery, [documentId]);
      const stats = aggregateResult.rows[0];

      // Upsert feedback aggregates
      const upsertQuery = `
        INSERT INTO feedback_aggregates (
          document_id, total_feedback_count, average_quality_rating,
          average_relevance_rating, average_accuracy_rating, 
          average_usefulness_rating, overall_score, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
        ON CONFLICT (document_id) 
        DO UPDATE SET
          total_feedback_count = EXCLUDED.total_feedback_count,
          average_quality_rating = EXCLUDED.average_quality_rating,
          average_relevance_rating = EXCLUDED.average_relevance_rating,
          average_accuracy_rating = EXCLUDED.average_accuracy_rating,
          average_usefulness_rating = EXCLUDED.average_usefulness_rating,
          overall_score = EXCLUDED.overall_score,
          updated_at = NOW()
        RETURNING *
      `;
      
      const values = [
        documentId,
        parseInt(stats.total_feedback_count) || 0,
        stats.average_quality_rating ? parseFloat(stats.average_quality_rating) : null,
        stats.average_relevance_rating ? parseFloat(stats.average_relevance_rating) : null,
        stats.average_accuracy_rating ? parseFloat(stats.average_accuracy_rating) : null,
        stats.average_usefulness_rating ? parseFloat(stats.average_usefulness_rating) : null,
        stats.overall_score ? parseFloat(stats.overall_score) : null
      ];
      
      const result = await this.db.query(upsertQuery, values);
      return result.rows[0];
    } catch (error) {
      logger.error('Error updating feedback aggregates:', error);
      throw error;
    }
  }

  /**
   * Get feedback statistics for multiple documents
   */
  async getFeedbackStatistics(documentIds = []) {
    try {
      let query = `
        SELECT 
          fa.document_id,
          fa.total_feedback_count,
          fa.average_quality_rating,
          fa.average_relevance_rating,
          fa.average_accuracy_rating,
          fa.average_usefulness_rating,
          fa.overall_score,
          d.title as document_title
        FROM feedback_aggregates fa
        LEFT JOIN documents d ON fa.document_id = d.id
      `;
      
      const values = [];
      
      if (documentIds.length > 0) {
        query += ' WHERE fa.document_id = ANY($1)';
        values.push(documentIds);
      }
      
      query += ' ORDER BY fa.overall_score DESC NULLS LAST';
      
      const result = await this.db.query(query, values);
      return result.rows;
    } catch (error) {
      logger.error('Error getting feedback statistics:', error);
      throw error;
    }
  }

  /**
   * Get feedback trends over time
   */
  async getFeedbackTrends(options = {}) {
    const {
      documentId,
      feedbackType,
      startDate,
      endDate,
      groupBy = 'day' // day, week, month
    } = options;

    try {
      let dateFormat;
      switch (groupBy) {
        case 'week':
          dateFormat = 'YYYY-"W"WW';
          break;
        case 'month':
          dateFormat = 'YYYY-MM';
          break;
        default:
          dateFormat = 'YYYY-MM-DD';
      }

      let query = `
        SELECT 
          TO_CHAR(created_at, '${dateFormat}') as period,
          COUNT(*) as feedback_count,
          AVG(rating) as average_rating,
          feedback_type
        FROM feedback
        WHERE 1=1
      `;
      
      const values = [];
      let paramCount = 0;

      if (documentId) {
        paramCount++;
        query += ` AND document_id = $${paramCount}`;
        values.push(documentId);
      }

      if (feedbackType) {
        paramCount++;
        query += ` AND feedback_type = $${paramCount}`;
        values.push(feedbackType);
      }

      if (startDate) {
        paramCount++;
        query += ` AND created_at >= $${paramCount}`;
        values.push(startDate);
      }

      if (endDate) {
        paramCount++;
        query += ` AND created_at <= $${paramCount}`;
        values.push(endDate);
      }

      query += ' GROUP BY period, feedback_type ORDER BY period DESC';
      
      const result = await this.db.query(query, values);
      return result.rows;
    } catch (error) {
      logger.error('Error getting feedback trends:', error);
      throw error;
    }
  }

  /**
   * Bulk create feedback entries
   */
  async bulkCreateFeedback(feedbackEntries) {
    if (!Array.isArray(feedbackEntries) || feedbackEntries.length === 0) {
      throw new Error('Invalid feedback entries array');
    }

    const client = await this.db.connect();
    
    try {
      await client.query('BEGIN');
      
      const results = [];
      const documentIds = new Set();
      
      for (const feedbackData of feedbackEntries) {
        const {
          documentId,
          userId,
          feedbackType,
          rating,
          comment,
          metadata = {}
        } = feedbackData;

        const query = `
          INSERT INTO feedback (document_id, user_id, feedback_type, rating, comment, metadata)
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING *
        `;
        
        const values = [documentId, userId, feedbackType, rating, comment, JSON.stringify(metadata)];
        const result = await client.query(query, values);
        
        results.push(result.rows[0]);
        documentIds.add(documentId);
      }
      
      // Update aggregates for all affected documents
      for (const documentId of documentIds) {
        await this.updateFeedbackAggregates(documentId);
      }
      
      await client.query('COMMIT');
      
      logger.info('Bulk feedback creation completed', { 
        count: results.length,
        documentsAffected: documentIds.size 
      });
      
      return results;
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error in bulk feedback creation:', error);
      throw error;
    } finally {
      client.release();
    }
  }
}

module.exports = FeedbackDAO;
