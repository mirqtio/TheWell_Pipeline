/**
 * Jest configuration optimized for E2E tests
 * Focuses on speed while maintaining test reliability
 */

module.exports = {
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/jest.e2e.setup.js'],
  testMatch: ['**/tests/e2e/**/*.test.js'],
  
  // Performance optimizations
  testTimeout: 15000,  // Reduced from 30s to 15s
  maxWorkers: 3,       // Increased parallelism for E2E
  
  // Reduce noise
  silent: true,
  verbose: false,
  
  // Faster execution
  forceExit: true,
  detectOpenHandles: false,  // Disable for speed in E2E
  
  // Coverage not needed for E2E speed runs
  collectCoverage: false,
  
  // Faster test discovery
  cache: true,
  cacheDirectory: '<rootDir>/.jest-cache-e2e'
};
