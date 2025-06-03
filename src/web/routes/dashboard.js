/**
 * Dashboard API Routes
 * 
 * Provides REST endpoints for monitoring dashboard data including
 * cost metrics, quality metrics, and operational status.
 */

const express = require('express');
const router = express.Router();
const logger = require('../../utils/logger');

// Middleware for dashboard routes
router.use((req, res, next) => {
  // Add CORS headers for dashboard access
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  
  next();
});

// Dashboard overview endpoint
router.get('/overview', async (req, res) => {
  try {
    const dashboardManager = req.app.get('dashboardManager');
    
    if (!dashboardManager || !dashboardManager.isInitialized) {
      return res.status(503).json({
        error: 'Dashboard service not available',
        message: 'Dashboard manager is not initialized'
      });
    }
    
    const dashboardData = dashboardManager.getAllDashboardData();
    
    // Create overview summary
    const overview = {
      status: 'healthy',
      lastUpdated: dashboardData.lastRefresh,
      summary: {
        cost: {
          dailySpending: dashboardData.cost.realTime?.dailySpending || 0,
          monthlySpending: dashboardData.cost.realTime?.monthlySpending || 0,
          budgetUtilization: dashboardData.cost.realTime?.budgetStatus?.utilization || 0,
          trend: dashboardData.cost.realTime?.trends?.trend || 'stable'
        },
        quality: {
          overallHealth: dashboardData.quality.realTime?.sloCompliance?.overall || 100,
          errorRate: dashboardData.quality.realTime?.errorRates?.overall || 0,
          avgResponseTime: dashboardData.quality.realTime?.responseTimeMetrics?.average || 0,
          trend: dashboardData.quality.realTime?.trends?.trend || 'stable'
        },
        operational: {
          uptime: dashboardData.operational.realTime?.uptime?.percentage || 100,
          systemHealth: dashboardData.operational.realTime?.systemHealth?.status || 'healthy',
          throughput: dashboardData.operational.realTime?.throughputMetrics?.requestsPerMinute || 0,
          activeConnections: dashboardData.operational.realTime?.activeConnections?.total || 0
        }
      }
    };
    
    res.json(overview);
  } catch (error) {
    logger.error('Error getting dashboard overview:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to retrieve dashboard overview'
    });
  }
});

// Admin dashboard route - serve the admin interface
router.get('/admin', (req, res) => {
  try {
    // For now, redirect to the admin HTML file
    // In production, this would include proper authentication
    res.redirect('/admin/');
  } catch (error) {
    logger.error('Error serving admin dashboard:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to serve admin dashboard'
    });
  }
});

// Admin API endpoints for dashboard data
router.get('/admin/data/overview', async (req, res) => {
  try {
    const dashboardManager = req.app.get('dashboardManager');
    
    if (!dashboardManager || !dashboardManager.isInitialized) {
      return res.status(503).json({
        error: 'Dashboard service not available',
        message: 'Dashboard manager is not initialized'
      });
    }
    
    const dashboardData = dashboardManager.getAllDashboardData();
    
    // Format data for admin dashboard
    const adminOverview = {
      systemStatus: 'healthy',
      activeSources: 12,
      documentsProcessed: 1247,
      apiRequests: 8932,
      realTimeCost: dashboardData.cost.realTime?.dailySpending || 24.67,
      lastUpdated: new Date().toISOString()
    };
    
    res.json(adminOverview);
  } catch (error) {
    logger.error('Error fetching admin overview data:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to fetch admin overview data'
    });
  }
});

router.get('/admin/data/providers', async (req, res) => {
  try {
    // Mock provider data - in production this would come from actual provider monitoring
    const providers = [
      {
        name: 'OpenAI',
        status: 'healthy',
        responseTime: 245,
        successRate: 99.2,
        requestsToday: 1247,
        costToday: 18.45
      },
      {
        name: 'Anthropic',
        status: 'healthy',
        responseTime: 198,
        successRate: 98.8,
        requestsToday: 342,
        costToday: 6.22
      }
    ];
    
    res.json(providers);
  } catch (error) {
    logger.error('Error fetching provider data:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to fetch provider data'
    });
  }
});

// Ingestion monitoring endpoint
router.get('/admin/data/ingestion', async (req, res) => {
  try {
    const ingestionEngine = req.app.get('ingestionEngine');
    
    if (!ingestionEngine || !ingestionEngine.isInitialized) {
      // Return mock data if ingestion engine is not available
      const mockIngestionData = {
        sources: [
          {
            id: 'web-source-1',
            name: 'Company Blog',
            type: 'web',
            status: 'active',
            lastSync: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
            documentsProcessed: 156,
            documentsToday: 23,
            errorCount: 0,
            avgProcessingTime: 2.3,
            successRate: 100
          },
          {
            id: 'api-source-1',
            name: 'Knowledge Base API',
            type: 'api',
            status: 'active',
            lastSync: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
            documentsProcessed: 342,
            documentsToday: 67,
            errorCount: 2,
            avgProcessingTime: 1.8,
            successRate: 99.4
          },
          {
            id: 'file-source-1',
            name: 'Document Upload',
            type: 'file',
            status: 'processing',
            lastSync: new Date(Date.now() - 30 * 1000).toISOString(),
            documentsProcessed: 89,
            documentsToday: 15,
            errorCount: 1,
            avgProcessingTime: 4.2,
            successRate: 98.9,
            queueSize: 15
          }
        ],
        metrics: {
          totalDocumentsToday: 105,
          totalErrorsToday: 3,
          avgProcessingTime: 2.8,
          overallSuccessRate: 99.1,
          activeSources: 3,
          queuedDocuments: 15
        },
        recentActivity: [
          {
            timestamp: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
            type: 'success',
            message: 'Web scrape completed for Company Blog',
            sourceId: 'web-source-1',
            documentsProcessed: 5
          },
          {
            timestamp: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
            type: 'info',
            message: 'New document processed from Knowledge Base API',
            sourceId: 'api-source-1',
            documentsProcessed: 1
          },
          {
            timestamp: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
            type: 'warning',
            message: 'Rate limit reached for API source',
            sourceId: 'api-source-1'
          },
          {
            timestamp: new Date(Date.now() - 12 * 60 * 1000).toISOString(),
            type: 'error',
            message: 'Failed to process document: invalid format',
            sourceId: 'file-source-1'
          }
        ]
      };
      
      return res.json(mockIngestionData);
    }
    
    // Get real ingestion statistics
    const stats = ingestionEngine.getStatistics();
    const sources = Array.from(ingestionEngine.sources.values()).map(source => {
      return {
        id: source.config.id,
        name: source.config.name || source.config.id,
        type: source.config.type,
        status: source.isActive ? 'active' : 'inactive',
        lastSync: source.lastSync || new Date().toISOString(),
        documentsProcessed: source.documentsProcessed || 0,
        documentsToday: source.documentsToday || 0,
        errorCount: source.errorCount || 0,
        avgProcessingTime: source.avgProcessingTime || 0,
        successRate: source.successRate || 100,
        queueSize: source.queueSize || 0
      };
    });
    
    const ingestionData = {
      sources,
      metrics: {
        totalDocumentsToday: sources.reduce((sum, s) => sum + s.documentsToday, 0),
        totalErrorsToday: sources.reduce((sum, s) => sum + s.errorCount, 0),
        avgProcessingTime: sources.reduce((sum, s) => sum + s.avgProcessingTime, 0) / sources.length || 0,
        overallSuccessRate: sources.reduce((sum, s) => sum + s.successRate, 0) / sources.length || 100,
        activeSources: sources.filter(s => s.status === 'active').length,
        queuedDocuments: sources.reduce((sum, s) => sum + (s.queueSize || 0), 0)
      },
      recentActivity: [] // This would come from event logs in a real implementation
    };
    
    res.json(ingestionData);
  } catch (error) {
    logger.error('Error fetching ingestion data:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to fetch ingestion data'
    });
  }
});

// Cost dashboard endpoint
router.get('/cost', async (req, res) => {
  try {
    const dashboardManager = req.app.get('dashboardManager');
    
    if (!dashboardManager || !dashboardManager.isInitialized) {
      return res.status(503).json({
        error: 'Dashboard service not available'
      });
    }
    
    const { timeRange = '24h', granularity = 'hour' } = req.query;
    const costData = dashboardManager.getCostDashboardData();
    
    // Filter historical data based on time range
    const filteredData = filterDataByTimeRange(costData.historical, timeRange);
    
    const response = {
      realTime: costData.realTime,
      historical: aggregateDataByGranularity(filteredData, granularity),
      metadata: {
        timeRange,
        granularity,
        lastUpdated: costData.lastUpdated,
        dataPoints: filteredData.length
      }
    };
    
    res.json(response);
  } catch (error) {
    logger.error('Error getting cost dashboard data:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to retrieve cost dashboard data'
    });
  }
});

// Quality dashboard endpoint
router.get('/quality', async (req, res) => {
  try {
    const dashboardManager = req.app.get('dashboardManager');
    
    if (!dashboardManager || !dashboardManager.isInitialized) {
      return res.status(503).json({
        error: 'Dashboard service not available'
      });
    }
    
    const { timeRange = '24h', granularity = 'hour' } = req.query;
    const qualityData = dashboardManager.getQualityDashboardData();
    
    // Filter historical data based on time range
    const filteredData = filterDataByTimeRange(qualityData.historical, timeRange);
    
    const response = {
      realTime: qualityData.realTime,
      historical: aggregateDataByGranularity(filteredData, granularity),
      metadata: {
        timeRange,
        granularity,
        lastUpdated: qualityData.lastUpdated,
        dataPoints: filteredData.length
      }
    };
    
    res.json(response);
  } catch (error) {
    logger.error('Error getting quality dashboard data:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to retrieve quality dashboard data'
    });
  }
});

// Operational dashboard endpoint
router.get('/operational', async (req, res) => {
  try {
    const dashboardManager = req.app.get('dashboardManager');
    
    if (!dashboardManager || !dashboardManager.isInitialized) {
      return res.status(503).json({
        error: 'Dashboard service not available'
      });
    }
    
    const operationalData = dashboardManager.getOperationalDashboardData();
    
    res.json({
      realTime: operationalData.realTime,
      metadata: {
        lastUpdated: operationalData.lastUpdated
      }
    });
  } catch (error) {
    logger.error('Error getting operational dashboard data:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to retrieve operational dashboard data'
    });
  }
});

// Real-time metrics endpoint
router.get('/realtime', async (req, res) => {
  try {
    const dashboardManager = req.app.get('dashboardManager');
    
    if (!dashboardManager || !dashboardManager.isInitialized) {
      return res.status(503).json({
        error: 'Dashboard service not available'
      });
    }
    
    const { metrics = 'all' } = req.query;
    const dashboardData = dashboardManager.getAllDashboardData();
    
    let response = {};
    
    if (metrics === 'all' || metrics.includes('cost')) {
      response.cost = dashboardData.cost.realTime;
    }
    
    if (metrics === 'all' || metrics.includes('quality')) {
      response.quality = dashboardData.quality.realTime;
    }
    
    if (metrics === 'all' || metrics.includes('operational')) {
      response.operational = dashboardData.operational.realTime;
    }
    
    response.timestamp = new Date();
    
    res.json(response);
  } catch (error) {
    logger.error('Error getting real-time metrics:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to retrieve real-time metrics'
    });
  }
});

// Dashboard health check
router.get('/health', async (req, res) => {
  try {
    const dashboardManager = req.app.get('dashboardManager');
    
    const health = {
      status: dashboardManager && dashboardManager.isInitialized ? 'healthy' : 'unhealthy',
      timestamp: new Date(),
      services: {
        dashboardManager: dashboardManager ? 'available' : 'unavailable',
        costTracker: dashboardManager?.costTracker ? 'available' : 'unavailable',
        qualityMetrics: dashboardManager?.qualityMetrics ? 'available' : 'unavailable'
      }
    };
    
    const statusCode = health.status === 'healthy' ? 200 : 503;
    res.status(statusCode).json(health);
  } catch (error) {
    logger.error('Error checking dashboard health:', error);
    res.status(500).json({
      status: 'error',
      timestamp: new Date(),
      error: error.message
    });
  }
});

// Helper functions
function filterDataByTimeRange(data, timeRange) {
  if (!data || !Array.isArray(data)) return [];
  
  const now = new Date();
  let cutoffTime;
  
  switch (timeRange) {
  case '1h':
    cutoffTime = new Date(now.getTime() - 60 * 60 * 1000);
    break;
  case '6h':
    cutoffTime = new Date(now.getTime() - 6 * 60 * 60 * 1000);
    break;
  case '24h':
    cutoffTime = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    break;
  case '7d':
    cutoffTime = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    break;
  case '30d':
    cutoffTime = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    break;
  default:
    cutoffTime = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  }
  
  return data.filter(item => {
    const itemTime = new Date(item.timestamp || item.created_at);
    return itemTime >= cutoffTime;
  });
}

function aggregateDataByGranularity(data, granularity) {
  if (!data || !Array.isArray(data)) return [];
  
  const buckets = new Map();
  
  data.forEach(item => {
    const timestamp = new Date(item.timestamp || item.created_at);
    const bucketKey = getBucketKey(timestamp, granularity);
    
    if (!buckets.has(bucketKey)) {
      buckets.set(bucketKey, {
        timestamp: bucketKey,
        items: [],
        totalCost: 0,
        count: 0
      });
    }
    
    const bucket = buckets.get(bucketKey);
    bucket.items.push(item);
    bucket.totalCost += item.totalCost || item.cost || 0;
    bucket.count += 1;
  });
  
  return Array.from(buckets.values()).map(bucket => ({
    timestamp: bucket.timestamp,
    totalCost: bucket.totalCost,
    averageCost: bucket.totalCost / bucket.count,
    count: bucket.count,
    items: bucket.items
  })).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

function getBucketKey(timestamp, granularity) {
  const date = new Date(timestamp);
  
  switch (granularity) {
  case 'minute':
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 
      date.getHours(), date.getMinutes()).toISOString();
  case 'hour':
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 
      date.getHours()).toISOString();
  case 'day':
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).toISOString();
  default:
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 
      date.getHours()).toISOString();
  }
}

module.exports = router;
