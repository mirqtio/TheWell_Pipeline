/**
 * Configuration Hot-Reload Setup for TheWell Pipeline
 * Integrates ConfigManager and ConfigIntegration with IngestionEngine and QueueManager
 */

const path = require('path');
const { ConfigIntegration } = require('./index');
const logger = require('../utils/logger');

/**
 * Set up configuration hot-reload for the ingestion system
 * @param {Object} options - Setup options
 * @param {IngestionEngine} options.ingestionEngine - The ingestion engine instance
 * @param {QueueManager} options.queueManager - The queue manager instance
 * @param {string} options.configDir - Configuration directory path
 * @returns {ConfigIntegration} - Configured integration instance
 */
async function setupConfigHotReload(options = {}) {
  const {
    ingestionEngine,
    queueManager,
    configDir = path.join(process.cwd(), 'config')
  } = options;

  if (!ingestionEngine) {
    throw new Error('IngestionEngine instance is required');
  }

  if (!queueManager) {
    throw new Error('QueueManager instance is required');
  }

  logger.info('Setting up configuration hot-reload', { configDir });

  // Create ConfigIntegration instance
  const configIntegration = new ConfigIntegration({
    configManager: {
      configDir,
      watchOptions: {
        ignoreInitial: false,
        persistent: true
      }
    }
  });

  // Register IngestionEngine component
  configIntegration.registerComponent('ingestionEngine', {
    updateConfig: async (configType, newConfig) => {
      if (configType === 'sources') {
        logger.info('Updating ingestion engine sources', { 
          sourceCount: newConfig.sources?.length || 0 
        });
        await ingestionEngine.updateSources(newConfig.sources || []);
      } else if (configType === 'ingestion') {
        logger.info('Updating ingestion engine settings', { newConfig });
        await ingestionEngine.updateSettings(newConfig);
      }
    },
    handlesConfigType: (configType) => ['sources', 'ingestion'].includes(configType)
  });

  // Register QueueManager component
  configIntegration.registerComponent('queueManager', {
    updateConfig: async (configType, newConfig) => {
      if (configType === 'queue') {
        logger.info('Updating queue manager configuration', { newConfig });
        await queueManager.updateConfig(newConfig);
      }
    },
    handlesConfigType: (configType) => configType === 'queue'
  });

  // Set up error handling
  configIntegration.configManager.on('integration-error', (event) => {
    logger.error('Configuration integration error', {
      type: event.type,
      filePath: event.filePath,
      error: event.error
    });
  });

  // Set up configuration change logging
  configIntegration.configManager.on('config-changed', (event) => {
    logger.info('Configuration changed', {
      configType: event.configType,
      filePath: event.filePath,
      hasChanges: event.hasChanges
    });
  });

  // Initialize the configuration integration
  await configIntegration.initialize();

  logger.info('Configuration hot-reload setup complete');

  return configIntegration;
}

/**
 * Gracefully shutdown configuration hot-reload
 * @param {ConfigIntegration} configIntegration - The integration instance to shutdown
 */
async function shutdownConfigHotReload(configIntegration) {
  if (!configIntegration) {
    return;
  }

  logger.info('Shutting down configuration hot-reload');

  try {
    await configIntegration.shutdown();
    logger.info('Configuration hot-reload shutdown complete');
  } catch (error) {
    logger.error('Error during configuration hot-reload shutdown', { 
      error: error.message 
    });
    throw error;
  }
}

module.exports = {
  setupConfigHotReload,
  shutdownConfigHotReload
};
