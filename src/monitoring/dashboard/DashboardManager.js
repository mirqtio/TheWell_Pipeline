/**
 * Dashboard Manager
 * 
 * Manages monitoring dashboards for cost, quality, and operational metrics.
 * Provides real-time data aggregation and visualization endpoints.
 */

const EventEmitter = require('events');
const logger = require('../../utils/logger');

class DashboardManager extends EventEmitter {
  constructor(costTracker, qualityMetrics, config = {}) {
    super();
    
    this.costTracker = costTracker;
    this.qualityMetrics = qualityMetrics;
    this.config = {
      refreshInterval: config.refreshInterval || 30000, // 30 seconds
      retentionHours: config.retentionHours || 24,
      enableRealTime: config.enableRealTime !== false,
      ...config
    };
    
    // Dashboard data cache
    this.dashboardData = {
      cost: {
        realTime: {},
        historical: [],
        lastUpdated: null
      },
      quality: {
        realTime: {},
        historical: [],
        lastUpdated: null
      },
      operational: {
        realTime: {},
        historical: [],
        lastUpdated: null
      }
    };
    
    this.isInitialized = false;
    this.refreshTimer = null;
  }

  async initialize() {
    try {
      logger.info('Initializing Dashboard Manager...');
      
      // Set up event listeners for real-time updates
      if (this.config.enableRealTime) {
        this.setupEventListeners();
      }
      
      // Initial data load
      await this.refreshAllDashboards();
      
      // Start periodic refresh
      this.startPeriodicRefresh();
      
      this.isInitialized = true;
      logger.info('Dashboard Manager initialized successfully');
      
      this.emit('initialized');
    } catch (error) {
      logger.error('Failed to initialize Dashboard Manager:', error);
      throw error;
    }
  }

  setupEventListeners() {
    // Listen for cost tracking events
    if (this.costTracker) {
      this.costTracker.on('costRecorded', (data) => {
        this.updateRealTimeCostData(data);
      });
      
      this.costTracker.on('budgetAlert', (alert) => {
        this.handleBudgetAlert(alert);
      });
    }
    
    // Listen for quality metric events
    if (this.qualityMetrics) {
      this.qualityMetrics.on('metricRecorded', (metric) => {
        this.updateRealTimeQualityData(metric);
      });
      
      this.qualityMetrics.on('sloViolation', (violation) => {
        this.handleSLOViolation(violation);
      });
    }
  }

  async refreshAllDashboards() {
    try {
      await Promise.all([
        this.refreshCostDashboard(),
        this.refreshQualityDashboard(),
        this.refreshOperationalDashboard()
      ]);
      
      logger.debug('All dashboards refreshed successfully');
    } catch (error) {
      logger.error('Error refreshing dashboards:', error);
      throw error;
    }
  }

  async refreshCostDashboard() {
    try {
      if (!this.costTracker) {
        logger.warn('Cost tracker not available for dashboard');
        return;
      }

      const now = new Date();
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      
      // Get current cost metrics
      const currentCosts = await this.costTracker.getCurrentCosts();
      const dailySpending = await this.costTracker.getDailySpending();
      const monthlySpending = await this.costTracker.getMonthlySpending();
      const providerBreakdown = await this.costTracker.getProviderBreakdown();
      const budgetStatus = await this.costTracker.getBudgetStatus();
      
      // Get historical data
      const historicalData = await this.costTracker.getCostHistory(oneDayAgo, now);
      
      this.dashboardData.cost = {
        realTime: {
          currentCosts,
          dailySpending,
          monthlySpending,
          providerBreakdown,
          budgetStatus,
          trends: this.calculateCostTrends(historicalData)
        },
        historical: historicalData,
        lastUpdated: now
      };
      
      this.emit('costDashboardUpdated', this.dashboardData.cost);
    } catch (error) {
      logger.error('Error refreshing cost dashboard:', error);
    }
  }

  async refreshQualityDashboard() {
    try {
      if (!this.qualityMetrics) {
        logger.warn('Quality metrics not available for dashboard');
        return;
      }

      const now = new Date();
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      
      // Get current quality metrics
      const currentMetrics = await this.qualityMetrics.getCurrentMetrics();
      const sloCompliance = await this.qualityMetrics.getSLOCompliance();
      const errorRates = await this.qualityMetrics.getErrorRates();
      const responseTimeMetrics = await this.qualityMetrics.getResponseTimeMetrics();
      
      // Get historical data
      const historicalData = await this.qualityMetrics.getMetricHistory(oneDayAgo, now);
      
      this.dashboardData.quality = {
        realTime: {
          currentMetrics,
          sloCompliance,
          errorRates,
          responseTimeMetrics,
          trends: this.calculateQualityTrends(historicalData)
        },
        historical: historicalData,
        lastUpdated: now
      };
      
      this.emit('qualityDashboardUpdated', this.dashboardData.quality);
    } catch (error) {
      logger.error('Error refreshing quality dashboard:', error);
    }
  }

  async refreshOperationalDashboard() {
    try {
      const now = new Date();
      
      // Combine operational metrics from various sources
      const systemHealth = await this.getSystemHealth();
      const throughputMetrics = await this.getThroughputMetrics();
      const resourceUtilization = await this.getResourceUtilization();
      
      this.dashboardData.operational = {
        realTime: {
          systemHealth,
          throughputMetrics,
          resourceUtilization,
          uptime: this.calculateUptime(),
          activeConnections: this.getActiveConnections()
        },
        historical: [],
        lastUpdated: now
      };
      
      this.emit('operationalDashboardUpdated', this.dashboardData.operational);
    } catch (error) {
      logger.error('Error refreshing operational dashboard:', error);
    }
  }

  calculateCostTrends(historicalData) {
    if (!historicalData || historicalData.length < 2) {
      return { trend: 'stable', change: 0 };
    }
    
    const recent = historicalData.slice(-6); // Last 6 data points
    const older = historicalData.slice(-12, -6); // Previous 6 data points
    
    const recentAvg = recent.reduce((sum, d) => sum + d.totalCost, 0) / recent.length;
    const olderAvg = older.reduce((sum, d) => sum + d.totalCost, 0) / older.length;
    
    const change = ((recentAvg - olderAvg) / olderAvg) * 100;
    
    return {
      trend: change > 5 ? 'increasing' : change < -5 ? 'decreasing' : 'stable',
      change: Math.round(change * 100) / 100
    };
  }

  calculateQualityTrends(historicalData) {
    if (!historicalData || historicalData.length < 2) {
      return { trend: 'stable', change: 0 };
    }
    
    // Calculate error rate trend
    const recent = historicalData.slice(-6);
    const older = historicalData.slice(-12, -6);
    
    const recentErrorRate = recent.reduce((sum, d) => sum + (d.errorRate || 0), 0) / recent.length;
    const olderErrorRate = older.reduce((sum, d) => sum + (d.errorRate || 0), 0) / older.length;
    
    const change = ((recentErrorRate - olderErrorRate) / (olderErrorRate || 1)) * 100;
    
    return {
      trend: change > 5 ? 'degrading' : change < -5 ? 'improving' : 'stable',
      change: Math.round(change * 100) / 100
    };
  }

  async getSystemHealth() {
    // Placeholder for system health metrics
    return {
      status: 'healthy',
      services: {
        database: 'healthy',
        cache: 'healthy',
        queue: 'healthy',
        llm_providers: 'healthy'
      },
      lastCheck: new Date()
    };
  }

  async getThroughputMetrics() {
    // Placeholder for throughput metrics
    return {
      requestsPerMinute: 0,
      documentsProcessed: 0,
      averageProcessingTime: 0
    };
  }

  async getResourceUtilization() {
    // Placeholder for resource utilization
    return {
      cpu: 0,
      memory: 0,
      disk: 0,
      network: 0
    };
  }

  calculateUptime() {
    // Placeholder for uptime calculation
    return {
      percentage: 99.9,
      duration: '30d 12h 45m'
    };
  }

  getActiveConnections() {
    // Placeholder for active connections
    return {
      total: 0,
      database: 0,
      websocket: 0
    };
  }

  updateRealTimeCostData(data) {
    if (!this.dashboardData.cost.realTime) return;
    
    // Update real-time cost data
    this.dashboardData.cost.realTime.currentCosts = data;
    this.dashboardData.cost.lastUpdated = new Date();
    
    this.emit('realTimeCostUpdate', data);
  }

  updateRealTimeQualityData(metric) {
    if (!this.dashboardData.quality.realTime) return;
    
    // Update real-time quality data
    this.dashboardData.quality.realTime.currentMetrics = metric;
    this.dashboardData.quality.lastUpdated = new Date();
    
    this.emit('realTimeQualityUpdate', metric);
  }

  handleBudgetAlert(alert) {
    logger.warn('Budget alert received:', alert);
    this.emit('budgetAlert', alert);
  }

  handleSLOViolation(violation) {
    logger.warn('SLO violation detected:', violation);
    this.emit('sloViolation', violation);
  }

  startPeriodicRefresh() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
    }
    
    this.refreshTimer = setInterval(async () => {
      try {
        await this.refreshAllDashboards();
      } catch (error) {
        logger.error('Error in periodic dashboard refresh:', error);
      }
    }, this.config.refreshInterval);
  }

  stopPeriodicRefresh() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  // Dashboard data getters
  getCostDashboardData() {
    return this.dashboardData.cost;
  }

  getQualityDashboardData() {
    return this.dashboardData.quality;
  }

  getOperationalDashboardData() {
    return this.dashboardData.operational;
  }

  getAllDashboardData() {
    return {
      cost: this.dashboardData.cost,
      quality: this.dashboardData.quality,
      operational: this.dashboardData.operational,
      lastRefresh: new Date()
    };
  }

  async shutdown() {
    try {
      logger.info('Shutting down Dashboard Manager...');
      
      this.stopPeriodicRefresh();
      this.removeAllListeners();
      
      this.isInitialized = false;
      logger.info('Dashboard Manager shut down successfully');
    } catch (error) {
      logger.error('Error shutting down Dashboard Manager:', error);
    }
  }
}

module.exports = DashboardManager;
