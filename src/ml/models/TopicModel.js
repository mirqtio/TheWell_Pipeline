const tf = require('@tensorflow/tfjs-node');
const BaseModel = require('./BaseModel');
const logger = require('../../utils/logger');

/**
 * TopicModel - Topic modeling using neural topic modeling approach
 * (Neural alternative to LDA)
 */
class TopicModel extends BaseModel {
  constructor(config = {}) {
    super({
      ...config,
      type: 'topic_modeling'
    });
    
    this.numTopics = config.numTopics || 10;
    this.vocabSize = config.vocabSize || 5000;
    this.hiddenSize = config.hiddenSize || 100;
    this.vocabulary = config.vocabulary || [];
    this.topicNames = config.topicNames || [];
  }

  /**
   * Build the model architecture - Variational Autoencoder for topic modeling
   */
  async buildModel() {
    // Encoder
    const encoderInput = tf.input({ shape: [this.vocabSize] });
    
    const encoderHidden = tf.layers.dense({
      units: this.hiddenSize,
      activation: 'relu'
    }).apply(encoderInput);
    
    const encoderDropout = tf.layers.dropout({ rate: 0.2 }).apply(encoderHidden);
    
    // Latent space (topics)
    const zMean = tf.layers.dense({
      units: this.numTopics,
      name: 'z_mean'
    }).apply(encoderDropout);
    
    const zLogVar = tf.layers.dense({
      units: this.numTopics,
      name: 'z_log_var'
    }).apply(encoderDropout);
    
    // Sampling layer
    const sampling = tf.layers.lambda({
      outputShape: [this.numTopics],
      name: 'sampling'
    }).apply([zMean, zLogVar]);
    
    // Decoder
    const decoderHidden = tf.layers.dense({
      units: this.hiddenSize,
      activation: 'relu'
    }).apply(sampling);
    
    const decoderOutput = tf.layers.dense({
      units: this.vocabSize,
      activation: 'softmax',
      name: 'decoder_output'
    }).apply(decoderHidden);
    
    // Create models
    this.encoder = tf.model({
      inputs: encoderInput,
      outputs: [zMean, zLogVar, sampling]
    });
    
    this.decoder = tf.model({
      inputs: sampling,
      outputs: decoderOutput
    });
    
    this.model = tf.model({
      inputs: encoderInput,
      outputs: decoderOutput
    });
    
    // Custom loss function for VAE
    const vaeoss = (yTrue, yPred) => {
      // Reconstruction loss
      const reconstruction = tf.losses.categoricalCrossentropy(yTrue, yPred);
      
      // KL divergence loss
      const klLoss = tf.mul(-0.5, tf.sum(
        tf.add(1, tf.sub(zLogVar, tf.add(tf.square(zMean), tf.exp(zLogVar)))),
        1
      ));
      
      return tf.mean(tf.add(reconstruction, klLoss));
    };
    
    this.model.compile({
      optimizer: tf.train.adam(0.001),
      loss: 'categoricalCrossentropy' // Simplified for now
    });
    
    logger.info('Topic model built', {
      numTopics: this.numTopics,
      vocabSize: this.vocabSize
    });
  }

  /**
   * Preprocess documents to bag-of-words representation
   */
  async preprocessInput(documents) {
    if (!Array.isArray(documents)) {
      documents = [documents];
    }
    
    const bowVectors = documents.map(doc => {
      const words = doc.toLowerCase().split(/\s+/);
      const vector = new Array(this.vocabSize).fill(0);
      
      words.forEach(word => {
        // Hash word to index
        let hash = 0;
        for (let i = 0; i < word.length; i++) {
          hash = ((hash << 5) - hash) + word.charCodeAt(i);
          hash = hash & hash;
        }
        const index = Math.abs(hash) % this.vocabSize;
        vector[index] += 1;
      });
      
      // Normalize
      const sum = vector.reduce((a, b) => a + b, 0) || 1;
      return vector.map(v => v / sum);
    });
    
    return tf.tensor2d(bowVectors);
  }

  /**
   * Extract topics from documents
   */
  async extractTopics(documents) {
    const input = await this.preprocessInput(documents);
    
    // Get topic distributions from encoder
    const [zMean] = this.encoder.predict(input);
    const topicDistributions = await zMean.array();
    
    // Get topic-word distributions
    const topicWordDists = await this.getTopicWordDistributions();
    
    const results = topicDistributions.map((dist, docIdx) => {
      // Normalize to probabilities
      const expDist = dist.map(d => Math.exp(d));
      const sum = expDist.reduce((a, b) => a + b, 0) || 1;
      const probs = expDist.map(d => d / sum);
      
      // Find dominant topics
      const topicScores = probs.map((prob, idx) => ({
        topicId: idx,
        topicName: this.topicNames[idx] || `Topic_${idx}`,
        probability: prob
      })).sort((a, b) => b.probability - a.probability);
      
      return {
        document: documents[docIdx].substring(0, 100) + '...',
        dominantTopic: topicScores[0],
        topTopics: topicScores.slice(0, 3),
        allTopics: topicScores
      };
    });
    
    // Clean up
    input.dispose();
    zMean.dispose();
    
    return results;
  }

  /**
   * Get topic-word distributions
   */
  async getTopicWordDistributions(topK = 10) {
    // Generate topic vectors
    const topicVectors = tf.eye(this.numTopics);
    
    // Decode to get word distributions
    const wordDists = this.decoder.predict(topicVectors);
    const distributions = await wordDists.array();
    
    const topics = distributions.map((dist, topicIdx) => {
      // Get top words for each topic
      const wordScores = dist.map((score, wordIdx) => ({
        wordIdx,
        word: this.vocabulary[wordIdx] || `word_${wordIdx}`,
        score
      })).sort((a, b) => b.score - a.score);
      
      return {
        topicId: topicIdx,
        topicName: this.topicNames[topicIdx] || `Topic_${topicIdx}`,
        topWords: wordScores.slice(0, topK),
        coherence: this.calculateCoherence(wordScores.slice(0, topK))
      };
    });
    
    // Clean up
    topicVectors.dispose();
    wordDists.dispose();
    
    return topics;
  }

  /**
   * Calculate topic coherence (simplified)
   */
  calculateCoherence(topWords) {
    // Simple coherence based on probability mass of top words
    const totalScore = topWords.reduce((sum, word) => sum + word.score, 0);
    return totalScore;
  }

  /**
   * Train the topic model
   */
  async trainTopicModel(documents, config = {}) {
    const input = await this.preprocessInput(documents);
    
    // For VAE, input is also the target
    const history = await this.model.fit(input, input, {
      batchSize: config.batchSize || 32,
      epochs: config.epochs || 50,
      validationSplit: config.validationSplit || 0.1,
      callbacks: config.callbacks || []
    });
    
    input.dispose();
    
    return history;
  }

  /**
   * Update topic names based on top words
   */
  async inferTopicNames() {
    const topics = await this.getTopicWordDistributions(5);
    
    this.topicNames = topics.map(topic => {
      const topWords = topic.topWords.map(w => w.word).slice(0, 3);
      return topWords.join('_');
    });
    
    return this.topicNames;
  }
}

module.exports = TopicModel;