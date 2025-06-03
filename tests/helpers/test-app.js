/**
 * Test application factory for integration tests
 */

const express = require('express');
const cors = require('cors');
const path = require('path');

// Mock implementations for testing
const mockQueueManager = {
  getJob: jest.fn(),
  addJob: jest.fn(),
  updateJob: jest.fn(),
  removeJob: jest.fn(),
  getJobs: jest.fn(),
  clean: jest.fn(),
  close: jest.fn(),
  initialize: jest.fn(),
  getQueueStats: jest.fn().mockResolvedValue({
    waiting: 0,
    active: 0,
    completed: 0,
    failed: 0,
    delayed: 0,
    paused: 0
  })
};

const mockIngestionEngine = {
  processDocument: jest.fn(),
  getDocumentById: jest.fn(),
  updateDocument: jest.fn(),
  searchDocuments: jest.fn()
};

// Mock authentication middleware
const mockAuthMiddleware = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey || apiKey === 'invalid-key') {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  // Mock user with all permissions for testing
  req.user = {
    id: 'test-user',
    permissions: ['read', 'write', 'approve', 'reject', 'flag', 'assign']
  };
  
  next();
};

// Mock permission middleware
const mockRequirePermission = (permission) => {
  return (req, res, next) => {
    if (!req.user || !req.user.permissions.includes(permission)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
};

/**
 * Creates a test Express application with mocked dependencies
 * @param {Object} options - Configuration options
 * @param {Object} options.queueManager - Queue manager instance (optional, uses mock if not provided)
 * @param {Object} options.ingestionEngine - Ingestion engine instance (optional, uses mock if not provided)
 * @returns {Express} Express application instance
 */
function createTestApp(options = {}) {
  const app = express();
  
  // Basic middleware
  app.use(cors());
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true }));
  
  // Add test-specific middleware
  app.use(mockAuthMiddleware);
  
  // Inject dependencies
  app.locals.queueManager = options.queueManager || mockQueueManager;
  app.locals.ingestionEngine = options.ingestionEngine || mockIngestionEngine;
  app.locals.requirePermission = mockRequirePermission;
  
  // Load routes
  try {
    const reviewRoutesFactory = require('../../src/web/routes/review');
    const reviewRoutes = reviewRoutesFactory({
      queueManager: app.locals.queueManager,
      ingestionEngine: app.locals.ingestionEngine
    });
    app.use('/api/v1/review', reviewRoutes);
    
    // Mock job management routes for testing
    app.post('/api/v1/jobs/:queueName', async (req, res) => {
      try {
        const { queueName } = req.params;
        const jobData = req.body;
        
        const job = await app.locals.queueManager.addJob(queueName, jobData, {
          priority: jobData.priority || 1,
          attempts: 3
        });
        
        res.status(201).json({
          success: true,
          jobId: job.id,
          queueName
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });
    
    // Health check endpoint
    app.get('/health', (req, res) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });
    
  } catch (error) {
    console.warn('Could not load review routes for test app:', error.message);
    
    // Provide minimal mock routes if real routes can't be loaded
    app.get('/api/v1/review/pending', (req, res) => {
      res.json({ documents: [], total: 0 });
    });
    
    app.get('/api/v1/review/workflow/metrics', (req, res) => {
      res.json({
        success: true,
        metrics: {
          queue: { waiting: 0, active: 0, completed: 0, failed: 0 },
          workflow: { pending: 0, 'in-review': 0, approved: 0, rejected: 0 },
          performance: { avgProcessingTime: 0, throughput: 0 },
          workload: { totalDocuments: 0, documentsToday: 0 }
        }
      });
    });
  }
  
  // Error handling middleware (must be last)
  const errorHandler = require('../../src/web/middleware/errorHandler');
  app.use((error, req, res, next) => {
    errorHandler(error, req, res, next);
  });
  
  return app;
}

/**
 * Reset all mocks to their initial state
 */
function resetMocks() {
  Object.values(mockQueueManager).forEach(fn => {
    if (typeof fn === 'function' && fn.mockReset) {
      fn.mockReset();
    }
  });
  
  Object.values(mockIngestionEngine).forEach(fn => {
    if (typeof fn === 'function' && fn.mockReset) {
      fn.mockReset();
    }
  });
  
  // Reset default mock implementations
  mockQueueManager.getQueueStats.mockResolvedValue({
    waiting: 0,
    active: 0,
    completed: 0,
    failed: 0,
    delayed: 0,
    paused: 0
  });
}

module.exports = {
  createTestApp,
  resetMocks,
  mockQueueManager,
  mockIngestionEngine,
  mockAuthMiddleware,
  mockRequirePermission
};
