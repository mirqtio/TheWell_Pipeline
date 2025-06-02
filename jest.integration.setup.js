/**
 * Jest Setup File for Integration Tests
 * Configures test environment without database mocks for real database testing
 */

// Mock Redis connections (but not PostgreSQL)
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
    getJob: jest.fn().mockResolvedValue(null),
    pause: jest.fn().mockResolvedValue(undefined),
    resume: jest.fn().mockResolvedValue(undefined),
    empty: jest.fn().mockResolvedValue(undefined),
    getWaiting: jest.fn().mockResolvedValue([]),
    getActive: jest.fn().mockResolvedValue([]),
    getCompleted: jest.fn().mockResolvedValue([]),
    getFailed: jest.fn().mockResolvedValue([]),
    getDelayed: jest.fn().mockResolvedValue([]),
    removeJobs: jest.fn().mockResolvedValue(undefined)
  }));
});

// Mock external HTTP requests
jest.mock('axios', () => ({
  default: {
    get: jest.fn().mockResolvedValue({ data: {} }),
    post: jest.fn().mockResolvedValue({ data: {} }),
    put: jest.fn().mockResolvedValue({ data: {} }),
    delete: jest.fn().mockResolvedValue({ data: {} }),
    create: jest.fn().mockReturnThis()
  },
  get: jest.fn().mockResolvedValue({ data: {} }),
  post: jest.fn().mockResolvedValue({ data: {} }),
  put: jest.fn().mockResolvedValue({ data: {} }),
  delete: jest.fn().mockResolvedValue({ data: {} }),
  create: jest.fn().mockReturnThis()
}));

// Mock file system operations that might be slow
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  promises: {
    ...jest.requireActual('fs').promises,
    readFile: jest.fn().mockResolvedValue(''),
    writeFile: jest.fn().mockResolvedValue(undefined),
    mkdir: jest.fn().mockResolvedValue(undefined),
    rmdir: jest.fn().mockResolvedValue(undefined),
    unlink: jest.fn().mockResolvedValue(undefined),
    stat: jest.fn().mockResolvedValue({ isDirectory: () => false, isFile: () => true }),
    readdir: jest.fn().mockResolvedValue([])
  }
}));

// Global test timeout
jest.setTimeout(30000);

// Suppress console output during tests unless DEBUG is set
if (!process.env.DEBUG) {
  global.console = {
    ...console,
    log: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: console.warn,
    error: console.error
  };
}

// Clean up after each test
afterEach(() => {
  jest.clearAllMocks();
});
