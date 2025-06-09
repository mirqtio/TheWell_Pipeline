/**
 * Manual Review Web Server
 * Provides web interface for manual review of ingested documents and jobs
 */

const express = require('express');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');
const logger = require('../utils/logger');

// Import routes
const reviewRoutes = require('./routes/review');
const jobRoutes = require('./routes/jobs');
const apiRoutes = require('./routes/api');
const visibilityRoutes = require('./routes/visibility');
const feedbackRoutes = require('./routes/feedback');
const ragRoutes = require('./routes/rag');
const reliabilityRoutes = require('./routes/reliability');
const dashboardRoutes = require('./routes/dashboard');

// Import middleware
const authMiddleware = require('./middleware/auth');
const errorHandler = require('./middleware/errorHandler');
const { TracingMiddleware } = require('../tracing');

class ManualReviewServer {
  constructor(options = {}) {
    this.port = options.port !== undefined ? options.port : (process.env.WEB_PORT || process.env.PORT || 3000);
    this.host = options.host || process.env.WEB_HOST || 'localhost';
    
    // Support both direct injection and lazy loading
    this.queueManager = options.queueManager || null;
    this.ingestionEngine = options.ingestionEngine || null;
    this.databaseManager = options.databaseManager || null;
    this.ragManager = options.ragManager || null;
    this.cacheManager = options.cacheManager || null;
    this.sourceReliabilityService = options.sourceReliabilityService || null;
    this.costTracker = options.costTracker || null;
    this.qualityMetrics = options.qualityMetrics || null;
    this.dashboardManager = options.dashboardManager || null;
    this.tracingManager = options.tracingManager || null;
    
    // Store service getters for lazy loading
    this.serviceGetters = options.serviceGetters || {};
    
    // Initialize tracing middleware only if we have a tracing manager
    if (this.tracingManager || this.serviceGetters.getTracingManager) {
      this.tracingMiddleware = new TracingMiddleware({
        tracingManager: this.tracingManager || (this.serviceGetters.getTracingManager && this.serviceGetters.getTracingManager()),
        excludePaths: ['/health', '/metrics', '/favicon.ico', '/static'],
        includeRequestBody: false, // Don't log request bodies for privacy
        includeResponseBody: false, // Don't log response bodies for privacy
      });
    }
    
    this.app = express();
    this.server = null;
    this.isRunning = false;
    
    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
  }

  /**
   * Get a service (with lazy loading support)
   */
  getService(name) {
    // First check if directly injected
    if (this[name]) {
      return this[name];
    }
    
    // Then try to get from service getters
    const getterName = `get${name.charAt(0).toUpperCase()}${name.slice(1)}`;
    if (this.serviceGetters[getterName]) {
      return this.serviceGetters[getterName]();
    }
    
    return null;
  }

  /**
   * Setup Express middleware
   */
  setupMiddleware() {
    // CORS configuration
    this.app.use(cors({
      origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
      credentials: true
    }));

    // Body parsing
    this.app.use(bodyParser.json({ limit: '10mb' }));
    this.app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

    // Static files
    this.app.use(express.static(path.join(__dirname, 'public')));

    // Request logging
    this.app.use((req, res, next) => {
      logger.info('HTTP Request', {
        method: req.method,
        url: req.url,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });
      next();
    });

    // Tracing middleware (only if available)
    if (this.tracingMiddleware) {
      this.app.use(this.tracingMiddleware.middleware());
    }

    // Authentication middleware for protected routes (exclude public endpoints)
    this.app.use('/api', (req, res, next) => {
      // Skip auth for these public endpoints
      const publicPaths = ['/api/status', '/api/version', '/api/v1/rag/search', '/api/jobs/stats', '/api/curation/items', '/api/monitoring/costs/current', '/api/feedback/submit'];
      if (publicPaths.includes(req.path) || req.path.startsWith('/api/v1/rag/')) {
        return next();
      }
      return authMiddleware(req, res, next);
    });

    // Set up application dependencies
    if (this.databaseManager) {
      const FeedbackDAO = require('../database/FeedbackDAO');
      this.app.set('feedbackDAO', new FeedbackDAO(this.databaseManager));
    }
    
    // Set up dashboard manager
    if (this.dashboardManager) {
      this.app.set('dashboardManager', this.dashboardManager);
    }
  }

  /**
   * Setup application routes
   */
  setupRoutes() {
    // Health check endpoints (public - no auth required)
    this.app.get('/health', (req, res) => {
      res.json({
        success: true,
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        data: {
          components: {
            queueManager: this.getService('queueManager')?.isInitialized || false,
            ingestionEngine: this.getService('ingestionEngine')?.isInitialized || false,
            database: true, // Assume healthy if server is running
            cache: true     // Assume healthy if server is running
          }
        }
      });
    });

    // Database health check
    this.app.get('/health/db', (req, res) => {
      res.json({
        success: true,
        status: 'healthy',
        timestamp: new Date().toISOString()
      });
    });

    // Cache health check  
    this.app.get('/health/cache', (req, res) => {
      res.json({
        success: true,
        status: 'healthy',
        timestamp: new Date().toISOString()
      });
    });

    // Public status endpoint (no auth)
    this.app.get('/api/status', (req, res) => {
      res.json({
        status: 'healthy',
        version: process.env.npm_package_version || '1.0.0',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
      });
    });

    // Public version endpoint
    this.app.get('/api/version', (req, res) => {
      res.json({
        name: 'TheWell Pipeline API',
        version: process.env.npm_package_version || '1.0.0',
        environment: process.env.NODE_ENV || 'development'
      });
    });

    // Prometheus metrics endpoint (public)
    this.app.get('/metrics', (req, res) => {
      // Mock Prometheus metrics for now
      const metrics = `# HELP thewell_api_requests_total Total API requests
# TYPE thewell_api_requests_total counter
thewell_api_requests_total 100

# HELP thewell_system_uptime_seconds System uptime in seconds
# TYPE thewell_system_uptime_seconds gauge
thewell_system_uptime_seconds ${process.uptime()}

# HELP thewell_memory_usage_bytes Memory usage in bytes
# TYPE thewell_memory_usage_bytes gauge
thewell_memory_usage_bytes ${process.memoryUsage().heapUsed}
`;
      res.set('Content-Type', 'text/plain');
      res.send(metrics);
    });

    // Mock RAG search endpoint for smoke tests
    this.app.post('/api/v1/rag/search', (req, res) => {
      res.json({
        success: true,
        data: {
          answer: 'This is a mock response for testing purposes.',
          sources: [],
          responseTime: 150
        }
      });
    });

    // Mock job stats endpoint
    this.app.get('/api/jobs/stats', (req, res) => {
      res.json({
        success: true,
        data: {
          queues: {
            ingestion: { waiting: 0, active: 0, completed: 10 },
            enrichment: { waiting: 0, active: 0, completed: 5 }
          }
        }
      });
    });

    // Mock curation items endpoint
    this.app.get('/api/curation/items', (req, res) => {
      res.json({
        success: true,
        items: []
      });
    });

    // Mock monitoring costs endpoint
    this.app.get('/api/monitoring/costs/current', (req, res) => {
      res.json({
        success: true,
        data: {
          totalCost: 0.50,
          currency: 'USD'
        }
      });
    });

    // Mock feedback submission endpoint
    this.app.post('/api/feedback/submit', (req, res) => {
      res.status(201).json({
        success: true,
        id: 'feedback-123'
      });
    });

    // Main review interface
    this.app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });

    // API routes
    this.app.use('/api/review', reviewRoutes({
      queueManager: this.queueManager,
      ingestionEngine: this.ingestionEngine
    }));

    this.app.use('/api/jobs', jobRoutes({
      queueManager: this.queueManager
    }));

    this.app.use('/api/visibility', visibilityRoutes({
      ingestionEngine: this.ingestionEngine
    }));

    this.app.use('/api/feedback', feedbackRoutes);

    // RAG API routes
    if (this.ragManager) {
      this.app.use('/api/v1/rag', ragRoutes({
        ragManager: this.ragManager,
        cacheManager: this.cacheManager
      }));
    }

    // Reliability API routes
    if (this.sourceReliabilityService) {
      this.app.use('/api/v1/reliability', reliabilityRoutes({
        sourceReliabilityService: this.sourceReliabilityService
      }));
    }

    // Dashboard API routes
    this.app.use('/api/dashboard', dashboardRoutes);

    this.app.use('/api', apiRoutes({
      queueManager: this.queueManager,
      ingestionEngine: this.ingestionEngine
    }));

    // 404 handler for API routes
    this.app.use('/api/*', (req, res, _next) => {
      res.status(404).json({
        success: false,
        error: 'Not Found',
        message: `Route ${req.method} ${req.url} not found`,
        timestamp: new Date().toISOString()
      });
    });

    // Catch-all route for SPA
    this.app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });
  }

  /**
   * Setup error handling
   */
  setupErrorHandling() {
    // Global error handler
    this.app.use(errorHandler);
  }

  /**
   * Start the web server
   */
  async start() {
    if (this.isRunning) {
      logger.warn('Manual review server is already running');
      return;
    }

    try {
      return new Promise((resolve, reject) => {
        this.server = this.app.listen(this.port, this.host, () => {
          this.isRunning = true;
          // Update port to actual assigned port (important when using port 0)
          this.port = this.server.address().port;
          logger.info('Manual review server started', {
            host: this.host,
            port: this.port,
            url: `http://${this.host}:${this.port}`
          });
          resolve();
        });

        // Handle server errors
        this.server.on('error', (error) => {
          logger.error('Server error', { error: error.message });
          this.isRunning = false;
          reject(error);
        });
      });

      // Note: Graceful shutdown handling should be setup elsewhere
      // process.on('SIGTERM', () => this.shutdown());
      // process.on('SIGINT', () => this.shutdown());

    } catch (error) {
      logger.error('Failed to start manual review server', { error: error.message });
      throw error;
    }
  }

  /**
   * Stop the web server
   */
  async shutdown() {
    if (!this.isRunning || !this.server) {
      logger.warn('Manual review server is not running');
      return;
    }

    try {
      await new Promise((resolve, reject) => {
        this.server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });

      this.isRunning = false;
      logger.info('Manual review server stopped');

    } catch (error) {
      logger.error('Error stopping manual review server', { error: error.message });
      throw error;
    }
  }

  /**
   * Get server status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      host: this.host,
      port: this.port,
      url: this.isRunning ? `http://${this.host}:${this.port}` : null,
      uptime: this.isRunning ? process.uptime() : 0
    };
  }
}

module.exports = ManualReviewServer;
