const CostTracker = require('../../../src/monitoring/CostTracker');
const CostDAO = require('../../../src/monitoring/CostDAO');

// Mock the CostDAO
jest.mock('../../../src/monitoring/CostDAO');

describe('CostTracker', () => {
  let costTracker;
  let mockDAO;

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();
    
    // Create mock DAO
    mockDAO = {
      initialize: jest.fn().mockResolvedValue(true),
      saveCostEvent: jest.fn().mockImplementation(event => Promise.resolve({ ...event, id: 'test-id' })),
      getCostEvents: jest.fn().mockResolvedValue([]),
      getActiveBudgets: jest.fn().mockResolvedValue([]),
      saveBudget: jest.fn().mockResolvedValue({ id: 'budget-id' }),
      getBudgetStatus: jest.fn().mockResolvedValue({ limit: 100, used: 0 }),
      cleanupOldEvents: jest.fn().mockResolvedValue(5),
      close: jest.fn().mockResolvedValue()
    };
    
    // Mock the CostDAO constructor
    CostDAO.mockImplementation(() => mockDAO);
    
    // Create CostTracker instance
    costTracker = new CostTracker({
      enablePersistence: true,
      retentionDays: 30
    });
  });

  afterEach(async () => {
    if (costTracker) {
      await costTracker.close();
    }
  });

  describe('Initialization', () => {
    test('should initialize with default configuration', () => {
      const tracker = new CostTracker();
      
      expect(tracker.config.enablePersistence).toBe(true);
      expect(tracker.config.retentionDays).toBe(90);
      expect(tracker.costRecords).toEqual([]);
      expect(tracker.dailyTotals).toBeInstanceOf(Map);
      expect(tracker.monthlyTotals).toBeInstanceOf(Map);
      expect(tracker.providerTotals).toBeInstanceOf(Map);
    });

    test('should initialize with custom configuration', () => {
      const config = {
        enablePersistence: false,
        retentionDays: 60,
        costRates: {
          'custom': {
            'model': { input: 0.001, output: 0.002 }
          }
        }
      };
      
      const tracker = new CostTracker(config);
      
      expect(tracker.config.enablePersistence).toBe(false);
      expect(tracker.config.retentionDays).toBe(60);
      expect(tracker.costRates.custom.model).toEqual({ input: 0.001, output: 0.002 });
    });

    test('should initialize DAO and load data when persistence enabled', async () => {
      await costTracker.initialize();
      
      expect(mockDAO.initialize).toHaveBeenCalled();
      expect(mockDAO.getActiveBudgets).toHaveBeenCalled();
      expect(mockDAO.getCostEvents).toHaveBeenCalled();
      expect(costTracker.isInitialized).toBe(true);
    });
  });

  describe('Cost Calculation', () => {
    test('should calculate cost for OpenAI GPT-4', () => {
      const cost = costTracker.calculateCosts('openai', 'gpt-4', 1000, 500);
      
      // gpt-4: input: 0.03, output: 0.06 per 1K tokens
      // (1000/1000 * 0.03) + (500/1000 * 0.06) = 0.03 + 0.03 = 0.06
      expect(cost.inputCost).toBe(0.03);
      expect(cost.outputCost).toBe(0.03);
      expect(cost.totalCost).toBe(0.06);
    });

    test('should calculate cost for Anthropic Claude', () => {
      const cost = costTracker.calculateCosts('anthropic', 'claude-3-opus', 2000, 1000);
      
      // claude-3-opus: input: 0.015, output: 0.075 per 1K tokens
      // (2000/1000 * 0.015) + (1000/1000 * 0.075) = 0.03 + 0.075 = 0.105
      expect(cost.inputCost).toBe(0.03);
      expect(cost.outputCost).toBe(0.075);
      expect(cost.totalCost).toBe(0.105);
    });

    test('should handle unknown provider/model with zero cost', () => {
      const cost = costTracker.calculateCosts('unknown', 'model', 1000, 500);
      
      expect(cost.inputCost).toBe(0);
      expect(cost.outputCost).toBe(0);
      expect(cost.totalCost).toBe(0);
    });
  });

  describe('Cost Tracking', () => {
    test('should track cost event successfully', async () => {
      const usage = {
        provider: 'openai',
        model: 'gpt-4',
        inputTokens: 1000,
        outputTokens: 500,
        documentId: 'doc-123',
        sourceType: 'pdf',
        operation: 'enrichment'
      };
      
      const result = await costTracker.trackCostEvent(usage);
      
      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('totalCost', 0.06);
      expect(result).toHaveProperty('provider', 'openai');
      expect(result).toHaveProperty('model', 'gpt-4');
      expect(mockDAO.saveCostEvent).toHaveBeenCalled();
    });

    test('should update in-memory caches when tracking cost', async () => {
      const usage = {
        provider: 'openai',
        model: 'gpt-4',
        inputTokens: 1000,
        outputTokens: 500,
        documentId: 'doc-123',
        sourceType: 'pdf',
        operation: 'enrichment'
      };
      
      await costTracker.trackCostEvent(usage);
      
      expect(costTracker.costRecords).toHaveLength(1);
      expect(costTracker.providerTotals.get('openai')).toBe(0.06);
    });

    test('should emit cost event after tracking', async () => {
      const eventSpy = jest.fn();
      const usage = {
        provider: 'openai',
        model: 'gpt-4',
        inputTokens: 1000,
        outputTokens: 500,
        documentId: 'doc-123',
        sourceType: 'pdf',
        operation: 'enrichment'
      };
      
      costTracker.on('cost_tracked', eventSpy);
      
      await costTracker.trackCostEvent(usage);
      
      expect(eventSpy).toHaveBeenCalledWith(expect.objectContaining({
        totalCost: 0.06,
        provider: 'openai',
        model: 'gpt-4'
      }));
    });
  });

  describe('Data Management', () => {
    test('should cleanup old records', async () => {
      mockDAO.cleanupOldEvents.mockResolvedValue(5);
      
      const result = await costTracker.cleanup();
      
      expect(mockDAO.cleanupOldEvents).toHaveBeenCalledWith(30);
      expect(result).toBe(5);
    });

    test('should get cost summary', () => {
      const now = new Date();
      costTracker.costRecords = [
        { 
          totalCost: 0.05, 
          provider: 'openai', 
          inputTokens: 100,
          outputTokens: 50,
          model: 'gpt-4',
          operation: 'completion',
          sourceType: 'document',
          timestamp: now 
        },
        { 
          totalCost: 0.03, 
          provider: 'anthropic', 
          inputTokens: 80,
          outputTokens: 40,
          model: 'claude-3',
          operation: 'completion',
          sourceType: 'document',
          timestamp: now 
        }
      ];
      
      const startDate = new Date(now.getTime() - 1000);
      const endDate = new Date(now.getTime() + 1000);
      const summary = costTracker.getCostSummary(startDate, endDate);
      
      expect(summary).toHaveProperty('totalCost');
      expect(summary).toHaveProperty('recordCount', 2);
      expect(summary).toHaveProperty('byProvider');
    });

    test('should get daily totals', () => {
      costTracker.dailyTotals.set('2023-12-01', 50);
      costTracker.dailyTotals.set('2023-12-02', 75);
      
      const totals = costTracker.getDailyTotals();
      
      expect(totals).toEqual(new Map([
        ['2023-12-01', 50],
        ['2023-12-02', 75]
      ]));
    });

    test('should get monthly totals', () => {
      costTracker.monthlyTotals.set('2023-12', 125);
      
      const totals = costTracker.getMonthlyTotals();
      
      expect(totals).toEqual(new Map([
        ['2023-12', 125]
      ]));
    });

    test('should get provider totals', () => {
      costTracker.providerTotals.set('openai', 80);
      costTracker.providerTotals.set('anthropic', 45);
      
      const totals = costTracker.getProviderTotals();
      
      expect(totals).toEqual(new Map([
        ['openai', 80],
        ['anthropic', 45]
      ]));
    });
  });

  describe('Error Handling', () => {
    test('should handle cost tracking failure gracefully', async () => {
      mockDAO.saveCostEvent.mockRejectedValue(new Error('Save failed'));
      
      const usage = {
        provider: 'openai',
        model: 'gpt-4',
        inputTokens: 1000,
        outputTokens: 500,
        documentId: 'doc-123',
        sourceType: 'pdf',
        operation: 'enrichment'
      };
      
      await expect(costTracker.trackCostEvent(usage)).rejects.toThrow('Save failed');
    });

    test('should handle initialization failure gracefully', async () => {
      mockDAO.initialize.mockRejectedValue(new Error('DB connection failed'));
      
      await expect(costTracker.initialize()).rejects.toThrow('DB connection failed');
    });
  });
});
