const AutoCategorizationEngine = require('../../../src/categorization/AutoCategorizationEngine');

jest.mock('../../../src/database/DatabaseManager', () => ({
  getInstance: jest.fn(() => ({
    query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    connect: jest.fn().mockResolvedValue({
      query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: jest.fn()
    }),
    transaction: jest.fn((callback) => {
      const mockTrx = {
        query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
        commit: jest.fn(),
        rollback: jest.fn()
      };
      return callback(mockTrx);
    })
  }))
}));
const { EventEmitter } = require('events');

describe('AutoCategorizationEngine', () => {
  let engine;
  let mockCategoryManager;
  let mockEmbeddingService;
  let mockLLMProvider;

  beforeEach(() => {
    mockCategoryManager = {
      db: {
        query: jest.fn()
      },
      getCategories: jest.fn(),
      getCategoryRules: jest.fn(),
      getCategory: jest.fn()
    };

    mockEmbeddingService = {
      generateEmbedding: jest.fn()
    };

    mockLLMProvider = {
      complete: jest.fn()
    };

    engine = new AutoCategorizationEngine({
      categoryManager: mockCategoryManager,
      embeddingService: mockEmbeddingService,
      llmProvider: mockLLMProvider
    });
    
    // Mock the classifier's classify method to prevent "Not Trained" error
    engine.classifier.classify = jest.fn().mockReturnValue('1');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('categorizeDocument', () => {
    const mockDocument = {
      id: 1,
      title: 'Introduction to Machine Learning',
      content: 'This article covers basic concepts of machine learning including supervised and unsupervised learning.',
      metadata: { source: 'blog' }
    };

    it('should categorize document using ensemble approach', async () => {
      // Mock category data
      mockCategoryManager.getCategories.mockResolvedValue([
        { id: 1, name: 'Technology', path: 'Technology' },
        { id: 2, name: 'AI', path: 'Technology/AI' }
      ]);

      // Mock rules
      mockCategoryManager.getCategoryRules.mockResolvedValue([
        { rule_type: 'contains', pattern: 'machine learning,AI', confidence: 0.8 }
      ]);

      // Mock category keywords
      mockCategoryManager.db.query
        .mockResolvedValueOnce({ rows: [{ term: 'machine', weight: 1.0 }, { term: 'learning', weight: 1.0 }] })
        .mockResolvedValueOnce({ rows: [{ term: 'AI', weight: 1.0 }] });

      // Mock embedding
      mockEmbeddingService.generateEmbedding.mockResolvedValue([0.1, 0.2, 0.3]);

      // Mock similar documents
      mockCategoryManager.db.query.mockResolvedValueOnce({
        rows: [
          { id: 2, similarity: 0.9, category_id: 2, confidence: 0.85 }
        ]
      });

      // Mock entity extraction - first call returns valid JSON
      mockLLMProvider.complete
        .mockResolvedValueOnce(JSON.stringify({
          people: [],
          organizations: [],
          locations: [],
          topics: ['machine learning', 'AI'],
          concepts: ['supervised learning', 'unsupervised learning']
        }));

      // Mock entity patterns
      mockCategoryManager.db.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      // Mock category details
      mockCategoryManager.getCategory
        .mockResolvedValueOnce({ id: 1, path: 'Technology' })
        .mockResolvedValueOnce({ id: 2, path: 'Technology/AI' });

      const results = await engine.categorizeDocument(mockDocument);

      expect(results).toBeDefined();
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]).toHaveProperty('categoryId');
      expect(results[0]).toHaveProperty('confidence');
      expect(results[0]).toHaveProperty('explanation');
    });

    it('should filter results by confidence threshold', async () => {
      mockCategoryManager.getCategories.mockResolvedValue([
        { id: 1, name: 'Low Confidence Category' }
      ]);

      mockCategoryManager.getCategoryRules.mockResolvedValue([
        { rule_type: 'contains', pattern: 'nonexistent', confidence: 0.3 }
      ]);

      const results = await engine.categorizeDocument(mockDocument, {
        strategies: ['rules'],
        threshold: 0.7
      });

      expect(results).toHaveLength(0);
    });

    it('should limit number of categories', async () => {
      mockCategoryManager.getCategories.mockResolvedValue([
        { id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }, { id: 6 }
      ]);

      // Mock multiple matching rules
      mockCategoryManager.getCategoryRules.mockResolvedValue([
        { rule_type: 'contains', pattern: 'machine learning', confidence: 0.9 }
      ]);

      const results = await engine.categorizeDocument(mockDocument, {
        strategies: ['rules'],
        maxCategories: 3
      });

      expect(results.length).toBeLessThanOrEqual(3);
    });
  });

  describe('ruleBasedCategorization', () => {
    const mockDocument = {
      title: 'Python Programming',
      content: 'Learn Python programming basics',
      metadata: { language: 'en' }
    };

    it('should apply regex rules', async () => {
      mockCategoryManager.getCategories.mockResolvedValue([
        { id: 1, name: 'Programming' }
      ]);

      mockCategoryManager.getCategoryRules.mockResolvedValue([
        { rule_type: 'regex', pattern: '\\bpython\\b', confidence: 0.9 }
      ]);

      const results = await engine.ruleBasedCategorization(mockDocument);

      expect(results).toHaveLength(1);
      expect(results[0].confidence).toBe(0.9);
      expect(results[0].method).toBe('rules');
    });

    it('should apply contains rules with multiple keywords', async () => {
      mockCategoryManager.getCategories.mockResolvedValue([
        { id: 1, name: 'Programming' }
      ]);

      mockCategoryManager.getCategoryRules.mockResolvedValue([
        { rule_type: 'contains', pattern: 'python,programming,code', confidence: 0.8 }
      ]);

      const results = await engine.ruleBasedCategorization(mockDocument);

      expect(results).toHaveLength(1);
      expect(results[0].confidence).toBeCloseTo(0.533, 2); // 2/3 keywords matched
    });

    it('should apply metadata rules', async () => {
      mockCategoryManager.getCategories.mockResolvedValue([
        { id: 1, name: 'English Content' }
      ]);

      mockCategoryManager.getCategoryRules.mockResolvedValue([
        { rule_type: 'metadata', pattern: '{"language": "en"}', confidence: 0.7 }
      ]);

      const results = await engine.ruleBasedCategorization(mockDocument);

      expect(results).toHaveLength(1);
      expect(results[0].confidence).toBe(0.7);
    });
  });

  describe('keywordCategorization', () => {
    it('should match category keywords', async () => {
      const mockDocument = {
        title: 'Deep Learning Tutorial',
        content: 'Understanding neural networks and deep learning'
      };

      mockCategoryManager.getCategories.mockResolvedValue([
        { id: 1, name: 'AI' }
      ]);

      mockCategoryManager.db.query.mockResolvedValue({
        rows: [
          { term: 'deep', weight: 1.0 },
          { term: 'learning', weight: 1.0 },
          { term: 'neural', weight: 0.8 }
        ]
      });

      const results = await engine.keywordCategorization(mockDocument);

      expect(results).toHaveLength(1);
      expect(results[0].method).toBe('keywords');
      expect(results[0].details.matchedKeywords).toBeDefined();
    });
  });

  describe('mlCategorization', () => {
    it('should use embeddings for similarity search', async () => {
      const mockDocument = {
        title: 'AI Research',
        content: 'Latest developments in artificial intelligence'
      };

      const mockEmbedding = [0.1, 0.2, 0.3];
      mockEmbeddingService.generateEmbedding.mockResolvedValue(mockEmbedding);

      mockCategoryManager.db.query.mockResolvedValue({
        rows: [
          { id: 10, similarity: 0.95, category_id: 1, confidence: 0.9 },
          { id: 11, similarity: 0.85, category_id: 2, confidence: 0.8 }
        ]
      });

      mockCategoryManager.getCategory
        .mockResolvedValueOnce({ id: 1, path: 'Technology/AI' })
        .mockResolvedValueOnce({ id: 2, path: 'Science/Research' });

      const results = await engine.mlCategorization(mockDocument);

      expect(mockEmbeddingService.generateEmbedding).toHaveBeenCalled();
      expect(results).toHaveLength(2);
      expect(results[0].method).toBe('ml');
    });

    it('should handle embedding service errors gracefully', async () => {
      mockEmbeddingService.generateEmbedding.mockRejectedValue(new Error('Service down'));

      const results = await engine.mlCategorization({ content: 'test' });

      expect(results).toEqual([]);
    });
  });

  describe('entityCategorization', () => {
    it('should extract and match entities', async () => {
      const mockDocument = {
        content: 'Elon Musk announced new SpaceX mission to Mars'
      };

      mockLLMProvider.complete.mockResolvedValue(JSON.stringify({
        people: ['Elon Musk'],
        organizations: ['SpaceX'],
        locations: ['Mars'],
        topics: ['space exploration'],
        concepts: ['space mission']
      }));

      mockCategoryManager.getCategories.mockResolvedValue([
        { id: 1, name: 'Space' }
      ]);

      mockCategoryManager.db.query.mockResolvedValue({
        rows: [{
          pattern: JSON.stringify({
            organizations: ['SpaceX', 'NASA'],
            topics: ['space']
          }),
          weight: 1.0
        }]
      });

      const results = await engine.entityCategorization(mockDocument);

      expect(results).toHaveLength(1);
      expect(results[0].method).toBe('entities');
      expect(results[0].details.matchedEntities).toBeDefined();
    });

    it('should fall back to basic entity extraction on LLM error', async () => {
      const mockDocument = {
        content: 'Microsoft Corporation announced new Windows update'
      };

      mockLLMProvider.complete.mockRejectedValue(new Error('LLM error'));

      mockCategoryManager.getCategories.mockResolvedValue([]);

      const results = await engine.entityCategorization(mockDocument);

      // Should still complete without throwing
      expect(results).toBeDefined();
    });
  });

  describe('combineResults', () => {
    it('should combine results from multiple strategies', () => {
      const results = [
        [{ categoryId: 1, categoryPath: 'Tech', confidence: 0.8, method: 'rules', details: {} }],
        [{ categoryId: 1, categoryPath: 'Tech', confidence: 0.7, method: 'keywords', details: {} }],
        [{ categoryId: 2, categoryPath: 'Science', confidence: 0.9, method: 'ml', details: {} }],
        [{ categoryId: 1, categoryPath: 'Tech', confidence: 0.6, method: 'entities', details: {} }]
      ];

      const combined = engine.combineResults(results, ['rules', 'keywords', 'ml', 'entities']);

      expect(combined).toHaveLength(2);
      expect(combined[0].categoryId).toBe(1);
      expect(combined[0].methods).toContain('rules');
      expect(combined[0].methods).toContain('keywords');
      expect(combined[0].methods).toContain('entities');
      expect(combined[0].confidence).toBeGreaterThan(0.5);
    });
  });

  describe('updateStrategyWeights', () => {
    it('should update weights based on feedback', async () => {
      const feedback = [
        { method: 'rules', isCorrect: true },
        { method: 'rules', isCorrect: true },
        { method: 'rules', isCorrect: false },
        { method: 'ml', isCorrect: true },
        { method: 'ml', isCorrect: true },
        { method: 'keywords', isCorrect: false }
      ];

      await engine.updateStrategyWeights(feedback);

      // ML should have highest weight (100% accuracy)
      expect(engine.strategyWeights.ml).toBeGreaterThan(engine.strategyWeights.rules);
      expect(engine.strategyWeights.ml).toBeGreaterThan(engine.strategyWeights.keywords);
    });
  });

  describe('trainClassifier', () => {
    it('should train classifier with documents', async () => {
      const trainingData = [
        { content: 'JavaScript programming', categoryId: 1 },
        { content: 'Python machine learning', categoryId: 2 }
      ];

      mockCategoryManager.db.query.mockResolvedValue({ rows: [] });

      await engine.trainClassifier(trainingData);

      expect(engine.classifier).toBeDefined();
      expect(mockCategoryManager.db.query).toHaveBeenCalled();
    });
  });

  describe('basicEntityExtraction', () => {
    it('should extract capitalized words as entities', () => {
      const text = 'Apple Inc. announced new iPhone. Tim Cook presented at California event.';
      
      const entities = engine.basicEntityExtraction(text);

      expect(entities.organizations).toContain('Apple Inc.');
      expect(entities.people).toContain('Tim Cook');
      expect(entities.locations).toContain('California');
    });
  });

  describe('matchValue', () => {
    it('should match string patterns', () => {
      expect(engine.matchValue('hello world', 'world')).toBe(true);
      expect(engine.matchValue('hello world', 'foo')).toBe(false);
    });

    it('should match regex patterns', () => {
      expect(engine.matchValue('test123', /\d+/)).toBe(true);
      expect(engine.matchValue('test', /\d+/)).toBe(false);
    });

    it('should match operator conditions', () => {
      expect(engine.matchValue(10, { operator: '>', value: 5 })).toBe(true);
      expect(engine.matchValue(3, { operator: '>', value: 5 })).toBe(false);
      expect(engine.matchValue('test', { operator: 'contains', value: 'es' })).toBe(true);
    });

    it('should handle undefined and null values', () => {
      expect(engine.matchValue(undefined, 'test')).toBe(false);
      expect(engine.matchValue(null, 'test')).toBe(false);
      expect(engine.matchValue(undefined, /test/)).toBe(false);
      expect(engine.matchValue(null, { operator: '>', value: 5 })).toBe(false);
    });
  });
});