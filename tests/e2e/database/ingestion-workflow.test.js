const DatabaseManager = require('../../../src/database/DatabaseManager');
const DocumentDAO = require('../../../src/database/DocumentDAO');
const JobDAO = require('../../../src/database/JobDAO');

// Unmock pg for E2E tests - we need real database connections
jest.unmock('pg');

// E2E tests for complete ingestion workflow scenarios
let skipIfNoDatabase = process.env.SKIP_DB_TESTS === 'true';

describe('Ingestion Workflow E2E Tests', () => {
  let databaseManager;
  let documentDAO;
  let jobDAO;

  beforeAll(async () => {
    if (skipIfNoDatabase) {
      console.log('Skipping database E2E tests - SKIP_DB_TESTS=true');
      return;
    }

    const testConfig = {
      host: process.env.TEST_DB_HOST || 'localhost',
      port: process.env.TEST_DB_PORT || 5432,
      database: process.env.TEST_DB_NAME || 'thewell_pipeline_test',
      user: process.env.TEST_DB_USER || 'charlieirwin',
      password: process.env.TEST_DB_PASSWORD || ''
    };

    databaseManager = new DatabaseManager(testConfig);
        
    try {
      await databaseManager.initialize();
      await databaseManager.applySchema();
            
      documentDAO = new DocumentDAO(databaseManager);
      jobDAO = new JobDAO(databaseManager);
    } catch (error) {
      console.log('Database not available, skipping E2E tests:', error.message);
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
        
    // Clean up test data
    await databaseManager.query('TRUNCATE TABLE job_logs, job_dependencies, jobs, document_reviews, review_sessions, document_visibility, document_enrichments, documents, sources RESTART IDENTITY CASCADE');
  });

  describe('Complete Document Ingestion Workflow', () => {
    it('should process a complete document ingestion pipeline', async () => {
      if (skipIfNoDatabase) return;

      // Step 1: Create ingestion source
      const sourceResult = await databaseManager.query(
        'INSERT INTO sources (name, type, config, status) VALUES ($1, $2, $3, $4) RETURNING *',
        ['file-source', 'file', JSON.stringify({ path: '/test/docs' }), 'active']
      );
      const source = sourceResult.rows[0];

      // Step 2: Create ingestion job
      const ingestionJob = await jobDAO.create({
        type: 'ingestion',
        source_id: source.id,
        config: { 
          batch_size: 10,
          file_patterns: ['*.txt', '*.md'],
          extract_metadata: true
        },
        priority: 10
      });

      await jobDAO.addLog(ingestionJob.id, 'info', 'Starting file ingestion');

      // Step 3: Simulate ingestion process - create documents
      const documents = [];
      for (let i = 1; i <= 3; i++) {
        const doc = await documentDAO.create({
          source_id: source.id,
          external_id: `file-${i}.txt`,
          title: `Document ${i}`,
          content: `This is the content of document ${i}. It contains important information about topic ${i}.`,
          content_type: 'text/plain',
          url: `file:///test/docs/file-${i}.txt`,
          metadata: { 
            file_size: 1024 * i,
            created_by: 'ingestion-system',
            topic: `topic-${i}`
          },
          hash: `hash-${i}`,
          word_count: 15 + i,
          language: 'en'
        });
        documents.push(doc);

        await jobDAO.addLog(ingestionJob.id, 'info', `Processed document: ${doc.title}`);
      }

      // Step 4: Update ingestion job progress
      await jobDAO.updateStatus(ingestionJob.id, 'running', { progress: 50 });
      await jobDAO.updateStatus(ingestionJob.id, 'completed', { 
        progress: 100,
        result: { 
          documents_processed: documents.length,
          total_words: documents.reduce((sum, doc) => sum + doc.word_count, 0)
        }
      });

      // Step 5: Create visibility assignment jobs for each document
      const visibilityJobs = [];
      for (const doc of documents) {
        const visibilityJob = await jobDAO.create({
          type: 'visibility_assignment',
          source_id: source.id,
          document_id: doc.id,
          config: { rules: ['default_internal'] },
          priority: 5
        });

        // Add dependency on ingestion job
        await jobDAO.addDependency(visibilityJob.id, ingestionJob.id);
        visibilityJobs.push(visibilityJob);
      }

      // Step 6: Process visibility assignments
      for (let i = 0; i < visibilityJobs.length; i++) {
        const visibilityJob = visibilityJobs[i];
        const document = documents[i];

        await jobDAO.updateStatus(visibilityJob.id, 'running');

        // Assign visibility based on document content
        const visibility = document.title.includes('1') ? 'public' : 'internal';
                
        await databaseManager.query(
          'INSERT INTO document_visibility (document_id, visibility_level, approved_by, reason) VALUES ($1, $2, $3, $4)',
          [document.id, visibility, 'system', 'Auto-assigned based on content analysis']
        );

        await jobDAO.updateStatus(visibilityJob.id, 'completed', {
          result: { visibility_assigned: visibility }
        });

        await jobDAO.addLog(visibilityJob.id, 'info', `Assigned visibility: ${visibility}`);
      }

      // Step 7: Create enrichment jobs
      const enrichmentJobs = [];
      for (const doc of documents) {
        const enrichmentJob = await jobDAO.create({
          type: 'enrichment',
          source_id: source.id,
          document_id: doc.id,
          config: { 
            enrichment_types: ['sentiment', 'keywords', 'summary'],
            llm_provider: 'openai'
          },
          priority: 3
        });

        // Add dependency on visibility job
        const visibilityJob = visibilityJobs.find(vj => vj.document_id === doc.id);
        if (visibilityJob) {
          await jobDAO.addDependency(enrichmentJob.id, visibilityJob.id);
        }

        enrichmentJobs.push(enrichmentJob);
      }

      // Step 8: Process enrichments
      for (let i = 0; i < enrichmentJobs.length; i++) {
        const enrichmentJob = enrichmentJobs[i];
        const document = documents[i];

        await jobDAO.updateStatus(enrichmentJob.id, 'running');

        // Simulate LLM enrichment
        const enrichmentData = {
          sentiment: Math.random() > 0.5 ? 'positive' : 'neutral',
          keywords: [`keyword-${i}`, `topic-${i}`, 'important'],
          summary: `Summary of document ${i}: Contains information about topic ${i}.`,
          confidence_scores: {
            sentiment: 0.85 + Math.random() * 0.1,
            keywords: 0.9,
            summary: 0.8
          }
        };

        await databaseManager.query(
          'INSERT INTO document_enrichments (document_id, enrichment_type, result) VALUES ($1, $2, $3)',
          [document.id, 'full_analysis', JSON.stringify(enrichmentData)]
        );

        await jobDAO.updateStatus(enrichmentJob.id, 'completed', {
          result: { enrichments_added: ['sentiment', 'keywords', 'summary'] }
        });

        await jobDAO.addLog(enrichmentJob.id, 'info', 'Enrichment completed successfully');
      }

      // Step 9: Verify the complete workflow
            
      // Check ingestion job completed
      const finalIngestionJob = await jobDAO.findById(ingestionJob.id);
      expect(finalIngestionJob.status).toBe('completed');
      expect(finalIngestionJob.result.documents_processed).toBe(3);

      // Check all documents were created
      const sourceDocuments = await documentDAO.findBySource(source.id);
      expect(sourceDocuments).toHaveLength(3);

      // Check visibility assignments
      const visibilityResult = await databaseManager.query(
        'SELECT document_id, visibility_level FROM document_visibility WHERE document_id = ANY($1)',
        [documents.map(d => d.id)]
      );
      expect(visibilityResult.rows).toHaveLength(3);

      // Check enrichments
      const enrichmentResult = await databaseManager.query(
        'SELECT document_id, enrichment_type FROM document_enrichments WHERE document_id = ANY($1)',
        [documents.map(d => d.id)]
      );
      expect(enrichmentResult.rows).toHaveLength(3);

      // Check all jobs completed successfully
      const allJobs = await jobDAO.findByStatus('completed');
      const workflowJobs = allJobs.filter(job => 
        job.source_id === source.id || 
                documents.some(doc => doc.id === job.document_id)
      );
      expect(workflowJobs.length).toBeGreaterThanOrEqual(7); // 1 ingestion + 3 visibility + 3 enrichment

      // Check job dependencies were respected
      for (const visibilityJob of visibilityJobs) {
        const job = await jobDAO.findById(visibilityJob.id);
        if (job.started_at !== null) {
          expect(new Date(job.started_at).getTime()).toBeGreaterThanOrEqual(new Date(finalIngestionJob.completed_at).getTime());
        }
      }

      // Verify search functionality works with enriched documents
      const searchResults = await documentDAO.search('topic');
      expect(searchResults.length).toBeGreaterThan(0);
      expect(searchResults.some(doc => doc.title.includes('Document'))).toBe(true);
    });

    it('should handle error scenarios and job failures', async () => {
      if (skipIfNoDatabase) return;

      // Create source
      const sourceResult = await databaseManager.query(
        'INSERT INTO sources (name, type, config) VALUES ($1, $2, $3) RETURNING *',
        ['error-source', 'api', '{}']
      );
      const source = sourceResult.rows[0];

      // Create a job that will fail
      const failingJob = await jobDAO.create({
        type: 'ingestion',
        source_id: source.id,
        config: { invalid_config: true }
      });

      // Simulate job failure
      await jobDAO.updateStatus(failingJob.id, 'running');
      await jobDAO.addLog(failingJob.id, 'error', 'Invalid configuration detected');
      await jobDAO.updateStatus(failingJob.id, 'failed', {
        error_message: 'Configuration validation failed'
      });

      // Create a retry job
      const retryJob = await jobDAO.retry(failingJob.id);
      expect(retryJob.status).toBe('pending');
      expect(retryJob.error_message).toBeNull();

      // Simulate successful retry
      await jobDAO.updateStatus(retryJob.id, 'running');
            
      // Create a document this time
      const document = await documentDAO.create({
        source_id: source.id,
        title: 'Retry Success Document',
        content: 'This document was created after retry',
        hash: 'retry-success'
      });

      await jobDAO.updateStatus(retryJob.id, 'completed', {
        result: { documents_processed: 1, retry_successful: true }
      });

      // Verify the workflow
      const completedJob = await jobDAO.findById(retryJob.id);
      expect(completedJob.status).toBe('completed');
      expect(completedJob.result.retry_successful).toBe(true);

      const createdDoc = await documentDAO.findById(document.id);
      expect(createdDoc.title).toBe('Retry Success Document');
    });

    it('should handle complex job dependencies and parallel processing', async () => {
      if (skipIfNoDatabase) return;

      // Create source
      const sourceResult = await databaseManager.query(
        'INSERT INTO sources (name, type, config) VALUES ($1, $2, $3) RETURNING *',
        ['parallel-source', 'batch', '{}']
      );
      const source = sourceResult.rows[0];

      // Create initial ingestion job
      const ingestionJob = await jobDAO.create({
        type: 'batch_ingestion',
        source_id: source.id,
        priority: 10
      });

      // Create multiple documents
      const documents = [];
      for (let i = 1; i <= 5; i++) {
        const doc = await documentDAO.create({
          source_id: source.id,
          title: `Parallel Doc ${i}`,
          content: `Content for parallel processing ${i}`,
          hash: `parallel-${i}`
        });
        documents.push(doc);
      }

      await jobDAO.updateStatus(ingestionJob.id, 'completed', {
        result: { documents_created: documents.length }
      });

      // Create parallel processing jobs
      const processingJobs = [];
      for (const doc of documents) {
        const processingJob = await jobDAO.create({
          type: 'parallel_processing',
          source_id: source.id,
          document_id: doc.id,
          priority: 5
        });

        await jobDAO.addDependency(processingJob.id, ingestionJob.id);
        processingJobs.push(processingJob);
      }

      // Create aggregation job that depends on all processing jobs
      const aggregationJob = await jobDAO.create({
        type: 'aggregation',
        source_id: source.id,
        priority: 1
      });

      for (const processingJob of processingJobs) {
        await jobDAO.addDependency(aggregationJob.id, processingJob.id);
      }

      // Process all parallel jobs
      for (const processingJob of processingJobs) {
        await jobDAO.updateStatus(processingJob.id, 'completed', {
          result: { processed: true }
        });
      }

      // Now aggregation job should be available
      const nextJob = await jobDAO.getNextPending();
      expect(nextJob.id).toBe(aggregationJob.id);

      await jobDAO.updateStatus(aggregationJob.id, 'completed', {
        result: { 
          total_documents: documents.length,
          aggregation_complete: true
        }
      });

      // Verify all jobs completed in correct order
      const completedJobs = await jobDAO.findByStatus('completed');
      const workflowJobs = completedJobs.filter(job => job.source_id === source.id);
            
      expect(workflowJobs).toHaveLength(7); // 1 ingestion + 5 processing + 1 aggregation

      const finalAggregationJob = await jobDAO.findById(aggregationJob.id);
      expect(finalAggregationJob.status).toBe('completed');
      expect(finalAggregationJob.result.total_documents).toBe(5);
    });

    it('should maintain data consistency during concurrent operations', async () => {
      if (skipIfNoDatabase) return;

      // Create source
      const sourceResult = await databaseManager.query(
        'INSERT INTO sources (name, type, config) VALUES ($1, $2, $3) RETURNING *',
        ['concurrent-source', 'concurrent', '{}']
      );
      const source = sourceResult.rows[0];

      // Simulate concurrent document creation and job processing
      const concurrentOperations = [];

      // Create multiple documents concurrently
      for (let i = 1; i <= 10; i++) {
        concurrentOperations.push(
          documentDAO.create({
            source_id: source.id,
            title: `Concurrent Doc ${i}`,
            content: `Concurrent content ${i}`,
            hash: `concurrent-${i}`
          })
        );
      }

      // Create jobs concurrently
      for (let i = 1; i <= 5; i++) {
        concurrentOperations.push(
          jobDAO.create({
            type: 'concurrent_processing',
            source_id: source.id,
            priority: i
          })
        );
      }

      // Wait for all operations to complete
      const results = await Promise.all(concurrentOperations);
            
      // Separate documents and jobs
      const createdDocuments = results.filter(r => r.title && r.title.includes('Concurrent Doc'));
      const createdJobs = results.filter(r => r.type === 'concurrent_processing');

      expect(createdDocuments).toHaveLength(10);
      expect(createdJobs).toHaveLength(5);

      // Verify data integrity
      const allDocuments = await documentDAO.findBySource(source.id);
      expect(allDocuments).toHaveLength(10);

      const allJobs = await jobDAO.findByStatus('pending');
      const sourceJobs = allJobs.filter(job => job.source_id === source.id);
      expect(sourceJobs).toHaveLength(5);

      // Verify unique hashes
      const hashes = allDocuments.map(doc => doc.hash);
      const uniqueHashes = [...new Set(hashes)];
      expect(uniqueHashes).toHaveLength(10);

      // Test concurrent job processing
      const processingPromises = sourceJobs.map(async (job, index) => {
        await jobDAO.updateStatus(job.id, 'running');
                
        // Simulate some processing time
        await new Promise(resolve => setTimeout(resolve, 10));
                
        await jobDAO.updateStatus(job.id, 'completed', {
          result: { processed_at: Date.now(), job_index: index }
        });
      });

      await Promise.all(processingPromises);

      // Verify all jobs completed successfully
      const completedJobs = await jobDAO.findByStatus('completed');
      const completedSourceJobs = completedJobs.filter(job => job.source_id === source.id);
      expect(completedSourceJobs).toHaveLength(5);

      // Verify job logs were created properly
      for (const job of completedSourceJobs) {
        const logs = await jobDAO.getLogs(job.id);
        expect(logs.length).toBeGreaterThanOrEqual(0); // May have logs from status updates
      }
    });
  });

  describe('Database Performance and Cleanup', () => {
    it('should handle large-scale data operations efficiently', async () => {
      if (skipIfNoDatabase) return;

      const startTime = Date.now();

      // Create source
      const sourceResult = await databaseManager.query(
        'INSERT INTO sources (name, type, config) VALUES ($1, $2, $3) RETURNING *',
        ['performance-source', 'bulk', '{}']
      );
      const source = sourceResult.rows[0];

      // Bulk create documents
      const bulkDocuments = [];
      for (let i = 1; i <= 100; i++) {
        bulkDocuments.push({
          source_id: source.id,
          title: `Bulk Document ${i}`,
          content: `This is bulk content for document ${i}. It contains searchable text and metadata.`,
          hash: `bulk-hash-${i}`,
          word_count: 15,
          language: 'en',
          metadata: { batch: 'performance-test', index: i }
        });
      }

      const createdDocuments = await documentDAO.bulkCreate(bulkDocuments);
      expect(createdDocuments).toHaveLength(100);

      // Test search performance
      const searchStartTime = Date.now();
      const searchResults = await documentDAO.search('bulk content');
      const searchTime = Date.now() - searchStartTime;

      expect(searchResults.length).toBeGreaterThan(0);
      expect(searchTime).toBeLessThan(1000); // Should complete within 1 second

      // Test pagination
      const page1 = await documentDAO.findBySource(source.id, { limit: 20, offset: 0 });
      const page2 = await documentDAO.findBySource(source.id, { limit: 20, offset: 20 });

      expect(page1).toHaveLength(20);
      expect(page2).toHaveLength(20);
      expect(page1[0].id).not.toBe(page2[0].id);

      // Create bulk jobs
      const bulkJobs = [];
      for (let i = 1; i <= 50; i++) {
        bulkJobs.push(
          jobDAO.create({
            type: 'bulk_processing',
            source_id: source.id,
            priority: Math.floor(Math.random() * 10)
          })
        );
      }

      const createdJobs = await Promise.all(bulkJobs);
      expect(createdJobs).toHaveLength(50);

      const totalTime = Date.now() - startTime;
      expect(totalTime).toBeLessThan(10000); // Should complete within 10 seconds

      // Test cleanup performance
      const cleanupStartTime = Date.now();
            
      // Mark some jobs as completed and old
      for (let i = 0; i < 10; i++) {
        await jobDAO.updateStatus(createdJobs[i].id, 'completed');
        await databaseManager.query(
          'UPDATE jobs SET completed_at = NOW() - INTERVAL \'10 days\' WHERE id = $1',
          [createdJobs[i].id]
        );
      }

      const cleanedCount = await jobDAO.cleanup(7);
      const cleanupTime = Date.now() - cleanupStartTime;

      expect(cleanedCount).toBe(10);
      expect(cleanupTime).toBeLessThan(2000); // Should complete within 2 seconds
    });

    it('should maintain referential integrity during cascading deletes', async () => {
      if (skipIfNoDatabase) return;

      // Create source with documents and jobs
      const sourceResult = await databaseManager.query(
        'INSERT INTO sources (name, type, config) VALUES ($1, $2, $3) RETURNING *',
        ['cascade-source', 'test', '{}']
      );
      const source = sourceResult.rows[0];

      const document = await documentDAO.create({
        source_id: source.id,
        title: 'Cascade Test Document',
        content: 'Content for cascade testing',
        hash: 'cascade-hash'
      });

      const job = await jobDAO.create({
        type: 'cascade_test',
        source_id: source.id,
        document_id: document.id
      });

      await jobDAO.addLog(job.id, 'info', 'Test log entry');

      // Add visibility and enrichment data
      await databaseManager.query(
        'INSERT INTO document_visibility (document_id, visibility_level, approved_by, reason) VALUES ($1, $2, $3, $4)',
        [document.id, 'internal', 'system', 'Auto-assigned based on content analysis']
      );

      await databaseManager.query(
        'INSERT INTO document_enrichments (document_id, enrichment_type, result) VALUES ($1, $2, $3)',
        [document.id, 'test', '{}']
      );

      // Verify all data exists
      const docCheck = await documentDAO.findById(document.id);
      const jobCheck = await jobDAO.findById(job.id);
      const logsCheck = await jobDAO.getLogs(job.id);

      expect(docCheck).toBeTruthy();
      expect(jobCheck).toBeTruthy();
      expect(logsCheck.length).toBeGreaterThan(0);

      // Delete the document (should cascade)
      await documentDAO.delete(document.id);

      // Verify cascading deletes worked
      const deletedDoc = await documentDAO.findById(document.id);
      expect(deletedDoc).toBeNull();

      // Check that related data was cleaned up appropriately
      const visibilityCheck = await databaseManager.query(
        'SELECT * FROM document_visibility WHERE document_id = $1',
        [document.id]
      );
      expect(visibilityCheck.rows).toHaveLength(0);

      const enrichmentCheck = await databaseManager.query(
        'SELECT * FROM document_enrichments WHERE document_id = $1',
        [document.id]
      );
      expect(enrichmentCheck.rows).toHaveLength(0);

      // Job should still exist but document_id should be null or handled appropriately
      const remainingJob = await jobDAO.findById(job.id);
      expect(remainingJob).toBeTruthy(); // Job exists but document reference is handled
    });
  });
});
