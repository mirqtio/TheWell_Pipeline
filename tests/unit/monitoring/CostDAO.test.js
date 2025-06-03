const CostDAO = require('../../../src/monitoring/CostDAO');
const { Pool } = require('pg');

// Mock pg Pool
jest.mock('pg');

describe('CostDAO', () => {
  let costDAO;
  let mockPool;
  let mockClient;

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();
    
    // Create mock client
    mockClient = {
      query: jest.fn(),
      release: jest.fn()
    };
    
    // Create mock pool with proper PostgreSQL result structure
    mockPool = {
      connect: jest.fn().mockResolvedValue(mockClient),
      end: jest.fn().mockResolvedValue(),
      query: jest.fn().mockResolvedValue({
        rows: [],
        rowCount: 0
      })
    };
    
    // Mock Pool constructor
    Pool.mockImplementation(() => mockPool);
    
    // Create CostDAO instance
    costDAO = new CostDAO({
      host: 'localhost',
      port: 5432,
      database: 'test_db',
      user: 'test_user',
      password: 'test_pass'
    });
  });

  afterEach(async () => {
    if (costDAO) {
      await costDAO.close();
    }
  });

  describe('Initialization', () => {
    test('should initialize database connection', async () => {
      mockClient.query.mockResolvedValue({ rows: [{ result: 1 }], rowCount: 1 });
      
      await costDAO.initialize();
      
      expect(mockPool.connect).toHaveBeenCalled();
      expect(mockClient.query).toHaveBeenCalledWith('SELECT 1');
      expect(mockClient.release).toHaveBeenCalled();
      expect(costDAO.isConnected).toBe(true);
    });

    test('should handle initialization failure', async () => {
      mockPool.connect.mockRejectedValue(new Error('Connection failed'));
      
      await expect(costDAO.initialize()).rejects.toThrow('Connection failed');
      expect(costDAO.isConnected).toBe(false);
    });
  });

  describe('Cost Event Operations', () => {
    beforeEach(async () => {
      mockClient.query.mockResolvedValue({ rows: [{ result: 1 }], rowCount: 1 });
      await costDAO.initialize();
      // Clear the initialization call from mock history
      jest.clearAllMocks();
    });

    test('should save cost event successfully', async () => {
      const costEvent = {
        provider: 'openai',
        model: 'gpt-4',
        inputTokens: 1000,
        outputTokens: 500,
        inputCost: 0.03,
        outputCost: 0.03,
        totalCost: 0.06,
        documentId: 'doc-123',
        sourceType: 'pdf',
        operation: 'enrichment',
        metadata: { test: 'data' }
      };

      const mockResult = {
        rows: [{
          id: 'event-123',
          created_at: new Date()
        }],
        rowCount: 1
      };

      // Mock pool.query for the actual operation
      mockPool.query.mockResolvedValue(mockResult);

      const result = await costDAO.saveCostEvent(costEvent);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO cost_events'),
        expect.arrayContaining([
          costEvent.provider,
          costEvent.model,
          costEvent.inputTokens,
          costEvent.outputTokens,
          costEvent.inputCost,
          costEvent.outputCost,
          costEvent.totalCost,
          JSON.stringify(costEvent.metadata)
        ])
      );

      expect(result).toHaveProperty('id', 'event-123');
      expect(result).toHaveProperty('provider', 'openai');
      expect(result).toHaveProperty('totalCost', 0.06);
    });

    test('should get cost events with date range', async () => {
      const mockEvents = [
        {
          id: 'event-1',
          provider: 'openai',
          model: 'gpt-4',
          total_cost: 0.06,
          created_at: new Date()
        }
      ];

      mockPool.query.mockResolvedValue({ rows: mockEvents, rowCount: 1 });

      const startDate = new Date('2023-12-01');
      const endDate = new Date('2023-12-31');
      const result = await costDAO.getCostEvents(startDate, endDate);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE created_at >= $1 AND created_at <= $2'),
        expect.arrayContaining([startDate, endDate])
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toHaveProperty('id', 'event-1');
    });

    test('should get cost events with filters', async () => {
      const filters = { provider: 'openai', model: 'gpt-4' };
      mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });

      await costDAO.getCostEvents(new Date(), new Date(), filters);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE created_at >= $1 AND created_at <= $2'),
        expect.arrayContaining([expect.any(Date), expect.any(Date), 'openai', 'gpt-4'])
      );
    });

    test('should get cost summary', async () => {
      const mockSummary = [
        {
          provider: 'openai',
          total_cost: 150.75,
          event_count: 25,
          total_input_tokens: 1000,
          total_output_tokens: 500,
          avg_cost: 6.03,
          first_event: new Date(),
          last_event: new Date()
        }
      ];

      mockPool.query.mockResolvedValue({ rows: mockSummary, rowCount: 1 });

      const startDate = new Date('2023-12-01');
      const endDate = new Date('2023-12-31');
      const result = await costDAO.getCostSummary(startDate, endDate, 'provider');

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('GROUP BY provider'),
        expect.arrayContaining([startDate, endDate])
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toHaveProperty('provider', 'openai');
      expect(result[0]).toHaveProperty('totalCost', 150.75);
    });
  });

  describe('Budget Operations', () => {
    beforeEach(async () => {
      mockClient.query.mockResolvedValue({ rows: [{ result: 1 }], rowCount: 1 });
      await costDAO.initialize();
      // Clear the initialization call from mock history
      jest.clearAllMocks();
    });

    test('should get active budgets', async () => {
      const mockBudgets = [
        {
          id: 'budget-1',
          name: 'Monthly Budget',
          budget_type: 'monthly',
          limit_amount: 100.00,
          alert_threshold: 0.8,
          is_active: true,
          created_at: new Date(),
          updated_at: new Date()
        }
      ];

      mockPool.query.mockResolvedValue({ rows: mockBudgets, rowCount: 1 });

      const result = await costDAO.getActiveBudgets();

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM cost_budgets')
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toHaveProperty('id', 'budget-1');
      expect(result[0]).toHaveProperty('name', 'Monthly Budget');
    });

    test('should get budget spending', async () => {
      const mockSpending = [
        { 
          current_spending: 85.50,
          event_count: 10
        }
      ];

      mockPool.query.mockResolvedValue({ rows: mockSpending, rowCount: 1 });

      const result = await costDAO.getBudgetSpending('budget-1', new Date('2023-12-01'), new Date('2023-12-01'));

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('COALESCE(SUM(ce.total_cost), 0) as current_spending'),
        expect.arrayContaining(['budget-1', expect.any(Date), expect.any(Date)])
      );

      expect(result).toHaveProperty('currentSpending', 85.50);
      expect(result).toHaveProperty('eventCount', 10);
    });
  });

  describe('Alert Operations', () => {
    beforeEach(async () => {
      mockClient.query.mockResolvedValue({ rows: [{ result: 1 }], rowCount: 1 });
      await costDAO.initialize();
      // Clear the initialization call from mock history
      jest.clearAllMocks();
    });

    test('should save cost alert successfully', async () => {
      const alert = {
        budgetId: 'budget-1',
        alertType: 'budget_exceeded',
        currentAmount: 95.50,
        limitAmount: 100.00,
        percentage: 0.955,
        periodStart: new Date('2023-12-01'),
        periodEnd: new Date('2023-12-31'),
        message: 'Budget limit exceeded'
      };

      const mockResult = {
        rows: [{
          id: 'alert-123',
          created_at: new Date()
        }],
        rowCount: 1
      };

      mockPool.query.mockResolvedValue(mockResult);

      const result = await costDAO.saveCostAlert(alert);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO cost_alerts'),
        expect.arrayContaining([
          alert.budgetId,
          alert.alertType,
          alert.currentAmount,
          alert.limitAmount,
          alert.percentage,
          alert.periodStart,
          alert.periodEnd,
          alert.message
        ])
      );

      expect(result).toHaveProperty('id', 'alert-123');
      expect(result).toHaveProperty('budgetId', 'budget-1');
    });
  });

  describe('Report Operations', () => {
    beforeEach(async () => {
      mockClient.query.mockResolvedValue({ rows: [{ result: 1 }], rowCount: 1 });
      await costDAO.initialize();
      // Clear the initialization call from mock history
      jest.clearAllMocks();
    });

    test('should save cost report successfully', async () => {
      const report = {
        reportName: 'Daily Cost Report',
        reportType: 'daily',
        dateRangeStart: new Date('2023-12-01'),
        dateRangeEnd: new Date('2023-12-01'),
        totalCost: 50.25,
        totalTokens: 1500,
        recordCount: 10,
        reportData: { totalCost: 50.25 },
        format: 'json',
        generatedBy: 'system'
      };

      const mockResult = {
        rows: [{
          id: 'report-123',
          created_at: new Date()
        }],
        rowCount: 1
      };

      mockPool.query.mockResolvedValue(mockResult);

      const result = await costDAO.saveCostReport(report);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO cost_reports'),
        expect.arrayContaining([
          report.reportName,
          report.reportType,
          report.dateRangeStart,
          report.dateRangeEnd,
          report.totalCost,
          report.totalTokens,
          report.recordCount,
          JSON.stringify(report.reportData),
          report.format,
          report.generatedBy
        ])
      );

      expect(result).toHaveProperty('id', 'report-123');
      expect(result).toHaveProperty('reportType', 'daily');
    });
  });

  describe('Data Management', () => {
    beforeEach(async () => {
      mockClient.query.mockResolvedValue({ rows: [{ result: 1 }], rowCount: 1 });
      await costDAO.initialize();
      // Clear the initialization call from mock history
      jest.clearAllMocks();
    });

    test('should cleanup old events', async () => {
      mockPool.query.mockResolvedValue({ rowCount: 5 });

      const result = await costDAO.cleanupOldEvents(90);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM cost_events'),
        expect.arrayContaining([expect.any(Date)])
      );

      expect(result).toBe(5);
    });

    test('should close database connection', async () => {
      await costDAO.close();

      expect(mockPool.end).toHaveBeenCalled();
      expect(costDAO.isConnected).toBe(false);
    });
  });

  describe('Error Handling', () => {
    test('should handle connection errors gracefully', async () => {
      const connectionError = new Error('Connection failed');
      mockPool.query.mockRejectedValueOnce(connectionError);

      const costEvent = {
        provider: 'openai',
        model: 'gpt-4',
        operation: 'completion',
        inputTokens: 100,
        outputTokens: 50,
        inputCost: 0.03,
        outputCost: 0.06,
        totalCost: 0.09
      };

      await expect(costDAO.saveCostEvent(costEvent)).rejects.toThrow('Connection failed');
    });

    test('should handle query errors gracefully', async () => {
      const queryError = new Error('Query execution failed');
      mockPool.query.mockRejectedValueOnce(queryError);

      await expect(costDAO.getCostEvents(new Date(), new Date())).rejects.toThrow('Query execution failed');
    });
  });
});
