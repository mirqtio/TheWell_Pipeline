/**
 * Embedding Service
 * 
 * Provides text embedding generation using various providers.
 * Supports OpenAI's text-embedding models with caching and error handling.
 */

const logger = require('../utils/logger');

class EmbeddingService {
  constructor(config = {}) {
    this.config = {
      provider: 'openai',
      model: 'text-embedding-ada-002',
      maxRetries: 3,
      timeout: 30000,
      ...config
    };
    
    if (!config.apiKey) {
      throw new Error('API key is required for embedding service');
    }
    
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || 'https://api.openai.com/v1';
    
    // Embedding model specifications
    this.modelSpecs = {
      'text-embedding-ada-002': {
        dimensions: 1536,
        maxTokens: 8191,
        costPer1kTokens: 0.0001
      },
      'text-embedding-3-small': {
        dimensions: 1536,
        maxTokens: 8191,
        costPer1kTokens: 0.00002
      },
      'text-embedding-3-large': {
        dimensions: 3072,
        maxTokens: 8191,
        costPer1kTokens: 0.00013
      }
    };
  }

  /**
   * Generate embedding for a single text
   * @param {string} text - Text to embed
   * @param {Object} options - Optional parameters
   * @returns {Promise<Array>} Embedding vector
   */
  async generateEmbedding(text, options = {}) {
    if (!text || typeof text !== 'string') {
      throw new Error('Text must be a non-empty string');
    }

    const model = options.model || this.config.model;
    const modelSpec = this.modelSpecs[model];
    
    if (!modelSpec) {
      throw new Error(`Unsupported embedding model: ${model}`);
    }

    // Truncate text if it's too long (rough estimate: 1 token ≈ 4 characters)
    const maxChars = modelSpec.maxTokens * 4;
    const truncatedText = text.length > maxChars ? text.substring(0, maxChars) : text;

    try {
      const response = await this.makeEmbeddingRequest({
        model,
        input: truncatedText,
        encoding_format: 'float'
      });

      if (!response.data || !response.data[0] || !response.data[0].embedding) {
        throw new Error('Invalid embedding response format');
      }

      const embedding = response.data[0].embedding;
      
      // Validate embedding dimensions
      if (embedding.length !== modelSpec.dimensions) {
        logger.warn(`Unexpected embedding dimensions: ${embedding.length}, expected: ${modelSpec.dimensions}`);
      }

      return embedding;
    } catch (error) {
      logger.error('Failed to generate embedding:', {
        error: error.message,
        model,
        textLength: text.length
      });
      throw error;
    }
  }

  /**
   * Generate embeddings for multiple texts in batch
   * @param {Array<string>} texts - Array of texts to embed
   * @param {Object} options - Optional parameters
   * @returns {Promise<Array<Array>>} Array of embedding vectors
   */
  async generateBatchEmbeddings(texts, options = {}) {
    if (!Array.isArray(texts) || texts.length === 0) {
      throw new Error('Texts must be a non-empty array');
    }

    const model = options.model || this.config.model;
    const batchSize = options.batchSize || 100; // OpenAI supports up to 2048 inputs
    const results = [];

    // Process in batches
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      
      try {
        const response = await this.makeEmbeddingRequest({
          model,
          input: batch,
          encoding_format: 'float'
        });

        if (!response.data || !Array.isArray(response.data)) {
          throw new Error('Invalid batch embedding response format');
        }

        const batchEmbeddings = response.data.map(item => item.embedding);
        results.push(...batchEmbeddings);
      } catch (error) {
        logger.error('Failed to generate batch embeddings:', {
          error: error.message,
          batchStart: i,
          batchSize: batch.length
        });
        throw error;
      }
    }

    return results;
  }

  /**
   * Get embedding dimensions for a model
   * @param {string} model - Model name
   * @returns {number} Embedding dimensions
   */
  getEmbeddingDimensions(model = null) {
    const targetModel = model || this.config.model;
    const spec = this.modelSpecs[targetModel];
    
    if (!spec) {
      throw new Error(`Unknown model: ${targetModel}`);
    }
    
    return spec.dimensions;
  }

  /**
   * Calculate estimated cost for embedding generation
   * @param {number} tokenCount - Estimated token count
   * @param {string} model - Model name
   * @returns {number} Estimated cost in USD
   */
  calculateCost(tokenCount, model = null) {
    const targetModel = model || this.config.model;
    const spec = this.modelSpecs[targetModel];
    
    if (!spec) {
      throw new Error(`Unknown model: ${targetModel}`);
    }
    
    return (tokenCount / 1000) * spec.costPer1kTokens;
  }

  /**
   * Make API request to embedding endpoint
   * @param {Object} data - Request payload
   * @returns {Promise<Object>} API response
   */
  async makeEmbeddingRequest(data) {
    const url = `${this.baseUrl}/embeddings`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, this.config.timeout);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(data),
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const error = new Error(errorData.error?.message || `HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }

      return await response.json();
    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error.name === 'AbortError') {
        const timeoutError = new Error(`Embedding request timeout after ${this.config.timeout}ms`);
        timeoutError.code = 'TIMEOUT';
        throw timeoutError;
      }
      
      throw error;
    }
  }

  /**
   * Check if the service is properly configured
   * @returns {boolean} True if service is ready
   */
  isReady() {
    return !!(this.apiKey && this.config.model && this.modelSpecs[this.config.model]);
  }

  /**
   * Get service status and configuration
   * @returns {Object} Service status
   */
  getStatus() {
    return {
      provider: this.config.provider,
      model: this.config.model,
      dimensions: this.getEmbeddingDimensions(),
      ready: this.isReady(),
      supportedModels: Object.keys(this.modelSpecs)
    };
  }
}

module.exports = EmbeddingService;
