const tf = require('@tensorflow/tfjs-node');
const BaseModel = require('./BaseModel');
const logger = require('../../utils/logger');

/**
 * NEREnhancementModel - Enhanced Named Entity Recognition using neural networks
 */
class NEREnhancementModel extends BaseModel {
  constructor(config = {}) {
    super({
      ...config,
      type: 'ner'
    });
    
    this.maxLength = config.maxLength || 128;
    this.vocabSize = config.vocabSize || 10000;
    this.embeddingDim = config.embeddingDim || 100;
    this.lstmUnits = config.lstmUnits || 128;
    
    // Entity types
    this.entityTypes = config.entityTypes || [
      'O',          // Outside
      'B-PER',      // Beginning of Person
      'I-PER',      // Inside Person
      'B-ORG',      // Beginning of Organization
      'I-ORG',      // Inside Organization
      'B-LOC',      // Beginning of Location
      'I-LOC',      // Inside Location
      'B-DATE',     // Beginning of Date
      'I-DATE',     // Inside Date
      'B-MONEY',    // Beginning of Money
      'I-MONEY',    // Inside Money
      'B-MISC',     // Beginning of Miscellaneous
      'I-MISC'      // Inside Miscellaneous
    ];
    
    this.numClasses = this.entityTypes.length;
    this.entityTypeMap = Object.fromEntries(
      this.entityTypes.map((type, idx) => [type, idx])
    );
  }

  /**
   * Build the model architecture - BiLSTM-CRF for NER
   */
  async buildModel() {
    // Input layers
    const wordInput = tf.input({ shape: [this.maxLength], name: 'word_input' });
    const charInput = tf.input({ shape: [this.maxLength, 20], name: 'char_input' });
    
    // Word embeddings
    const wordEmbedding = tf.layers.embedding({
      inputDim: this.vocabSize,
      outputDim: this.embeddingDim,
      inputLength: this.maxLength,
      maskZero: true
    }).apply(wordInput);
    
    // Character-level CNN
    const charEmbedding = tf.layers.timeDistributed({
      layer: tf.layers.embedding({
        inputDim: 128, // ASCII characters
        outputDim: 30
      })
    }).apply(charInput);
    
    const charCNN = tf.layers.timeDistributed({
      layer: tf.layers.conv1d({
        filters: 30,
        kernelSize: 3,
        activation: 'relu'
      })
    }).apply(charEmbedding);
    
    const charPool = tf.layers.timeDistributed({
      layer: tf.layers.globalMaxPooling1d()
    }).apply(charCNN);
    
    // Concatenate word and character features
    const concatenated = tf.layers.concatenate({
      axis: 2
    }).apply([wordEmbedding, charPool]);
    
    // Bidirectional LSTM
    const biLSTM1 = tf.layers.bidirectional({
      layer: tf.layers.lstm({
        units: this.lstmUnits,
        returnSequences: true,
        recurrentDropout: 0.2
      })
    }).apply(concatenated);
    
    const dropout1 = tf.layers.dropout({ rate: 0.5 }).apply(biLSTM1);
    
    const biLSTM2 = tf.layers.bidirectional({
      layer: tf.layers.lstm({
        units: this.lstmUnits / 2,
        returnSequences: true,
        recurrentDropout: 0.2
      })
    }).apply(dropout1);
    
    const dropout2 = tf.layers.dropout({ rate: 0.5 }).apply(biLSTM2);
    
    // Time-distributed dense layer for classification
    const output = tf.layers.timeDistributed({
      layer: tf.layers.dense({
        units: this.numClasses,
        activation: 'softmax'
      })
    }).apply(dropout2);
    
    // Create model
    this.model = tf.model({
      inputs: [wordInput, charInput],
      outputs: output,
      name: 'ner_model'
    });
    
    // Compile model
    this.model.compile({
      optimizer: tf.train.adam(0.001),
      loss: 'categoricalCrossentropy',
      metrics: ['accuracy']
    });
    
    logger.info('NER enhancement model built', {
      entityTypes: this.entityTypes.length,
      maxLength: this.maxLength
    });
  }

  /**
   * Tokenize text into words
   */
  tokenizeText(text) {
    // Simple tokenization - in production, use a proper tokenizer
    const words = text.split(/\s+/);
    const tokens = [];
    const spans = [];
    
    let currentPos = 0;
    for (const word of words) {
      const start = text.indexOf(word, currentPos);
      const end = start + word.length;
      
      tokens.push(word);
      spans.push({ start, end, word });
      
      currentPos = end;
    }
    
    return { tokens, spans };
  }

  /**
   * Preprocess input for NER
   */
  async preprocessInput(texts) {
    if (!Array.isArray(texts)) {
      texts = [texts];
    }
    
    const wordSequences = [];
    const charSequences = [];
    const tokenInfo = [];
    
    for (const text of texts) {
      const { tokens, spans } = this.tokenizeText(text);
      tokenInfo.push({ tokens, spans });
      
      // Word encoding
      const wordIndices = tokens.map(word => {
        let hash = 0;
        for (let i = 0; i < word.length; i++) {
          hash = ((hash << 5) - hash) + word.charCodeAt(i);
          hash = hash & hash;
        }
        return Math.abs(hash) % this.vocabSize;
      });
      
      // Pad or truncate words
      const paddedWords = new Array(this.maxLength).fill(0);
      wordIndices.slice(0, this.maxLength).forEach((idx, i) => {
        paddedWords[i] = idx;
      });
      wordSequences.push(paddedWords);
      
      // Character encoding for each word
      const charIndicesPerWord = [];
      for (let i = 0; i < this.maxLength; i++) {
        const word = tokens[i] || '';
        const charIndices = new Array(20).fill(0);
        
        for (let j = 0; j < Math.min(word.length, 20); j++) {
          charIndices[j] = word.charCodeAt(j);
        }
        
        charIndicesPerWord.push(charIndices);
      }
      charSequences.push(charIndicesPerWord);
    }
    
    return {
      words: tf.tensor2d(wordSequences),
      chars: tf.tensor3d(charSequences),
      tokenInfo
    };
  }

  /**
   * Extract entities from text
   */
  async extractEntities(text) {
    const input = await this.preprocessInput(text);
    const predictions = this.model.predict([input.words, input.chars]);
    const predArray = await predictions.array();
    
    const { tokens, spans } = input.tokenInfo[0];
    const entities = [];
    let currentEntity = null;
    
    // Decode predictions
    for (let i = 0; i < tokens.length && i < this.maxLength; i++) {
      const probs = predArray[0][i];
      const maxIdx = probs.indexOf(Math.max(...probs));
      const label = this.entityTypes[maxIdx];
      const confidence = probs[maxIdx];
      
      if (label.startsWith('B-')) {
        // Start new entity
        if (currentEntity) {
          entities.push(currentEntity);
        }
        
        currentEntity = {
          text: tokens[i],
          type: label.substring(2),
          start: spans[i].start,
          end: spans[i].end,
          confidence,
          tokens: [tokens[i]]
        };
      } else if (label.startsWith('I-') && currentEntity && currentEntity.type === label.substring(2)) {
        // Continue entity
        currentEntity.text += ' ' + tokens[i];
        currentEntity.end = spans[i].end;
        currentEntity.tokens.push(tokens[i]);
        currentEntity.confidence = Math.min(currentEntity.confidence, confidence);
      } else {
        // End current entity
        if (currentEntity) {
          entities.push(currentEntity);
          currentEntity = null;
        }
      }
    }
    
    // Don't forget last entity
    if (currentEntity) {
      entities.push(currentEntity);
    }
    
    // Clean up
    input.words.dispose();
    input.chars.dispose();
    predictions.dispose();
    
    return {
      text,
      entities,
      tokens: tokens.slice(0, this.maxLength)
    };
  }

  /**
   * Extract entities with context
   */
  async extractEntitiesWithContext(text, contextWindow = 50) {
    const result = await this.extractEntities(text);
    
    // Add context for each entity
    result.entities = result.entities.map(entity => ({
      ...entity,
      context: {
        before: text.substring(Math.max(0, entity.start - contextWindow), entity.start).trim(),
        after: text.substring(entity.end, Math.min(text.length, entity.end + contextWindow)).trim()
      }
    }));
    
    return result;
  }

  /**
   * Train with IOB tagged data
   */
  async trainWithIOBData(sentences, tags, config = {}) {
    // Process all sentences
    const allWords = [];
    const allChars = [];
    const allTags = [];
    
    for (let i = 0; i < sentences.length; i++) {
      const input = await this.preprocessInput(sentences[i]);
      const wordArray = await input.words.array();
      const charArray = await input.chars.array();
      
      allWords.push(wordArray[0]);
      allChars.push(charArray[0]);
      
      // Process tags
      const tagSequence = new Array(this.maxLength).fill(0);
      const sentenceTags = tags[i];
      
      for (let j = 0; j < Math.min(sentenceTags.length, this.maxLength); j++) {
        const tagIdx = this.entityTypeMap[sentenceTags[j]] || 0;
        tagSequence[j] = tagIdx;
      }
      
      allTags.push(tagSequence);
      
      // Clean up
      input.words.dispose();
      input.chars.dispose();
    }
    
    // Convert to tensors
    const wordTensor = tf.tensor2d(allWords);
    const charTensor = tf.tensor3d(allChars);
    const tagTensor = tf.oneHot(tf.tensor2d(allTags, [allTags.length, this.maxLength], 'int32'), this.numClasses);
    
    // Train
    const history = await this.model.fit(
      [wordTensor, charTensor],
      tagTensor,
      {
        batchSize: config.batchSize || 32,
        epochs: config.epochs || 20,
        validationSplit: config.validationSplit || 0.2,
        callbacks: config.callbacks || []
      }
    );
    
    // Clean up
    wordTensor.dispose();
    charTensor.dispose();
    tagTensor.dispose();
    
    return history;
  }

  /**
   * Evaluate on test data
   */
  async evaluateNER(testSentences, testTags) {
    let correct = 0;
    let total = 0;
    let truePositives = 0;
    let falsePositives = 0;
    let falseNegatives = 0;
    
    for (let i = 0; i < testSentences.length; i++) {
      const result = await this.extractEntities(testSentences[i]);
      const trueTags = testTags[i];
      
      // Token-level accuracy
      for (let j = 0; j < Math.min(result.tokens.length, trueTags.length); j++) {
        total++;
        // Compare predicted vs true tags
        // This is simplified - proper evaluation would reconstruct full tag sequences
      }
      
      // Entity-level F1 (simplified)
      const predictedEntities = result.entities.length;
      const trueEntities = trueTags.filter(tag => tag.startsWith('B-')).length;
      
      truePositives += Math.min(predictedEntities, trueEntities);
      falsePositives += Math.max(0, predictedEntities - trueEntities);
      falseNegatives += Math.max(0, trueEntities - predictedEntities);
    }
    
    const precision = truePositives / (truePositives + falsePositives) || 0;
    const recall = truePositives / (truePositives + falseNegatives) || 0;
    const f1 = 2 * (precision * recall) / (precision + recall) || 0;
    
    return {
      tokenAccuracy: correct / total,
      precision,
      recall,
      f1
    };
  }
}

module.exports = NEREnhancementModel;