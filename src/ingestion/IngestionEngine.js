const EventEmitter = require('events');
const SourceHandlerFactory = require('./handlers/SourceHandlerFactory');
const SourceHandlerRegistry = require('./handlers/SourceHandlerRegistry');
const VisibilityManager = require('./VisibilityManager');
const VisibilityDatabase = require('./VisibilityDatabase');
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
      enableVisibilityManagement: true,
      ...options
    };

    this.factory = new SourceHandlerFactory();
    this.registry = new SourceHandlerRegistry(this.factory);
    this.sources = new Map();
    this.isInitialized = false;
    this.isShuttingDown = false;

    // Initialize visibility management if enabled
    if (this.options.enableVisibilityManagement) {
      this.visibilityDatabase = new VisibilityDatabase(this.options.database);
      this.visibilityManager = new VisibilityManager(this.options.visibility);
      
      // Connect visibility manager events
      this.visibilityManager.on('visibilityChanged', (data) => {
        this.emit('documentVisibilityChanged', data);
      });
      
      this.visibilityManager.on('approvalRequested', (data) => {
        this.emit('visibilityApprovalRequested', data);
      });
      
      this.visibilityManager.on('error', (error) => {
        this.emit('error', { type: 'visibility_error', error });
      });
    }

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
      // Initialize visibility database if enabled
      if (this.options.enableVisibilityManagement && this.visibilityDatabase) {
        await this.visibilityDatabase.initialize();
      }
      
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
   * Update sources configuration dynamically
   */
  async updateSources(newSources) {
    logger.info('Updating sources configuration', { sourceCount: newSources.length });
    
    try {
      // Remove sources that are no longer in the configuration
      const newSourceIds = new Set(newSources.map(s => s.id));
      const currentSourceIds = Array.from(this.sources.keys());
      
      for (const sourceId of currentSourceIds) {
        if (!newSourceIds.has(sourceId)) {
          await this.removeSource(sourceId);
          logger.info('Removed source from configuration', { sourceId });
        }
      }
      
      // Add or update sources
      for (const sourceConfig of newSources) {
        if (this.sources.has(sourceConfig.id)) {
          // Update existing source
          await this.updateSource(sourceConfig.id, sourceConfig);
          logger.info('Updated existing source', { sourceId: sourceConfig.id });
        } else {
          // Add new source
          await this.addSource(sourceConfig);
          logger.info('Added new source', { sourceId: sourceConfig.id });
        }
      }
      
      this.emit('sourcesUpdated', { 
        totalSources: this.sources.size,
        updatedSources: newSources.map(s => s.id)
      });
      
    } catch (error) {
      logger.error('Failed to update sources configuration', { error: error.message });
      throw error;
    }
  }

  /**
   * Update ingestion settings dynamically
   */
  updateSettings(newSettings) {
    logger.info('Updating ingestion settings', { newSettings });
    
    const previousSettings = { ...this.options };
    
    // Update options with new settings
    this.options = {
      ...this.options,
      ...newSettings
    };
    
    // Store settings for easy access
    this.settings = this.options;
    
    this.emit('settingsUpdated', {
      previousSettings,
      newSettings: this.options
    });
    
    logger.info('Ingestion settings updated successfully');
  }

  /**
   * Get current active sources
   */
  getActiveSources() {
    return Array.from(this.sources.values()).filter(source => source.enabled !== false);
  }

  /**
   * Document Visibility Management Methods
   */

  /**
   * Set document visibility
   */
  async setDocumentVisibility(documentId, visibility, userId, reason = null, metadata = {}) {
    if (!this.options.enableVisibilityManagement) {
      throw new Error('Visibility management is not enabled');
    }

    try {
      return await this.visibilityManager.setDocumentVisibility(
        documentId, 
        visibility, 
        { userId, reason, ...metadata }
      );
    } catch (error) {
      this.emit('error', { type: 'visibility_set_failed', documentId, error: error.message });
      throw error;
    }
  }

  /**
   * Get document visibility
   */
  async getDocumentVisibility(documentId) {
    if (!this.options.enableVisibilityManagement) {
      return { visibility: 'internal', documentId }; // Default fallback
    }

    try {
      return await this.visibilityManager.getDocumentVisibility(documentId);
    } catch (error) {
      this.emit('error', { type: 'visibility_get_failed', documentId, error: error.message });
      throw error;
    }
  }

  /**
   * Check if user has access to document
   */
  async checkDocumentAccess(documentId, userId, accessLevel = 'read') {
    if (!this.options.enableVisibilityManagement) {
      return true; // Default allow if visibility management disabled
    }

    try {
      const hasAccess = await this.visibilityManager.checkAccess(documentId, userId, accessLevel);
      
      // Log access attempt
      if (this.visibilityDatabase) {
        await this.visibilityDatabase.logDocumentAccess(
          documentId, 
          userId, 
          accessLevel, 
          hasAccess,
          { timestamp: new Date().toISOString() }
        );
      }
      
      return hasAccess;
    } catch (error) {
      this.emit('error', { type: 'access_check_failed', documentId, userId, error: error.message });
      return false; // Deny access on error
    }
  }

  /**
   * Bulk update document visibilities
   */
  async bulkUpdateVisibility(updates, userId, reason = 'Bulk update') {
    if (!this.options.enableVisibilityManagement) {
      throw new Error('Visibility management is not enabled');
    }

    try {
      return await this.visibilityManager.bulkUpdateVisibility(
        updates, 
        { userId, reason }
      );
    } catch (error) {
      this.emit('error', { type: 'bulk_visibility_update_failed', error: error.message });
      throw error;
    }
  }

  /**
   * Get pending visibility approvals
   */
  async getPendingApprovals(filters = {}) {
    if (!this.options.enableVisibilityManagement) {
      return [];
    }

    try {
      return await this.visibilityManager.getPendingApprovals(filters);
    } catch (error) {
      this.emit('error', { type: 'get_pending_approvals_failed', error: error.message });
      throw error;
    }
  }

  /**
   * Approve visibility change
   */
  async approveVisibilityChange(approvalId, approvedBy, notes = '') {
    if (!this.options.enableVisibilityManagement) {
      throw new Error('Visibility management is not enabled');
    }

    try {
      return await this.visibilityManager.approveVisibilityChange(approvalId, approvedBy, notes);
    } catch (error) {
      this.emit('error', { type: 'approval_failed', approvalId, error: error.message });
      throw error;
    }
  }

  /**
   * Reject visibility change
   */
  async rejectVisibilityChange(approvalId, rejectedBy, reason = '') {
    if (!this.options.enableVisibilityManagement) {
      throw new Error('Visibility management is not enabled');
    }

    try {
      return await this.visibilityManager.rejectVisibilityChange(approvalId, rejectedBy, reason);
    } catch (error) {
      this.emit('error', { type: 'rejection_failed', approvalId, error: error.message });
      throw error;
    }
  }

  /**
   * Apply visibility rules to document
   */
  async applyVisibilityRules(documentId, documentMetadata) {
    if (!this.options.enableVisibilityManagement) {
      return 'internal'; // Default visibility
    }

    try {
      const suggestedVisibility = await this.visibilityManager.applyVisibilityRules(
        documentId, 
        documentMetadata
      );
      
      // Auto-apply if no approval required
      const requiresApproval = this.visibilityManager._requiresApproval(suggestedVisibility);
      if (!requiresApproval) {
        await this.setDocumentVisibility(
          documentId, 
          suggestedVisibility, 
          'system', 
          'Auto-applied via visibility rules',
          { ruleApplied: true, documentMetadata }
        );
      }
      
      return suggestedVisibility;
    } catch (error) {
      this.emit('error', { type: 'rule_application_failed', documentId, error: error.message });
      return 'internal'; // Fallback to default
    }
  }

  /**
   * Add visibility rule
   */
  addVisibilityRule(ruleId, rule) {
    if (!this.options.enableVisibilityManagement) {
      throw new Error('Visibility management is not enabled');
    }

    try {
      return this.visibilityManager.addVisibilityRule(ruleId, rule);
    } catch (error) {
      this.emit('error', { type: 'add_rule_failed', ruleId, error: error.message });
      throw error;
    }
  }

  /**
   * Remove visibility rule
   */
  removeVisibilityRule(ruleId) {
    if (!this.options.enableVisibilityManagement) {
      throw new Error('Visibility management is not enabled');
    }

    try {
      return this.visibilityManager.removeVisibilityRule(ruleId);
    } catch (error) {
      this.emit('error', { type: 'remove_rule_failed', ruleId, error: error.message });
      throw error;
    }
  }

  /**
   * Get visibility audit log for document
   */
  async getVisibilityAuditLog(documentId, limit = 50) {
    if (!this.options.enableVisibilityManagement || !this.visibilityDatabase) {
      return [];
    }

    try {
      return await this.visibilityDatabase.getVisibilityAuditLog(documentId, limit);
    } catch (error) {
      this.emit('error', { type: 'audit_log_failed', documentId, error: error.message });
      throw error;
    }
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
