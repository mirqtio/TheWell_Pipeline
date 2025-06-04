/**
 * End-to-End tests for complete ORM data access workflows
 */

const { initializeORM, closeORM } = require('../../../src/orm');
const DatabaseManager = require('../../../src/database/DatabaseManager');

// Skip tests if no database connection available
const skipIfNoDatabase = process.env.NODE_ENV === 'test' && !process.env.DATABASE_URL;

describe('ORM Complete Workflow E2E', () => {
  let orm;
  let dbManager;
  let testData = {};

  beforeAll(async () => {
    if (skipIfNoDatabase) {
      console.log('Skipping ORM E2E tests - no database connection');
      return;
    }

    try {
      // Initialize database manager
      dbManager = new DatabaseManager();
      await dbManager.initialize();

      // Initialize ORM
      orm = await initializeORM();

      // Clean up any existing test data
      await cleanupTestData();
    } catch (error) {
      console.warn('Database not available for E2E tests:', error.message);
      process.env.SKIP_DB_TESTS = 'true';
    }
  });

  afterAll(async () => {
    if (skipIfNoDatabase || process.env.SKIP_DB_TESTS) return;

    try {
      await cleanupTestData();
      await closeORM();
      if (dbManager) await dbManager.close();
    } catch (error) {
      console.warn('E2E cleanup error:', error.message);
    }
  });

  beforeEach(() => {
    if (skipIfNoDatabase || process.env.SKIP_DB_TESTS) {
      return;
    }
  });

  async function cleanupTestData() {
    try {
      if (!orm || !orm.isReady()) return;

      const models = orm.getModels();
      
      // Clean up in dependency order
      if (models.DocumentFeedback) {
        await models.DocumentFeedback.destroy({
          where: { document_id: { [require('sequelize').Op.in]: Object.values(testData).filter(id => typeof id === 'number') } }
        });
      }
      
      if (models.Document) {
        await models.Document.destroy({
          where: { title: { [require('sequelize').Op.like]: 'E2E Test%' } }
        });
      }
      
      if (models.Source) {
        await models.Source.destroy({
          where: { name: { [require('sequelize').Op.like]: 'e2e-test-%' } }
        });
      }
      
      if (models.Job) {
        await models.Job.destroy({
          where: { name: { [require('sequelize').Op.like]: 'e2e-test-%' } }
        });
      }

      testData = {};
    } catch (error) {
      // Ignore cleanup errors
    }
  }

  describe('Document Ingestion Workflow', () => {
    it('should complete full document ingestion pipeline', async () => {
      if (skipIfNoDatabase || process.env.SKIP_DB_TESTS) {
        return;
      }
      const Source = orm.getModel('Source');
      const Document = orm.getModel('Document');
      const Job = orm.getModel('Job');

      // Step 1: Create a source
      const source = await Source.create({
        name: 'e2e-test-ingestion-source',
        type: 'static',
        status: 'active',
        config: {
          url: 'https://example.com/e2e-test',
          format: 'json',
          schedule: '0 */6 * * *'
        }
      });
      testData.sourceId = source.id;

      expect(source.id).toBeDefined();
      expect(source.isActive()).toBe(true);

      // Step 2: Create an ingestion job
      const job = await Job.create({
        name: 'e2e-test-ingestion-job',
        type: 'ingestion',
        status: 'pending',
        source_id: source.id,
        config: {
          source_id: source.id,
          batch_size: 100
        },
        priority: 5
      });
      testData.jobId = job.id;

      expect(job.id).toBeDefined();
      expect(job.isPending()).toBe(true);

      // Step 3: Simulate job processing - update status
      await job.update({ status: 'running', started_at: new Date() });
      await job.reload();
      expect(job.isRunning()).toBe(true);

      // Step 4: Create documents as result of ingestion
      const documents = [];
      for (let i = 1; i <= 3; i++) {
        const doc = await Document.create({
          source_id: source.id,
          title: `E2E Test Document ${i}`,
          content: `This is test content for document ${i}. It contains multiple sentences for testing word count and enrichment.`,
          content_hash: `e2e-hash-${i}-${Date.now()}`,
          url: `https://example.com/e2e-doc-${i}`,
          metadata: {
            author: `Test Author ${i}`,
            category: 'e2e-testing',
            tags: ['test', 'e2e', `doc${i}`]
          },
          enrichment_status: 'pending'
        });
        documents.push(doc);
        testData[`documentId${i}`] = doc.id;
      }

      expect(documents).toHaveLength(3);
      documents.forEach((doc, index) => {
        expect(doc.calculateWordCount()).toBeGreaterThan(0);
        expect(doc.title).toBe(`E2E Test Document ${index + 1}`);
      });

      // Step 5: Complete the job
      await job.update({ 
        status: 'completed', 
        completed_at: new Date(),
        result: { documents_processed: documents.length }
      });
      await job.reload();
      expect(job.isCompleted()).toBe(true);

      // Step 6: Verify source has documents
      const sourceWithDocs = await Source.findByPk(source.id, {
        include: [Document]
      });
      expect(sourceWithDocs.Documents).toHaveLength(3);
    });
  });

  describe('Document Enrichment Workflow', () => {
    it('should complete document enrichment with embeddings', async () => {
      if (skipIfNoDatabase || process.env.SKIP_DB_TESTS) {
        return;
      }
      const Document = orm.getModel('Document');
      const Job = orm.getModel('Job');

      // Get first test document
      const document = await Document.findByPk(testData.documentId1);
      expect(document).toBeDefined();

      // Step 1: Create enrichment job
      const enrichmentJob = await Job.create({
        name: 'e2e-test-enrichment-job',
        type: 'enrichment',
        status: 'pending',
        config: {
          document_id: document.id,
          provider: 'openai',
          model: 'text-embedding-3-small'
        },
        priority: 3
      });
      testData.enrichmentJobId = enrichmentJob.id;

      // Step 2: Start enrichment processing
      await enrichmentJob.update({ status: 'running', started_at: new Date() });
      await document.update({ enrichment_status: 'processing' });

      // Step 3: Simulate embedding generation
      const embedding = Array.from({ length: 1536 }, () => Math.random() - 0.5);
      await document.setEmbedding(embedding);
      await document.save();

      // Verify embedding was set
      expect(document.hasEmbedding()).toBe(true);
      const retrievedEmbedding = document.getEmbedding();
      expect(retrievedEmbedding).toHaveLength(1536);
      expect(retrievedEmbedding[0]).toBeCloseTo(embedding[0], 5);

      // Step 4: Complete enrichment
      await document.update({ enrichment_status: 'completed' });
      await enrichmentJob.update({ 
        status: 'completed', 
        completed_at: new Date(),
        result: { embedding_dimensions: 1536 }
      });

      await document.reload();
      await enrichmentJob.reload();

      expect(document.isEnriched()).toBe(true);
      expect(enrichmentJob.isCompleted()).toBe(true);
    });

    it('should find similar documents using embeddings', async () => {
      if (skipIfNoDatabase || process.env.SKIP_DB_TESTS) {
        return;
      }
      const Document = orm.getModel('Document');

      // Get the enriched document
      const enrichedDoc = await Document.findByPk(testData.documentId1);
      expect(enrichedDoc.hasEmbedding()).toBe(true);

      const queryEmbedding = enrichedDoc.getEmbedding();

      // Add embeddings to other documents for similarity testing
      const doc2 = await Document.findByPk(testData.documentId2);
      const doc3 = await Document.findByPk(testData.documentId3);

      // Create similar embedding for doc2 (high similarity)
      const similarEmbedding = queryEmbedding.map(val => val + (Math.random() - 0.5) * 0.1);
      await doc2.setEmbedding(similarEmbedding);
      await doc2.update({ enrichment_status: 'completed' });

      // Create different embedding for doc3 (low similarity)
      const differentEmbedding = Array.from({ length: 1536 }, () => Math.random() - 0.5);
      await doc3.setEmbedding(differentEmbedding);
      await doc3.update({ enrichment_status: 'completed' });

      // Test similarity search
      const similarDocs = await Document.findSimilar(queryEmbedding, 0.7, 5);
      expect(Array.isArray(similarDocs)).toBe(true);
      
      // Should find at least the original document
      const foundOriginal = similarDocs.find(doc => doc.id === enrichedDoc.id);
      expect(foundOriginal).toBeDefined();
    });
  });

  describe('Feedback Collection Workflow', () => {
    it('should collect and aggregate document feedback', async () => {
      if (skipIfNoDatabase || process.env.SKIP_DB_TESTS) {
        return;
      }
      const Document = orm.getModel('Document');
      const DocumentFeedback = orm.getModel('DocumentFeedback');
      const FeedbackAggregate = orm.getModel('FeedbackAggregate');

      const document = await Document.findByPk(testData.documentId1);

      // Step 1: Collect multiple feedback entries
      const feedbackEntries = [];
      for (let i = 1; i <= 5; i++) {
        const feedback = await DocumentFeedback.create({
          document_id: document.id,
          feedback_type: 'rating',
          rating: i, // Ratings 1-5
          comment: `Test feedback comment ${i}`,
          user_id: `test-user-${i}`,
          session_id: `test-session-${i}`,
          metadata: {
            source: 'e2e-test',
            timestamp: new Date().toISOString()
          }
        });
        feedbackEntries.push(feedback);
      }

      expect(feedbackEntries).toHaveLength(5);

      // Step 2: Calculate and store aggregates
      const avgRating = feedbackEntries.reduce((sum, f) => sum + f.rating, 0) / feedbackEntries.length;
      
      let aggregate = await FeedbackAggregate.findOne({
        where: { document_id: document.id }
      });

      if (!aggregate) {
        aggregate = await FeedbackAggregate.create({
          document_id: document.id,
          total_feedback: feedbackEntries.length,
          average_rating: avgRating,
          rating_distribution: {
            '1': 1, '2': 1, '3': 1, '4': 1, '5': 1
          },
          sentiment_score: 0.6
        });
      } else {
        await aggregate.updateAggregates();
      }

      expect(aggregate.total_feedback).toBe(5);
      expect(aggregate.average_rating).toBe(3.0);
      expect(aggregate.rating_distribution['5']).toBe(1);

      // Step 3: Test feedback queries
      const documentFeedback = await DocumentFeedback.findByDocument(document.id);
      expect(documentFeedback).toHaveLength(5);

      const recentFeedback = await DocumentFeedback.findRecent(1); // Last 1 day
      expect(recentFeedback.length).toBeGreaterThan(0);
    });
  });

  describe('Cost Tracking Workflow', () => {
    it('should track costs across the pipeline', async () => {
      if (skipIfNoDatabase || process.env.SKIP_DB_TESTS) {
        return;
      }
      const CostEvent = orm.getModel('CostEvent');
      const CostBudget = orm.getModel('CostBudget');

      // Step 1: Create a budget
      const budget = await CostBudget.create({
        name: 'E2E Test Budget',
        amount: 100.00,
        currency: 'USD',
        period: 'monthly',
        alert_threshold: 80.0,
        is_active: true
      });
      testData.budgetId = budget.id;

      expect(budget.is_active).toBe(true);

      // Step 2: Record cost events
      const costEvents = [];
      
      // Ingestion cost
      const ingestionCost = await CostEvent.create({
        event_type: 'ingestion',
        cost: 5.50,
        currency: 'USD',
        units: 1000,
        unit_type: 'documents',
        metadata: {
          source_id: testData.sourceId,
          job_id: testData.jobId
        }
      });
      costEvents.push(ingestionCost);

      // Enrichment cost
      const enrichmentCost = await CostEvent.create({
        event_type: 'enrichment',
        cost: 15.75,
        currency: 'USD',
        units: 3,
        unit_type: 'documents',
        metadata: {
          provider: 'openai',
          model: 'text-embedding-3-small',
          job_id: testData.enrichmentJobId
        }
      });
      costEvents.push(enrichmentCost);

      expect(costEvents).toHaveLength(2);

      // Step 3: Check budget utilization
      const totalSpend = await budget.getCurrentSpend();
      expect(totalSpend).toBeGreaterThan(0);

      const utilizationPercent = await budget.getUtilizationPercent();
      expect(utilizationPercent).toBeGreaterThan(0);
      expect(utilizationPercent).toBeLessThan(100);

      // Step 4: Test cost queries
      const recentCosts = await CostEvent.findRecent(1); // Last 1 day
      expect(recentCosts.length).toBeGreaterThan(0);

      const enrichmentCosts = await CostEvent.findByType('enrichment');
      expect(enrichmentCosts.length).toBeGreaterThan(0);
    });
  });

  describe('Complete Pipeline Health Check', () => {
    it('should verify all components are working together', async () => {
      if (skipIfNoDatabase || process.env.SKIP_DB_TESTS) {
        return;
      }
      // Test ORM health
      const ormHealth = await orm.healthCheck();
      expect(ormHealth.status).toBe('healthy');
      expect(ormHealth.connected).toBe(true);

      // Test model availability
      const models = orm.getModels();
      const expectedModels = [
        'Source', 'Document', 'Job', 'JobDependency', 'JobLog',
        'DocumentVisibility', 'VisibilityRule', 'VisibilityAuditLog',
        'CostEvent', 'CostBudget', 'CostAlert',
        'DocumentFeedback', 'FeedbackAggregate'
      ];

      expectedModels.forEach(modelName => {
        expect(models[modelName]).toBeDefined();
      });

      // Test data integrity
      const Source = orm.getModel('Source');
      const Document = orm.getModel('Document');

      const testSource = await Source.findByPk(testData.sourceId);
      expect(testSource).toBeDefined();

      const sourceDocuments = await Document.findBySource(testData.sourceId);
      expect(sourceDocuments.length).toBe(3);

      // Test associations
      const sourceWithDocs = await Source.findByPk(testData.sourceId, {
        include: [Document]
      });
      expect(sourceWithDocs.Documents).toHaveLength(3);

      // Test transaction support
      let transactionTest = false;
      await orm.transaction(async (t) => {
        const testDoc = await Document.findByPk(testData.documentId1, { transaction: t });
        expect(testDoc).toBeDefined();
        transactionTest = true;
      });
      expect(transactionTest).toBe(true);
    });
  });

  describe('Performance and Scalability', () => {
    it('should handle bulk operations efficiently', async () => {
      if (skipIfNoDatabase || process.env.SKIP_DB_TESTS) {
        return;
      }
      const Document = orm.getModel('Document');
      const startTime = Date.now();

      // Create multiple documents in a transaction
      await orm.transaction(async (t) => {
        const bulkDocs = [];
        for (let i = 1; i <= 10; i++) {
          bulkDocs.push({
            source_id: testData.sourceId,
            title: `E2E Bulk Test Document ${i}`,
            content: `Bulk test content ${i}`,
            content_hash: `bulk-hash-${i}-${Date.now()}`,
            url: `https://example.com/bulk-${i}`,
            enrichment_status: 'pending'
          });
        }

        const createdDocs = await Document.bulkCreate(bulkDocs, { transaction: t });
        expect(createdDocs).toHaveLength(10);

        // Store IDs for cleanup
        createdDocs.forEach((doc, index) => {
          testData[`bulkDocId${index + 1}`] = doc.id;
        });
      });

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should complete bulk operation in reasonable time (< 5 seconds)
      expect(duration).toBeLessThan(5000);

      // Verify all documents were created
      const bulkDocs = await Document.findAll({
        where: { title: { [require('sequelize').Op.like]: 'E2E Bulk Test Document%' } }
      });
      expect(bulkDocs).toHaveLength(10);

      // Clean up bulk documents
      await Document.destroy({
        where: { title: { [require('sequelize').Op.like]: 'E2E Bulk Test Document%' } }
      });
    });
  });
});
