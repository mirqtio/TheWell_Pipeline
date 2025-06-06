const tf = require('@tensorflow/tfjs-node');
const natural = require('natural');
const logger = require('../utils/logger');

/**
 * FeatureEngineering - Comprehensive feature engineering pipeline
 */
class FeatureEngineering {
  constructor(config = {}) {
    this.config = {
      maxVocabSize: config.maxVocabSize || 10000,
      maxSequenceLength: config.maxSequenceLength || 500,
      embeddingDim: config.embeddingDim || 100,
      ngramRange: config.ngramRange || [1, 2],
      minDocFrequency: config.minDocFrequency || 2,
      maxDocFrequency: config.maxDocFrequency || 0.95,
      ...config
    };
    
    // Initialize NLP tools
    this.tokenizer = new natural.WordTokenizer();
    this.stemmer = natural.PorterStemmer;
    this.tfidf = new natural.TfIdf();
    this.stopwords = new Set(natural.stopwords);
    
    // Feature extractors
    this.vocabulary = new Map();
    this.idfWeights = new Map();
    this.featureStats = {};
  }

  /**
   * Text preprocessing pipeline
   */
  preprocessText(text, options = {}) {
    const {
      lowercase = true,
      removeStopwords = true,
      stem = false,
      removeNumbers = false,
      removePunctuation = false,
      minWordLength = 2
    } = options;
    
    // Basic cleaning
    let processed = text;
    
    if (lowercase) {
      processed = processed.toLowerCase();
    }
    
    if (removeNumbers) {
      processed = processed.replace(/\d+/g, ' ');
    }
    
    if (removePunctuation) {
      processed = processed.replace(/[^\w\s]/g, ' ');
    }
    
    // Tokenize
    let tokens = this.tokenizer.tokenize(processed);
    
    // Filter tokens
    tokens = tokens.filter(token => {
      if (token.length < minWordLength) return false;
      if (removeStopwords && this.stopwords.has(token.toLowerCase())) return false;
      return true;
    });
    
    // Stem if requested
    if (stem) {
      tokens = tokens.map(token => this.stemmer.stem(token));
    }
    
    return {
      original: text,
      processed: tokens.join(' '),
      tokens
    };
  }

  /**
   * Build vocabulary from corpus
   */
  buildVocabulary(documents, options = {}) {
    const wordCounts = new Map();
    const docFrequency = new Map();
    const totalDocs = documents.length;
    
    // Count word occurrences
    documents.forEach(doc => {
      const { tokens } = this.preprocessText(doc, options);
      const seenInDoc = new Set();
      
      tokens.forEach(token => {
        wordCounts.set(token, (wordCounts.get(token) || 0) + 1);
        
        if (!seenInDoc.has(token)) {
          docFrequency.set(token, (docFrequency.get(token) || 0) + 1);
          seenInDoc.add(token);
        }
      });
    });
    
    // Filter vocabulary
    let vocabIndex = 1; // Reserve 0 for padding
    for (const [word, count] of wordCounts) {
      const df = docFrequency.get(word) / totalDocs;
      
      if (count >= this.config.minDocFrequency && 
          df <= this.config.maxDocFrequency &&
          vocabIndex < this.config.maxVocabSize) {
        this.vocabulary.set(word, vocabIndex);
        this.idfWeights.set(word, Math.log(totalDocs / docFrequency.get(word)));
        vocabIndex++;
      }
    }
    
    logger.info(`Vocabulary built: ${this.vocabulary.size} words`);
    
    return {
      vocabularySize: this.vocabulary.size,
      totalWords: wordCounts.size,
      filtered: wordCounts.size - this.vocabulary.size
    };
  }

  /**
   * Extract TF-IDF features
   */
  extractTFIDF(documents, options = {}) {
    const features = [];
    
    documents.forEach(doc => {
      const { tokens } = this.preprocessText(doc, options);
      const tf = new Map();
      const totalTokens = tokens.length;
      
      // Calculate term frequency
      tokens.forEach(token => {
        tf.set(token, (tf.get(token) || 0) + 1);
      });
      
      // Calculate TF-IDF vector
      const vector = new Array(this.vocabulary.size + 1).fill(0);
      
      for (const [word, freq] of tf) {
        const index = this.vocabulary.get(word);
        if (index) {
          const tfScore = freq / totalTokens;
          const idfScore = this.idfWeights.get(word) || 0;
          vector[index] = tfScore * idfScore;
        }
      }
      
      features.push(vector);
    });
    
    return tf.tensor2d(features);
  }

  /**
   * Extract word embeddings
   */
  async extractWordEmbeddings(documents, embeddingModel = null) {
    const sequences = [];
    
    documents.forEach(doc => {
      const { tokens } = this.preprocessText(doc);
      const sequence = tokens.map(token => this.vocabulary.get(token) || 0);
      
      // Pad or truncate
      if (sequence.length > this.config.maxSequenceLength) {
        sequences.push(sequence.slice(0, this.config.maxSequenceLength));
      } else {
        const padded = new Array(this.config.maxSequenceLength).fill(0);
        sequence.forEach((val, idx) => {
          padded[idx] = val;
        });
        sequences.push(padded);
      }
    });
    
    const sequenceTensor = tf.tensor2d(sequences);
    
    // If embedding model provided, use it
    if (embeddingModel) {
      return embeddingModel.predict(sequenceTensor);
    }
    
    return sequenceTensor;
  }

  /**
   * Extract n-gram features
   */
  extractNGrams(documents, options = {}) {
    const [minN, maxN] = this.config.ngramRange;
    const ngramCounts = new Map();
    
    documents.forEach(doc => {
      const { tokens } = this.preprocessText(doc, options);
      
      for (let n = minN; n <= maxN; n++) {
        for (let i = 0; i <= tokens.length - n; i++) {
          const ngram = tokens.slice(i, i + n).join(' ');
          ngramCounts.set(ngram, (ngramCounts.get(ngram) || 0) + 1);
        }
      }
    });
    
    // Select top n-grams
    const sortedNgrams = Array.from(ngramCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 1000);
    
    const ngramIndex = new Map(sortedNgrams.map(([ngram], idx) => [ngram, idx]));
    
    // Create feature vectors
    const features = documents.map(doc => {
      const { tokens } = this.preprocessText(doc, options);
      const vector = new Array(ngramIndex.size).fill(0);
      
      for (let n = minN; n <= maxN; n++) {
        for (let i = 0; i <= tokens.length - n; i++) {
          const ngram = tokens.slice(i, i + n).join(' ');
          const idx = ngramIndex.get(ngram);
          if (idx !== undefined) {
            vector[idx]++;
          }
        }
      }
      
      return vector;
    });
    
    return {
      features: tf.tensor2d(features),
      ngramVocab: ngramIndex
    };
  }

  /**
   * Extract statistical features
   */
  extractStatisticalFeatures(documents) {
    const features = documents.map(doc => {
      const words = doc.split(/\s+/);
      const sentences = doc.split(/[.!?]+/).filter(s => s.trim().length > 0);
      const paragraphs = doc.split(/\n\n+/).filter(p => p.trim().length > 0);
      
      // Basic statistics
      const avgWordLength = words.reduce((sum, word) => sum + word.length, 0) / words.length;
      const avgSentenceLength = words.length / sentences.length;
      
      // Lexical diversity
      const uniqueWords = new Set(words.map(w => w.toLowerCase()));
      const lexicalDiversity = uniqueWords.size / words.length;
      
      // Readability features
      const syllableCount = words.reduce((sum, word) => sum + this.countSyllables(word), 0);
      const avgSyllablesPerWord = syllableCount / words.length;
      
      // Character-based features
      const upperCaseRatio = (doc.match(/[A-Z]/g) || []).length / doc.length;
      const digitRatio = (doc.match(/[0-9]/g) || []).length / doc.length;
      const punctuationRatio = (doc.match(/[^\w\s]/g) || []).length / doc.length;
      
      return [
        words.length,
        sentences.length,
        paragraphs.length,
        avgWordLength,
        avgSentenceLength,
        lexicalDiversity,
        avgSyllablesPerWord,
        upperCaseRatio,
        digitRatio,
        punctuationRatio
      ];
    });
    
    return tf.tensor2d(features);
  }

  /**
   * Count syllables (approximation)
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
    
    if (word.endsWith('e')) {
      count--;
    }
    
    return Math.max(1, count);
  }

  /**
   * Feature selection using variance threshold
   */
  selectFeaturesByVariance(features, threshold = 0.01) {
    const variances = tf.moments(features, 0).variance;
    const varianceArray = variances.arraySync();
    
    const selectedIndices = [];
    varianceArray.forEach((variance, idx) => {
      if (variance > threshold) {
        selectedIndices.push(idx);
      }
    });
    
    const selectedFeatures = tf.gather(features, selectedIndices, 1);
    
    logger.info(`Selected ${selectedIndices.length} features out of ${varianceArray.length}`);
    
    return {
      features: selectedFeatures,
      selectedIndices,
      variances: varianceArray
    };
  }

  /**
   * Dimensionality reduction using PCA
   */
  async reduceDimensionsPCA(features, nComponents = 50) {
    // Center the data
    const mean = tf.mean(features, 0);
    const centered = tf.sub(features, mean);
    
    // Compute covariance matrix
    const transposed = tf.transpose(centered);
    const covariance = tf.matMul(transposed, centered);
    const covDiv = tf.div(covariance, tf.scalar(features.shape[0] - 1));
    
    // Compute eigenvalues and eigenvectors
    const { values, vectors } = await tf.linalg.eigh(covDiv);
    
    // Sort by eigenvalues (descending)
    const valueArray = await values.array();
    const indices = valueArray
      .map((val, idx) => ({ val, idx }))
      .sort((a, b) => b.val - a.val)
      .slice(0, nComponents)
      .map(item => item.idx);
    
    // Select top eigenvectors
    const selectedVectors = tf.gather(vectors, indices, 1);
    
    // Project data
    const reduced = tf.matMul(centered, selectedVectors);
    
    // Clean up
    mean.dispose();
    centered.dispose();
    transposed.dispose();
    covariance.dispose();
    covDiv.dispose();
    values.dispose();
    vectors.dispose();
    
    return {
      features: reduced,
      components: selectedVectors,
      explainedVariance: valueArray.slice(0, nComponents)
    };
  }

  /**
   * Data augmentation for text
   */
  augmentTextData(documents, augmentations = ['synonym', 'noise']) {
    const augmented = [];
    
    documents.forEach(doc => {
      augmented.push(doc); // Original
      
      if (augmentations.includes('synonym')) {
        augmented.push(this.synonymReplacement(doc));
      }
      
      if (augmentations.includes('noise')) {
        augmented.push(this.addNoise(doc));
      }
      
      if (augmentations.includes('shuffle')) {
        augmented.push(this.shuffleSentences(doc));
      }
    });
    
    return augmented;
  }

  /**
   * Synonym replacement augmentation
   */
  synonymReplacement(text, replacementRate = 0.1) {
    const { tokens } = this.preprocessText(text, { lowercase: false });
    const numReplacements = Math.floor(tokens.length * replacementRate);
    
    const modifiedTokens = [...tokens];
    const indices = new Set();
    
    // Select random indices to replace
    while (indices.size < numReplacements) {
      indices.add(Math.floor(Math.random() * tokens.length));
    }
    
    // Replace with synonyms (simplified - would use WordNet in production)
    indices.forEach(idx => {
      const word = modifiedTokens[idx];
      // Simple replacement logic
      if (word.length > 3) {
        modifiedTokens[idx] = word + '_syn';
      }
    });
    
    return modifiedTokens.join(' ');
  }

  /**
   * Add noise augmentation
   */
  addNoise(text, noiseLevel = 0.05) {
    const chars = text.split('');
    const numChanges = Math.floor(chars.length * noiseLevel);
    
    for (let i = 0; i < numChanges; i++) {
      const idx = Math.floor(Math.random() * chars.length);
      const changeType = Math.random();
      
      if (changeType < 0.33) {
        // Delete
        chars.splice(idx, 1);
      } else if (changeType < 0.66) {
        // Insert
        const randomChar = String.fromCharCode(97 + Math.floor(Math.random() * 26));
        chars.splice(idx, 0, randomChar);
      } else {
        // Swap
        if (idx < chars.length - 1) {
          [chars[idx], chars[idx + 1]] = [chars[idx + 1], chars[idx]];
        }
      }
    }
    
    return chars.join('');
  }

  /**
   * Shuffle sentences augmentation
   */
  shuffleSentences(text) {
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const shuffled = [...sentences].sort(() => Math.random() - 0.5);
    return shuffled.join('. ') + '.';
  }

  /**
   * Create feature pipeline
   */
  createFeaturePipeline(config = {}) {
    const pipeline = {
      steps: [],
      
      addStep(name, fn) {
        this.steps.push({ name, fn });
        return this;
      },
      
      async execute(data) {
        let result = data;
        
        for (const step of this.steps) {
          logger.info(`Executing feature pipeline step: ${step.name}`);
          result = await step.fn(result);
        }
        
        return result;
      }
    };
    
    // Add default steps based on config
    if (config.preprocessing) {
      pipeline.addStep('preprocessing', (docs) => 
        docs.map(doc => this.preprocessText(doc, config.preprocessing).processed)
      );
    }
    
    if (config.tfidf) {
      pipeline.addStep('tfidf', (docs) => 
        this.extractTFIDF(docs, config.tfidf)
      );
    }
    
    if (config.statistical) {
      pipeline.addStep('statistical', (docs) => 
        this.extractStatisticalFeatures(docs)
      );
    }
    
    return pipeline;
  }

  /**
   * Save feature configuration
   */
  saveFeatureConfig() {
    return {
      vocabulary: Array.from(this.vocabulary.entries()),
      idfWeights: Array.from(this.idfWeights.entries()),
      config: this.config,
      stats: this.featureStats
    };
  }

  /**
   * Load feature configuration
   */
  loadFeatureConfig(config) {
    this.vocabulary = new Map(config.vocabulary);
    this.idfWeights = new Map(config.idfWeights);
    this.config = { ...this.config, ...config.config };
    this.featureStats = config.stats || {};
  }
}

module.exports = FeatureEngineering;