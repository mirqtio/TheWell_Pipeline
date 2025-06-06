const express = require('express');
const router = express.Router();
const RateLimitService = require('../../services/RateLimitService');
const { requireAuth } = require('../middleware/auth');
const logger = require('../../utils/logger');

// Initialize service
const rateLimitService = new RateLimitService();

// Admin middleware
const requireAdmin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({ error: 'Admin access required' });
  }
};

/**
 * @swagger
 * tags:
 *   name: Rate Limit Admin
 *   description: Admin endpoints for rate limit management
 */

/**
 * @swagger
 * /api/admin/rate-limits/overview:
 *   get:
 *     summary: Get rate limit system overview
 *     tags: [Rate Limit Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Rate limit system overview
 */
router.get('/overview', [requireAuth, requireAdmin], async (req, res, next) => {
  try {
    const db = req.app.locals.db;

    // Get current system stats
    const [activeUsers, apiKeys, violations, blockedIps] = await Promise.all([
      db.query(`
        SELECT COUNT(DISTINCT identifier) as count
        FROM rate_limit_usage
        WHERE first_request_at >= NOW() - INTERVAL '1 hour'
      `),
      db.query(`
        SELECT COUNT(*) as total,
               COUNT(*) FILTER (WHERE is_active = true) as active
        FROM api_keys
      `),
      db.query(`
        SELECT COUNT(*) as count,
               COUNT(DISTINCT identifier) as unique_violators
        FROM rate_limit_violations
        WHERE attempted_at >= NOW() - INTERVAL '24 hours'
      `),
      db.query(`
        SELECT COUNT(*) as count
        FROM ip_blocks
        WHERE blocked_until IS NULL OR blocked_until > NOW()
      `)
    ]);

    // Get top endpoints by usage
    const topEndpoints = await db.query(`
      SELECT endpoint, method,
             SUM(request_count) as total_requests,
             COUNT(DISTINCT identifier) as unique_users
      FROM rate_limit_usage
      WHERE first_request_at >= NOW() - INTERVAL '1 hour'
      GROUP BY endpoint, method
      ORDER BY total_requests DESC
      LIMIT 10
    `);

    // Get tier distribution
    const tierDistribution = await db.query(`
      SELECT tier,
             COUNT(DISTINCT identifier) as user_count,
             SUM(request_count) as total_requests
      FROM rate_limit_usage
      WHERE first_request_at >= NOW() - INTERVAL '24 hours'
        AND tier IS NOT NULL
      GROUP BY tier
    `);

    res.json({
      stats: {
        activeUsers: parseInt(activeUsers.rows[0].count),
        apiKeys: {
          total: parseInt(apiKeys.rows[0].total),
          active: parseInt(apiKeys.rows[0].active)
        },
        violations: {
          total: parseInt(violations.rows[0].count),
          uniqueViolators: parseInt(violations.rows[0].unique_violators)
        },
        blockedIps: parseInt(blockedIps.rows[0].count)
      },
      topEndpoints: topEndpoints.rows,
      tierDistribution: tierDistribution.rows
    });
  } catch (error) {
    logger.error('Error getting rate limit overview:', error);
    next(error);
  }
});

/**
 * @swagger
 * /api/admin/rate-limits/usage:
 *   get:
 *     summary: Get detailed usage analytics
 *     tags: [Rate Limit Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: identifier
 *         schema:
 *           type: string
 *         description: Filter by specific identifier
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: groupBy
 *         schema:
 *           type: string
 *           enum: [hour, day, endpoint]
 *     responses:
 *       200:
 *         description: Usage analytics data
 */
router.get('/usage', [requireAuth, requireAdmin], async (req, res, next) => {
  try {
    const {
      identifier,
      startDate = new Date(Date.now() - 24 * 60 * 60 * 1000),
      endDate = new Date(),
      groupBy = 'hour'
    } = req.query;

    let query;
    let params = [startDate, endDate];

    if (identifier) {
      params.push(identifier);
      query = `
        SELECT 
          DATE_TRUNC($4, first_request_at) as time_bucket,
          endpoint,
          method,
          tier,
          SUM(request_count) as total_requests,
          SUM(total_cost) as total_cost,
          COUNT(DISTINCT identifier) as unique_users
        FROM rate_limit_usage
        WHERE first_request_at >= $1
          AND first_request_at <= $2
          AND identifier = $3
        GROUP BY time_bucket, endpoint, method, tier
        ORDER BY time_bucket DESC
      `;
      params.push(groupBy);
    } else {
      query = `
        SELECT 
          DATE_TRUNC($3, first_request_at) as time_bucket,
          endpoint,
          method,
          COUNT(DISTINCT identifier) as unique_users,
          SUM(request_count) as total_requests,
          SUM(total_cost) as total_cost
        FROM rate_limit_usage
        WHERE first_request_at >= $1
          AND first_request_at <= $2
        GROUP BY time_bucket, endpoint, method
        ORDER BY time_bucket DESC
        LIMIT 1000
      `;
      params.push(groupBy);
    }

    const result = await req.app.locals.db.query(query, params);

    res.json({
      usage: result.rows,
      parameters: {
        identifier,
        startDate,
        endDate,
        groupBy
      }
    });
  } catch (error) {
    logger.error('Error getting usage analytics:', error);
    next(error);
  }
});

/**
 * @swagger
 * /api/admin/rate-limits/violations:
 *   get:
 *     summary: Get rate limit violations
 *     tags: [Rate Limit Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 100
 *     responses:
 *       200:
 *         description: List of recent violations
 */
router.get('/violations', [requireAuth, requireAdmin], async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit) || 100;

    const result = await req.app.locals.db.query(`
      SELECT 
        v.*,
        COUNT(*) OVER (PARTITION BY identifier) as total_violations_by_user
      FROM rate_limit_violations v
      WHERE attempted_at >= NOW() - INTERVAL '24 hours'
      ORDER BY attempted_at DESC
      LIMIT $1
    `, [limit]);

    // Get repeat offenders
    const repeatOffenders = await req.app.locals.db.query(`
      SELECT 
        identifier,
        COUNT(*) as violation_count,
        COUNT(DISTINCT endpoint) as endpoints_violated,
        MAX(attempted_at) as last_violation
      FROM rate_limit_violations
      WHERE attempted_at >= NOW() - INTERVAL '24 hours'
      GROUP BY identifier
      HAVING COUNT(*) >= 5
      ORDER BY violation_count DESC
      LIMIT 20
    `);

    res.json({
      violations: result.rows,
      repeatOffenders: repeatOffenders.rows
    });
  } catch (error) {
    logger.error('Error getting violations:', error);
    next(error);
  }
});

/**
 * @swagger
 * /api/admin/rate-limits/ip-blocks:
 *   get:
 *     summary: List blocked IPs
 *     tags: [Rate Limit Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of blocked IPs
 */
router.get('/ip-blocks', [requireAuth, requireAdmin], async (req, res, next) => {
  try {
    const result = await req.app.locals.db.query(`
      SELECT 
        b.*,
        u.email as blocked_by_email
      FROM ip_blocks b
      LEFT JOIN users u ON b.blocked_by = u.id
      WHERE b.blocked_until IS NULL OR b.blocked_until > NOW()
      ORDER BY b.created_at DESC
    `);

    res.json({ blockedIps: result.rows });
  } catch (error) {
    logger.error('Error getting blocked IPs:', error);
    next(error);
  }
});

/**
 * @swagger
 * /api/admin/rate-limits/ip-blocks:
 *   post:
 *     summary: Block an IP address
 *     tags: [Rate Limit Admin]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - ip
 *             properties:
 *               ip:
 *                 type: string
 *               reason:
 *                 type: string
 *               duration:
 *                 type: integer
 *                 description: Block duration in seconds (null for permanent)
 *     responses:
 *       201:
 *         description: IP blocked successfully
 */
router.post('/ip-blocks', [requireAuth, requireAdmin], async (req, res, next) => {
  try {
    const { ip, reason, duration } = req.body;
    const userId = req.user.id;

    const result = await rateLimitService.manageIpBlock(ip, 'block', {
      reason,
      duration,
      userId
    });

    logger.info('IP blocked by admin', {
      ip,
      reason,
      duration,
      blockedBy: userId
    });

    res.status(201).json(result);
  } catch (error) {
    logger.error('Error blocking IP:', error);
    next(error);
  }
});

/**
 * @swagger
 * /api/admin/rate-limits/ip-blocks/{ip}:
 *   delete:
 *     summary: Unblock an IP address
 *     tags: [Rate Limit Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: ip
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: IP unblocked successfully
 */
router.delete('/ip-blocks/:ip', [requireAuth, requireAdmin], async (req, res, next) => {
  try {
    const ip = decodeURIComponent(req.params.ip);
    
    const result = await rateLimitService.manageIpBlock(ip, 'unblock');

    logger.info('IP unblocked by admin', {
      ip,
      unblockedBy: req.user.id
    });

    res.json(result);
  } catch (error) {
    logger.error('Error unblocking IP:', error);
    next(error);
  }
});

/**
 * @swagger
 * /api/admin/rate-limits/configs:
 *   get:
 *     summary: Get dynamic rate limit configurations
 *     tags: [Rate Limit Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of rate limit configurations
 */
router.get('/configs', [requireAuth, requireAdmin], async (req, res, next) => {
  try {
    const result = await req.app.locals.db.query(`
      SELECT * FROM rate_limit_configs
      WHERE is_active = true
      ORDER BY priority DESC, name
    `);

    res.json({ configs: result.rows });
  } catch (error) {
    logger.error('Error getting rate limit configs:', error);
    next(error);
  }
});

/**
 * @swagger
 * /api/admin/rate-limits/configs:
 *   post:
 *     summary: Create a new rate limit configuration
 *     tags: [Rate Limit Admin]
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
 *               - configType
 *               - conditions
 *               - limits
 *             properties:
 *               name:
 *                 type: string
 *               configType:
 *                 type: string
 *                 enum: [tier, endpoint, ip_range, custom]
 *               priority:
 *                 type: integer
 *               conditions:
 *                 type: object
 *               limits:
 *                 type: object
 *     responses:
 *       201:
 *         description: Configuration created successfully
 */
router.post('/configs', [requireAuth, requireAdmin], async (req, res, next) => {
  try {
    const { name, configType, priority = 0, conditions, limits } = req.body;
    const userId = req.user.id;

    const result = await req.app.locals.db.query(`
      INSERT INTO rate_limit_configs 
      (name, config_type, priority, conditions, limits, created_by)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [name, configType, priority, conditions, limits, userId]);

    logger.info('Rate limit config created', {
      configId: result.rows[0].id,
      name,
      createdBy: userId
    });

    res.status(201).json({ config: result.rows[0] });
  } catch (error) {
    logger.error('Error creating rate limit config:', error);
    next(error);
  }
});

/**
 * @swagger
 * /api/admin/rate-limits/reset/{identifier}:
 *   post:
 *     summary: Reset rate limits for a specific identifier
 *     tags: [Rate Limit Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: identifier
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Rate limits reset successfully
 */
router.post('/reset/:identifier', [requireAuth, requireAdmin], async (req, res, next) => {
  try {
    const identifier = decodeURIComponent(req.params.identifier);
    
    await rateLimitService.reset(identifier);

    logger.info('Rate limits reset by admin', {
      identifier,
      resetBy: req.user.id
    });

    res.json({ 
      message: 'Rate limits reset successfully',
      identifier 
    });
  } catch (error) {
    logger.error('Error resetting rate limits:', error);
    next(error);
  }
});

/**
 * @swagger
 * /api/admin/rate-limits/dashboard:
 *   get:
 *     summary: Get dashboard data for rate limit monitoring
 *     tags: [Rate Limit Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Dashboard data
 */
router.get('/dashboard', [requireAuth, requireAdmin], async (req, res, next) => {
  try {
    const db = req.app.locals.db;

    // Get hourly request trends
    const hourlyTrends = await db.query(`
      SELECT 
        DATE_TRUNC('hour', first_request_at) as hour,
        SUM(request_count) as total_requests,
        COUNT(DISTINCT identifier) as unique_users,
        AVG(total_cost) as avg_cost_per_user
      FROM rate_limit_usage
      WHERE first_request_at >= NOW() - INTERVAL '24 hours'
      GROUP BY hour
      ORDER BY hour
    `);

    // Get current active users by tier
    const activeTiers = await db.query(`
      SELECT 
        tier,
        COUNT(DISTINCT identifier) as active_users
      FROM rate_limit_usage
      WHERE first_request_at >= NOW() - INTERVAL '1 hour'
        AND tier IS NOT NULL
      GROUP BY tier
    `);

    // Get API key usage
    const apiKeyUsage = await db.query(`
      SELECT 
        k.name as key_name,
        k.tier,
        u.user_email,
        SUM(r.request_count) as requests_today,
        SUM(r.total_cost) as cost_today
      FROM api_keys k
      JOIN users u ON k.user_id = u.id
      LEFT JOIN rate_limit_usage r ON r.api_key_id = k.id
        AND r.first_request_at >= CURRENT_DATE
      WHERE k.is_active = true
      GROUP BY k.id, k.name, k.tier, u.email
      ORDER BY requests_today DESC NULLS LAST
      LIMIT 20
    `);

    // Get system health metrics
    const healthMetrics = await db.query(`
      SELECT 
        (SELECT COUNT(*) FROM rate_limit_violations 
         WHERE attempted_at >= NOW() - INTERVAL '1 hour') as recent_violations,
        (SELECT COUNT(DISTINCT identifier) FROM rate_limit_usage 
         WHERE first_request_at >= NOW() - INTERVAL '5 minutes') as active_users_5min,
        (SELECT AVG(request_count) FROM rate_limit_usage 
         WHERE first_request_at >= NOW() - INTERVAL '1 hour') as avg_requests_per_user
    `);

    res.json({
      hourlyTrends: hourlyTrends.rows,
      activeTiers: activeTiers.rows,
      topApiKeys: apiKeyUsage.rows,
      healthMetrics: healthMetrics.rows[0]
    });
  } catch (error) {
    logger.error('Error getting dashboard data:', error);
    next(error);
  }
});

module.exports = router;