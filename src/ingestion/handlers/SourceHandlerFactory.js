const { SOURCE_TYPES } = require('../types');
const StaticSourceHandler = require('./StaticSourceHandler');
const SemiStaticSourceHandler = require('./SemiStaticSourceHandler');
const DynamicConsistentSourceHandler = require('./DynamicConsistentSourceHandler');
const DynamicUnstructuredSourceHandler = require('./DynamicUnstructuredSourceHandler');

/**
 * Factory for creating source handlers
 */
class SourceHandlerFactory {
  constructor() {
    this.handlers = new Map();
    this.registerDefaultHandlers();
  }

  /**
   * Register default handlers
   */
  registerDefaultHandlers() {
    this.registerHandler(SOURCE_TYPES.STATIC, StaticSourceHandler);
    this.registerHandler(SOURCE_TYPES.SEMI_STATIC, SemiStaticSourceHandler);
    this.registerHandler(SOURCE_TYPES.DYNAMIC_CONSISTENT, DynamicConsistentSourceHandler);
    this.registerHandler(SOURCE_TYPES.DYNAMIC_UNSTRUCTURED, DynamicUnstructuredSourceHandler);
  }

  /**
   * Register a handler class for a source type
   */
  registerHandler(sourceType, handlerClass) {
    if (!sourceType || !handlerClass) {
      throw new Error('Source type and handler class are required');
    }
    this.handlers.set(sourceType, handlerClass);
  }

  /**
   * Unregister a handler for a source type
   */
  unregisterHandler(sourceType) {
    return this.handlers.delete(sourceType);
  }

  /**
   * Create a handler instance for the given configuration
   */
  createHandler(config) {
    if (!config || !config.type) {
      throw new Error('Configuration with type is required');
    }

    const HandlerClass = this.handlers.get(config.type);
    if (!HandlerClass) {
      throw new Error(`No handler registered for source type: ${config.type}`);
    }

    return new HandlerClass(config);
  }

  /**
   * Check if a handler is registered for the given source type
   */
  hasHandler(sourceType) {
    return this.handlers.has(sourceType);
  }

  /**
   * Get all registered source types
   */
  getRegisteredTypes() {
    return Array.from(this.handlers.keys());
  }

  /**
   * Get handler class for source type
   */
  getHandlerClass(sourceType) {
    return this.handlers.get(sourceType) || null;
  }

  /**
   * Validate configuration for a source type
   */
  async validateConfig(config) {
    if (!config || !config.type) {
      throw new Error('Configuration with type is required');
    }

    const HandlerClass = this.handlers.get(config.type);
    if (!HandlerClass) {
      throw new Error(`No handler registered for source type: ${config.type}`);
    }

    // Create temporary instance to validate config
    const tempHandler = new HandlerClass(config);
    if (typeof tempHandler.validateConfig === 'function') {
      return await tempHandler.validateConfig(config);
    }

    return true;
  }

  /**
   * Validate handler configuration (alias for validateConfig)
   */
  async validateHandlerConfig(config) {
    return await this.validateConfig(config);
  }

  /**
   * Check if a handler type is supported
   */
  isTypeSupported(sourceType) {
    return this.handlers.has(sourceType);
  }

  /**
   * Validate multiple configurations
   */
  async validateHandlerConfigs(configs) {
    if (!Array.isArray(configs)) {
      throw new Error('Configurations must be an array');
    }

    const results = [];
    for (const config of configs) {
      try {
        await this.validateConfig(config);
        results.push({ valid: true, config });
      } catch (error) {
        results.push({ valid: false, config, error: error.message });
      }
    }

    return results;
  }

  /**
   * Get default configuration for a handler type
   */
  getDefaultConfig(sourceType) {
    const HandlerClass = this.handlers.get(sourceType);
    if (!HandlerClass) {
      return null;
    }

    // Return basic default config
    return {
      type: sourceType,
      enabled: true,
      config: {}
    };
  }

  /**
   * Merge user config with defaults
   */
  mergeWithDefaults(userConfig) {
    if (!userConfig || !userConfig.type) {
      throw new Error('User configuration with type is required');
    }

    const defaultConfig = this.getDefaultConfig(userConfig.type);
    if (!defaultConfig) {
      throw new Error(`No default configuration available for type: ${userConfig.type}`);
    }

    return {
      ...defaultConfig,
      ...userConfig,
      config: {
        ...defaultConfig.config,
        ...userConfig.config
      }
    };
  }

  /**
   * Initialize a handler
   */
  async initializeHandler(handler) {
    if (handler && typeof handler.initialize === 'function') {
      await handler.initialize();
    }
  }

  /**
   * Cleanup a handler
   */
  async cleanupHandler(handler) {
    if (handler && typeof handler.cleanup === 'function') {
      await handler.cleanup();
    }
  }

  /**
   * Create multiple handlers from configurations
   */
  createHandlers(configs) {
    if (!Array.isArray(configs)) {
      throw new Error('Configurations must be an array');
    }

    return configs.map(config => this.createHandler(config));
  }

  /**
   * Get factory statistics
   */
  getStats() {
    return {
      registeredTypes: this.handlers.size,
      types: Array.from(this.handlers.keys())
    };
  }

  /**
   * Clear all registered handlers
   */
  clear() {
    this.handlers.clear();
  }

  /**
   * Reset to default handlers
   */
  reset() {
    this.clear();
    this.registerDefaultHandlers();
  }
}

module.exports = SourceHandlerFactory;
