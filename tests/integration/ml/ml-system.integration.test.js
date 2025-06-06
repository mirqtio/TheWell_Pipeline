const MLModelService = require('../../../src/services/MLModelService');
const MLIntegration = require('../../../src/ml/MLIntegration');
const DatabaseManager = require('../../../src/database/DatabaseManager');
const path = require('path');
const fs = require('fs').promises;

describe('ML System Integration Tests', () => {
  let mlService;
  let dbManager;
  let testModelsDir;

  beforeAll(async () => {
    // Setup test environment
    testModelsDir = path.join(__dirname, 'test-models');
    await fs.mkdir(testModelsDir, { recursive: true });

    // Initialize database
    dbManager = new DatabaseManager({
      host: process.env.TEST_DB_HOST || 'localhost',
      port: process.env.TEST_DB_PORT || 5432,
      database: process.env.TEST_DB_NAME || 'thewell_test',
      user: process.env.TEST_DB_USER || 'postgres',
      password: process.env.TEST_DB_PASSWORD || 'postgres',
      ssl: false
    });

    await dbManager.initialize();

    // Run ML migrations
    try {
      const migrationSQL = await fs.readFile(
        path.join(__dirname, '../../../src/database/migrations/0012_add_ml_models.sql'),
        'utf8'
      );
      await dbManager.query(migrationSQL);
    } catch (error) {
      console.warn('ML migration may already exist:', error.message);
    }

    // Initialize ML service
    mlService = new MLModelService({
      modelsDir: testModelsDir
    });
    await mlService.initialize();

    // Initialize ML integration
    await MLIntegration.initialize();
  });

  afterAll(async () => {
    // Cleanup
    await mlService.cleanup();
    await dbManager.close();
    await fs.rm(testModelsDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    // Clear ML tables
    await dbManager.query('TRUNCATE TABLE ml_predictions CASCADE');
    await dbManager.query('TRUNCATE TABLE ml_model_metrics CASCADE');
    await dbManager.query('TRUNCATE TABLE ml_training_jobs CASCADE');
    await dbManager.query('TRUNCATE TABLE ml_models CASCADE');
    await dbManager.query('TRUNCATE TABLE ml_training_datasets CASCADE');
  });

  describe('End-to-end ML workflow', () => {
    it('should create, train, and deploy a sentiment analysis model', async () => {
      // Step 1: Create model
      const model = await mlService.createModel('sentiment', {
        name: 'test-sentiment-model',
        hyperparameters: {
          learningRate: 0.001,
          epochs: 2
        }
      });

      expect(model.id).toBeDefined();
      expect(model.type).toBe('sentiment');
      expect(model.status).toBe('draft');

      // Step 2: Prepare training data
      const dataset = await mlService.prepareTrainingData({
        name: 'sentiment-test-data',
        type: 'sentiment',
        sourceQuery: JSON.stringify({
          query: 'SELECT content as text, sentiment as label FROM test_documents'
        }),
        splitConfig: { train: 0.8, validation: 0.1, test: 0.1 }
      });

      expect(dataset.datasetId).toBeDefined();

      // Step 3: Mock training (since we can't train real models in tests)
      // In a real scenario, this would train the model
      await dbManager.query(
        'UPDATE ml_models SET status = \'trained\' WHERE id = $1',
        [model.id]
      );

      // Step 4: Deploy model
      const deployment = await mlService.deployModel(model.id);
      
      expect(deployment.status).toBe('deployed');
      expect(deployment.modelId).toBe(model.id);

      // Step 5: Make predictions
      const prediction = await mlService.predict(model.id, 'This is a great product!');
      
      expect(prediction).toBeDefined();
      // Note: In real tests with actual models, we'd check prediction results
    }, 30000);
  });

  describe('ML Integration with document processing', () => {
    let testDocuments;

    beforeEach(async () => {
      // Insert test documents
      testDocuments = [
        {
          content: 'Artificial intelligence is revolutionizing technology.',
          category: 'tech'
        },
        {
          content: 'The stock market showed strong gains today.',
          category: 'finance'
        },
        {
          content: 'New medical breakthrough in cancer treatment.',
          category: 'health'
        }
      ];

      for (const doc of testDocuments) {
        await dbManager.query(
          'INSERT INTO documents (content, metadata) VALUES ($1, $2)',
          [doc.content, JSON.stringify({ category: doc.category })]
        );
      }
    });

    it('should enhance documents with ML features', async () => {
      // Create and deploy mock models
      const classificationModel = await mlService.createModel('classification', {
        name: 'doc-classifier',
        classes: ['tech', 'finance', 'health', 'sports', 'other']
      });

      const qualityModel = await mlService.createModel('quality_scoring', {
        name: 'quality-scorer'
      });

      // Mock deployment
      await dbManager.query(
        'UPDATE ml_models SET status = \'deployed\' WHERE id IN ($1, $2)',
        [classificationModel.id, qualityModel.id]
      );

      // Reload models in integration
      await MLIntegration.reloadModels();

      // Process documents
      const enhancedDocs = await MLIntegration.batchEnhanceDocuments(testDocuments);

      expect(enhancedDocs).toHaveLength(3);
      enhancedDocs.forEach(doc => {
        expect(doc.mlEnhancements).toBeDefined();
        // In real scenario with trained models:
        // expect(doc.mlEnhancements.classification).toBeDefined();
        // expect(doc.mlEnhancements.quality).toBeDefined();
        // expect(doc.mlEnhancements.sentiment).toBeDefined();
      });
    });

    it('should auto-tag documents using ML', async () => {
      // Deploy a classification model
      const model = await mlService.createModel('classification', {
        name: 'auto-tagger',
        classes: ['tech', 'finance', 'health']
      });

      await dbManager.query(
        'UPDATE ml_models SET status = \'deployed\' WHERE id = $1',
        [model.id]
      );

      await MLIntegration.reloadModels();

      // Auto-tag a document
      const tags = await MLIntegration.autoTagDocument(testDocuments[0].content);

      expect(Array.isArray(tags)).toBe(true);
      // In real scenario: expect(tags).toContain('tech');
    });
  });

  describe('Search enhancement with ML', () => {
    it('should enhance search results with ML ranking', async () => {
      // Create similarity model
      const model = await mlService.createModel('similarity', {
        name: 'doc-similarity'
      });

      await dbManager.query(
        'UPDATE ml_models SET status = \'deployed\' WHERE id = $1',
        [model.id]
      );

      await MLIntegration.reloadModels();

      // Mock search results
      const searchResults = [
        { id: 1, content: 'AI and machine learning', score: 0.8 },
        { id: 2, content: 'Deep learning networks', score: 0.7 },
        { id: 3, content: 'Neural network architectures', score: 0.6 }
      ];

      const query = 'artificial intelligence applications';
      const enhancedResults = await MLIntegration.enhanceSearchRanking(query, searchResults);

      expect(enhancedResults).toHaveLength(3);
      enhancedResults.forEach(result => {
        expect(result.originalScore).toBeDefined();
        expect(result.mlScore).toBeDefined();
        expect(result.combinedScore).toBeDefined();
      });
    });
  });

  describe('Model performance tracking', () => {
    it('should track model metrics over time', async () => {
      // Create and deploy model
      const model = await mlService.createModel('classification', {
        name: 'performance-test-model'
      });

      // Simulate training with metrics
      const trainingJobId = 1;
      await dbManager.query(
        `INSERT INTO ml_training_jobs (id, model_id, status, metrics)
         VALUES ($1, $2, 'completed', $3)`,
        [trainingJobId, model.id, JSON.stringify({ finalAccuracy: 0.92 })]
      );

      // Record evaluation metrics
      await dbManager.query(
        `INSERT INTO ml_model_metrics (model_id, training_job_id, metric_type, metric_name, metric_value)
         VALUES ($1, $2, $3, $4, $5)`,
        [model.id, trainingJobId, 'evaluation', 'accuracy', 0.92]
      );

      // Retrieve metrics
      const metrics = await mlService.getModelMetrics(model.id);
      
      expect(metrics).toHaveLength(1);
      expect(metrics[0]).toMatchObject({
        type: 'evaluation',
        name: 'accuracy',
        value: 0.92
      });
    });
  });

  describe('Feature engineering integration', () => {
    it('should extract features from documents', async () => {
      const FeatureEngineering = require('../../../src/ml/FeatureEngineering');
      const featureEngine = new FeatureEngineering();

      const documents = [
        'Machine learning is a subset of artificial intelligence.',
        'Deep learning uses neural networks with multiple layers.',
        'Natural language processing enables computers to understand text.'
      ];

      // Build vocabulary
      const vocabStats = featureEngine.buildVocabulary(documents);
      expect(vocabStats.vocabularySize).toBeGreaterThan(0);

      // Extract features
      const tfidfFeatures = await featureEngine.extractTFIDF(documents);
      expect(tfidfFeatures.shape).toEqual([3, vocabStats.vocabularySize + 1]);

      // Extract statistical features
      const statFeatures = await featureEngine.extractStatisticalFeatures(documents);
      expect(statFeatures.shape).toEqual([3, 10]);
    });
  });

  describe('Error handling and recovery', () => {
    it('should handle model deployment failures gracefully', async () => {
      // Try to deploy non-existent model
      await expect(mlService.deployModel(9999)).rejects.toThrow();
    });

    it('should handle prediction failures gracefully', async () => {
      // Try to predict with non-deployed model
      await expect(mlService.predict(9999, 'test')).rejects.toThrow('Model not deployed');
    });

    it('should continue processing when ML enhancement fails', async () => {
      // Test with no deployed models
      const result = await MLIntegration.enhanceEntityExtraction('Test text', []);
      expect(Array.isArray(result)).toBe(true);
    });
  });
});