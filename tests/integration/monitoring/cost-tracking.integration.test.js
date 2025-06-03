const CostTracker = require('../../../src/monitoring/CostTracker');
const CostDAO = require('../../../src/monitoring/CostDAO');
const CostReporter = require('../../../src/monitoring/CostReporter');

describe('Cost Tracking Integration', () => {
  let costTracker;
  let costReporter;
  let mockDAO;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Create comprehensive mock DAO for integration testing
    mockDAO = {
      initialize: jest.fn().mockResolvedValue(),
      close: jest.fn().mockResolvedValue(),
      saveCostEvent: jest.fn().mockImplementation((event) => {
        // Don't recalculate costs - use the ones provided by CostTracker
        return Promise.resolve({
          ...event,
          id: `event-${Date.now()}-${Math.random()}`,
          timestamp: new Date(),
          createdAt: new Date()
        });
      }),
      getCostEvents: jest.fn().mockResolvedValue([]),
      getDailyCosts: jest.fn().mockResolvedValue([]),
      getMonthlyCosts: jest.fn().mockResolvedValue([]),
      getProviderCosts: jest.fn().mockResolvedValue([]),
      saveBudget: jest.fn().mockImplementation((budget) => 
        Promise.resolve({ id: budget.id || `budget-${Date.now()}` })
      ),
      getBudgets: jest.fn().mockResolvedValue([]),
      saveAlert: jest.fn().mockImplementation((alert) => 
        Promise.resolve({ id: alert.id || `alert-${Date.now()}` })
      ),
      getAlerts: jest.fn().mockResolvedValue([]),
      getActiveBudgets: jest.fn().mockResolvedValue([]),
      getBudgetSpending: jest.fn().mockResolvedValue({ currentSpending: 45, eventCount: 1 }), // 90% spending
      getDailyTotals: jest.fn().mockResolvedValue([]),
      getMonthlyTotals: jest.fn().mockResolvedValue([]),
      getStats: jest.fn().mockResolvedValue({
        total_events: 0,
        total_cost: 0,
        earliest_event: null,
        latest_event: null
      }),
      cleanup: jest.fn().mockResolvedValue({ deleted_count: 0 }),
      getCostSummary: jest.fn().mockResolvedValue([]),
      saveCostAlert: jest.fn().mockResolvedValue({ id: 'alert-1' }),
      saveCostReport: jest.fn().mockResolvedValue({ id: 'report-1' })
    };
  });

  afterEach(async () => {
    // Clean up resources
    if (costTracker) {
      await costTracker.close();
    }
    // CostReporter doesn't have a close method, just clear the reference
    if (costReporter) {
      costReporter = null;
    }
  });

  describe('End-to-End Cost Tracking Workflow', () => {
    test('should track costs and generate reports successfully', async () => {
      // Initialize cost tracker with mock DAO
      costTracker = new CostTracker({ dao: mockDAO });
      await costTracker.initialize();
      
      // Track multiple cost events
      const events = [
        {
          provider: 'openai',
          model: 'gpt-4',
          inputTokens: 1000,
          outputTokens: 500,
          documentId: 'doc-1',
          userId: 'user-1',
          operation: 'enrichment'
        },
        {
          provider: 'anthropic',
          model: 'claude-3-opus',
          inputTokens: 1500,
          outputTokens: 750,
          documentId: 'doc-2',
          userId: 'user-1',
          operation: 'analysis'
        },
        {
          provider: 'openai',
          model: 'gpt-3.5-turbo',
          inputTokens: 2000,
          outputTokens: 1000,
          documentId: 'doc-3',
          userId: 'user-2',
          operation: 'summarization'
        }
      ];
      
      const trackedEvents = [];
      for (const event of events) {
        const result = await costTracker.trackCostEvent(event);
        trackedEvents.push(result);
      }
      
      // Verify all events were tracked
      expect(trackedEvents).toHaveLength(3);
      expect(mockDAO.saveCostEvent).toHaveBeenCalledTimes(3);
      
      // Verify cost calculations
      expect(trackedEvents[0].totalCost).toBeCloseTo(0.06, 5); // GPT-4: (1000/1000)*0.03 + (500/1000)*0.06 = 0.06
      expect(trackedEvents[1].totalCost).toBeCloseTo(0.07875, 5); // Claude-3-opus: (1500/1000)*0.015 + (750/1000)*0.075 = 0.07875
      expect(trackedEvents[2].totalCost).toBeCloseTo(0.0025, 5); // GPT-3.5-turbo: (2000/1000)*0.0005 + (1000/1000)*0.0015 = 0.0025
      
      // Verify in-memory caches are updated
      expect(costTracker.costRecords).toHaveLength(3);
      expect(costTracker.providerTotals.get('openai')).toBeCloseTo(0.0625, 5); // 0.06 + 0.0025
      expect(costTracker.providerTotals.get('anthropic')).toBeCloseTo(0.07875, 5);
    });

    test('should initialize and load budgets correctly', async () => {
      const mockBudgets = [
        {
          id: 'daily-budget-1',
          name: 'Daily Budget',
          budgetType: 'daily',
          limitAmount: 50,
          alertThreshold: 0.8, // 80% threshold
          isActive: true
        }
      ];

      mockDAO.getActiveBudgets.mockResolvedValue(mockBudgets);
      
      const tracker = new CostTracker({ 
        dao: mockDAO,
        enablePersistence: true 
      });

      await tracker.initialize();
      
      expect(mockDAO.getActiveBudgets).toHaveBeenCalled();
      expect(tracker.budgets.size).toBe(1);
      expect(tracker.budgets.has('daily-budget-1')).toBe(true);
    });

    test('should check budget limits correctly', async () => {
      const mockBudgets = [
        {
          id: 'daily-budget-1',
          name: 'Daily Budget',
          budgetType: 'daily',
          limitAmount: 50,
          alertThreshold: 0.8, // 80% threshold
          isActive: true
        }
      ];

      mockDAO.getActiveBudgets.mockResolvedValue(mockBudgets);
      
      const tracker = new CostTracker({ 
        dao: mockDAO,
        enablePersistence: true 
      });

      await tracker.initialize();
      
      // Set up alert listener
      let alertReceived = null;
      tracker.on('budgetAlert', (alert) => {
        alertReceived = alert;
      });
      
      // Manually call checkBudgetLimits to test the logic
      await tracker.checkBudgetLimits({
        provider: 'openai',
        model: 'gpt-4',
        totalCost: 5
      });
      
      expect(alertReceived).not.toBeNull();
      expect(alertReceived.budgetId).toBe('daily-budget-1');
      expect(alertReceived.percentage).toBeGreaterThan(80);
    });

    test('should handle budget management workflow', async () => {
      // Mock budgets that would be loaded from database
      const mockBudgets = [
        {
          id: 'daily-budget-1',
          name: 'Daily Budget',
          budgetType: 'daily',
          limitAmount: 50,
          alertThreshold: 0.8, // 80% threshold
          isActive: true
        },
        {
          id: 'monthly-budget-1', 
          name: 'Monthly Budget',
          budgetType: 'monthly',
          limitAmount: 1000,
          alertThreshold: 0.9,
          isActive: true
        }
      ];

      mockDAO.getActiveBudgets.mockResolvedValue(mockBudgets);
      
      costTracker = new CostTracker({ 
        dao: mockDAO,
        enablePersistence: true // Enable persistence for budget checking
      });

      console.log('CostTracker created, initializing...');
      
      try {
        await costTracker.initialize();
        
        expect(mockDAO.getActiveBudgets).toHaveBeenCalled();
        console.log('Budgets loaded:', costTracker.budgets.size);
        console.log('Budget IDs:', Array.from(costTracker.budgets.keys()));
        
        // Set up alert listener before tracking costs
        const alertPromise = new Promise((resolve) => {
          costTracker.once('budgetAlert', resolve);
        });

        console.log('Alert listener set up, tracking cost event...');
        
        // Track a high-cost event that should trigger alert
        await costTracker.trackCostEvent({
          provider: 'openai',
          model: 'gpt-4',
          inputTokens: 1000,
          outputTokens: 500,
          operation: 'test-operation',
          sourceType: 'document',
          documentId: 'test-doc-1'
        });

        console.log('Cost event tracked, waiting for alert...');
        
        // Wait for alert
        const alert = await Promise.race([
          alertPromise,
          new Promise((_, reject) => setTimeout(() => reject(new Error('Alert timeout')), 5000))
        ]);
        expect(alert).toHaveProperty('budgetId');
        expect(alert).toHaveProperty('alertType');
        expect(alert).toHaveProperty('currentAmount');
        expect(alert).toHaveProperty('limitAmount');
        expect(alert).toHaveProperty('percentage');
        expect(alert).toHaveProperty('message');
      } catch (error) {
        console.error('Test error:', error);
        throw error;
      }
    });

    test('should generate comprehensive reports', async () => {
      // Set up mock data for reporting
      const mockEvents = [
        {
          id: 'event-1',
          provider: 'openai',
          model: 'gpt-4',
          totalCost: 0.05,
          inputTokens: 1000,
          outputTokens: 500,
          operation: 'enrichment',
          timestamp: new Date('2023-12-01T10:00:00Z')
        },
        {
          id: 'event-2',
          provider: 'anthropic',
          model: 'claude-3-opus',
          totalCost: 0.08,
          inputTokens: 1500,
          outputTokens: 750,
          operation: 'analysis',
          timestamp: new Date('2023-12-01T14:00:00Z')
        }
      ];
      
      const mockDailyCosts = [
        { date: new Date('2023-12-01'), totalCost: 0.13, eventCount: 2 }
      ];
      
      mockDAO.getCostEvents.mockResolvedValue(mockEvents);
      mockDAO.getDailyCosts.mockResolvedValue(mockDailyCosts);
      
      // Initialize reporter
      costReporter = new CostReporter({ dao: mockDAO });
      await costReporter.initialize();
      
      // Generate daily report
      const dailyReport = await costReporter.generateReport({
        reportType: 'daily',
        startDate: new Date('2023-12-01'),
        endDate: new Date('2023-12-01'),
        format: 'object'
      });
      
      expect(dailyReport).toHaveProperty('reportType', 'daily');
      expect(dailyReport).toHaveProperty('date', new Date('2023-12-01'));
      expect(dailyReport.summary).toHaveProperty('totalCost', 0.13);
      expect(dailyReport.summary).toHaveProperty('eventCount', 2);
      expect(dailyReport).toHaveProperty('providerBreakdown');
      expect(dailyReport).toHaveProperty('modelBreakdown');
      
      // Verify provider breakdown
      expect(dailyReport.providerBreakdown).toHaveProperty('openai');
      expect(dailyReport.providerBreakdown).toHaveProperty('anthropic');
      expect(dailyReport.providerBreakdown.openai.totalCost).toBe(0.05);
      expect(dailyReport.providerBreakdown.anthropic.totalCost).toBe(0.08);
    });
  });

  describe('Error Recovery and Resilience', () => {
    test('should handle partial failures gracefully', async () => {
      // Set up DAO that fails on some operations
      const flakyDAO = {
        ...mockDAO,
        saveCostEvent: jest.fn()
          .mockResolvedValueOnce({ id: 'event-1' }) // First call succeeds
          .mockRejectedValueOnce(new Error('Database error')) // Second call fails
          .mockResolvedValueOnce({ id: 'event-3' }) // Third call succeeds
      };
      
      costTracker = new CostTracker({ dao: flakyDAO });
      await costTracker.initialize();
      
      const events = [
        { provider: 'openai', model: 'gpt-4', inputTokens: 1000, outputTokens: 500 },
        { provider: 'anthropic', model: 'claude-3-opus', inputTokens: 1000, outputTokens: 500 },
        { provider: 'openai', model: 'gpt-3.5-turbo', inputTokens: 1000, outputTokens: 500 }
      ];
      
      // Track events, expecting one to fail
      const results = [];
      for (const event of events) {
        try {
          const result = await costTracker.trackCostEvent(event);
          results.push(result);
        } catch (error) {
          results.push({ error: error.message });
        }
      }
      
      expect(results).toHaveLength(3);
      expect(results[0]).toHaveProperty('id', 'event-1');
      expect(results[1]).toHaveProperty('error', 'Database error');
      expect(results[2]).toHaveProperty('id', 'event-3');
      
      // Verify in-memory state is consistent despite failure
      expect(costTracker.costRecords).toHaveLength(2); // Only successful events
    });

    test('should handle concurrent cost tracking', async () => {
      costTracker = new CostTracker({ dao: mockDAO });
      await costTracker.initialize();
      
      // Create multiple concurrent cost tracking operations
      const concurrentEvents = Array.from({ length: 10 }, (_, i) => ({
        provider: i % 2 === 0 ? 'openai' : 'anthropic',
        model: i % 2 === 0 ? 'gpt-4' : 'claude-3-opus',
        inputTokens: 1000,
        outputTokens: 500,
        documentId: `doc-${i}`,
        operation: `operation-${i}`
      }));
      
      // Track all events concurrently
      const promises = concurrentEvents.map(event => costTracker.trackCostEvent(event));
      const results = await Promise.all(promises);
      
      expect(results).toHaveLength(10);
      expect(mockDAO.saveCostEvent).toHaveBeenCalledTimes(10);
      
      // Verify all events have unique IDs
      const ids = results.map(r => r.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(10);
      
      // Verify in-memory state is consistent
      expect(costTracker.costRecords).toHaveLength(10);
    });
  });

  describe('Data Consistency and Validation', () => {
    test('should maintain data consistency between tracker and reporter', async () => {
      // Use shared DAO instance
      const sharedDAO = mockDAO;
      
      costTracker = new CostTracker({ dao: sharedDAO });
      costReporter = new CostReporter({ dao: sharedDAO });
      
      await costTracker.initialize();
      await costReporter.initialize();
      
      // Track some events
      const events = [
        { provider: 'openai', model: 'gpt-4', inputTokens: 1000, outputTokens: 500 },
        { provider: 'anthropic', model: 'claude-3-opus', inputTokens: 1500, outputTokens: 750 }
      ];
      
      for (const event of events) {
        await costTracker.trackCostEvent(event);
      }
      
      // Mock the DAO to return the tracked events for reporting
      const trackedEvents = costTracker.costRecords.map(record => ({
        ...record,
        totalCost: record.totalCost
      }));
      
      sharedDAO.getCostEvents.mockResolvedValue(trackedEvents);
      sharedDAO.getDailyCosts.mockResolvedValue([
        { 
          date: new Date().toISOString().split('T')[0], 
          totalCost: trackedEvents.reduce((sum, e) => sum + e.totalCost, 0),
          eventCount: trackedEvents.length
        }
      ]);
      
      // Generate report and verify consistency
      const today = new Date();
      const report = await costReporter.generateReport({
        reportType: 'daily',
        startDate: today,
        endDate: today,
        format: 'object'
      });
      
      const expectedTotalCost = trackedEvents.reduce((sum, e) => sum + e.totalCost, 0);
      expect(report.summary.totalCost).toBe(expectedTotalCost);
      expect(report.summary.eventCount).toBe(trackedEvents.length);
    });

    test('should validate cost calculations across different scenarios', async () => {
      costTracker = new CostTracker({ dao: mockDAO });
      await costTracker.initialize();
      
      // Test various cost calculation scenarios
      const testCases = [
        {
          usage: { provider: 'openai', model: 'gpt-4', inputTokens: 1000, outputTokens: 500 },
          expectedCost: 0.06 // (1000/1000)*0.03 + (500/1000)*0.06 = 0.06
        },
        {
          usage: { provider: 'anthropic', model: 'claude-3-opus', inputTokens: 2000, outputTokens: 1000 },
          expectedCost: 0.105 // (2000/1000)*0.015 + (1000/1000)*0.075 = 0.105
        },
        {
          usage: { provider: 'openai', model: 'gpt-3.5-turbo', inputTokens: 10000, outputTokens: 5000 },
          expectedCost: 0.0125 // (10000/1000)*0.0005 + (5000/1000)*0.0015 = 0.0125
        },
        {
          usage: { provider: 'unknown', model: 'unknown-model', inputTokens: 1000, outputTokens: 500 },
          expectedCost: 0 // Unknown provider returns 0 cost
        }
      ];
      
      for (const testCase of testCases) {
        const result = await costTracker.trackCostEvent(testCase.usage);
        expect(result.totalCost).toBeCloseTo(testCase.expectedCost, 5);
      }
    });
  });

  describe('Performance and Scalability', () => {
    test('should handle large volumes of cost events efficiently', async () => {
      costTracker = new CostTracker({ dao: mockDAO });
      await costTracker.initialize();
      
      const startTime = Date.now();
      
      // Track a large number of events
      const eventCount = 1000;
      const promises = [];
      
      for (let i = 0; i < eventCount; i++) {
        const event = {
          provider: i % 3 === 0 ? 'openai' : i % 3 === 1 ? 'anthropic' : 'cohere',
          model: 'test-model',
          inputTokens: 100,
          outputTokens: 50,
          documentId: `doc-${i}`,
          operation: 'test'
        };
        
        promises.push(costTracker.trackCostEvent(event));
      }
      
      const results = await Promise.all(promises);
      const endTime = Date.now();
      
      expect(results).toHaveLength(eventCount);
      expect(mockDAO.saveCostEvent).toHaveBeenCalledTimes(eventCount);
      
      // Verify performance (should complete within reasonable time)
      const duration = endTime - startTime;
      expect(duration).toBeLessThan(10000); // Less than 10 seconds
      
      // Verify memory usage is reasonable
      expect(costTracker.costRecords).toHaveLength(eventCount);
      expect(costTracker.providerTotals.size).toBe(3);
    });
  });
});
