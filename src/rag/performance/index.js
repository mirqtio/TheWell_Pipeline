/**
 * Performance Module Index
 * Exports all performance optimization components
 */

const ParallelSearchManager = require('./ParallelSearchManager');
const PerformanceBenchmark = require('./PerformanceBenchmark');
const RequestThrottler = require('./RequestThrottler');
const DatabaseOptimizer = require('./DatabaseOptimizer');

module.exports = {
  ParallelSearchManager,
  PerformanceBenchmark,
  RequestThrottler,
  DatabaseOptimizer
};