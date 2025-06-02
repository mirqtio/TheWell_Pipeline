const CacheManager = require('./CacheManager');
const crypto = require('crypto');
const logger = require('../utils/logger');

/**
 * Specialized cache for LLM responses and generated content
 */
class ResponseCache extends CacheManager {
  constructor(config = {}) {
    super({
      ...config,
      ttl: {
        responses: config.ttl?.responses || 1800, // 30 minutes
        enrichment: config.ttl?.enrichment || 3600, // 1 hour
        summary: config.ttl?.summary || 7200, // 2 hours
        translation: config.ttl?.translation || 1800, // 30 minutes
        classification: config.ttl?.classification || 3600, // 1 hour
        extraction: config.ttl?.extraction || 3600, // 1 hour
        generation: config.ttl?.generation || 1800, // 30 minutes
        ...config.ttl
      }
    });

    this.responseStats = {
      totalResponses: 0,
      cachedResponses: 0,
      cacheHitRate: 0,
      tokensSaved: 0,
      costSaved: 0,
      responseTypes: {}
    };

    // Cost estimates per token (in USD)
    this.tokenCosts = {
      'gpt-4': 0.00006, // $0.06 per 1K tokens
      'gpt-3.5-turbo': 0.000002, // $0.002 per 1K tokens
      'claude-3': 0.000015,
      'default': 0.000002
    };
  }

  /**
   * Generate cache key for response
   */
  generateResponseKey(type, prompt, model, parameters = {}) {
    const responseData = {
      type,
      prompt: typeof prompt === 'string' ? prompt : JSON.stringify(prompt),
      model,
      parameters: this.normalizeParameters(parameters)
    };

    const responseString = JSON.stringify(responseData);
    const hash = crypto.createHash('sha256').update(responseString).digest('hex');
    
    return this.generateKey('response', hash);
  }

  /**
   * Normalize parameters for consistent caching
   */
  normalizeParameters(parameters) {
    if (!parameters || typeof parameters !== 'object') {
      return {};
    }

    // Extract cache-relevant parameters
    const relevant = {
      temperature: parameters.temperature,
      max_tokens: parameters.max_tokens,
      top_p: parameters.top_p,
      frequency_penalty: parameters.frequency_penalty,
      presence_penalty: parameters.presence_penalty,
      stop: parameters.stop
    };

    // Remove undefined values and sort
    const normalized = {};
    Object.keys(relevant).sort().forEach(key => {
      if (relevant[key] !== undefined) {
        normalized[key] = relevant[key];
      }
    });

    return normalized;
  }

  /**
   * Cache LLM response
   */
  async cacheResponse(prompt, model, parameters, response, metadata = {}) {
    try {
      const key = this.generateResponseKey('general', prompt, model, parameters);
      
      const cacheData = {
        prompt: typeof prompt === 'string' ? prompt : JSON.stringify(prompt),
        model,
        parameters,
        response,
        metadata: {
          ...metadata,
          cachedAt: new Date().toISOString(),
          responseLength: typeof response === 'string' ? response.length : JSON.stringify(response).length,
          promptLength: typeof prompt === 'string' ? prompt.length : JSON.stringify(prompt).length,
          estimatedTokens: this.estimateTokens(prompt, response),
          responseType: metadata.responseType || 'general'
        }
      };

      const ttl = this.determineTTL(cacheData.metadata.responseType, metadata);
      await this.set(key, cacheData, { ttl });

      this.responseStats.totalResponses++;
      this.updateTokenSavings(cacheData.metadata.estimatedTokens, model);
      
      logger.debug('Response cached:', {
        key,
        model,
        responseType: cacheData.metadata.responseType,
        estimatedTokens: cacheData.metadata.estimatedTokens,
        ttl
      });

      this.emit('responseCached', {
        key,
        model,
        responseType: cacheData.metadata.responseType,
        estimatedTokens: cacheData.metadata.estimatedTokens,
        ttl
      });

      return key;
    } catch (error) {
      logger.error('Failed to cache response:', error);
      return null;
    }
  }

  /**
   * Get cached response
   */
  async getCachedResponse(prompt, model, parameters = {}) {
    try {
      const key = this.generateResponseKey('general', prompt, model, parameters);
      const cached = await this.get(key);

      // Always increment total responses for every request
      this.responseStats.totalResponses++;

      if (cached) {
        this.responseStats.cachedResponses++;
        this.updateResponseHitRate();
        this.updateTokenSavings(cached.metadata.estimatedTokens, model);

        logger.debug('Response cache hit:', {
          key,
          model,
          responseType: cached.metadata.responseType,
          estimatedTokens: cached.metadata.estimatedTokens
        });

        this.emit('responseCacheHit', {
          key,
          model,
          responseType: cached.metadata.responseType,
          estimatedTokens: cached.metadata.estimatedTokens,
          cachedAt: cached.metadata.cachedAt
        });

        return {
          response: cached.response,
          metadata: cached.metadata,
          fromCache: true
        };
      }

      this.updateResponseHitRate();

      logger.debug('Response cache miss:', { key, model });
      this.emit('responseCacheMiss', { key, model, prompt: prompt.substring(0, 100) });

      return null;
    } catch (error) {
      logger.error('Failed to get cached response:', error);
      return null;
    }
  }

  /**
   * Determine TTL based on response type
   */
  determineTTL(responseType, metadata) {
    let ttl = this.config.ttl.responses;

    switch (responseType) {
    case 'enrichment':
      ttl = this.config.ttl.enrichment;
      break;
    case 'summary':
      ttl = this.config.ttl.summary;
      break;
    case 'translation':
      ttl = this.config.ttl.translation;
      break;
    case 'classification':
      ttl = this.config.ttl.classification;
      break;
    case 'extraction':
      ttl = this.config.ttl.extraction;
      break;
    case 'generation':
      ttl = this.config.ttl.generation;
      break;
    case 'analysis':
      ttl = Math.max(this.config.ttl.responses, 3600); // At least 1 hour
      break;
    default:
      ttl = this.config.ttl.responses;
    }

    // Adjust based on content stability
    if (metadata.isStable) {
      ttl *= 2; // Double TTL for stable content
    }

    if (metadata.suggestedTTL) {
      ttl = Math.min(ttl, metadata.suggestedTTL);
    }

    return ttl;
  }

  /**
   * Estimate token count for cost calculation
   */
  estimateTokens(prompt, response) {
    // Rough estimation: ~4 characters per token
    const promptTokens = Math.ceil((typeof prompt === 'string' ? prompt.length : JSON.stringify(prompt).length) / 4);
    const responseTokens = Math.ceil((typeof response === 'string' ? response.length : JSON.stringify(response).length) / 4);
    
    return {
      prompt: promptTokens,
      response: responseTokens,
      total: promptTokens + responseTokens
    };
  }

  /**
   * Update token savings statistics
   */
  updateTokenSavings(estimatedTokens, model) {
    if (estimatedTokens && estimatedTokens.total) {
      this.responseStats.tokensSaved += estimatedTokens.total;
      
      const costPerToken = this.tokenCosts[model] || this.tokenCosts.default;
      this.responseStats.costSaved += estimatedTokens.total * costPerToken;
    }
  }

  /**
   * Update response hit rate statistics
   */
  updateResponseHitRate() {
    if (this.responseStats.totalResponses > 0) {
      this.responseStats.cacheHitRate = 
        this.responseStats.cachedResponses / this.responseStats.totalResponses;
    }
  }

  /**
   * Cache document enrichment
   */
  async cacheDocumentEnrichment(documentId, enrichmentType, enrichedData, metadata = {}) {
    try {
      const key = this.generateKey('enrichment', documentId, enrichmentType);
      
      const cacheData = {
        documentId,
        enrichmentType,
        enrichedData,
        metadata: {
          ...metadata,
          cachedAt: new Date().toISOString(),
          dataSize: JSON.stringify(enrichedData).length
        }
      };

      await this.set(key, cacheData, { ttl: this.config.ttl.enrichment });
      
      logger.debug('Document enrichment cached:', {
        documentId,
        enrichmentType,
        dataSize: cacheData.metadata.dataSize
      });

      return key;
    } catch (error) {
      logger.error('Failed to cache document enrichment:', error);
      return null;
    }
  }

  /**
   * Get cached document enrichment
   */
  async getCachedDocumentEnrichment(documentId, enrichmentType) {
    try {
      const key = this.generateKey('enrichment', documentId, enrichmentType);
      const cached = await this.get(key);

      if (cached) {
        logger.debug('Document enrichment cache hit:', {
          documentId,
          enrichmentType,
          dataSize: cached.metadata.dataSize
        });

        return {
          enrichedData: cached.enrichedData,
          metadata: cached.metadata,
          fromCache: true
        };
      }

      logger.debug('Document enrichment cache miss:', { documentId, enrichmentType });
      return null;
    } catch (error) {
      logger.error('Failed to get cached document enrichment:', error);
      return null;
    }
  }

  /**
   * Invalidate responses by model
   */
  async invalidateResponsesByModel(model) {
    try {
      const pattern = `response:*${model}*`;
      const count = await this.clear(pattern);
      logger.debug(`Invalidated ${count} responses for model: ${model}`);
      return count;
    } catch (error) {
      logger.error('Failed to invalidate responses by model:', error);
      return 0;
    }
  }

  /**
   * Invalidate document enrichments
   */
  async invalidateDocumentEnrichments(documentId, enrichmentType = '*') {
    try {
      const pattern = this.generateKey('enrichment', documentId, enrichmentType);
      const deletedCount = await this.clear(pattern);
      
      logger.info(`Invalidated ${deletedCount} enrichments for document: ${documentId}`);
      this.emit('enrichmentsInvalidated', { documentId, enrichmentType, deletedCount });
      
      return deletedCount;
    } catch (error) {
      logger.error('Failed to invalidate document enrichments:', error);
      return 0;
    }
  }

  /**
   * Get response cache statistics with cost savings
   */
  async getResponseStats() {
    const baseStats = await this.getStats();
    
    return {
      ...baseStats,
      responses: this.responseStats,
      costSavings: {
        totalTokensSaved: this.responseStats.tokensSaved,
        estimatedCostSaved: this.responseStats.costSaved,
        currency: 'USD'
      }
    };
  }

  /**
   * Preload common responses
   */
  async preloadCommonResponses(responseConfigs) {
    logger.info(`Preloading ${responseConfigs.length} common responses into cache`);
    
    const results = [];
    for (const config of responseConfigs) {
      try {
        const key = this.generateResponseKey(
          config.metadata?.responseType || 'general',
          config.prompt,
          config.model,
          config.parameters
        );
        
        // Check if already cached
        const existing = await this.get(key);
        
        if (existing) {
          results.push({
            prompt: config.prompt.substring(0, 100),
            model: config.model,
            key,
            status: 'already_cached'
          });
        } else {
          // Preload the response
          await this.cacheResponse(
            config.prompt,
            config.model,
            config.parameters,
            config.response,
            config.metadata
          );
          
          results.push({
            prompt: config.prompt.substring(0, 100),
            model: config.model,
            key,
            status: 'preloaded'
          });
        }
        
        logger.debug('Preloaded response cache:', {
          prompt: config.prompt.substring(0, 50),
          model: config.model,
          cached: !!existing
        });
      } catch (error) {
        logger.warn('Failed to preload response cache:', error.message);
        results.push({
          prompt: config.prompt.substring(0, 100),
          model: config.model,
          status: 'error',
          error: error.message
        });
      }
    }
    
    return results;
  }

  /**
   * Get cache efficiency metrics
   */
  async getCacheEfficiency() {
    const stats = await this.getResponseStats();
    
    return {
      hitRate: stats.responses.cacheHitRate,
      tokensSaved: stats.responses.tokensSaved,
      costSaved: stats.responses.costSaved,
      totalRequests: stats.responses.totalResponses,
      cachedRequests: stats.responses.cachedResponses,
      efficiency: {
        tokensPerHit: stats.responses.cachedResponses > 0 ? 
          stats.responses.tokensSaved / stats.responses.cachedResponses : 0,
        costPerHit: stats.responses.cachedResponses > 0 ? 
          stats.responses.costSaved / stats.responses.cachedResponses : 0
      }
    };
  }

  /**
   * Cache enrichment response
   */
  async cacheEnrichmentResponse(prompt, model, parameters, response, metadata = {}) {
    return this.cacheResponse(prompt, model, parameters, response, { ...metadata, responseType: 'enrichment' });
  }

  /**
   * Cache summary response
   */
  async cacheSummaryResponse(prompt, model, parameters, response, metadata = {}) {
    return this.cacheResponse(prompt, model, parameters, response, { ...metadata, responseType: 'summary' });
  }

  /**
   * Cache translation response
   */
  async cacheTranslationResponse(prompt, model, parameters, response, metadata = {}) {
    return this.cacheResponse(prompt, model, parameters, response, { ...metadata, responseType: 'translation' });
  }

  /**
   * Cache classification response
   */
  async cacheClassificationResponse(prompt, model, parameters, response, metadata = {}) {
    return this.cacheResponse(prompt, model, parameters, response, { ...metadata, responseType: 'classification' });
  }

  /**
   * Cache extraction response
   */
  async cacheExtractionResponse(prompt, model, parameters, response, metadata = {}) {
    return this.cacheResponse(prompt, model, parameters, response, { ...metadata, responseType: 'extraction' });
  }

  /**
   * Cache generation response
   */
  async cacheGenerationResponse(prompt, model, parameters, response, metadata = {}) {
    return this.cacheResponse(prompt, model, parameters, response, { ...metadata, responseType: 'generation' });
  }

  /**
   * Invalidate responses by type
   */
  async invalidateResponsesByType(type) {
    try {
      const pattern = `response:*:${type}:*`;
      const count = await this.clear(pattern);
      logger.debug('Invalidated responses by type:', { type, count });
      return count;
    } catch (error) {
      logger.error('Failed to invalidate responses by type:', error);
      return 0;
    }
  }

  /**
   * Invalidate all responses
   */
  async invalidateAllResponses() {
    try {
      const pattern = 'response:*';
      const count = await this.clear(pattern);
      logger.debug('Invalidated all responses:', { count });
      return count;
    } catch (error) {
      logger.error('Failed to invalidate all responses:', error);
      return 0;
    }
  }

  /**
   * Warm response cache with common responses
   */
  async warmResponseCache(responses) {
    const results = [];
    
    for (const responseConfig of responses) {
      try {
        const { prompt, model, parameters, response, metadata } = responseConfig;
        
        // Check if already cached
        const existing = await this.getCachedResponse(
          metadata?.responseType || 'general', 
          prompt, 
          model, 
          parameters
        );
        
        if (existing) {
          results.push({ 
            status: 'already_cached', 
            prompt: prompt.substring(0, 50) + '...' 
          });
        } else {
          const key = await this.cacheResponse(prompt, model, parameters, response, metadata);
          results.push({ 
            status: 'needs_generation', 
            key, 
            prompt: prompt.substring(0, 50) + '...' 
          });
        }
      } catch (error) {
        logger.error('Failed to warm cache for response:', error);
        results.push({ 
          status: 'error', 
          error: error.message, 
          prompt: responseConfig.prompt?.substring(0, 50) + '...' 
        });
      }
    }
    
    return results;
  }

  /**
   * Calculate cost savings from caching
   */
  async calculateCostSavings() {
    const tokensSaved = this.responseStats.tokensSaved || 0;
    const estimatedCostSavings = this.responseStats.costSaved || 0;
    const averageCostPerToken = tokensSaved > 0 ? estimatedCostSavings / tokensSaved : 0;
    
    return {
      tokensSaved,
      estimatedCostSavings,
      averageCostPerToken
    };
  }

  /**
   * Get response type breakdown
   */
  async getResponseTypeBreakdown() {
    const breakdown = {};
    const responseTypes = this.responseStats.responseTypes || {};
    const totalResponses = this.responseStats.totalResponses || 0;

    for (const [type, count] of Object.entries(responseTypes)) {
      breakdown[type] = {
        count,
        percentage: totalResponses > 0 ? (count / totalResponses) * 100 : 0
      };
    }

    return breakdown;
  }

  /**
   * Estimate response cost based on model and token count
   */
  estimateResponseCost(model, tokenCount) {
    if (tokenCount === 0) return 0;
    
    const costPerToken = this.tokenCosts[model] || this.tokenCosts.default;
    return costPerToken * tokenCount;
  }

  /**
   * Extract token count from response
   */
  extractTokenCount(response) {
    if (response?.usage?.total_tokens) {
      return response.usage.total_tokens;
    }
    
    if (response?.content) {
      // Estimate tokens from content length (rough approximation: 1 token ≈ 4 characters)
      return Math.ceil(response.content.length / 4);
    }
    
    return 0;
  }
}

module.exports = ResponseCache;
