const tf = require('@tensorflow/tfjs-node');
const BaseModel = require('./BaseModel');
const logger = require('../../utils/logger');

/**
 * QualityScoringModel - Neural model for document quality assessment
 */
class QualityScoringModel extends BaseModel {
  constructor(config = {}) {
    super({
      ...config,
      type: 'quality_scoring'
    });
    
    this.maxLength = config.maxLength || 1000;
    this.vocabSize = config.vocabSize || 10000;
    this.qualityDimensions = config.qualityDimensions || [
      'relevance',
      'completeness',
      'accuracy',
      'clarity',
      'coherence'
    ];
    this.numDimensions = this.qualityDimensions.length;
  }

  /**
   * Build the model architecture
   */
  async buildModel() {
    // Text input
    const textInput = tf.input({ shape: [this.maxLength], name: 'text_input' });
    
    // Metadata input (length, complexity, etc.)
    const metaInput = tf.input({ shape: [10], name: 'meta_input' });
    
    // Text processing branch
    const embedding = tf.layers.embedding({
      inputDim: this.vocabSize,
      outputDim: 128,
      inputLength: this.maxLength
    }).apply(textInput);
    
    // Multi-scale CNN for feature extraction
    const conv1 = tf.layers.conv1d({
      filters: 100,
      kernelSize: 3,
      activation: 'relu',
      padding: 'same'
    }).apply(embedding);
    
    const conv2 = tf.layers.conv1d({
      filters: 100,
      kernelSize: 4,
      activation: 'relu',
      padding: 'same'
    }).apply(embedding);
    
    const conv3 = tf.layers.conv1d({
      filters: 100,
      kernelSize: 5,
      activation: 'relu',
      padding: 'same'
    }).apply(embedding);
    
    // Max pooling
    const pool1 = tf.layers.globalMaxPooling1d().apply(conv1);
    const pool2 = tf.layers.globalMaxPooling1d().apply(conv2);
    const pool3 = tf.layers.globalMaxPooling1d().apply(conv3);
    
    // Concatenate multi-scale features
    const textFeatures = tf.layers.concatenate().apply([pool1, pool2, pool3]);
    
    // Combine with metadata
    const combined = tf.layers.concatenate().apply([textFeatures, metaInput]);
    
    // Dense layers
    const dense1 = tf.layers.dense({
      units: 256,
      activation: 'relu'
    }).apply(combined);
    
    const dropout1 = tf.layers.dropout({ rate: 0.4 }).apply(dense1);
    
    const dense2 = tf.layers.dense({
      units: 128,
      activation: 'relu'
    }).apply(dropout1);
    
    const dropout2 = tf.layers.dropout({ rate: 0.3 }).apply(dense2);
    
    // Multi-output for different quality dimensions
    const outputs = this.qualityDimensions.map(dim => {
      return tf.layers.dense({
        units: 1,
        activation: 'sigmoid',
        name: `${dim}_score`
      }).apply(dropout2);
    });
    
    // Overall quality score
    const overallScore = tf.layers.dense({
      units: 1,
      activation: 'sigmoid',
      name: 'overall_score'
    }).apply(dropout2);
    
    // Add overall score to outputs
    outputs.push(overallScore);
    
    // Create model
    this.model = tf.model({
      inputs: [textInput, metaInput],
      outputs: outputs,
      name: 'quality_scoring_model'
    });
    
    // Compile with multiple losses
    const losses = {};
    this.qualityDimensions.forEach(dim => {
      losses[`${dim}_score`] = 'binaryCrossentropy';
    });
    losses['overall_score'] = 'binaryCrossentropy';
    
    this.model.compile({
      optimizer: tf.train.adam(0.001),
      loss: losses,
      metrics: ['accuracy']
    });
    
    logger.info('Quality scoring model built', {
      dimensions: this.qualityDimensions
    });
  }

  /**
   * Extract metadata features from text
   */
  extractMetadata(text) {
    const words = text.split(/\s+/);
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const paragraphs = text.split(/\n\n+/).filter(p => p.trim().length > 0);
    
    return [
      words.length / 1000,                    // Word count (normalized)
      sentences.length / 100,                 // Sentence count (normalized)
      paragraphs.length / 10,                 // Paragraph count (normalized)
      words.length / sentences.length / 20,   // Avg words per sentence (normalized)
      text.length / words.length / 10,        // Avg word length (normalized)
      (text.match(/[A-Z]/g) || []).length / text.length,  // Capitalization ratio
      (text.match(/[0-9]/g) || []).length / text.length,  // Numeric ratio
      (text.match(/[^\w\s]/g) || []).length / text.length, // Punctuation ratio
      this.calculateReadability(text) / 100,  // Readability score (normalized)
      this.calculateLexicalDiversity(words)   // Lexical diversity
    ];
  }

  /**
   * Calculate readability score (simplified Flesch score)
   */
  calculateReadability(text) {
    const words = text.split(/\s+/);
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const syllables = words.reduce((sum, word) => {
      return sum + this.countSyllables(word);
    }, 0);
    
    const avgWordsPerSentence = words.length / sentences.length;
    const avgSyllablesPerWord = syllables / words.length;
    
    // Flesch Reading Ease formula
    const score = 206.835 - 1.015 * avgWordsPerSentence - 84.6 * avgSyllablesPerWord;
    return Math.max(0, Math.min(100, score));
  }

  /**
   * Count syllables in a word (approximation)
   */
  countSyllables(word) {
    word = word.toLowerCase();
    let count = 0;
    const vowels = 'aeiouy';
    let previousWasVowel = false;
    
    for (let i = 0; i < word.length; i++) {
      const isVowel = vowels.includes(word[i]);
      if (isVowel && !previousWasVowel) {
        count++;
      }
      previousWasVowel = isVowel;
    }
    
    // Adjust for silent e
    if (word.endsWith('e')) {
      count--;
    }
    
    // Ensure at least 1 syllable
    return Math.max(1, count);
  }

  /**
   * Calculate lexical diversity
   */
  calculateLexicalDiversity(words) {
    const uniqueWords = new Set(words.map(w => w.toLowerCase()));
    return uniqueWords.size / words.length;
  }

  /**
   * Preprocess input
   */
  async preprocessInput(texts) {
    if (!Array.isArray(texts)) {
      texts = [texts];
    }
    
    // Process text
    const textSequences = texts.map(text => {
      const words = text.toLowerCase().split(/\s+/);
      const tokens = words.map(word => {
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
    
    // Extract metadata
    const metadata = texts.map(text => this.extractMetadata(text));
    
    return {
      text: tf.tensor2d(textSequences),
      metadata: tf.tensor2d(metadata)
    };
  }

  /**
   * Score document quality
   */
  async scoreQuality(document) {
    const input = await this.preprocessInput(document);
    const predictions = this.model.predict([input.text, input.metadata]);
    
    const scores = {};
    let results;
    
    if (Array.isArray(predictions)) {
      // Multi-output model
      for (let i = 0; i < this.qualityDimensions.length; i++) {
        const score = await predictions[i].array();
        scores[this.qualityDimensions[i]] = score[0][0];
        predictions[i].dispose();
      }
      
      // Overall score
      const overallArray = await predictions[predictions.length - 1].array();
      scores.overall = overallArray[0][0];
      predictions[predictions.length - 1].dispose();
    } else {
      // Single output
      const scoreArray = await predictions.array();
      scores.overall = scoreArray[0][0];
      predictions.dispose();
    }
    
    // Calculate quality level
    const overallScore = scores.overall || Object.values(scores).reduce((a, b) => a + b, 0) / Object.keys(scores).length;
    
    results = {
      scores,
      overallScore,
      qualityLevel: this.getQualityLevel(overallScore),
      recommendations: this.generateRecommendations(scores)
    };
    
    // Clean up
    input.text.dispose();
    input.metadata.dispose();
    
    return results;
  }

  /**
   * Get quality level from score
   */
  getQualityLevel(score) {
    if (score >= 0.9) return 'excellent';
    if (score >= 0.7) return 'good';
    if (score >= 0.5) return 'fair';
    if (score >= 0.3) return 'poor';
    return 'very poor';
  }

  /**
   * Generate improvement recommendations
   */
  generateRecommendations(scores) {
    const recommendations = [];
    
    Object.entries(scores).forEach(([dimension, score]) => {
      if (score < 0.7 && dimension !== 'overall') {
        switch (dimension) {
        case 'relevance':
          recommendations.push('Improve content relevance by focusing on main topics');
          break;
        case 'completeness':
          recommendations.push('Add more comprehensive information and details');
          break;
        case 'accuracy':
          recommendations.push('Verify facts and fix any inaccuracies');
          break;
        case 'clarity':
          recommendations.push('Simplify language and improve sentence structure');
          break;
        case 'coherence':
          recommendations.push('Improve logical flow and transitions between ideas');
          break;
        }
      }
    });
    
    return recommendations;
  }

  /**
   * Train with quality-labeled data
   */
  async trainWithQualityLabels(documents, qualityLabels, config = {}) {
    const input = await this.preprocessInput(documents);
    
    // Prepare labels for multi-output
    const labels = [];
    this.qualityDimensions.forEach((dim, _idx) => {
      labels.push(tf.tensor2d(qualityLabels.map(label => [label[dim] || 0])));
    });
    
    // Overall score
    labels.push(tf.tensor2d(qualityLabels.map(label => [label.overall || 0])));
    
    const history = await this.model.fit(
      [input.text, input.metadata],
      labels,
      {
        batchSize: config.batchSize || 32,
        epochs: config.epochs || 30,
        validationSplit: config.validationSplit || 0.2,
        callbacks: config.callbacks || []
      }
    );
    
    // Clean up
    input.text.dispose();
    input.metadata.dispose();
    labels.forEach(label => label.dispose());
    
    return history;
  }
}

module.exports = QualityScoringModel;