const { EventEmitter } = require('events');
const SourceHandlerFactory = require('./SourceHandlerFactory');

/**
 * Registry for managing source handlers
 */
class SourceHandlerRegistry extends EventEmitter {
  constructor(factory = null, logger = null) {
    super();
    this.factory = factory || new SourceHandlerFactory();
    this.logger = logger || console;
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
      throw new Error(`Handler with ID ${config.id} is already registered`);
    }

    // Validate configuration
    await this.factory.validateConfig(config);

    // Create handler instance
    const handler = this.factory.createHandler(config);
    
    // Initialize handler
    await handler.initialize();

    // Store handler
    this.handlers.set(config.id, handler);
    
    // Add to enabled handlers if enabled
    if (config.enabled !== false) {
      this.enabledHandlers.add(config.id);
      this.stats.activeHandlers++;
    }
    
    this.stats.totalHandlers++;

    this.emit('handlerRegistered', { id: config.id, type: config.type });
    
    return handler;
  }

  /**
   * Unregister a handler
   */
  async unregisterHandler(handlerId) {
    const handler = this.handlers.get(handlerId);
    if (!handler) {
      throw new Error(`Handler with ID ${handlerId} not found`);
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
    return this.handlers.get(handlerId) || null;
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

    const handler = this.handlers.get(handlerId);
    const wasEnabled = this.enabledHandlers.has(handlerId);
    
    this.enabledHandlers.add(handlerId);
    handler.config.enabled = true;
    
    if (!wasEnabled) {
      this.stats.activeHandlers++;
      this.logger.info('Handler enabled', { handlerId });
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

    const handler = this.handlers.get(handlerId);
    const wasEnabled = this.enabledHandlers.has(handlerId);
    
    this.enabledHandlers.delete(handlerId);
    handler.config.enabled = false;
    
    if (wasEnabled) {
      this.stats.activeHandlers--;
      this.logger.info('Handler disabled', { handlerId });
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
    const allDocuments = [];

    for (const handler of enabledHandlers) {
      try {
        const documents = await handler.discover();
        if (Array.isArray(documents)) {
          allDocuments.push(...documents);
          this.stats.discoveredDocuments += documents.length;
        }
      } catch (error) {
        // Log error but continue with other handlers
        this.logger.error(`Handler discovery failed for ${handler.config?.id}:`, error.message);
      }
    }

    return allDocuments;
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
        this.logger.error(`Error cleaning up handler: ${error.message}`);
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
   * Cleanup all handlers (alias for cleanup)
   */
  async cleanupAll() {
    return this.cleanup();
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
    const handlersByType = {};
    for (const handler of this.handlers.values()) {
      const type = handler.config?.type || 'unknown';
      handlersByType[type] = (handlersByType[type] || 0) + 1;
    }

    return {
      totalHandlers: this.handlers.size,
      enabledHandlers: this.enabledHandlers.size,
      disabledHandlers: this.handlers.size - this.enabledHandlers.size,
      handlersByType,
      ...this.stats
    };
  }

  /**
   * Get handler count
   */
  getHandlerCount() {
    return this.handlers.size;
  }

  /**
   * Get enabled handler count
   */
  getEnabledHandlerCount() {
    return this.enabledHandlers.size;
  }

  /**
   * Get all handler IDs
   */
  getAllHandlerIds() {
    return Array.from(this.handlers.keys());
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
   * Get handlers by visibility
   */
  getHandlersByVisibility(visibility) {
    return Array.from(this.handlers.values())
      .filter(handler => handler.config.visibility === visibility);
  }

  /**
   * Check if any handlers are registered
   */
  hasHandlers() {
    return this.handlers.size > 0;
  }
}

module.exports = SourceHandlerRegistry;
