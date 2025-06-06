/**
 * ReportService - Service layer for report generation and management
 * Handles report scheduling, generation, and integration with data sources
 */

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const schedule = require('node-schedule');
const ReportGenerator = require('../reporting/ReportGenerator');
const DatabaseManager = require('../database/DatabaseManager');
const logger = require('../utils/logger');

class ReportService {
  constructor(databaseManager) {
    this.db = databaseManager || new DatabaseManager();
    this.generator = new ReportGenerator();
    this.scheduledJobs = new Map();
    this.reportCache = new Map();
    this.reportsDir = path.join(process.cwd(), 'exports', 'reports');
  }

  /**
   * Initialize the service
   */
  async initialize() {
    try {
      // Ensure reports directory exists
      await fs.mkdir(this.reportsDir, { recursive: true });

      // Load active scheduled reports
      await this.loadScheduledReports();

      // Load report templates
      await this.loadSystemTemplates();

      logger.info('ReportService initialized', {
        reportsDir: this.reportsDir,
        scheduledJobsCount: this.scheduledJobs.size
      });
    } catch (error) {
      logger.error('Failed to initialize ReportService', { error: error.message });
      throw error;
    }
  }

  /**
   * Create a new report definition
   */
  async createReportDefinition(definition) {
    try {
      const reportId = this.generateReportId('def');
      
      const query = `
        INSERT INTO report_definitions 
        (report_id, name, description, report_type, template_id, configuration, 
         data_sources, filters, created_by, metadata)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *
      `;

      const values = [
        reportId,
        definition.name,
        definition.description,
        definition.reportType,
        definition.templateId,
        JSON.stringify(definition.configuration || {}),
        JSON.stringify(definition.dataSources || []),
        JSON.stringify(definition.filters || {}),
        definition.createdBy,
        JSON.stringify(definition.metadata || {})
      ];

      const result = await this.db.query(query, values);
      
      logger.info('Report definition created', {
        reportId,
        name: definition.name,
        reportType: definition.reportType
      });

      return result.rows[0];
    } catch (error) {
      logger.error('Failed to create report definition', { error: error.message });
      throw error;
    }
  }

  /**
   * Schedule a report
   */
  async scheduleReport(scheduleConfig) {
    try {
      const scheduleId = this.generateReportId('sch');
      
      // Validate report definition exists
      const defQuery = 'SELECT * FROM report_definitions WHERE id = $1 AND is_active = true';
      const defResult = await this.db.query(defQuery, [scheduleConfig.reportDefinitionId]);
      
      if (defResult.rows.length === 0) {
        throw new Error('Report definition not found or inactive');
      }

      // Calculate next run time
      const nextRunAt = this.calculateNextRunTime(
        scheduleConfig.scheduleType,
        scheduleConfig.scheduleConfig
      );

      const query = `
        INSERT INTO scheduled_reports 
        (schedule_id, report_definition_id, schedule_type, schedule_config, 
         output_format, recipients, delivery_method, delivery_config, 
         next_run_at, created_by, metadata)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING *
      `;

      const values = [
        scheduleId,
        scheduleConfig.reportDefinitionId,
        scheduleConfig.scheduleType,
        JSON.stringify(scheduleConfig.scheduleConfig),
        scheduleConfig.outputFormat,
        JSON.stringify(scheduleConfig.recipients || []),
        scheduleConfig.deliveryMethod || 'download',
        JSON.stringify(scheduleConfig.deliveryConfig || {}),
        nextRunAt,
        scheduleConfig.createdBy,
        JSON.stringify(scheduleConfig.metadata || {})
      ];

      const result = await this.db.query(query, values);
      const scheduledReport = result.rows[0];

      // Create schedule job
      if (scheduleConfig.scheduleType !== 'once') {
        await this.createScheduleJob(scheduledReport);
      }

      logger.info('Report scheduled', {
        scheduleId,
        reportDefinitionId: scheduleConfig.reportDefinitionId,
        scheduleType: scheduleConfig.scheduleType,
        nextRunAt
      });

      return scheduledReport;
    } catch (error) {
      logger.error('Failed to schedule report', { error: error.message });
      throw error;
    }
  }

  /**
   * Generate a report
   */
  async generateReport(reportRequest) {
    const startTime = Date.now();
    const reportId = this.generateReportId('rpt');
    let reportHistory;

    try {
      // Create report history entry
      reportHistory = await this.createReportHistory({
        reportId,
        reportDefinitionId: reportRequest.reportDefinitionId,
        scheduleId: reportRequest.scheduleId,
        reportType: reportRequest.reportType,
        name: reportRequest.name,
        format: reportRequest.format,
        parameters: reportRequest.parameters,
        requestedBy: reportRequest.requestedBy
      });

      // Update status to generating
      await this.updateReportStatus(reportId, 'generating', { startedAt: new Date() });

      // Get report data based on type
      const reportData = await this.getReportData(
        reportRequest.reportType,
        reportRequest.parameters
      );

      // Generate report using ReportGenerator
      const result = await this.generator.generate(
        reportRequest.reportType,
        reportData,
        reportRequest.format,
        reportRequest.options
      );

      // Save report file
      const filePath = await this.saveReportFile(reportId, result);

      // Update report history
      const generationTime = Date.now() - startTime;
      await this.updateReportStatus(reportId, 'completed', {
        filePath,
        fileSize: result.buffer.length,
        generationTimeMs: generationTime,
        completedAt: new Date(),
        summary: this.generateReportSummary(reportData)
      });

      logger.info('Report generated', {
        reportId,
        format: reportRequest.format,
        generationTimeMs: generationTime,
        fileSize: result.buffer.length
      });

      return {
        reportId,
        filePath,
        format: reportRequest.format,
        contentType: result.contentType,
        size: result.buffer.length,
        generationTime
      };
    } catch (error) {
      logger.error('Failed to generate report', {
        error: error.message,
        reportId,
        reportType: reportRequest.reportType
      });

      // Update status to failed
      if (reportHistory) {
        await this.updateReportStatus(reportId, 'failed', {
          errorMessage: error.message,
          completedAt: new Date()
        });
      }

      throw error;
    }
  }

  /**
   * Get report data based on type
   */
  async getReportData(reportType, parameters = {}) {
    const dataProviders = {
      'document-analytics': this.getDocumentAnalyticsData.bind(this),
      'entity-extraction': this.getEntityExtractionData.bind(this),
      'alert-summary': this.getAlertSummaryData.bind(this),
      'search-analytics': this.getSearchAnalyticsData.bind(this),
      'user-activity': this.getUserActivityData.bind(this),
      'system-performance': this.getSystemPerformanceData.bind(this)
    };

    const provider = dataProviders[reportType];
    if (!provider) {
      throw new Error(`Unknown report type: ${reportType}`);
    }

    return await provider(parameters);
  }

  /**
   * Get document analytics data
   */
  async getDocumentAnalyticsData(parameters) {
    const { startDate, endDate, status, minQualityScore } = parameters;
    
    let query = `
      SELECT 
        d.id,
        d.title,
        d.status,
        d.quality_score as "qualityScore",
        d.created_at as "createdAt",
        d.updated_at as "updatedAt",
        COUNT(DISTINCT df.id) as "feedbackCount",
        AVG(df.rating) as "averageRating"
      FROM documents d
      LEFT JOIN document_feedback df ON d.id = df.document_id
      WHERE 1=1
    `;

    const values = [];
    let paramIndex = 1;

    if (startDate) {
      query += ` AND d.created_at >= $${paramIndex++}`;
      values.push(startDate);
    }

    if (endDate) {
      query += ` AND d.created_at <= $${paramIndex++}`;
      values.push(endDate);
    }

    if (status) {
      query += ` AND d.status = $${paramIndex++}`;
      values.push(status);
    }

    if (minQualityScore) {
      query += ` AND d.quality_score >= $${paramIndex++}`;
      values.push(minQualityScore);
    }

    query += `
      GROUP BY d.id, d.title, d.status, d.quality_score, d.created_at, d.updated_at
      ORDER BY d.created_at DESC
    `;

    const result = await this.db.query(query, values);
    return result.rows;
  }

  /**
   * Get entity extraction data
   */
  async getEntityExtractionData(parameters) {
    const { startDate, endDate, entityType, minConfidence } = parameters;
    
    let query = `
      SELECT 
        e.id,
        e.text,
        e.type,
        e.confidence,
        e.document_id as "documentId",
        e.context,
        e.extracted_at as "extractedAt",
        d.title as "documentTitle"
      FROM extracted_entities e
      JOIN documents d ON e.document_id = d.id
      WHERE 1=1
    `;

    const values = [];
    let paramIndex = 1;

    if (startDate) {
      query += ` AND e.extracted_at >= $${paramIndex++}`;
      values.push(startDate);
    }

    if (endDate) {
      query += ` AND e.extracted_at <= $${paramIndex++}`;
      values.push(endDate);
    }

    if (entityType) {
      query += ` AND e.type = $${paramIndex++}`;
      values.push(entityType);
    }

    if (minConfidence) {
      query += ` AND e.confidence >= $${paramIndex++}`;
      values.push(minConfidence);
    }

    query += ' ORDER BY e.extracted_at DESC';

    const result = await this.db.query(query, values);
    return result.rows;
  }

  /**
   * Get alert summary data
   */
  async getAlertSummaryData(parameters) {
    const { startDate, endDate, severity, status } = parameters;
    
    let query = `
      SELECT 
        a.id,
        a.type,
        a.severity,
        a.status,
        a.message,
        a.created_at as "createdAt",
        a.resolved_at as "resolvedAt",
        a.metadata
      FROM alerts a
      WHERE 1=1
    `;

    const values = [];
    let paramIndex = 1;

    if (startDate) {
      query += ` AND a.created_at >= $${paramIndex++}`;
      values.push(startDate);
    }

    if (endDate) {
      query += ` AND a.created_at <= $${paramIndex++}`;
      values.push(endDate);
    }

    if (severity) {
      query += ` AND a.severity = $${paramIndex++}`;
      values.push(severity);
    }

    if (status) {
      query += ` AND a.status = $${paramIndex++}`;
      values.push(status);
    }

    query += ' ORDER BY a.created_at DESC';

    const result = await this.db.query(query, values);
    return result.rows;
  }

  /**
   * Get search analytics data
   */
  async getSearchAnalyticsData(parameters) {
    const { startDate, endDate, minResultCount } = parameters;
    
    let query = `
      SELECT 
        s.id,
        s.query,
        s.result_count as "resultCount",
        s.response_time as "responseTime",
        s.successful,
        s.user_id as "userId",
        s.timestamp,
        s.metadata
      FROM search_logs s
      WHERE 1=1
    `;

    const values = [];
    let paramIndex = 1;

    if (startDate) {
      query += ` AND s.timestamp >= $${paramIndex++}`;
      values.push(startDate);
    }

    if (endDate) {
      query += ` AND s.timestamp <= $${paramIndex++}`;
      values.push(endDate);
    }

    if (minResultCount !== undefined) {
      query += ` AND s.result_count >= $${paramIndex++}`;
      values.push(minResultCount);
    }

    query += ' ORDER BY s.timestamp DESC';

    const result = await this.db.query(query, values);
    return result.rows;
  }

  /**
   * Get user activity data
   */
  async getUserActivityData(parameters) {
    const { startDate, endDate, userId, activityType } = parameters;
    
    let query = `
      SELECT 
        al.id,
        al.user_id as "userId",
        al.operation as "activityType",
        al.table_name as "resourceType",
        al.record_id as "resourceId",
        al.timestamp,
        al.ip_address as "ipAddress",
        al.session_id as "sessionId",
        EXTRACT(EPOCH FROM (
          LEAD(al.timestamp) OVER (PARTITION BY al.session_id ORDER BY al.timestamp) - al.timestamp
        )) as "sessionDuration"
      FROM audit_logs al
      WHERE 1=1
    `;

    const values = [];
    let paramIndex = 1;

    if (startDate) {
      query += ` AND al.timestamp >= $${paramIndex++}`;
      values.push(startDate);
    }

    if (endDate) {
      query += ` AND al.timestamp <= $${paramIndex++}`;
      values.push(endDate);
    }

    if (userId) {
      query += ` AND al.user_id = $${paramIndex++}`;
      values.push(userId);
    }

    if (activityType) {
      query += ` AND al.operation = $${paramIndex++}`;
      values.push(activityType);
    }

    query += ' ORDER BY al.timestamp DESC';

    const result = await this.db.query(query, values);
    return result.rows;
  }

  /**
   * Get system performance data
   */
  async getSystemPerformanceData(parameters) {
    const { startDate, endDate, metricType } = parameters;
    
    let query = `
      SELECT 
        m.id,
        m.metric_type as "metricType",
        m.value,
        m.timestamp,
        m.cpu_usage as "cpuUsage",
        m.memory_usage as "memoryUsage",
        m.response_time as "responseTime",
        m.error_count > 0 as "hasError",
        m.status,
        m.metadata
      FROM system_metrics m
      WHERE 1=1
    `;

    const values = [];
    let paramIndex = 1;

    if (startDate) {
      query += ` AND m.timestamp >= $${paramIndex++}`;
      values.push(startDate);
    }

    if (endDate) {
      query += ` AND m.timestamp <= $${paramIndex++}`;
      values.push(endDate);
    }

    if (metricType) {
      query += ` AND m.metric_type = $${paramIndex++}`;
      values.push(metricType);
    }

    query += ' ORDER BY m.timestamp DESC';

    const result = await this.db.query(query, values);
    return result.rows;
  }

  /**
   * Save report file
   */
  async saveReportFile(reportId, result) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${reportId}_${timestamp}.${result.extension}`;
    const filePath = path.join(this.reportsDir, filename);

    await fs.writeFile(filePath, result.buffer);

    return filePath;
  }

  /**
   * Get report by ID
   */
  async getReport(reportId) {
    const query = 'SELECT * FROM report_history WHERE report_id = $1';
    const result = await this.db.query(query, [reportId]);

    if (result.rows.length === 0) {
      throw new Error('Report not found');
    }

    return result.rows[0];
  }

  /**
   * Get report file
   */
  async getReportFile(reportId) {
    const report = await this.getReport(reportId);

    if (!report.file_path || report.status !== 'completed') {
      throw new Error('Report file not available');
    }

    // Check if file exists
    try {
      await fs.access(report.file_path);
    } catch (error) {
      throw new Error('Report file not found');
    }

    // Update download count
    await this.incrementDownloadCount(reportId);

    // Read file
    const buffer = await fs.readFile(report.file_path);

    return {
      buffer,
      filename: path.basename(report.file_path),
      contentType: this.getContentType(report.format)
    };
  }

  /**
   * List reports
   */
  async listReports(filters = {}) {
    let query = `
      SELECT 
        rh.*,
        rd.name as definition_name,
        rd.report_type as definition_type
      FROM report_history rh
      LEFT JOIN report_definitions rd ON rh.report_definition_id = rd.id
      WHERE 1=1
    `;

    const values = [];
    let paramIndex = 1;

    if (filters.status) {
      query += ` AND rh.status = $${paramIndex++}`;
      values.push(filters.status);
    }

    if (filters.reportType) {
      query += ` AND rh.report_type = $${paramIndex++}`;
      values.push(filters.reportType);
    }

    if (filters.requestedBy) {
      query += ` AND rh.requested_by = $${paramIndex++}`;
      values.push(filters.requestedBy);
    }

    if (filters.startDate) {
      query += ` AND rh.requested_at >= $${paramIndex++}`;
      values.push(filters.startDate);
    }

    if (filters.endDate) {
      query += ` AND rh.requested_at <= $${paramIndex++}`;
      values.push(filters.endDate);
    }

    query += ' ORDER BY rh.requested_at DESC';

    if (filters.limit) {
      query += ` LIMIT $${paramIndex++}`;
      values.push(filters.limit);
    }

    if (filters.offset) {
      query += ` OFFSET $${paramIndex++}`;
      values.push(filters.offset);
    }

    const result = await this.db.query(query, values);
    return result.rows;
  }

  /**
   * Delete old reports
   */
  async cleanupOldReports(retentionDays = 30) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

      // Get reports to delete
      const query = `
        SELECT report_id, file_path 
        FROM report_history 
        WHERE requested_at < $1 AND status = 'completed'
      `;
      const result = await this.db.query(query, [cutoffDate]);

      let deletedCount = 0;
      for (const report of result.rows) {
        try {
          // Delete file if exists
          if (report.file_path) {
            await fs.unlink(report.file_path).catch(() => {});
          }

          // Delete database record
          await this.db.query(
            'DELETE FROM report_history WHERE report_id = $1',
            [report.report_id]
          );

          deletedCount++;
        } catch (error) {
          logger.error('Failed to delete report', {
            error: error.message,
            reportId: report.report_id
          });
        }
      }

      logger.info('Old reports cleaned up', {
        deletedCount,
        retentionDays,
        cutoffDate
      });

      return deletedCount;
    } catch (error) {
      logger.error('Failed to cleanup old reports', { error: error.message });
      throw error;
    }
  }

  /**
   * Helper methods
   */
  generateReportId(prefix) {
    const timestamp = Date.now().toString(36);
    const random = crypto.randomBytes(4).toString('hex');
    return `${prefix}_${timestamp}_${random}`;
  }

  calculateNextRunTime(scheduleType, scheduleConfig) {
    const now = new Date();

    switch (scheduleType) {
    case 'once':
      return scheduleConfig.runAt || now;
      
    case 'daily': {
      const daily = new Date(now);
      daily.setDate(daily.getDate() + 1);
      daily.setHours(scheduleConfig.hour || 0, scheduleConfig.minute || 0, 0, 0);
      return daily;
    }
      
    case 'weekly': {
      const weekly = new Date(now);
      const daysUntilTarget = (scheduleConfig.dayOfWeek - weekly.getDay() + 7) % 7 || 7;
      weekly.setDate(weekly.getDate() + daysUntilTarget);
      weekly.setHours(scheduleConfig.hour || 0, scheduleConfig.minute || 0, 0, 0);
      return weekly;
    }
      
    case 'monthly': {
      const monthly = new Date(now);
      monthly.setMonth(monthly.getMonth() + 1);
      monthly.setDate(scheduleConfig.dayOfMonth || 1);
      monthly.setHours(scheduleConfig.hour || 0, scheduleConfig.minute || 0, 0, 0);
      return monthly;
    }
      
    case 'custom': {
      // Use cron expression
      const job = schedule.scheduleJob(scheduleConfig.cron, () => {});
      const nextRun = job.nextInvocation();
      job.cancel();
      return nextRun;
    }
      
    default:
      throw new Error(`Unknown schedule type: ${scheduleType}`);
    }
  }

  async createScheduleJob(scheduledReport) {
    const jobFunction = async () => {
      try {
        logger.info('Running scheduled report', {
          scheduleId: scheduledReport.schedule_id,
          reportDefinitionId: scheduledReport.report_definition_id
        });

        // Get report definition
        const defQuery = 'SELECT * FROM report_definitions WHERE id = $1';
        const defResult = await this.db.query(defQuery, [scheduledReport.report_definition_id]);
        const definition = defResult.rows[0];

        // Generate report
        const report = await this.generateReport({
          reportDefinitionId: scheduledReport.report_definition_id,
          scheduleId: scheduledReport.schedule_id,
          reportType: definition.report_type,
          name: definition.name,
          format: scheduledReport.output_format,
          parameters: definition.filters,
          requestedBy: 'scheduler'
        });

        // Handle delivery
        await this.deliverReport(report, scheduledReport);

        // Update last run and calculate next run
        const nextRunAt = this.calculateNextRunTime(
          scheduledReport.schedule_type,
          scheduledReport.schedule_config
        );

        await this.db.query(
          'UPDATE scheduled_reports SET last_run_at = $1, next_run_at = $2 WHERE schedule_id = $3',
          [new Date(), nextRunAt, scheduledReport.schedule_id]
        );

      } catch (error) {
        logger.error('Failed to run scheduled report', {
          error: error.message,
          scheduleId: scheduledReport.schedule_id
        });
      }
    };

    let job;
    switch (scheduledReport.schedule_type) {
    case 'daily':
    case 'weekly':
    case 'monthly': {
      const cronExpression = this.buildCronExpression(
        scheduledReport.schedule_type,
        scheduledReport.schedule_config
      );
      job = schedule.scheduleJob(cronExpression, jobFunction);
      break;
    }
      
    case 'custom':
      job = schedule.scheduleJob(scheduledReport.schedule_config.cron, jobFunction);
      break;
    }

    if (job) {
      this.scheduledJobs.set(scheduledReport.schedule_id, job);
    }
  }

  buildCronExpression(scheduleType, config) {
    const minute = config.minute || 0;
    const hour = config.hour || 0;

    switch (scheduleType) {
    case 'daily':
      return `${minute} ${hour} * * *`;
      
    case 'weekly':
      return `${minute} ${hour} * * ${config.dayOfWeek || 0}`;
      
    case 'monthly':
      return `${minute} ${hour} ${config.dayOfMonth || 1} * *`;
      
    default:
      throw new Error(`Cannot build cron for schedule type: ${scheduleType}`);
    }
  }

  async deliverReport(report, scheduledReport) {
    switch (scheduledReport.delivery_method) {
    case 'email':
      // TODO: Implement email delivery
      logger.info('Email delivery not implemented', { reportId: report.reportId });
      break;
      
    case 'webhook':
      // TODO: Implement webhook delivery
      logger.info('Webhook delivery not implemented', { reportId: report.reportId });
      break;
      
    case 'storage':
      // Already saved to storage
      break;
      
    case 'download':
    default:
      // No additional delivery needed
      break;
    }
  }

  async loadScheduledReports() {
    try {
      const query = `
        SELECT sr.*, rd.report_type, rd.name as report_name
        FROM scheduled_reports sr
        JOIN report_definitions rd ON sr.report_definition_id = rd.id
        WHERE sr.is_active = true AND sr.schedule_type != 'once'
      `;
      const result = await this.db.query(query);

      for (const scheduledReport of result.rows) {
        await this.createScheduleJob(scheduledReport);
      }

      logger.info('Loaded scheduled reports', { count: result.rows.length });
    } catch (error) {
      logger.error('Failed to load scheduled reports', { error: error.message });
    }
  }

  async loadSystemTemplates() {
    try {
      const templatesDir = path.join(__dirname, '..', 'reporting', 'templates');
      const files = await fs.readdir(templatesDir);

      for (const file of files) {
        if (file.endsWith('.hbs')) {
          const templatePath = path.join(templatesDir, file);
          await this.generator.loadTemplate(templatePath);
        }
      }

      logger.info('Loaded system templates', { count: files.length });
    } catch (error) {
      logger.error('Failed to load system templates', { error: error.message });
    }
  }

  async createReportHistory(data) {
    const query = `
      INSERT INTO report_history 
      (report_id, report_definition_id, schedule_id, report_type, name, 
       format, status, parameters, requested_by, requested_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `;

    const values = [
      data.reportId,
      data.reportDefinitionId,
      data.scheduleId,
      data.reportType,
      data.name,
      data.format,
      'pending',
      JSON.stringify(data.parameters || {}),
      data.requestedBy,
      new Date()
    ];

    const result = await this.db.query(query, values);
    return result.rows[0];
  }

  async updateReportStatus(reportId, status, updates = {}) {
    let query = 'UPDATE report_history SET status = $1';
    const values = [status];
    let paramIndex = 2;

    const updateFields = [
      'filePath', 'fileSize', 'generationTimeMs', 'summary',
      'errorMessage', 'startedAt', 'completedAt'
    ];

    updateFields.forEach(field => {
      if (updates[field] !== undefined) {
        const snakeCase = field.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
        query += `, ${snakeCase} = $${paramIndex++}`;
        values.push(field === 'summary' ? JSON.stringify(updates[field]) : updates[field]);
      }
    });

    query += ` WHERE report_id = $${paramIndex}`;
    values.push(reportId);

    await this.db.query(query, values);
  }

  generateReportSummary(data) {
    return {
      recordCount: Array.isArray(data) ? data.length : 0,
      generatedAt: new Date(),
      dataKeys: Array.isArray(data) && data.length > 0 ? Object.keys(data[0]) : []
    };
  }

  async incrementDownloadCount(reportId) {
    const query = `
      UPDATE report_history 
      SET download_count = download_count + 1, 
          last_downloaded_at = $1 
      WHERE report_id = $2
    `;
    await this.db.query(query, [new Date(), reportId]);
  }

  getContentType(format) {
    const contentTypes = {
      pdf: 'application/pdf',
      csv: 'text/csv',
      excel: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      json: 'application/json',
      html: 'text/html'
    };
    return contentTypes[format] || 'application/octet-stream';
  }
}

module.exports = ReportService;