const logger = require('../utils/logger');

/**
 * JobDAO - Data Access Object for jobs
 */
class JobDAO {
  constructor(databaseManager) {
    this.db = databaseManager;
  }

  /**
     * Create a new job
     */
  async create(jobData) {
    const {
      type,
      status = 'pending',
      priority = 0,
      source_id,
      document_id,
      config = {},
      progress = 0
    } = jobData;

    try {
      const query = `
                INSERT INTO jobs (
                    type, status, priority, source_id, document_id, config, progress
                ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING *
            `;
            
      const values = [type, status, priority, source_id, document_id, JSON.stringify(config), progress];
      const result = await this.db.query(query, values);
            
      logger.info('Job created', { job_id: result.rows[0].id, type });
      return result.rows[0];
    } catch (error) {
      logger.error('Failed to create job', { error: error.message, jobData });
      throw error;
    }
  }

  /**
     * Find job by ID
     */
  async findById(id) {
    try {
      const query = 'SELECT * FROM jobs WHERE id = $1';
      const result = await this.db.query(query, [id]);
      return result.rows[0] || null;
    } catch (error) {
      logger.error('Failed to find job by ID', { error: error.message, id });
      throw error;
    }
  }

  /**
     * Update job status and progress
     */
  async updateStatus(id, status, options = {}) {
    const { progress, result, error_message } = options;

    try {
      const fields = ['status = $2'];
      const values = [id, status];
      let paramCount = 2;

      if (progress !== undefined) {
        fields.push(`progress = $${++paramCount}`);
        values.push(progress);
      }

      if (result !== undefined) {
        fields.push(`result = $${++paramCount}`);
        values.push(JSON.stringify(result));
      }

      if (error_message !== undefined) {
        fields.push(`error_message = $${++paramCount}`);
        values.push(error_message);
      }

      if (status === 'running' && !options.started_at) {
        fields.push('started_at = NOW()');
      }

      if (['completed', 'failed', 'cancelled'].includes(status)) {
        fields.push('completed_at = NOW()');
      }

      const query = `
                UPDATE jobs 
                SET ${fields.join(', ')}, updated_at = NOW()
                WHERE id = $1
                RETURNING *
            `;

      const updateResult = await this.db.query(query, values);
            
      if (updateResult.rows.length === 0) {
        throw new Error('Job not found');
      }

      logger.info('Job status updated', { job_id: id, status, progress });
      return updateResult.rows[0];
    } catch (error) {
      logger.error('Failed to update job status', { error: error.message, id, status });
      throw error;
    }
  }

  /**
     * Get jobs by status
     */
  async findByStatus(status, options = {}) {
    const { limit = 100, offset = 0, type } = options;

    try {
      let query = 'SELECT * FROM jobs WHERE status = $1';
      const values = [status];
      let paramCount = 1;

      if (type) {
        query += ` AND type = $${++paramCount}`;
        values.push(type);
      }

      query += ` ORDER BY priority DESC, created_at ASC LIMIT $${++paramCount} OFFSET $${++paramCount}`;
      values.push(limit, offset);

      const result = await this.db.query(query, values);
      return result.rows;
    } catch (error) {
      logger.error('Failed to find jobs by status', { error: error.message, status });
      throw error;
    }
  }

  /**
     * Get next pending job
     */
  async getNextPending(type = null) {
    try {
      let query = `
                SELECT j.* FROM jobs j
                LEFT JOIN job_dependencies jd ON j.id = jd.job_id
                LEFT JOIN jobs dep ON jd.depends_on_job_id = dep.id
                WHERE j.status = 'pending'
                AND (jd.id IS NULL OR dep.status = 'completed')
            `;
            
      const values = [];
      let paramCount = 0;

      if (type) {
        query += ` AND j.type = $${++paramCount}`;
        values.push(type);
      }

      query += ' ORDER BY j.priority DESC, j.created_at ASC LIMIT 1';

      const result = await this.db.query(query, values);
      return result.rows[0] || null;
    } catch (error) {
      logger.error('Failed to get next pending job', { error: error.message, type });
      throw error;
    }
  }

  /**
     * Add job dependency
     */
  async addDependency(jobId, dependsOnJobId) {
    try {
      const query = `
                INSERT INTO job_dependencies (job_id, depends_on_job_id)
                VALUES ($1, $2)
                ON CONFLICT (job_id, depends_on_job_id) DO NOTHING
                RETURNING *
            `;
            
      const result = await this.db.query(query, [jobId, dependsOnJobId]);
      logger.info('Job dependency added', { job_id: jobId, depends_on: dependsOnJobId });
            
      return result.rows[0];
    } catch (error) {
      logger.error('Failed to add job dependency', { error: error.message, jobId, dependsOnJobId });
      throw error;
    }
  }

  /**
     * Add job log entry
     */
  async addLog(jobId, level, message, metadata = {}) {
    try {
      const query = `
                INSERT INTO job_logs (job_id, level, message, metadata)
                VALUES ($1, $2, $3, $4)
                RETURNING *
            `;
            
      const values = [jobId, level, message, JSON.stringify(metadata)];
      const result = await this.db.query(query, values);
            
      return result.rows[0];
    } catch (error) {
      logger.error('Failed to add job log', { error: error.message, jobId, level, message });
      throw error;
    }
  }

  /**
     * Get job logs
     */
  async getLogs(jobId, options = {}) {
    const { level, limit = 100, offset = 0 } = options;

    try {
      let query = 'SELECT * FROM job_logs WHERE job_id = $1';
      const values = [jobId];
      let paramCount = 1;

      if (level) {
        query += ` AND level = $${++paramCount}`;
        values.push(level);
      }

      query += ` ORDER BY created_at DESC LIMIT $${++paramCount} OFFSET $${++paramCount}`;
      values.push(limit, offset);

      const result = await this.db.query(query, values);
      return result.rows;
    } catch (error) {
      logger.error('Failed to get job logs', { error: error.message, jobId });
      throw error;
    }
  }

  /**
     * Cancel job
     */
  async cancel(id, reason = 'Cancelled by user') {
    try {
      const result = await this.updateStatus(id, 'cancelled', { 
        error_message: reason 
      });
            
      // Add log entry
      await this.addLog(id, 'info', 'Job cancelled', { reason });
            
      return result;
    } catch (error) {
      logger.error('Failed to cancel job', { error: error.message, id });
      throw error;
    }
  }

  /**
     * Retry failed job
     */
  async retry(id) {
    try {
      const job = await this.findById(id);
      if (!job) {
        throw new Error('Job not found');
      }

      if (job.status !== 'failed') {
        throw new Error('Only failed jobs can be retried');
      }

      const result = await this.updateStatus(id, 'pending', {
        progress: 0,
        error_message: null,
        result: null
      });

      await this.addLog(id, 'info', 'Job retried');
            
      return result;
    } catch (error) {
      logger.error('Failed to retry job', { error: error.message, id });
      throw error;
    }
  }

  /**
     * Get job statistics
     */
  async getStats() {
    try {
      const queries = [
        { key: 'total', query: 'SELECT COUNT(*) as count FROM jobs' },
        { key: 'by_status', query: `
                    SELECT status, COUNT(*) as count
                    FROM jobs
                    GROUP BY status
                ` },
        { key: 'by_type', query: `
                    SELECT type, COUNT(*) as count
                    FROM jobs
                    GROUP BY type
                    ORDER BY count DESC
                ` },
        { key: 'recent_completed', query: `
                    SELECT COUNT(*) as count
                    FROM jobs
                    WHERE status = 'completed' AND completed_at > NOW() - INTERVAL '24 hours'
                ` },
        { key: 'recent_failed', query: `
                    SELECT COUNT(*) as count
                    FROM jobs
                    WHERE status = 'failed' AND completed_at > NOW() - INTERVAL '24 hours'
                ` },
        { key: 'avg_duration', query: `
                    SELECT AVG(EXTRACT(EPOCH FROM (completed_at - started_at))) as avg_seconds
                    FROM jobs
                    WHERE status = 'completed' AND started_at IS NOT NULL AND completed_at IS NOT NULL
                ` }
      ];

      const stats = {};
            
      for (const { key, query } of queries) {
        const result = await this.db.query(query);
        if (key === 'total' || key === 'recent_completed' || key === 'recent_failed') {
          stats[key] = parseInt(result.rows[0].count);
        } else if (key === 'avg_duration') {
          stats[key] = parseFloat(result.rows[0].avg_seconds) || 0;
        } else {
          stats[key] = result.rows;
        }
      }

      return stats;
    } catch (error) {
      logger.error('Failed to get job stats', { error: error.message });
      throw error;
    }
  }

  /**
     * Clean up old completed jobs
     */
  async cleanup(retentionDays = 7) {
    try {
      const query = `
                DELETE FROM jobs 
                WHERE status IN ('completed', 'failed', 'cancelled') 
                AND completed_at < NOW() - INTERVAL '${retentionDays} days'
            `;
            
      const result = await this.db.query(query);
      logger.info('Job cleanup completed', { deleted_count: result.rowCount });
            
      return result.rowCount;
    } catch (error) {
      logger.error('Failed to cleanup jobs', { error: error.message });
      throw error;
    }
  }

  /**
     * Get job queue status
     */
  async getQueueStatus() {
    try {
      const result = await this.db.query(`
                SELECT 
                    status,
                    type,
                    COUNT(*) as count,
                    AVG(priority) as avg_priority
                FROM jobs 
                WHERE status IN ('pending', 'running')
                GROUP BY status, type
                ORDER BY status, type
            `);

      return result.rows;
    } catch (error) {
      logger.error('Failed to get queue status', { error: error.message });
      throw error;
    }
  }
}

module.exports = JobDAO;
