const tf = require('@tensorflow/tfjs-node');
const logger = require('../../utils/logger');

/**
 * BaseModel - Abstract base class for all ML models
 */
class BaseModel {
  constructor(config = {}) {
    this.id = config.id;
    this.type = config.type;
    this.framework = config.framework;
    this.config = config;
    this.model = null;
    this.isInitialized = false;
    
    this.metadata = {
      id: this.id,
      type: this.type,
      name: config.name || `${this.type}-model`,
      version: config.version || '1.0.0',
      status: 'draft',
      createdAt: new Date().toISOString(),
      ...config.metadata
    };
  }

  /**
   * Initialize the model
   */
  async initialize() {
    if (this.isInitialized) {
      return;
    }

    await this.buildModel();
    this.isInitialized = true;
    
    logger.info(`Model initialized: ${this.metadata.name}`, { type: this.type });
  }

  /**
   * Build the model architecture - must be implemented by subclasses
   */
  async buildModel() {
    throw new Error('buildModel() must be implemented by subclass');
  }

  /**
   * Preprocess input data
   */
  async preprocessInput(input) {
    // Default implementation - override in subclasses
    return input;
  }

  /**
   * Postprocess model output
   */
  async postprocessOutput(output) {
    // Default implementation - override in subclasses
    return output;
  }

  /**
   * Train the model
   */
  async train(trainingData, validationData, config = {}) {
    if (!this.model) {
      throw new Error('Model not built');
    }

    const { x: trainX, y: trainY } = trainingData;
    const { x: valX, y: valY } = validationData;

    const history = await this.model.fit(trainX, trainY, {
      batchSize: config.batchSize || 32,
      epochs: config.epochs || 10,
      validationData: [valX, valY],
      callbacks: config.callbacks || [],
      shuffle: config.shuffle !== false,
      ...config
    });

    this.metadata.lastTrainedAt = new Date().toISOString();
    this.metadata.trainingConfig = config;
    
    return history;
  }

  /**
   * Evaluate the model
   */
  async evaluate(testData, metrics = ['accuracy']) {
    if (!this.model) {
      throw new Error('Model not built');
    }

    const { x: testX, y: testY } = testData;
    const evaluation = this.model.evaluate(testX, testY);
    
    const results = {};
    if (Array.isArray(evaluation)) {
      metrics.forEach((metric, i) => {
        results[metric] = evaluation[i].dataSync()[0];
      });
    } else {
      results[metrics[0]] = evaluation.dataSync()[0];
    }

    this.metadata.metrics = results;
    
    return results;
  }

  /**
   * Make predictions
   */
  async predict(input, config = {}) {
    if (!this.model) {
      throw new Error('Model not built');
    }

    const processedInput = await this.preprocessInput(input);
    const prediction = this.model.predict(processedInput);
    const output = await this.postprocessOutput(prediction);
    
    // Clean up tensors
    if (processedInput !== input && processedInput.dispose) {
      processedInput.dispose();
    }
    if (prediction !== output && prediction.dispose) {
      prediction.dispose();
    }
    
    return output;
  }

  /**
   * Get model summary
   */
  summary() {
    if (!this.model) {
      throw new Error('Model not built');
    }
    
    return this.model.summary();
  }

  /**
   * Get model configuration
   */
  getConfig() {
    return {
      ...this.config,
      metadata: this.metadata
    };
  }

  /**
   * Dispose of model resources
   */
  dispose() {
    if (this.model) {
      this.model.dispose();
      this.model = null;
    }
    this.isInitialized = false;
  }
}

module.exports = BaseModel;