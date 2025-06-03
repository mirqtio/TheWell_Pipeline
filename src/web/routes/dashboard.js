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
