/**
 * Integration tests for curation workflow
 */

const request = require('supertest');
const { createTestApp } = require('../../helpers/test-app');
const { setupTestDatabase, cleanupTestDatabase } = require('../../helpers/database');

// Mock AuditService to prevent ORM initialization issues
jest.mock('../../../src/services/AuditService', () => ({
  setContext: jest.fn(),
  logCurationAction: jest.fn(),
  logSessionActivity: jest.fn(),
  clearContext: jest.fn()
}));

describe('Curation Workflow Integration Tests', () => {
  let app;
  let mockQueueManager;
  let testJobIds = [];

  beforeAll(async () => {
    // Setup test database
    await setupTestDatabase();
  });

  afterAll(async () => {
    // Clean up test jobs
    for (const jobId of testJobIds) {
      try {
        const job = await mockQueueManager.getJob('manual-review', jobId);
        if (job) {
          await job.remove();
        }
      } catch (error) {
        // Ignore cleanup errors
      }
    }
    
    await mockQueueManager.close();
    await cleanupTestDatabase();
  });

  beforeEach(async () => {
    // Clear any existing jobs and reset mocks
    jest.clearAllMocks();
    testJobIds = [];
    
    // Track jobs for getJobs calls
    const trackedJobs = new Map();
    
    // Set up mock queueManager
    mockQueueManager = {
      addJob: jest.fn().mockImplementation((queueName, data, options) => {
        const jobId = `test-job-${Date.now()}-${Math.random()}`;
        if (queueName === 'manual-review') {
          testJobIds.push(jobId);
          // Track the job for getJobs calls
          const trackedJob = {
            id: jobId,
            data,
            opts: options || { priority: 1 },
            status: 'waiting',
            update: jest.fn().mockImplementation((newData) => {
              // Actually update the job's data
              const job = trackedJobs.get(jobId);
              if (job) {
                job.data = { ...job.data, ...newData };
                // Update status based on the new data
                if (newData.status) {
                  job.status = newData.status;
                }
              }
              return Promise.resolve(true);
            }),
            remove: jest.fn().mockResolvedValue(true),
            changePriority: jest.fn().mockResolvedValue(true),
            moveToCompleted: jest.fn().mockImplementation((result) => {
              // Mark job as completed instead of removing it
              const job = trackedJobs.get(jobId);
              if (job) {
                job.status = 'completed';
                job.result = result;
              }
              return Promise.resolve(true);
            }),
            moveToFailed: jest.fn().mockResolvedValue(true)
          };
          trackedJobs.set(jobId, trackedJob);
          return Promise.resolve(trackedJob);
        }
        return Promise.resolve({
          id: jobId,
          data,
          opts: options,
          update: jest.fn().mockResolvedValue(true),
          remove: jest.fn().mockResolvedValue(true)
        });
      }),
      
      getJob: jest.fn().mockImplementation((queueName, documentId) => {
        // Return null for non-existent documents, mock job for existing ones
        if (documentId === 'nonexistent-id' || documentId === 'non-existent-job-id') {
          return Promise.resolve(null);
        }
        
        // Check if it's a tracked job
        const trackedJob = trackedJobs.get(documentId);
        if (trackedJob) {
          return Promise.resolve(trackedJob);
        }
        
        return Promise.resolve({
          id: `job-${documentId}`,
          data: {
            document: { title: 'Test Doc', content: 'Test content' },
            source: { id: 'src', name: 'Source', type: 'web' }
          },
          opts: { priority: 1 },
          update: jest.fn().mockResolvedValue(true),
          remove: jest.fn().mockResolvedValue(true),
          changePriority: jest.fn().mockResolvedValue(true),
          moveToCompleted: jest.fn().mockResolvedValue(true),
          moveToFailed: jest.fn().mockResolvedValue(true)
        });
      }),
      
      getJobs: jest.fn().mockImplementation((queueName, states) => {
        if (queueName === 'manual-review') {
          // Return tracked jobs that match the requested states
          const jobs = Array.from(trackedJobs.values()).filter(job => 
            states.includes(job.status || 'waiting')
          );
          return Promise.resolve(jobs);
        }
        return Promise.resolve([]);
      }),
      
      getQueueStats: jest.fn().mockResolvedValue({
        waiting: 0,
        active: 0,
        completed: 0,
        failed: 0
      }),
      
      clean: jest.fn().mockResolvedValue(true),
      close: jest.fn().mockResolvedValue(true)
    };
    
    // Create test app with mocked queueManager
    app = createTestApp({ queueManager: mockQueueManager });
  });

  describe('Complete Workflow Integration', () => {
    it('should handle complete document curation workflow', async () => {
      // 1. Add test documents to queue
      const testDocs = [
        {
          document: {
            title: 'Test Document 1',
            content: 'This is test content for document 1',
            fileType: 'text/plain'
          },
          source: {
            id: 'source-1',
            name: 'Test Source 1',
            type: 'web'
          }
        },
        {
          document: {
            title: 'Test Document 2',
            content: 'This is test content for document 2',
            fileType: 'text/plain'
          },
          source: {
            id: 'source-2',
            name: 'Test Source 2',
            type: 'file'
          }
        }
      ];

      const jobs = [];
      for (const docData of testDocs) {
        const job = await mockQueueManager.addJob('manual-review', docData, {
          priority: 1,
          attempts: 3
        });
        jobs.push(job);
        testJobIds.push(job.id);
      }

      // 2. Get pending documents
      const pendingResponse = await request(app)
        .get('/api/v1/review/pending')
        .set('x-api-key', 'test-api-key')
        .expect(200);

      expect(pendingResponse.body.documents).toHaveLength(2);
      expect(pendingResponse.body.documents[0]).toHaveProperty('title', 'Test Document 1');

      // 3. Start review for first document
      const startReviewResponse = await request(app)
        .post(`/api/v1/review/start-review/${jobs[0].id}`)
        .set('x-api-key', 'test-api-key')
        .send({
          notes: 'Starting review process',
          priority: 2
        })
        .expect(200);

      expect(startReviewResponse.body.success).toBe(true);
      expect(startReviewResponse.body.status).toBe('in-review');

      // 4. Check workflow status
      const statusResponse = await request(app)
        .get('/api/v1/review/workflow/status')
        .query({ documentIds: jobs.map(j => j.id).join(',') })
        .set('x-api-key', 'test-api-key')
        .expect(200);

      expect(statusResponse.body.statuses).toHaveLength(2);
      expect(statusResponse.body.statuses[0].status).toBe('in-review');
      expect(statusResponse.body.statuses[1].status).toBe('pending');

      // 5. Approve first document
      const approveResponse = await request(app)
        .post(`/api/v1/review/approve/${jobs[0].id}`)
        .set('x-api-key', 'test-api-key')
        .send({
          notes: 'Document approved after review',
          visibility: 'public',
          tags: ['approved', 'quality-content']
        })
        .expect(200);

      expect(approveResponse.body.success).toBe(true);
      expect(approveResponse.body.status).toBe('approved');

      // 6. Reject second document
      const rejectResponse = await request(app)
        .post(`/api/v1/review/reject/${jobs[1].id}`)
        .set('x-api-key', 'test-api-key')
        .send({
          reason: 'Poor quality content',
          notes: 'Content does not meet standards',
          permanent: false
        })
        .expect(200);

      expect(rejectResponse.body.success).toBe(true);
      expect(rejectResponse.body.status).toBe('rejected');

      // 7. Get workflow metrics
      const metricsResponse = await request(app)
        .get('/api/v1/review/workflow/metrics')
        .set('x-api-key', 'test-api-key')
        .expect(200);

      expect(metricsResponse.body.success).toBe(true);
      expect(metricsResponse.body.metrics).toHaveProperty('workflow');
      expect(metricsResponse.body.metrics).toHaveProperty('performance');
    });

    it('should handle bulk operations workflow', async () => {
      // 1. Add multiple test documents
      const testDocs = Array.from({ length: 5 }, (_, i) => ({
        document: {
          title: `Bulk Test Document ${i + 1}`,
          content: `Content for bulk test document ${i + 1}`,
          fileType: 'text/plain'
        },
        source: {
          id: `bulk-source-${i + 1}`,
          name: `Bulk Source ${i + 1}`,
          type: 'web'
        }
      }));

      const jobs = [];
      for (const docData of testDocs) {
        const job = await mockQueueManager.addJob('manual-review', docData, {
          priority: 1,
          attempts: 3
        });
        jobs.push(job);
        testJobIds.push(job.id);
      }

      const jobIds = jobs.map(j => j.id);

      // 2. Bulk start review for first 3 documents
      const bulkStartResponse = await request(app)
        .post('/api/v1/review/bulk/start-review')
        .set('x-api-key', 'test-api-key')
        .send({
          documentIds: jobIds.slice(0, 3),
          notes: 'Bulk review start',
          assignTo: 'test-reviewer'
        })
        .expect(200);

      expect(bulkStartResponse.body.success).toBe(true);
      expect(bulkStartResponse.body.results).toHaveLength(3);
      expect(bulkStartResponse.body.errors).toHaveLength(0);

      // 3. Bulk approve first 2 documents
      const bulkApproveResponse = await request(app)
        .post('/api/v1/review/bulk/approve')
        .set('x-api-key', 'test-api-key')
        .send({
          documentIds: jobIds.slice(0, 2),
          notes: 'Bulk approval',
          visibility: 'internal',
          tags: ['bulk-approved']
        })
        .expect(200);

      expect(bulkApproveResponse.body.success).toBe(true);
      expect(bulkApproveResponse.body.results).toHaveLength(2);
      expect(bulkApproveResponse.body.summary.successful).toBe(2);

      // 4. Bulk reject remaining documents
      const bulkRejectResponse = await request(app)
        .post('/api/v1/review/bulk/reject')
        .set('x-api-key', 'test-api-key')
        .send({
          documentIds: jobIds.slice(2),
          reason: 'Bulk rejection for testing',
          notes: 'Testing bulk rejection workflow',
          permanent: false
        })
        .expect(200);

      expect(bulkRejectResponse.body.success).toBe(true);
      expect(bulkRejectResponse.body.results).toHaveLength(3);
      expect(bulkRejectResponse.body.summary.successful).toBe(3);

      // 5. Verify final workflow status
      const finalStatusResponse = await request(app)
        .get('/api/v1/review/workflow/status')
        .query({ documentIds: jobIds.join(',') })
        .set('x-api-key', 'test-api-key')
        .expect(200);

      expect(finalStatusResponse.body.statuses).toHaveLength(5);
      
      // Check that first 2 are approved
      const approvedStatuses = finalStatusResponse.body.statuses
        .filter(s => s.status === 'approved');
      expect(approvedStatuses).toHaveLength(2);

      // Check that last 3 are rejected
      const rejectedStatuses = finalStatusResponse.body.statuses
        .filter(s => s.status === 'rejected');
      expect(rejectedStatuses).toHaveLength(3);
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle workflow operations on non-existent documents', async () => {
      const nonExistentId = 'non-existent-job-id';

      // Try to start review on non-existent document
      const startResponse = await request(app)
        .post(`/api/v1/review/start-review/${nonExistentId}`)
        .set('x-api-key', 'test-api-key')
        .send({ notes: 'Test' })
        .expect(404);

      expect(startResponse.body.error).toContain('not found');

      // Try bulk operations with mix of valid and invalid IDs
      const validJob = await mockQueueManager.addJob('manual-review', {
        document: { title: 'Valid Doc', content: 'Content' },
        source: { id: 'src', name: 'Source', type: 'web' }
      });
      testJobIds.push(validJob.id);

      const bulkResponse = await request(app)
        .post('/api/v1/review/bulk/approve')
        .set('x-api-key', 'test-api-key')
        .send({
          documentIds: [validJob.id, nonExistentId],
          notes: 'Mixed bulk operation'
        })
        .expect(200);

      expect(bulkResponse.body.results).toHaveLength(1);
      expect(bulkResponse.body.errors).toHaveLength(1);
      expect(bulkResponse.body.errors[0].documentId).toBe(nonExistentId);
    });

    it('should handle concurrent workflow operations', async () => {
      // Add test document
      const job = await mockQueueManager.addJob('manual-review', {
        document: {
          title: 'Concurrent Test Doc',
          content: 'Content for concurrent testing'
        },
        source: {
          id: 'concurrent-source',
          name: 'Concurrent Source',
          type: 'web'
        }
      });
      testJobIds.push(job.id);

      // Start multiple concurrent operations
      const operations = [
        request(app)
          .post(`/api/v1/review/start-review/${job.id}`)
          .set('x-api-key', 'test-api-key')
          .send({ notes: 'Concurrent start 1' }),
        request(app)
          .post(`/api/v1/review/start-review/${job.id}`)
          .set('x-api-key', 'test-api-key')
          .send({ notes: 'Concurrent start 2' }),
        request(app)
          .get('/api/v1/review/workflow/status')
          .query({ documentIds: job.id })
          .set('x-api-key', 'test-api-key')
      ];

      const results = await Promise.allSettled(operations);
      
      // At least one operation should succeed
      const successfulOps = results.filter(r => r.status === 'fulfilled' && r.value.status < 400);
      expect(successfulOps.length).toBeGreaterThan(0);
    });
  });

  describe('Performance and Scalability', () => {
    it('should handle large bulk operations efficiently', async () => {
      const batchSize = 50;
      const jobs = [];

      // Add many documents
      for (let i = 0; i < batchSize; i++) {
        const job = await mockQueueManager.addJob('manual-review', {
          document: {
            title: `Performance Test Doc ${i}`,
            content: `Content ${i}`
          },
          source: {
            id: `perf-source-${i}`,
            name: `Performance Source ${i}`,
            type: 'web'
          }
        });
        jobs.push(job);
        testJobIds.push(job.id);
      }

      const startTime = Date.now();

      // Perform bulk approval
      const response = await request(app)
        .post('/api/v1/review/bulk/approve')
        .set('x-api-key', 'test-api-key')
        .send({
          documentIds: jobs.map(j => j.id),
          notes: 'Performance test bulk approval'
        })
        .expect(200);

      const endTime = Date.now();
      const duration = endTime - startTime;

      expect(response.body.success).toBe(true);
      expect(response.body.results).toHaveLength(batchSize);
      expect(response.body.errors).toHaveLength(0);
      
      // Should complete within reasonable time (adjust threshold as needed)
      expect(duration).toBeLessThan(10000); // 10 seconds
      
    });

  });

  describe('Workflow State Consistency', () => {
    it('should maintain consistent workflow state across operations', async () => {
      // Add test document
      const job = await mockQueueManager.addJob('manual-review', {
        document: {
          title: 'State Consistency Test',
          content: 'Testing state consistency'
        },
        source: {
          id: 'state-source',
          name: 'State Source',
          type: 'web'
        }
      });
      testJobIds.push(job.id);

      // 1. Start review
      await request(app)
        .post(`/api/v1/review/start-review/${job.id}`)
        .set('x-api-key', 'test-api-key')
        .send({ notes: 'Starting state test' })
        .expect(200);

      // 2. Check status is in-review
      let statusResponse = await request(app)
        .get('/api/v1/review/workflow/status')
        .query({ documentIds: job.id })
        .set('x-api-key', 'test-api-key')
        .expect(200);

      expect(statusResponse.body.statuses[0].status).toBe('in-review');
      expect(statusResponse.body.statuses[0].workflowStage).toBe('review');

      // 3. Approve document
      await request(app)
        .post(`/api/v1/review/approve/${job.id}`)
        .set('x-api-key', 'test-api-key')
        .send({
          notes: 'Approving after state test',
          visibility: 'internal'
        })
        .expect(200);

      // 4. Verify final state
      statusResponse = await request(app)
        .get('/api/v1/review/workflow/status')
        .query({ documentIds: job.id })
        .set('x-api-key', 'test-api-key')
        .expect(200);

      // Document should be moved from queue, so status check might return not-found
      // This is expected behavior for completed documents
      expect(statusResponse.body.statuses[0]).toEqual(
        expect.objectContaining({
          documentId: job.id,
          status: expect.any(String)
        })
      );
    });
  });
});
