const { SOURCE_TYPES } = require('../types');
const StaticSourceHandler = require('./StaticSourceHandler');
const SemiStaticSourceHandler = require('./SemiStaticSourceHandler');
const DynamicConsistentSourceHandler = require('./DynamicConsistentSourceHandler');
const DynamicUnstructuredSourceHandler = require('./DynamicUnstructuredSourceHandler');

/**
 * Source Handler Factory
 * Creates and manages source handlers for different source types
 */
class SourceHandlerFactory {
  constructor(logger = null) {
    this.logger = logger;
    this.handlers = new Map();
    this._registerHandlers();
  }

  /**
   * Register all available source handlers
   */
  _registerHandlers() {
    this.handlers.set(SOURCE_TYPES.STATIC, StaticSourceHandler);
    this.handlers.set(SOURCE_TYPES.SEMI_STATIC, SemiStaticSourceHandler);
    this.handlers.set(SOURCE_TYPES.DYNAMIC_CONSISTENT, DynamicConsistentSourceHandler);
    this.handlers.set(SOURCE_TYPES.DYNAMIC_UNSTRUCTURED, DynamicUnstructuredSourceHandler);
  }

  /**
   * Create a source handler instance
   * @param {string} sourceType - Type of source handler to create
   * @param {Object} config - Source configuration
   * @returns {BaseSourceHandler} - Initialized source handler
   */
  createHandler(sourceType, config) {
    const HandlerClass = this.handlers.get(sourceType);
    
    if (!HandlerClass) {
      throw new Error(`Unknown source type: ${sourceType}`);
    }

    const handler = new HandlerClass(config);
    
    // Inject logger if available
    if (this.logger) {
      handler.logger = this.logger;
    }

    return handler;
  }

  /**
   * Get list of supported source types
   * @returns {Array<string>} - Array of supported source types
   */
  getSupportedTypes() {
    return Array.from(this.handlers.keys());
  }

  /**
   * Check if a source type is supported
   * @param {string} sourceType - Source type to check
   * @returns {boolean} - Whether the source type is supported
   */
  isSupported(sourceType) {
    return this.handlers.has(sourceType);
  }

  /**
   * Validate source configuration for a given type
   * @param {string} sourceType - Source type
   * @param {Object} config - Source configuration to validate
   * @returns {Promise<boolean>} - Whether the configuration is valid
   */
  async validateSourceConfig(sourceType, config) {
    const handler = this.createHandler(sourceType, config);
    return await handler.validateConfig(config);
  }
}

/**
 * Source Handler Registry
 * Manages active source handler instances
 */
class SourceHandlerRegistry {
  constructor(logger = null) {
    this.logger = logger;
    this.factory = new SourceHandlerFactory(logger);
    this.activeHandlers = new Map();
  }

  /**
   * Register a source and create its handler
   * @param {Object} sourceConfig - Source configuration
   * @returns {Promise<BaseSourceHandler>} - Initialized source handler
   */
  async registerSource(sourceConfig) {
    try {
      this.logger?.info('Registering source', { 
        sourceId: sourceConfig.id,
        sourceType: sourceConfig.type 
      });

      // Validate configuration
      await this.factory.validateSourceConfig(sourceConfig.type, sourceConfig);

      // Create and initialize handler
      const handler = this.factory.createHandler(sourceConfig.type, sourceConfig);
      await handler.initialize();

      // Store in registry
      this.activeHandlers.set(sourceConfig.id, {
        handler,
        config: sourceConfig,
        registeredAt: new Date(),
        lastUsed: new Date()
      });

      this.logger?.info('Source registered successfully', { 
        sourceId: sourceConfig.id 
      });

      return handler;
    } catch (error) {
      this.logger?.error('Failed to register source', { 
        sourceId: sourceConfig.id,
        error: error.message 
      });
      throw error;
    }
  }

  /**
   * Get a registered source handler
   * @param {string} sourceId - Source identifier
   * @returns {BaseSourceHandler|null} - Source handler or null if not found
   */
  getHandler(sourceId) {
    const entry = this.activeHandlers.get(sourceId);
    if (entry) {
      entry.lastUsed = new Date();
      return entry.handler;
    }
    return null;
  }

  /**
   * Unregister a source and cleanup its handler
   * @param {string} sourceId - Source identifier
   * @returns {Promise<boolean>} - Whether the source was successfully unregistered
   */
  async unregisterSource(sourceId) {
    const entry = this.activeHandlers.get(sourceId);
    if (!entry) {
      return false;
    }

    try {
      this.logger?.info('Unregistering source', { sourceId });

      // Cleanup handler resources
      await entry.handler.cleanup();

      // Remove from registry
      this.activeHandlers.delete(sourceId);

      this.logger?.info('Source unregistered successfully', { sourceId });
      return true;
    } catch (error) {
      this.logger?.error('Failed to unregister source', { 
        sourceId,
        error: error.message 
      });
      return false;
    }
  }

  /**
   * Get all registered source IDs
   * @returns {Array<string>} - Array of registered source IDs
   */
  getRegisteredSources() {
    return Array.from(this.activeHandlers.keys());
  }

  /**
   * Get source information
   * @param {string} sourceId - Source identifier
   * @returns {Object|null} - Source information or null if not found
   */
  getSourceInfo(sourceId) {
    const entry = this.activeHandlers.get(sourceId);
    if (!entry) {
      return null;
    }

    return {
      id: sourceId,
      type: entry.config.type,
      name: entry.config.name,
      enabled: entry.config.enabled,
      registeredAt: entry.registeredAt,
      lastUsed: entry.lastUsed
    };
  }

  /**
   * Get all source information
   * @returns {Array<Object>} - Array of source information objects
   */
  getAllSourceInfo() {
    return Array.from(this.activeHandlers.keys()).map(sourceId => 
      this.getSourceInfo(sourceId)
    );
  }

  /**
   * Update source configuration
   * @param {string} sourceId - Source identifier
   * @param {Object} newConfig - New source configuration
   * @returns {Promise<boolean>} - Whether the update was successful
   */
  async updateSourceConfig(sourceId, newConfig) {
    try {
      this.logger?.info('Updating source configuration', { sourceId });

      // Unregister existing source
      await this.unregisterSource(sourceId);

      // Register with new configuration
      await this.registerSource(newConfig);

      this.logger?.info('Source configuration updated successfully', { sourceId });
      return true;
    } catch (error) {
      this.logger?.error('Failed to update source configuration', { 
        sourceId,
        error: error.message 
      });
      return false;
    }
  }

  /**
   * Cleanup all registered sources
   * @returns {Promise<void>}
   */
  async cleanup() {
    this.logger?.info('Cleaning up all registered sources');

    const cleanupPromises = Array.from(this.activeHandlers.keys()).map(sourceId =>
      this.unregisterSource(sourceId)
    );

    await Promise.allSettled(cleanupPromises);
    this.activeHandlers.clear();

    this.logger?.info('Source handler registry cleanup completed');
  }

  /**
   * Get registry statistics
   * @returns {Object} - Registry statistics
   */
  getStats() {
    const sources = Array.from(this.activeHandlers.values());
    const typeCount = {};

    sources.forEach(entry => {
      const type = entry.config.type;
      typeCount[type] = (typeCount[type] || 0) + 1;
    });

    return {
      totalSources: sources.length,
      sourcesByType: typeCount,
      oldestRegistration: sources.length > 0 ? 
        Math.min(...sources.map(s => s.registeredAt.getTime())) : null,
      newestRegistration: sources.length > 0 ? 
        Math.max(...sources.map(s => s.registeredAt.getTime())) : null
    };
  }
}

module.exports = {
  SourceHandlerFactory,
  SourceHandlerRegistry,
  SOURCE_TYPES
};
