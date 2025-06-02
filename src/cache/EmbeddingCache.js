const CacheManager = require('./CacheManager');
const crypto = require('crypto');
const logger = require('../utils/logger');

/**
 * Specialized cache for document embeddings and vector operations
 */
class EmbeddingCache extends CacheManager {
  constructor(config = {}) {
    super({
      ...config,
      ttl: {
        embeddings: config.ttl?.embeddings || 86400, // 24 hours
        vectorSimilarity: config.ttl?.vectorSimilarity || 3600, // 1 hour
        documentVectors: config.ttl?.documentVectors || 172800, // 48 hours
        ...config.ttl
      }
    });

    this.embeddingStats = {
      totalEmbeddings: 0,
      cachedEmbeddings: 0,
      cacheHitRate: 0,
      vectorComparisons: 0,
      totalVectorSize: 0,
      avgVectorSize: 0
    };
  }

  /**
   * Generate cache key for document embedding
   */
  generateEmbeddingKey(documentId, model = 'default', version = '1') {
    return this.generateKey('embedding', documentId, model, version);
  }

  /**
   * Generate cache key for text embedding
   */
  generateTextEmbeddingKey(text, model = 'default') {
    const textHash = crypto.createHash('sha256').update(text).digest('hex');
    return this.generateKey('embedding', 'text', textHash, model);
  }

  /**
   * Cache document embedding
   */
  async cacheDocumentEmbedding(documentId, model, embedding, metadata = {}) {
    try {
      const key = this.generateKey('embedding', documentId, model, metadata.version || '1');

      const cacheData = {
        documentId,
        model,
        embedding,
        metadata: {
          ...metadata,
          cachedAt: new Date().toISOString(),
          dimensions: Array.isArray(embedding) ? embedding.length : 0,
          vectorSize: Array.isArray(embedding) ? embedding.length : 0
        }
      };

      await this.set(key, cacheData, { ttl: this.config.ttl.embeddings });

      this.embeddingStats.totalEmbeddings++;
      this.embeddingStats.cachedEmbeddings++;
      this.embeddingStats.totalVectorSize += cacheData.metadata.vectorSize;
      this.updateEmbeddingStats();
      
      logger.debug('Document embedding cached:', {
        documentId,
        key,
        dimensions: cacheData.metadata.dimensions,
        model
      });

      this.emit('embeddingCached', {
        documentId,
        model,
        key,
        dimensions: cacheData.metadata.dimensions
      });

      return key;
    } catch (error) {
      logger.error('Failed to cache document embedding:', error);
      return null;
    }
  }

  /**
   * Cache text embedding
   */
  async cacheTextEmbedding(text, model, embedding) {
    try {
      const key = this.generateTextEmbeddingKey(text, model);

      const cacheData = {
        text: text.length > 1000 ? text.substring(0, 1000) + '...' : text,
        model,
        embedding,
        metadata: {
          cachedAt: new Date().toISOString(),
          textLength: text.length,
          vectorSize: Array.isArray(embedding) ? embedding.length : 0
        }
      };

      // Use shorter TTL for text embeddings as they might be more dynamic
      const ttl = Math.min(this.config.ttl.embeddings, 43200); // Max 12 hours
      await this.set(key, cacheData, { ttl });

      this.embeddingStats.totalEmbeddings++;
      this.embeddingStats.cachedEmbeddings++;
      this.embeddingStats.totalVectorSize += cacheData.metadata.vectorSize;
      this.updateEmbeddingStats();

      logger.debug('Text embedding cached:', {
        key,
        textLength: text.length,
        dimensions: cacheData.metadata.vectorSize,
        model
      });

      this.emit('textEmbeddingCached', {
        key,
        textLength: text.length,
        dimensions: cacheData.metadata.vectorSize,
        model
      });

      return key;
    } catch (error) {
      logger.error('Failed to cache text embedding:', error);
      return null;
    }
  }

  /**
   * Get cached document embedding
   */
  async getCachedDocumentEmbedding(documentId, model = 'default', version = '1') {
    try {
      const key = this.generateEmbeddingKey(documentId, model, version);
      const cached = await this.get(key);

      if (cached) {
        this.embeddingStats.totalEmbeddings++;
        this.embeddingStats.cachedEmbeddings++;
        this.embeddingStats.totalVectorSize += cached.metadata.vectorSize || 0;
        this.updateEmbeddingStats();

        logger.debug('Document embedding cache hit:', {
          documentId,
          key,
          dimensions: cached.metadata.dimensions
        });

        this.emit('embeddingCacheHit', {
          documentId,
          key,
          dimensions: cached.metadata.dimensions
        });

        return {
          embedding: cached.embedding,
          metadata: cached.metadata,
          fromCache: true
        };
      }

      this.embeddingStats.totalEmbeddings++;
      this.updateEmbeddingStats();

      logger.debug('Document embedding cache miss:', { documentId, key });
      this.emit('embeddingCacheMiss', { documentId, key });

      return null;
    } catch (error) {
      logger.error('Failed to get cached document embedding:', error);
      return null;
    }
  }

  /**
   * Get cached text embedding
   */
  async getCachedTextEmbedding(text, model = 'default') {
    try {
      const key = this.generateTextEmbeddingKey(text, model);
      const cached = await this.get(key);

      if (cached) {
        logger.debug('Text embedding cache hit:', {
          key,
          textLength: cached.metadata.textLength,
          dimensions: cached.metadata.vectorSize
        });

        return {
          embedding: cached.embedding,
          metadata: cached.metadata,
          fromCache: true
        };
      }

      logger.debug('Text embedding cache miss:', { key });
      return null;
    } catch (error) {
      logger.error('Failed to get cached text embedding:', error);
      return null;
    }
  }

  /**
   * Cache similarity results
   */
  async cacheSimilarityResults(queryEmbedding, documentIds, model, results) {
    try {
      // Generate key based on query embedding and document IDs
      const queryKey = queryEmbedding.join(',');
      const docKey = documentIds.join(',');
      const key = this.generateKey('similarity', queryKey, docKey);

      const cacheData = {
        queryEmbedding,
        documentIds,
        model,
        results,
        metadata: {
          cachedAt: new Date().toISOString(),
          resultCount: results.length,
          queryVectorSize: queryEmbedding.length
        }
      };

      await this.set(key, cacheData, { ttl: this.config.ttl.vectorSimilarity });

      this.embeddingStats.vectorComparisons++;

      logger.debug('Similarity results cached:', {
        queryVectorSize: queryEmbedding.length,
        documentCount: documentIds.length,
        resultCount: results.length
      });

      return key;
    } catch (error) {
      logger.error('Failed to cache similarity results:', error);
      return null;
    }
  }

  /**
   * Get cached similarity results
   */
  async getCachedSimilarityResults(queryEmbedding, documentIds, _model) {
    try {
      const queryKey = queryEmbedding.join(',');
      const docKey = documentIds.join(',');
      const key = this.generateKey('similarity', queryKey, docKey);
      const cached = await this.get(key);

      if (cached) {
        logger.debug('Similarity cache hit:', {
          queryVectorSize: queryEmbedding.length,
          documentCount: documentIds.length,
          resultCount: cached.results.length
        });

        return {
          results: cached.results,
          metadata: cached.metadata,
          fromCache: true
        };
      }

      logger.debug('Similarity cache miss:', {
        queryVectorSize: queryEmbedding.length,
        documentCount: documentIds.length
      });

      return null;
    } catch (error) {
      logger.error('Failed to get cached similarity results:', error);
      return null;
    }
  }

  /**
   * Calculate vector size
   */
  calculateVectorSize(vector) {
    if (!vector || !Array.isArray(vector)) {
      return 0;
    }
    return vector.length;
  }

  /**
   * Batch get multiple embeddings
   */
  async batchGetEmbeddings(requests) {
    const results = [];
    
    for (const request of requests) {
      try {
        let result;
        if (request.documentId) {
          result = await this.getCachedDocumentEmbedding(
            request.documentId,
            request.model,
            request.version
          );
        } else if (request.text) {
          result = await this.getCachedTextEmbedding(
            request.text,
            request.model
          );
        }

        if (result) {
          results.push({
            embedding: result.embedding,
            metadata: result.metadata,
            fromCache: true
          });
        } else {
          results.push(null);
        }
      } catch (error) {
        results.push(null);
      }
    }

    logger.info(`Batch retrieved ${results.filter(r => r !== null).length}/${results.length} embeddings from cache`);
    return results;
  }

  /**
   * Warm embedding cache
   */
  async warmEmbeddingCache(embeddings) {
    logger.info(`Warming up embedding cache for ${embeddings.length} embeddings`);
    
    const results = [];
    for (const embedding of embeddings) {
      try {
        let cached;
        if (embedding.documentId) {
          cached = await this.getCachedDocumentEmbedding(
            embedding.documentId, 
            embedding.model
          );
        } else if (embedding.text) {
          cached = await this.getCachedTextEmbedding(
            embedding.text,
            embedding.model
          );
        }
        
        results.push({
          id: embedding.documentId || embedding.text?.substring(0, 50),
          status: cached ? 'already_cached' : 'needs_generation',
          fromCache: !!cached
        });
        
        if (cached) {
          logger.debug('Embedding already cached:', embedding.documentId || 'text');
        }
      } catch (error) {
        logger.warn('Failed to check embedding cache:', error.message);
        results.push({
          id: embedding.documentId || embedding.text?.substring(0, 50),
          status: 'error',
          error: error.message
        });
      }
    }
    
    return results;
  }

  /**
   * Estimate cache size
   */
  async estimateCacheSize() {
    try {
      const stats = await this.getStats();
      
      return {
        totalVectors: this.embeddingStats.cachedEmbeddings,
        totalDimensions: this.embeddingStats.totalVectorSize,
        avgVectorSize: this.embeddingStats.avgVectorSize,
        memoryEntries: stats.memory.size,
        estimatedMemoryUsage: this.embeddingStats.totalVectorSize * 4 // 4 bytes per float
      };
    } catch (error) {
      logger.error('Failed to estimate cache size:', error);
      return {
        totalVectors: 0,
        totalDimensions: 0,
        avgVectorSize: 0,
        error: error.message
      };
    }
  }

  /**
   * Get cache efficiency metrics
   */
  async getCacheEfficiency() {
    try {
      return {
        hitRate: this.embeddingStats.cacheHitRate,
        totalEmbeddings: this.embeddingStats.totalEmbeddings,
        cachedEmbeddings: this.embeddingStats.cachedEmbeddings,
        vectorComparisons: this.embeddingStats.vectorComparisons,
        avgVectorSize: this.embeddingStats.avgVectorSize
      };
    } catch (error) {
      logger.error('Failed to get cache efficiency:', error);
      return {
        hitRate: 0,
        totalEmbeddings: 0,
        cachedEmbeddings: 0,
        error: error.message
      };
    }
  }

  /**
   * Update embedding statistics
   */
  updateEmbeddingStats() {
    if (this.embeddingStats.totalEmbeddings > 0) {
      this.embeddingStats.cacheHitRate = 
        this.embeddingStats.cachedEmbeddings / this.embeddingStats.totalEmbeddings;
    }
    
    if (this.embeddingStats.cachedEmbeddings > 0) {
      this.embeddingStats.avgVectorSize = 
        this.embeddingStats.totalVectorSize / this.embeddingStats.cachedEmbeddings;
    }
  }

  /**
   * Batch cache multiple embeddings
   */
  async batchCacheEmbeddings(embeddings) {
    const results = [];
    
    for (const embeddingData of embeddings) {
      try {
        // Validate required fields
        if (!embeddingData.documentId && !embeddingData.text) {
          throw new Error('Either documentId or text is required');
        }
        
        let key;
        if (embeddingData.documentId) {
          key = await this.cacheDocumentEmbedding(
            embeddingData.documentId,
            embeddingData.model,
            embeddingData.embedding,
            embeddingData.metadata
          );
        } else if (embeddingData.text) {
          key = await this.cacheTextEmbedding(
            embeddingData.text,
            embeddingData.model,
            embeddingData.embedding
          );
        }

        results.push({
          status: 'success',
          key,
          id: embeddingData.documentId || embeddingData.text?.substring(0, 50)
        });
      } catch (error) {
        results.push({
          status: 'error',
          error: error.message,
          id: embeddingData.documentId || embeddingData.text?.substring(0, 50)
        });
      }
    }

    logger.info(`Batch cached ${results.filter(r => r.status === 'success').length}/${results.length} embeddings`);
    return results;
  }

  /**
   * Invalidate embeddings for a document
   */
  async invalidateDocumentEmbeddings(documentId) {
    try {
      const pattern = this.generateKey('embedding', documentId, '*');
      const deletedCount = await this.clear(pattern);
      
      logger.info(`Invalidated ${deletedCount} embeddings for document: ${documentId}`);
      this.emit('embeddingsInvalidated', { documentId, deletedCount });
      
      return deletedCount;
    } catch (error) {
      logger.error('Failed to invalidate document embeddings:', error);
      return 0;
    }
  }

  /**
   * Invalidate embeddings by model
   */
  async invalidateEmbeddingsByModel(model) {
    try {
      const pattern = this.generateKey('embedding', '*', model, '*');
      const deletedCount = await this.clear(pattern);
      
      logger.info(`Invalidated ${deletedCount} embeddings for model: ${model}`);
      this.emit('modelEmbeddingsInvalidated', { model, deletedCount });
      
      return deletedCount;
    } catch (error) {
      logger.error('Failed to invalidate embeddings by model:', error);
      return 0;
    }
  }

  /**
   * Get embedding cache statistics
   */
  async getEmbeddingStats() {
    const baseStats = await this.getStats();
    
    return {
      ...baseStats,
      embeddings: this.embeddingStats
    };
  }
}

module.exports = EmbeddingCache;
