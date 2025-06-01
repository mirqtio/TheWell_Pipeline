const { Pool } = require('pg');
const logger = require('../utils/logger');

/**
 * Data Access Object for cost tracking operations
 * Handles database persistence for cost events, budgets, alerts, and reports
 */
class CostDAO {
  constructor(config = {}) {
    this.config = {
      connectionString: process.env.DATABASE_URL,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
      ...config
    };
    
    this.pool = new Pool(this.config);
    this.isConnected = false;
  }

  /**
   * Initialize database connection
   */
  async initialize() {
    try {
      const client = await this.pool.connect();
      await client.query('SELECT 1');
      client.release();
      this.isConnected = true;
      logger.info('CostDAO: Database connection established');
    } catch (error) {
      logger.error('CostDAO: Failed to initialize database connection', { error: error.message });
      throw error;
    }
  }

  /**
   * Close database connection
   */
  async close() {
    try {
      await this.pool.end();
      this.isConnected = false;
      logger.info('CostDAO: Database connection closed');
    } catch (error) {
      logger.error('CostDAO: Error closing database connection', { error: error.message });
    }
  }

  /**
   * Save a cost event to the database
   */
  async saveCostEvent(costEvent) {
    const query = `
      INSERT INTO cost_events (
        provider, model, operation, document_id, source_type,
        input_tokens, output_tokens, input_cost, output_cost, total_cost, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING id, created_at
    `;
    
    const values = [
      costEvent.provider,
      costEvent.model,
      costEvent.operation,
      costEvent.documentId || null,
      costEvent.sourceType || null,
      costEvent.inputTokens,
      costEvent.outputTokens,
      costEvent.inputCost,
      costEvent.outputCost,
      costEvent.totalCost,
      JSON.stringify(costEvent.metadata || {})
    ];

    try {
      const result = await this.pool.query(query, values);
      const savedEvent = {
        ...costEvent,
        id: result.rows[0].id,
        timestamp: result.rows[0].created_at
      };
      
      logger.debug('CostDAO: Cost event saved', { 
        id: savedEvent.id, 
        provider: savedEvent.provider,
        cost: savedEvent.totalCost 
      });
      
      return savedEvent;
    } catch (error) {
      logger.error('CostDAO: Failed to save cost event', { 
        error: error.message,
        costEvent 
      });
      throw error;
    }
  }

  /**
   * Get cost events within a date range
   */
  async getCostEvents(startDate, endDate, filters = {}) {
    let query = `
      SELECT * FROM cost_events 
      WHERE created_at >= $1 AND created_at <= $2
    `;
    
    const values = [startDate, endDate];
    let paramIndex = 3;

    // Add filters
    if (filters.provider) {
      query += ` AND provider = $${paramIndex}`;
      values.push(filters.provider);
      paramIndex++;
    }
    
    if (filters.model) {
      query += ` AND model = $${paramIndex}`;
      values.push(filters.model);
      paramIndex++;
    }
    
    if (filters.operation) {
      query += ` AND operation = $${paramIndex}`;
      values.push(filters.operation);
      paramIndex++;
    }
    
    if (filters.sourceType) {
      query += ` AND source_type = $${paramIndex}`;
      values.push(filters.sourceType);
      paramIndex++;
    }

    query += ' ORDER BY created_at DESC';

    try {
      const result = await this.pool.query(query, values);
      return result.rows.map(row => ({
        id: row.id,
        provider: row.provider,
        model: row.model,
        operation: row.operation,
        documentId: row.document_id,
        sourceType: row.source_type,
        inputTokens: row.input_tokens,
        outputTokens: row.output_tokens,
        inputCost: parseFloat(row.input_cost),
        outputCost: parseFloat(row.output_cost),
        totalCost: parseFloat(row.total_cost),
        metadata: row.metadata,
        timestamp: row.created_at
      }));
    } catch (error) {
      logger.error('CostDAO: Failed to get cost events', { 
        error: error.message,
        startDate,
        endDate,
        filters 
      });
      throw error;
    }
  }

  /**
   * Get cost summary for a date range
   */
  async getCostSummary(startDate, endDate, groupBy = 'provider') {
    const validGroupBy = ['provider', 'model', 'operation', 'source_type'];
    if (!validGroupBy.includes(groupBy)) {
      throw new Error(`Invalid groupBy parameter: ${groupBy}`);
    }

    const query = `
      SELECT 
        ${groupBy},
        COUNT(*) as event_count,
        SUM(input_tokens) as total_input_tokens,
        SUM(output_tokens) as total_output_tokens,
        SUM(total_cost) as total_cost,
        AVG(total_cost) as avg_cost,
        MIN(created_at) as first_event,
        MAX(created_at) as last_event
      FROM cost_events 
      WHERE created_at >= $1 AND created_at <= $2
      GROUP BY ${groupBy}
      ORDER BY total_cost DESC
    `;

    try {
      const result = await this.pool.query(query, [startDate, endDate]);
      return result.rows.map(row => ({
        [groupBy]: row[groupBy],
        eventCount: parseInt(row.event_count),
        totalInputTokens: parseInt(row.total_input_tokens) || 0,
        totalOutputTokens: parseInt(row.total_output_tokens) || 0,
        totalCost: parseFloat(row.total_cost) || 0,
        avgCost: parseFloat(row.avg_cost) || 0,
        firstEvent: row.first_event,
        lastEvent: row.last_event
      }));
    } catch (error) {
      logger.error('CostDAO: Failed to get cost summary', { 
        error: error.message,
        startDate,
        endDate,
        groupBy 
      });
      throw error;
    }
  }

  /**
   * Get active cost budgets
   */
  async getActiveBudgets() {
    const query = `
      SELECT * FROM cost_budgets 
      WHERE is_active = true 
      ORDER BY budget_type, name
    `;

    try {
      const result = await this.pool.query(query);
      return result.rows.map(row => ({
        id: row.id,
        name: row.name,
        budgetType: row.budget_type,
        limitAmount: parseFloat(row.limit_amount),
        alertThreshold: parseFloat(row.alert_threshold),
        providerFilter: row.provider_filter,
        operationFilter: row.operation_filter,
        sourceTypeFilter: row.source_type_filter,
        isActive: row.is_active,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }));
    } catch (error) {
      logger.error('CostDAO: Failed to get active budgets', { error: error.message });
      throw error;
    }
  }

  /**
   * Save a cost alert
   */
  async saveCostAlert(alert) {
    const query = `
      INSERT INTO cost_alerts (
        budget_id, alert_type, current_amount, limit_amount, percentage,
        period_start, period_end, message
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id, created_at
    `;
    
    const values = [
      alert.budgetId,
      alert.alertType,
      alert.currentAmount,
      alert.limitAmount,
      alert.percentage,
      alert.periodStart,
      alert.periodEnd,
      alert.message
    ];

    try {
      const result = await this.pool.query(query, values);
      return {
        ...alert,
        id: result.rows[0].id,
        createdAt: result.rows[0].created_at
      };
    } catch (error) {
      logger.error('CostDAO: Failed to save cost alert', { 
        error: error.message,
        alert 
      });
      throw error;
    }
  }

  /**
   * Save a cost report
   */
  async saveCostReport(report) {
    const query = `
      INSERT INTO cost_reports (
        report_name, report_type, date_range_start, date_range_end,
        total_cost, total_tokens, record_count, report_data, format, generated_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id, created_at
    `;
    
    const values = [
      report.reportName,
      report.reportType,
      report.dateRangeStart,
      report.dateRangeEnd,
      report.totalCost,
      report.totalTokens,
      report.recordCount,
      JSON.stringify(report.reportData),
      report.format || 'json',
      report.generatedBy || 'system'
    ];

    try {
      const result = await this.pool.query(query, values);
      return {
        ...report,
        id: result.rows[0].id,
        createdAt: result.rows[0].created_at
      };
    } catch (error) {
      logger.error('CostDAO: Failed to save cost report', { 
        error: error.message,
        report 
      });
      throw error;
    }
  }

  /**
   * Clean up old cost events based on retention policy
   */
  async cleanupOldEvents(retentionDays = 90) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const query = `
      DELETE FROM cost_events 
      WHERE created_at < $1
    `;

    try {
      const result = await this.pool.query(query, [cutoffDate]);
      const deletedCount = result.rowCount;
      
      logger.info('CostDAO: Cleaned up old cost events', { 
        deletedCount,
        cutoffDate,
        retentionDays 
      });
      
      return deletedCount;
    } catch (error) {
      logger.error('CostDAO: Failed to cleanup old events', { 
        error: error.message,
        retentionDays 
      });
      throw error;
    }
  }

  /**
   * Get budget spending for current period
   */
  async getBudgetSpending(budgetId, periodStart, periodEnd) {
    const query = `
      SELECT 
        COALESCE(SUM(ce.total_cost), 0) as current_spending,
        COUNT(ce.id) as event_count
      FROM cost_budgets cb
      LEFT JOIN cost_events ce ON (
        ce.created_at >= $2 AND ce.created_at <= $3
        AND (cb.provider_filter IS NULL OR ce.provider = cb.provider_filter)
        AND (cb.operation_filter IS NULL OR ce.operation = cb.operation_filter)
        AND (cb.source_type_filter IS NULL OR ce.source_type = cb.source_type_filter)
      )
      WHERE cb.id = $1
      GROUP BY cb.id
    `;

    try {
      const result = await this.pool.query(query, [budgetId, periodStart, periodEnd]);
      if (result.rows.length === 0) {
        return { currentSpending: 0, eventCount: 0 };
      }
      
      return {
        currentSpending: parseFloat(result.rows[0].current_spending),
        eventCount: parseInt(result.rows[0].event_count)
      };
    } catch (error) {
      logger.error('CostDAO: Failed to get budget spending', { 
        error: error.message,
        budgetId,
        periodStart,
        periodEnd 
      });
      throw error;
    }
  }
}

module.exports = CostDAO;
