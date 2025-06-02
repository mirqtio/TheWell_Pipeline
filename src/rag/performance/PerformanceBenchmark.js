/**
 * Performance Benchmark Utility
 * Provides benchmarking capabilities for RAG system performance
 */

const logger = require('../../utils/logger');

class PerformanceBenchmark {
  constructor(options = {}) {
    if (!options.ragManager) {
      throw new Error('RAG Manager is required');
    }
    
    this.ragManager = options.ragManager;
    this.parallelSearchManager = options.parallelSearchManager;
    this.benchmarkHistory = [];
    this.isInitialized = false;
  }

  /**
   * Initialize the performance benchmark
   */
  async initialize() {
    try {
      logger.info('Initializing Performance Benchmark...');
      
      this.isInitialized = true;
      logger.info('Performance Benchmark initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Performance Benchmark:', error);
      throw error;
    }
  }

  /**
   * Run a comprehensive performance benchmark
   * @param {Object} options - Benchmark options
   * @returns {Object} Benchmark results
   */
  async runBenchmark(options = {}) {
    if (!this.isInitialized) {
      throw new Error('Performance Benchmark not initialized');
    }

    const {
      queries = this.getDefaultTestQueries(),
      iterations = 5,
      includeParallelComparison = true,
      userAuth = null
    } = options;

    logger.info('Starting performance benchmark', {
      queryCount: queries.length,
      iterations,
      includeParallelComparison
    });

    const benchmark = {
      timestamp: new Date().toISOString(),
      config: {
        queryCount: queries.length,
        iterations,
        includeParallelComparison
      },
      results: {
        sequential: {},
        parallel: {},
        comparison: {}
      }
    };

    try {
      // Run sequential benchmarks
      benchmark.results.sequential = await this.benchmarkSequentialSearch(
        queries,
        iterations,
        userAuth
      );

      // Run parallel benchmarks if enabled
      if (includeParallelComparison && this.parallelSearchManager) {
        benchmark.results.parallel = await this.benchmarkParallelSearch(
          queries,
          iterations,
          userAuth
        );

        // Calculate comparison metrics
        benchmark.results.comparison = this.calculateComparison(
          benchmark.results.sequential,
          benchmark.results.parallel
        );
      }

      // Store benchmark in history
      this.benchmarkHistory.push(benchmark);

      logger.info('Performance benchmark completed', {
        sequentialAvgTime: benchmark.results.sequential.averageTime,
        parallelAvgTime: benchmark.results.parallel?.averageTime,
        improvement: benchmark.results.comparison?.performanceImprovement
      });

      return benchmark;

    } catch (error) {
      logger.error('Performance benchmark failed:', error);
      throw error;
    }
  }

  /**
   * Run a sequential performance benchmark
   * @param {Object} queriesOrOptions - Benchmark queries or options
   * @returns {Object} Sequential benchmark results
   */
  async runSequentialBenchmark(queriesOrOptions = {}) {
    if (!this.isInitialized) {
      throw new Error('Performance Benchmark not initialized');
    }

    // Handle both array of queries and options object
    let queries, iterations, userAuth;
    if (Array.isArray(queriesOrOptions)) {
      // Extract query strings from query objects if needed
      queries = queriesOrOptions.map(q => typeof q === 'string' ? q : q.query);
      iterations = 1; // Use 1 iteration for test compatibility
      userAuth = queriesOrOptions[0]?.userAuth || null;
    } else {
      const options = queriesOrOptions;
      queries = options.queries || this.getDefaultTestQueries();
      iterations = options.iterations || 5;
      userAuth = options.userAuth || null;
    }

    logger.info('Starting sequential performance benchmark', {
      queryCount: queries.length,
      iterations
    });

    const benchmark = {
      timestamp: new Date().toISOString(),
      config: {
        queryCount: queries.length,
        iterations
      },
      results: {}
    };

    try {
      // Run sequential benchmarks
      benchmark.results = await this.benchmarkSequentialSearch(
        queries,
        iterations,
        userAuth
      );

      // Store benchmark in history
      this.benchmarkHistory.push(benchmark);

      logger.info('Sequential benchmark completed successfully', {
        totalQueries: benchmark.results.totalQueries,
        averageTime: benchmark.results.averageTime
      });

      return benchmark.results;

    } catch (error) {
      logger.error('Sequential performance benchmark failed:', error);
      throw error;
    }
  }

  /**
   * Run a parallel performance benchmark
   * @param {Object} queriesOrOptions - Benchmark queries or options
   * @returns {Object} Parallel benchmark results
   */
  async runParallelBenchmark(queriesOrOptions = {}) {
    if (!this.isInitialized) {
      throw new Error('Performance Benchmark not initialized');
    }

    // Handle both array of queries and options object
    let queries, iterations, userAuth;
    if (Array.isArray(queriesOrOptions)) {
      // Extract query strings from query objects if needed
      queries = queriesOrOptions.map(q => typeof q === 'string' ? q : q.query);
      iterations = 1; // Use 1 iteration for test compatibility
      userAuth = queriesOrOptions[0]?.userAuth || null;
    } else {
      const options = queriesOrOptions;
      queries = options.queries || this.getDefaultTestQueries();
      iterations = options.iterations || 5;
      userAuth = options.userAuth || null;
    }

    logger.info('Starting parallel performance benchmark', {
      queryCount: queries.length,
      iterations
    });

    const benchmark = {
      timestamp: new Date().toISOString(),
      config: {
        queryCount: queries.length,
        iterations
      },
      results: {}
    };

    try {
      // Run parallel benchmarks
      benchmark.results = await this.benchmarkParallelSearch(
        queries,
        iterations,
        userAuth
      );

      // Store benchmark in history
      this.benchmarkHistory.push(benchmark);

      logger.info('Parallel performance benchmark completed', {
        totalQueries: benchmark.results.totalQueries,
        averageTime: benchmark.results.averageTime
      });

      return benchmark.results;

    } catch (error) {
      logger.error('Parallel performance benchmark failed:', error);
      throw error;
    }
  }

  /**
   * Run a comparison performance benchmark
   * @param {Object} queriesOrOptions - Benchmark queries or options
   * @returns {Object} Comparison benchmark results
   */
  async runComparisonBenchmark(queriesOrOptions = {}) {
    if (!this.isInitialized) {
      throw new Error('Performance Benchmark not initialized');
    }

    // Handle both array of queries and options object
    let queries, iterations, userAuth;
    if (Array.isArray(queriesOrOptions)) {
      // Extract query strings from query objects if needed
      queries = queriesOrOptions.map(q => typeof q === 'string' ? q : q.query);
      iterations = 1; // Use 1 iteration for test compatibility
      userAuth = queriesOrOptions[0]?.userAuth || null;
    } else {
      const options = queriesOrOptions;
      queries = options.queries || this.getDefaultTestQueries();
      iterations = options.iterations || 5;
      userAuth = options.userAuth || null;
    }

    logger.info('Starting comparison performance benchmark', {
      queryCount: queries.length,
      iterations
    });

    const benchmark = {
      timestamp: new Date().toISOString(),
      config: {
        queryCount: queries.length,
        iterations
      },
      results: {}
    };

    try {
      // Run sequential benchmarks
      const sequentialResults = await this.benchmarkSequentialSearch(
        queries,
        iterations,
        userAuth
      );

      // Run parallel benchmarks
      const parallelResults = await this.benchmarkParallelSearch(
        queries,
        iterations,
        userAuth
      );

      // Calculate comparison metrics
      const comparison = this.calculateComparison(
        sequentialResults,
        parallelResults
      );

      benchmark.results = {
        sequential: { ...sequentialResults, type: 'sequential' },
        parallel: { ...parallelResults, type: 'parallel' },
        comparison
      };

      // Store benchmark in history
      this.benchmarkHistory.push(benchmark);

      logger.info('Comparison benchmark completed successfully', {
        performanceImprovement: benchmark.results.comparison.performanceImprovement
      });

      return benchmark.results;

    } catch (error) {
      logger.error('Comparison performance benchmark failed:', error);
      throw error;
    }
  }

  /**
   * Benchmark sequential search performance
   * @param {Array} queries - Test queries
   * @param {number} iterations - Number of iterations per query
   * @param {Object} userAuth - User authentication data
   * @returns {Object} Sequential benchmark results
   */
  async benchmarkSequentialSearch(queries, iterations, userAuth) {
    const results = {
      totalQueries: queries.length * iterations,
      totalTime: 0,
      averageTime: 0,
      minTime: Infinity,
      maxTime: 0,
      queryResults: []
    };

    const startTime = Date.now();

    for (const query of queries) {
      const queryResults = {
        query,
        iterations: [],
        averageTime: 0,
        minTime: Infinity,
        maxTime: 0
      };

      for (let i = 0; i < iterations; i++) {
        const iterationStart = Date.now();
        
        try {
          await this.ragManager.processQuery(query, { userAuth });
          const duration = Date.now() - iterationStart;
          
          queryResults.iterations.push({
            iteration: i + 1,
            duration,
            success: true
          });

          queryResults.minTime = Math.min(queryResults.minTime, duration);
          queryResults.maxTime = Math.max(queryResults.maxTime, duration);

        } catch (error) {
          const duration = Date.now() - iterationStart;
          queryResults.iterations.push({
            iteration: i + 1,
            duration,
            success: false,
            error: error.message
          });
        }
      }

      // Calculate query averages
      const successfulIterations = queryResults.iterations.filter(i => i.success);
      if (successfulIterations.length > 0) {
        queryResults.averageTime = successfulIterations.reduce((sum, i) => sum + i.duration, 0) / successfulIterations.length;
      }

      // Add simplified structure for test compatibility
      queryResults.responseTime = queryResults.averageTime;
      queryResults.success = successfulIterations.length > 0;

      results.queryResults.push(queryResults);
    }

    // Calculate overall results
    results.totalTime = Date.now() - startTime;
    const allSuccessfulDurations = results.queryResults
      .flatMap(qr => qr.iterations.filter(i => i.success).map(i => i.duration));
    
    if (allSuccessfulDurations.length > 0) {
      results.averageTime = allSuccessfulDurations.reduce((sum, d) => sum + d, 0) / allSuccessfulDurations.length;
      results.minTime = Math.min(...allSuccessfulDurations);
      results.maxTime = Math.max(...allSuccessfulDurations);
    }

    // Add additional properties expected by tests
    const totalIterations = results.queryResults.reduce((sum, qr) => sum + qr.iterations.length, 0);
    const successfulIterations = results.queryResults.reduce((sum, qr) => sum + qr.iterations.filter(i => i.success).length, 0);
    
    results.type = 'sequential';
    results.successRate = totalIterations > 0 ? successfulIterations / totalIterations : 0;
    results.throughput = results.totalTime > 0 ? (successfulIterations / results.totalTime) * 1000 : 0; // queries per second
    results.errors = results.queryResults
      .flatMap(qr => qr.iterations.filter(i => !i.success).map(i => i.error))
      .filter(error => error);

    return results;
  }

  /**
   * Benchmark parallel search performance
   * @param {Array} queries - Test queries
   * @param {number} iterations - Number of iterations per query
   * @param {Object} userAuth - User authentication data
   * @returns {Object} Parallel benchmark results
   */
  async benchmarkParallelSearch(queries, iterations, userAuth) {
    if (!this.parallelSearchManager) {
      throw new Error('Parallel Search Manager not available');
    }

    const results = {
      totalQueries: queries.length * iterations,
      totalTime: 0,
      averageTime: 0,
      minTime: Infinity,
      maxTime: 0,
      queryResults: []
    };

    const startTime = Date.now();

    for (const query of queries) {
      const queryResults = {
        query,
        iterations: [],
        averageTime: 0,
        minTime: Infinity,
        maxTime: 0
      };

      for (let i = 0; i < iterations; i++) {
        const iterationStart = Date.now();
        
        try {
          await this.parallelSearchManager.performParallelSearch(query, {}, userAuth);
          const duration = Date.now() - iterationStart;
          
          queryResults.iterations.push({
            iteration: i + 1,
            duration,
            success: true
          });

          queryResults.minTime = Math.min(queryResults.minTime, duration);
          queryResults.maxTime = Math.max(queryResults.maxTime, duration);

        } catch (error) {
          const duration = Date.now() - iterationStart;
          queryResults.iterations.push({
            iteration: i + 1,
            duration,
            success: false,
            error: error.message
          });
        }
      }

      // Calculate query averages
      const successfulIterations = queryResults.iterations.filter(i => i.success);
      if (successfulIterations.length > 0) {
        queryResults.averageTime = successfulIterations.reduce((sum, i) => sum + i.duration, 0) / successfulIterations.length;
      }

      // Add simplified structure for test compatibility
      queryResults.responseTime = queryResults.averageTime;
      queryResults.success = successfulIterations.length > 0;

      results.queryResults.push(queryResults);
    }

    // Calculate overall results
    results.totalTime = Date.now() - startTime;
    const allSuccessfulDurations = results.queryResults
      .flatMap(qr => qr.iterations.filter(i => i.success).map(i => i.duration));
    
    if (allSuccessfulDurations.length > 0) {
      results.averageTime = allSuccessfulDurations.reduce((sum, d) => sum + d, 0) / allSuccessfulDurations.length;
      results.minTime = Math.min(...allSuccessfulDurations);
      results.maxTime = Math.max(...allSuccessfulDurations);
    }

    // Add additional properties expected by tests
    const totalIterations = results.queryResults.reduce((sum, qr) => sum + qr.iterations.length, 0);
    const successfulIterations = results.queryResults.reduce((sum, qr) => sum + qr.iterations.filter(i => i.success).length, 0);
    
    results.type = 'parallel';
    results.successRate = totalIterations > 0 ? successfulIterations / totalIterations : 0;
    results.throughput = results.totalTime > 0 ? (successfulIterations / results.totalTime) * 1000 : 0; // queries per second
    results.errors = results.queryResults
      .flatMap(qr => qr.iterations.filter(i => !i.success).map(i => i.error))
      .filter(error => error);

    return results;
  }

  /**
   * Calculate comparison metrics between sequential and parallel
   * @param {Object} sequential - Sequential benchmark results
   * @param {Object} parallel - Parallel benchmark results
   * @returns {Object} Comparison metrics
   */
  calculateComparison(sequential, parallel) {
    if (!sequential.averageTime || !parallel.averageTime) {
      return {
        performanceImprovement: 0,
        speedupRatio: 1,
        speedupFactor: 1,
        parallelAdvantage: 0,
        timeReduction: 0,
        recommendation: 'Unable to compare - insufficient data'
      };
    }

    const performanceImprovement = ((sequential.averageTime - parallel.averageTime) / sequential.averageTime) * 100;
    const speedupRatio = sequential.averageTime / parallel.averageTime;
    const speedupFactor = speedupRatio;
    const parallelAdvantage = performanceImprovement;
    const timeReduction = sequential.averageTime - parallel.averageTime;

    let recommendation = 'Continue monitoring performance';
    if (speedupFactor > 1.5) {
      recommendation = 'Parallel processing shows significant advantage - recommend using parallel search';
    } else if (speedupFactor > 1.1) {
      recommendation = 'Parallel processing shows moderate advantage';
    } else {
      recommendation = 'Sequential processing may be sufficient for current workload';
    }

    return {
      performanceImprovement: Math.round(performanceImprovement * 100) / 100,
      speedupRatio: Math.round(speedupRatio * 100) / 100,
      speedupFactor: Math.round(speedupFactor * 100) / 100,
      parallelAdvantage: Math.round(parallelAdvantage * 100) / 100,
      timeReduction: Math.round(timeReduction),
      recommendation
    };
  }

  /**
   * Get default test queries for benchmarking
   * @returns {Array} Default test queries
   */
  getDefaultTestQueries() {
    return [
      'What is artificial intelligence?',
      'How does machine learning work?',
      'Explain neural networks',
      'What are the benefits of cloud computing?',
      'How to implement microservices architecture?'
    ];
  }

  /**
   * Get benchmark history
   * @param {number} limit - Maximum number of benchmarks to return
   * @returns {Array} Benchmark history
   */
  getBenchmarkHistory(limit = 10) {
    return this.benchmarkHistory
      .slice(-limit)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }

  /**
   * Analyze performance trends from benchmark history
   * @returns {Object} Trend analysis
   */
  analyzeTrends() {
    if (this.benchmarkHistory.length < 2) {
      return {
        sequentialTrend: { message: 'Insufficient data for trend analysis' },
        parallelTrend: { message: 'Insufficient data for trend analysis' },
        overallRecommendation: 'Collect more benchmark data for trend analysis'
      };
    }

    // Handle different data structures - check if results exist or data is directly in benchmark
    const sequentialTimes = this.benchmarkHistory.map(b => {
      if (b.results && b.results.sequential) {
        return b.results.sequential.averageTime;
      } else if (b.sequential) {
        return b.sequential.averageTime;
      }
      return undefined;
    }).filter(t => t !== undefined);

    const parallelTimes = this.benchmarkHistory.map(b => {
      if (b.results && b.results.parallel) {
        return b.results.parallel.averageTime;
      } else if (b.parallel) {
        return b.parallel.averageTime;
      }
      return undefined;
    }).filter(t => t !== undefined);

    const sequentialTrend = this.analyzeTrend(sequentialTimes);
    const parallelTrend = this.analyzeTrend(parallelTimes);

    // Generate overall recommendation
    let overallRecommendation = 'Continue monitoring performance trends';
    if (sequentialTrend.trend === 'improving' && parallelTrend.trend === 'improving') {
      overallRecommendation = 'Performance is improving across both sequential and parallel operations';
    } else if (sequentialTrend.trend === 'degrading' || parallelTrend.trend === 'degrading') {
      overallRecommendation = 'Performance degradation detected - investigate bottlenecks';
    }

    return {
      sequentialTrend,
      parallelTrend,
      overallRecommendation
    };
  }

  /**
   * Analyze trend in performance data
   * @param {Array} times - Array of time measurements
   * @returns {Object} Trend analysis
   */
  analyzeTrend(times) {
    if (times.length < 2) {
      return { message: 'Insufficient data for trend analysis' };
    }

    const first = times[0];
    const last = times[times.length - 1];
    const averageTimeChange = ((last - first) / first) * 100;
    
    // Calculate throughput change (inverse of time change)
    const throughputChange = -averageTimeChange;

    let trend = 'stable';
    if (averageTimeChange > 10) trend = 'degrading';
    else if (averageTimeChange < -10) trend = 'improving';

    return {
      averageTimeChange: Math.round(averageTimeChange * 100) / 100,
      throughputChange: Math.round(throughputChange * 100) / 100,
      trend
    };
  }

  /**
   * Clear benchmark history
   */
  clearBenchmarkHistory() {
    this.benchmarkHistory = [];
  }

  /**
   * Calculate throughput (queries per second)
   * @param {number} totalQueries - Total number of queries
   * @param {number} totalTime - Total time in milliseconds
   * @returns {number} Throughput in queries per second
   */
  calculateThroughput(totalQueries, totalTime) {
    if (totalTime === 0) return Infinity;
    if (totalQueries === 0) return 0;
    return totalQueries / (totalTime / 1000);
  }

  /**
   * Calculate speedup factor
   * @param {number} sequentialTime - Sequential execution time
   * @param {number} parallelTime - Parallel execution time
   * @returns {number} Speedup factor
   */
  calculateSpeedupFactor(sequentialTime, parallelTime) {
    if (parallelTime === 0) return Infinity;
    if (sequentialTime === 0) return 0;
    return sequentialTime / parallelTime;
  }

  /**
   * Get status information
   * @returns {Object} Status information
   */
  async getStatus() {
    return {
      initialized: this.isInitialized,
      ragManager: this.ragManager ? 'available' : 'missing',
      parallelSearchManager: this.parallelSearchManager ? 'available' : 'missing',
      benchmarkHistorySize: this.benchmarkHistory.length
    };
  }

  /**
   * Shutdown the performance benchmark
   */
  async shutdown() {
    this.isInitialized = false;
    this.benchmarkHistory = [];
  }
}

module.exports = PerformanceBenchmark;