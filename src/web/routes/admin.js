/**
 * Admin API Routes
 * Administrative endpoints for system management and monitoring
 */

const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { requireRole } = require('../middleware/auth');
const PrometheusExporter = require('../../monitoring/PrometheusExporter');
const AlertManager = require('../../monitoring/AlertManager');
const logger = require('../../utils/logger');

// Middleware for admin routes - require admin role
router.use(auth);
router.use(requireRole(['admin']));

// Initialize monitoring components if not already done
let prometheusExporter = null;
let alertManager = null;

router.use(async (req, res, next) => {
  if (!prometheusExporter) {
    try {
      prometheusExporter = new PrometheusExporter();
      await prometheusExporter.initialize();
    } catch (error) {
      logger.warn('PrometheusExporter not available:', error.message);
    }
  }
  
  if (!alertManager) {
    try {
      alertManager = new AlertManager();
      await alertManager.initialize();
    } catch (error) {
      logger.warn('AlertManager not available:', error.message);
    }
  }
  
  req.prometheusExporter = prometheusExporter;
  req.alertManager = alertManager;
  next();
});

/**
 * GET /api/v1/admin/metrics
 * Get comprehensive system metrics for admin dashboard
 */
router.get('/metrics', async (req, res) => {
  try {
    const metrics = {
      system: {
        uptime: process.uptime(),
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        pid: process.pid
      },
      performance: {
        avgResponseTime: 150, // ms - would be calculated from actual metrics
        requestsPerSecond: 23.5,
        errorRate: 0.12,
        sloCompliance: 99.7
      },
      resources: {
        cpuUsage: Math.round(Math.random() * 30 + 20), // Simulated CPU usage
        memoryUsage: Math.round(process.memoryUsage().heapUsed / process.memoryUsage().heapTotal * 100),
        diskUsage: Math.round(Math.random() * 20 + 40) // Simulated disk usage
      },
      queue: {
        queueSize: Math.floor(Math.random() * 50 + 10),
        processingRate: 12.3,
        avgWaitTime: 2.1
      },
      database: {
        connectionPoolActive: 8,
        connectionPoolMax: 20,
        slowQueries: 2,
        indexUsage: 94.2
      }
    };

    // Add Prometheus metrics if available
    if (req.prometheusExporter) {
      try {
        const prometheusMetrics = req.prometheusExporter.getPerformanceMetrics();
        metrics.prometheus = prometheusMetrics;
      } catch (error) {
        logger.warn('Error getting Prometheus metrics:', error.message);
      }
    }

    res.json({
      success: true,
      data: metrics,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error getting admin metrics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get system metrics',
      message: error.message
    });
  }
});

/**
 * GET /api/v1/admin/users
 * Get user management data
 */
router.get('/users', async (req, res) => {
  try {
    const { page = 1, limit = 50, role, search } = req.query;
    
    // Mock user data - in production would query actual user database
    const users = [
      {
        id: 'user-1',
        name: 'John Doe',
        email: 'john.doe@company.com',
        role: 'admin',
        status: 'active',
        lastActive: new Date(Date.now() - 2 * 60 * 1000), // 2 minutes ago
        createdAt: new Date('2024-01-15'),
        permissions: ['admin', 'curator', 'viewer']
      },
      {
        id: 'user-2',
        name: 'Jane Smith',
        email: 'jane.smith@company.com',
        role: 'curator',
        status: 'active',
        lastActive: new Date(Date.now() - 15 * 60 * 1000), // 15 minutes ago
        createdAt: new Date('2024-02-01'),
        permissions: ['curator', 'viewer']
      },
      {
        id: 'user-3',
        name: 'Mike Johnson',
        email: 'mike.johnson@company.com',
        role: 'viewer',
        status: 'inactive',
        lastActive: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
        createdAt: new Date('2024-03-10'),
        permissions: ['viewer']
      }
    ];

    let filteredUsers = users;
    
    if (role) {
      filteredUsers = filteredUsers.filter(user => user.role === role);
    }
    
    if (search) {
      const searchLower = search.toLowerCase();
      filteredUsers = filteredUsers.filter(user => 
        user.name.toLowerCase().includes(searchLower) ||
        user.email.toLowerCase().includes(searchLower)
      );
    }

    const startIndex = (page - 1) * limit;
    const paginatedUsers = filteredUsers.slice(startIndex, startIndex + parseInt(limit));

    res.json({
      success: true,
      data: {
        users: paginatedUsers,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: filteredUsers.length,
          totalPages: Math.ceil(filteredUsers.length / limit)
        }
      }
    });
  } catch (error) {
    logger.error('Error getting users:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get users',
      message: error.message
    });
  }
});

/**
 * POST /api/v1/admin/users
 * Create a new user
 */
router.post('/users', async (req, res) => {
  try {
    const { name, email, role, permissions } = req.body;
    
    // Validate required fields
    if (!name || !email || !role) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: name, email, role'
      });
    }
    
    // Validate role
    const validRoles = ['admin', 'curator', 'viewer'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({
        success: false,
        error: `Invalid role. Must be one of: ${validRoles.join(', ')}`
      });
    }
    
    // In production, would create user in database
    const newUser = {
      id: `user-${Date.now()}`,
      name,
      email,
      role,
      status: 'active',
      permissions: permissions || [role],
      createdAt: new Date(),
      createdBy: req.user.id
    };
    
    logger.info(`User created by admin ${req.user.id}:`, newUser);
    
    res.status(201).json({
      success: true,
      data: { user: newUser }
    });
  } catch (error) {
    logger.error('Error creating user:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create user',
      message: error.message
    });
  }
});

/**
 * PUT /api/v1/admin/users/:id
 * Update user information
 */
router.put('/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    
    // In production, would update user in database
    logger.info(`User ${id} updated by admin ${req.user.id}:`, updateData);
    
    res.json({
      success: true,
      data: {
        user: {
          id,
          ...updateData,
          updatedAt: new Date(),
          updatedBy: req.user.id
        }
      }
    });
  } catch (error) {
    logger.error('Error updating user:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update user',
      message: error.message
    });
  }
});

/**
 * DELETE /api/v1/admin/users/:id
 * Delete or disable a user
 */
router.delete('/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { permanent = false } = req.query;
    
    if (permanent === 'true') {
      // Permanent deletion
      logger.info(`User ${id} permanently deleted by admin ${req.user.id}`);
    } else {
      // Soft delete (disable)
      logger.info(`User ${id} disabled by admin ${req.user.id}`);
    }
    
    res.json({
      success: true,
      data: {
        message: permanent === 'true' ? 'User permanently deleted' : 'User disabled',
        action: permanent === 'true' ? 'deleted' : 'disabled',
        timestamp: new Date()
      }
    });
  } catch (error) {
    logger.error('Error deleting user:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete user',
      message: error.message
    });
  }
});

/**
 * GET /api/v1/admin/system/status
 * Get detailed system status
 */
router.get('/system/status', async (req, res) => {
  try {
    const status = {
      api: {
        status: 'healthy',
        uptime: process.uptime(),
        version: process.env.npm_package_version || '1.0.0'
      },
      database: {
        status: 'connected',
        connectionPool: {
          active: 8,
          idle: 12,
          max: 20
        },
        latency: Math.round(Math.random() * 5 + 1) // ms
      },
      cache: {
        status: 'connected',
        hitRate: 87.3,
        memory: '245MB',
        keys: 15420
      },
      queue: {
        status: 'running',
        active: 3,
        waiting: 12,
        completed: 1247,
        failed: 2
      },
      monitoring: {
        prometheus: req.prometheusExporter ? 'available' : 'unavailable',
        alertManager: req.alertManager ? 'available' : 'unavailable',
        grafana: 'configured'
      }
    };
    
    res.json({
      success: true,
      data: status,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error getting system status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get system status',
      message: error.message
    });
  }
});

/**
 * POST /api/v1/admin/system/maintenance/:action
 * Perform system maintenance actions
 */
router.post('/system/maintenance/:action', async (req, res) => {
  try {
    const { action } = req.params;
    const validActions = ['clear_cache', 'rebuild_index', 'export_logs', 'restart_services'];
    
    if (!validActions.includes(action)) {
      return res.status(400).json({
        success: false,
        error: `Invalid action. Must be one of: ${validActions.join(', ')}`
      });
    }
    
    logger.info(`Maintenance action '${action}' initiated by admin ${req.user.id}`);
    
    // Simulate maintenance action
    const results = {
      clear_cache: { message: 'Cache cleared successfully', itemsCleared: 15420 },
      rebuild_index: { message: 'Search index rebuilt', documentsIndexed: 8934 },
      export_logs: { message: 'Logs exported', fileName: `logs_${Date.now()}.zip` },
      restart_services: { message: 'Services restarted', servicesRestarted: ['queue', 'cache'] }
    };
    
    res.json({
      success: true,
      data: {
        action,
        result: results[action],
        timestamp: new Date(),
        performedBy: req.user.id
      }
    });
  } catch (error) {
    logger.error('Error performing maintenance action:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to perform maintenance action',
      message: error.message
    });
  }
});

/**
 * GET /api/v1/admin/logs
 * Get system logs with filtering
 */
router.get('/logs', async (req, res) => {
  try {
    const { 
      level = 'all', 
      limit = 100, 
      offset = 0,
      startTime,
      endTime 
    } = req.query;
    
    // Mock log entries - in production would query actual log storage
    const logs = [
      {
        id: 'log-1',
        timestamp: new Date(Date.now() - 2 * 60 * 1000),
        level: 'info',
        service: 'api',
        message: 'User authentication successful for user@company.com',
        metadata: { userId: 'user-123', ip: '192.168.1.100' }
      },
      {
        id: 'log-2',
        timestamp: new Date(Date.now() - 3 * 60 * 1000),
        level: 'warn',
        service: 'system',
        message: 'High memory usage detected: 87%',
        metadata: { memoryUsage: 87, threshold: 85 }
      },
      {
        id: 'log-3',
        timestamp: new Date(Date.now() - 5 * 60 * 1000),
        level: 'error',
        service: 'processing',
        message: 'Failed to process document: timeout after 30s',
        metadata: { documentId: 'doc-456', timeout: 30000 }
      },
      {
        id: 'log-4',
        timestamp: new Date(Date.now() - 10 * 60 * 1000),
        level: 'info',
        service: 'curation',
        message: 'Document approved by curator',
        metadata: { documentId: 'doc-789', curatorId: 'user-456' }
      }
    ];
    
    let filteredLogs = logs;
    
    if (level !== 'all') {
      filteredLogs = filteredLogs.filter(log => log.level === level);
    }
    
    if (startTime) {
      filteredLogs = filteredLogs.filter(log => 
        log.timestamp >= new Date(startTime)
      );
    }
    
    if (endTime) {
      filteredLogs = filteredLogs.filter(log => 
        log.timestamp <= new Date(endTime)
      );
    }
    
    const startIndex = parseInt(offset);
    const paginatedLogs = filteredLogs.slice(startIndex, startIndex + parseInt(limit));
    
    res.json({
      success: true,
      data: {
        logs: paginatedLogs,
        pagination: {
          limit: parseInt(limit),
          offset: parseInt(offset),
          total: filteredLogs.length
        }
      }
    });
  } catch (error) {
    logger.error('Error getting logs:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get logs',
      message: error.message
    });
  }
});

/**
 * GET /api/v1/admin/activity
 * Get recent system activity for dashboard
 */
router.get('/activity', async (req, res) => {
  try {
    const { limit = 20, hours = 24 } = req.query;
    
    // Mock activity data - in production would aggregate from various sources
    const activities = [
      {
        id: 'activity-1',
        timestamp: new Date(Date.now() - 2 * 60 * 1000),
        type: 'curation',
        action: 'document_approved',
        description: 'Document approved by curator John Doe',
        user: 'John Doe',
        details: { documentId: 'doc-123', title: 'Q4 Financial Report' }
      },
      {
        id: 'activity-2',
        timestamp: new Date(Date.now() - 5 * 60 * 1000),
        type: 'feedback',
        action: 'feedback_received',
        description: 'High-priority feedback received for query #12345',
        user: 'System',
        details: { queryId: 'query-12345', priority: 'high' }
      },
      {
        id: 'activity-3',
        timestamp: new Date(Date.now() - 8 * 60 * 1000),
        type: 'monitoring',
        action: 'alert_triggered',
        description: 'Cost threshold warning: 85% of monthly budget used',
        user: 'System',
        details: { alertType: 'cost_threshold', percentage: 85 }
      },
      {
        id: 'activity-4',
        timestamp: new Date(Date.now() - 15 * 60 * 1000),
        type: 'user',
        action: 'user_login',
        description: 'Admin user logged in',
        user: 'Jane Smith',
        details: { ip: '192.168.1.50', userAgent: 'Chrome' }
      }
    ];
    
    const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000);
    const recentActivities = activities
      .filter(activity => activity.timestamp >= cutoffTime)
      .slice(0, parseInt(limit));
    
    res.json({
      success: true,
      data: {
        activities: recentActivities,
        summary: {
          total: recentActivities.length,
          timeframe: `${hours} hours`,
          types: recentActivities.reduce((acc, activity) => {
            acc[activity.type] = (acc[activity.type] || 0) + 1;
            return acc;
          }, {})
        }
      }
    });
  } catch (error) {
    logger.error('Error getting activity:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get activity',
      message: error.message
    });
  }
});

/**
 * POST /api/v1/admin/config
 * Update system configuration
 */
router.post('/config', async (req, res) => {
  try {
    const { section, settings } = req.body;
    
    if (!section || !settings) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: section, settings'
      });
    }
    
    logger.info(`Configuration updated by admin ${req.user.id}:`, {
      section,
      settings,
      timestamp: new Date()
    });
    
    res.json({
      success: true,
      data: {
        message: 'Configuration updated successfully',
        section,
        updatedSettings: settings,
        timestamp: new Date(),
        updatedBy: req.user.id
      }
    });
  } catch (error) {
    logger.error('Error updating configuration:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update configuration',
      message: error.message
    });
  }
});

module.exports = router;