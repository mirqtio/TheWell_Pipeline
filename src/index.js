#!/usr/bin/env node

/**
 * Main entry point for TheWell Pipeline
 * This script starts the complete pipeline system including:
 * - Web interface for manual review
 * - Ingestion engine for processing documents
 * - Background job processing
 */

const logger = require('./utils/logger');

async function startPipeline() {
  try {
    logger.info('Starting TheWell Pipeline...');
    
    // Start the web server for manual review interface
    const { startWebServer } = require('./web/start');
    await startWebServer();
    
    logger.info('TheWell Pipeline started successfully');
    
    // Handle graceful shutdown
    process.on('SIGTERM', () => {
      logger.info('Received SIGTERM, shutting down gracefully...');
      process.exit(0);
    });
    
    process.on('SIGINT', () => {
      logger.info('Received SIGINT, shutting down gracefully...');
      process.exit(0);
    });
    
  } catch (error) {
    logger.error('Failed to start TheWell Pipeline', { error: error.message, stack: error.stack });
    process.exit(1);
  }
}

// Start the pipeline if this script is run directly
if (require.main === module) {
  startPipeline();
}

module.exports = { startPipeline };
