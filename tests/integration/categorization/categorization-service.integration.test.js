const CategorizationService = require('../../../src/services/CategorizationService');
const DatabaseManager = require('../../../src/database/DatabaseManager');
const EmbeddingService = require('../../../src/enrichment/EmbeddingService');
const OpenAIProvider = require('../../../src/enrichment/providers/OpenAIProvider');
const { createTestDatabase, cleanupTestDatabase } = require('../../helpers/database');

describe('CategorizationService Integration', () => {
  let categorizationService;
  let database;
  let embeddingService;
  let llmProvider;
  let testDbName;

  beforeAll(async () => {
    // Create test database
    testDbName = await createTestDatabase();
    
    // Initialize services
    database = new DatabaseManager({
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 5432,
      database: testDbName,
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres'
    });

    await database.initialize();

    // Run migrations
    const migrationManager = database.getMigrationManager();
    await migrationManager.runMigrations();

    // Initialize LLM provider
    llmProvider = new OpenAIProvider({
      apiKey: process.env.OPENAI_API_KEY || 'test-key',
      model: 'gpt-3.5-turbo'
    });

    // Initialize embedding service
    embeddingService = new EmbeddingService({
      provider: 'openai',
      apiKey: process.env.OPENAI_API_KEY || 'test-key'
    });

    // Initialize categorization service
    categorizationService = new CategorizationService({
      database,
      embeddingService,
      llmProvider
    });

    await categorizationService.initialize();
  });

  afterAll(async () => {
    await database.close();
    await cleanupTestDatabase(testDbName);
  });

  describe('Category Management', () => {
    it('should create and retrieve categories', async () => {
      // Create root category
      const rootCategory = await categorizationService.categoryManager.createCategory({
        name: 'Technology',
        description: 'Technology topics'
      });

      expect(rootCategory.id).toBeDefined();
      expect(rootCategory.path).toBe('Technology');
      expect(rootCategory.depth).toBe(0);

      // Create child category
      const childCategory = await categorizationService.categoryManager.createCategory({
        name: 'Artificial Intelligence',
        description: 'AI and ML topics',
        parentId: rootCategory.id
      });

      expect(childCategory.path).toBe('Technology/Artificial Intelligence');
      expect(childCategory.depth).toBe(1);

      // Retrieve categories
      const categories = await categorizationService.categoryManager.getCategories();
      expect(categories.length).toBeGreaterThanOrEqual(2);
    });

    it('should create categories with rules', async () => {
      const category = await categorizationService.categoryManager.createCategory({
        name: 'Programming',
        description: 'Programming languages and concepts',
        rules: [
          {
            type: 'contains',
            pattern: 'javascript,python,java,programming',
            confidence: 0.8
          },
          {
            type: 'regex',
            pattern: '\\b(code|coding|developer|software)\\b',
            confidence: 0.7
          }
        ]
      });

      const rules = await categorizationService.categoryManager.getCategoryRules(category.id);
      expect(rules).toHaveLength(2);
      expect(rules[0].rule_type).toBe('contains');
      expect(rules[1].rule_type).toBe('regex');
    });

    it('should build category hierarchy', async () => {
      const hierarchy = await categorizationService.categoryManager.getCategoryHierarchy();
      
      expect(hierarchy).toBeDefined();
      expect(Array.isArray(hierarchy)).toBe(true);
      
      // Find Technology category
      const techCategory = hierarchy.find(c => c.name === 'Technology');
      expect(techCategory).toBeDefined();
      expect(techCategory.children).toBeDefined();
      expect(techCategory.children.length).toBeGreaterThan(0);
    });
  });

  describe('Document Categorization', () => {
    let documentId;

    beforeAll(async () => {
      // Insert a test document
      const result = await database.query(
        `INSERT INTO documents (title, content, source_type, metadata) 
         VALUES ($1, $2, $3, $4) 
         RETURNING id`,
        [
          'Introduction to Machine Learning',
          'Machine learning is a subset of artificial intelligence that enables systems to learn and improve from experience. This article covers supervised learning, unsupervised learning, and neural networks.',
          'article',
          JSON.stringify({ author: 'Test Author' })
        ]
      );
      documentId = result.rows[0].id;
    });

    it('should categorize a document', async () => {
      const categories = await categorizationService.categorizeDocument(documentId, {
        threshold: 0.5,
        maxCategories: 3
      });

      expect(categories).toBeDefined();
      expect(Array.isArray(categories)).toBe(true);
      
      // Should find AI-related categories
      const aiCategory = categories.find(c => 
        c.categoryPath && c.categoryPath.toLowerCase().includes('artificial')
      );
      expect(aiCategory).toBeDefined();
      expect(aiCategory.confidence).toBeGreaterThan(0.5);
      expect(aiCategory.explanation).toBeDefined();
    });

    it('should store categorization results', async () => {
      const result = await database.query(
        'SELECT * FROM document_categories WHERE document_id = $1',
        [documentId]
      );

      expect(result.rows.length).toBeGreaterThan(0);
      expect(result.rows[0].confidence).toBeDefined();
      expect(result.rows[0].method).toBeDefined();
    });

    it('should suggest categories for a document', async () => {
      const suggestions = await categorizationService.suggestCategories(documentId, 5);

      expect(suggestions).toBeDefined();
      expect(Array.isArray(suggestions)).toBe(true);
      expect(suggestions.length).toBeLessThanOrEqual(5);
      
      if (suggestions.length > 0) {
        expect(suggestions[0]).toHaveProperty('categoryId');
        expect(suggestions[0]).toHaveProperty('confidence');
        expect(suggestions[0]).toHaveProperty('usageCount');
        expect(suggestions[0]).toHaveProperty('popularity');
      }
    });
  });

  describe('Real-time Categorization', () => {
    it('should categorize content in real-time', async () => {
      const content = {
        text: 'Python is a popular programming language for data science and machine learning applications.',
        title: 'Python for Data Science',
        metadata: { type: 'tutorial' }
      };

      const categories = await categorizationService.categorizeRealtime(content, {
        threshold: 0.4
      });

      expect(categories).toBeDefined();
      expect(Array.isArray(categories)).toBe(true);
      
      // Should find programming-related categories
      const programmingCategory = categories.find(c => 
        c.categoryPath && c.categoryPath.toLowerCase().includes('programming')
      );
      expect(programmingCategory).toBeDefined();
    });
  });

  describe('Feedback System', () => {
    let documentId;
    let categoryId;

    beforeAll(async () => {
      // Create a document and categorize it
      const docResult = await database.query(
        `INSERT INTO documents (title, content, source_type) 
         VALUES ($1, $2, $3) 
         RETURNING id`,
        ['Test Document', 'Test content about programming', 'test']
      );
      documentId = docResult.rows[0].id;

      const categories = await categorizationService.categorizeDocument(documentId);
      if (categories.length > 0) {
        categoryId = categories[0].categoryId;
      }
    });

    it('should accept categorization feedback', async () => {
      if (!categoryId) {
        console.log('No category assigned, skipping feedback test');
        return;
      }

      const feedback = {
        type: 'accept',
        isCorrect: true,
        metadata: { reason: 'Accurate categorization' }
      };

      const result = await categorizationService.submitFeedback(
        documentId,
        categoryId,
        feedback
      );

      expect(result.success).toBe(true);
      expect(result.feedbackId).toBeDefined();

      // Verify feedback was recorded
      const feedbackRecord = await database.query(
        'SELECT * FROM categorization_feedback WHERE id = $1',
        [result.feedbackId]
      );

      expect(feedbackRecord.rows).toHaveLength(1);
      expect(feedbackRecord.rows[0].feedback_type).toBe('accept');
      expect(feedbackRecord.rows[0].is_correct).toBe(true);
    });

    it('should update document-category relationship based on feedback', async () => {
      if (!categoryId) {
        console.log('No category assigned, skipping relationship test');
        return;
      }

      // Check that the category is now marked as manual
      const result = await database.query(
        'SELECT * FROM document_categories WHERE document_id = $1 AND category_id = $2',
        [documentId, categoryId]
      );

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].is_manual).toBe(true);
      expect(result.rows[0].confidence).toBe(1.0);
    });
  });

  describe('Batch Processing', () => {
    let documentIds = [];

    beforeAll(async () => {
      // Create multiple test documents
      for (let i = 0; i < 5; i++) {
        const result = await database.query(
          `INSERT INTO documents (title, content, source_type) 
           VALUES ($1, $2, $3) 
           RETURNING id`,
          [
            `Test Document ${i}`,
            `Content about ${i % 2 === 0 ? 'programming' : 'science'}`,
            'test'
          ]
        );
        documentIds.push(result.rows[0].id);
      }
    });

    it('should batch categorize documents', async () => {
      const { results, errors } = await categorizationService.batchCategorize(documentIds);

      expect(results).toBeDefined();
      expect(errors).toBeDefined();
      expect(results.length + errors.length).toBe(documentIds.length);
      
      // Most documents should be successfully categorized
      expect(results.length).toBeGreaterThan(0);
      
      if (results.length > 0) {
        expect(results[0]).toHaveProperty('documentId');
        expect(results[0]).toHaveProperty('categories');
      }
    });
  });

  describe('Analytics', () => {
    it('should generate categorization analytics', async () => {
      const analytics = await categorizationService.getAnalytics({
        startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        endDate: new Date()
      });

      expect(analytics).toBeDefined();
      expect(analytics).toHaveProperty('summary');
      expect(analytics).toHaveProperty('accuracy');
      expect(analytics).toHaveProperty('performance');
      expect(analytics).toHaveProperty('trends');
      expect(analytics).toHaveProperty('topCategories');
    });

    it('should get category-specific analytics', async () => {
      // Get a category that has documents
      const categories = await categorizationService.categoryManager.getCategories();
      if (categories.length === 0) {
        console.log('No categories available, skipping analytics test');
        return;
      }

      const analytics = await categorizationService.getAnalytics({
        categoryId: categories[0].id,
        startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        endDate: new Date()
      });

      expect(analytics.categoryDetail).toBeDefined();
      expect(analytics.categoryDetail).toHaveProperty('usage');
      expect(analytics.categoryDetail).toHaveProperty('accuracy');
      expect(analytics.categoryDetail).toHaveProperty('distribution');
      expect(analytics.categoryDetail).toHaveProperty('related');
    });
  });

  describe('Export/Import', () => {
    it('should export and import category structure', async () => {
      // Export current structure
      const exportData = await categorizationService.categoryManager.exportCategories();

      expect(exportData).toBeDefined();
      expect(exportData.version).toBe('1.0');
      expect(exportData.categories).toBeDefined();
      expect(exportData.rules).toBeDefined();

      // Create a new category to test import
      const newExportData = {
        version: '1.0',
        categories: [
          {
            name: 'Imported Category',
            description: 'Test import',
            path: 'Imported Category',
            depth: 0,
            metadata: { imported: true },
            children: []
          }
        ],
        rules: []
      };

      const importResult = await categorizationService.categoryManager.importCategories(
        newExportData,
        'skip'
      );

      expect(importResult.success).toBe(true);
      expect(importResult.imported).toBe(1);

      // Verify imported category exists
      const importedCategories = await categorizationService.categoryManager.searchCategories('Imported');
      expect(importedCategories.length).toBeGreaterThan(0);
    });
  });

  describe('Performance', () => {
    it('should handle concurrent categorization requests', async () => {
      const documentIds = [];
      
      // Create test documents
      for (let i = 0; i < 10; i++) {
        const result = await database.query(
          `INSERT INTO documents (title, content, source_type) 
           VALUES ($1, $2, $3) 
           RETURNING id`,
          [`Concurrent Test ${i}`, 'Test content', 'test']
        );
        documentIds.push(result.rows[0].id);
      }

      // Categorize concurrently
      const startTime = Date.now();
      const promises = documentIds.map(id => 
        categorizationService.categorizeDocument(id, { threshold: 0.7 })
      );

      const results = await Promise.allSettled(promises);
      const endTime = Date.now();

      // All should complete
      const successful = results.filter(r => r.status === 'fulfilled').length;
      expect(successful).toBe(documentIds.length);

      // Should complete in reasonable time (less than 10 seconds for 10 documents)
      expect(endTime - startTime).toBeLessThan(10000);
    });
  });
});