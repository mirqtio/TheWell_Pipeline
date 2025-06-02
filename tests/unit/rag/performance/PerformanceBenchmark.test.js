/**
 * Unit tests for PerformanceBenchmark
 */

const PerformanceBenchmark = require('../../../../src/rag/performance/PerformanceBenchmark');

describe('PerformanceBenchmark', () => {
  let performanceBenchmark;
  let mockRagManager;
  let mockParallelSearchManager;

  beforeEach(() => {
    mockRagManager = {
      processQuery: jest.fn()
    };

    mockParallelSearchManager = {
      performParallelSearch: jest.fn()
    };

    performanceBenchmark = new PerformanceBenchmark({
      ragManager: mockRagManager,
      parallelSearchManager: mockParallelSearchManager
    });
  });

  afterEach(async () => {
    if (performanceBenchmark.isInitialized) {
      await performanceBenchmark.shutdown();
    }
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with required dependencies', () => {
      expect(performanceBenchmark.ragManager).toBe(mockRagManager);
      expect(performanceBenchmark.parallelSearchManager).toBe(mockParallelSearchManager);
      expect(performanceBenchmark.isInitialized).toBe(false);
      expect(performanceBenchmark.benchmarkHistory).toEqual([]);
    });

    it('should throw error without rag manager', () => {
      expect(() => {
        new PerformanceBenchmark({
          parallelSearchManager: mockParallelSearchManager
        });
      }).toThrow('RAG Manager is required');
    });
  });

  describe('initialize', () => {
    it('should initialize successfully', async () => {
      await performanceBenchmark.initialize();
      expect(performanceBenchmark.isInitialized).toBe(true);
    });

    it('should not initialize twice', async () => {
      await performanceBenchmark.initialize();
      await performanceBenchmark.initialize(); // Should not throw
      expect(performanceBenchmark.isInitialized).toBe(true);
    });
  });

  describe('runSequentialBenchmark', () => {
    beforeEach(async () => {
      await performanceBenchmark.initialize();
    });

    it('should run sequential benchmark successfully', async () => {
      const testQueries = [
        { query: 'test query 1', filters: {}, userAuth: { userId: 'user1' } },
        { query: 'test query 2', filters: {}, userAuth: { userId: 'user1' } }
      ];

      mockRagManager.processQuery
        .mockResolvedValueOnce({ results: ['doc1'], responseTime: 100 })
        .mockResolvedValueOnce({ results: ['doc2'], responseTime: 150 });

      const results = await performanceBenchmark.runSequentialBenchmark(testQueries);

      expect(results).toEqual({
        type: 'sequential',
        totalQueries: 2,
        totalTime: expect.any(Number),
        averageTime: expect.any(Number),
        minTime: expect.any(Number),
        maxTime: expect.any(Number),
        throughput: expect.any(Number),
        successRate: 1,
        errors: [],
        queryResults: expect.arrayContaining([
          expect.objectContaining({
            query: 'test query 1',
            success: true,
            responseTime: expect.any(Number)
          }),
          expect.objectContaining({
            query: 'test query 2',
            success: true,
            responseTime: expect.any(Number)
          })
        ])
      });

      expect(mockRagManager.processQuery).toHaveBeenCalledTimes(2);
    });

    it('should handle query errors in sequential benchmark', async () => {
      const testQueries = [
        { query: 'test query 1', filters: {}, userAuth: { userId: 'user1' } },
        { query: 'test query 2', filters: {}, userAuth: { userId: 'user1' } }
      ];

      mockRagManager.processQuery
        .mockResolvedValueOnce({ results: ['doc1'], responseTime: 100 })
        .mockRejectedValueOnce(new Error('Query failed'));

      const results = await performanceBenchmark.runSequentialBenchmark(testQueries);

      expect(results.successRate).toBe(0.5);
      expect(results.errors).toHaveLength(1);
      expect(results.errors[0]).toContain('Query failed');
    });

    it('should throw error if not initialized', async () => {
      const benchmark = new PerformanceBenchmark({
        ragManager: mockRagManager,
        parallelSearchManager: mockParallelSearchManager
      });

      await expect(
        benchmark.runSequentialBenchmark([])
      ).rejects.toThrow('Performance Benchmark not initialized');
    });
  });

  describe('runParallelBenchmark', () => {
    beforeEach(async () => {
      await performanceBenchmark.initialize();
    });

    it('should run parallel benchmark successfully', async () => {
      const testQueries = [
        { query: 'test query 1', filters: {}, userAuth: { userId: 'user1' } },
        { query: 'test query 2', filters: {}, userAuth: { userId: 'user1' } }
      ];

      mockParallelSearchManager.performParallelSearch
        .mockResolvedValue([{ id: 'doc1', title: 'Document 1' }]);

      const results = await performanceBenchmark.runParallelBenchmark(testQueries);

      expect(results).toEqual({
        type: 'parallel',
        totalQueries: 2,
        totalTime: expect.any(Number),
        averageTime: expect.any(Number),
        minTime: expect.any(Number),
        maxTime: expect.any(Number),
        throughput: expect.any(Number),
        successRate: 1,
        errors: [],
        queryResults: expect.arrayContaining([
          expect.objectContaining({
            query: 'test query 1',
            success: true,
            responseTime: expect.any(Number)
          }),
          expect.objectContaining({
            query: 'test query 2',
            success: true,
            responseTime: expect.any(Number)
          })
        ])
      });

      expect(mockParallelSearchManager.performParallelSearch).toHaveBeenCalledTimes(2);
    });

    it('should handle missing parallel search manager', async () => {
      const benchmark = new PerformanceBenchmark({
        ragManager: mockRagManager
      });
      await benchmark.initialize();

      await expect(
        benchmark.runParallelBenchmark([])
      ).rejects.toThrow('Parallel Search Manager not available');
    });
  });

  describe('runComparisonBenchmark', () => {
    beforeEach(async () => {
      await performanceBenchmark.initialize();
    });

    it('should run comparison benchmark successfully', async () => {
      const testQueries = [
        { query: 'test query 1', filters: {}, userAuth: { userId: 'user1' } }
      ];

      mockRagManager.processQuery
        .mockResolvedValue({ results: ['doc1'], responseTime: 200 });

      mockParallelSearchManager.performParallelSearch
        .mockResolvedValue([{ id: 'doc1', title: 'Document 1' }]);

      const results = await performanceBenchmark.runComparisonBenchmark(testQueries);

      expect(results).toEqual({
        sequential: expect.objectContaining({
          type: 'sequential',
          totalQueries: 1
        }),
        parallel: expect.objectContaining({
          type: 'parallel',
          totalQueries: 1
        }),
        comparison: expect.objectContaining({
          speedupFactor: expect.any(Number),
          parallelAdvantage: expect.any(Number),
          recommendation: expect.any(String)
        })
      });
    });

    it('should provide performance recommendations', async () => {
      const testQueries = [
        { query: 'test query 1', filters: {}, userAuth: { userId: 'user1' } }
      ];

      // Mock parallel being faster
      mockRagManager.processQuery = jest.fn().mockImplementation(() => 
        new Promise(resolve => setTimeout(() => resolve({ results: ['doc1'] }), 200))
      );

      mockParallelSearchManager.performParallelSearch = jest.fn().mockImplementation(() =>
        new Promise(resolve => setTimeout(() => resolve([{ id: 'doc1' }]), 100))
      );

      const results = await performanceBenchmark.runComparisonBenchmark(testQueries);

      expect(results.comparison.speedupFactor).toBeGreaterThan(1);
      expect(results.comparison.recommendation).toContain('parallel');
    });
  });

  describe('analyzeTrends', () => {
    beforeEach(async () => {
      await performanceBenchmark.initialize();
    });

    it('should analyze performance trends', () => {
      // Add some mock benchmark history
      performanceBenchmark.benchmarkHistory = [
        {
          timestamp: Date.now() - 3600000, // 1 hour ago
          sequential: { averageTime: 200, throughput: 5 },
          parallel: { averageTime: 100, throughput: 10 }
        },
        {
          timestamp: Date.now() - 1800000, // 30 minutes ago
          sequential: { averageTime: 180, throughput: 5.5 },
          parallel: { averageTime: 90, throughput: 11 }
        },
        {
          timestamp: Date.now(),
          sequential: { averageTime: 160, throughput: 6 },
          parallel: { averageTime: 80, throughput: 12 }
        }
      ];

      const trends = performanceBenchmark.analyzeTrends();

      expect(trends).toEqual({
        sequentialTrend: expect.objectContaining({
          averageTimeChange: expect.any(Number),
          throughputChange: expect.any(Number),
          trend: expect.any(String)
        }),
        parallelTrend: expect.objectContaining({
          averageTimeChange: expect.any(Number),
          throughputChange: expect.any(Number),
          trend: expect.any(String)
        }),
        overallRecommendation: expect.any(String)
      });
    });

    it('should handle insufficient data for trends', () => {
      const trends = performanceBenchmark.analyzeTrends();

      expect(trends).toEqual({
        sequentialTrend: { message: 'Insufficient data for trend analysis' },
        parallelTrend: { message: 'Insufficient data for trend analysis' },
        overallRecommendation: 'Collect more benchmark data for trend analysis'
      });
    });
  });

  describe('getBenchmarkHistory', () => {
    beforeEach(async () => {
      await performanceBenchmark.initialize();
    });

    it('should return benchmark history', () => {
      const history = performanceBenchmark.getBenchmarkHistory();
      expect(Array.isArray(history)).toBe(true);
    });

    it('should limit history size', () => {
      // Add many entries to test limit
      for (let i = 0; i < 150; i++) {
        performanceBenchmark.benchmarkHistory.push({
          timestamp: Date.now() - i * 1000,
          sequential: { averageTime: 100 + i },
          parallel: { averageTime: 50 + i }
        });
      }

      const history = performanceBenchmark.getBenchmarkHistory();
      expect(history.length).toBeLessThanOrEqual(100); // Default limit
    });
  });

  describe('clearBenchmarkHistory', () => {
    beforeEach(async () => {
      await performanceBenchmark.initialize();
    });

    it('should clear benchmark history', () => {
      performanceBenchmark.benchmarkHistory = [
        { timestamp: Date.now(), sequential: {}, parallel: {} }
      ];

      performanceBenchmark.clearBenchmarkHistory();
      expect(performanceBenchmark.benchmarkHistory).toEqual([]);
    });
  });

  describe('getStatus', () => {
    it('should return status when not initialized', async () => {
      const status = await performanceBenchmark.getStatus();
      expect(status).toEqual({
        initialized: false,
        ragManager: 'available',
        parallelSearchManager: 'available',
        benchmarkHistorySize: 0
      });
    });

    it('should return status when initialized', async () => {
      await performanceBenchmark.initialize();
      const status = await performanceBenchmark.getStatus();
      expect(status.initialized).toBe(true);
    });

    it('should indicate missing dependencies', async () => {
      const benchmark = new PerformanceBenchmark({
        ragManager: mockRagManager
      });
      const status = await benchmark.getStatus();
      expect(status.parallelSearchManager).toBe('missing');
    });
  });

  describe('shutdown', () => {
    it('should shutdown gracefully', async () => {
      await performanceBenchmark.initialize();
      await performanceBenchmark.shutdown();
      expect(performanceBenchmark.isInitialized).toBe(false);
    });

    it('should handle shutdown when not initialized', async () => {
      await expect(performanceBenchmark.shutdown()).resolves.not.toThrow();
    });
  });

  describe('performance calculations', () => {
    it('should calculate throughput correctly', () => {
      const totalQueries = 10;
      const totalTime = 2000; // 2 seconds
      const throughput = performanceBenchmark.calculateThroughput(totalQueries, totalTime);
      expect(throughput).toBe(5); // 5 queries per second
    });

    it('should calculate speedup factor correctly', () => {
      const sequentialTime = 200;
      const parallelTime = 100;
      const speedup = performanceBenchmark.calculateSpeedupFactor(sequentialTime, parallelTime);
      expect(speedup).toBe(2);
    });

    it('should handle edge cases in calculations', () => {
      expect(performanceBenchmark.calculateThroughput(0, 1000)).toBe(0);
      expect(performanceBenchmark.calculateThroughput(10, 0)).toBe(Infinity);
      expect(performanceBenchmark.calculateSpeedupFactor(100, 0)).toBe(Infinity);
      expect(performanceBenchmark.calculateSpeedupFactor(0, 100)).toBe(0);
    });
  });
});