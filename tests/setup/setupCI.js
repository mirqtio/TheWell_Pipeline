/**
 * CI-specific test setup
 * Ensures tests run EXACTLY like in CI environment
 */

// Force test environment
process.env.NODE_ENV = 'test';
process.env.CI = 'true';
process.env.DISABLE_SERVICES = 'true';

// Set default test database (can be overridden)
process.env.DB_HOST = process.env.DB_HOST || 'localhost';
process.env.DB_PORT = process.env.DB_PORT || '5432';
process.env.DB_NAME = process.env.DB_NAME || 'thewell_test';
process.env.DB_USER = process.env.DB_USER || 'postgres';
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'postgres';

// Set test Redis config (force localhost for tests)
process.env.REDIS_HOST = 'localhost';
process.env.REDIS_PORT = '6379';

// Disable all external API calls
process.env.OPENAI_API_KEY = 'test-key-disabled';
process.env.ANTHROPIC_API_KEY = 'test-key-disabled';

// Set consistent timezone for tests
process.env.TZ = 'UTC';

// Disable color output in CI
if (process.env.CI === 'true') {
  process.env.FORCE_COLOR = '0';
}

// Set test timeouts
if (process.env.CI === 'true') {
  // Longer timeouts in CI due to potential resource constraints
  jest.setTimeout(30000);
} else {
  // Shorter timeouts locally for faster feedback
  jest.setTimeout(10000);
}

// Mock all timers by default to prevent flaky tests
global.mockTimers = () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2025-01-01T00:00:00Z'));
};

// Restore real timers
global.restoreTimers = () => {
  jest.useRealTimers();
};

// Ensure cleanup after each test
afterEach(() => {
  // Clear all mocks
  jest.clearAllMocks();
  
  // Clear module cache for fresh imports
  jest.resetModules();
  
  // Clear any intervals/timeouts
  jest.clearAllTimers();
});

// Global error handler to catch unhandled rejections
process.on('unhandledRejection', (error) => {
  console.error('Unhandled Promise Rejection:', error);
  // Fail the test
  throw error;
});

// Suppress console methods in tests (unless debugging)
if (!process.env.DEBUG_TESTS) {
  global.console = {
    ...console,
    log: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    // Keep error for debugging
    error: console.error,
  };
}

// Export test utilities
module.exports = {
  // Wait for condition with timeout
  waitFor: async (condition, timeout = 5000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (await condition()) {
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Timeout waiting for condition');
  },
  
  // Create test database URL
  getTestDatabaseUrl: () => {
    const { DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD } = process.env;
    return `postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}`;
  },
  
  // Create test Redis URL
  getTestRedisUrl: () => {
    const { REDIS_HOST, REDIS_PORT } = process.env;
    return `redis://${REDIS_HOST}:${REDIS_PORT}`;
  }
};