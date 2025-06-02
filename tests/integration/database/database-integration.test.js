// Unmock pg for integration tests that require real database connections
jest.unmock('pg');

const DatabaseManager = require('../../../src/database/DatabaseManager');
const DocumentDAO = require('../../../src/database/DocumentDAO');
const JobDAO = require('../../../src/database/JobDAO');

// Integration tests require a real PostgreSQL database
// These tests can be skipped if no database is available
let skipIfNoDatabase = process.env.SKIP_DB_TESTS === 'true';

describe('Database Integration Tests', () => {
  let databaseManager;
  let documentDAO;
  let jobDAO;

  beforeAll(async () => {
    if (skipIfNoDatabase) {
      console.log('Skipping database integration tests - SKIP_DB_TESTS=true');
      return;
    }

    // Use test database configuration
    const testConfig = {
      host: process.env.TEST_DB_HOST || 'localhost',
      port: process.env.TEST_DB_PORT || 5432,
      database: process.env.TEST_DB_NAME || 'thewell_pipeline_test',
      user: process.env.TEST_DB_USER || 'charlieirwin',
      password: process.env.TEST_DB_PASSWORD || 'password'
    };

    databaseManager = new DatabaseManager(testConfig);
        
    try {
      await databaseManager.initialize();
      await databaseManager.applySchema();
            
      documentDAO = new DocumentDAO(databaseManager);
      jobDAO = new JobDAO(databaseManager);
    } catch (error) {
      console.log('Database not available, skipping integration tests:', error.message);
      skipIfNoDatabase = true;
    }
  }, 30000);

  afterAll(async () => {
    if (!skipIfNoDatabase && databaseManager) {
      await databaseManager.close();
    }
  });

  beforeEach(async () => {
    if (skipIfNoDatabase) return;
        
    // Clean up test data before each test
    await databaseManager.query('TRUNCATE TABLE job_logs, job_dependencies, jobs, document_reviews, review_sessions, document_visibility, document_enrichments, documents, sources RESTART IDENTITY CASCADE');
  });

  describe('DatabaseManager Integration', () => {
    it('should connect and perform basic operations', async () => {
      if (skipIfNoDatabase) return;

      const health = await databaseManager.healthCheck();
      expect(health.status).toBe('healthy');
      expect(health.connected).toBe(true);
      expect(health.version).toContain('PostgreSQL');
    });

    it('should execute transactions successfully', async () => {
      if (skipIfNoDatabase) return;

      const result = await databaseManager.transaction(async (client) => {
        await client.query('INSERT INTO sources (name, type, config) VALUES ($1, $2, $3)', 
          ['test-source', 'file', '{}']);
                
        const sourceResult = await client.query('SELECT * FROM sources WHERE name = $1', 
          ['test-source']);
                
        return sourceResult.rows[0];
      });

      expect(result.name).toBe('test-source');
      expect(result.type).toBe('file');
    });

    it('should rollback transactions on error', async () => {
      if (skipIfNoDatabase) return;

      await expect(databaseManager.transaction(async (client) => {
        await client.query('INSERT INTO sources (name, type, config) VALUES ($1, $2, $3)', 
          ['test-source', 'file', '{}']);
                
        // This should cause a rollback
        throw new Error('Intentional error');
      })).rejects.toThrow('Intentional error');

      // Verify the insert was rolled back
      const result = await databaseManager.query('SELECT * FROM sources WHERE name = $1', 
        ['test-source']);
      expect(result.rows).toHaveLength(0);
    });

    it('should get database statistics', async () => {
      if (skipIfNoDatabase) return;

      const stats = await databaseManager.getStats();
            
      expect(stats).toHaveProperty('sources');
      expect(stats).toHaveProperty('documents');
      expect(stats).toHaveProperty('jobs');
      expect(typeof stats.sources).toBe('number');
      expect(typeof stats.documents).toBe('number');
      expect(typeof stats.jobs).toBe('number');
    });
  });

  describe('DocumentDAO Integration', () => {
    let sourceId;

    beforeEach(async () => {
      if (skipIfNoDatabase) return;

      // Create a test source
      const sourceResult = await databaseManager.query(
        'INSERT INTO sources (name, type, config) VALUES ($1, $2, $3) RETURNING id',
        ['test-source', 'file', '{}']
      );
      sourceId = sourceResult.rows[0].id;
    });

    it('should create and retrieve documents', async () => {
      if (skipIfNoDatabase) return;

      const documentData = {
        source_id: sourceId,
        external_id: 'ext-123',
        title: 'Test Document',
        content: 'This is test content for searching',
        content_type: 'text/plain',
        url: 'https://example.com/doc',
        metadata: { author: 'Test Author' },
        hash: 'abc123hash',
        word_count: 6,
        language: 'en'
      };

      const created = await documentDAO.create(documentData);
            
      expect(created.id).toBeDefined();
      expect(created.title).toBe('Test Document');
      expect(created.source_id).toBe(sourceId);

      const retrieved = await documentDAO.findById(created.id);
      expect(retrieved.title).toBe('Test Document');
      expect(retrieved.content).toBe('This is test content for searching');
    });

    it('should find documents by hash', async () => {
      if (skipIfNoDatabase) return;

      const hash = 'unique-hash-123';
      await documentDAO.create({
        source_id: sourceId,
        title: 'Hash Test Document',
        content: 'Content',
        hash
      });

      const found = await documentDAO.findByHash(hash);
      expect(found).toBeTruthy();
      expect(found.hash).toBe(hash);
      expect(found.title).toBe('Hash Test Document');
    });

    it('should search documents with full-text search', async () => {
      if (skipIfNoDatabase) return;

      // Create test documents
      await documentDAO.create({
        source_id: sourceId,
        title: 'JavaScript Tutorial',
        content: 'Learn JavaScript programming language basics',
        hash: 'js-doc-1'
      });

      await documentDAO.create({
        source_id: sourceId,
        title: 'Python Guide',
        content: 'Python programming tutorial for beginners',
        hash: 'py-doc-1'
      });

      await documentDAO.create({
        source_id: sourceId,
        title: 'Database Design',
        content: 'SQL database design principles and best practices',
        hash: 'db-doc-1'
      });

      // Search for programming-related documents
      const results = await documentDAO.search('programming');
      expect(results.length).toBeGreaterThan(0);
            
      const titles = results.map(doc => doc.title);
      expect(titles).toContain('JavaScript Tutorial');
      expect(titles).toContain('Python Guide');
    });

    it('should find documents by source', async () => {
      if (skipIfNoDatabase) return;

      // Create documents for this source
      await documentDAO.create({
        source_id: sourceId,
        title: 'Source Doc 1',
        content: 'Content 1',
        hash: 'source-doc-1'
      });

      await documentDAO.create({
        source_id: sourceId,
        title: 'Source Doc 2',
        content: 'Content 2',
        hash: 'source-doc-2'
      });

      const documents = await documentDAO.findBySource(sourceId);
      expect(documents).toHaveLength(2);
      expect(documents.every(doc => doc.source_id === sourceId)).toBe(true);
    });

    it('should update documents', async () => {
      if (skipIfNoDatabase) return;

      const created = await documentDAO.create({
        source_id: sourceId,
        title: 'Original Title',
        content: 'Original content',
        hash: 'update-test'
      });

      const updated = await documentDAO.update(created.id, {
        title: 'Updated Title',
        content: 'Updated content',
        metadata: { updated: true }
      });

      expect(updated.title).toBe('Updated Title');
      expect(updated.content).toBe('Updated content');
      expect(updated.metadata.updated).toBe(true);
    });

    it('should delete documents', async () => {
      if (skipIfNoDatabase) return;

      const created = await documentDAO.create({
        source_id: sourceId,
        title: 'To Delete',
        content: 'This will be deleted',
        hash: 'delete-test'
      });

      const deleted = await documentDAO.delete(created.id);
      expect(deleted).toBe(true);

      const retrieved = await documentDAO.findById(created.id);
      expect(retrieved).toBeNull();
    });

    it('should get document statistics', async () => {
      if (skipIfNoDatabase) return;

      // Create test documents
      await documentDAO.create({
        source_id: sourceId,
        title: 'Stats Doc 1',
        content: 'Content',
        content_type: 'text/plain',
        hash: 'stats-1'
      });

      await documentDAO.create({
        source_id: sourceId,
        title: 'Stats Doc 2',
        content: 'Content',
        content_type: 'text/html',
        hash: 'stats-2'
      });

      const stats = await documentDAO.getStats();
      expect(stats.total).toBeGreaterThanOrEqual(2);
      expect(Array.isArray(stats.by_content_type)).toBe(true);
    });

    it('should bulk create documents', async () => {
      if (skipIfNoDatabase) return;

      const documents = [
        {
          source_id: sourceId,
          title: 'Bulk Doc 1',
          content: 'Content 1',
          hash: 'bulk-1'
        },
        {
          source_id: sourceId,
          title: 'Bulk Doc 2',
          content: 'Content 2',
          hash: 'bulk-2'
        }
      ];

      const results = await documentDAO.bulkCreate(documents);
      expect(results).toHaveLength(2);
      expect(results[0].title).toBe('Bulk Doc 1');
      expect(results[1].title).toBe('Bulk Doc 2');
    });
  });

  describe('JobDAO Integration', () => {
    let sourceId;
    let documentId;

    beforeEach(async () => {
      if (skipIfNoDatabase) return;

      // Create test source and document
      const sourceResult = await databaseManager.query(
        'INSERT INTO sources (name, type, config) VALUES ($1, $2, $3) RETURNING id',
        ['test-source', 'file', '{}']
      );
      sourceId = sourceResult.rows[0].id;

      const docResult = await documentDAO.create({
        source_id: sourceId,
        title: 'Test Document',
        content: 'Test content',
        hash: 'test-hash'
      });
      documentId = docResult.id;
    });

    it('should create and retrieve jobs', async () => {
      if (skipIfNoDatabase) return;

      const jobData = {
        type: 'ingestion',
        source_id: sourceId,
        document_id: documentId,
        config: { timeout: 30000 },
        priority: 5
      };

      const created = await jobDAO.create(jobData);
            
      expect(created.id).toBeDefined();
      expect(created.type).toBe('ingestion');
      expect(created.status).toBe('pending');
      expect(created.priority).toBe(5);

      const retrieved = await jobDAO.findById(created.id);
      expect(retrieved.type).toBe('ingestion');
      expect(retrieved.source_id).toBe(sourceId);
    });

    it('should update job status and progress', async () => {
      if (skipIfNoDatabase) return;

      const job = await jobDAO.create({
        type: 'processing',
        source_id: sourceId
      });

      // Update to running
      let updated = await jobDAO.updateStatus(job.id, 'running', { progress: 25 });
      expect(updated.status).toBe('running');
      expect(updated.progress).toBe(25);
      expect(updated.started_at).toBeTruthy();

      // Update to completed
      updated = await jobDAO.updateStatus(job.id, 'completed', { 
        progress: 100,
        result: { processed: 50 }
      });
      expect(updated.status).toBe('completed');
      expect(updated.progress).toBe(100);
      expect(updated.completed_at).toBeTruthy();
      expect(updated.result.processed).toBe(50);
    });

    it('should find jobs by status', async () => {
      if (skipIfNoDatabase) return;

      // Create jobs with different statuses
      await jobDAO.create({ type: 'ingestion', status: 'pending' });
      await jobDAO.create({ type: 'processing', status: 'pending' });
      await jobDAO.create({ type: 'enrichment', status: 'running' });

      const pendingJobs = await jobDAO.findByStatus('pending');
      expect(pendingJobs).toHaveLength(2);
      expect(pendingJobs.every(job => job.status === 'pending')).toBe(true);

      const runningJobs = await jobDAO.findByStatus('running');
      expect(runningJobs).toHaveLength(1);
      expect(runningJobs[0].type).toBe('enrichment');
    });

    it('should get next pending job with dependency resolution', async () => {
      if (skipIfNoDatabase) return;

      // Create jobs with dependencies
      const job1 = await jobDAO.create({ type: 'ingestion', priority: 1 });
      const job2 = await jobDAO.create({ type: 'processing', priority: 2 });
      const job3 = await jobDAO.create({ type: 'enrichment', priority: 3 });

      // Job3 depends on Job2, Job2 depends on Job1
      await jobDAO.addDependency(job3.id, job2.id);
      await jobDAO.addDependency(job2.id, job1.id);

      // Should get job1 first (no dependencies)
      let nextJob = await jobDAO.getNextPending();
      expect(nextJob.id).toBe(job1.id);

      // Complete job1
      await jobDAO.updateStatus(job1.id, 'completed');

      // Should get job2 next (dependency satisfied)
      nextJob = await jobDAO.getNextPending();
      expect(nextJob.id).toBe(job2.id);

      // Complete job2
      await jobDAO.updateStatus(job2.id, 'completed');

      // Should get job3 last (dependency satisfied)
      nextJob = await jobDAO.getNextPending();
      expect(nextJob.id).toBe(job3.id);
    });

    it('should add and retrieve job logs', async () => {
      if (skipIfNoDatabase) return;

      const job = await jobDAO.create({ type: 'test' });

      // Add logs
      await jobDAO.addLog(job.id, 'info', 'Job started', { timestamp: Date.now() });
      await jobDAO.addLog(job.id, 'debug', 'Processing step 1');
      await jobDAO.addLog(job.id, 'error', 'Error occurred', { error: 'Test error' });

      const logs = await jobDAO.getLogs(job.id);
      expect(logs).toHaveLength(3);
            
      // Logs should be in reverse chronological order
      expect(logs[0].message).toBe('Error occurred');
      expect(logs[1].message).toBe('Processing step 1');
      expect(logs[2].message).toBe('Job started');

      // Filter by level
      const errorLogs = await jobDAO.getLogs(job.id, { level: 'error' });
      expect(errorLogs).toHaveLength(1);
      expect(errorLogs[0].level).toBe('error');
    });

    it('should cancel and retry jobs', async () => {
      if (skipIfNoDatabase) return;

      const job = await jobDAO.create({ type: 'test' });

      // Cancel job
      const cancelled = await jobDAO.cancel(job.id, 'User requested');
      expect(cancelled.status).toBe('cancelled');
      expect(cancelled.error_message).toBe('User requested');

      // Create a failed job to test retry
      const failedJob = await jobDAO.create({ type: 'test' });
      await jobDAO.updateStatus(failedJob.id, 'failed', { 
        error_message: 'Processing failed' 
      });

      // Retry the failed job
      const retried = await jobDAO.retry(failedJob.id);
      expect(retried.status).toBe('pending');
      expect(retried.error_message).toBeNull();
      expect(retried.progress).toBe(0);
    });

    it('should get job statistics', async () => {
      if (skipIfNoDatabase) return;

      // Create jobs with different statuses and types
      await jobDAO.create({ type: 'ingestion', status: 'completed' });
      await jobDAO.create({ type: 'ingestion', status: 'failed' });
      await jobDAO.create({ type: 'processing', status: 'pending' });

      const stats = await jobDAO.getStats();
      expect(stats.total).toBeGreaterThanOrEqual(3);
      expect(Array.isArray(stats.by_status)).toBe(true);
      expect(Array.isArray(stats.by_type)).toBe(true);
      expect(typeof stats.recent_completed).toBe('number');
      expect(typeof stats.recent_failed).toBe('number');
    });

    it('should get queue status', async () => {
      if (skipIfNoDatabase) return;

      await jobDAO.create({ type: 'ingestion', status: 'pending', priority: 5 });
      await jobDAO.create({ type: 'ingestion', status: 'pending', priority: 3 });
      await jobDAO.create({ type: 'processing', status: 'running', priority: 1 });

      const queueStatus = await jobDAO.getQueueStatus();
      expect(Array.isArray(queueStatus)).toBe(true);
            
      const pendingIngestion = queueStatus.find(
        item => item.status === 'pending' && item.type === 'ingestion'
      );
      expect(pendingIngestion).toBeTruthy();
      expect(parseInt(pendingIngestion.count)).toBe(2);
    });

    it('should cleanup old jobs', async () => {
      if (skipIfNoDatabase) return;

      // Create an old completed job
      const oldJob = await jobDAO.create({ type: 'test' });
      await jobDAO.updateStatus(oldJob.id, 'completed');

      // Manually update the completed_at timestamp to be old
      await databaseManager.query(
        'UPDATE jobs SET completed_at = NOW() - INTERVAL \'10 days\' WHERE id = $1',
        [oldJob.id]
      );

      // Cleanup jobs older than 7 days
      const deletedCount = await jobDAO.cleanup(7);
      expect(deletedCount).toBeGreaterThanOrEqual(1);

      // Verify the job was deleted
      const retrieved = await jobDAO.findById(oldJob.id);
      expect(retrieved).toBeNull();
    });
  });

  describe('Cross-DAO Integration', () => {
    it('should handle document and job relationships', async () => {
      if (skipIfNoDatabase) return;

      // Create source
      const sourceResult = await databaseManager.query(
        'INSERT INTO sources (name, type, config) VALUES ($1, $2, $3) RETURNING id',
        ['integration-source', 'file', '{}']
      );
      const sourceId = sourceResult.rows[0].id;

      // Create document
      const document = await documentDAO.create({
        source_id: sourceId,
        title: 'Integration Test Document',
        content: 'Content for integration testing',
        hash: 'integration-hash'
      });

      // Create job for the document
      const job = await jobDAO.create({
        type: 'enrichment',
        source_id: sourceId,
        document_id: document.id,
        config: { enrichment_type: 'sentiment' }
      });

      // Verify relationships
      expect(job.source_id).toBe(sourceId);
      expect(job.document_id).toBe(document.id);

      // Update job with results
      await jobDAO.updateStatus(job.id, 'completed', {
        result: { sentiment: 'positive', confidence: 0.85 }
      });

      const completedJob = await jobDAO.findById(job.id);
      expect(completedJob.status).toBe('completed');
      expect(completedJob.result.sentiment).toBe('positive');
    });
  });
});
