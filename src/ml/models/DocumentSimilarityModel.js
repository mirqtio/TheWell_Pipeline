const tf = require('@tensorflow/tfjs-node');
const BaseModel = require('./BaseModel');
const logger = require('../../utils/logger');

/**
 * DocumentSimilarityModel - Neural model for document similarity and retrieval
 */
class DocumentSimilarityModel extends BaseModel {
  constructor(config = {}) {
    super({
      ...config,
      type: 'similarity'
    });
    
    this.embeddingDim = config.embeddingDim || 256;
    this.maxLength = config.maxLength || 512;
    this.vocabSize = config.vocabSize || 10000;
    this.margin = config.margin || 0.2;
    this.similarityThreshold = config.similarityThreshold || 0.7;
  }

  /**
   * Build the model architecture - Siamese network for similarity learning
   */
  async buildModel() {
    // Shared encoder network
    const encoderInput = tf.input({ shape: [this.maxLength] });
    
    const embedding = tf.layers.embedding({
      inputDim: this.vocabSize,
      outputDim: 128,
      inputLength: this.maxLength
    });
    
    const conv1 = tf.layers.conv1d({
      filters: 64,
      kernelSize: 3,
      activation: 'relu',
      padding: 'same'
    });
    
    const pool1 = tf.layers.maxPooling1d({ poolSize: 2 });
    
    const conv2 = tf.layers.conv1d({
      filters: 128,
      kernelSize: 3,
      activation: 'relu',
      padding: 'same'
    });
    
    const globalPool = tf.layers.globalMaxPooling1d();
    
    const dense1 = tf.layers.dense({
      units: 256,
      activation: 'relu'
    });
    
    const dropout = tf.layers.dropout({ rate: 0.3 });
    
    const encoderOutput = tf.layers.dense({
      units: this.embeddingDim,
      activation: null,
      name: 'document_embedding'
    });
    
    // Build encoder
    const embedded = embedding.apply(encoderInput);
    const conv1Out = conv1.apply(embedded);
    const pool1Out = pool1.apply(conv1Out);
    const conv2Out = conv2.apply(pool1Out);
    const pooled = globalPool.apply(conv2Out);
    const dense1Out = dense1.apply(pooled);
    const dropped = dropout.apply(dense1Out);
    const encoded = encoderOutput.apply(dropped);
    
    // L2 normalize embeddings
    const normalized = tf.layers.lambda({
      outputShape: [this.embeddingDim]
    }).apply(encoded);
    
    this.encoder = tf.model({
      inputs: encoderInput,
      outputs: normalized,
      name: 'document_encoder'
    });
    
    // Siamese network for training
    const input1 = tf.input({ shape: [this.maxLength], name: 'doc1' });
    const input2 = tf.input({ shape: [this.maxLength], name: 'doc2' });
    
    const encoded1 = this.encoder.apply(input1);
    const encoded2 = this.encoder.apply(input2);
    
    // Compute similarity
    const similarity = tf.layers.dot({
      axes: 1,
      normalize: true
    }).apply([encoded1, encoded2]);
    
    this.model = tf.model({
      inputs: [input1, input2],
      outputs: similarity,
      name: 'siamese_network'
    });
    
    // Compile with contrastive loss
    this.model.compile({
      optimizer: tf.train.adam(0.001),
      loss: this.contrastiveLoss.bind(this)
    });
    
    logger.info('Document similarity model built', {
      embeddingDim: this.embeddingDim
    });
  }

  /**
   * Contrastive loss for similarity learning
   */
  contrastiveLoss(yTrue, yPred) {
    const squaredPred = tf.square(yPred);
    const squaredMargin = tf.square(tf.maximum(0, tf.sub(this.margin, yPred)));
    const loss = tf.mean(
      tf.add(
        tf.mul(yTrue, squaredPred),
        tf.mul(tf.sub(1, yTrue), squaredMargin)
      )
    );
    return loss;
  }

  /**
   * Encode documents to embeddings
   */
  async encodeDocuments(documents) {
    const input = await this.preprocessInput(documents);
    const embeddings = this.encoder.predict(input);
    const embeddingArray = await embeddings.array();
    
    input.dispose();
    embeddings.dispose();
    
    return embeddingArray;
  }

  /**
   * Compute similarity between two documents
   */
  async computeSimilarity(doc1, doc2) {
    const embeddings = await this.encodeDocuments([doc1, doc2]);
    
    // Cosine similarity
    const similarity = this.cosineSimilarity(embeddings[0], embeddings[1]);
    
    return {
      similarity,
      isSimilar: similarity >= this.similarityThreshold,
      confidence: Math.abs(similarity)
    };
  }

  /**
   * Find similar documents
   */
  async findSimilarDocuments(queryDoc, candidateDocs, topK = 5) {
    const queryEmbedding = await this.encodeDocuments([queryDoc]);
    const candidateEmbeddings = await this.encodeDocuments(candidateDocs);
    
    const similarities = candidateEmbeddings.map((embedding, idx) => ({
      index: idx,
      document: candidateDocs[idx],
      similarity: this.cosineSimilarity(queryEmbedding[0], embedding)
    }));
    
    // Sort by similarity
    similarities.sort((a, b) => b.similarity - a.similarity);
    
    return {
      query: queryDoc,
      similar: similarities.slice(0, topK),
      allSimilarities: similarities
    };
  }

  /**
   * Cluster documents by similarity
   */
  async clusterDocuments(documents, threshold = 0.7) {
    const embeddings = await this.encodeDocuments(documents);
    const clusters = [];
    const assigned = new Set();
    
    for (let i = 0; i < embeddings.length; i++) {
      if (assigned.has(i)) continue;
      
      const cluster = {
        id: clusters.length,
        centroid: i,
        members: [i],
        documents: [documents[i]]
      };
      
      assigned.add(i);
      
      // Find similar documents
      for (let j = i + 1; j < embeddings.length; j++) {
        if (assigned.has(j)) continue;
        
        const similarity = this.cosineSimilarity(embeddings[i], embeddings[j]);
        if (similarity >= threshold) {
          cluster.members.push(j);
          cluster.documents.push(documents[j]);
          assigned.add(j);
        }
      }
      
      clusters.push(cluster);
    }
    
    return clusters;
  }

  /**
   * Compute cosine similarity
   */
  cosineSimilarity(vec1, vec2) {
    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;
    
    for (let i = 0; i < vec1.length; i++) {
      dotProduct += vec1[i] * vec2[i];
      norm1 += vec1[i] * vec1[i];
      norm2 += vec2[i] * vec2[i];
    }
    
    norm1 = Math.sqrt(norm1);
    norm2 = Math.sqrt(norm2);
    
    if (norm1 === 0 || norm2 === 0) return 0;
    
    return dotProduct / (norm1 * norm2);
  }

  /**
   * Train with document pairs
   */
  async trainWithPairs(docPairs, labels, config = {}) {
    const doc1Batch = docPairs.map(pair => pair[0]);
    const doc2Batch = docPairs.map(pair => pair[1]);
    
    const input1 = await this.preprocessInput(doc1Batch);
    const input2 = await this.preprocessInput(doc2Batch);
    const labelTensor = tf.tensor1d(labels);
    
    const history = await this.model.fit(
      [input1, input2],
      labelTensor,
      {
        batchSize: config.batchSize || 32,
        epochs: config.epochs || 20,
        validationSplit: config.validationSplit || 0.2,
        callbacks: config.callbacks || []
      }
    );
    
    // Clean up
    input1.dispose();
    input2.dispose();
    labelTensor.dispose();
    
    return history;
  }

  /**
   * Generate training pairs from documents
   */
  async generateTrainingPairs(documents, numPairs = 1000) {
    const pairs = [];
    const labels = [];
    
    // Generate positive pairs (similar documents)
    for (let i = 0; i < numPairs / 2; i++) {
      const idx = Math.floor(Math.random() * documents.length);
      const doc = documents[idx];
      
      // Create augmented version (simplified)
      const augmented = doc.split(' ')
        .sort(() => Math.random() - 0.5)
        .join(' ');
      
      pairs.push([doc, augmented]);
      labels.push(1);
    }
    
    // Generate negative pairs (dissimilar documents)
    for (let i = 0; i < numPairs / 2; i++) {
      const idx1 = Math.floor(Math.random() * documents.length);
      const idx2 = Math.floor(Math.random() * documents.length);
      
      if (idx1 !== idx2) {
        pairs.push([documents[idx1], documents[idx2]]);
        labels.push(0);
      }
    }
    
    return { pairs, labels };
  }
}

module.exports = DocumentSimilarityModel;