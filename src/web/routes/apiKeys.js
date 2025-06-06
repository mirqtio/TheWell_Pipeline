const express = require('express');
const router = express.Router();
const RateLimitService = require('../../services/RateLimitService');
const { requireAuth } = require('../middleware/auth');
const logger = require('../../utils/logger');

// Initialize service
const rateLimitService = new RateLimitService();

/**
 * @swagger
 * tags:
 *   name: API Keys
 *   description: API key management endpoints
 */

/**
 * @swagger
 * /api/keys:
 *   get:
 *     summary: List user's API keys
 *     tags: [API Keys]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of API keys
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 keys:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: integer
 *                       name:
 *                         type: string
 *                       tier:
 *                         type: string
 *                       lastUsed:
 *                         type: string
 *                         format: date-time
 *                       createdAt:
 *                         type: string
 *                         format: date-time
 *                       expiresAt:
 *                         type: string
 *                         format: date-time
 *                       isActive:
 *                         type: boolean
 */
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const userId = req.user.id;
    
    const result = await req.app.locals.db.query(`
      SELECT 
        id,
        name,
        tier,
        is_active,
        created_at,
        last_used_at,
        expires_at,
        custom_limits,
        rate_limit_override
      FROM api_keys
      WHERE user_id = $1
      ORDER BY created_at DESC
    `, [userId]);

    const keys = result.rows.map(key => ({
      id: key.id,
      name: key.name,
      tier: key.tier,
      isActive: key.is_active,
      createdAt: key.created_at,
      lastUsed: key.last_used_at,
      expiresAt: key.expires_at,
      hasCustomLimits: !!key.custom_limits,
      hasOverride: !!key.rate_limit_override
    }));

    res.json({ keys });
  } catch (error) {
    logger.error('Error listing API keys:', error);
    next(error);
  }
});

/**
 * @swagger
 * /api/keys:
 *   post:
 *     summary: Generate a new API key
 *     tags: [API Keys]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 description: Name for the API key
 *               tier:
 *                 type: string
 *                 enum: [basic, premium, enterprise]
 *                 description: Rate limit tier for the key
 *               expiresIn:
 *                 type: integer
 *                 description: Expiration time in seconds (optional)
 *     responses:
 *       201:
 *         description: API key created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: integer
 *                 apiKey:
 *                   type: string
 *                   description: The API key (only shown once)
 *                 name:
 *                   type: string
 *                 tier:
 *                   type: string
 *                 createdAt:
 *                   type: string
 *                   format: date-time
 *                 expiresAt:
 *                   type: string
 *                   format: date-time
 */
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { name, tier = 'basic', expiresIn } = req.body;

    // Validate tier based on user's account tier
    const allowedTiers = getAllowedTiers(req.user.tier);
    if (!allowedTiers.includes(tier)) {
      return res.status(403).json({
        error: 'Invalid tier',
        message: `Your account tier (${req.user.tier}) cannot create ${tier} API keys`
      });
    }

    // Check API key limit for user
    const keyCount = await getUserApiKeyCount(userId);
    const keyLimit = getApiKeyLimit(req.user.tier);
    
    if (keyCount >= keyLimit) {
      return res.status(403).json({
        error: 'Limit exceeded',
        message: `You have reached the maximum number of API keys (${keyLimit}) for your account tier`
      });
    }

    // Generate API key
    const apiKeyData = await rateLimitService.generateApiKey(userId, {
      name: name || `API Key ${keyCount + 1}`,
      tier,
      expiresIn
    });

    // Log the creation
    logger.info('API key created', {
      userId,
      keyId: apiKeyData.id,
      tier,
      name: apiKeyData.name
    });

    res.status(201).json({
      id: apiKeyData.id,
      apiKey: apiKeyData.apiKey,
      name: apiKeyData.name,
      tier: apiKeyData.tier,
      createdAt: apiKeyData.createdAt,
      expiresAt: apiKeyData.expiresAt,
      warning: 'Please save this API key securely. You will not be able to see it again.'
    });
  } catch (error) {
    logger.error('Error generating API key:', error);
    next(error);
  }
});

/**
 * @swagger
 * /api/keys/{id}:
 *   get:
 *     summary: Get API key details and usage statistics
 *     tags: [API Keys]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: API key ID
 *     responses:
 *       200:
 *         description: API key details and usage
 */
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const keyId = req.params.id;

    // Get key details
    const keyResult = await req.app.locals.db.query(`
      SELECT 
        k.*,
        COUNT(DISTINCT u.hour_bucket) as hours_used,
        SUM(u.request_count) as total_requests,
        SUM(u.total_cost) as total_cost
      FROM api_keys k
      LEFT JOIN rate_limit_usage u ON u.api_key_id = k.id
      WHERE k.id = $1 AND k.user_id = $2
      GROUP BY k.id
    `, [keyId, userId]);

    if (keyResult.rows.length === 0) {
      return res.status(404).json({ error: 'API key not found' });
    }

    const key = keyResult.rows[0];

    // Get recent usage
    const usageResult = await req.app.locals.db.query(`
      SELECT 
        DATE_TRUNC('hour', first_request_at) as hour,
        SUM(request_count) as requests,
        SUM(total_cost) as cost
      FROM rate_limit_usage
      WHERE api_key_id = $1
        AND first_request_at >= NOW() - INTERVAL '24 hours'
      GROUP BY hour
      ORDER BY hour DESC
    `, [keyId]);

    res.json({
      key: {
        id: key.id,
        name: key.name,
        tier: key.tier,
        isActive: key.is_active,
        createdAt: key.created_at,
        lastUsed: key.last_used_at,
        expiresAt: key.expires_at,
        customLimits: key.custom_limits,
        rateLimitOverride: key.rate_limit_override
      },
      usage: {
        totalRequests: parseInt(key.total_requests) || 0,
        totalCost: parseInt(key.total_cost) || 0,
        hoursActive: parseInt(key.hours_used) || 0,
        recentHours: usageResult.rows.map(row => ({
          hour: row.hour,
          requests: parseInt(row.requests),
          cost: parseInt(row.cost)
        }))
      }
    });
  } catch (error) {
    logger.error('Error getting API key details:', error);
    next(error);
  }
});

/**
 * @swagger
 * /api/keys/{id}/rotate:
 *   post:
 *     summary: Rotate an API key
 *     tags: [API Keys]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: API key ID to rotate
 *     responses:
 *       201:
 *         description: New API key generated
 */
router.post('/:id/rotate', requireAuth, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const keyId = req.params.id;

    // Rotate the key
    const newKey = await rateLimitService.rotateApiKey(keyId, userId);

    logger.info('API key rotated', {
      userId,
      oldKeyId: keyId,
      newKeyId: newKey.id
    });

    res.status(201).json({
      id: newKey.id,
      apiKey: newKey.apiKey,
      name: newKey.name,
      tier: newKey.tier,
      createdAt: newKey.createdAt,
      warning: 'Please save this new API key securely. The old key has been deactivated.'
    });
  } catch (error) {
    logger.error('Error rotating API key:', error);
    next(error);
  }
});

/**
 * @swagger
 * /api/keys/{id}:
 *   delete:
 *     summary: Revoke an API key
 *     tags: [API Keys]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: API key ID to revoke
 *     responses:
 *       204:
 *         description: API key revoked successfully
 */
router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const keyId = req.params.id;

    // Deactivate the key
    const result = await req.app.locals.db.query(`
      UPDATE api_keys 
      SET is_active = false 
      WHERE id = $1 AND user_id = $2 
      RETURNING id
    `, [keyId, userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'API key not found' });
    }

    // Log the revocation
    await req.app.locals.db.query(`
      INSERT INTO api_key_events (api_key_id, event_type, metadata)
      VALUES ($1, 'revoked', $2)
    `, [keyId, JSON.stringify({ revokedBy: userId })]);

    logger.info('API key revoked', { userId, keyId });

    res.status(204).send();
  } catch (error) {
    logger.error('Error revoking API key:', error);
    next(error);
  }
});

/**
 * @swagger
 * /api/keys/{id}/limits:
 *   put:
 *     summary: Update custom limits for an API key (admin only)
 *     tags: [API Keys]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               customLimits:
 *                 type: object
 *                 properties:
 *                   requests:
 *                     type: integer
 *                   window:
 *                     type: integer
 *                   burst:
 *                     type: integer
 *     responses:
 *       200:
 *         description: Limits updated successfully
 */
router.put('/:id/limits', requireAuth, async (req, res, next) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const keyId = req.params.id;
    const { customLimits } = req.body;

    await req.app.locals.db.query(`
      UPDATE api_keys 
      SET custom_limits = $1 
      WHERE id = $2
    `, [JSON.stringify(customLimits), keyId]);

    logger.info('API key limits updated', {
      keyId,
      updatedBy: req.user.id,
      customLimits
    });

    res.json({ message: 'Limits updated successfully' });
  } catch (error) {
    logger.error('Error updating API key limits:', error);
    next(error);
  }
});

// Helper functions
function getAllowedTiers(userTier) {
  const tierHierarchy = {
    free: ['basic'],
    basic: ['basic'],
    premium: ['basic', 'premium'],
    enterprise: ['basic', 'premium', 'enterprise'],
    admin: ['basic', 'premium', 'enterprise']
  };
  
  return tierHierarchy[userTier] || ['basic'];
}

function getApiKeyLimit(userTier) {
  const limits = {
    free: 1,
    basic: 3,
    premium: 10,
    enterprise: 50,
    admin: 100
  };
  
  return limits[userTier] || 1;
}

async function getUserApiKeyCount(userId) {
  const result = await rateLimitService.db.query(
    'SELECT COUNT(*) as count FROM api_keys WHERE user_id = $1 AND is_active = true',
    [userId]
  );
  
  return parseInt(result.rows[0].count);
}

module.exports = router;