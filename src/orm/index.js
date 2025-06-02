/**
 * ORM Module - Main entry point for TheWell Pipeline ORM
 * Provides a unified interface for database operations using Sequelize
 */

const SequelizeORM = require('./sequelize');
const logger = require('../utils/logger');

class ORMManager {
  constructor(config = {}) {
    this.orm = new SequelizeORM(config);
    this.isInitialized = false;
  }

  /**
   * Initialize the ORM system
   */
  async initialize() {
    try {
      await this.orm.initialize();
      this.isInitialized = true;
      logger.info('ORM Manager initialized successfully');
      return true;
    } catch (error) {
      logger.error('Failed to initialize ORM Manager:', error);
      throw error;
    }
  }

  /**
   * Get a model by name
   */
  getModel(modelName) {
    if (!this.isInitialized) {
      throw new Error('ORM Manager not initialized. Call initialize() first.');
    }
    return this.orm.getModel(modelName);
  }

  /**
   * Get all models
   */
  getModels() {
    if (!this.isInitialized) {
      throw new Error('ORM Manager not initialized. Call initialize() first.');
    }
    return this.orm.getModels();
  }

  /**
   * Get the Sequelize instance
   */
  getSequelize() {
    if (!this.isInitialized) {
      throw new Error('ORM Manager not initialized. Call initialize() first.');
    }
    return this.orm.getSequelize();
  }

  /**
   * Check if ORM is ready
   */
  isReady() {
    return this.isInitialized && this.orm.isReady();
  }

  /**
   * Execute a transaction
   */
  async transaction(callback) {
    if (!this.isInitialized) {
      throw new Error('ORM Manager not initialized. Call initialize() first.');
    }
    return this.orm.transaction(callback);
  }

  /**
   * Execute a raw query
   */
  async query(sql, options = {}) {
    if (!this.isInitialized) {
      throw new Error('ORM Manager not initialized. Call initialize() first.');
    }
    return this.orm.query(sql, options);
  }

  /**
   * Sync models with database (use with caution in production)
   */
  async sync(options = {}) {
    if (!this.isInitialized) {
      throw new Error('ORM Manager not initialized. Call initialize() first.');
    }
    return this.orm.sync(options);
  }

  /**
   * Close the ORM connection
   */
  async close() {
    if (this.isInitialized) {
      await this.orm.close();
      this.isInitialized = false;
      logger.info('ORM Manager closed');
    }
  }

  /**
   * Health check for ORM system
   */
  async healthCheck() {
    try {
      if (!this.isInitialized) {
        return { status: 'error', message: 'ORM not initialized' };
      }

      const sequelize = this.orm.getSequelize();
      await sequelize.authenticate();
      
      return {
        status: 'healthy',
        message: 'ORM connection is active',
        models: Object.keys(this.orm.getModels()).length,
        connected: this.orm.isReady()
      };
    } catch (error) {
      return {
        status: 'error',
        message: error.message,
        connected: false
      };
    }
  }
}

// Export singleton instance
let ormInstance = null;

module.exports = {
  ORMManager,
  
  /**
   * Get or create singleton ORM instance
   */
  getORM: (config = {}) => {
    if (!ormInstance) {
      ormInstance = new ORMManager(config);
    }
    return ormInstance;
  },

  /**
   * Initialize ORM with configuration
   */
  initializeORM: async (config = {}) => {
    const orm = module.exports.getORM(config);
    await orm.initialize();
    return orm;
  },

  /**
   * Close ORM connection
   */
  closeORM: async () => {
    if (ormInstance) {
      await ormInstance.close();
      ormInstance = null;
    }
  }
};
