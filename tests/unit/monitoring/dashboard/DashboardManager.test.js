/**
 * Unit tests for DashboardManager
 */

// Mock logger before importing DashboardManager
jest.mock('../../../../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn()
}));

const DashboardManager = require('../../../../src/monitoring/dashboard/DashboardManager');

describe('DashboardManager', () => {
  let dashboardManager;
  let mockCostTracker;
  let mockQualityMetrics;

  beforeEach(() => {
    // Mock cost tracker
    mockCostTracker = {
      isInitialized: true,
      getCurrentCosts: jest.fn(),
      getDailySpending: jest.fn(),
      getMonthlySpending: jest.fn(),
      getProviderBreakdown: jest.fn(),
      getBudgetStatus: jest.fn(),
      getCostHistory: jest.fn(),
      on: jest.fn(),
      emit: jest.fn()
    };

    // Mock quality metrics
    mockQualityMetrics = {
      isInitialized: true,
      getCurrentMetrics: jest.fn(),
      getSLOCompliance: jest.fn(),
      getErrorRates: jest.fn(),
      getResponseTimeMetrics: jest.fn(),
      getMetricHistory: jest.fn(),
      on: jest.fn(),
      emit: jest.fn()
    };

    dashboardManager = new DashboardManager(mockCostTracker, mockQualityMetrics, {
      refreshInterval: 1000, // 1 second for testing
      enableRealTime: true
    });
  });

  afterEach(() => {
    if (dashboardManager) {
      dashboardManager.stopPeriodicRefresh();
      dashboardManager.removeAllListeners();
    }
    jest.clearAllMocks();
    jest.clearAllTimers();
  });

  describe('constructor', () => {
    it('should initialize with default config', () => {
      const manager = new DashboardManager();
      
      expect(manager.config.refreshInterval).toBe(30000);
      expect(manager.config.retentionHours).toBe(24);
      expect(manager.config.enableRealTime).toBe(true);
      expect(manager.isInitialized).toBe(false);
    });

    it('should initialize with custom config', () => {
      const config = {
        refreshInterval: 5000,
        retentionHours: 48,
        enableRealTime: false
      };
      
      const manager = new DashboardManager(null, null, config);
      
      expect(manager.config.refreshInterval).toBe(5000);
      expect(manager.config.retentionHours).toBe(48);
      expect(manager.config.enableRealTime).toBe(false);
    });

    it('should initialize dashboard data structure', () => {
      expect(dashboardManager.dashboardData).toEqual({
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
      });
    });
  });

  describe('initialize', () => {
    it('should initialize successfully', async () => {
      // Mock the refresh methods
      jest.spyOn(dashboardManager, 'refreshAllDashboards').mockResolvedValue();
      jest.spyOn(dashboardManager, 'setupEventListeners').mockImplementation();
      jest.spyOn(dashboardManager, 'startPeriodicRefresh').mockImplementation();

      const initSpy = jest.fn();
      dashboardManager.on('initialized', initSpy);

      await dashboardManager.initialize();

      expect(dashboardManager.setupEventListeners).toHaveBeenCalled();
      expect(dashboardManager.refreshAllDashboards).toHaveBeenCalled();
      expect(dashboardManager.startPeriodicRefresh).toHaveBeenCalled();
      expect(dashboardManager.isInitialized).toBe(true);
      expect(initSpy).toHaveBeenCalled();
    });

    it('should handle initialization errors', async () => {
      jest.spyOn(dashboardManager, 'refreshAllDashboards').mockRejectedValue(new Error('Refresh failed'));

      await expect(dashboardManager.initialize()).rejects.toThrow('Refresh failed');
      expect(dashboardManager.isInitialized).toBe(false);
    });
  });

  describe('setupEventListeners', () => {
    it('should set up cost tracker event listeners', () => {
      dashboardManager.setupEventListeners();

      expect(mockCostTracker.on).toHaveBeenCalledWith('costRecorded', expect.any(Function));
      expect(mockCostTracker.on).toHaveBeenCalledWith('budgetAlert', expect.any(Function));
    });

    it('should set up quality metrics event listeners', () => {
      dashboardManager.setupEventListeners();

      expect(mockQualityMetrics.on).toHaveBeenCalledWith('metricRecorded', expect.any(Function));
      expect(mockQualityMetrics.on).toHaveBeenCalledWith('sloViolation', expect.any(Function));
    });

    it('should handle missing cost tracker', () => {
      const manager = new DashboardManager(null, mockQualityMetrics);
      
      expect(() => manager.setupEventListeners()).not.toThrow();
      expect(mockQualityMetrics.on).toHaveBeenCalled();
    });

    it('should handle missing quality metrics', () => {
      const manager = new DashboardManager(mockCostTracker, null);
      
      expect(() => manager.setupEventListeners()).not.toThrow();
      expect(mockCostTracker.on).toHaveBeenCalled();
    });
  });

  describe('refreshCostDashboard', () => {
    beforeEach(() => {
      mockCostTracker.getCurrentCosts.mockResolvedValue({ total: 100 });
      mockCostTracker.getDailySpending.mockResolvedValue(50);
      mockCostTracker.getMonthlySpending.mockResolvedValue(1500);
      mockCostTracker.getProviderBreakdown.mockResolvedValue({ openai: 80, anthropic: 20 });
      mockCostTracker.getBudgetStatus.mockResolvedValue({ utilization: 0.75 });
      mockCostTracker.getCostHistory.mockResolvedValue([
        { timestamp: new Date(), totalCost: 10 },
        { timestamp: new Date(), totalCost: 15 }
      ]);
    });

    it('should refresh cost dashboard data', async () => {
      const emitSpy = jest.fn();
      dashboardManager.on('costDashboardUpdated', emitSpy);

      await dashboardManager.refreshCostDashboard();

      expect(mockCostTracker.getCurrentCosts).toHaveBeenCalled();
      expect(mockCostTracker.getDailySpending).toHaveBeenCalled();
      expect(mockCostTracker.getMonthlySpending).toHaveBeenCalled();
      expect(mockCostTracker.getProviderBreakdown).toHaveBeenCalled();
      expect(mockCostTracker.getBudgetStatus).toHaveBeenCalled();
      expect(mockCostTracker.getCostHistory).toHaveBeenCalled();

      expect(dashboardManager.dashboardData.cost.realTime).toEqual({
        currentCosts: { total: 100 },
        dailySpending: 50,
        monthlySpending: 1500,
        providerBreakdown: { openai: 80, anthropic: 20 },
        budgetStatus: { utilization: 0.75 },
        trends: expect.any(Object)
      });

      expect(dashboardManager.dashboardData.cost.lastUpdated).toBeInstanceOf(Date);
      expect(emitSpy).toHaveBeenCalledWith(dashboardManager.dashboardData.cost);
    });

    it('should handle missing cost tracker', async () => {
      const manager = new DashboardManager(null, mockQualityMetrics);
      
      await expect(manager.refreshCostDashboard()).resolves.not.toThrow();
    });

    it('should handle cost tracker errors', async () => {
      mockCostTracker.getCurrentCosts.mockRejectedValue(new Error('Cost tracker error'));
      
      await expect(dashboardManager.refreshCostDashboard()).resolves.not.toThrow();
    });
  });

  describe('refreshQualityDashboard', () => {
    beforeEach(() => {
      mockQualityMetrics.getCurrentMetrics.mockResolvedValue({ responseTime: 150 });
      mockQualityMetrics.getSLOCompliance.mockResolvedValue({ overall: 99.5 });
      mockQualityMetrics.getErrorRates.mockResolvedValue({ overall: 0.1 });
      mockQualityMetrics.getResponseTimeMetrics.mockResolvedValue({ average: 150, p95: 300 });
      mockQualityMetrics.getMetricHistory.mockResolvedValue([
        { timestamp: new Date(), errorRate: 0.1 },
        { timestamp: new Date(), errorRate: 0.2 }
      ]);
    });

    it('should refresh quality dashboard data', async () => {
      const emitSpy = jest.fn();
      dashboardManager.on('qualityDashboardUpdated', emitSpy);

      await dashboardManager.refreshQualityDashboard();

      expect(mockQualityMetrics.getCurrentMetrics).toHaveBeenCalled();
      expect(mockQualityMetrics.getSLOCompliance).toHaveBeenCalled();
      expect(mockQualityMetrics.getErrorRates).toHaveBeenCalled();
      expect(mockQualityMetrics.getResponseTimeMetrics).toHaveBeenCalled();
      expect(mockQualityMetrics.getMetricHistory).toHaveBeenCalled();

      expect(dashboardManager.dashboardData.quality.realTime).toEqual({
        currentMetrics: { responseTime: 150 },
        sloCompliance: { overall: 99.5 },
        errorRates: { overall: 0.1 },
        responseTimeMetrics: { average: 150, p95: 300 },
        trends: expect.any(Object)
      });

      expect(dashboardManager.dashboardData.quality.lastUpdated).toBeInstanceOf(Date);
      expect(emitSpy).toHaveBeenCalledWith(dashboardManager.dashboardData.quality);
    });

    it('should handle missing quality metrics', async () => {
      const manager = new DashboardManager(mockCostTracker, null);
      
      await expect(manager.refreshQualityDashboard()).resolves.not.toThrow();
    });

    it('should handle quality metrics errors', async () => {
      mockQualityMetrics.getCurrentMetrics.mockRejectedValue(new Error('Quality metrics error'));
      
      await expect(dashboardManager.refreshQualityDashboard()).resolves.not.toThrow();
    });
  });

  describe('refreshOperationalDashboard', () => {
    it('should refresh operational dashboard data', async () => {
      const emitSpy = jest.fn();
      dashboardManager.on('operationalDashboardUpdated', emitSpy);

      await dashboardManager.refreshOperationalDashboard();

      expect(dashboardManager.dashboardData.operational.realTime).toEqual({
        systemHealth: expect.any(Object),
        throughputMetrics: expect.any(Object),
        resourceUtilization: expect.any(Object),
        uptime: expect.any(Object),
        activeConnections: expect.any(Object)
      });

      expect(dashboardManager.dashboardData.operational.lastUpdated).toBeInstanceOf(Date);
      expect(emitSpy).toHaveBeenCalledWith(dashboardManager.dashboardData.operational);
    });
  });

  describe('calculateCostTrends', () => {
    it('should calculate increasing trend', () => {
      const historicalData = [
        { totalCost: 10 }, { totalCost: 12 }, { totalCost: 14 },
        { totalCost: 16 }, { totalCost: 18 }, { totalCost: 20 },
        { totalCost: 22 }, { totalCost: 24 }, { totalCost: 26 },
        { totalCost: 28 }, { totalCost: 30 }, { totalCost: 32 }
      ];

      const trends = dashboardManager.calculateCostTrends(historicalData);
      
      expect(trends.trend).toBe('increasing');
      expect(trends.change).toBeGreaterThan(5);
    });

    it('should calculate stable trend', () => {
      const historicalData = [
        { totalCost: 20 }, { totalCost: 21 }, { totalCost: 19 },
        { totalCost: 20 }, { totalCost: 22 }, { totalCost: 18 },
        { totalCost: 20 }, { totalCost: 21 }, { totalCost: 19 },
        { totalCost: 20 }, { totalCost: 22 }, { totalCost: 18 }
      ];

      const trends = dashboardManager.calculateCostTrends(historicalData);
      
      expect(trends.trend).toBe('stable');
      expect(Math.abs(trends.change)).toBeLessThanOrEqual(5);
    });

    it('should handle insufficient data', () => {
      const trends = dashboardManager.calculateCostTrends([{ totalCost: 10 }]);
      
      expect(trends.trend).toBe('stable');
      expect(trends.change).toBe(0);
    });

    it('should handle empty data', () => {
      const trends = dashboardManager.calculateCostTrends([]);
      
      expect(trends.trend).toBe('stable');
      expect(trends.change).toBe(0);
    });
  });

  describe('calculateQualityTrends', () => {
    it('should calculate improving trend', () => {
      const historicalData = [
        { errorRate: 5 }, { errorRate: 4.5 }, { errorRate: 4 },
        { errorRate: 3.5 }, { errorRate: 3 }, { errorRate: 2.5 },
        { errorRate: 2 }, { errorRate: 1.5 }, { errorRate: 1 },
        { errorRate: 0.8 }, { errorRate: 0.6 }, { errorRate: 0.4 }
      ];

      const trends = dashboardManager.calculateQualityTrends(historicalData);
      
      expect(trends.trend).toBe('improving');
      expect(trends.change).toBeLessThan(-5);
    });

    it('should calculate degrading trend', () => {
      const historicalData = [
        { errorRate: 0.5 }, { errorRate: 0.7 }, { errorRate: 0.9 },
        { errorRate: 1.1 }, { errorRate: 1.3 }, { errorRate: 1.5 },
        { errorRate: 1.7 }, { errorRate: 1.9 }, { errorRate: 2.1 },
        { errorRate: 2.3 }, { errorRate: 2.5 }, { errorRate: 2.7 }
      ];

      const trends = dashboardManager.calculateQualityTrends(historicalData);
      
      expect(trends.trend).toBe('degrading');
      expect(trends.change).toBeGreaterThan(5);
    });

    it('should handle insufficient data', () => {
      const trends = dashboardManager.calculateQualityTrends([{ errorRate: 1 }]);
      
      expect(trends.trend).toBe('stable');
      expect(trends.change).toBe(0);
    });
  });

  describe('real-time updates', () => {
    it('should update real-time cost data', () => {
      const costData = { provider: 'openai', cost: 0.05 };
      const emitSpy = jest.fn();
      dashboardManager.on('realTimeCostUpdate', emitSpy);

      dashboardManager.updateRealTimeCostData(costData);

      expect(dashboardManager.dashboardData.cost.realTime.currentCosts).toEqual(costData);
      expect(dashboardManager.dashboardData.cost.lastUpdated).toBeInstanceOf(Date);
      expect(emitSpy).toHaveBeenCalledWith(costData);
    });

    it('should update real-time quality data', () => {
      const qualityData = { responseTime: 120, errorRate: 0.05 };
      const emitSpy = jest.fn();
      dashboardManager.on('realTimeQualityUpdate', emitSpy);

      dashboardManager.updateRealTimeQualityData(qualityData);

      expect(dashboardManager.dashboardData.quality.realTime.currentMetrics).toEqual(qualityData);
      expect(dashboardManager.dashboardData.quality.lastUpdated).toBeInstanceOf(Date);
      expect(emitSpy).toHaveBeenCalledWith(qualityData);
    });

    it('should handle budget alerts', () => {
      const alert = { type: 'budget', threshold: 'daily', utilization: 0.9 };
      const emitSpy = jest.fn();
      dashboardManager.on('budgetAlert', emitSpy);

      dashboardManager.handleBudgetAlert(alert);

      expect(emitSpy).toHaveBeenCalledWith(alert);
    });

    it('should handle SLO violations', () => {
      const violation = { slo: 'response_time', threshold: 2000, actual: 2500 };
      const emitSpy = jest.fn();
      dashboardManager.on('sloViolation', emitSpy);

      dashboardManager.handleSLOViolation(violation);

      expect(emitSpy).toHaveBeenCalledWith(violation);
    });
  });

  describe('data getters', () => {
    beforeEach(() => {
      dashboardManager.dashboardData.cost.realTime = { dailySpending: 50 };
      dashboardManager.dashboardData.quality.realTime = { errorRate: 0.1 };
      dashboardManager.dashboardData.operational.realTime = { uptime: 99.9 };
    });

    it('should get cost dashboard data', () => {
      const costData = dashboardManager.getCostDashboardData();
      
      expect(costData).toEqual(dashboardManager.dashboardData.cost);
      expect(costData.realTime.dailySpending).toBe(50);
    });

    it('should get quality dashboard data', () => {
      const qualityData = dashboardManager.getQualityDashboardData();
      
      expect(qualityData).toEqual(dashboardManager.dashboardData.quality);
      expect(qualityData.realTime.errorRate).toBe(0.1);
    });

    it('should get operational dashboard data', () => {
      const operationalData = dashboardManager.getOperationalDashboardData();
      
      expect(operationalData).toEqual(dashboardManager.dashboardData.operational);
      expect(operationalData.realTime.uptime).toBe(99.9);
    });

    it('should get all dashboard data', () => {
      const allData = dashboardManager.getAllDashboardData();
      
      expect(allData).toEqual({
        cost: dashboardManager.dashboardData.cost,
        quality: dashboardManager.dashboardData.quality,
        operational: dashboardManager.dashboardData.operational,
        lastRefresh: expect.any(Date)
      });
    });
  });

  describe('periodic refresh', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should start periodic refresh', () => {
      jest.spyOn(dashboardManager, 'refreshAllDashboards').mockResolvedValue();
      
      dashboardManager.startPeriodicRefresh();
      
      expect(dashboardManager.refreshTimer).toBeTruthy();
      
      // Fast-forward time and verify refresh is called
      jest.advanceTimersByTime(1000);
      
      expect(dashboardManager.refreshAllDashboards).toHaveBeenCalled();
    });

    it('should stop periodic refresh', () => {
      dashboardManager.startPeriodicRefresh();
      const timerId = dashboardManager.refreshTimer;
      
      dashboardManager.stopPeriodicRefresh();
      
      expect(dashboardManager.refreshTimer).toBeNull();
    });

    it('should handle refresh errors gracefully', () => {
      jest.spyOn(dashboardManager, 'refreshAllDashboards').mockRejectedValue(new Error('Refresh error'));
      
      dashboardManager.startPeriodicRefresh();
      
      // Should not throw
      expect(() => {
        jest.advanceTimersByTime(1000);
      }).not.toThrow();
    });
  });

  describe('shutdown', () => {
    it('should shutdown gracefully', async () => {
      jest.spyOn(dashboardManager, 'stopPeriodicRefresh');
      jest.spyOn(dashboardManager, 'removeAllListeners');
      
      dashboardManager.isInitialized = true;
      
      await dashboardManager.shutdown();
      
      expect(dashboardManager.stopPeriodicRefresh).toHaveBeenCalled();
      expect(dashboardManager.removeAllListeners).toHaveBeenCalled();
      expect(dashboardManager.isInitialized).toBe(false);
    });

    it('should handle shutdown errors', async () => {
      const stopRefreshSpy = jest.spyOn(dashboardManager, 'stopPeriodicRefresh').mockImplementation(() => {
        throw new Error('Shutdown error');
      });
      
      // Should not throw despite internal error - the shutdown method catches errors
      await expect(dashboardManager.shutdown()).resolves.not.toThrow();
      expect(dashboardManager.isInitialized).toBe(false);
      
      // Restore the spy to avoid issues in afterEach
      stopRefreshSpy.mockRestore();
    });
  });
});
