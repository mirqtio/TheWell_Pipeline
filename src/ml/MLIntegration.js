const MLModelService = require('../services/MLModelService');
const logger = require('../utils/logger');

/**
 * MLIntegration - Integrates ML models with existing pipeline features
 */
class MLIntegration {
  constructor() {
    this.mlService = null;
    this.modelCache = new Map();
    this.initialized = false;
  }

  /**
   * Initialize ML integration
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    this.mlService = new MLModelService();
    await this.mlService.initialize();
    
    // Load deployed models
    await this.loadDeployedModels();
    
    this.initialized = true;
    logger.info('ML Integration initialized');
  }

  /**
   * Load all deployed models for quick access
   */
  async loadDeployedModels() {
    try {
      const models = await this.mlService.listModels({ status: 'deployed' });
      
      for (const model of models) {
        this.modelCache.set(model.type, model.id);
        logger.info(`Loaded deployed model: ${model.type} (ID: ${model.id})`);
      }
    } catch (error) {
      logger.error('Failed to load deployed models:', error);
    }
  }

  /**
   * Enhanced entity extraction with ML
   */
  async enhanceEntityExtraction(text, existingEntities = []) {
    try {
      const nerModelId = this.modelCache.get('ner');
      if (!nerModelId) {
        logger.warn('No NER model deployed, using existing entities only');
        return existingEntities;
      }

      // Get ML-based entities
      const prediction = await this.mlService.predict(nerModelId, text);
      const mlEntities = prediction.prediction.entities || [];

      // Merge with existing entities
      const mergedEntities = this.mergeEntities(existingEntities, mlEntities);

      logger.debug(`Enhanced entity extraction: ${existingEntities.length} -> ${mergedEntities.length} entities`);
      
      return mergedEntities;
    } catch (error) {
      logger.error('Entity enhancement failed:', error);
      return existingEntities;
    }
  }

  /**
   * Merge entities from different sources
   */
  mergeEntities(existing, mlEntities) {
    const entityMap = new Map();

    // Add existing entities
    existing.forEach(entity => {
      const key = `${entity.text}-${entity.type}`;
      entityMap.set(key, {
        ...entity,
        sources: ['existing'],
        confidence: entity.confidence || 0.8
      });
    });

    // Add or merge ML entities
    mlEntities.forEach(entity => {
      const key = `${entity.text}-${entity.type}`;
      
      if (entityMap.has(key)) {
        // Merge confidence scores
        const existing = entityMap.get(key);
        existing.sources.push('ml');
        existing.confidence = Math.max(existing.confidence, entity.confidence);
      } else {
        entityMap.set(key, {
          ...entity,
          sources: ['ml']
        });
      }
    });

    return Array.from(entityMap.values());
  }

  /**
   * Enhance search ranking with ML
   */
  async enhanceSearchRanking(query, searchResults) {
    try {
      const similarityModelId = this.modelCache.get('similarity');
      if (!similarityModelId) {
        logger.warn('No similarity model deployed, using original ranking');
        return searchResults;
      }

      // Extract documents from search results
      const documents = searchResults.map(result => result.content || result.text || '');

      // Get similarity scores
      const prediction = await this.mlService.predict(similarityModelId, {
        query,
        candidates: documents
      });

      const similarities = prediction.prediction.allSimilarities || [];

      // Re-rank results based on ML similarity
      const enhancedResults = searchResults.map((result, index) => ({
        ...result,
        originalScore: result.score || 0,
        mlScore: similarities[index]?.similarity || 0,
        combinedScore: (result.score || 0) * 0.5 + (similarities[index]?.similarity || 0) * 0.5
      }));

      // Sort by combined score
      enhancedResults.sort((a, b) => b.combinedScore - a.combinedScore);

      logger.debug(`Enhanced search ranking for query: "${query}"`);
      
      return enhancedResults;
    } catch (error) {
      logger.error('Search ranking enhancement failed:', error);
      return searchResults;
    }
  }

  /**
   * Assess document quality with ML
   */
  async assessDocumentQuality(document) {
    try {
      const qualityModelId = this.modelCache.get('quality_scoring');
      if (!qualityModelId) {
        logger.warn('No quality scoring model deployed');
        return {
          overallScore: 0.5,
          qualityLevel: 'unknown',
          scores: {},
          recommendations: ['Quality scoring model not available']
        };
      }

      const prediction = await this.mlService.predict(qualityModelId, document);
      const quality = prediction.prediction;

      logger.debug(`Assessed document quality: ${quality.overallScore}`);
      
      return quality;
    } catch (error) {
      logger.error('Document quality assessment failed:', error);
      return {
        overallScore: 0.5,
        qualityLevel: 'error',
        scores: {},
        recommendations: ['Quality assessment failed']
      };
    }
  }

  /**
   * Classify document automatically
   */
  async classifyDocument(document) {
    try {
      const classificationModelId = this.modelCache.get('classification');
      if (!classificationModelId) {
        logger.warn('No classification model deployed');
        return {
          class: 'uncategorized',
          confidence: 0,
          probabilities: {}
        };
      }

      const prediction = await this.mlService.predict(classificationModelId, document);
      const classification = prediction.prediction;

      logger.debug(`Classified document as: ${classification.class} (confidence: ${classification.confidence})`);
      
      return classification;
    } catch (error) {
      logger.error('Document classification failed:', error);
      return {
        class: 'error',
        confidence: 0,
        probabilities: {}
      };
    }
  }

  /**
   * Analyze document sentiment
   */
  async analyzeSentiment(text) {
    try {
      const sentimentModelId = this.modelCache.get('sentiment');
      if (!sentimentModelId) {
        logger.warn('No sentiment model deployed');
        return {
          sentiment: 'neutral',
          confidence: 0,
          scores: { negative: 0, neutral: 1, positive: 0 },
          compound: 0
        };
      }

      const prediction = await this.mlService.predict(sentimentModelId, text);
      const sentiment = prediction.prediction;

      logger.debug(`Analyzed sentiment: ${sentiment.sentiment} (confidence: ${sentiment.confidence})`);
      
      return sentiment;
    } catch (error) {
      logger.error('Sentiment analysis failed:', error);
      return {
        sentiment: 'error',
        confidence: 0,
        scores: { negative: 0, neutral: 0, positive: 0 },
        compound: 0
      };
    }
  }

  /**
   * Extract topics from documents
   */
  async extractTopics(documents) {
    try {
      const topicModelId = this.modelCache.get('topic_modeling');
      if (!topicModelId) {
        logger.warn('No topic model deployed');
        return [];
      }

      const prediction = await this.mlService.predict(topicModelId, documents);
      const topics = prediction.prediction;

      logger.debug(`Extracted ${topics.length} topics from ${documents.length} documents`);
      
      return topics;
    } catch (error) {
      logger.error('Topic extraction failed:', error);
      return [];
    }
  }

  /**
   * Find similar documents
   */
  async findSimilarDocuments(query, candidates, topK = 5) {
    try {
      const similarityModelId = this.modelCache.get('similarity');
      if (!similarityModelId) {
        logger.warn('No similarity model deployed');
        return {
          query,
          similar: [],
          allSimilarities: []
        };
      }

      const prediction = await this.mlService.predict(similarityModelId, {
        query,
        candidates,
        topK
      });

      logger.debug(`Found ${prediction.prediction.similar.length} similar documents`);
      
      return prediction.prediction;
    } catch (error) {
      logger.error('Document similarity search failed:', error);
      return {
        query,
        similar: [],
        allSimilarities: []
      };
    }
  }

  /**
   * Batch process documents with ML enhancements
   */
  async batchEnhanceDocuments(documents) {
    const results = [];

    for (const doc of documents) {
      try {
        const [quality, classification, sentiment, entities] = await Promise.all([
          this.assessDocumentQuality(doc.content || doc.text),
          this.classifyDocument(doc.content || doc.text),
          this.analyzeSentiment(doc.content || doc.text),
          this.enhanceEntityExtraction(doc.content || doc.text, doc.entities || [])
        ]);

        results.push({
          ...doc,
          mlEnhancements: {
            quality,
            classification,
            sentiment,
            entities,
            enhancedAt: new Date().toISOString()
          }
        });
      } catch (error) {
        logger.error(`Failed to enhance document ${doc.id}:`, error);
        results.push({
          ...doc,
          mlEnhancements: {
            error: error.message,
            enhancedAt: new Date().toISOString()
          }
        });
      }
    }

    return results;
  }

  /**
   * Auto-tag documents based on ML analysis
   */
  async autoTagDocument(document) {
    const tags = new Set();

    try {
      // Get classification
      const classification = await this.classifyDocument(document);
      if (classification.confidence > 0.7) {
        tags.add(classification.class);
      }

      // Get sentiment
      const sentiment = await this.analyzeSentiment(document);
      if (sentiment.confidence > 0.8) {
        tags.add(`sentiment:${sentiment.sentiment}`);
      }

      // Get quality
      const quality = await this.assessDocumentQuality(document);
      tags.add(`quality:${quality.qualityLevel}`);

      // Extract entities as tags
      const entities = await this.enhanceEntityExtraction(document, []);
      entities
        .filter(e => e.confidence > 0.8)
        .forEach(e => tags.add(`${e.type}:${e.text}`));

    } catch (error) {
      logger.error('Auto-tagging failed:', error);
    }

    return Array.from(tags);
  }

  /**
   * Generate document summary using ML
   */
  async generateSummary(document, maxLength = 200) {
    // This would use a summarization model if available
    // For now, return a simple extraction
    const sentences = document.split(/[.!?]+/).filter(s => s.trim().length > 0);
    
    if (sentences.length <= 3) {
      return document;
    }

    // Use quality scoring to identify best sentences
    const sentenceScores = await Promise.all(
      sentences.map(async (sentence) => {
        const quality = await this.assessDocumentQuality(sentence);
        return {
          sentence: sentence.trim(),
          score: quality.overallScore
        };
      })
    );

    // Select top sentences
    sentenceScores.sort((a, b) => b.score - a.score);
    const summary = sentenceScores
      .slice(0, 3)
      .map(s => s.sentence)
      .join('. ') + '.';

    return summary.substring(0, maxLength);
  }

  /**
   * Get ML enhancement status
   */
  getStatus() {
    const status = {
      initialized: this.initialized,
      deployedModels: {}
    };

    for (const [type, modelId] of this.modelCache) {
      status.deployedModels[type] = {
        modelId,
        available: true
      };
    }

    return status;
  }

  /**
   * Reload deployed models
   */
  async reloadModels() {
    this.modelCache.clear();
    await this.loadDeployedModels();
    logger.info('ML models reloaded');
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    if (this.mlService) {
      await this.mlService.cleanup();
    }
    this.modelCache.clear();
    this.initialized = false;
  }
}

// Export singleton instance
module.exports = new MLIntegration();