/**
 * Quality Metrics Data Access Object
 * Handles persistence of quality metrics, SLO compliance, and reports
 */

const logger = require('../utils/logger');

class QualityDAO {
  constructor(pool) {
    this.pool = pool;
  }

  /**
   * Save a quality report
   */
  async saveQualityReport(report) {
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Insert quality report
      const reportQuery = `
        INSERT INTO quality_reports (
          id, timestamp, window_period, metrics, slos, summary, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
        RETURNING id
      `;
      
      const reportId = require('crypto').randomUUID();
      await client.query(reportQuery, [
        reportId,
        report.timestamp,
        report.window,
        JSON.stringify(report.metrics),
        JSON.stringify(report.slos),
        JSON.stringify(report.summary)
      ]);
      
      await client.query('COMMIT');
      return reportId;
      
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Failed to save quality report', { error: error.message });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Save SLO violation event
   */
  async saveSLOViolation(violation) {
    const client = await this.pool.connect();
    
    try {
      const query = `
        INSERT INTO slo_violations (
          id, slo_id, slo_name, target_value, current_value, 
          is_compliant, labels, timestamp, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
        RETURNING id
      `;
      
      const violationId = require('crypto').randomUUID();
      const result = await client.query(query, [
        violationId,
        violation.sloId,
        violation.slo.name,
        violation.slo.target,
        violation.compliance.current,
        violation.compliance.isCompliant,
        JSON.stringify(violation.labels),
        new Date(violation.timestamp).toISOString()
      ]);
      
      return result.rows[0].id;
      
    } catch (error) {
      logger.error('Failed to save SLO violation', { error: error.message });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get quality reports within a date range
   */
  async getQualityReports(startDate, endDate, limit = 100) {
    const client = await this.pool.connect();
    
    try {
      const query = `
        SELECT id, timestamp, window_period, metrics, slos, summary, created_at
        FROM quality_reports
        WHERE timestamp >= $1 AND timestamp <= $2
        ORDER BY timestamp DESC
        LIMIT $3
      `;
      
      const result = await client.query(query, [startDate, endDate, limit]);
      
      return result.rows.map(row => ({
        id: row.id,
        timestamp: row.timestamp,
        window: row.window_period,
        metrics: row.metrics,
        slos: row.slos,
        summary: row.summary,
        createdAt: row.created_at
      }));
      
    } catch (error) {
      logger.error('Failed to get quality reports', { error: error.message });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get SLO violations within a date range
   */
  async getSLOViolations(startDate, endDate, sloId = null, limit = 100) {
    const client = await this.pool.connect();
    
    try {
      let query = `
        SELECT id, slo_id, slo_name, target_value, current_value, 
               is_compliant, labels, timestamp, created_at
        FROM slo_violations
        WHERE timestamp >= $1 AND timestamp <= $2
      `;
      
      const params = [startDate, endDate];
      
      if (sloId) {
        query += ' AND slo_id = $3';
        params.push(sloId);
        query += ' ORDER BY timestamp DESC LIMIT $4';
        params.push(limit);
      } else {
        query += ' ORDER BY timestamp DESC LIMIT $3';
        params.push(limit);
      }
      
      const result = await client.query(query, params);
      
      return result.rows.map(row => ({
        id: row.id,
        sloId: row.slo_id,
        sloName: row.slo_name,
        targetValue: row.target_value,
        currentValue: row.current_value,
        isCompliant: row.is_compliant,
        labels: row.labels,
        timestamp: row.timestamp,
        createdAt: row.created_at
      }));
      
    } catch (error) {
      logger.error('Failed to get SLO violations', { error: error.message });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get SLO compliance statistics
   */
  async getSLOComplianceStats(startDate, endDate) {
    const client = await this.pool.connect();
    
    try {
      const query = `
        SELECT 
          slo_id,
          slo_name,
          COUNT(*) as total_checks,
          COUNT(*) FILTER (WHERE is_compliant = true) as compliant_checks,
          COUNT(*) FILTER (WHERE is_compliant = false) as violation_count,
          AVG(current_value) as avg_value,
          MIN(current_value) as min_value,
          MAX(current_value) as max_value
        FROM slo_violations
        WHERE timestamp >= $1 AND timestamp <= $2
        GROUP BY slo_id, slo_name
        ORDER BY violation_count DESC
      `;
      
      const result = await client.query(query, [startDate, endDate]);
      
      return result.rows.map(row => ({
        sloId: row.slo_id,
        sloName: row.slo_name,
        totalChecks: parseInt(row.total_checks),
        compliantChecks: parseInt(row.compliant_checks),
        violationCount: parseInt(row.violation_count),
        complianceRate: row.total_checks > 0 ? row.compliant_checks / row.total_checks : 1,
        avgValue: parseFloat(row.avg_value),
        minValue: parseFloat(row.min_value),
        maxValue: parseFloat(row.max_value)
      }));
      
    } catch (error) {
      logger.error('Failed to get SLO compliance stats', { error: error.message });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Save metric data point (for historical analysis)
   */
  async saveMetricDataPoint(type, value, labels, timestamp) {
    const client = await this.pool.connect();
    
    try {
      const query = `
        INSERT INTO metric_data_points (
          id, metric_type, value, labels, timestamp, created_at
        ) VALUES ($1, $2, $3, $4, $5, NOW())
        RETURNING id
      `;
      
      const dataPointId = require('crypto').randomUUID();
      const result = await client.query(query, [
        dataPointId,
        type,
        value,
        JSON.stringify(labels),
        new Date(timestamp).toISOString()
      ]);
      
      return result.rows[0].id;
      
    } catch (error) {
      logger.error('Failed to save metric data point', { error: error.message });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get metric data points for analysis
   */
  async getMetricDataPoints(type, startDate, endDate, labels = {}, limit = 1000) {
    const client = await this.pool.connect();
    
    try {
      let query = `
        SELECT id, metric_type, value, labels, timestamp, created_at
        FROM metric_data_points
        WHERE metric_type = $1 AND timestamp >= $2 AND timestamp <= $3
      `;
      
      const params = [type, startDate, endDate];
      
      // Add label filtering if provided
      if (Object.keys(labels).length > 0) {
        query += ' AND labels @> $4';
        params.push(JSON.stringify(labels));
        query += ' ORDER BY timestamp DESC LIMIT $5';
        params.push(limit);
      } else {
        query += ' ORDER BY timestamp DESC LIMIT $4';
        params.push(limit);
      }
      
      const result = await client.query(query, params);
      
      return result.rows.map(row => ({
        id: row.id,
        metricType: row.metric_type,
        value: row.value,
        labels: row.labels,
        timestamp: row.timestamp,
        createdAt: row.created_at
      }));
      
    } catch (error) {
      logger.error('Failed to get metric data points', { error: error.message });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Clean up old data points (for maintenance)
   */
  async cleanupOldData(retentionDays = 30) {
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');
      
      const cutoffDate = new Date(Date.now() - (retentionDays * 24 * 60 * 60 * 1000));
      
      // Clean up old metric data points
      const metricResult = await client.query(
        'DELETE FROM metric_data_points WHERE created_at < $1',
        [cutoffDate]
      );
      
      // Clean up old quality reports
      const reportResult = await client.query(
        'DELETE FROM quality_reports WHERE created_at < $1',
        [cutoffDate]
      );
      
      // Clean up old SLO violations
      const violationResult = await client.query(
        'DELETE FROM slo_violations WHERE created_at < $1',
        [cutoffDate]
      );
      
      await client.query('COMMIT');
      
      logger.info('Cleaned up old quality data', {
        metricDataPoints: metricResult.rowCount,
        qualityReports: reportResult.rowCount,
        sloViolations: violationResult.rowCount,
        retentionDays
      });
      
      return {
        metricDataPoints: metricResult.rowCount,
        qualityReports: reportResult.rowCount,
        sloViolations: violationResult.rowCount
      };
      
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Failed to clean up old quality data', { error: error.message });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get quality metrics summary
   */
  async getQualityMetricsSummary(window = '24h') {
    const client = await this.pool.connect();
    
    try {
      const windowHours = window === '1h' ? 1 : window === '24h' ? 24 : 168; // 1 week default
      const startDate = new Date(Date.now() - (windowHours * 60 * 60 * 1000));
      
      // Get latest quality report
      const reportQuery = `
        SELECT metrics, slos, summary
        FROM quality_reports
        WHERE timestamp >= $1
        ORDER BY timestamp DESC
        LIMIT 1
      `;
      
      const reportResult = await client.query(reportQuery, [startDate]);
      
      // Get SLO violation count
      const violationQuery = `
        SELECT COUNT(*) as violation_count
        FROM slo_violations
        WHERE timestamp >= $1 AND is_compliant = false
      `;
      
      const violationResult = await client.query(violationQuery, [startDate]);
      
      // Get metric data point count
      const metricQuery = `
        SELECT COUNT(*) as metric_count
        FROM metric_data_points
        WHERE timestamp >= $1
      `;
      
      const metricResult = await client.query(metricQuery, [startDate]);
      
      return {
        window,
        latestReport: reportResult.rows[0] || null,
        violationCount: parseInt(violationResult.rows[0].violation_count),
        metricCount: parseInt(metricResult.rows[0].metric_count),
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      logger.error('Failed to get quality metrics summary', { error: error.message });
      throw error;
    } finally {
      client.release();
    }
  }
}

module.exports = QualityDAO;
