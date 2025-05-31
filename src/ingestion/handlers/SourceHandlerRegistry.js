const SourceHandlerFactory = require('./SourceHandlerFactory');
const EventEmitter = require('events');

/**
 * Registry for managing source handlers
 */
class SourceHandlerRegistry extends EventEmitter {
  constructor(factory = null) {
    super();
    this.factory = factory || new SourceHandlerFactory();
    this.handlers = new Map();
    this.enabledHandlers = new Set();
    this.stats = {
      totalHandlers: 0,
      activeHandlers: 0,
      discoveredDocuments: 0,
      processedDocuments: 0
    };
  }

  /**
   * Register a handler with the registry
   */
  async registerHandler(config) {
    if (!config || !config.id) {
      throw new Error('Handler configuration with id is required');
    }

    if (this.handlers.has(config.id)) {
      throw new Error(`Handler with id ${config.id} already registered`);
    }

    // Validate configuration
    await this.factory.validateConfig(config);

    // Create handler instance
    const handler = this.factory.createHandler(config);
    
    // Initialize handler
    await handler.initialize();

    // Store handler
    this.handlers.set(config.id, handler);
    this.enabledHandlers.add(config.id);
    this.stats.totalHandlers++;
    this.stats.activeHandlers++;

    this.emit('handlerRegistered', { id: config.id, type: config.type });
    
    return handler;
  }

  /**
   * Unregister a handler
   */
  async unregisterHandler(handlerId) {
    const handler = this.handlers.get(handlerId);
    if (!handler) {
      return false;
    }

    // Cleanup handler
    if (typeof handler.cleanup === 'function') {
      await handler.cleanup();
    }

    // Remove from registry
    this.handlers.delete(handlerId);
    this.enabledHandlers.delete(handlerId);
    this.stats.totalHandlers--;
    if (this.stats.activeHandlers > 0) {
      this.stats.activeHandlers--;
    }

    this.emit('handlerUnregistered', { id: handlerId });
    
    return true;
  }

  /**
   * Get a handler by id
   */
  getHandler(handlerId) {
    return this.handlers.get(handlerId);
  }

  /**
   * Get all registered handlers
   */
  getAllHandlers() {
    return Array.from(this.handlers.values());
  }

  /**
   * Get enabled handlers
   */
  getEnabledHandlers() {
    return Array.from(this.enabledHandlers)
      .map(id => this.handlers.get(id))
      .filter(handler => handler);
  }

  /**
   * Enable a handler
   */
  enableHandler(handlerId) {
    if (!this.handlers.has(handlerId)) {
      throw new Error(`Handler ${handlerId} not found`);
    }

    const wasEnabled = this.enabledHandlers.has(handlerId);
    this.enabledHandlers.add(handlerId);
    
    if (!wasEnabled) {
      this.stats.activeHandlers++;
      this.emit('handlerEnabled', { id: handlerId });
    }

    return true;
  }

  /**
   * Disable a handler
   */
  disableHandler(handlerId) {
    if (!this.handlers.has(handlerId)) {
      throw new Error(`Handler ${handlerId} not found`);
    }

    const wasEnabled = this.enabledHandlers.has(handlerId);
    this.enabledHandlers.delete(handlerId);
    
    if (wasEnabled) {
      this.stats.activeHandlers--;
      this.emit('handlerDisabled', { id: handlerId });
    }

    return true;
  }

  /**
   * Check if handler is enabled
   */
  isHandlerEnabled(handlerId) {
    return this.enabledHandlers.has(handlerId);
  }

  /**
   * Register multiple handlers
   */
  async registerHandlers(configs) {
    if (!Array.isArray(configs)) {
      throw new Error('Configurations must be an array');
    }

    const results = [];
    for (const config of configs) {
      try {
        const handler = await this.registerHandler(config);
        results.push({ success: true, id: config.id, handler });
      } catch (error) {
        results.push({ success: false, id: config.id, error: error.message });
      }
    }

    return results;
  }

  /**
   * Discover documents from all enabled handlers
   */
  async discoverAll() {
    const enabledHandlers = this.getEnabledHandlers();
    const results = [];

    for (const handler of enabledHandlers) {
      try {
        const documents = await handler.discover();
        results.push({
          handlerId: handler.config.id,
          success: true,
          documents: documents || []
        });
        this.stats.discoveredDocuments += (documents || []).length;
      } catch (error) {
        results.push({
          handlerId: handler.config.id,
          success: false,
          error: error.message
        });
      }
    }

    return results;
  }

  /**
   * Cleanup all handlers
   */
  async cleanup() {
    const handlers = Array.from(this.handlers.values());
    
    for (const handler of handlers) {
      try {
        if (typeof handler.cleanup === 'function') {
          await handler.cleanup();
        }
      } catch (error) {
        // Log error but continue cleanup
        console.error(`Error cleaning up handler: ${error.message}`);
      }
    }

    this.handlers.clear();
    this.enabledHandlers.clear();
    this.stats = {
      totalHandlers: 0,
      activeHandlers: 0,
      discoveredDocuments: 0,
      processedDocuments: 0
    };

    this.emit('registryCleanup');
  }

  /**
   * Get registry statistics
   */
  getStats() {
    return { ...this.stats };
  }

  /**
   * Get detailed statistics (alias for compatibility)
   */
  getStatistics() {
    return this.getStats();
  }

  /**
   * Update handler configuration
   */
  async updateHandlerConfig(handlerId, newConfig) {
    const handler = this.handlers.get(handlerId);
    if (!handler) {
      throw new Error(`Handler ${handlerId} not found`);
    }

    // Validate new configuration
    await this.factory.validateConfig(newConfig);

    // Update handler configuration
    handler.config = { ...handler.config, ...newConfig };

    this.emit('handlerConfigUpdated', { id: handlerId, config: newConfig });
    
    return handler;
  }

  /**
   * Get handler by type
   */
  getHandlersByType(type) {
    return Array.from(this.handlers.values())
      .filter(handler => handler.config.type === type);
  }

  /**
   * Check if any handlers are registered
   */
  hasHandlers() {
    return this.handlers.size > 0;
  }

  /**
   * Get handler count
   */
  getHandlerCount() {
    return this.handlers.size;
  }
}

module.exports = SourceHandlerRegistry;
