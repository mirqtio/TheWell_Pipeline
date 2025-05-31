const EventEmitter = require('events');
const SourceHandlerFactory = require('./handlers/SourceHandlerFactory');
const SourceHandlerRegistry = require('./handlers/SourceHandlerRegistry');
const { SOURCE_TYPES } = require('./types');

/**
 * Main ingestion engine that orchestrates document discovery and processing
 * across multiple source types and handlers
 */
class IngestionEngine extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      maxConcurrentSources: 5,
      maxConcurrentDocuments: 10,
      retryAttempts: 3,
      retryDelay: 1000,
      ...options
    };

    this.factory = new SourceHandlerFactory();
    this.registry = new SourceHandlerRegistry(this.factory);
    this.sources = new Map();
    this.isInitialized = false;
    this.isShuttingDown = false;

    // Register event handlers
    this.registry.on('handlerRegistered', (handlerId) => {
      this.emit('sourceAdded', handlerId);
    });

    this.registry.on('handlerUnregistered', (handlerId) => {
      this.emit('sourceRemoved', handlerId);
    });

    this.registry.on('error', (error) => {
      this.emit('error', error);
    });
  }

  /**
   * Initialize the ingestion engine
   */
  async initialize() {
    if (this.isInitialized) {
      return;
    }

    try {
      // Register built-in source handlers
      await this._registerBuiltInHandlers();
      
      this.isInitialized = true;
      this.emit('initialized');
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Shutdown the ingestion engine
   */
  async shutdown() {
    if (this.isShuttingDown) {
      return;
    }

    this.isShuttingDown = true;

    try {
      // Cleanup all registered handlers
      await this.registry.cleanup();
      
      // Clear sources
      this.sources.clear();
      
      this.isInitialized = false;
      this.emit('shutdown');
    } catch (error) {
      this.emit('error', error);
      throw error;
    } finally {
      this.isShuttingDown = false;
    }
  }

  /**
   * Add a new source configuration
   */
  async addSource(sourceConfig) {
    this._validateSourceConfig(sourceConfig);

    if (this.sources.has(sourceConfig.id)) {
      throw new Error(`Source with id '${sourceConfig.id}' already exists`);
    }

    try {
      // Register handler with registry
      const handler = await this.registry.registerHandler(sourceConfig);
      
      // Store source configuration
      this.sources.set(sourceConfig.id, {
        config: sourceConfig,
        handler: handler,
        addedAt: new Date()
      });

      this.emit('sourceAdded', sourceConfig.id);
      return handler;
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Remove a source
   */
  async removeSource(sourceId) {
    if (!this.sources.has(sourceId)) {
      throw new Error(`Source with id '${sourceId}' not found`);
    }

    try {
      await this.registry.unregisterHandler(sourceId);
      this.sources.delete(sourceId);
      
      this.emit('sourceRemoved', sourceId);
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Update source configuration
   */
  async updateSource(sourceId, newConfig) {
    this._validateSourceConfig(newConfig);

    if (!this.sources.has(sourceId)) {
      throw new Error(`Source with id '${sourceId}' not found`);
    }

    try {
      // Remove old source
      await this.removeSource(sourceId);
      
      // Add updated source
      await this.addSource(newConfig);
      
      this.emit('sourceUpdated', sourceId);
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Get source by ID
   */
  getSource(sourceId) {
    return this.sources.get(sourceId);
  }

  /**
   * Get all sources
   */
  getSources() {
    return Array.from(this.sources.values()).map(source => source.config);
  }

  /**
   * Discover documents from a specific source
   */
  async discoverDocuments(sourceId) {
    const source = this.sources.get(sourceId);
    if (!source) {
      throw new Error(`Source with id '${sourceId}' not found`);
    }

    try {
      this.emit('discoveryStarted', sourceId);
      const documents = await source.handler.discover();
      this.emit('discoveryCompleted', sourceId, documents.length);
      return documents;
    } catch (error) {
      this.emit('discoveryFailed', sourceId, error);
      throw error;
    }
  }

  /**
   * Process a single document from a source
   */
  async processDocument(sourceId, document) {
    const source = this.sources.get(sourceId);
    if (!source) {
      throw new Error(`Source with id '${sourceId}' not found`);
    }

    try {
      this.emit('documentProcessingStarted', sourceId, document.id);
      
      // Extract content
      const extractedContent = await source.handler.extract(document);
      
      // Transform content
      const transformedDocument = await source.handler.transform(extractedContent);
      
      // Add source metadata
      transformedDocument.metadata = {
        ...transformedDocument.metadata,
        sourceId: sourceId,
        processedAt: new Date()
      };

      this.emit('documentProcessingCompleted', sourceId, document.id);
      return transformedDocument;
    } catch (error) {
      this.emit('documentProcessingFailed', sourceId, document.id, error);
      throw error;
    }
  }

  /**
   * Process all documents from a specific source
   */
  async processAllDocuments(sourceId) {
    const documents = await this.discoverDocuments(sourceId);
    
    const results = {
      sourceId: sourceId,
      processed: [],
      failed: [],
      startTime: new Date()
    };

    this.emit('batchProcessingStarted', sourceId, documents.length);

    for (const document of documents) {
      try {
        const processedDoc = await this.processDocument(sourceId, document);
        results.processed.push(processedDoc);
      } catch (error) {
        results.failed.push({
          document: document,
          error: error.message
        });
      }
    }

    results.endTime = new Date();
    results.duration = results.endTime - results.startTime;

    this.emit('batchProcessingCompleted', sourceId, results);
    return results;
  }

  /**
   * Process all documents from all sources
   */
  async processAllSources() {
    const sourceIds = Array.from(this.sources.keys());
    const allResults = [];

    this.emit('fullProcessingStarted', sourceIds.length);

    for (const sourceId of sourceIds) {
      try {
        const results = await this.processAllDocuments(sourceId);
        allResults.push(results);
      } catch (error) {
        allResults.push({
          sourceId: sourceId,
          processed: [],
          failed: [{ error: error.message }],
          startTime: new Date(),
          endTime: new Date()
        });
      }
    }

    this.emit('fullProcessingCompleted', allResults);
    return allResults;
  }

  /**
   * Get engine statistics
   */
  getStatistics() {
    const stats = {
      totalSources: this.sources.size,
      sourceTypes: {},
      isInitialized: this.isInitialized,
      registryStats: this.registry.getStatistics()
    };

    // Count sources by type
    for (const source of this.sources.values()) {
      const type = source.config.type;
      stats.sourceTypes[type] = (stats.sourceTypes[type] || 0) + 1;
    }

    return stats;
  }

  /**
   * Validate source configuration
   */
  _validateSourceConfig(config) {
    if (!config) {
      throw new Error('Source configuration is required');
    }

    if (!config.id) {
      throw new Error('Source configuration must have an id');
    }

    if (!config.type) {
      throw new Error('Source configuration must have a type');
    }

    if (!Object.values(SOURCE_TYPES).includes(config.type)) {
      throw new Error(`Unsupported source type: ${config.type}`);
    }

    if (!config.config) {
      throw new Error('Source configuration must have a config object');
    }

    // Type-specific validation
    if (config.type === SOURCE_TYPES.STATIC) {
      if (!config.config.basePath) {
        throw new Error('Static source requires basePath in config');
      }
      if (typeof config.config.basePath !== 'string') {
        throw new Error('Static source basePath must be a string');
      }
    }
  }

  /**
   * Register built-in source handlers
   */
  async _registerBuiltInHandlers() {
    const StaticSourceHandler = require('./handlers/StaticSourceHandler');
    const SemiStaticSourceHandler = require('./handlers/SemiStaticSourceHandler');
    const DynamicConsistentSourceHandler = require('./handlers/DynamicConsistentSourceHandler');
    const DynamicUnstructuredSourceHandler = require('./handlers/DynamicUnstructuredSourceHandler');

    // Register handlers with factory
    this.factory.registerHandler(SOURCE_TYPES.STATIC, StaticSourceHandler);
    this.factory.registerHandler(SOURCE_TYPES.SEMI_STATIC, SemiStaticSourceHandler);
    this.factory.registerHandler(SOURCE_TYPES.DYNAMIC_CONSISTENT, DynamicConsistentSourceHandler);
    this.factory.registerHandler(SOURCE_TYPES.DYNAMIC_UNSTRUCTURED, DynamicUnstructuredSourceHandler);
  }
}

module.exports = IngestionEngine;
