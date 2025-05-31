const ConfigManager = require('./ConfigManager');
const logger = require('../utils/logger');

/**
 * ConfigIntegration handles the integration between ConfigManager and the ingestion system
 * Applies configuration changes to running components safely
 */
class ConfigIntegration {
  constructor(options = {}) {
    this.configManager = new ConfigManager(options.configManager);
    this.components = new Map();
    this.isInitialized = false;
    
    // Bind event handlers
    this.handleConfigChange = this.handleConfigChange.bind(this);
    this.handleConfigRemoval = this.handleConfigRemoval.bind(this);
    this.handleConfigError = this.handleConfigError.bind(this);
  }

  /**
   * Initialize the configuration integration
   */
  async initialize() {
    if (this.isInitialized) {
      logger.warn('ConfigIntegration is already initialized');
      return;
    }

    try {
      // Set up event listeners
      this.configManager.on('config-changed', this.handleConfigChange);
      this.configManager.on('config-removed', this.handleConfigRemoval);
      this.configManager.on('error', this.handleConfigError);

      // Start watching configurations
      await this.configManager.startWatching();
      
      this.isInitialized = true;
      logger.info('ConfigIntegration initialized successfully');
      
    } catch (error) {
      logger.error('Failed to initialize ConfigIntegration', { error: error.message });
      throw error;
    }
  }

  /**
   * Shutdown the configuration integration
   */
  async shutdown() {
    if (!this.isInitialized) {
      return;
    }

    try {
      // Remove event listeners
      this.configManager.removeListener('config-changed', this.handleConfigChange);
      this.configManager.removeListener('config-removed', this.handleConfigRemoval);
      this.configManager.removeListener('error', this.handleConfigError);

      // Stop watching configurations
      await this.configManager.stopWatching();
      
      this.isInitialized = false;
      logger.info('ConfigIntegration shutdown successfully');
      
    } catch (error) {
      logger.error('Error during ConfigIntegration shutdown', { error: error.message });
      throw error;
    }
  }

  /**
   * Register a component for configuration updates
   */
  registerComponent(name, component) {
    if (!name || !component) {
      throw new Error('Component name and instance are required');
    }

    if (!component.updateConfig || typeof component.updateConfig !== 'function') {
      throw new Error('Component must have an updateConfig method');
    }

    this.components.set(name, component);
    logger.debug('Registered component for configuration updates', { name });
  }

  /**
   * Unregister a component
   */
  unregisterComponent(name) {
    if (this.components.has(name)) {
      this.components.delete(name);
      logger.debug('Unregistered component', { name });
    }
  }

  /**
   * Get current configuration for a specific type
   */
  getConfig(configType) {
    return this.configManager.getConfig(configType);
  }

  /**
   * Get all current configurations
   */
  getAllConfigs() {
    return this.configManager.getAllConfigs();
  }

  /**
   * Manually reload a configuration file
   */
  async reloadConfig(filePath) {
    try {
      await this.configManager.loadConfig(filePath);
      logger.info('Configuration reloaded successfully', { filePath });
    } catch (error) {
      logger.error('Failed to reload configuration', { filePath, error: error.message });
      throw error;
    }
  }

  /**
   * Handle configuration changes
   */
  async handleConfigChange(event) {
    const { configType, newConfig, previousConfig, filePath } = event;
    
    try {
      logger.info('Applying configuration change', { 
        configType, 
        filePath,
        hasChanges: JSON.stringify(previousConfig) !== JSON.stringify(newConfig)
      });

      // Apply configuration to relevant components
      await this.applyConfigToComponents(configType, newConfig, previousConfig);
      
      logger.info('Configuration change applied successfully', { configType });
      
    } catch (error) {
      logger.error('Failed to apply configuration change', {
        configType,
        filePath,
        error: error.message
      });
      
      // Attempt to rollback if possible
      if (previousConfig) {
        try {
          await this.applyConfigToComponents(configType, previousConfig, newConfig);
          logger.info('Configuration rollback successful', { configType });
        } catch (rollbackError) {
          logger.error('Configuration rollback failed', {
            configType,
            error: rollbackError.message
          });
        }
      }
    }
  }

  /**
   * Handle configuration removal
   */
  async handleConfigRemoval(event) {
    const { configType, previousConfig, filePath } = event;
    
    try {
      logger.info('Handling configuration removal', { configType, filePath });

      // Notify components about configuration removal
      await this.notifyConfigRemoval(configType, previousConfig);
      
      logger.info('Configuration removal handled successfully', { configType });
      
    } catch (error) {
      logger.error('Failed to handle configuration removal', {
        configType,
        filePath,
        error: error.message
      });
    }
  }

  /**
   * Handle configuration errors
   */
  handleConfigError(event) {
    const { type, error, filePath } = event;
    
    logger.error('Configuration error occurred', {
      type,
      filePath,
      error: error.message
    });

    // Emit error for external handling
    if (this.configManager.listenerCount && this.configManager.listenerCount('integration-error') > 0) {
      this.configManager.emit('integration-error', event);
    }
  }

  /**
   * Apply configuration changes to registered components
   */
  async applyConfigToComponents(configType, newConfig, previousConfig) {
    const applicableComponents = this.getApplicableComponents(configType);
    
    if (applicableComponents.length === 0) {
      logger.debug('No components to update for config type', { configType });
      return;
    }

    const updatePromises = applicableComponents.map(async ({ name, component }) => {
      try {
        await component.updateConfig(configType, newConfig, previousConfig);
        logger.debug('Component configuration updated', { name, configType });
      } catch (error) {
        logger.error('Failed to update component configuration', {
          name,
          configType,
          error: error.message
        });
        throw error;
      }
    });

    await Promise.all(updatePromises);
  }

  /**
   * Notify components about configuration removal
   */
  async notifyConfigRemoval(configType, previousConfig) {
    const applicableComponents = this.getApplicableComponents(configType);
    
    const notifyPromises = applicableComponents.map(async ({ name, component }) => {
      try {
        if (component.handleConfigRemoval && typeof component.handleConfigRemoval === 'function') {
          await component.handleConfigRemoval(configType, previousConfig);
          logger.debug('Component notified of configuration removal', { name, configType });
        }
      } catch (error) {
        logger.error('Failed to notify component of configuration removal', {
          name,
          configType,
          error: error.message
        });
      }
    });

    await Promise.all(notifyPromises);
  }

  /**
   * Get components that should be updated for a specific configuration type
   */
  getApplicableComponents(configType) {
    const applicable = [];
    
    for (const [name, component] of this.components) {
      // Check if component has a method to determine if it handles this config type
      if (component.handlesConfigType && typeof component.handlesConfigType === 'function') {
        if (component.handlesConfigType(configType)) {
          applicable.push({ name, component });
        }
      } else {
        // Default: assume all components can handle any config type
        applicable.push({ name, component });
      }
    }
    
    return applicable;
  }

  /**
   * Get integration statistics
   */
  getStats() {
    return {
      isInitialized: this.isInitialized,
      componentCount: this.components.size,
      registeredComponents: Array.from(this.components.keys()),
      configManager: this.configManager.getStats()
    };
  }

  /**
   * Validate all current configurations
   */
  async validateAllConfigs() {
    const configs = this.configManager.getAllConfigs();
    const results = {};
    
    for (const [configType, config] of Object.entries(configs)) {
      try {
        await this.configManager.validateConfig(configType, config);
        results[configType] = { valid: true };
      } catch (error) {
        results[configType] = { 
          valid: false, 
          error: error.message,
          details: error.details 
        };
      }
    }
    
    return results;
  }
}

module.exports = ConfigIntegration;