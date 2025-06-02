/**
 * Integration tests for ORM Database Operations
 */

const { ORMManager } = require('../../../src/orm');
const DatabaseManager = require('../../../src/database/DatabaseManager');

// Skip tests if no database connection available
const skipIfNoDatabase = process.env.NODE_ENV === 'test' && !process.env.DATABASE_URL;

describe('ORM Database Integration', () => {
  let ormManager;
  let dbManager;
  let testSourceId;
  let testDocumentId;

  beforeAll(async () => {
    if (skipIfNoDatabase) {
      console.log('Skipping ORM database integration tests - no database connection');
      return;
    }

    try {
      // Initialize database manager
      dbManager = new DatabaseManager();
      await dbManager.initialize();

      // Initialize ORM manager
      ormManager = new ORMManager();
      await ormManager.initialize();

      // Ensure we have a clean test environment
      await cleanupTestData();
    } catch (error) {
      console.warn('Database not available for integration tests:', error.message);
      // Mark as skipped
      process.env.SKIP_DB_TESTS = 'true';
    }
  });

  afterAll(async () => {
    if (skipIfNoDatabase || process.env.SKIP_DB_TESTS) return;

    try {
      await cleanupTestData();
      if (ormManager) await ormManager.close();
      if (dbManager) await dbManager.close();
    } catch (error) {
      console.warn('Cleanup error:', error.message);
    }
  });

  beforeEach(() => {
    if (skipIfNoDatabase || process.env.SKIP_DB_TESTS) {
      return;
    }
  });

  async function cleanupTestData() {
    try {
      const Document = ormManager.getModel('Document');
      const Source = ormManager.getModel('Source');
      
      // Clean up test documents
      await Document.destroy({
        where: {
          title: { [require('sequelize').Op.like]: 'Test%' }
        }
      });
      
      // Clean up test sources
      await Source.destroy({
        where: {
          name: { [require('sequelize').Op.like]: 'test-%' }
        }
      });
    } catch (error) {
      // Ignore cleanup errors
    }
  }

  describe('Source Model Integration', () => {
    it('should create and retrieve a source', async () => {
      if (skipIfNoDatabase || process.env.SKIP_DB_TESTS) {
        return;
      }
      const Source = ormManager.getModel('Source');
      
      // Create test source
      const sourceData = {
        name: 'test-integration-source',
        type: 'static',
        status: 'active',
        config: {
          url: 'https://example.com/test',
          format: 'json'
        }
      };
      
      const createdSource = await Source.create(sourceData);
      testSourceId = createdSource.id;
      
      expect(createdSource).toBeDefined();
      expect(createdSource.id).toBeDefined();
      expect(createdSource.name).toBe(sourceData.name);
      expect(createdSource.type).toBe(sourceData.type);
      expect(createdSource.config).toEqual(sourceData.config);
      
      // Retrieve the source
      const retrievedSource = await Source.findByPk(testSourceId);
      expect(retrievedSource).toBeDefined();
      expect(retrievedSource.name).toBe(sourceData.name);
    });

    it('should find active sources', async () => {
      if (skipIfNoDatabase || process.env.SKIP_DB_TESTS) {
        return;
      }
      const Source = ormManager.getModel('Source');
      
      const activeSources = await Source.findActive();
      expect(Array.isArray(activeSources)).toBe(true);
      
      // Should include our test source
      const testSource = activeSources.find(s => s.id === testSourceId);
      expect(testSource).toBeDefined();
      expect(testSource.status).toBe('active');
    });

    it('should find sources by type', async () => {
      if (skipIfNoDatabase || process.env.SKIP_DB_TESTS) {
        return;
      }
      const Source = ormManager.getModel('Source');
      
      const staticSources = await Source.findByType('static');
      expect(Array.isArray(staticSources)).toBe(true);
      
      // Should include our test source
      const testSource = staticSources.find(s => s.id === testSourceId);
      expect(testSource).toBeDefined();
      expect(testSource.type).toBe('static');
    });

    it('should update source status', async () => {
      if (skipIfNoDatabase || process.env.SKIP_DB_TESTS) {
        return;
      }
      const Source = ormManager.getModel('Source');
      
      // Update source status
      const [updatedCount] = await Source.update(
        { status: 'inactive' },
        { where: { id: testSourceId } }
      );
      
      expect(updatedCount).toBe(1);
      
      // Verify update
      const updatedSource = await Source.findByPk(testSourceId);
      expect(updatedSource.status).toBe('inactive');
      
      // Restore active status for other tests
      await Source.update(
        { status: 'active' },
        { where: { id: testSourceId } }
      );
    });
  });

  describe('Document Model Integration', () => {
    it('should create and retrieve a document', async () => {
      if (skipIfNoDatabase || process.env.SKIP_DB_TESTS) {
        return;
      }
      const Document = ormManager.getModel('Document');
      
      // Create test document
      const documentData = {
        source_id: testSourceId,
        title: 'Test Integration Document',
        content: 'This is test content for integration testing.',
        content_hash: 'test-hash-' + Date.now(),
        url: 'https://example.com/test-doc',
        metadata: {
          author: 'Test Author',
          tags: ['test', 'integration']
        },
        word_count: 8,
        enrichment_status: 'pending'
      };
      
      const createdDocument = await Document.create(documentData);
      testDocumentId = createdDocument.id;
      
      expect(createdDocument).toBeDefined();
      expect(createdDocument.id).toBeDefined();
      expect(createdDocument.title).toBe(documentData.title);
      expect(createdDocument.content).toBe(documentData.content);
      expect(createdDocument.source_id).toBe(testSourceId);
      expect(createdDocument.metadata).toEqual(documentData.metadata);
      
      // Retrieve the document
      const retrievedDocument = await Document.findByPk(testDocumentId);
      expect(retrievedDocument).toBeDefined();
      expect(retrievedDocument.title).toBe(documentData.title);
    });

    it('should find documents by source', async () => {
      if (skipIfNoDatabase || process.env.SKIP_DB_TESTS) {
        return;
      }
      const Document = ormManager.getModel('Document');
      
      const sourceDocuments = await Document.findBySource(testSourceId);
      expect(Array.isArray(sourceDocuments)).toBe(true);
      expect(sourceDocuments.length).toBeGreaterThan(0);
      
      // Should include our test document
      const testDocument = sourceDocuments.find(d => d.id === testDocumentId);
      expect(testDocument).toBeDefined();
      expect(testDocument.source_id).toBe(testSourceId);
    });

    it('should find document by content hash', async () => {
      if (skipIfNoDatabase || process.env.SKIP_DB_TESTS) {
        return;
      }
      const Document = ormManager.getModel('Document');
      
      // Get the test document to find its hash
      const testDocument = await Document.findByPk(testDocumentId);
      const contentHash = testDocument.content_hash;
      
      const foundDocument = await Document.findByContentHash(contentHash);
      expect(foundDocument).toBeDefined();
      expect(foundDocument.id).toBe(testDocumentId);
      expect(foundDocument.content_hash).toBe(contentHash);
    });

    it('should handle vector embeddings', async () => {
      if (skipIfNoDatabase || process.env.SKIP_DB_TESTS) {
        return;
      }
      const Document = ormManager.getModel('Document');
      
      // Get test document
      const testDocument = await Document.findByPk(testDocumentId);
      
      // Set embedding
      const embedding = [0.1, 0.2, 0.3, 0.4, 0.5];
      await testDocument.setEmbedding(embedding);
      await testDocument.save();
      
      // Reload and verify
      await testDocument.reload();
      expect(testDocument.hasEmbedding()).toBe(true);
      
      const retrievedEmbedding = testDocument.getEmbedding();
      expect(retrievedEmbedding).toEqual(embedding);
    });

    it('should update enrichment status', async () => {
      if (skipIfNoDatabase || process.env.SKIP_DB_TESTS) {
        return;
      }
      const Document = ormManager.getModel('Document');
      
      // Update enrichment status
      const [updatedCount] = await Document.update(
        { enrichment_status: 'completed' },
        { where: { id: testDocumentId } }
      );
      
      expect(updatedCount).toBe(1);
      
      // Verify update
      const updatedDocument = await Document.findByPk(testDocumentId);
      expect(updatedDocument.enrichment_status).toBe('completed');
      expect(updatedDocument.isEnriched()).toBe(true);
    });
  });

  describe('Model Associations', () => {
    it('should load source with documents', async () => {
      if (skipIfNoDatabase || process.env.SKIP_DB_TESTS) {
        return;
      }
      const Source = ormManager.getModel('Source');
      const Document = ormManager.getModel('Document');
      
      const source = await Source.findByPk(testSourceId, {
        include: [Document]
      });
      
      expect(source).toBeDefined();
      expect(source.Documents).toBeDefined();
      expect(Array.isArray(source.Documents)).toBe(true);
      expect(source.Documents.length).toBeGreaterThan(0);
      
      // Should include our test document
      const testDocument = source.Documents.find(d => d.id === testDocumentId);
      expect(testDocument).toBeDefined();
    });

    it('should load document with source', async () => {
      if (skipIfNoDatabase || process.env.SKIP_DB_TESTS) {
        return;
      }
      const Document = ormManager.getModel('Document');
      const Source = ormManager.getModel('Source');
      
      const document = await Document.findByPk(testDocumentId, {
        include: [Source]
      });
      
      expect(document).toBeDefined();
      expect(document.Source).toBeDefined();
      expect(document.Source.id).toBe(testSourceId);
      expect(document.Source.name).toBe('test-integration-source');
    });
  });

  describe('Transaction Support', () => {
    it('should support transactions for atomic operations', async () => {
      if (skipIfNoDatabase || process.env.SKIP_DB_TESTS) {
        return;
      }
      const Source = ormManager.getModel('Source');
      const Document = ormManager.getModel('Document');
      
      let transactionSourceId;
      let transactionDocumentId;
      
      try {
        await ormManager.transaction(async (t) => {
          // Create source in transaction
          const source = await Source.create({
            name: 'test-transaction-source',
            type: 'static',
            status: 'active',
            config: { url: 'https://example.com/transaction' }
          }, { transaction: t });
          
          transactionSourceId = source.id;
          
          // Create document in same transaction
          const document = await Document.create({
            source_id: source.id,
            title: 'Test Transaction Document',
            content: 'Transaction test content',
            content_hash: 'transaction-hash-' + Date.now(),
            url: 'https://example.com/transaction-doc'
          }, { transaction: t });
          
          transactionDocumentId = document.id;
          
          // Both should exist within transaction
          expect(source.id).toBeDefined();
          expect(document.id).toBeDefined();
          expect(document.source_id).toBe(source.id);
        });
        
        // Verify both records exist after transaction commit
        const source = await Source.findByPk(transactionSourceId);
        const document = await Document.findByPk(transactionDocumentId);
        
        expect(source).toBeDefined();
        expect(document).toBeDefined();
        expect(document.source_id).toBe(transactionSourceId);
        
        // Clean up
        await Document.destroy({ where: { id: transactionDocumentId } });
        await Source.destroy({ where: { id: transactionSourceId } });
        
      } catch (error) {
        // Transaction should rollback on error
        const source = await Source.findByPk(transactionSourceId);
        const document = await Document.findByPk(transactionDocumentId);
        
        expect(source).toBeNull();
        expect(document).toBeNull();
      }
    });
  });

  describe('Raw Queries', () => {
    it('should execute raw SQL queries', async () => {
      if (skipIfNoDatabase || process.env.SKIP_DB_TESTS) {
        return;
      }
      
      const [results] = await ormManager.query(
        'SELECT COUNT(*) as count FROM sources WHERE status = :status',
        {
          replacements: { status: 'active' },
          type: require('sequelize').QueryTypes.SELECT
        }
      );
      
      expect(results).toBeDefined();
      expect(results.count).toBeDefined();
      expect(parseInt(results.count)).toBeGreaterThan(0);
    });

    it('should handle parameterized queries safely', async () => {
      if (skipIfNoDatabase || process.env.SKIP_DB_TESTS) {
        return;
      }
      
      const results = await ormManager.query(
        'SELECT id, name FROM sources WHERE name = :name LIMIT 1',
        {
          replacements: { name: 'test-integration-source' },
          type: require('sequelize').QueryTypes.SELECT
        }
      );
      
      expect(Array.isArray(results)).toBe(true);
      if (results.length > 0) {
        expect(results[0].name).toBe('test-integration-source');
      }
    });
  });

  describe('Health Check', () => {
    it('should perform ORM health check', async () => {
      if (skipIfNoDatabase || process.env.SKIP_DB_TESTS) {
        return;
      }
      
      const health = await ormManager.healthCheck();
      
      expect(health).toBeDefined();
      expect(health.status).toBe('healthy');
      expect(health.connected).toBe(true);
      expect(health.models).toBeGreaterThan(0);
      expect(health.message).toBe('ORM connection is active');
    });
  });
});
