const chokidar = require('chokidar');
const path = require('path');
const fs = require('fs').promises;
const EventEmitter = require('events');
const Joi = require('joi');
const logger = require('../utils/logger');

/**
 * ConfigManager handles hot-reloading of configuration files
 * Monitors configuration directory and applies changes at runtime
 */
class ConfigManager extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.configDir = options.configDir || path.join(process.cwd(), 'config');
    this.watchOptions = options.watchOptions || {};
    this.watcher = null;
    this.isWatching = false;
    this.validators = new Map();
    this.loadedConfigs = new Map();
    
    // Default configuration schema
    this.registerValidator('sources', this.getSourceConfigSchema());
    this.registerValidator('ingestion', this.getIngestionConfigSchema());
    this.registerValidator('queue', this.getQueueConfigSchema());
  }

  /**
   * Backward compatibility getter for configs
   */
  get configs() {
    return this.loadedConfigs;
  }

  /**
   * Start watching configuration files for changes
   */
  async startWatching() {
    if (this.isWatching) {
      logger.warn('ConfigManager is already watching');
      return;
    }

    try {
      await this.ensureConfigDirectory();
      
      // Create watcher for configuration directory
      this.watcher = chokidar.watch(this.configDir, {
        ignored: /(^|[\/\\])\../, // ignore dotfiles
        persistent: true,
        ...this.watchOptions
      });

      // Debug: log what we're watching
      logger.debug('Creating watcher for directory', { 
        configDir: this.configDir,
        watchOptions: { persistent: true, ...this.watchOptions }
      });

      // Ensure watcher was created successfully
      if (!this.watcher) {
        throw new Error('Failed to create file watcher');
      }

      // Set up event handlers
      this.watcher
        .on('add', (filePath) => {
          logger.debug('Watcher detected file add', { filePath });
          this.handleFileChange('add', filePath);
        })
        .on('change', (filePath) => {
          logger.debug('Watcher detected file change', { filePath });
          this.handleFileChange('change', filePath);
        })
        .on('unlink', (filePath) => {
          logger.debug('Watcher detected file unlink', { filePath });
          this.handleFileChange('unlink', filePath);
        })
        .on('error', (error) => this.handleWatcherError(error))
        .on('all', (eventType, filePath) => {
          logger.debug('Watcher detected any event', { eventType, filePath });
        });

      // Wait for watcher to be ready
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Watcher ready timeout'));
        }, 5000);

        this.watcher.on('ready', () => {
          clearTimeout(timeout);
          this.isWatching = true;
          logger.info('ConfigManager: Started watching configuration files', {
            configDir: this.configDir
          });
          this.emit('ready');
          resolve();
        });
      });

    } catch (error) {
      logger.error('Failed to start ConfigManager watcher', { error: error.message });
      if (this.watcher) {
        await this.watcher.close();
        this.watcher = null;
      }
      throw error;
    }
  }

  /**
   * Stop watching configuration files
   */
  async stopWatching() {
    if (!this.isWatching && !this.watcher) {
      return;
    }

    try {
      this.isWatching = false;
      
      if (this.watcher) {
        // Remove all listeners to prevent memory leaks
        this.watcher.removeAllListeners();
        await this.watcher.close();
        this.watcher = null;
      }
      
      logger.info('ConfigManager: Stopped watching configuration files');
      this.emit('stopped');
      
    } catch (error) {
      logger.error('Error stopping ConfigManager watcher', { error: error.message });
      // Force cleanup even if close() fails
      if (this.watcher) {
        this.watcher.removeAllListeners();
        this.watcher = null;
      }
      this.isWatching = false;
      throw error;
    }
  }

  /**
   * Register a configuration validator
   */
  registerValidator(configType, schema) {
    if (!configType || !schema) {
      throw new Error('Config type and schema are required');
    }
    
    this.validators.set(configType, schema);
    logger.debug('Registered validator for config type', { configType });
  }

  /**
   * Get current configuration for a specific type
   */
  getConfig(configType) {
    return this.loadedConfigs.get(configType);
  }

  /**
   * Get all current configurations
   */
  getAllConfigs() {
    return Object.fromEntries(this.loadedConfigs);
  }

  /**
   * Manually load a configuration file
   */
  async loadConfig(filePath) {
    try {
      const configType = this.getConfigTypeFromPath(filePath);
      const config = await this.readConfigFile(filePath);
      
      if (config) {
        const validatedConfig = await this.validateConfig(configType, config);
        await this.applyConfigChange(configType, validatedConfig, filePath);
      }
      
    } catch (error) {
      logger.error('Failed to load configuration', { 
        filePath, 
        error: error.message 
      });
      throw error;
    }
  }

  /**
   * Handle file system changes
   */
  async handleFileChange(eventType, filePath) {
    try {
      const configType = this.getConfigTypeFromPath(filePath);
      
      if (!configType) {
        logger.debug('Ignoring non-config file', { filePath, eventType });
        return;
      }

      logger.info('Configuration file changed', { 
        eventType, 
        filePath, 
        configType 
      });

      switch (eventType) {
        case 'add':
        case 'change':
          await this.handleConfigUpdate(configType, filePath);
          break;
          
        case 'unlink':
          await this.handleConfigRemoval(configType, filePath);
          break;
      }
      
    } catch (error) {
      logger.error('Error handling configuration file change', {
        eventType,
        filePath,
        error: error.message
      });
      
      this.emit('error', {
        type: 'config-change-error',
        eventType,
        filePath,
        error
      });
    }
  }

  /**
   * Handle configuration file updates
   */
  async handleConfigUpdate(configType, filePath) {
    try {
      const config = await this.readConfigFile(filePath);
      
      if (!config) {
        logger.warn('Empty or invalid configuration file', { filePath });
        return;
      }

      // Substitute environment variables
      const configWithEnvVars = this.substituteEnvironmentVariables(config);

      // Validate configuration
      const validatedConfig = await this.validateConfig(configType, configWithEnvVars);
      
      // Apply changes
      await this.applyConfigChange(configType, validatedConfig, filePath);
      
    } catch (error) {
      logger.error('Failed to update configuration', {
        configType,
        filePath,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Handle configuration file removal
   */
  async handleConfigRemoval(configType, filePath) {
    try {
      const previousConfig = this.loadedConfigs.get(configType);
      
      if (previousConfig) {
        this.loadedConfigs.delete(configType);
        
        logger.info('Configuration removed', { configType, filePath });
        
        this.emit('config-removed', {
          configType,
          filePath,
          previousConfig
        });
      }
      
    } catch (error) {
      logger.error('Error handling configuration removal', {
        configType,
        filePath,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Apply validated configuration changes
   */
  async applyConfigChange(configType, newConfig, filePath) {
    try {
      const previousConfig = this.loadedConfigs.get(configType);
      
      // Store new configuration
      this.loadedConfigs.set(configType, newConfig);
      
      logger.info('Configuration updated successfully', {
        configType,
        filePath,
        hasChanges: JSON.stringify(previousConfig) !== JSON.stringify(newConfig)
      });

      // Emit configuration change event
      this.emit('config-changed', {
        configType,
        filePath,
        newConfig,
        previousConfig
      });
      
    } catch (error) {
      logger.error('Failed to apply configuration change', {
        configType,
        filePath,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Validate configuration against registered schema
   */
  async validateConfig(configType, config) {
    const validator = this.validators.get(configType);
    
    if (!validator) {
      logger.warn('No validator found for config type', { configType });
      return config;
    }

    try {
      const { error, value } = validator.validate(config, { 
        abortEarly: false,
        allowUnknown: true 
      });
      
      if (error) {
        const validationError = new Error(`Configuration validation failed: ${error.message}`);
        validationError.details = error.details;
        throw validationError;
      }
      
      return value;
      
    } catch (error) {
      logger.error('Configuration validation failed', {
        configType,
        error: error.message,
        details: error.details
      });
      throw error;
    }
  }

  /**
   * Read and parse configuration file
   */
  async readConfigFile(filePath) {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      
      if (filePath.endsWith('.json')) {
        return JSON.parse(content);
      } else if (filePath.endsWith('.js')) {
        // Clear require cache for hot reloading
        delete require.cache[require.resolve(filePath)];
        return require(filePath);
      }
      
      return null;
      
    } catch (error) {
      if (error.code === 'ENOENT') {
        logger.debug('Configuration file not found', { filePath });
        return null;
      }
      
      logger.error('Error reading configuration file', {
        filePath,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Determine configuration type from file path
   */
  getConfigTypeFromPath(filePath) {
    const basename = path.basename(filePath, path.extname(filePath));
    const validTypes = ['sources', 'ingestion', 'queue', 'enrichment'];
    
    return validTypes.find(type => basename.includes(type)) || null;
  }

  /**
   * Ensure configuration directory exists
   */
  async ensureConfigDirectory() {
    try {
      await fs.access(this.configDir);
    } catch (error) {
      if (error.code === 'ENOENT') {
        await fs.mkdir(this.configDir, { recursive: true });
        logger.info('Created configuration directory', { configDir: this.configDir });
      } else {
        throw error;
      }
    }
  }

  /**
   * Handle watcher errors
   */
  handleWatcherError(error) {
    logger.error('ConfigManager watcher error', { error: error.message });
    this.emit('error', {
      type: 'watcher-error',
      error
    });
  }

  /**
   * Get source configuration schema
   */
  getSourceConfigSchema() {
    return Joi.object({
      sources: Joi.array().items(
        Joi.object({
          id: Joi.string().required(),
          type: Joi.string().valid('static', 'semi-static', 'dynamic-consistent', 'dynamic-unstructured').required(),
          name: Joi.string().required(),
          enabled: Joi.boolean().default(true),
          config: Joi.object().required(),
          schedule: Joi.string().when('type', {
            is: Joi.string().valid('semi-static', 'dynamic-consistent', 'dynamic-unstructured'),
            then: Joi.required(),
            otherwise: Joi.optional()
          })
        })
      ).required()
    });
  }

  /**
   * Get ingestion configuration schema
   */
  getIngestionConfigSchema() {
    return Joi.object({
      batchSize: Joi.number().integer().min(1).max(1000).default(100),
      maxRetries: Joi.number().integer().min(0).max(10).default(3),
      retryDelay: Joi.number().integer().min(1000).default(5000),
      timeout: Joi.number().integer().min(5000).default(30000),
      concurrency: Joi.number().integer().min(1).max(10).default(3),
      enableValidation: Joi.boolean().default(true),
      outputFormat: Joi.string().valid('json', 'jsonl').default('json')
    });
  }

  /**
   * Get queue configuration schema
   */
  getQueueConfigSchema() {
    return Joi.object({
      redis: Joi.object({
        host: Joi.string().default('localhost'),
        port: Joi.number().integer().min(1).max(65535).default(6379),
        password: Joi.string().optional(),
        db: Joi.number().integer().min(0).default(0)
      }).default(),
      queues: Joi.object({
        defaultJobOptions: Joi.object({
          removeOnComplete: Joi.number().integer().min(0).default(100),
          removeOnFail: Joi.number().integer().min(0).default(50),
          attempts: Joi.number().integer().min(1).default(3),
          backoff: Joi.object({
            type: Joi.string().valid('fixed', 'exponential').default('exponential'),
            delay: Joi.number().integer().min(1000).default(2000)
          }).default()
        }).default(),
        concurrency: Joi.number().integer().min(1).max(50).default(5)
      }).default()
    });
  }

  /**
   * Get configuration statistics
   */
  getStats() {
    return {
      isWatching: this.isWatching,
      configDir: this.configDir,
      configCount: this.loadedConfigs.size,
      validatorCount: this.validators.size,
      configTypes: Array.from(this.loadedConfigs.keys())
    };
  }

  /**
   * Substitute environment variables in configuration
   */
  substituteEnvironmentVariables(config) {
    const envRegex = /\${([^}]+)}/g;
    return JSON.parse(JSON.stringify(config).replace(envRegex, (match, varName) => process.env[varName] || match));
  }
}

module.exports = ConfigManager;