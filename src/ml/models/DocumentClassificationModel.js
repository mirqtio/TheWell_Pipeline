const tf = require('@tensorflow/tfjs-node');
const BaseModel = require('./BaseModel');
const logger = require('../../utils/logger');

/**
 * DocumentClassificationModel - Multi-class document classification
 */
class DocumentClassificationModel extends BaseModel {
  constructor(config = {}) {
    super({
      ...config,
      type: 'classification'
    });
    
    this.numClasses = config.numClasses || 10;
    this.maxLength = config.maxLength || 1000;
    this.embeddingDim = config.embeddingDim || 128;
    this.vocabSize = config.vocabSize || 10000;
    this.classes = config.classes || [];
  }

  /**
   * Build the model architecture
   */
  async buildModel() {
    // Input layer
    const input = tf.input({ shape: [this.maxLength] });
    
    // Embedding layer
    const embedding = tf.layers.embedding({
      inputDim: this.vocabSize,
      outputDim: this.embeddingDim,
      inputLength: this.maxLength
    }).apply(input);
    
    // CNN layers for feature extraction
    const conv1 = tf.layers.conv1d({
      filters: 128,
      kernelSize: 5,
      activation: 'relu',
      padding: 'same'
    }).apply(embedding);
    
    const pool1 = tf.layers.maxPooling1d({
      poolSize: 2
    }).apply(conv1);
    
    const conv2 = tf.layers.conv1d({
      filters: 64,
      kernelSize: 3,
      activation: 'relu',
      padding: 'same'
    }).apply(pool1);
    
    // Global max pooling
    const globalPool = tf.layers.globalMaxPooling1d().apply(conv2);
    
    // Dense layers
    const dropout1 = tf.layers.dropout({ rate: 0.5 }).apply(globalPool);
    
    const dense1 = tf.layers.dense({
      units: 128,
      activation: 'relu'
    }).apply(dropout1);
    
    const dropout2 = tf.layers.dropout({ rate: 0.5 }).apply(dense1);
    
    // Output layer
    const output = tf.layers.dense({
      units: this.numClasses,
      activation: 'softmax'
    }).apply(dropout2);
    
    // Create and compile model
    this.model = tf.model({ inputs: input, outputs: output });
    
    this.model.compile({
      optimizer: tf.train.adam(0.001),
      loss: 'categoricalCrossentropy',
      metrics: ['accuracy']
    });
    
    logger.info('Document classification model built', {
      numClasses: this.numClasses,
      maxLength: this.maxLength
    });
  }

  /**
   * Preprocess text input
   */
  async preprocessInput(texts) {
    // This is a simplified version - in production, use proper tokenization
    if (!Array.isArray(texts)) {
      texts = [texts];
    }
    
    const sequences = texts.map(text => {
      // Simple word tokenization
      const words = text.toLowerCase().split(/\s+/);
      
      // Convert to token indices (simplified)
      const tokens = words.map(word => {
        // Hash word to index
        let hash = 0;
        for (let i = 0; i < word.length; i++) {
          hash = ((hash << 5) - hash) + word.charCodeAt(i);
          hash = hash & hash;
        }
        return Math.abs(hash) % this.vocabSize;
      });
      
      // Pad or truncate to maxLength
      if (tokens.length > this.maxLength) {
        return tokens.slice(0, this.maxLength);
      } else {
        const padded = new Array(this.maxLength).fill(0);
        tokens.forEach((token, i) => {
          padded[i] = token;
        });
        return padded;
      }
    });
    
    return tf.tensor2d(sequences);
  }

  /**
   * Postprocess model output
   */
  async postprocessOutput(output) {
    const predictions = await output.array();
    
    const results = predictions.map(pred => {
      const maxIndex = pred.indexOf(Math.max(...pred));
      const confidence = pred[maxIndex];
      
      return {
        class: this.classes[maxIndex] || `class_${maxIndex}`,
        classIndex: maxIndex,
        confidence,
        probabilities: this.classes.length > 0 
          ? Object.fromEntries(this.classes.map((cls, i) => [cls, pred[i]]))
          : pred
      };
    });
    
    output.dispose();
    
    return results.length === 1 ? results[0] : results;
  }

  /**
   * Train with text data
   */
  async trainWithTexts(texts, labels, validationSplit = 0.2, config = {}) {
    const processedTexts = await this.preprocessInput(texts);
    const oneHotLabels = tf.oneHot(tf.tensor1d(labels, 'int32'), this.numClasses);
    
    // Split data
    const numSamples = texts.length;
    const numValidation = Math.floor(numSamples * validationSplit);
    const numTraining = numSamples - numValidation;
    
    const indices = tf.util.createShuffledIndices(numSamples);
    const trainIndices = indices.slice(0, numTraining);
    const valIndices = indices.slice(numTraining);
    
    const trainX = tf.gather(processedTexts, trainIndices);
    const trainY = tf.gather(oneHotLabels, trainIndices);
    const valX = tf.gather(processedTexts, valIndices);
    const valY = tf.gather(oneHotLabels, valIndices);
    
    const history = await this.train(
      { x: trainX, y: trainY },
      { x: valX, y: valY },
      config
    );
    
    // Clean up
    processedTexts.dispose();
    oneHotLabels.dispose();
    trainX.dispose();
    trainY.dispose();
    valX.dispose();
    valY.dispose();
    
    return history;
  }
}

module.exports = DocumentClassificationModel;