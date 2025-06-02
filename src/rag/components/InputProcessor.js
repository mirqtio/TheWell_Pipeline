/**
 * Input Processor
 * Handles query preprocessing, validation, and context extraction
 */

const Joi = require('joi');
const logger = require('../../utils/logger');

class InputProcessor {
  constructor(options = {}) {
    this.maxQueryLength = options.maxQueryLength || 1000;
    this.allowedLanguages = options.allowedLanguages || ['en'];
    this.isInitialized = false;
    
    // Define validation schema
    this.querySchema = Joi.object({
      query: Joi.string().min(1).max(this.maxQueryLength).required(),
      context: Joi.object({
        conversationId: Joi.string().optional(),
        previousQueries: Joi.array().items(Joi.string()).max(5).optional(),
        userPreferences: Joi.object().optional(),
        sessionData: Joi.object().optional()
      }).optional(),
      filters: Joi.object({
        sources: Joi.array().items(Joi.string()).optional(),
        dateRange: Joi.object({
          start: Joi.date().optional(),
          end: Joi.date().optional()
        }).optional(),
        contentTypes: Joi.array().items(Joi.string()).optional(),
        tags: Joi.array().items(Joi.string()).optional()
      }).optional(),
      options: Joi.object({
        maxResults: Joi.number().integer().min(1).max(50).optional(),
        includeMetadata: Joi.boolean().optional(),
        includeSources: Joi.boolean().optional(),
        responseFormat: Joi.string().valid('json', 'text', 'markdown').optional()
      }).optional()
    });
  }

  /**
   * Initialize the Input Processor
   */
  async initialize() {
    try {
      logger.info('Initializing Input Processor...');
      this.isInitialized = true;
      logger.info('Input Processor initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Input Processor:', error);
      throw error;
    }
  }

  /**
   * Process and validate input query
   * @param {Object} queryData - Raw query data
   * @param {Object} userAuth - User authentication data
   * @returns {Object} Processed query data
   */
  async process(queryData, userAuth) {
    if (!this.isInitialized) {
      throw new Error('InputProcessor must be initialized');
    }

    try {
      // Validate input structure
      const { error, value } = this.querySchema.validate(queryData, {
        allowUnknown: false,
        stripUnknown: true
      });
      
      if (error) {
        throw new Error(`Invalid query format: ${error.details[0].message}`);
      }
      
      const processedQuery = {
        query: this.preprocessQuery(value.query),
        context: value.context || {},
        filters: this.processFilters(value.filters || {}, userAuth),
        options: value.options || {},
        metadata: {
          originalQuery: value.query,
          userId: userAuth.userId,
          timestamp: new Date().toISOString(),
          language: this.detectLanguage(value.query),
          queryType: this.classifyQuery(value.query)
        }
      };
      
      // Add user-specific context
      processedQuery.context.userId = userAuth.userId;
      processedQuery.context.userRoles = userAuth.roles || [];
      
      logger.debug('Query processed successfully', {
        userId: userAuth.userId,
        queryLength: processedQuery.query.length,
        queryType: processedQuery.metadata.queryType
      });
      
      return processedQuery;
      
    } catch (error) {
      logger.error('Failed to process input query:', error);
      throw error;
    }
  }

  /**
   * Preprocess the query text
   * @param {string} query - Raw query
   * @returns {string} Preprocessed query
   */
  preprocessQuery(query) {
    // Trim whitespace
    let processed = query.trim();
    
    // Remove excessive whitespace
    processed = processed.replace(/\s+/g, ' ');
    
    // Basic sanitization (remove potentially harmful characters)
    processed = processed.replace(/[<>]/g, '');
    
    return processed;
  }

  /**
   * Process and validate filters
   * @param {Object} filters - Raw filters
   * @param {Object} userAuth - User authentication data
   * @returns {Object} Processed filters
   */
  processFilters(filters, userAuth) {
    const processedFilters = { ...filters };
    
    // Add user visibility constraints
    processedFilters.userVisibility = {
      userId: userAuth.userId,
      roles: userAuth.roles || [],
      permissions: userAuth.permissions || []
    };
    
    // Process date range
    if (processedFilters.dateRange) {
      if (processedFilters.dateRange.start) {
        processedFilters.dateRange.start = new Date(processedFilters.dateRange.start);
      }
      if (processedFilters.dateRange.end) {
        processedFilters.dateRange.end = new Date(processedFilters.dateRange.end);
      }
    }
    
    return processedFilters;
  }

  /**
   * Detect query language
   * @param {string} query - Query text
   * @returns {string} Detected language code
   */
  detectLanguage(query) {
    // Simple language detection (can be enhanced with a proper library)
    const englishPattern = /^[a-zA-Z0-9\s.,!?'"()-]+$/;
    
    if (englishPattern.test(query)) {
      return 'en';
    }
    
    return 'unknown';
  }

  /**
   * Classify the type of query
   * @param {string} query - Query text
   * @returns {string} Query type
   */
  classifyQuery(query) {
    const lowerQuery = query.toLowerCase();
    
    // Question patterns
    const questionWords = ['what', 'how', 'why', 'when', 'where', 'who', 'which'];
    if (questionWords.some(word => lowerQuery.startsWith(word)) || lowerQuery.includes('?')) {
      return 'question';
    }
    
    // Command patterns
    const commandWords = ['show', 'list', 'find', 'search', 'get', 'tell'];
    if (commandWords.some(word => lowerQuery.startsWith(word))) {
      return 'command';
    }
    
    // Keyword search
    if (lowerQuery.split(' ').length <= 3) {
      return 'keyword';
    }
    
    return 'general';
  }

  /**
   * Get processor status
   */
  async getStatus() {
    return {
      initialized: this.isInitialized,
      maxQueryLength: this.maxQueryLength,
      allowedLanguages: this.allowedLanguages,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Shutdown the processor
   */
  async shutdown() {
    logger.info('Shutting down Input Processor...');
    this.isInitialized = false;
  }
}

module.exports = InputProcessor;
