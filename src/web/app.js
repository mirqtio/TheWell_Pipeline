/**
 * Express App Configuration
 * Exports configured Express app for testing and server use
 */

const express = require('express');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');
const logger = require('../utils/logger');
const SourceReliabilityService = require('../services/SourceReliabilityService');

// Import Swagger configuration
const { serve, setup } = require('./swagger');

// Import performance optimization
const { RequestThrottler } = require('../rag/performance');

// Import routes
const reviewRoutes = require('./routes/review');
const jobRoutes = require('./routes/jobs');
const apiRoutes = require('./routes/api');
const visibilityRoutes = require('./routes/visibility');
const feedbackRoutes = require('./routes/feedback');
const ragRoutes = require('./routes/rag');
const reliabilityRoutes = require('./routes/reliability');
const curationRoutes = require('./routes/curation');
const adminRoutes = require('./routes/admin');
const usersRoutes = require('./routes/users');
const rolesRoutes = require('./routes/roles');
const versioningRoutes = require('./routes/versioning');
const entitiesRoutes = require('./routes/entities');

// Import middleware
const authMiddleware = require('./middleware/auth');
const errorHandler = require('./middleware/errorHandler');
const { checkOptionalAuth, rateLimit } = require('./middleware/rbac');

// Create Express app
const app = express();

// Initialize request throttler for production
let requestThrottler = null;
if (process.env.NODE_ENV === 'production') {
  requestThrottler = new RequestThrottler({
    maxConcurrentRequests: parseInt(process.env.MAX_CONCURRENT_REQUESTS) || 10,
    maxQueueSize: parseInt(process.env.MAX_QUEUE_SIZE) || 50,
    requestTimeoutMs: parseInt(process.env.REQUEST_TIMEOUT_MS) || 30000,
    rateLimitPerMinute: parseInt(process.env.RATE_LIMIT_PER_MINUTE) || 60
  });
  
  // Initialize throttler
  requestThrottler.initialize().catch(error => {
    logger.error('Failed to initialize request throttler:', error);
  });
}

// Setup middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true
}));

app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// Static files
app.use('/static', express.static(path.join(__dirname, 'public')));

/**
 * @swagger
 * /health:
 *   get:
 *     summary: Health check endpoint
 *     description: Returns the health status of the service
 *     tags: [System]
 *     responses:
 *       200:
 *         description: Service is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: healthy
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                 service:
 *                   type: string
 *                   example: manual-review-server
 */
// Health check endpoint (no auth required)
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'manual-review-server'
  });
});

// Swagger documentation (no auth required)
app.use('/api-docs', serve, setup);

// Apply authentication middleware to API routes only
app.use((req, res, next) => {
  // Skip auth for health check, docs, and UI routes
  if (req.path === '/health' || 
      req.path.startsWith('/api-docs') || 
      req.path === '/' ||
      req.path.startsWith('/static') ||
      req.path.startsWith('/admin') ||
      req.path.startsWith('/dashboard') ||
      req.path.endsWith('.html') ||
      req.path.endsWith('.css') ||
      req.path.endsWith('.js') ||
      req.path.endsWith('.png') ||
      req.path.endsWith('.jpg') ||
      req.path.endsWith('.ico')) {
    return next();
  }
  
  // Only apply auth to API routes
  if (req.path.startsWith('/api')) {
    return authMiddleware(req, res, next);
  }
  
  return next();
});

// Apply request throttling to API routes (except health and docs)
if (requestThrottler) {
  app.use('/api', requestThrottler.middleware());
}

// Setup routes
app.use('/api/v1/review', reviewRoutes);
app.use('/api/v1/jobs', jobRoutes);
app.use('/api/v1', apiRoutes);
app.use('/api/v1/visibility', visibilityRoutes);
app.use('/api/v1/feedback', feedbackRoutes);
app.use('/api/v1/curation', curationRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/users', usersRoutes);
app.use('/api/v1/roles', rolesRoutes);
app.use('/api/v1', versioningRoutes);
app.use('/api/v1/entities', entitiesRoutes);

// Initialize SourceReliabilityService for production use
let sourceReliabilityService = global.testSourceReliabilityService;
if (!sourceReliabilityService) {
  try {
    // Only initialize if we're in a proper server context with dependencies
    sourceReliabilityService = new SourceReliabilityService();
  } catch (error) {
    // If initialization fails (missing dependencies), use null
    logger.warn('SourceReliabilityService initialization failed, using null:', error.message);
    sourceReliabilityService = null;
  }
}

// Reliability routes with dependencies injection
app.use('/api/v1/reliability', reliabilityRoutes({
  sourceReliabilityService: sourceReliabilityService
}));

// RAG routes with dependencies injection
app.use('/api/v1/rag', ragRoutes({
  ragManager: global.testRagManager || null,
  cacheManager: global.testCacheManager || null
}));

// Serve the main review interface
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Not Found',
    message: `Route ${req.method} ${req.path} not found`,
    timestamp: new Date().toISOString()
  });
});

// Error handling middleware
app.use(errorHandler.errorHandler);

module.exports = app;
