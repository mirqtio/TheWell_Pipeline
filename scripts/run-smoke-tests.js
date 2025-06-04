#!/usr/bin/env node

/**
 * Smoke Test Runner
 * Executes smoke tests against a deployed instance
 */

const { spawn } = require('child_process');
const logger = require('../src/utils/logger');

// Configuration from environment
const API_URL = process.env.SMOKE_TEST_API_URL || process.env.API_URL || 'http://localhost:3000';
const API_KEY = process.env.SMOKE_TEST_API_KEY || process.env.API_KEY || 'test-api-key';
const TIMEOUT = parseInt(process.env.SMOKE_TEST_TIMEOUT || '30000'); // 30 seconds default

async function waitForAPI(url, maxAttempts = 30) {
  const axios = require('axios');
  
  logger.info(`Waiting for API at ${url} to be ready...`);
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await axios.get(`${url}/health`, { timeout: 5000 });
      logger.info('API is ready!');
      return true;
    } catch (error) {
      if (attempt === maxAttempts) {
        logger.error('API failed to become ready');
        return false;
      }
      
      logger.info(`API not ready yet, retrying... (${attempt}/${maxAttempts})`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
}

async function runSmokeTests() {
  // First check if API is accessible
  const isReady = await waitForAPI(API_URL);
  
  if (!isReady) {
    logger.error('Cannot run smoke tests - API is not accessible');
    process.exit(1);
  }
  
  // Set environment variables for tests
  const env = {
    ...process.env,
    API_URL,
    API_KEY,
    NODE_ENV: 'test'
  };
  
  logger.info('Running smoke tests...');
  logger.info(`API URL: ${API_URL}`);
  logger.info(`Timeout: ${TIMEOUT}ms`);
  
  // Run jest with smoke test pattern
  const jest = spawn('npx', [
    'jest',
    '--testMatch=**/tests/smoke/**/*.smoke.test.js',
    '--testTimeout=' + TIMEOUT,
    '--forceExit',
    '--detectOpenHandles',
    '--verbose',
    '--no-coverage'
  ], {
    env,
    stdio: 'inherit'
  });
  
  jest.on('close', (code) => {
    if (code === 0) {
      logger.info('✅ All smoke tests passed!');
    } else {
      logger.error(`❌ Smoke tests failed with code ${code}`);
    }
    process.exit(code);
  });
  
  jest.on('error', (error) => {
    logger.error('Failed to run smoke tests:', error);
    process.exit(1);
  });
}

// Handle script arguments
const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Smoke Test Runner

Usage: npm run test:smoke [options]

Environment Variables:
  SMOKE_TEST_API_URL   API URL to test against (default: http://localhost:3000)
  SMOKE_TEST_API_KEY   API key for authentication (default: test-api-key)
  SMOKE_TEST_TIMEOUT   Test timeout in milliseconds (default: 30000)

Options:
  --help, -h           Show this help message

Examples:
  # Test local instance
  npm run test:smoke

  # Test staging environment
  SMOKE_TEST_API_URL=https://staging.api.example.com npm run test:smoke

  # Test with custom timeout
  SMOKE_TEST_TIMEOUT=60000 npm run test:smoke
`);
  process.exit(0);
}

// Run tests
runSmokeTests().catch(error => {
  logger.error('Smoke test runner failed:', error);
  process.exit(1);
});