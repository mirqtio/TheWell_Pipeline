/**
 * Jest Setup File for TheWell Pipeline
 * Configures test environment and mocks for database and external services
 */

// Load environment variables
require('dotenv').config();

// Mock PostgreSQL connections for unit tests
jest.mock('pg', () => {
  const mockClient = {
    connect: jest.fn().mockResolvedValue(undefined),
    query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    release: jest.fn().mockResolvedValue(undefined),
    end: jest.fn().mockResolvedValue(undefined)
  };

  const mockPool = {
    connect: jest.fn().mockResolvedValue(mockClient),
    query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    end: jest.fn().mockResolvedValue(undefined),
    totalCount: 0,
    idleCount: 0,
    waitingCount: 0
  };

  return {
    Pool: jest.fn(() => mockPool),
    Client: jest.fn(() => mockClient)
  };
});

// Mock Redis connections
jest.mock('redis', () => ({
  createClient: jest.fn(() => ({
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    exists: jest.fn().mockResolvedValue(0),
    expire: jest.fn().mockResolvedValue(1),
    flushall: jest.fn().mockResolvedValue('OK'),
    isOpen: true,
    isReady: true
  }))
}));

// Mock Bull queues
jest.mock('bull', () => {
  return jest.fn().mockImplementation((name, redisConfig) => ({
    add: jest.fn().mockResolvedValue({ id: '1', data: {} }),
    process: jest.fn(),
    on: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
    clean: jest.fn().mockResolvedValue([]),
    getJobs: jest.fn().mockResolvedValue([]),
    getJobCounts: jest.fn().mockResolvedValue({
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0,
      delayed: 0
    }),
    pause: jest.fn().mockResolvedValue(undefined),
    resume: jest.fn().mockResolvedValue(undefined),
    empty: jest.fn().mockResolvedValue(undefined),
    name,
    redisConfig
  }));
});

// Mock file system operations for configuration hot-reload tests
jest.mock('chokidar', () => ({
  watch: jest.fn(() => {
    const eventHandlers = new Map();
    
    const mockWatcher = {
      on: jest.fn((event, callback) => {
        if (!eventHandlers.has(event)) {
          eventHandlers.set(event, []);
        }
        eventHandlers.get(event).push(callback);
        
        // Emit ready event immediately for tests
        if (event === 'ready') {
          setTimeout(() => callback(), 10);
        }
        
        return mockWatcher;
      }),
      close: jest.fn().mockResolvedValue(undefined),
      add: jest.fn(),
      unwatch: jest.fn(),
      removeAllListeners: jest.fn(() => {
        eventHandlers.clear();
      }),
      emit: jest.fn((event, ...args) => {
        if (eventHandlers.has(event)) {
          eventHandlers.get(event).forEach(callback => callback(...args));
        }
      })
    };
    
    return mockWatcher;
  })
}));

// Mock external API calls
jest.mock('axios', () => ({
  create: jest.fn(() => ({
    get: jest.fn().mockResolvedValue({ data: {} }),
    post: jest.fn().mockResolvedValue({ data: {} }),
    put: jest.fn().mockResolvedValue({ data: {} }),
    delete: jest.fn().mockResolvedValue({ data: {} }),
    head: jest.fn().mockResolvedValue({ headers: {} })
  })),
  get: jest.fn().mockResolvedValue({ data: {} }),
  post: jest.fn().mockResolvedValue({ data: {} }),
  put: jest.fn().mockResolvedValue({ data: {} }),
  delete: jest.fn().mockResolvedValue({ data: {} }),
  head: jest.fn().mockResolvedValue({ headers: {} })
}));

// Mock PermissionManager to prevent database hanging in contract tests
jest.mock('./src/permissions/PermissionManager', () => {
  return jest.fn().mockImplementation(() => ({
    hasPermission: jest.fn().mockResolvedValue(true),
    getUserPermissions: jest.fn().mockResolvedValue(['read', 'search']),
    checkDocumentAccess: jest.fn().mockResolvedValue(true),
    initialize: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined)
  }));
});

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.DB_HOST = 'localhost';
process.env.DB_PORT = '5432';
process.env.DB_NAME = 'thewell_pipeline_test';
process.env.DB_USER = 'charlieirwin';
process.env.DB_PASSWORD = '';
process.env.REDIS_URL = 'redis://localhost:6379';

// Increase test timeout for CI environment
jest.setTimeout(process.env.JEST_TIMEOUT ? parseInt(process.env.JEST_TIMEOUT) : 30000);

// Global test setup
beforeAll(async () => {
  // Any global setup needed
});

// Global cleanup to prevent Jest hanging
afterAll(async () => {
  // Close any remaining timers
  jest.clearAllTimers();
  
  // Clear all mocks
  jest.clearAllMocks();
  
  // Force garbage collection if available
  if (global.gc) {
    global.gc();
  }
  
  // Give a small delay for cleanup
  await new Promise(resolve => setTimeout(resolve, 100));
});

// Reset mocks between tests
beforeEach(() => {
  jest.clearAllMocks();
  jest.clearAllTimers();
});
