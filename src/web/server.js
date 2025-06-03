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

// Import middleware
const authMiddleware = require('./middleware/auth');
const errorHandler = require('./middleware/errorHandler');
const { TracingMiddleware } = require('../tracing');

class ManualReviewServer {
  constructor(options = {}) {
    this.port = options.port !== undefined ? options.port : (process.env.WEB_PORT || 3000);
    this.host = options.host || process.env.WEB_HOST || 'localhost';
    this.queueManager = options.queueManager;
    this.ingestionEngine = options.ingestionEngine;
    this.databaseManager = options.databaseManager;
    this.ragManager = options.ragManager;
    this.cacheManager = options.cacheManager;
    this.sourceReliabilityService = options.sourceReliabilityService;
    
    // Initialize tracing middleware
    this.tracingMiddleware = new TracingMiddleware({
      tracingManager: options.tracingManager,
      excludePaths: ['/health', '/metrics', '/favicon.ico', '/static'],
      includeRequestBody: false, // Don't log request bodies for privacy
      includeResponseBody: false, // Don't log response bodies for privacy
    });
    
    this.app = express();
    this.server = null;
    this.isRunning = false;
    
    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
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

    // Tracing middleware
    this.app.use(this.tracingMiddleware.middleware());

    // Authentication middleware for protected routes
    this.app.use('/api', authMiddleware);

    // Set up application dependencies
    if (this.databaseManager) {
      const FeedbackDAO = require('../database/FeedbackDAO');
      this.app.set('feedbackDAO', new FeedbackDAO(this.databaseManager));
    }
  }

  /**
   * Setup application routes
   */
  setupRoutes() {
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        services: {
          queueManager: this.queueManager?.isInitialized || false,
          ingestionEngine: this.ingestionEngine?.isInitialized || false
        }
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

    this.app.use('/api', apiRoutes({
      queueManager: this.queueManager,
      ingestionEngine: this.ingestionEngine
    }));

    // 404 handler for API routes
    this.app.use('/api/*', (req, res, next) => {
      res.status(404).json({
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

      // Graceful shutdown handling
      process.on('SIGTERM', () => this.shutdown());
      process.on('SIGINT', () => this.shutdown());

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
