#!/usr/bin/env node

/**
 * Server script that starts the full app.js Express application
 * Used for e2e tests that need all routes including curation
 */

const app = require('./app');
const logger = require('../utils/logger');
const DatabaseManager = require('../database/DatabaseManager');
const AuditService = require('../services/AuditService');
const SourceReliabilityService = require('../services/SourceReliabilityService');
const DashboardManager = require('../monitoring/dashboard/DashboardManager');

async function startServer() {
  const port = process.env.WEB_PORT || process.env.PORT || 3000;
  const host = process.env.WEB_HOST || 'localhost';
  
  try {
    // Initialize dependencies for test mode
    if (process.env.NODE_ENV === 'test' || process.env.E2E_TEST_MODE === 'true') {
      logger.info('Initializing test dependencies...');
      
      // Initialize database manager
      const databaseManager = new DatabaseManager({
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432'),
        database: process.env.DB_NAME || 'thewell_test',
        username: process.env.DB_USER || 'thewell_test',
        password: process.env.DB_PASSWORD || 'thewell_test_password'
      });
      await databaseManager.initialize();
      
      // Initialize audit service
      const auditService = new AuditService({ databaseManager });
      
      // Initialize source reliability service
      const sourceReliabilityService = new SourceReliabilityService({
        databaseManager,
        auditService
      });
      
      // Initialize dashboard manager
      const dashboardManager = new DashboardManager({
        databaseManager,
        logger
      });
      
      // Set dependencies on app for route access
      app.set('databaseManager', databaseManager);
      app.set('auditService', auditService);
      app.set('sourceReliabilityService', sourceReliabilityService);
      app.set('dashboardManager', dashboardManager);
      app.set('feedbackDAO', require('../database/FeedbackDAO'));
      
      // Set global test instances for routes that check for them
      global.testSourceReliabilityService = sourceReliabilityService;
    }
    
    const server = app.listen(port, host, () => {
      logger.info(`App server started on http://${host}:${port}`);
      logger.info('Available routes:');
      logger.info('  - GET  /health              - Health check');
      logger.info('  - GET  /api-docs            - API documentation');
      logger.info('  - ALL  /api/v1/review/*     - Review routes');
      logger.info('  - ALL  /api/v1/jobs/*       - Jobs routes');
      logger.info('  - ALL  /api/v1/curation/*   - Curation routes');
      logger.info('  - ALL  /api/v1/feedback/*   - Feedback routes');
      logger.info('  - ALL  /api/v1/admin/*      - Admin routes');
      logger.info('  - ALL  /api/v1/dashboard/*  - Dashboard routes');
    });
    
    // Graceful shutdown
    const gracefulShutdown = async (signal) => {
      logger.info(`Received ${signal}, shutting down gracefully...`);
      
      server.close(() => {
        logger.info('Server closed');
        process.exit(0);
      });
      
      // Force exit after 10 seconds
      setTimeout(() => {
        logger.error('Force closing server after timeout');
        process.exit(1);
      }, 10000);
    };
    
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    
  } catch (error) {
    logger.error('Failed to start app server:', error);
    process.exit(1);
  }
}

// Start the server if this script is run directly
if (require.main === module) {
  startServer();
}

module.exports = { startServer };