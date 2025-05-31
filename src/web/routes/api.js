/**
 * General API Routes
 * Miscellaneous API endpoints for the manual review interface
 */

const express = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requirePermission } = require('../middleware/auth');
const logger = require('../../utils/logger');

module.exports = (dependencies = {}) => {
  const router = express.Router();
  const { queueManager, ingestionEngine } = dependencies;

  /**
   * Get system status
   */
  router.get('/status', requirePermission('read'), asyncHandler(async (req, res) => {
    logger.info('Fetching system status', {
      userId: req.user.id
    });

    const status = {
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      services: {
        queueManager: {
          initialized: queueManager?.isInitialized || false,
          connected: queueManager?.isConnected || false,
          queues: queueManager?.getQueueNames() || []
        },
        ingestionEngine: {
          initialized: ingestionEngine?.isInitialized || false,
          running: ingestionEngine?.isRunning || false,
          sources: ingestionEngine?.getRegisteredSources?.() || []
        }
      },
      environment: {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        env: process.env.NODE_ENV || 'development'
      }
    };

    res.json({ status });
  }));

  /**
   * Get system metrics
   */
  router.get('/metrics', requirePermission('read'), asyncHandler(async (req, res) => {
    const timeframe = req.query.timeframe || '1h';

    logger.info('Fetching system metrics', {
      timeframe,
      userId: req.user.id
    });

    // Calculate timeframe
    const now = new Date();
    let since;
    switch (timeframe) {
      case '5m':
        since = new Date(now.getTime() - 5 * 60 * 1000);
        break;
      case '1h':
        since = new Date(now.getTime() - 60 * 60 * 1000);
        break;
      case '24h':
        since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case '7d':
        since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      default:
        since = new Date(now.getTime() - 60 * 60 * 1000);
    }

    // Get queue metrics
    const queueMetrics = {};
    if (queueManager?.isInitialized) {
      const queueNames = queueManager.getQueueNames();
      
      for (const queueName of queueNames) {
        try {
          const stats = await queueManager.getQueueStats(queueName);
          const jobs = await queueManager.getJobs(queueName, ['completed', 'failed'], 0, -1);
          
          // Filter jobs by timeframe
          const recentJobs = jobs.filter(job => 
            job.finishedOn && new Date(job.finishedOn) >= since
          );

          const completed = recentJobs.filter(job => job.returnvalue !== undefined).length;
          const failed = recentJobs.filter(job => job.failedReason).length;

          queueMetrics[queueName] = {
            current: {
              waiting: stats.waiting || 0,
              active: stats.active || 0,
              delayed: stats.delayed || 0
            },
            recent: {
              completed,
              failed,
              total: completed + failed,
              successRate: completed + failed > 0 ? (completed / (completed + failed) * 100).toFixed(1) : 100
            }
          };
        } catch (error) {
          logger.warn(`Failed to get metrics for queue ${queueName}`, { error: error.message });
        }
      }
    }

    // Get ingestion metrics
    const ingestionMetrics = {
      sources: ingestionEngine?.getRegisteredSources?.().length || 0,
      isRunning: ingestionEngine?.isRunning || false
    };

    const metrics = {
      timestamp: new Date().toISOString(),
      timeframe,
      since: since.toISOString(),
      system: {
        uptime: process.uptime(),
        memory: {
          used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
          total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
          external: Math.round(process.memoryUsage().external / 1024 / 1024)
        },
        cpu: {
          usage: process.cpuUsage()
        }
      },
      queues: queueMetrics,
      ingestion: ingestionMetrics
    };

    res.json({ metrics });
  }));

  /**
   * Get configuration
   */
  router.get('/config', requirePermission('read'), asyncHandler(async (req, res) => {
    logger.info('Fetching configuration', {
      userId: req.user.id
    });

    // Get safe configuration (no sensitive data)
    const config = {
      environment: process.env.NODE_ENV || 'development',
      features: {
        authentication: !!process.env.REVIEW_API_KEY,
        queueManager: queueManager?.isInitialized || false,
        ingestionEngine: ingestionEngine?.isInitialized || false
      },
      limits: {
        maxFileSize: process.env.MAX_FILE_SIZE || '10MB',
        maxConcurrency: process.env.MAX_CONCURRENCY || 5,
        requestTimeout: process.env.REQUEST_TIMEOUT || '30s'
      },
      ui: {
        title: 'TheWell Pipeline - Manual Review',
        version: process.env.npm_package_version || '1.0.0',
        theme: 'default'
      }
    };

    res.json({ config });
  }));

  /**
   * Search documents/jobs
   */
  router.get('/search', requirePermission('read'), asyncHandler(async (req, res) => {
    const query = req.query.q || '';
    const type = req.query.type || 'all'; // 'documents', 'jobs', 'all'
    const limit = parseInt(req.query.limit) || 50;

    if (!query || query.length < 2) {
      return res.json({
        results: [],
        query,
        type,
        total: 0
      });
    }

    logger.info('Searching', {
      query,
      type,
      limit,
      userId: req.user.id
    });

    const results = [];
    const queryLower = query.toLowerCase();

    // Search in queue jobs
    if (type === 'all' || type === 'jobs' || type === 'documents') {
      const queueNames = queueManager?.getQueueNames() || [];
      
      for (const queueName of queueNames) {
        try {
          const jobs = await queueManager.getJobs(queueName, ['waiting', 'active', 'completed', 'failed'], 0, limit);
          
          for (const job of jobs) {
            const jobData = JSON.stringify(job.data).toLowerCase();
            const jobName = (job.name || '').toLowerCase();
            
            if (jobData.includes(queryLower) || jobName.includes(queryLower) || job.id.toString().includes(queryLower)) {
              results.push({
                type: 'job',
                id: job.id,
                queue: queueName,
                name: job.name || 'Unknown Job',
                status: await job.getState(),
                data: job.data,
                createdAt: job.timestamp,
                relevance: calculateRelevance(query, [jobName, jobData])
              });
            }
          }
        } catch (error) {
          logger.warn(`Failed to search in queue ${queueName}`, { error: error.message });
        }
      }
    }

    // Sort by relevance and limit
    results.sort((a, b) => b.relevance - a.relevance);
    const limitedResults = results.slice(0, limit);

    res.json({
      results: limitedResults,
      query,
      type,
      total: results.length,
      limited: results.length > limit
    });
  }));

  /**
   * Get user info
   */
  router.get('/user', requirePermission('read'), asyncHandler(async (req, res) => {
    res.json({
      user: {
        id: req.user.id,
        role: req.user.role,
        permissions: req.user.permissions,
        authenticated: true
      }
    });
  }));

  /**
   * Export data
   */
  router.get('/export/:type', requirePermission('read'), asyncHandler(async (req, res) => {
    const { type } = req.params;
    const format = req.query.format || 'json';
    const timeframe = req.query.timeframe || '24h';

    logger.info('Exporting data', {
      type,
      format,
      timeframe,
      userId: req.user.id
    });

    // Calculate timeframe
    const now = new Date();
    let since;
    switch (timeframe) {
      case '1h':
        since = new Date(now.getTime() - 60 * 60 * 1000);
        break;
      case '24h':
        since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case '7d':
        since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      default:
        since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    }

    let data = [];

    if (type === 'jobs' || type === 'all') {
      // Export job data
      const queueNames = queueManager?.getQueueNames() || [];
      
      for (const queueName of queueNames) {
        try {
          const jobs = await queueManager.getJobs(queueName, ['completed', 'failed'], 0, -1);
          const recentJobs = jobs.filter(job => 
            job.finishedOn && new Date(job.finishedOn) >= since
          );

          data = data.concat(recentJobs.map(job => ({
            type: 'job',
            id: job.id,
            queue: queueName,
            name: job.name,
            status: job.returnvalue ? 'completed' : 'failed',
            data: job.data,
            createdAt: new Date(job.timestamp).toISOString(),
            finishedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
            duration: job.finishedOn && job.processedOn ? job.finishedOn - job.processedOn : null,
            error: job.failedReason
          })));
        } catch (error) {
          logger.warn(`Failed to export from queue ${queueName}`, { error: error.message });
        }
      }
    }

    // Set appropriate headers
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `thewell-${type}-export-${timestamp}.${format}`;

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      
      // Convert to CSV (simplified)
      if (data.length > 0) {
        const headers = Object.keys(data[0]).join(',');
        const rows = data.map(row => 
          Object.values(row).map(value => 
            typeof value === 'string' ? `"${value.replace(/"/g, '""')}"` : value
          ).join(',')
        );
        res.send([headers, ...rows].join('\n'));
      } else {
        res.send('No data available for export');
      }
    } else {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.json({
        export: {
          type,
          format,
          timeframe,
          since: since.toISOString(),
          timestamp: new Date().toISOString(),
          count: data.length
        },
        data
      });
    }
  }));

  return router;
};

/**
 * Calculate search relevance score
 */
function calculateRelevance(query, texts) {
  const queryLower = query.toLowerCase();
  let score = 0;

  for (const text of texts) {
    if (typeof text === 'string') {
      const textLower = text.toLowerCase();
      
      // Exact match
      if (textLower === queryLower) {
        score += 100;
      }
      // Starts with query
      else if (textLower.startsWith(queryLower)) {
        score += 50;
      }
      // Contains query
      else if (textLower.includes(queryLower)) {
        score += 25;
      }
      
      // Word boundary matches
      const words = queryLower.split(/\s+/);
      for (const word of words) {
        if (word.length > 2 && textLower.includes(word)) {
          score += 10;
        }
      }
    }
  }

  return score;
}
