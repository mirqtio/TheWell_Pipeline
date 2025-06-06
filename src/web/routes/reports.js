/**
 * Report generation and management routes
 */

const express = require('express');
const router = express.Router();
const ReportService = require('../../services/ReportService');
const AuditService = require('../../services/AuditService');
const { auth, checkPermission } = require('../middleware/auth');
const logger = require('../../utils/logger');

// Initialize services
let reportService;
let auditService;

/**
 * Initialize route with dependencies
 */
function initializeRoute(databaseManager, ormManager) {
  reportService = new ReportService(databaseManager);
  auditService = new AuditService(ormManager);
  
  // Initialize report service
  reportService.initialize().catch(error => {
    logger.error('Failed to initialize ReportService', { error: error.message });
  });

  return router;
}

/**
 * @swagger
 * /api/reports/definitions:
 *   post:
 *     summary: Create a new report definition
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - reportType
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               reportType:
 *                 type: string
 *                 enum: [document-analytics, entity-extraction, alert-summary, search-analytics, user-activity, system-performance]
 *               templateId:
 *                 type: string
 *               configuration:
 *                 type: object
 *               dataSources:
 *                 type: array
 *               filters:
 *                 type: object
 *     responses:
 *       201:
 *         description: Report definition created
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Unauthorized
 */
router.post('/definitions', auth, checkPermission('reports:create'), async (req, res, next) => {
  try {
    const { name, description, reportType, templateId, configuration, dataSources, filters } = req.body;

    if (!name || !reportType) {
      return res.status(400).json({ error: 'Name and report type are required' });
    }

    const definition = await reportService.createReportDefinition({
      name,
      description,
      reportType,
      templateId,
      configuration,
      dataSources,
      filters,
      createdBy: req.user.id,
      metadata: {
        userAgent: req.headers['user-agent'],
        ipAddress: req.ip
      }
    });

    // Log action
    await auditService.logAction({
      action: 'report_definition_created',
      entityType: 'report_definition',
      entityId: definition.report_id,
      userId: req.user.id,
      details: { name, reportType }
    });

    res.status(201).json({
      success: true,
      definition
    });
  } catch (error) {
    logger.error('Failed to create report definition', {
      error: error.message,
      userId: req.user.id
    });
    next(error);
  }
});

/**
 * @swagger
 * /api/reports/definitions:
 *   get:
 *     summary: List report definitions
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: reportType
 *         schema:
 *           type: string
 *       - in: query
 *         name: isActive
 *         schema:
 *           type: boolean
 *     responses:
 *       200:
 *         description: List of report definitions
 */
router.get('/definitions', auth, checkPermission('reports:read'), async (req, res, next) => {
  try {
    const { reportType, isActive } = req.query;

    let query = 'SELECT * FROM report_definitions WHERE 1=1';
    const values = [];
    let paramIndex = 1;

    if (reportType) {
      query += ` AND report_type = $${paramIndex++}`;
      values.push(reportType);
    }

    if (isActive !== undefined) {
      query += ` AND is_active = $${paramIndex++}`;
      values.push(isActive === 'true');
    }

    query += ' ORDER BY created_at DESC';

    const result = await reportService.db.query(query, values);

    res.json({
      success: true,
      definitions: result.rows,
      total: result.rows.length
    });
  } catch (error) {
    logger.error('Failed to list report definitions', { error: error.message });
    next(error);
  }
});

/**
 * @swagger
 * /api/reports/generate:
 *   post:
 *     summary: Generate a report
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - reportType
 *               - format
 *             properties:
 *               reportType:
 *                 type: string
 *               name:
 *                 type: string
 *               format:
 *                 type: string
 *                 enum: [pdf, csv, excel, json, html]
 *               parameters:
 *                 type: object
 *               options:
 *                 type: object
 *     responses:
 *       200:
 *         description: Report generated
 *       400:
 *         description: Invalid request
 */
router.post('/generate', auth, checkPermission('reports:generate'), async (req, res, next) => {
  try {
    const { reportType, name, format, parameters, options } = req.body;

    if (!reportType || !format) {
      return res.status(400).json({ error: 'Report type and format are required' });
    }

    const report = await reportService.generateReport({
      reportType,
      name: name || `${reportType} Report`,
      format,
      parameters: parameters || {},
      options: options || {},
      requestedBy: req.user.id
    });

    // Log action
    await auditService.logAction({
      action: 'report_generated',
      entityType: 'report',
      entityId: report.reportId,
      userId: req.user.id,
      details: { reportType, format }
    });

    res.json({
      success: true,
      report: {
        reportId: report.reportId,
        format: report.format,
        size: report.size,
        generationTime: report.generationTime
      }
    });
  } catch (error) {
    logger.error('Failed to generate report', {
      error: error.message,
      userId: req.user.id,
      reportType: req.body.reportType
    });
    next(error);
  }
});

/**
 * @swagger
 * /api/reports/schedule:
 *   post:
 *     summary: Schedule a report
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - reportDefinitionId
 *               - scheduleType
 *               - outputFormat
 *             properties:
 *               reportDefinitionId:
 *                 type: integer
 *               scheduleType:
 *                 type: string
 *                 enum: [once, daily, weekly, monthly, custom]
 *               scheduleConfig:
 *                 type: object
 *               outputFormat:
 *                 type: string
 *               recipients:
 *                 type: array
 *               deliveryMethod:
 *                 type: string
 *     responses:
 *       201:
 *         description: Report scheduled
 */
router.post('/schedule', auth, checkPermission('reports:schedule'), async (req, res, next) => {
  try {
    const {
      reportDefinitionId,
      scheduleType,
      scheduleConfig,
      outputFormat,
      recipients,
      deliveryMethod,
      deliveryConfig
    } = req.body;

    if (!reportDefinitionId || !scheduleType || !outputFormat) {
      return res.status(400).json({
        error: 'Report definition ID, schedule type, and output format are required'
      });
    }

    const scheduledReport = await reportService.scheduleReport({
      reportDefinitionId,
      scheduleType,
      scheduleConfig: scheduleConfig || {},
      outputFormat,
      recipients,
      deliveryMethod,
      deliveryConfig,
      createdBy: req.user.id
    });

    // Log action
    await auditService.logAction({
      action: 'report_scheduled',
      entityType: 'scheduled_report',
      entityId: scheduledReport.schedule_id,
      userId: req.user.id,
      details: { reportDefinitionId, scheduleType, outputFormat }
    });

    res.status(201).json({
      success: true,
      scheduledReport
    });
  } catch (error) {
    logger.error('Failed to schedule report', {
      error: error.message,
      userId: req.user.id
    });
    next(error);
  }
});

/**
 * @swagger
 * /api/reports/scheduled:
 *   get:
 *     summary: List scheduled reports
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: isActive
 *         schema:
 *           type: boolean
 *     responses:
 *       200:
 *         description: List of scheduled reports
 */
router.get('/scheduled', auth, checkPermission('reports:read'), async (req, res, next) => {
  try {
    const { isActive } = req.query;

    let query = `
      SELECT sr.*, rd.name as report_name, rd.report_type
      FROM scheduled_reports sr
      JOIN report_definitions rd ON sr.report_definition_id = rd.id
      WHERE 1=1
    `;
    const values = [];
    let paramIndex = 1;

    if (isActive !== undefined) {
      query += ` AND sr.is_active = $${paramIndex++}`;
      values.push(isActive === 'true');
    }

    query += ' ORDER BY sr.created_at DESC';

    const result = await reportService.db.query(query, values);

    res.json({
      success: true,
      scheduledReports: result.rows,
      total: result.rows.length
    });
  } catch (error) {
    logger.error('Failed to list scheduled reports', { error: error.message });
    next(error);
  }
});

/**
 * @swagger
 * /api/reports/history:
 *   get:
 *     summary: Get report history
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *       - in: query
 *         name: reportType
 *         schema:
 *           type: string
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Report history
 */
router.get('/history', auth, checkPermission('reports:read'), async (req, res, next) => {
  try {
    const { status, reportType, limit = 50, offset = 0 } = req.query;

    const reports = await reportService.listReports({
      status,
      reportType,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    res.json({
      success: true,
      reports,
      total: reports.length
    });
  } catch (error) {
    logger.error('Failed to get report history', { error: error.message });
    next(error);
  }
});

/**
 * @swagger
 * /api/reports/{reportId}:
 *   get:
 *     summary: Get report details
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: reportId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Report details
 *       404:
 *         description: Report not found
 */
router.get('/:reportId', auth, checkPermission('reports:read'), async (req, res, next) => {
  try {
    const { reportId } = req.params;
    const report = await reportService.getReport(reportId);

    // Log access
    await auditService.logAction({
      action: 'report_viewed',
      entityType: 'report',
      entityId: reportId,
      userId: req.user.id
    });

    res.json({
      success: true,
      report
    });
  } catch (error) {
    if (error.message === 'Report not found') {
      return res.status(404).json({ error: 'Report not found' });
    }
    logger.error('Failed to get report', {
      error: error.message,
      reportId: req.params.reportId
    });
    next(error);
  }
});

/**
 * @swagger
 * /api/reports/{reportId}/download:
 *   get:
 *     summary: Download a report
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: reportId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Report file
 *         content:
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
 *       404:
 *         description: Report not found
 */
router.get('/:reportId/download', auth, checkPermission('reports:download'), async (req, res, next) => {
  try {
    const { reportId } = req.params;
    const file = await reportService.getReportFile(reportId);

    // Log download
    await auditService.logAction({
      action: 'report_downloaded',
      entityType: 'report',
      entityId: reportId,
      userId: req.user.id
    });

    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.setHeader('Content-Length', file.buffer.length);
    res.send(file.buffer);
  } catch (error) {
    if (error.message === 'Report not found' || error.message === 'Report file not available') {
      return res.status(404).json({ error: error.message });
    }
    logger.error('Failed to download report', {
      error: error.message,
      reportId: req.params.reportId
    });
    next(error);
  }
});

/**
 * @swagger
 * /api/reports/{reportId}:
 *   delete:
 *     summary: Delete a report
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: reportId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Report deleted
 *       404:
 *         description: Report not found
 */
router.delete('/:reportId', auth, checkPermission('reports:delete'), async (req, res, next) => {
  try {
    const { reportId } = req.params;

    // Get report details first
    const report = await reportService.getReport(reportId);

    // Delete file if exists
    if (report.file_path) {
      await require('fs').promises.unlink(report.file_path).catch(() => {});
    }

    // Delete database record
    await reportService.db.query(
      'DELETE FROM report_history WHERE report_id = $1',
      [reportId]
    );

    // Log deletion
    await auditService.logAction({
      action: 'report_deleted',
      entityType: 'report',
      entityId: reportId,
      userId: req.user.id,
      details: { reportType: report.report_type }
    });

    res.json({
      success: true,
      message: 'Report deleted successfully'
    });
  } catch (error) {
    if (error.message === 'Report not found') {
      return res.status(404).json({ error: 'Report not found' });
    }
    logger.error('Failed to delete report', {
      error: error.message,
      reportId: req.params.reportId
    });
    next(error);
  }
});

/**
 * @swagger
 * /api/reports/templates:
 *   get:
 *     summary: List available report templates
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: reportType
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of templates
 */
router.get('/templates', auth, checkPermission('reports:read'), async (req, res, next) => {
  try {
    const { reportType } = req.query;

    let query = 'SELECT * FROM report_templates WHERE is_active = true';
    const values = [];
    let paramIndex = 1;

    if (reportType) {
      query += ` AND report_type = $${paramIndex++}`;
      values.push(reportType);
    }

    query += ' ORDER BY name';

    const result = await reportService.db.query(query, values);

    res.json({
      success: true,
      templates: result.rows,
      total: result.rows.length
    });
  } catch (error) {
    logger.error('Failed to list templates', { error: error.message });
    next(error);
  }
});

/**
 * @swagger
 * /api/reports/types:
 *   get:
 *     summary: Get available report types
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of report types
 */
router.get('/types', auth, async (req, res) => {
  const reportTypes = [
    {
      id: 'document-analytics',
      name: 'Document Analytics Report',
      description: 'Analytics on document usage, quality scores, and feedback',
      parameters: ['startDate', 'endDate', 'status', 'minQualityScore']
    },
    {
      id: 'entity-extraction',
      name: 'Entity Extraction Summary',
      description: 'Summary of extracted entities across documents',
      parameters: ['startDate', 'endDate', 'entityType', 'minConfidence']
    },
    {
      id: 'alert-summary',
      name: 'Alert Summary Report',
      description: 'Summary of system alerts and their resolution',
      parameters: ['startDate', 'endDate', 'severity', 'status']
    },
    {
      id: 'search-analytics',
      name: 'Search Analytics Report',
      description: 'Analytics on search queries and results',
      parameters: ['startDate', 'endDate', 'minResultCount']
    },
    {
      id: 'user-activity',
      name: 'User Activity Report',
      description: 'Report on user activities and sessions',
      parameters: ['startDate', 'endDate', 'userId', 'activityType']
    },
    {
      id: 'system-performance',
      name: 'System Performance Report',
      description: 'System performance metrics and health',
      parameters: ['startDate', 'endDate', 'metricType']
    }
  ];

  res.json({
    success: true,
    reportTypes
  });
});

module.exports = { router, initializeRoute };