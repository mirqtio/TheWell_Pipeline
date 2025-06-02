/**
 * FeedbackDAO - Data Access Object for feedback operations
 * Handles CRUD operations for user feedback and feedback aggregates
 * Supports both the new comprehensive feedback table and legacy document_feedback table
 */
class FeedbackDAO {
  constructor(databaseManager) {
    this.db = databaseManager;
  }

  /**
   * Create new feedback entry in the comprehensive feedback table
   */
  async createFeedback(feedbackData) {
    const {
      documentId,
      appId,
      feedbackType,
      content,
      userId,
      sessionId
    } = feedbackData;

    const query = `
      INSERT INTO feedback (document_id, app_id, feedback_type, content, user_id, session_id)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;
    
    const values = [
      documentId, 
      appId, 
      feedbackType, 
      JSON.stringify(content), 
      userId, 
      sessionId
    ];
    const result = await this.db.pool.query(query, values);
    
    // Update feedback aggregates if this is a rating-type feedback
    if (feedbackType === 'rating' && content.rating) {
      await this.updateFeedbackAggregates(documentId);
    }
    
    return result.rows[0];
  }

  /**
   * Create legacy document feedback entry (for backward compatibility)
   */
  async createDocumentFeedback(feedbackData) {
    const {
      documentId,
      userId,
      feedbackType,
      rating,
      comment,
      metadata = {}
    } = feedbackData;

    const query = `
      INSERT INTO document_feedback (document_id, user_id, feedback_type, rating, comment, metadata)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;
    
    const values = [documentId, userId, feedbackType, rating, comment, JSON.stringify(metadata)];
    const result = await this.db.pool.query(query, values);
    
    // Update feedback aggregates
    await this.updateFeedbackAggregates(documentId);
    
    return result.rows[0];
  }

  /**
   * Get feedback by ID
   */
  async getFeedbackById(feedbackId) {
    const query = 'SELECT * FROM feedback WHERE id = $1';
    const result = await this.db.pool.query(query, [feedbackId]);
    
    if (result.rows.length === 0) {
      return null;
    }
    
    // Parse content JSON if it exists and is a string
    const feedback = result.rows[0];
    if (feedback.content && typeof feedback.content === 'string') {
      feedback.content = JSON.parse(feedback.content);
    }
    
    return feedback;
  }

  /**
   * Get all feedback for a document
   */
  async getFeedbackByDocumentId(documentId, options = {}) {
    const { limit = 50, offset = 0, feedbackType } = options;
    
    let query = 'SELECT * FROM feedback WHERE document_id = $1';
    const values = [documentId];
    
    if (feedbackType) {
      query += ' AND feedback_type = $2';
      values.push(feedbackType);
    }
    
    query += ' ORDER BY created_at DESC LIMIT $' + (values.length + 1) + ' OFFSET $' + (values.length + 2);
    values.push(limit, offset);
    
    const result = await this.db.pool.query(query, values);
    
    // Parse content JSON for each feedback
    return result.rows.map(feedback => {
      if (feedback.content && typeof feedback.content === 'string') {
        feedback.content = JSON.parse(feedback.content);
      }
      return feedback;
    });
  }

  /**
   * Get feedback by user ID
   */
  async getFeedbackByUserId(userId, options = {}) {
    const { limit = 50, offset = 0, appId } = options;
    
    let query = 'SELECT * FROM feedback WHERE user_id = $1';
    const values = [userId];
    
    if (appId) {
      query += ' AND app_id = $2';
      values.push(appId);
    }
    
    query += ' ORDER BY created_at DESC LIMIT $' + (values.length + 1) + ' OFFSET $' + (values.length + 2);
    values.push(limit, offset);
    
    const result = await this.db.pool.query(query, values);
    
    // Parse content JSON for each feedback
    return result.rows.map(feedback => {
      if (feedback.content && typeof feedback.content === 'string') {
        feedback.content = JSON.parse(feedback.content);
      }
      return feedback;
    });
  }

  /**
   * Get feedback by app ID
   */
  async getFeedbackByAppId(appId, options = {}) {
    const { limit = 50, offset = 0, feedbackType } = options;
    
    let query = 'SELECT * FROM feedback WHERE app_id = $1';
    const values = [appId];
    
    if (feedbackType) {
      query += ' AND feedback_type = $2';
      values.push(feedbackType);
    }
    
    query += ' ORDER BY created_at DESC LIMIT $' + (values.length + 1) + ' OFFSET $' + (values.length + 2);
    values.push(limit, offset);
    
    const result = await this.db.pool.query(query, values);
    
    // Parse content JSON for each feedback
    return result.rows.map(feedback => {
      if (feedback.content && typeof feedback.content === 'string') {
        feedback.content = JSON.parse(feedback.content);
      }
      return feedback;
    });
  }

  /**
   * Update feedback entry
   */
  async updateFeedback(feedbackId, updateData) {
    const allowedFields = ['content', 'user_id', 'session_id', 'processed_at'];
    const updates = [];
    const values = [];
    let paramCount = 0;

    for (const [key, value] of Object.entries(updateData)) {
      if (allowedFields.includes(key)) {
        paramCount++;
        updates.push(`${key} = $${paramCount}`);
        values.push(key === 'content' ? JSON.stringify(value) : value);
      }
    }

    if (updates.length === 0) {
      throw new Error('No valid fields to update');
    }

    paramCount++;
    values.push(feedbackId);
    
    const query = `
      UPDATE feedback 
      SET ${updates.join(', ')}, updated_at = NOW()
      WHERE id = $${paramCount}
      RETURNING *
    `;
    
    const result = await this.db.pool.query(query, values);
    
    if (result.rows.length === 0) {
      throw new Error('Feedback not found');
    }

    // Parse content JSON
    const feedback = result.rows[0];
    if (feedback.content && typeof feedback.content === 'string') {
      feedback.content = JSON.parse(feedback.content);
    }

    // Update feedback aggregates if this is a rating-type feedback
    if (feedback.feedback_type === 'rating' && feedback.content && feedback.content.rating) {
      await this.updateFeedbackAggregates(feedback.document_id);
    }
    
    return feedback;
  }

  /**
   * Delete feedback entry
   */
  async deleteFeedback(feedbackId) {
    const getQuery = 'SELECT document_id FROM feedback WHERE id = $1';
    const getResult = await this.db.pool.query(getQuery, [feedbackId]);
    
    if (getResult.rows.length === 0) {
      throw new Error('Feedback not found');
    }
    
    const documentId = getResult.rows[0].document_id;
    
    const deleteQuery = 'DELETE FROM feedback WHERE id = $1 RETURNING *';
    const result = await this.db.pool.query(deleteQuery, [feedbackId]);
    
    // Update feedback aggregates
    await this.updateFeedbackAggregates(documentId);
    
    return result.rows[0];
  }

  /**
   * Get feedback aggregates for a document
   */
  async getFeedbackAggregates(documentId) {
    const query = 'SELECT * FROM feedback_aggregates WHERE document_id = $1';
    const result = await this.db.pool.query(query, [documentId]);
    
    if (result.rows.length === 0) {
      return null;
    }
    
    const aggregate = result.rows[0];
    
    // Map database fields to expected API fields
    return {
      document_id: aggregate.document_id,
      total_feedback: aggregate.total_feedback_count,
      average_rating: aggregate.overall_score ? parseFloat(aggregate.overall_score) : null,
      last_updated: aggregate.last_updated
    };
  }

  /**
   * Update feedback aggregates for a document
   */
  async updateFeedbackAggregates(documentId) {
    // Calculate aggregates from both feedback tables
    const aggregateQuery = `
      SELECT 
        COUNT(*) as total_feedback_count,
        AVG(CASE 
          WHEN feedback_type = 'rating' THEN (content->>'rating')::numeric
          WHEN feedback_type IN ('quality', 'relevance', 'accuracy', 'usefulness') THEN (content->>'rating')::numeric
        END) as average_rating
      FROM (
        SELECT feedback_type, content FROM feedback WHERE document_id = $1
        UNION ALL
        SELECT feedback_type, jsonb_build_object('rating', rating) as content 
        FROM document_feedback WHERE document_id = $1
      ) combined_feedback
    `;
    
    const aggregateResult = await this.db.pool.query(aggregateQuery, [documentId]);
    const stats = aggregateResult.rows[0];

    // Upsert feedback aggregates
    const upsertQuery = `
      INSERT INTO feedback_aggregates (
        document_id, total_feedback_count, overall_score, last_updated
      )
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (document_id) 
      DO UPDATE SET
        total_feedback_count = EXCLUDED.total_feedback_count,
        overall_score = EXCLUDED.overall_score,
        last_updated = NOW()
      RETURNING *
    `;
    
    const values = [
      documentId,
      parseInt(stats.total_feedback_count) || 0,
      stats.average_rating ? parseFloat(stats.average_rating) : null
    ];
    
    const result = await this.db.pool.query(upsertQuery, values);
    return result.rows[0];
  }

  async updateFeedbackAggregatesWithClient(client, documentId) {
    // Calculate aggregates from both feedback tables
    const aggregateQuery = `
      SELECT 
        COUNT(*) as total_feedback_count,
        AVG(CASE 
          WHEN feedback_type = 'rating' THEN (content->>'rating')::numeric
          WHEN feedback_type IN ('quality', 'relevance', 'accuracy', 'usefulness') THEN (content->>'rating')::numeric
        END) as average_rating
      FROM (
        SELECT feedback_type, content FROM feedback WHERE document_id = $1
        UNION ALL
        SELECT feedback_type, jsonb_build_object('rating', rating) as content 
        FROM document_feedback WHERE document_id = $1
      ) combined_feedback
    `;
    
    const aggregateResult = await client.query(aggregateQuery, [documentId]);
    
    if (!aggregateResult || !aggregateResult.rows || aggregateResult.rows.length === 0) {
      return null;
    }
    
    const stats = aggregateResult.rows[0];

    // Upsert feedback aggregates
    const upsertQuery = `
      INSERT INTO feedback_aggregates (
        document_id, total_feedback_count, overall_score, last_updated
      )
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (document_id) 
      DO UPDATE SET
        total_feedback_count = EXCLUDED.total_feedback_count,
        overall_score = EXCLUDED.overall_score,
        last_updated = NOW()
      RETURNING *
    `;
    
    const values = [
      documentId,
      parseInt(stats.total_feedback_count) || 0,
      stats.average_rating ? parseFloat(stats.average_rating) : null
    ];
    
    const result = await client.query(upsertQuery, values);
    return result.rows[0];
  }

  /**
   * Get feedback statistics for multiple documents
   */
  async getFeedbackStatistics(documentIds = []) {
    let query = `
      SELECT 
        COUNT(*) as total_feedback,
        AVG(CASE 
          WHEN feedback_type = 'rating' THEN (content->>'rating')::numeric
          WHEN feedback_type IN ('quality', 'relevance', 'accuracy', 'usefulness') THEN (content->>'rating')::numeric
        END) as average_rating,
        feedback_type,
        COUNT(*) FILTER (WHERE feedback_type = 'rating') as rating_count,
        COUNT(*) FILTER (WHERE feedback_type = 'comment') as comment_count,
        COUNT(*) FILTER (WHERE feedback_type = 'quality') as quality_count,
        COUNT(*) FILTER (WHERE feedback_type = 'relevance') as relevance_count,
        COUNT(*) FILTER (WHERE feedback_type = 'accuracy') as accuracy_count,
        COUNT(*) FILTER (WHERE feedback_type = 'usefulness') as usefulness_count
      FROM feedback
    `;
    
    const values = [];
    
    if (documentIds && documentIds.length > 0) {
      query += ' WHERE document_id = ANY($1)';
      values.push(documentIds);
    }
    
    query += ' GROUP BY feedback_type';
    
    const result = await this.db.pool.query(query, values);
    
    // Aggregate the results into a single statistics object
    let totalFeedback = 0;
    let totalRatingSum = 0;
    let totalRatingCount = 0;
    const feedbackByType = {};
    
    result.rows.forEach(row => {
      totalFeedback += parseInt(row.total_feedback);
      if (row.average_rating) {
        totalRatingSum += parseFloat(row.average_rating) * parseInt(row.total_feedback);
        totalRatingCount += parseInt(row.total_feedback);
      }
      feedbackByType[row.feedback_type] = parseInt(row.total_feedback);
    });
    
    return {
      total_feedback: totalFeedback,
      average_rating: totalRatingCount > 0 ? totalRatingSum / totalRatingCount : 0,
      feedback_by_type: feedbackByType
    };
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
        TO_CHAR(combined_feedback.created_at, '${dateFormat}') as period,
        COUNT(*) as feedback_count,
        AVG(CASE 
          WHEN combined_feedback.feedback_type = 'rating' THEN (combined_feedback.content->>'rating')::numeric
          WHEN combined_feedback.feedback_type IN ('quality', 'relevance', 'accuracy', 'usefulness') THEN (combined_feedback.content->>'rating')::numeric
        END) as average_rating,
        combined_feedback.feedback_type
      FROM (
        SELECT feedback_type, content, created_at FROM feedback
        UNION ALL
        SELECT feedback_type, jsonb_build_object('rating', rating) as content, created_at 
        FROM document_feedback
      ) combined_feedback
      WHERE 1=1
    `;
    
    const values = [];
    let paramCount = 0;

    if (documentId) {
      paramCount++;
      query = `
        SELECT 
          TO_CHAR(combined_feedback.created_at, '${dateFormat}') as period,
          COUNT(*) as feedback_count,
          AVG(CASE 
            WHEN combined_feedback.feedback_type = 'rating' THEN (combined_feedback.content->>'rating')::numeric
            WHEN combined_feedback.feedback_type IN ('quality', 'relevance', 'accuracy', 'usefulness') THEN (combined_feedback.content->>'rating')::numeric
          END) as average_rating,
          combined_feedback.feedback_type
        FROM (
          SELECT feedback_type, content, created_at FROM feedback WHERE document_id = $${paramCount}
          UNION ALL
          SELECT feedback_type, jsonb_build_object('rating', rating) as content, created_at 
          FROM document_feedback WHERE document_id = $${paramCount}
        ) combined_feedback
        WHERE 1=1
      `;
      values.push(documentId);
    }

    if (feedbackType) {
      paramCount++;
      query += ` AND combined_feedback.feedback_type = $${paramCount}`;
      values.push(feedbackType);
    }

    if (startDate) {
      paramCount++;
      query += ` AND combined_feedback.created_at >= $${paramCount}`;
      values.push(startDate);
    }

    if (endDate) {
      paramCount++;
      query += ` AND combined_feedback.created_at <= $${paramCount}`;
      values.push(endDate);
    }

    query += ' GROUP BY period, combined_feedback.feedback_type ORDER BY period DESC';

    const result = await this.db.pool.query(query, values);
    return result.rows;
  }

  /**
   * Bulk create feedback entries
   */
  async bulkCreateFeedback(feedbackEntries) {
    if (!Array.isArray(feedbackEntries) || feedbackEntries.length === 0) {
      throw new Error('Invalid feedback entries array');
    }

    const client = await this.db.pool.connect();
    
    try {
      await client.query('BEGIN');
      
      const results = [];
      const documentIds = new Set();
      
      for (const feedbackData of feedbackEntries) {
        const {
          documentId,
          appId,
          feedbackType,
          content,
          userId,
          sessionId
        } = feedbackData;

        const query = `
          INSERT INTO feedback (document_id, app_id, feedback_type, content, user_id, session_id)
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING *
        `;
        
        const values = [
          documentId, 
          appId, 
          feedbackType, 
          JSON.stringify(content), 
          userId, 
          sessionId
        ];
        const result = await client.query(query, values);
        
        const feedback = result.rows[0];
        if (feedback.content && typeof feedback.content === 'string') {
          feedback.content = JSON.parse(feedback.content);
        }
        
        results.push(feedback);
        documentIds.add(documentId);
      }
      
      // TODO: Re-enable aggregate updates after fixing table existence issue
      // Update aggregates for all affected documents
      // for (const documentId of documentIds) {
      //   try {
      //     await this.updateFeedbackAggregatesWithClient(client, documentId);
      //   } catch (aggregateError) {
      //     console.warn(`Failed to update aggregates for document ${documentId}:`, aggregateError.message);
      //     // Continue without failing the entire operation
      //   }
      // }
      
      await client.query('COMMIT');
      
      return results;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Mark feedback as processed
   */
  async markFeedbackProcessed(feedbackId) {
    const query = `
      UPDATE feedback 
      SET processed_at = NOW(), updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `;
    
    const result = await this.db.pool.query(query, [feedbackId]);
    
    if (result.rows.length === 0) {
      throw new Error('Feedback not found');
    }

    const feedback = result.rows[0];
    if (feedback.content && typeof feedback.content === 'string') {
      feedback.content = JSON.parse(feedback.content);
    }
    
    return feedback;
  }
}

module.exports = FeedbackDAO;
