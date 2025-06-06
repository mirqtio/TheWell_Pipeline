const tf = require('@tensorflow/tfjs-node');
const BaseModel = require('./BaseModel');
const logger = require('../../utils/logger');

/**
 * SentimentAnalysisModel - Sentiment classification (positive, neutral, negative)
 */
class SentimentAnalysisModel extends BaseModel {
  constructor(config = {}) {
    super({
      ...config,
      type: 'sentiment'
    });
    
    this.maxLength = config.maxLength || 500;
    this.embeddingDim = config.embeddingDim || 100;
    this.vocabSize = config.vocabSize || 5000;
    this.lstmUnits = config.lstmUnits || 64;
    
    // Sentiment classes
    this.sentimentClasses = ['negative', 'neutral', 'positive'];
    this.numClasses = 3;
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
      inputLength: this.maxLength,
      maskZero: true
    }).apply(input);
    
    // Bidirectional LSTM for context understanding
    const lstm = tf.layers.bidirectional({
      layer: tf.layers.lstm({
        units: this.lstmUnits,
        returnSequences: false,
        recurrentDropout: 0.2
      })
    }).apply(embedding);
    
    // Dense layers
    const dropout = tf.layers.dropout({ rate: 0.5 }).apply(lstm);
    
    const dense = tf.layers.dense({
      units: 32,
      activation: 'relu'
    }).apply(dropout);
    
    // Output layer
    const output = tf.layers.dense({
      units: this.numClasses,
      activation: 'softmax'
    }).apply(dense);
    
    // Create and compile model
    this.model = tf.model({ inputs: input, outputs: output });
    
    this.model.compile({
      optimizer: tf.train.adam(0.001),
      loss: 'categoricalCrossentropy',
      metrics: ['accuracy']
    });
    
    logger.info('Sentiment analysis model built', {
      maxLength: this.maxLength,
      lstmUnits: this.lstmUnits
    });
  }

  /**
   * Preprocess text for sentiment analysis
   */
  async preprocessInput(texts) {
    if (!Array.isArray(texts)) {
      texts = [texts];
    }
    
    const sequences = texts.map(text => {
      // Clean text
      const cleaned = text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .trim();
      
      // Simple tokenization
      const words = cleaned.split(/\s+/);
      
      // Convert to token indices
      const tokens = words.map(word => {
        // Simple hash function for word to index mapping
        let hash = 0;
        for (let i = 0; i < word.length; i++) {
          hash = ((hash << 5) - hash) + word.charCodeAt(i);
          hash = hash & hash;
        }
        return Math.abs(hash) % this.vocabSize;
      });
      
      // Pad or truncate
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
   * Postprocess sentiment predictions
   */
  async postprocessOutput(output) {
    const predictions = await output.array();
    
    const results = predictions.map(pred => {
      const scores = {
        negative: pred[0],
        neutral: pred[1],
        positive: pred[2]
      };
      
      // Find dominant sentiment
      const maxScore = Math.max(...pred);
      const sentiment = this.sentimentClasses[pred.indexOf(maxScore)];
      
      // Calculate compound score (-1 to 1)
      const compound = (scores.positive - scores.negative);
      
      return {
        sentiment,
        confidence: maxScore,
        scores,
        compound,
        // Additional metrics
        polarity: compound > 0.1 ? 'positive' : compound < -0.1 ? 'negative' : 'neutral',
        subjectivity: 1 - scores.neutral // Simple subjectivity measure
      };
    });
    
    output.dispose();
    
    return results.length === 1 ? results[0] : results;
  }

  /**
   * Analyze sentiment for multiple texts
   */
  async analyzeSentiment(texts) {
    const input = await this.preprocessInput(texts);
    const predictions = await this.predict(input);
    input.dispose();
    
    return predictions;
  }

  /**
   * Train with labeled sentiment data
   */
  async trainWithSentiments(texts, sentiments, validationSplit = 0.2, config = {}) {
    // Convert sentiment labels to indices
    const labelMap = { 'negative': 0, 'neutral': 1, 'positive': 2 };
    const labels = sentiments.map(s => {
      if (typeof s === 'string') {
        return labelMap[s.toLowerCase()] || 1;
      }
      return s;
    });
    
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

module.exports = SentimentAnalysisModel;