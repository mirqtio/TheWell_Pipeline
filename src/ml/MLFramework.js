const tf = require('@tensorflow/tfjs-node');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

/**
 * MLFramework - Core machine learning framework for TheWell Pipeline
 * Provides model management, versioning, and training pipeline abstraction
 */
class MLFramework {
  constructor(config = {}) {
    this.config = {
      modelsDir: config.modelsDir || path.join(__dirname, '../../models'),
      maxModelVersions: config.maxModelVersions || 5,
      defaultBatchSize: config.defaultBatchSize || 32,
      defaultEpochs: config.defaultEpochs || 10,
      tensorflowBackend: 'tensorflow',
      ...config
    };
    
    this.models = new Map();
    this.activeModels = new Map();
    this.trainingJobs = new Map();
  }

  /**
   * Initialize the ML framework
   */
  async initialize() {
    // Ensure models directory exists
    await fs.mkdir(this.config.modelsDir, { recursive: true });
    
    // Set TensorFlow.js backend
    await tf.setBackend(this.config.tensorflowBackend);
    
    logger.info('MLFramework initialized', {
      backend: tf.getBackend(),
      modelsDir: this.config.modelsDir
    });
  }

  /**
   * Register a model type
   */
  registerModelType(type, modelClass) {
    if (!modelClass || typeof modelClass !== 'function') {
      throw new Error('Invalid model class');
    }
    
    this.models.set(type, modelClass);
    logger.info(`Registered model type: ${type}`);
  }

  /**
   * Create a new model instance
   */
  async createModel(type, config = {}) {
    const ModelClass = this.models.get(type);
    if (!ModelClass) {
      throw new Error(`Unknown model type: ${type}`);
    }

    const modelId = uuidv4();
    const model = new ModelClass({
      ...config,
      id: modelId,
      type,
      framework: this
    });

    await model.initialize();
    this.activeModels.set(modelId, model);
    
    return model;
  }

  /**
   * Load a model from disk
   */
  async loadModel(modelPath, metadata = {}) {
    try {
      const model = await tf.loadLayersModel(`file://${modelPath}`);
      
      const modelId = metadata.id || uuidv4();
      const wrappedModel = {
        id: modelId,
        model,
        metadata,
        predict: async (input) => {
          const prediction = model.predict(input);
          return prediction;
        }
      };

      this.activeModels.set(modelId, wrappedModel);
      logger.info(`Model loaded: ${modelId}`, { path: modelPath });
      
      return wrappedModel;
    } catch (error) {
      logger.error('Failed to load model', { error: error.message, path: modelPath });
      throw error;
    }
  }

  /**
   * Save a model to disk with versioning
   */
  async saveModel(modelId, version) {
    const model = this.activeModels.get(modelId);
    if (!model) {
      throw new Error(`Model not found: ${modelId}`);
    }

    const modelDir = path.join(this.config.modelsDir, model.metadata.name || modelId);
    const versionDir = path.join(modelDir, version);
    
    await fs.mkdir(versionDir, { recursive: true });
    
    const modelPath = `file://${versionDir}`;
    await model.model.save(modelPath);

    // Save metadata
    const metadataPath = path.join(versionDir, 'metadata.json');
    await fs.writeFile(metadataPath, JSON.stringify({
      ...model.metadata,
      version,
      savedAt: new Date().toISOString()
    }, null, 2));

    logger.info(`Model saved: ${modelId}`, { version, path: versionDir });
    
    // Clean up old versions
    await this.cleanupOldVersions(modelDir);
    
    return versionDir;
  }

  /**
   * Train a model
   */
  async trainModel(modelId, trainingData, validationData, config = {}) {
    const model = this.activeModels.get(modelId);
    if (!model) {
      throw new Error(`Model not found: ${modelId}`);
    }

    const jobId = uuidv4();
    const trainingConfig = {
      batchSize: config.batchSize || this.config.defaultBatchSize,
      epochs: config.epochs || this.config.defaultEpochs,
      callbacks: config.callbacks || [],
      ...config
    };

    const job = {
      id: jobId,
      modelId,
      status: 'training',
      startedAt: new Date(),
      config: trainingConfig,
      metrics: []
    };

    this.trainingJobs.set(jobId, job);

    try {
      // Add progress tracking callback
      trainingConfig.callbacks.push({
        onEpochEnd: async (epoch, logs) => {
          job.metrics.push({ epoch, ...logs });
          logger.info(`Training progress: ${modelId}`, { epoch, logs });
        }
      });

      const history = await model.train(trainingData, validationData, trainingConfig);
      
      job.status = 'completed';
      job.completedAt = new Date();
      job.history = history;
      
      logger.info(`Training completed: ${modelId}`, { jobId, duration: job.completedAt - job.startedAt });
      
      return job;
    } catch (error) {
      job.status = 'failed';
      job.error = error.message;
      job.completedAt = new Date();
      
      logger.error('Training failed', { modelId, jobId, error: error.message });
      throw error;
    }
  }

  /**
   * Evaluate a model
   */
  async evaluateModel(modelId, testData, metrics = ['accuracy']) {
    const model = this.activeModels.get(modelId);
    if (!model) {
      throw new Error(`Model not found: ${modelId}`);
    }

    const results = await model.evaluate(testData, metrics);
    
    logger.info(`Model evaluated: ${modelId}`, { metrics: results });
    
    return results;
  }

  /**
   * Make predictions
   */
  async predict(modelId, input, config = {}) {
    const model = this.activeModels.get(modelId);
    if (!model) {
      throw new Error(`Model not found: ${modelId}`);
    }

    const startTime = Date.now();
    const prediction = await model.predict(input, config);
    const latency = Date.now() - startTime;

    logger.debug(`Prediction made: ${modelId}`, { latency });
    
    return {
      prediction,
      modelId,
      latency,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Deploy a model for production use
   */
  async deployModel(modelId, version) {
    const model = this.activeModels.get(modelId);
    if (!model) {
      throw new Error(`Model not found: ${modelId}`);
    }

    model.metadata.status = 'deployed';
    model.metadata.deployedAt = new Date().toISOString();
    model.metadata.deployedVersion = version;

    logger.info(`Model deployed: ${modelId}`, { version });
    
    return model;
  }

  /**
   * Archive a model
   */
  async archiveModel(modelId) {
    const model = this.activeModels.get(modelId);
    if (!model) {
      throw new Error(`Model not found: ${modelId}`);
    }

    model.metadata.status = 'archived';
    model.metadata.archivedAt = new Date().toISOString();
    
    this.activeModels.delete(modelId);
    
    logger.info(`Model archived: ${modelId}`);
  }

  /**
   * Get model info
   */
  getModelInfo(modelId) {
    const model = this.activeModels.get(modelId);
    if (!model) {
      return null;
    }

    return {
      id: modelId,
      type: model.metadata.type,
      status: model.metadata.status,
      version: model.metadata.version,
      createdAt: model.metadata.createdAt,
      deployedAt: model.metadata.deployedAt,
      metrics: model.metadata.metrics
    };
  }

  /**
   * List all active models
   */
  listActiveModels() {
    const models = [];
    for (const [id, model] of this.activeModels) {
      models.push(this.getModelInfo(id));
    }
    return models;
  }

  /**
   * Get training job status
   */
  getTrainingJob(jobId) {
    return this.trainingJobs.get(jobId);
  }

  /**
   * Clean up old model versions
   */
  async cleanupOldVersions(modelDir) {
    try {
      const versions = await fs.readdir(modelDir);
      
      if (versions.length > this.config.maxModelVersions) {
        // Sort versions and remove oldest
        const sortedVersions = versions.sort();
        const toRemove = sortedVersions.slice(0, versions.length - this.config.maxModelVersions);
        
        for (const version of toRemove) {
          const versionPath = path.join(modelDir, version);
          await fs.rm(versionPath, { recursive: true });
          logger.info(`Removed old model version: ${version}`);
        }
      }
    } catch (error) {
      logger.error('Failed to cleanup old versions', { error: error.message });
    }
  }

  /**
   * Dispose of TensorFlow resources
   */
  dispose() {
    for (const [id, model] of this.activeModels) {
      if (model.dispose) {
        model.dispose();
      }
    }
    this.activeModels.clear();
    this.trainingJobs.clear();
  }
}

module.exports = MLFramework;