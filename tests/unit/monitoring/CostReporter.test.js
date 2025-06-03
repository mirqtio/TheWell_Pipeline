const CostReporter = require('../../../src/monitoring/CostReporter');
const CostDAO = require('../../../src/monitoring/CostDAO');

// Mock the CostDAO
jest.mock('../../../src/monitoring/CostDAO');

describe('CostReporter', () => {
  let costReporter;
  let mockDAO;

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();
    
    // Create mock DAO with the actual methods that CostReporter calls
    mockDAO = {
      initialize: jest.fn().mockResolvedValue(true),
      getCostEvents: jest.fn().mockResolvedValue([]),
      getCostSummary: jest.fn().mockResolvedValue({
        totalCost: 0.13,
        totalTokens: 1500,
        recordCount: 2,
        byProvider: {
          'openai': { cost: 0.08, tokens: 1000, count: 1 },
          'anthropic': { cost: 0.05, tokens: 500, count: 1 }
        },
        byModel: {
          'gpt-4': { cost: 0.08, tokens: 1000, count: 1 },
          'claude-3-opus': { cost: 0.05, tokens: 500, count: 1 }
        },
        byOperation: {
          'enrichment': { cost: 0.13, tokens: 1500, count: 2 }
        },
        bySourceType: {
          'document': { cost: 0.13, tokens: 1500, count: 2 }
        }
      }),
      getActiveBudgets: jest.fn().mockResolvedValue([
        {
          type: 'daily',
          limit: 10.0,
          spent: 0.13,
          remaining: 9.87,
          percentage: 1.3
        }
      ]),
      getBudgetSpending: jest.fn().mockResolvedValue({
        daily: { spent: 8.5, limit: 10, remaining: 1.5, percentage: 85 },
        weekly: { spent: 45, limit: 50, remaining: 5, percentage: 90 },
        monthly: { spent: 180, limit: 200, remaining: 20, percentage: 90 }
      }),
      getDailyTotals: jest.fn().mockResolvedValue(new Map([
        ['2024-01-01', 0.08],
        ['2024-01-02', 0.05]
      ])),
      getMonthlyTotals: jest.fn().mockResolvedValue(new Map([
        ['2024-01', 0.13]
      ])),
      saveCostReport: jest.fn().mockResolvedValue({ id: 1 }),
      getDailyCosts: jest.fn().mockResolvedValue([]),
      getMonthlyCosts: jest.fn().mockResolvedValue([]),
      getProviderCosts: jest.fn().mockResolvedValue([]),
      getBudgetStatus: jest.fn().mockResolvedValue({ limit: 100, used: 50 }),
      close: jest.fn().mockResolvedValue()
    };
    
    // Mock the CostDAO constructor
    CostDAO.mockImplementation(() => mockDAO);
    
    // Create CostReporter instance
    costReporter = new CostReporter({
      enablePersistence: true
    });
  });

  afterEach(async () => {
    if (costReporter) {
      // CostReporter doesn't have a close method, just clear the reference
      costReporter = null;
    }
  });

  describe('Initialization', () => {
    test('should initialize with default configuration', () => {
      const reporter = new CostReporter();
      
      expect(reporter.config.enablePersistence).toBe(true);
      expect(reporter.config.defaultFormat).toBe('json');
    });

    test('should initialize with custom configuration', () => {
      const config = {
        enablePersistence: false,
        defaultFormat: 'csv',
        timezone: 'UTC'
      };
      
      const reporter = new CostReporter(config);
      
      expect(reporter.config.enablePersistence).toBe(false);
      expect(reporter.config.defaultFormat).toBe('csv');
      expect(reporter.config.timezone).toBe('UTC');
    });

    test('should initialize DAO when persistence enabled', async () => {
      await costReporter.initialize();
      
      expect(mockDAO.initialize).toHaveBeenCalled();
    });
  });

  describe('Report Generation', () => {
    beforeEach(async () => {
      await costReporter.initialize();
      
      // Mock cost events data
      const mockEvents = [
        {
          id: '1',
          timestamp: new Date('2023-12-01T10:00:00Z'),
          provider: 'openai',
          model: 'gpt-4',
          totalCost: 0.05,
          inputTokens: 1000,
          outputTokens: 500,
          sourceType: 'pdf',
          operation: 'enrichment'
        },
        {
          id: '2',
          timestamp: new Date('2023-12-01T11:00:00Z'),
          provider: 'anthropic',
          model: 'claude-3-opus',
          totalCost: 0.08,
          inputTokens: 1500,
          outputTokens: 750,
          sourceType: 'web',
          operation: 'completion'
        }
      ];
      
      mockDAO.getCostEvents.mockResolvedValue(mockEvents);
    });

    test('should generate basic report with default options', async () => {
      const report = await costReporter.generateReport({ format: 'object' });
      
      expect(report).toHaveProperty('metadata');
      expect(report).toHaveProperty('summary');
      expect(report).toHaveProperty('events');
      expect(report.metadata).toHaveProperty('generatedAt');
      expect(report.metadata).toHaveProperty('dateRange');
      expect(report.metadata).toHaveProperty('format');
    });

    test('should generate report for specific date range', async () => {
      const options = {
        startDate: new Date('2023-12-01'),
        endDate: new Date('2023-12-31'),
        groupBy: 'provider',
        format: 'object'
      };
      
      const report = await costReporter.generateReport(options);
      
      expect(mockDAO.getCostEvents).toHaveBeenCalledWith(
        expect.any(Date),
        expect.any(Date),
        {}
      );
      expect(report).toHaveProperty('summary');
      expect(report).toHaveProperty('breakdown');
    });

    test('should generate report with analytics', async () => {
      const options = {
        includeAnalytics: true,
        includeTrends: true,
        format: 'object'
      };
      
      const report = await costReporter.generateReport(options);
      
      expect(report).toHaveProperty('analytics');
      expect(report).toHaveProperty('trends');
    });

    test('should generate report with recommendations', async () => {
      const options = {
        includeRecommendations: true,
        format: 'object'
      };
      
      const report = await costReporter.generateReport(options);
      
      expect(report).toHaveProperty('recommendations');
      expect(Array.isArray(report.recommendations)).toBe(true);
    });
  });

  describe('Report Formatting', () => {
    let sampleReport;

    beforeEach(() => {
      sampleReport = {
        metadata: {
          generatedAt: new Date().toISOString(),
          dateRange: {
            startDate: '2023-12-01',
            endDate: '2023-12-01'
          },
          reportType: 'daily'
        },
        summary: {
          totalCost: 0.13,
          totalTokens: 1500,
          recordCount: 2,
          byProvider: {
            'openai': { totalCost: 0.08, tokens: 1000, count: 1 },
            'anthropic': { totalCost: 0.05, tokens: 500, count: 1 }
          },
          byOperation: {
            'enrichment': { totalCost: 0.13, tokens: 1500, count: 2 }
          }
        },
        events: [
          {
            provider: 'openai',
            model: 'gpt-4',
            totalCost: 0.05
          }
        ],
        trends: {
          daily: [
            { date: '2023-12-01', cost: 0.13 }
          ],
          weekly: [],
          monthly: [],
          growthRate: 0,
          projections: null
        },
        budgetStatus: {
          daily: { spent: 0.13, limit: 10.0, remaining: 9.87, percentage: 1.3 },
          weekly: { spent: 0.13, limit: 50.0, remaining: 49.87, percentage: 0.26 },
          monthly: { spent: 0.13, limit: 200.0, remaining: 199.87, percentage: 0.065 }
        },
        recommendations: [
          {
            type: 'optimization',
            priority: 'medium',
            message: 'Consider optimizing model usage',
            action: 'Review model selection for cost efficiency'
          }
        ]
      };
    });

    test('should format report as JSON by default', () => {
      const formatted = costReporter.formatReport(sampleReport, 'json');
      
      expect(typeof formatted).toBe('string');
      expect(() => JSON.parse(formatted)).not.toThrow();
    });

    test('should format report as CSV', () => {
      const formatted = costReporter.formatReport(sampleReport, 'csv');
      
      expect(typeof formatted).toBe('string');
      expect(formatted).toContain('COST SUMMARY');
      expect(formatted).toContain('PROVIDER BREAKDOWN');
    });

    test('should format report as HTML', () => {
      const formatted = costReporter.formatReport(sampleReport, 'html');
      
      expect(typeof formatted).toBe('string');
      expect(formatted).toContain('<html>');
      expect(formatted).toContain('<table>');
      expect(formatted).toContain('openai');
    });
  });

  describe('Report Export', () => {
    let sampleReport;

    beforeEach(() => {
      sampleReport = {
        metadata: {
          generatedAt: new Date().toISOString(),
          dateRange: {
            startDate: '2023-12-01',
            endDate: '2023-12-01'
          },
          reportType: 'daily'
        },
        summary: {
          totalCost: 0.13,
          totalTokens: 1500,
          recordCount: 2,
          byProvider: {
            'openai': { totalCost: 0.08, tokens: 1000, count: 1 },
            'anthropic': { totalCost: 0.05, tokens: 500, count: 1 }
          },
          byOperation: {
            'enrichment': { totalCost: 0.13, tokens: 1500, count: 2 }
          }
        }
      };
    });

    test('should export report to file', async () => {
      const filename = 'test-report.json';
      const path = require('path');
      const expectedPath = path.join(process.cwd(), 'exports', 'cost-reports', filename);
      
      // Mock fs operations
      const fs = require('fs').promises;
      jest.spyOn(fs, 'writeFile').mockResolvedValue();
      jest.spyOn(fs, 'mkdir').mockResolvedValue();
      
      await costReporter.exportReport(sampleReport, 'json', filename);
      
      expect(fs.writeFile).toHaveBeenCalledWith(
        expectedPath,
        expect.any(String)
      );
    });
  });

  describe('Analytics Generation', () => {
    test('should generate analytics from cost events', async () => {
      const costEvents = [
        { provider: 'openai', model: 'gpt-4', totalCost: 0.05, date: '2023-12-01' },
        { provider: 'openai', model: 'gpt-3.5-turbo', totalCost: 0.02, date: '2023-12-01' },
        { provider: 'anthropic', model: 'claude-3-opus', totalCost: 0.08, date: '2023-12-01' }
      ];
      
      const costSummary = {
        totalCost: 0.15,
        eventCount: 3,
        byProvider: {
          'openai': { totalCost: 0.07, tokens: 1000, count: 2 },
          'anthropic': { totalCost: 0.08, tokens: 500, count: 1 }
        },
        byModel: {
          'gpt-4': { totalCost: 0.05, tokens: 500, count: 1 },
          'gpt-3.5-turbo': { totalCost: 0.02, tokens: 300, count: 1 },
          'claude-3-opus': { totalCost: 0.08, tokens: 200, count: 1 }
        },
        byOperation: {
          'enrichment': { totalCost: 0.15, tokens: 1500, count: 3 }
        },
        bySourceType: {
          'document': { totalCost: 0.15, tokens: 1500, count: 3 }
        }
      };
      
      const analytics = await costReporter.generateAnalytics(costEvents, costSummary);
      
      expect(analytics).toHaveProperty('topModels');
      expect(analytics).toHaveProperty('providerEfficiency');
      expect(analytics).toHaveProperty('efficiency');
      expect(analytics.topModels[0].model).toBe('claude-3-opus'); // Highest cost
    });
  });

  describe('Trends Analysis', () => {
    test('should generate trends from cost events', async () => {
      const costEvents = [
        { totalCost: 0.05, date: '2023-12-01' },
        { totalCost: 0.08, date: '2023-12-02' },
        { totalCost: 0.06, date: '2023-12-03' }
      ];
      
      const trends = await costReporter.generateTrends(costEvents);
      
      expect(trends).toHaveProperty('daily');
      expect(trends).toHaveProperty('growthRate');
      expect(trends).toHaveProperty('weekly');
    });
  });

  describe('Error Handling', () => {
    test('should handle DAO errors gracefully', async () => {
      mockDAO.getCostEvents.mockRejectedValue(new Error('Database error'));
      
      await expect(costReporter.generateReport()).rejects.toThrow('Database error');
    });

    test('should handle invalid date ranges', async () => {
      const options = {
        startDate: new Date('2023-12-31'),
        endDate: new Date('2023-12-01') // End before start
      };
      
      await expect(costReporter.generateReport(options)).rejects.toThrow();
    });

    test('should handle empty cost events', async () => {
      mockDAO.getCostEvents.mockResolvedValueOnce([]);
      mockDAO.getCostSummary.mockResolvedValueOnce({
        totalCost: 0,
        totalTokens: 0,
        recordCount: 0,
        byProvider: {},
        byModel: {},
        byOperation: {},
        bySourceType: {}
      });
      
      const report = await costReporter.generateReport({ format: 'object' });
      
      expect(report.summary.recordCount).toBe(0);
      expect(report.summary.totalCost).toBe(0);
    });
  });

  describe('Configuration Options', () => {
    test('should respect timezone configuration', () => {
      const reporter = new CostReporter({
        timezone: 'America/New_York'
      });
      
      expect(reporter.config.timezone).toBe('America/New_York');
    });

    test('should use default start date when not specified', () => {
      const defaultStart = costReporter.getDefaultStartDate();
      
      expect(defaultStart).toBeInstanceOf(Date);
      expect(defaultStart.getTime()).toBeLessThan(Date.now());
    });
  });
});
