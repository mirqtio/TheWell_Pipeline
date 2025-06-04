const logger = require('../utils/logger');

/**
 * DocumentDAO - Data Access Object for documents
 */
class DocumentDAO {
  constructor(databaseManager) {
    this.db = databaseManager;
  }

  /**
     * Create a new document
     */
  async create(documentData) {
    const {
      source_id,
      external_id,
      title,
      content,
      content_type = 'text/plain',
      url,
      metadata = {},
      hash,
      word_count,
      language
    } = documentData;

    try {
      const query = `
                INSERT INTO documents (
                    source_id, external_id, title, content, content_type,
                    url, metadata, hash, word_count, language
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                RETURNING *
            `;
            
      const values = [
        source_id, external_id, title, content, content_type,
        url, JSON.stringify(metadata), hash, word_count, language
      ];
            
      const result = await this.db.query(query, values);
      logger.info('Document created', { document_id: result.rows[0].id });
            
      return result.rows[0];
    } catch (error) {
      logger.error('Failed to create document', { error: error.message, documentData });
      throw error;
    }
  }

  /**
     * Find document by ID
     */
  async findById(id) {
    try {
      const query = `
                SELECT d.*, dv.visibility_level, dv.access_groups
                FROM documents d
                LEFT JOIN document_visibility dv ON d.id = dv.document_id
                WHERE d.id = $1
            `;
            
      const result = await this.db.query(query, [id]);
      return result.rows[0] || null;
    } catch (error) {
      logger.error('Failed to find document by ID', { error: error.message, id });
      throw error;
    }
  }

  /**
     * Find document by hash (for deduplication)
     */
  async findByHash(hash) {
    try {
      const query = 'SELECT * FROM documents WHERE hash = $1';
      const result = await this.db.query(query, [hash]);
      return result.rows[0] || null;
    } catch (error) {
      logger.error('Failed to find document by hash', { error: error.message, hash });
      throw error;
    }
  }

  /**
     * Search documents with full-text search
     */
  async search(searchTerm, options = {}) {
    const {
      limit = 50,
      offset = 0,
      source_id,
      visibility_level,
      content_type,
      language
    } = options;

    try {
      let query = `
                SELECT d.*, dv.visibility_level, dv.access_groups,
                       ts_rank(d.search_vector, plainto_tsquery('english', $1)) as rank
                FROM documents d
                LEFT JOIN document_visibility dv ON d.id = dv.document_id
                WHERE d.search_vector @@ plainto_tsquery('english', $1)
            `;
            
      const values = [searchTerm];
      let paramCount = 1;
            
      if (source_id) {
        query += ` AND d.source_id = $${++paramCount}`;
        values.push(source_id);
      }
            
      if (visibility_level) {
        query += ` AND dv.visibility_level = $${++paramCount}`;
        values.push(visibility_level);
      }
            
      if (content_type) {
        query += ` AND d.content_type = $${++paramCount}`;
        values.push(content_type);
      }
            
      if (language) {
        query += ` AND d.language = $${++paramCount}`;
        values.push(language);
      }
            
      query += ` ORDER BY rank DESC, d.created_at DESC LIMIT $${++paramCount} OFFSET $${++paramCount}`;
      values.push(limit, offset);
            
      const result = await this.db.query(query, values);
      return result.rows;
    } catch (error) {
      logger.error('Failed to search documents', { error: error.message, searchTerm, options });
      throw error;
    }
  }

  /**
     * Get documents by source
     */
  async findBySource(source_id, options = {}) {
    const { limit = 100, offset = 0, order = 'created_at DESC' } = options;

    try {
      const query = `
                SELECT d.*, dv.visibility_level, dv.access_groups
                FROM documents d
                LEFT JOIN document_visibility dv ON d.id = dv.document_id
                WHERE d.source_id = $1
                ORDER BY ${order}
                LIMIT $2 OFFSET $3
            `;
            
      const result = await this.db.query(query, [source_id, limit, offset]);
      return result.rows;
    } catch (error) {
      logger.error('Failed to find documents by source', { error: error.message, source_id });
      throw error;
    }
  }

  /**
     * Update document
     */
  async update(id, updateData) {
    try {
      const fields = [];
      const values = [];
      let paramCount = 0;

      for (const [key, value] of Object.entries(updateData)) {
        if (key === 'metadata') {
          fields.push(`${key} = $${++paramCount}`);
          values.push(JSON.stringify(value));
        } else {
          fields.push(`${key} = $${++paramCount}`);
          values.push(value);
        }
      }

      if (fields.length === 0) {
        throw new Error('No fields to update');
      }

      const query = `
                UPDATE documents 
                SET ${fields.join(', ')}, updated_at = NOW()
                WHERE id = $${++paramCount}
                RETURNING *
            `;
      values.push(id);

      const result = await this.db.query(query, values);
            
      if (result.rows.length === 0) {
        throw new Error('Document not found');
      }

      logger.info('Document updated', { document_id: id });
      return result.rows[0];
    } catch (error) {
      logger.error('Failed to update document', { error: error.message, id, updateData });
      throw error;
    }
  }

  /**
     * Delete document
     */
  async delete(id) {
    try {
      const query = 'DELETE FROM documents WHERE id = $1 RETURNING id';
      const result = await this.db.query(query, [id]);
            
      if (result.rows.length === 0) {
        throw new Error('Document not found');
      }

      logger.info('Document deleted', { document_id: id });
      return true;
    } catch (error) {
      logger.error('Failed to delete document', { error: error.message, id });
      throw error;
    }
  }

  /**
     * Get documents pending review
     */
  async findPendingReview(options = {}) {
    const { limit = 50, offset = 0 } = options;

    try {
      const query = `
                SELECT d.*, dv.visibility_level
                FROM documents d
                LEFT JOIN document_visibility dv ON d.id = dv.document_id
                LEFT JOIN document_reviews dr ON d.id = dr.document_id
                WHERE dr.id IS NULL
                ORDER BY d.created_at ASC
                LIMIT $1 OFFSET $2
            `;
            
      const result = await this.db.query(query, [limit, offset]);
      return result.rows;
    } catch (error) {
      logger.error('Failed to find documents pending review', { error: error.message });
      throw error;
    }
  }

  /**
     * Get document statistics
     */
  async getStats() {
    try {
      const queries = [
        { key: 'total', query: 'SELECT COUNT(*) as count FROM documents' },
        { key: 'by_visibility', query: `
                    SELECT dv.visibility_level, COUNT(*) as count
                    FROM documents d
                    LEFT JOIN document_visibility dv ON d.id = dv.document_id
                    GROUP BY dv.visibility_level
                ` },
        { key: 'by_content_type', query: `
                    SELECT content_type, COUNT(*) as count
                    FROM documents
                    GROUP BY content_type
                    ORDER BY count DESC
                ` },
        { key: 'recent', query: `
                    SELECT COUNT(*) as count
                    FROM documents
                    WHERE created_at > NOW() - INTERVAL '24 hours'
                ` }
      ];

      const stats = {};
            
      for (const { key, query } of queries) {
        const result = await this.db.query(query);
        if (key === 'total' || key === 'recent') {
          stats[key] = parseInt(result.rows[0].count);
        } else {
          stats[key] = result.rows;
        }
      }

      return stats;
    } catch (error) {
      logger.error('Failed to get document stats', { error: error.message });
      throw error;
    }
  }

  /**
     * Bulk create documents
     */
  async bulkCreate(documents) {
    try {
      const results = [];
            
      await this.db.transaction(async (client) => {
        for (const doc of documents) {
          const query = `
                        INSERT INTO documents (
                            source_id, external_id, title, content, content_type,
                            url, metadata, hash, word_count, language
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                        RETURNING *
                    `;
                    
          const values = [
            doc.source_id, doc.external_id, doc.title, doc.content,
            doc.content_type || 'text/plain', doc.url,
            JSON.stringify(doc.metadata || {}), doc.hash,
            doc.word_count, doc.language
          ];
                    
          const result = await client.query(query, values);
          results.push(result.rows[0]);
        }
      });

      logger.info('Bulk document creation completed', { count: results.length });
      return results;
    } catch (error) {
      logger.error('Failed to bulk create documents', { error: error.message });
      throw error;
    }
  }

  /**
   * Get curation queue with filtering and pagination
   */
  async getCurationQueue(options = {}) {
    const { 
      status, 
      priority, 
      sourceType, 
      limit = 50, 
      offset = 0 
    } = options;

    try {
      let query = `
        SELECT d.*, s.name as source_name, s.type as source_type,
               d.curation_status, d.curator_id, d.curation_notes, d.curation_decision_at,
               s.reliability_score as source_reliability_score
        FROM documents d
        LEFT JOIN sources s ON d.source_id = s.id
        WHERE 1=1
      `;
      
      const values = [];
      let paramCount = 0;

      if (status) {
        query += ` AND d.curation_status = $${++paramCount}`;
        values.push(status === 'pending' ? 'pending' : status === 'in_review' ? 'in_review' : 'processed');
      }

      if (priority) {
        query += ` AND d.priority = $${++paramCount}`;
        values.push(priority);
      }

      if (sourceType) {
        query += ` AND s.type = $${++paramCount}`;
        values.push(sourceType);
      }

      query += ` ORDER BY 
        CASE d.priority 
          WHEN 'high' THEN 1 
          WHEN 'medium' THEN 2 
          WHEN 'low' THEN 3 
          ELSE 4 
        END,
        d.created_at ASC
        LIMIT $${++paramCount} OFFSET $${++paramCount}
      `;
      
      values.push(limit, offset);

      const result = await this.db.query(query, values);
      return result.rows;
    } catch (error) {
      logger.error('Failed to get curation queue', { error: error.message, options });
      throw error;
    }
  }

  /**
   * Update curation status for a document
   */
  async updateCurationStatus(id, statusData) {
    const { status, curatorId, lastStatusChange } = statusData;

    try {
      const query = `
        UPDATE documents 
        SET curation_status = $1, curator_id = $2, updated_at = $3
        WHERE id = $4
        RETURNING *
      `;
      
      const values = [status, curatorId, lastStatusChange || new Date(), id];
      const result = await this.db.query(query, values);
      
      if (result.rows.length === 0) {
        return null;
      }

      logger.info('Document curation status updated', { 
        document_id: id, 
        status, 
        curator_id: curatorId 
      });
      
      return result.rows[0];
    } catch (error) {
      logger.error('Failed to update curation status', { 
        error: error.message, 
        id, 
        statusData 
      });
      throw error;
    }
  }

  /**
   * Get curation statistics for dashboard
   */
  async getCurationStats(timeframe = '7d') {
    try {
      const timeInterval = timeframe === '24h' ? '24 hours' : 
        timeframe === '7d' ? '7 days' : 
          timeframe === '30d' ? '30 days' : '7 days';

      const queries = [
        {
          key: 'pending',
          query: 'SELECT COUNT(*) as count FROM documents WHERE curation_status = \'pending\''
        },
        {
          key: 'inReview',
          query: 'SELECT COUNT(*) as count FROM documents WHERE curation_status = \'in_review\''
        },
        {
          key: 'processed',
          query: 'SELECT COUNT(*) as count FROM documents WHERE curation_status IN (\'approved\', \'rejected\')'
        },
        {
          key: 'approvalRate',
          query: `
            SELECT 
              CASE 
                WHEN COUNT(*) = 0 THEN 0 
                ELSE (COUNT(CASE WHEN curation_status = 'approved' THEN 1 END) * 100.0 / COUNT(*))
              END as rate
            FROM documents 
            WHERE curation_status IN ('approved', 'rejected') 
              AND curation_decision_at > NOW() - INTERVAL '${timeInterval}'
          `
        },
        {
          key: 'avgProcessingTime',
          query: `
            SELECT AVG(EXTRACT(EPOCH FROM (curation_decision_at - created_at))/3600) as avg_hours
            FROM documents 
            WHERE curation_decision_at IS NOT NULL 
              AND curation_decision_at > NOW() - INTERVAL '${timeInterval}'
          `
        },
        {
          key: 'topCurators',
          query: `
            SELECT curator_id, COUNT(*) as decisions_made
            FROM documents 
            WHERE curator_id IS NOT NULL 
              AND curation_decision_at > NOW() - INTERVAL '${timeInterval}'
            GROUP BY curator_id 
            ORDER BY decisions_made DESC 
            LIMIT 5
          `
        },
        {
          key: 'sourceBreakdown',
          query: `
            SELECT s.name, s.type, COUNT(d.id) as document_count,
              COUNT(CASE WHEN d.curation_status = 'approved' THEN 1 END) as approved_count
            FROM documents d
            LEFT JOIN sources s ON d.source_id = s.id
            WHERE d.created_at > NOW() - INTERVAL '${timeInterval}'
            GROUP BY s.id, s.name, s.type
            ORDER BY document_count DESC
            LIMIT 10
          `
        },
        {
          key: 'priorityDistribution',
          query: `
            SELECT priority, COUNT(*) as count
            FROM documents 
            WHERE created_at > NOW() - INTERVAL '${timeInterval}'
            GROUP BY priority
          `
        }
      ];

      const stats = {};
      
      for (const { key, query } of queries) {
        const result = await this.db.query(query);
        
        if (['pending', 'inReview', 'processed'].includes(key)) {
          stats[key] = parseInt(result.rows[0].count);
        } else if (key === 'approvalRate') {
          stats[key] = parseFloat(result.rows[0].rate) || 0;
        } else if (key === 'avgProcessingTime') {
          stats[key] = parseFloat(result.rows[0].avg_hours) || 0;
        } else if (key === 'priorityDistribution') {
          stats[key] = result.rows.reduce((acc, row) => {
            acc[row.priority] = parseInt(row.count);
            return acc;
          }, {});
        } else {
          stats[key] = result.rows;
        }
      }

      return stats;
    } catch (error) {
      logger.error('Failed to get curation stats', { error: error.message, timeframe });
      throw error;
    }
  }
}

module.exports = DocumentDAO;
