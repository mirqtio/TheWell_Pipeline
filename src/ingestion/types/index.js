/**
 * Core types and interfaces for the ingestion system
 */

/**
 * Source types supported by the ingestion engine
 */
const SOURCE_TYPES = {
  STATIC: 'static',                    // One-time bulk loads
  SEMI_STATIC: 'semi-static',         // Weekly polling (platform policies)
  DYNAMIC_CONSISTENT: 'dynamic-consistent',  // Daily batch processing
  DYNAMIC_UNSTRUCTURED: 'dynamic-unstructured' // Weekly discovery runs
};

/**
 * Document visibility levels
 */
const VISIBILITY_LEVELS = {
  INTERNAL: 'internal',
  EXTERNAL: 'external',
  RESTRICTED: 'restricted'
};

/**
 * Processing status for ingestion jobs
 */
const PROCESSING_STATUS = {
  PENDING: 'pending',
  IN_PROGRESS: 'in-progress',
  COMPLETED: 'completed',
  FAILED: 'failed',
  REQUIRES_REVIEW: 'requires-review',
  APPROVED: 'approved',
  REJECTED: 'rejected'
};

/**
 * Source configuration schema
 * @typedef {Object} SourceConfig
 * @property {string} id - Unique identifier for the source
 * @property {string} name - Human-readable name
 * @property {string} type - Source type from SOURCE_TYPES
 * @property {string} description - Description of the source
 * @property {Object} config - Source-specific configuration
 * @property {string} visibility - Default visibility level
 * @property {boolean} enabled - Whether the source is active
 * @property {Object} schedule - Scheduling configuration
 * @property {Object} authentication - Auth configuration if needed
 * @property {Array<string>} tags - Tags for categorization
 */

/**
 * Document metadata schema
 * @typedef {Object} DocumentMetadata
 * @property {string} sourceId - Source identifier
 * @property {string} sourceType - Type of source
 * @property {string} originalUrl - Original document URL/path
 * @property {string} title - Document title
 * @property {string} contentType - MIME type
 * @property {number} size - Document size in bytes
 * @property {Date} lastModified - Last modification date
 * @property {Date} ingestionDate - When document was ingested
 * @property {string} visibility - Visibility level
 * @property {Object} customMetadata - Source-specific metadata
 * @property {Array<string>} tags - Document tags
 */

/**
 * Ingestion job schema
 * @typedef {Object} IngestionJob
 * @property {string} id - Unique job identifier
 * @property {string} sourceId - Source identifier
 * @property {string} status - Current processing status
 * @property {Date} createdAt - Job creation timestamp
 * @property {Date} updatedAt - Last update timestamp
 * @property {Object} payload - Job-specific data
 * @property {Object} result - Processing result
 * @property {Array<Object>} errors - Any errors encountered
 * @property {Object} metrics - Processing metrics
 */

/**
 * Base source handler interface
 * All source handlers must implement these methods
 */
class BaseSourceHandler {
  constructor(config) {
    this.config = config;
    this.logger = null; // Will be injected
  }

  /**
   * Initialize the handler
   * @returns {Promise<void>}
   */
  async initialize() {
    throw new Error('initialize() must be implemented by subclass');
  }

  /**
   * Validate source configuration
   * @param {SourceConfig} config - Source configuration
   * @returns {Promise<boolean>}
   */
  async validateConfig(config) {
    throw new Error('validateConfig() must be implemented by subclass');
  }

  /**
   * Discover available documents/content
   * @returns {Promise<Array<Object>>}
   */
  async discover() {
    throw new Error('discover() must be implemented by subclass');
  }

  /**
   * Extract content from a specific document
   * @param {Object} document - Document reference
   * @returns {Promise<Object>}
   */
  async extract(document) {
    throw new Error('extract() must be implemented by subclass');
  }

  /**
   * Transform extracted content to standard format
   * @param {Object} content - Raw extracted content
   * @returns {Promise<Object>}
   */
  async transform(content) {
    throw new Error('transform() must be implemented by subclass');
  }

  /**
   * Clean up resources
   * @returns {Promise<void>}
   */
  async cleanup() {
    // Default implementation - can be overridden
  }
}

module.exports = {
  SOURCE_TYPES,
  VISIBILITY_LEVELS,
  PROCESSING_STATUS,
  BaseSourceHandler
};
