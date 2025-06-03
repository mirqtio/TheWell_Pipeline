/**
 * End-to-end tests for complete curation workflow
 */

const request = require('supertest');
const { spawn } = require('child_process');
const path = require('path');
const { setupTestDatabase, cleanupTestDatabase } = require('../../helpers/database');
const { waitForServer, killProcess } = require('../../helpers/server');

describe('Complete Curation Workflow E2E Tests', () => {
  let webServer;
  let baseUrl;
  const testPort = 3099;

  beforeAll(async () => {
    // Setup test database
    await setupTestDatabase();
    
    // Start web server
    const serverPath = path.join(__dirname, '../../../src/web/start.js');
    webServer = spawn('node', [serverPath], {
      env: {
        ...process.env,
        PORT: testPort,
        NODE_ENV: 'test',
        REDIS_DB: '15' // Use separate Redis DB for E2E tests
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    baseUrl = `http://localhost:${testPort}`;
    
    // Wait for server to start
    await waitForServer(baseUrl, 30000);
  }, 60000);

  afterAll(async () => {
    if (webServer) {
      await killProcess(webServer);
    }
    await cleanupTestDatabase();
  }, 30000);

  describe('Complete Document Lifecycle', () => {
    let testDocumentIds = [];

    afterEach(async () => {
      // Clean up test documents
      if (testDocumentIds.length > 0) {
        try {
          await request(baseUrl)
            .post('/api/v1/review/bulk/reject')
            .set('x-api-key', 'test-api-key')
            .send({
              documentIds: testDocumentIds,
              reason: 'Test cleanup',
              permanent: true
            });
        } catch (error) {
          // Ignore cleanup errors
        }
        testDocumentIds = [];
      }
    });

    it('should complete full document curation workflow from ingestion to approval', async () => {
      // 1. Simulate document ingestion by adding to review queue
      const ingestionResponse = await request(baseUrl)
        .post('/api/v1/jobs/manual-review')
        .set('x-api-key', 'test-api-key')
        .send({
          document: {
            title: 'E2E Test Document - Full Workflow',
            content: 'This is a comprehensive test document for the complete curation workflow. It contains meaningful content that should be approved.',
            fileType: 'text/plain',
            fileSize: 1024,
            language: 'en',
            wordCount: 25
          },
          source: {
            id: 'e2e-source-1',
            name: 'E2E Test Source',
            type: 'web',
            url: 'https://example.com/test-document'
          },
          metadata: {
            extractedAt: new Date().toISOString(),
            checksum: 'e2e-test-checksum-123'
          }
        })
        .expect(201);

      const documentId = ingestionResponse.body.jobId;
      testDocumentIds.push(documentId);

      // 2. Verify document appears in pending review
      const pendingResponse = await request(baseUrl)
        .get('/api/v1/review/pending')
        .set('x-api-key', 'test-api-key')
        .query({ limit: 50 })
        .expect(200);

      const pendingDoc = pendingResponse.body.documents.find(doc => doc.id === documentId);
      expect(pendingDoc).toBeDefined();
      expect(pendingDoc.title).toBe('E2E Test Document - Full Workflow');
      expect(pendingDoc.status).toBe('pending');

      // 3. Start review workflow
      const startReviewResponse = await request(baseUrl)
        .post(`/api/v1/review/start-review/${documentId}`)
        .set('x-api-key', 'test-api-key')
        .send({
          notes: 'Starting comprehensive review for E2E test',
          priority: 2
        })
        .expect(200);

      expect(startReviewResponse.body.success).toBe(true);
      expect(startReviewResponse.body.status).toBe('in-review');

      // 4. Get detailed document information
      const documentResponse = await request(baseUrl)
        .get(`/api/v1/review/document/${documentId}`)
        .set('x-api-key', 'test-api-key')
        .expect(200);

      expect(documentResponse.body.document.title).toBe('E2E Test Document - Full Workflow');
      expect(documentResponse.body.document.source.name).toBe('E2E Test Source');

      // 5. Add flag for special attention
      const flagResponse = await request(baseUrl)
        .post(`/api/v1/review/flag/${documentId}`)
        .set('x-api-key', 'test-api-key')
        .send({
          type: 'quality-check',
          reason: 'Requires additional quality verification',
          priority: 3
        })
        .expect(200);

      expect(flagResponse.body.success).toBe(true);

      // 6. Check workflow status
      const statusResponse = await request(baseUrl)
        .get('/api/v1/review/workflow/status')
        .set('x-api-key', 'test-api-key')
        .query({ documentIds: documentId })
        .expect(200);

      expect(statusResponse.body.statuses[0].status).toBe('in-review');
      expect(statusResponse.body.statuses[0].workflowStage).toBe('review');

      // 7. Approve document with comprehensive metadata
      const approveResponse = await request(baseUrl)
        .post(`/api/v1/review/approve/${documentId}`)
        .set('x-api-key', 'test-api-key')
        .send({
          notes: 'Document approved after thorough review. Content quality is excellent.',
          visibility: 'public',
          tags: ['approved', 'high-quality', 'e2e-test']
        })
        .expect(200);

      expect(approveResponse.body.success).toBe(true);
      expect(approveResponse.body.status).toBe('approved');
      expect(approveResponse.body.documentId).toBe(documentId);

      // 8. Verify document is no longer in pending queue
      const finalPendingResponse = await request(baseUrl)
        .get('/api/v1/review/pending')
        .set('x-api-key', 'test-api-key')
        .expect(200);

      const stillPending = finalPendingResponse.body.documents.find(doc => doc.id === documentId);
      expect(stillPending).toBeUndefined();

      // 9. Check final workflow metrics
      const metricsResponse = await request(baseUrl)
        .get('/api/v1/review/workflow/metrics')
        .set('x-api-key', 'test-api-key')
        .query({ timeframe: '1h' })
        .expect(200);

      expect(metricsResponse.body.success).toBe(true);
      expect(metricsResponse.body.metrics.workflow.approved).toBeGreaterThan(0);

      // Remove from cleanup list since it's been processed
      testDocumentIds = testDocumentIds.filter(id => id !== documentId);
    }, 30000);

    it('should handle bulk curation operations efficiently', async () => {
      // 1. Create multiple test documents
      const testDocs = Array.from({ length: 10 }, (_, i) => ({
        document: {
          title: `Bulk E2E Test Document ${i + 1}`,
          content: `This is bulk test document number ${i + 1} for comprehensive workflow testing.`,
          fileType: 'text/plain',
          fileSize: 512,
          language: 'en',
          wordCount: 15
        },
        source: {
          id: `bulk-e2e-source-${i + 1}`,
          name: `Bulk E2E Source ${i + 1}`,
          type: 'web',
          url: `https://example.com/bulk-test-${i + 1}`
        },
        metadata: {
          extractedAt: new Date().toISOString(),
          checksum: `bulk-e2e-checksum-${i + 1}`
        }
      }));

      // 2. Ingest all documents
      const documentIds = [];
      for (const docData of testDocs) {
        const response = await request(baseUrl)
          .post('/api/v1/jobs/manual-review')
          .set('x-api-key', 'test-api-key')
          .send(docData)
          .expect(201);
        
        documentIds.push(response.body.jobId);
        testDocumentIds.push(response.body.jobId);
      }

      // 3. Verify all documents are pending
      const pendingResponse = await request(baseUrl)
        .get('/api/v1/review/pending')
        .set('x-api-key', 'test-api-key')
        .query({ limit: 50 })
        .expect(200);

      const pendingCount = pendingResponse.body.documents.filter(doc => 
        documentIds.includes(doc.id)
      ).length;
      expect(pendingCount).toBe(10);

      // 4. Bulk start review for first 5 documents
      const bulkStartResponse = await request(baseUrl)
        .post('/api/v1/review/bulk/start-review')
        .set('x-api-key', 'test-api-key')
        .send({
          documentIds: documentIds.slice(0, 5),
          notes: 'Bulk review start for E2E testing',
          assignTo: 'e2e-test-reviewer'
        })
        .expect(200);

      expect(bulkStartResponse.body.success).toBe(true);
      expect(bulkStartResponse.body.results).toHaveLength(5);
      expect(bulkStartResponse.body.errors).toHaveLength(0);

      // 5. Bulk approve first 3 documents
      const bulkApproveResponse = await request(baseUrl)
        .post('/api/v1/review/bulk/approve')
        .set('x-api-key', 'test-api-key')
        .send({
          documentIds: documentIds.slice(0, 3),
          notes: 'Bulk approval for E2E testing',
          visibility: 'internal',
          tags: ['bulk-approved', 'e2e-test']
        })
        .expect(200);

      expect(bulkApproveResponse.body.success).toBe(true);
      expect(bulkApproveResponse.body.results).toHaveLength(3);
      expect(bulkApproveResponse.body.summary.successful).toBe(3);

      // 6. Bulk reject remaining documents
      const bulkRejectResponse = await request(baseUrl)
        .post('/api/v1/review/bulk/reject')
        .set('x-api-key', 'test-api-key')
        .send({
          documentIds: documentIds.slice(3),
          reason: 'Bulk rejection for E2E testing',
          notes: 'Testing bulk rejection workflow in E2E environment',
          permanent: false
        })
        .expect(200);

      expect(bulkRejectResponse.body.success).toBe(true);
      expect(bulkRejectResponse.body.results).toHaveLength(7);
      expect(bulkRejectResponse.body.summary.successful).toBe(7);

      // 7. Verify final workflow status
      const finalStatusResponse = await request(baseUrl)
        .get('/api/v1/review/workflow/status')
        .set('x-api-key', 'test-api-key')
        .query({ documentIds: documentIds.join(',') })
        .expect(200);

      expect(finalStatusResponse.body.statuses).toHaveLength(10);

      // Count final statuses
      const statusCounts = finalStatusResponse.body.statuses.reduce((acc, status) => {
        acc[status.status] = (acc[status.status] || 0) + 1;
        return acc;
      }, {});

      // Should have 3 approved and 7 rejected (or not-found if moved from queue)
      expect(statusCounts.approved || 0).toBe(3);
      expect((statusCounts.rejected || 0) + (statusCounts['not-found'] || 0)).toBe(7);

      // 8. Check comprehensive metrics
      const metricsResponse = await request(baseUrl)
        .get('/api/v1/review/workflow/metrics')
        .set('x-api-key', 'test-api-key')
        .query({ timeframe: '1h' })
        .expect(200);

      expect(metricsResponse.body.success).toBe(true);
      expect(metricsResponse.body.metrics.workflow.approved).toBeGreaterThanOrEqual(3);
      expect(metricsResponse.body.metrics.workflow.rejected).toBeGreaterThanOrEqual(7);

      // Clear test document IDs since they've been processed
      testDocumentIds = [];
    }, 45000);
  });

  describe('Error Scenarios and Recovery', () => {
    it('should handle API errors gracefully', async () => {
      // Test with invalid API key
      const invalidKeyResponse = await request(baseUrl)
        .get('/api/v1/review/pending')
        .set('x-api-key', 'invalid-key')
        .expect(401);

      expect(invalidKeyResponse.body.error).toContain('Unauthorized');

      // Test with malformed request
      const malformedResponse = await request(baseUrl)
        .post('/api/v1/review/bulk/approve')
        .set('x-api-key', 'test-api-key')
        .send({
          // Missing required documentIds
          notes: 'Malformed request test'
        })
        .expect(400);

      expect(malformedResponse.body.error).toContain('Document IDs array is required');

      // Test with non-existent document
      const notFoundResponse = await request(baseUrl)
        .post('/api/v1/review/start-review/non-existent-id')
        .set('x-api-key', 'test-api-key')
        .send({
          notes: 'Testing non-existent document'
        })
        .expect(404);

      expect(notFoundResponse.body.error).toContain('not found');
    });

    it('should maintain system stability under load', async () => {
      // Create concurrent requests to test system stability
      const concurrentRequests = Array.from({ length: 20 }, (_, i) => 
        request(baseUrl)
          .get('/api/v1/review/pending')
          .set('x-api-key', 'test-api-key')
          .query({ page: i % 5 + 1, limit: 10 })
      );

      const results = await Promise.allSettled(concurrentRequests);
      
      // Most requests should succeed
      const successfulRequests = results.filter(r => 
        r.status === 'fulfilled' && r.value.status === 200
      );
      
      expect(successfulRequests.length).toBeGreaterThan(15);
    });
  });

  describe('Performance Benchmarks', () => {
    it('should meet performance requirements for typical operations', async () => {
      // Test single document operations
      const singleOpStart = Date.now();
      
      const pendingResponse = await request(baseUrl)
        .get('/api/v1/review/pending')
        .set('x-api-key', 'test-api-key')
        .expect(200);
      
      const singleOpDuration = Date.now() - singleOpStart;
      expect(singleOpDuration).toBeLessThan(1000); // Should complete within 1 second

      // Test metrics endpoint performance
      const metricsStart = Date.now();
      
      const metricsResponse = await request(baseUrl)
        .get('/api/v1/review/workflow/metrics')
        .set('x-api-key', 'test-api-key')
        .expect(200);
      
      const metricsDuration = Date.now() - metricsStart;
      expect(metricsDuration).toBeLessThan(2000); // Should complete within 2 seconds
      
      // Verify metrics structure
      expect(metricsResponse.body.metrics).toHaveProperty('queue');
      expect(metricsResponse.body.metrics).toHaveProperty('workflow');
      expect(metricsResponse.body.metrics).toHaveProperty('performance');
      expect(metricsResponse.body.metrics).toHaveProperty('workload');
    });
  });
});
