const DatabaseManager = require('../database/DatabaseManager');
const MLFramework = require('../ml/MLFramework');
const {
  DocumentClassificationModel,
  SentimentAnalysisModel,
  TopicModel,
  DocumentSimilarityModel,
  QualityScoringModel,
  NEREnhancementModel
} = require('../ml/models');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

/**
 * MLModelService - Service for managing ML model lifecycle
 */
class MLModelService {
  constructor(config = {}) {
    this.config = {
      modelsDir: config.modelsDir || path.join(__dirname, '../../models'),
      maxConcurrentTraining: config.maxConcurrentTraining || 2,
      defaultTrainingConfig: {
        batchSize: 32,
        epochs: 10,
        validationSplit: 0.2
      },
      ...config
    };
    
    this.dbManager = null;
    this.mlFramework = null;
    this.activeTrainingJobs = new Map();
    this.modelRegistry = new Map();
  }

  /**
   * Initialize the service
   */
  async initialize() {
    // Initialize database
    this.dbManager = new DatabaseManager();
    await this.dbManager.initialize();
    
    // Initialize ML framework
    this.mlFramework = new MLFramework({
      modelsDir: this.config.modelsDir
    });
    await this.mlFramework.initialize();
    
    // Register model types
    this.registerModelTypes();
    
    // Load existing models from database
    await this.loadExistingModels();
    
    logger.info('MLModelService initialized');
  }

  /**
   * Register all model types
   */
  registerModelTypes() {
    this.mlFramework.registerModelType('classification', DocumentClassificationModel);
    this.mlFramework.registerModelType('sentiment', SentimentAnalysisModel);
    this.mlFramework.registerModelType('topic_modeling', TopicModel);
    this.mlFramework.registerModelType('similarity', DocumentSimilarityModel);
    this.mlFramework.registerModelType('quality_scoring', QualityScoringModel);
    this.mlFramework.registerModelType('ner', NEREnhancementModel);
  }

  /**
   * Load existing models from database
   */
  async loadExistingModels() {
    try {
      const query = `
        SELECT id, name, type, version, status, config, model_path
        FROM ml_models
        WHERE status = 'deployed'
        ORDER BY deployed_at DESC
      `;
      
      const models = await this.dbManager.query(query);
      
      for (const modelInfo of models) {
        if (modelInfo.model_path) {
          try {
            const model = await this.mlFramework.loadModel(
              modelInfo.model_path,
              modelInfo
            );
            this.modelRegistry.set(modelInfo.id, model);
            logger.info(`Loaded model: ${modelInfo.name} v${modelInfo.version}`);
          } catch (error) {
            logger.error(`Failed to load model: ${modelInfo.name}`, error);
          }
        }
      }
    } catch (error) {
      logger.error('Failed to load existing models', error);
    }
  }

  /**
   * Create a new model
   */
  async createModel(type, config = {}) {
    const transaction = await this.dbManager.beginTransaction();
    
    try {
      // Create model instance
      const model = await this.mlFramework.createModel(type, config);
      
      // Save to database
      const query = `
        INSERT INTO ml_models (name, type, version, status, config, hyperparameters, feature_config)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id
      `;
      
      const values = [
        config.name || `${type}_model_${Date.now()}`,
        type,
        config.version || '1.0.0',
        'draft',
        JSON.stringify(config),
        JSON.stringify(config.hyperparameters || {}),
        JSON.stringify(config.features || {})
      ];
      
      const result = await this.dbManager.query(query, values);
      const modelId = result[0].id;
      
      // Update model with database ID
      model.metadata.dbId = modelId;
      this.modelRegistry.set(modelId, model);
      
      await transaction.commit();
      
      logger.info(`Created model: ${type}`, { modelId });
      
      return {
        id: modelId,
        modelInstanceId: model.id,
        type,
        status: 'draft'
      };
    } catch (error) {
      await transaction.rollback();
      logger.error('Failed to create model', error);
      throw error;
    }
  }

  /**
   * Prepare training dataset
   */
  async prepareTrainingData(datasetConfig) {
    const transaction = await this.dbManager.beginTransaction();
    
    try {
      // Create dataset record
      const datasetQuery = `
        INSERT INTO ml_training_datasets (
          name, description, dataset_type, source_query, 
          filters, split_config, preprocessing_config
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id
      `;
      
      const datasetValues = [
        datasetConfig.name,
        datasetConfig.description,
        datasetConfig.type,
        datasetConfig.sourceQuery,
        JSON.stringify(datasetConfig.filters || {}),
        JSON.stringify(datasetConfig.splitConfig || { train: 0.8, validation: 0.1, test: 0.1 }),
        JSON.stringify(datasetConfig.preprocessing || {})
      ];
      
      const datasetResult = await this.dbManager.query(datasetQuery, datasetValues);
      const datasetId = datasetResult[0].id;
      
      // Fetch data based on source query
      const data = await this.fetchTrainingData(datasetConfig);
      
      // Update dataset size
      await this.dbManager.query(
        'UPDATE ml_training_datasets SET size = $1 WHERE id = $2',
        [data.length, datasetId]
      );
      
      await transaction.commit();
      
      return {
        datasetId,
        data,
        size: data.length
      };
    } catch (error) {
      await transaction.rollback();
      logger.error('Failed to prepare training data', error);
      throw error;
    }
  }

  /**
   * Fetch training data based on configuration
   */
  async fetchTrainingData(config) {
    let query = config.sourceQuery;
    const params = [];
    
    // Apply filters
    if (config.filters && Object.keys(config.filters).length > 0) {
      const filterClauses = [];
      let paramIndex = 1;
      
      for (const [field, value] of Object.entries(config.filters)) {
        filterClauses.push(`${field} = $${paramIndex}`);
        params.push(value);
        paramIndex++;
      }
      
      query += ` WHERE ${filterClauses.join(' AND ')}`;
    }
    
    // Add limit if specified
    if (config.limit) {
      query += ` LIMIT ${config.limit}`;
    }
    
    const results = await this.dbManager.query(query, params);
    return results;
  }

  /**
   * Train a model
   */
  async trainModel(modelId, datasetId, trainingConfig = {}) {
    // Check if model exists
    const model = this.modelRegistry.get(modelId);
    if (!model) {
      throw new Error(`Model not found: ${modelId}`);
    }
    
    // Check concurrent training limit
    if (this.activeTrainingJobs.size >= this.config.maxConcurrentTraining) {
      throw new Error('Maximum concurrent training jobs reached');
    }
    
    const jobId = uuidv4();
    const transaction = await this.dbManager.beginTransaction();
    
    try {
      // Create training job record
      const jobQuery = `
        INSERT INTO ml_training_jobs (model_id, dataset_id, status, config)
        VALUES ($1, $2, $3, $4)
        RETURNING id
      `;
      
      const jobValues = [
        modelId,
        datasetId,
        'pending',
        JSON.stringify(trainingConfig)
      ];
      
      const jobResult = await this.dbManager.query(jobQuery, jobValues);
      const dbJobId = jobResult[0].id;
      
      await transaction.commit();
      
      // Start training asynchronously
      this.startTrainingJob(dbJobId, model, datasetId, trainingConfig);
      
      return {
        jobId: dbJobId,
        status: 'started',
        modelId,
        datasetId
      };
    } catch (error) {
      await transaction.rollback();
      logger.error('Failed to start training job', error);
      throw error;
    }
  }

  /**
   * Start training job asynchronously
   */
  async startTrainingJob(jobId, model, datasetId, config) {
    this.activeTrainingJobs.set(jobId, {
      startTime: Date.now(),
      status: 'running'
    });
    
    try {
      // Update job status
      await this.dbManager.query(
        'UPDATE ml_training_jobs SET status = $1, started_at = NOW() WHERE id = $2',
        ['training', jobId]
      );
      
      // Get training data
      const datasetQuery = 'SELECT * FROM ml_training_datasets WHERE id = $1';
      const datasetResult = await this.dbManager.query(datasetQuery, [datasetId]);
      const dataset = datasetResult[0];
      
      // Fetch actual data
      const trainingData = await this.fetchTrainingData(JSON.parse(dataset.source_query));
      
      // Split data
      const { train, validation, test } = this.splitData(
        trainingData,
        JSON.parse(dataset.split_config)
      );
      
      // Prepare data for model
      const preparedData = await this.prepareDataForModel(
        model.metadata.type,
        { train, validation, test }
      );
      
      // Train model
      const history = await model.train(
        preparedData.train,
        preparedData.validation,
        {
          ...this.config.defaultTrainingConfig,
          ...config
        }
      );
      
      // Evaluate on test set
      const metrics = await model.evaluate(preparedData.test);
      
      // Save model
      const version = `${model.metadata.version}-${Date.now()}`;
      const modelPath = await this.mlFramework.saveModel(model.id, version);
      
      // Update database
      await this.updateTrainingJobSuccess(jobId, metrics, modelPath, version);
      
      logger.info(`Training completed for model ${model.id}`, { jobId, metrics });
    } catch (error) {
      logger.error(`Training failed for job ${jobId}`, error);
      await this.updateTrainingJobFailure(jobId, error.message);
    } finally {
      this.activeTrainingJobs.delete(jobId);
    }
  }

  /**
   * Split data into train/validation/test sets
   */
  splitData(data, splitConfig) {
    const shuffled = [...data].sort(() => Math.random() - 0.5);
    const total = shuffled.length;
    
    const trainSize = Math.floor(total * splitConfig.train);
    const valSize = Math.floor(total * splitConfig.validation);
    
    return {
      train: shuffled.slice(0, trainSize),
      validation: shuffled.slice(trainSize, trainSize + valSize),
      test: shuffled.slice(trainSize + valSize)
    };
  }

  /**
   * Prepare data for specific model type
   */
  async prepareDataForModel(modelType, splitData) {
    // This would be customized based on model type
    // For now, return a simplified version
    const prepareSet = (data) => {
      const texts = data.map(d => d.content || d.text || '');
      const labels = data.map(d => d.label || d.category || 0);
      
      return {
        x: texts,
        y: labels
      };
    };
    
    return {
      train: prepareSet(splitData.train),
      validation: prepareSet(splitData.validation),
      test: prepareSet(splitData.test)
    };
  }

  /**
   * Update training job on success
   */
  async updateTrainingJobSuccess(jobId, metrics, modelPath, version) {
    const transaction = await this.dbManager.beginTransaction();
    
    try {
      // Update job
      await this.dbManager.query(
        `UPDATE ml_training_jobs 
         SET status = $1, completed_at = NOW(), metrics = $2 
         WHERE id = $3`,
        ['completed', JSON.stringify(metrics), jobId]
      );
      
      // Get model info
      const jobResult = await this.dbManager.query(
        'SELECT model_id FROM ml_training_jobs WHERE id = $1',
        [jobId]
      );
      const modelId = jobResult[0].model_id;
      
      // Create model version
      await this.dbManager.query(
        `INSERT INTO ml_model_versions (model_id, version, model_path, training_duration_seconds)
         VALUES ($1, $2, $3, $4)`,
        [modelId, version, modelPath, Math.floor((Date.now() - this.activeTrainingJobs.get(jobId).startTime) / 1000)]
      );
      
      // Save metrics
      for (const [metricName, metricValue] of Object.entries(metrics)) {
        await this.dbManager.query(
          `INSERT INTO ml_model_metrics (model_id, training_job_id, metric_type, metric_name, metric_value)
           VALUES ($1, $2, $3, $4, $5)`,
          [modelId, jobId, 'evaluation', metricName, metricValue]
        );
      }
      
      // Update model status
      await this.dbManager.query(
        'UPDATE ml_models SET status = $1, updated_at = NOW() WHERE id = $2',
        ['trained', modelId]
      );
      
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  /**
   * Update training job on failure
   */
  async updateTrainingJobFailure(jobId, errorMessage) {
    await this.dbManager.query(
      `UPDATE ml_training_jobs 
       SET status = $1, completed_at = NOW(), error_message = $2 
       WHERE id = $3`,
      ['failed', errorMessage, jobId]
    );
  }

  /**
   * Deploy a model
   */
  async deployModel(modelId, version = null) {
    const transaction = await this.dbManager.beginTransaction();
    
    try {
      // Get model info
      const modelQuery = version
        ? `SELECT m.*, mv.model_path, mv.version as deploy_version
           FROM ml_models m
           JOIN ml_model_versions mv ON m.id = mv.model_id
           WHERE m.id = $1 AND mv.version = $2`
        : `SELECT m.*, mv.model_path, mv.version as deploy_version
           FROM ml_models m
           JOIN ml_model_versions mv ON m.id = mv.model_id
           WHERE m.id = $1
           ORDER BY mv.created_at DESC
           LIMIT 1`;
      
      const params = version ? [modelId, version] : [modelId];
      const modelResult = await this.dbManager.query(modelQuery, params);
      
      if (modelResult.length === 0) {
        throw new Error('Model or version not found');
      }
      
      const modelInfo = modelResult[0];
      
      // Load model if not already loaded
      if (!this.modelRegistry.has(modelId)) {
        const model = await this.mlFramework.loadModel(
          modelInfo.model_path,
          modelInfo
        );
        this.modelRegistry.set(modelId, model);
      }
      
      // Update model status
      await this.dbManager.query(
        `UPDATE ml_models 
         SET status = $1, deployed_at = NOW(), version = $2 
         WHERE id = $3`,
        ['deployed', modelInfo.deploy_version, modelId]
      );
      
      await transaction.commit();
      
      logger.info(`Model deployed: ${modelInfo.name} v${modelInfo.deploy_version}`);
      
      return {
        modelId,
        name: modelInfo.name,
        type: modelInfo.type,
        version: modelInfo.deploy_version,
        status: 'deployed'
      };
    } catch (error) {
      await transaction.rollback();
      logger.error('Failed to deploy model', error);
      throw error;
    }
  }

  /**
   * Make prediction with a model
   */
  async predict(modelId, input, options = {}) {
    const model = this.modelRegistry.get(modelId);
    if (!model) {
      throw new Error(`Model not deployed: ${modelId}`);
    }
    
    const startTime = Date.now();
    
    try {
      // Make prediction
      const prediction = await this.mlFramework.predict(model.id, input, options);
      
      // Log prediction for monitoring
      await this.logPrediction(modelId, input, prediction, Date.now() - startTime);
      
      return prediction;
    } catch (error) {
      logger.error(`Prediction failed for model ${modelId}`, error);
      throw error;
    }
  }

  /**
   * Log prediction for monitoring
   */
  async logPrediction(modelId, input, prediction, latency) {
    try {
      await this.dbManager.query(
        `INSERT INTO ml_predictions (model_id, input_data, prediction, confidence, latency_ms)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          modelId,
          JSON.stringify(input),
          JSON.stringify(prediction.prediction),
          prediction.confidence || null,
          latency
        ]
      );
    } catch (error) {
      logger.error('Failed to log prediction', error);
    }
  }

  /**
   * Get model performance metrics
   */
  async getModelMetrics(modelId, metricType = null) {
    let query = `
      SELECT metric_type, metric_name, metric_value, evaluated_at
      FROM ml_model_metrics
      WHERE model_id = $1
    `;
    
    const params = [modelId];
    
    if (metricType) {
      query += ' AND metric_type = $2';
      params.push(metricType);
    }
    
    query += ' ORDER BY evaluated_at DESC';
    
    const results = await this.dbManager.query(query, params);
    
    return results.map(row => ({
      type: row.metric_type,
      name: row.metric_name,
      value: row.metric_value,
      evaluatedAt: row.evaluated_at
    }));
  }

  /**
   * List all models
   */
  async listModels(filters = {}) {
    let query = `
      SELECT m.*, 
             COUNT(DISTINCT mv.id) as version_count,
             COUNT(DISTINCT tj.id) as training_count
      FROM ml_models m
      LEFT JOIN ml_model_versions mv ON m.id = mv.model_id
      LEFT JOIN ml_training_jobs tj ON m.id = tj.model_id
      WHERE 1=1
    `;
    
    const params = [];
    let paramIndex = 1;
    
    if (filters.type) {
      query += ` AND m.type = $${paramIndex}`;
      params.push(filters.type);
      paramIndex++;
    }
    
    if (filters.status) {
      query += ` AND m.status = $${paramIndex}`;
      params.push(filters.status);
      paramIndex++;
    }
    
    query += ' GROUP BY m.id ORDER BY m.created_at DESC';
    
    const results = await this.dbManager.query(query, params);
    
    return results.map(row => ({
      id: row.id,
      name: row.name,
      type: row.type,
      status: row.status,
      version: row.version,
      versionCount: parseInt(row.version_count),
      trainingCount: parseInt(row.training_count),
      createdAt: row.created_at,
      deployedAt: row.deployed_at
    }));
  }

  /**
   * Archive a model
   */
  async archiveModel(modelId) {
    const transaction = await this.dbManager.beginTransaction();
    
    try {
      // Update model status
      await this.dbManager.query(
        'UPDATE ml_models SET status = $1, archived_at = NOW() WHERE id = $2',
        ['archived', modelId]
      );
      
      // Remove from active models
      if (this.modelRegistry.has(modelId)) {
        const model = this.modelRegistry.get(modelId);
        await this.mlFramework.archiveModel(model.id);
        this.modelRegistry.delete(modelId);
      }
      
      await transaction.commit();
      
      logger.info(`Model archived: ${modelId}`);
    } catch (error) {
      await transaction.rollback();
      logger.error('Failed to archive model', error);
      throw error;
    }
  }

  /**
   * Clean up resources
   */
  async cleanup() {
    // Cancel active training jobs
    for (const [jobId, job] of this.activeTrainingJobs) {
      logger.warn(`Cancelling training job: ${jobId}`);
      await this.updateTrainingJobFailure(jobId, 'Service shutdown');
    }
    
    this.activeTrainingJobs.clear();
    
    // Dispose ML framework
    if (this.mlFramework) {
      this.mlFramework.dispose();
    }
    
    // Close database
    if (this.dbManager) {
      await this.dbManager.close();
    }
  }
}

module.exports = MLModelService;