const express = require('express');
const router = express.Router();
const AlertService = require('../../services/AlertService');
const { requirePermission } = require('../middleware/auth');
const logger = require('../../utils/logger');

// Initialize alert service
let alertService;

/**
 * Initialize alerts router with database
 */
function initializeAlertsRouter() {
  alertService = new AlertService();
  return router;
}

/**
 * @swagger
 * components:
 *   schemas:
 *     AlertRule:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *         name:
 *           type: string
 *         type:
 *           type: string
 *           enum: [threshold, pattern, composite]
 *         conditions:
 *           type: object
 *         actions:
 *           type: array
 *           items:
 *             type: string
 *         severity:
 *           type: string
 *           enum: [info, warning, error, critical]
 *         isActive:
 *           type: boolean
 */

/**
 * @swagger
 * /api/alerts/rules:
 *   get:
 *     summary: List alert rules
 *     tags: [Alerts]
 *     parameters:
 *       - in: query
 *         name: active
 *         schema:
 *           type: boolean
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *       - in: query
 *         name: tags
 *         schema:
 *           type: array
 *           items:
 *             type: string
 */
router.get('/rules', requirePermission('alerts.view'), async (req, res, next) => {
  try {
    const filter = {
      active: req.query.active !== undefined ? req.query.active === 'true' : undefined,
      type: req.query.type,
      tags: req.query.tags ? (Array.isArray(req.query.tags) ? req.query.tags : [req.query.tags]) : undefined
    };
    
    const rules = alertService.engine.listRules(filter);
    
    res.json({
      success: true,
      rules: rules.map(r => r.toJSON()),
      count: rules.length
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/alerts/rules:
 *   post:
 *     summary: Create alert rule
 *     tags: [Alerts]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - type
 *               - conditions
 *             properties:
 *               name:
 *                 type: string
 *               type:
 *                 type: string
 *               conditions:
 *                 type: object
 *               actions:
 *                 type: array
 *               severity:
 *                 type: string
 */
router.post('/rules', requirePermission('alerts.create'), async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const rule = await alertService.createRule(req.body, userId);
    
    res.status(201).json({
      success: true,
      rule: rule.toJSON()
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/alerts/rules/{ruleId}:
 *   get:
 *     summary: Get alert rule by ID
 *     tags: [Alerts]
 *     parameters:
 *       - in: path
 *         name: ruleId
 *         required: true
 *         schema:
 *           type: string
 */
router.get('/rules/:ruleId', requirePermission('alerts.view'), async (req, res, next) => {
  try {
    const rule = alertService.engine.getRule(req.params.ruleId);
    
    if (!rule) {
      return res.status(404).json({
        success: false,
        error: 'Rule not found'
      });
    }
    
    res.json({
      success: true,
      rule: rule.toJSON()
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/alerts/rules/{ruleId}:
 *   put:
 *     summary: Update alert rule
 *     tags: [Alerts]
 *     parameters:
 *       - in: path
 *         name: ruleId
 *         required: true
 *         schema:
 *           type: string
 */
router.put('/rules/:ruleId', requirePermission('alerts.update'), async (req, res, next) => {
  try {
    const rule = await alertService.updateRule(req.params.ruleId, req.body);
    
    res.json({
      success: true,
      rule: rule.toJSON()
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/alerts/rules/{ruleId}:
 *   delete:
 *     summary: Delete alert rule
 *     tags: [Alerts]
 *     parameters:
 *       - in: path
 *         name: ruleId
 *         required: true
 *         schema:
 *           type: string
 */
router.delete('/rules/:ruleId', requirePermission('alerts.delete'), async (req, res, next) => {
  try {
    const deleted = await alertService.deleteRule(req.params.ruleId);
    
    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: 'Rule not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Rule deleted successfully'
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/alerts/evaluate/{ruleId}:
 *   post:
 *     summary: Evaluate an alert rule
 *     tags: [Alerts]
 */
router.post('/evaluate/:ruleId', requirePermission('alerts.evaluate'), async (req, res, next) => {
  try {
    const result = await alertService.evaluateRule(req.params.ruleId, req.body);
    
    res.json({
      success: true,
      result: {
        triggered: result.triggered,
        reason: result.reason,
        rule: result.rule.name
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/alerts/evaluate-all:
 *   post:
 *     summary: Evaluate all active alert rules
 *     tags: [Alerts]
 */
router.post('/evaluate-all', requirePermission('alerts.evaluate'), async (req, res, next) => {
  try {
    const results = alertService.engine.evaluateAll(req.body.data || {}, req.body.options || {});
    
    res.json({
      success: true,
      results: results.map(r => ({
        rule: r.rule.name,
        triggered: r.triggered,
        reason: r.reason,
        error: r.error
      })),
      triggeredCount: results.filter(r => r.triggered).length,
      totalCount: results.length
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/alerts/templates:
 *   get:
 *     summary: List alert templates
 *     tags: [Alerts]
 */
router.get('/templates', requirePermission('alerts.view'), async (req, res, next) => {
  try {
    const templates = await alertService._getDb().query(
      'SELECT * FROM alert_templates ORDER BY name'
    );
    
    res.json({
      success: true,
      templates: templates.rows
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/alerts/templates/{templateName}:
 *   post:
 *     summary: Create rule from template
 *     tags: [Alerts]
 */
router.post('/templates/:templateName', requirePermission('alerts.create'), async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const rule = await alertService.createFromTemplate(
      req.params.templateName,
      req.body,
      userId
    );
    
    res.status(201).json({
      success: true,
      rule: rule.toJSON()
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/alerts/actions:
 *   get:
 *     summary: List alert actions
 *     tags: [Alerts]
 */
router.get('/actions', requirePermission('alerts.view'), async (req, res, next) => {
  try {
    const actions = await alertService._getDb().query(
      'SELECT * FROM alert_actions WHERE is_enabled = true ORDER BY name'
    );
    
    res.json({
      success: true,
      actions: actions.rows.map(a => ({
        name: a.name,
        type: a.type,
        configuration: a.configuration
      }))
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/alerts/active:
 *   get:
 *     summary: Get active alerts
 *     tags: [Alerts]
 */
router.get('/active', requirePermission('alerts.view'), async (req, res, next) => {
  try {
    const alerts = await alertService.getActiveAlerts();
    
    res.json({
      success: true,
      alerts,
      count: alerts.length
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/alerts/history:
 *   get:
 *     summary: Get alert history
 *     tags: [Alerts]
 */
router.get('/history', requirePermission('alerts.view'), async (req, res, next) => {
  try {
    const { ruleId, days = 7, limit = 100 } = req.query;
    
    let query = `
      SELECT 
        h.*,
        r.name as rule_name,
        r.severity
      FROM alert_history h
      JOIN alert_rules r ON h.rule_id = r.id
      WHERE h.triggered_at >= NOW() - INTERVAL '${parseInt(days)} days'
    `;
    
    const params = [];
    if (ruleId) {
      query += ' AND h.rule_id = $1';
      params.push(ruleId);
    }
    
    query += ` ORDER BY h.triggered_at DESC LIMIT ${parseInt(limit)}`;
    
    const result = await alertService._getDb().query(query, params);
    
    res.json({
      success: true,
      history: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/alerts/statistics:
 *   get:
 *     summary: Get alert statistics
 *     tags: [Alerts]
 */
router.get('/statistics', requirePermission('alerts.view'), async (req, res, next) => {
  try {
    const stats = await alertService.getAlertStatistics(req.query);
    
    res.json({
      success: true,
      statistics: stats
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/alerts/subscriptions:
 *   get:
 *     summary: Get user's alert subscriptions
 *     tags: [Alerts]
 */
router.get('/subscriptions', requirePermission('alerts.view'), async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const subscriptions = await alertService.getUserSubscriptions(userId);
    
    res.json({
      success: true,
      subscriptions
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/alerts/subscriptions:
 *   post:
 *     summary: Create alert subscription
 *     tags: [Alerts]
 */
router.post('/subscriptions', requirePermission('alerts.subscribe'), async (req, res, next) => {
  try {
    const subscription = await alertService.createSubscription({
      ...req.body,
      userId: req.user?.id
    });
    
    res.status(201).json({
      success: true,
      subscription
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/alerts/pattern-events:
 *   post:
 *     summary: Record pattern event
 *     tags: [Alerts]
 */
router.post('/pattern-events', requirePermission('alerts.create'), async (req, res, next) => {
  try {
    const { ruleId, eventType, metadata } = req.body;
    
    await alertService.recordPatternEvent(ruleId, eventType, metadata);
    
    res.json({
      success: true,
      message: 'Pattern event recorded'
    });
  } catch (error) {
    next(error);
  }
});

module.exports = initializeAlertsRouter;