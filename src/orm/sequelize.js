const { Sequelize, DataTypes } = require('sequelize');
const logger = require('../utils/logger');

/**
 * Sequelize ORM Configuration
 * Provides database connection and model management for TheWell Pipeline
 */
class SequelizeORM {
  constructor(config = {}) {
    this.config = {
      host: config.host || process.env.DB_HOST || 'localhost',
      port: config.port || process.env.DB_PORT || 5432,
      database: config.database || process.env.DB_NAME || 'thewell_pipeline',
      username: config.username || process.env.DB_USER || 'postgres',
      password: config.password || process.env.DB_PASSWORD || '',
      dialect: 'postgres',
      logging: config.logging !== false ? (msg) => logger.debug('Sequelize:', msg) : false,
      pool: {
        max: config.maxConnections || 20,
        min: config.minConnections || 0,
        acquire: 30000,
        idle: 10000
      },
      dialectOptions: {
        // Support for vector extension
        application_name: 'thewell_pipeline_orm'
      },
      define: {
        // Use snake_case for database columns but camelCase for model attributes
        underscored: true,
        // Don't add the timestamp attributes (updatedAt, createdAt)
        timestamps: false,
        // Don't delete database entries but set the newly added attribute deletedAt
        // to the current date (when deletion was done). paranoid will only work if
        // timestamps are enabled
        paranoid: false,
        // Don't use camelcase for automatically added attributes but underscore style
        // so updatedAt will be updated_at
        underscoredAll: true,
        // Disable the modification of table names; By default, sequelize will automatically
        // transform all passed model names (first parameter of define) into plural.
        // if you don't want that, set the following
        freezeTableName: true
      }
    };

    // Initialize Sequelize instance
    this.sequelize = new Sequelize(
      this.config.database,
      this.config.username,
      this.config.password,
      this.config
    );

    this.models = {};
    this.isConnected = false;
  }

  /**
   * Initialize the ORM connection and load all models
   */
  async initialize() {
    try {
      // Test the connection
      await this.sequelize.authenticate();
      this.isConnected = true;
      logger.info('ORM database connection established successfully');

      // Load all models
      await this.loadModels();

      // Set up associations
      this.setupAssociations();

      logger.info('ORM initialization completed successfully');
      return true;
    } catch (error) {
      logger.error('Failed to initialize ORM:', error);
      throw error;
    }
  }

  /**
   * Load all model definitions
   */
  async loadModels() {
    // Import all models
    const Source = require('./models/Source')(this.sequelize, DataTypes);
    const Document = require('./models/Document')(this.sequelize, DataTypes);
    const Job = require('./models/Job')(this.sequelize, DataTypes);
    const JobDependency = require('./models/JobDependency')(this.sequelize, DataTypes);
    const JobLog = require('./models/JobLog')(this.sequelize, DataTypes);
    const DocumentVisibility = require('./models/DocumentVisibility')(this.sequelize, DataTypes);
    const VisibilityRule = require('./models/VisibilityRule')(this.sequelize, DataTypes);
    const VisibilityAuditLog = require('./models/VisibilityAuditLog')(this.sequelize, DataTypes);
    const AuditLog = require('./models/AuditLog')(this.sequelize, DataTypes);
    const CostEvent = require('./models/CostEvent')(this.sequelize, DataTypes);
    const CostBudget = require('./models/CostBudget')(this.sequelize, DataTypes);
    const CostAlert = require('./models/CostAlert')(this.sequelize, DataTypes);
    const DocumentFeedback = require('./models/DocumentFeedback')(this.sequelize, DataTypes);
    const FeedbackAggregate = require('./models/FeedbackAggregate')(this.sequelize, DataTypes);

    // Store models in the models object
    this.models = {
      Source,
      Document,
      Job,
      JobDependency,
      JobLog,
      DocumentVisibility,
      VisibilityRule,
      VisibilityAuditLog,
      AuditLog,
      CostEvent,
      CostBudget,
      CostAlert,
      DocumentFeedback,
      FeedbackAggregate
    };

    // Make models available on sequelize instance
    Object.keys(this.models).forEach(modelName => {
      this.sequelize.models[modelName] = this.models[modelName];
    });

    logger.info(`Loaded ${Object.keys(this.models).length} ORM models`);
  }

  /**
   * Set up model associations/relationships
   */
  setupAssociations() {
    const {
      Source,
      Document,
      Job,
      JobDependency,
      JobLog,
      DocumentVisibility,
      VisibilityRule,
      VisibilityAuditLog,
      CostEvent,
      CostBudget,
      CostAlert,
      DocumentFeedback,
      FeedbackAggregate
    } = this.models;

    // Source -> Documents (one-to-many)
    Source.hasMany(Document, { foreignKey: 'source_id', as: 'documents' });
    Document.belongsTo(Source, { foreignKey: 'source_id', as: 'source' });

    // Source -> Jobs (one-to-many)
    Source.hasMany(Job, { foreignKey: 'source_id', as: 'jobs' });
    Job.belongsTo(Source, { foreignKey: 'source_id', as: 'source' });

    // Document -> Jobs (one-to-many)
    Document.hasMany(Job, { foreignKey: 'document_id', as: 'jobs' });
    Job.belongsTo(Document, { foreignKey: 'document_id', as: 'document' });

    // Job Dependencies (self-referential many-to-many)
    Job.belongsToMany(Job, {
      through: JobDependency,
      as: 'dependencies',
      foreignKey: 'job_id',
      otherKey: 'depends_on_job_id'
    });
    Job.belongsToMany(Job, {
      through: JobDependency,
      as: 'dependents',
      foreignKey: 'depends_on_job_id',
      otherKey: 'job_id'
    });

    // Job -> Job Logs (one-to-many)
    Job.hasMany(JobLog, { foreignKey: 'job_id', as: 'logs' });
    JobLog.belongsTo(Job, { foreignKey: 'job_id', as: 'job' });

    // Document -> Visibility (one-to-many)
    Document.hasMany(DocumentVisibility, { foreignKey: 'document_id', as: 'visibilitySettings' });
    DocumentVisibility.belongsTo(Document, { foreignKey: 'document_id', as: 'document' });

    // Document -> Visibility Audit Logs (one-to-many)
    Document.hasMany(VisibilityAuditLog, { foreignKey: 'document_id', as: 'visibilityAuditLogs' });
    VisibilityAuditLog.belongsTo(Document, { foreignKey: 'document_id', as: 'document' });

    // Document -> Feedback (one-to-many)
    Document.hasMany(DocumentFeedback, { foreignKey: 'document_id', as: 'feedback' });
    DocumentFeedback.belongsTo(Document, { foreignKey: 'document_id', as: 'document' });

    // Document -> Feedback Aggregates (one-to-one)
    Document.hasOne(FeedbackAggregate, { foreignKey: 'document_id', as: 'feedbackAggregate' });
    FeedbackAggregate.belongsTo(Document, { foreignKey: 'document_id', as: 'document' });

    // Cost Budget -> Cost Alerts (one-to-many)
    CostBudget.hasMany(CostAlert, { foreignKey: 'budget_id', as: 'alerts' });
    CostAlert.belongsTo(CostBudget, { foreignKey: 'budget_id', as: 'budget' });

    logger.info('ORM model associations configured successfully');
  }

  /**
   * Get a model by name
   */
  getModel(modelName) {
    return this.models[modelName];
  }

  /**
   * Get all models
   */
  getModels() {
    return this.models;
  }

  /**
   * Get the Sequelize instance
   */
  getSequelize() {
    return this.sequelize;
  }

  /**
   * Check if ORM is connected
   */
  isReady() {
    return this.isConnected;
  }

  /**
   * Sync models with database (use with caution in production)
   */
  async sync(options = {}) {
    try {
      await this.sequelize.sync(options);
      logger.info('ORM models synchronized with database');
    } catch (error) {
      logger.error('Failed to sync ORM models:', error);
      throw error;
    }
  }

  /**
   * Close the database connection
   */
  async close() {
    try {
      await this.sequelize.close();
      this.isConnected = false;
      logger.info('ORM database connection closed');
    } catch (error) {
      logger.error('Failed to close ORM connection:', error);
      throw error;
    }
  }

  /**
   * Execute a raw query
   */
  async query(sql, options = {}) {
    return this.sequelize.query(sql, options);
  }

  /**
   * Start a transaction
   */
  async transaction(callback) {
    return this.sequelize.transaction(callback);
  }
}

module.exports = SequelizeORM;
