const { EventEmitter } = require('events');
const natural = require('natural');
const logger = require('../utils/logger');

/**
 * Auto-categorization engine with multiple strategies
 */
class AutoCategorizationEngine extends EventEmitter {
  constructor({ categoryManager, embeddingService, llmProvider }) {
    super();
    this.categoryManager = categoryManager;
    this.embeddingService = embeddingService;
    this.llmProvider = llmProvider;
    
    // Initialize NLP components
    this.tokenizer = new natural.WordTokenizer();
    this.tfidf = new natural.TfIdf();
    this.classifier = new natural.BayesClassifier();
    
    // Strategy weights for ensemble
    this.strategyWeights = {
      rules: 0.3,
      keywords: 0.2,
      ml: 0.3,
      entities: 0.2
    };
    
    this.confidenceThreshold = 0.6;
    this.maxCategories = 5;
  }

  /**
   * Initialize the engine
   */
  async initialize() {
    try {
      await this.loadTrainingData();
      await this.buildKeywordIndex();
      logger.info('AutoCategorizationEngine initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize AutoCategorizationEngine:', error);
      throw error;
    }
  }

  /**
   * Categorize a document using ensemble approach
   */
  async categorizeDocument(document, options = {}) {
    const {
      strategies = ['rules', 'keywords', 'ml', 'entities'],
      threshold = this.confidenceThreshold,
      maxCategories = this.maxCategories
    } = options;

    try {
      const results = await Promise.all([
        strategies.includes('rules') ? this.ruleBasedCategorization(document) : [],
        strategies.includes('keywords') ? this.keywordCategorization(document) : [],
        strategies.includes('ml') ? this.mlCategorization(document) : [],
        strategies.includes('entities') ? this.entityCategorization(document) : []
      ]);

      // Combine results using weighted ensemble
      const combinedScores = this.combineResults(results, strategies);
      
      // Filter by threshold and limit
      const finalCategories = combinedScores
        .filter(cat => cat.confidence >= threshold)
        .slice(0, maxCategories);

      // Add explanations
      for (const category of finalCategories) {
        category.explanation = await this.generateExplanation(document, category);
      }

      this.emit('documentCategorized', {
        documentId: document.id,
        categories: finalCategories
      });

      return finalCategories;

    } catch (error) {
      logger.error('Failed to categorize document:', error);
      throw error;
    }
  }

  /**
   * Rule-based categorization
   */
  async ruleBasedCategorization(document) {
    const categories = await this.categoryManager.getCategories({ isActive: true });
    const results = [];

    for (const category of categories) {
      const rules = await this.categoryManager.getCategoryRules(category.id);
      let maxConfidence = 0;
      let matchedRule = null;

      for (const rule of rules) {
        const confidence = await this.evaluateRule(document, rule);
        if (confidence > maxConfidence) {
          maxConfidence = confidence;
          matchedRule = rule;
        }
      }

      if (maxConfidence > 0) {
        results.push({
          categoryId: category.id,
          categoryPath: category.path,
          confidence: maxConfidence,
          method: 'rules',
          details: { rule: matchedRule }
        });
      }
    }

    return results;
  }

  /**
   * Evaluate a single rule
   */
  async evaluateRule(document, rule) {
    const content = `${document.title || ''} ${document.content || ''} ${document.description || ''}`.toLowerCase();

    switch (rule.rule_type) {
    case 'regex': {
      const regex = new RegExp(rule.pattern, 'i');
      return regex.test(content) ? rule.confidence : 0;
    }

    case 'contains': {
      const keywords = rule.pattern.toLowerCase().split(',').map(k => k.trim());
      const matches = keywords.filter(keyword => content.includes(keyword));
      return (matches.length / keywords.length) * rule.confidence;
    }

    case 'entity': {
      const entities = await this.extractEntities(document);
      const entityPattern = JSON.parse(rule.pattern);
      return this.matchEntityPattern(entities, entityPattern) * rule.confidence;
    }

    case 'metadata': {
      const metadataPattern = JSON.parse(rule.pattern);
      return this.matchMetadataPattern(document.metadata || {}, metadataPattern) * rule.confidence;
    }

    default:
      return 0;
    }
  }

  /**
   * Keyword-based categorization
   */
  async keywordCategorization(document) {
    const content = `${document.title || ''} ${document.content || ''} ${document.description || ''}`;
    const tokens = this.tokenizer.tokenize(content.toLowerCase());
    
    // Remove stopwords
    const stopwords = natural.stopwords;
    const keywords = tokens.filter(token => !stopwords.includes(token));
    
    // Create a new TF-IDF instance for this document
    const tfidf = new natural.TfIdf();
    // If no keywords, add a dummy document to avoid errors
    const documentText = keywords.length > 0 ? keywords.join(' ') : 'empty';
    tfidf.addDocument(documentText);
    
    const categories = await this.categoryManager.getCategories({ isActive: true });
    const results = [];

    for (const category of categories) {
      const categoryKeywords = await this.getCategoryKeywords(category.id);
      let score = 0;

      for (const keyword of categoryKeywords) {
        const tfidfScore = tfidf.tfidf(keyword.term, 0);
        score += tfidfScore * keyword.weight;
      }

      if (score > 0) {
        results.push({
          categoryId: category.id,
          categoryPath: category.path,
          confidence: Math.min(score / 10, 1), // Normalize score
          method: 'keywords',
          details: { score, matchedKeywords: categoryKeywords.filter(k => keywords.includes(k.term)) }
        });
      }
    }

    return results;
  }

  /**
   * ML-based categorization
   */
  async mlCategorization(document) {
    try {
      // Get document embedding
      const embedding = await this.embeddingService.generateEmbedding(
        `${document.title || ''} ${document.content || ''}`.slice(0, 8000)
      );

      // Find similar categorized documents
      const similarDocs = await this.findSimilarCategorizedDocuments(embedding, 10);
      
      // Aggregate categories from similar documents
      const categoryScores = new Map();
      
      for (const doc of similarDocs) {
        for (const category of doc.categories) {
          const currentScore = categoryScores.get(category.category_id) || 0;
          categoryScores.set(category.category_id, currentScore + doc.similarity * category.confidence);
        }
      }

      // Use classifier for additional scoring
      const classifierResult = this.classifier.classify(document.content || '');
      if (classifierResult) {
        const categoryId = parseInt(classifierResult);
        const currentScore = categoryScores.get(categoryId) || 0;
        categoryScores.set(categoryId, currentScore + 0.5);
      }

      // Convert to results format
      const results = [];
      for (const [categoryId, score] of categoryScores) {
        const category = await this.categoryManager.getCategory(categoryId);
        if (category) {
          results.push({
            categoryId: category.id,
            categoryPath: category.path,
            confidence: Math.min(score, 1),
            method: 'ml',
            details: { similarityScore: score }
          });
        }
      }

      return results;

    } catch (error) {
      logger.error('ML categorization failed:', error);
      return [];
    }
  }

  /**
   * Entity-based categorization
   */
  async entityCategorization(document) {
    const entities = await this.extractEntities(document);
    const categories = await this.categoryManager.getCategories({ isActive: true });
    const results = [];

    for (const category of categories) {
      const entityPatterns = await this.getCategoryEntityPatterns(category.id);
      let totalScore = 0;
      let matchCount = 0;

      for (const pattern of entityPatterns) {
        const score = this.scoreEntityMatch(entities, pattern);
        if (score > 0) {
          totalScore += score * pattern.weight;
          matchCount++;
        }
      }

      if (matchCount > 0) {
        results.push({
          categoryId: category.id,
          categoryPath: category.path,
          confidence: totalScore / matchCount,
          method: 'entities',
          details: { matchedEntities: entities, matchCount }
        });
      }
    }

    return results;
  }

  /**
   * Extract entities from document
   */
  async extractEntities(document) {
    try {
      // Use LLM for entity extraction
      const prompt = `Extract key entities from the following text. Return a JSON object with arrays for: people, organizations, locations, topics, and concepts.

Text: ${(document.content || '').slice(0, 2000)}

Return only valid JSON.`;

      const response = await this.llmProvider.complete({
        prompt,
        max_tokens: 500,
        temperature: 0.3
      });

      return JSON.parse(response);

    } catch (error) {
      logger.error('Entity extraction failed:', error);
      
      // Fallback to basic NER
      return this.basicEntityExtraction(document.content || '');
    }
  }

  /**
   * Basic entity extraction fallback
   */
  basicEntityExtraction(text) {
    const entities = {
      people: [],
      organizations: [],
      locations: [],
      topics: [],
      concepts: []
    };

    // Simple pattern matching for basic entities
    const sentences = text.split(/[.!?]+/);
    
    for (const sentence of sentences) {
      // Detect capitalized words as potential entities
      const words = sentence.split(/\s+/);
      let potentialEntity = [];
      
      for (const word of words) {
        if (word.length > 0 && word[0] === word[0].toUpperCase() && /[A-Z]/.test(word[0])) {
          potentialEntity.push(word);
        } else if (potentialEntity.length > 0) {
          const entity = potentialEntity.join(' ');
          
          // Simple classification based on patterns
          if (this.isPersonName(entity)) {
            entities.people.push(entity);
          } else if (this.isOrganization(entity)) {
            entities.organizations.push(entity);
          } else if (this.isLocation(entity)) {
            entities.locations.push(entity);
          } else {
            entities.topics.push(entity);
          }
          
          potentialEntity = [];
        }
      }
    }

    return entities;
  }

  /**
   * Combine results from multiple strategies
   */
  combineResults(results, strategies) {
    const categoryScores = new Map();
    
    // Aggregate scores by category
    strategies.forEach((strategy, index) => {
      const strategyResults = results[index];
      const weight = this.strategyWeights[strategy] || 0.25;
      
      for (const result of strategyResults) {
        const key = result.categoryId;
        
        if (!categoryScores.has(key)) {
          categoryScores.set(key, {
            categoryId: result.categoryId,
            categoryPath: result.categoryPath,
            confidence: 0,
            methods: [],
            details: {}
          });
        }
        
        const category = categoryScores.get(key);
        category.confidence += result.confidence * weight;
        category.methods.push(result.method);
        category.details[result.method] = result.details;
      }
    });

    // Convert to array and sort by confidence
    return Array.from(categoryScores.values())
      .sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Generate explanation for categorization
   */
  async generateExplanation(document, category) {
    const explanations = [];
    
    if (category.details.rules) {
      explanations.push(`Matched rule: ${category.details.rules.rule.pattern}`);
    }
    
    if (category.details.keywords && category.details.keywords.matchedKeywords.length > 0) {
      explanations.push(`Keywords: ${category.details.keywords.matchedKeywords.map(k => k.term).join(', ')}`);
    }
    
    if (category.details.ml) {
      explanations.push(`Similar to ${category.details.ml.similarityScore.toFixed(2)} categorized documents`);
    }
    
    if (category.details.entities && category.details.entities.matchCount > 0) {
      explanations.push(`Matched ${category.details.entities.matchCount} entity patterns`);
    }

    return explanations.join('; ');
  }

  /**
   * Train the ML classifier
   */
  async trainClassifier(trainingData) {
    for (const item of trainingData) {
      this.classifier.addDocument(item.content, item.categoryId.toString());
    }
    
    this.classifier.train();
    
    // Save classifier
    const classifierJson = JSON.stringify(this.classifier);
    await this.saveClassifierModel(classifierJson);
  }

  /**
   * Load training data
   */
  async loadTrainingData() {
    try {
      // Load existing categorized documents for training
      const query = `
        SELECT d.id, d.title, d.content, dc.category_id, dc.confidence
        FROM documents d
        JOIN document_categories dc ON d.id = dc.document_id
        WHERE dc.confidence > 0.8
        AND dc.is_manual = true
        LIMIT 1000
      `;
      
      const result = await this.categoryManager.db.query(query);
      
      if (result.rows.length > 0) {
        const trainingData = result.rows.map(row => ({
          content: `${row.title || ''} ${row.content || ''}`,
          categoryId: row.category_id
        }));
        
        await this.trainClassifier(trainingData);
      }
    } catch (error) {
      logger.warn('Could not load training data:', error);
    }
  }

  /**
   * Build keyword index for categories
   */
  async buildKeywordIndex() {
    const categories = await this.categoryManager.getCategories({ isActive: true });
    
    for (const category of categories) {
      // Extract keywords from category name and description
      const text = `${category.name} ${category.description || ''}`;
      const tokens = this.tokenizer.tokenize(text.toLowerCase());
      
      // Store keywords with weights
      for (const token of tokens) {
        await this.addCategoryKeyword(category.id, token, 1.0);
      }
    }
  }

  /**
   * Find similar categorized documents
   */
  async findSimilarCategorizedDocuments(embedding, limit = 10) {
    const query = `
      SELECT d.id, d.embedding, dc.category_id, dc.confidence,
             1 - (d.embedding <-> $1::vector) as similarity
      FROM documents d
      JOIN document_categories dc ON d.id = dc.document_id
      WHERE d.embedding IS NOT NULL
      ORDER BY d.embedding <-> $1::vector
      LIMIT $2
    `;
    
    const result = await this.categoryManager.db.query(query, [embedding, limit]);
    
    return result.rows.map(row => ({
      id: row.id,
      similarity: row.similarity,
      categories: [{
        category_id: row.category_id,
        confidence: row.confidence
      }]
    }));
  }

  /**
   * Get category keywords
   */
  async getCategoryKeywords(categoryId) {
    const query = `
      SELECT term, weight 
      FROM category_keywords 
      WHERE category_id = $1 
      ORDER BY weight DESC
    `;
    
    const result = await this.categoryManager.db.query(query, [categoryId]);
    return result.rows;
  }

  /**
   * Add category keyword
   */
  async addCategoryKeyword(categoryId, term, weight) {
    const query = `
      INSERT INTO category_keywords (category_id, term, weight)
      VALUES ($1, $2, $3)
      ON CONFLICT (category_id, term) 
      DO UPDATE SET weight = GREATEST(category_keywords.weight, $3)
    `;
    
    await this.categoryManager.db.query(query, [categoryId, term, weight]);
  }

  /**
   * Get category entity patterns
   */
  async getCategoryEntityPatterns(categoryId) {
    const query = `
      SELECT pattern, weight 
      FROM category_entity_patterns 
      WHERE category_id = $1
    `;
    
    const result = await this.categoryManager.db.query(query, [categoryId]);
    return result.rows.map(row => ({
      ...JSON.parse(row.pattern),
      weight: row.weight
    }));
  }

  /**
   * Score entity match
   */
  scoreEntityMatch(entities, pattern) {
    let matches = 0;
    let total = 0;
    
    for (const [entityType, entityList] of Object.entries(entities)) {
      if (pattern[entityType]) {
        total += pattern[entityType].length;
        for (const patternEntity of pattern[entityType]) {
          if (entityList.some(e => e.toLowerCase().includes(patternEntity.toLowerCase()))) {
            matches++;
          }
        }
      }
    }
    
    return total > 0 ? matches / total : 0;
  }

  /**
   * Match metadata pattern
   */
  matchMetadataPattern(metadata, pattern) {
    let matches = 0;
    let total = 0;
    
    for (const [key, value] of Object.entries(pattern)) {
      total++;
      if (metadata[key] && this.matchValue(metadata[key], value)) {
        matches++;
      }
    }
    
    return total > 0 ? matches / total : 0;
  }

  /**
   * Match value with pattern
   */
  matchValue(value, pattern) {
    // Handle undefined/null values
    if (value === undefined || value === null) {
      return false;
    }
    
    if (typeof pattern === 'string') {
      return value.toString().toLowerCase().includes(pattern.toLowerCase());
    } else if (pattern instanceof RegExp) {
      return pattern.test(value.toString());
    } else if (typeof pattern === 'object' && pattern.operator) {
      return this.evaluateOperator(value, pattern.operator, pattern.value);
    }
    return value === pattern;
  }

  /**
   * Evaluate operator condition
   */
  evaluateOperator(value, operator, targetValue) {
    switch (operator) {
    case '>': return value > targetValue;
    case '>=': return value >= targetValue;
    case '<': return value < targetValue;
    case '<=': return value <= targetValue;
    case '!=': return value !== targetValue;
    case 'in': return targetValue.includes(value);
    case 'contains': return value.toString().includes(targetValue);
    default: return value === targetValue;
    }
  }

  /**
   * Simple heuristics for entity classification
   */
  isPersonName(text) {
    const namePatterns = [
      /^(Mr\.|Mrs\.|Ms\.|Dr\.|Prof\.) /,
      /^[A-Z][a-z]+ [A-Z][a-z]+$/
    ];
    return namePatterns.some(pattern => pattern.test(text));
  }

  isOrganization(text) {
    const orgSuffixes = ['Inc.', 'Corp.', 'LLC', 'Ltd.', 'Company', 'Corporation', 'Group'];
    return orgSuffixes.some(suffix => text.endsWith(suffix));
  }

  isLocation(text) {
    const locationKeywords = ['City', 'County', 'State', 'Country', 'Street', 'Avenue', 'Road'];
    return locationKeywords.some(keyword => text.includes(keyword));
  }

  /**
   * Save classifier model
   */
  async saveClassifierModel(modelJson) {
    const query = `
      INSERT INTO ml_models (model_type, model_name, model_data, metadata)
      VALUES ('classifier', 'category_classifier', $1, $2)
      ON CONFLICT (model_type, model_name) 
      DO UPDATE SET model_data = $1, updated_at = CURRENT_TIMESTAMP
    `;
    
    await this.categoryManager.db.query(query, [
      modelJson,
      JSON.stringify({ version: '1.0', trained_at: new Date() })
    ]);
  }

  /**
   * Update strategy weights based on feedback
   */
  async updateStrategyWeights(feedback) {
    // Analyze feedback to adjust weights
    const performance = await this.analyzeStrategyPerformance(feedback);
    
    // Update weights using simple gradient adjustment
    const totalWeight = Object.values(performance).reduce((sum, p) => sum + p.accuracy, 0);
    
    for (const strategy of Object.keys(this.strategyWeights)) {
      if (performance[strategy]) {
        this.strategyWeights[strategy] = performance[strategy].accuracy / totalWeight;
      }
    }
    
    logger.info('Updated strategy weights:', this.strategyWeights);
  }

  /**
   * Analyze strategy performance
   */
  async analyzeStrategyPerformance(feedback) {
    const performance = {};
    
    for (const item of feedback) {
      const strategy = item.method;
      if (!performance[strategy]) {
        performance[strategy] = { correct: 0, total: 0 };
      }
      
      performance[strategy].total++;
      if (item.isCorrect) {
        performance[strategy].correct++;
      }
    }
    
    // Calculate accuracy
    for (const strategy of Object.keys(performance)) {
      performance[strategy].accuracy = 
        performance[strategy].correct / performance[strategy].total;
    }
    
    return performance;
  }
}

module.exports = AutoCategorizationEngine;