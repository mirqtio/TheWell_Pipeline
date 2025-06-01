/**
 * Optimized Jest setup for E2E tests
 * Reduces logging and speeds up test execution
 */

// Set environment variables BEFORE importing base setup
process.env.E2E_OPTIMIZED = 'true';
process.env.HEALTH_CHECK_INTERVAL = '5000';  // Reduce from 30s to 5s
process.env.CIRCUIT_BREAKER_TIMEOUT = '5000'; // Reduce timeouts
process.env.CONFIG_WATCH_DEBOUNCE = '100';    // Faster config updates

// Optimize database connections for E2E
process.env.DB_POOL_SIZE = '2';
process.env.DB_IDLE_TIMEOUT = '1000';

// Faster Redis operations
process.env.REDIS_CONNECT_TIMEOUT = '2000';
process.env.REDIS_COMMAND_TIMEOUT = '1000';

// Import base setup AFTER setting environment variables
require('./jest.setup.js');

// Optimize logging for E2E tests
const originalConsole = global.console;

// Suppress verbose logging during E2E tests unless DEBUG is set
if (!process.env.DEBUG) {
  global.console = {
    ...originalConsole,
    log: () => {},      // Suppress info logs
    info: () => {},     // Suppress info logs  
    debug: () => {},    // Suppress debug logs
    warn: originalConsole.warn,   // Keep warnings
    error: originalConsole.error  // Keep errors
  };
}
