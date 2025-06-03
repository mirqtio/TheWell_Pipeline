/**
 * Unit tests for curation workflow endpoints
 */

const request = require('supertest');
const express = require('express');
const reviewRoutes = require('../../../../src/web/routes/review');
const { requirePermission } = require('../../../../src/web/middleware/auth');
const { asyncHandler } = require('../../../../src/web/middleware/errorHandler');

// Mock dependencies
jest.mock('../../../../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
}));

jest.mock('../../../../src/web/middleware/auth', () => ({
  requirePermission: jest.fn(() => (req, res, next) => {
    req.user = { id: 'test-user-id' };
    next();
  })
}));

jest.mock('../../../../src/services/AuditService', () => ({
  setContext: jest.fn(),
  logCurationAction: jest.fn(),
  logSessionActivity: jest.fn(),
  clearContext: jest.fn()
}));

describe('Curation Workflow Routes', () => {
  let app;
  let mockQueueManager;
  let mockJob;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Mock job object
    mockJob = {
      id: 'test-job-id',
      data: {
        document: {
          title: 'Test Document',
          content: 'Test content'
        },
        source: {
          id: 'source-1',
          name: 'Test Source',
          type: 'web'
        },
        status: 'pending'
      },
      opts: {
        priority: 1,
        attempts: 3
      },
      timestamp: Date.now(),
      update: jest.fn().mockResolvedValue(true),
      changePriority: jest.fn().mockResolvedValue(true),
      moveToCompleted: jest.fn().mockResolvedValue(true),
      moveToFailed: jest.fn().mockResolvedValue(true)
    };

    // Mock queue manager
    mockQueueManager = {
      getJob: jest.fn().mockResolvedValue(mockJob),
      addJob: jest.fn().mockResolvedValue({ id: 'new-job-id' }),
      getQueueStats: jest.fn().mockResolvedValue({
        waiting: 5,
        active: 2,
        completed: 10
      }),
      getJobs: jest.fn().mockResolvedValue([mockJob])
    };

    // Create Express app with routes
    app = express();
    app.use(express.json());
    app.use('/api/v1/review', reviewRoutes({ queueManager: mockQueueManager }));
    
    // Add error handler middleware
    const errorHandler = require('../../../../src/web/middleware/errorHandler');
    app.use((error, req, res, next) => {
      errorHandler(error, req, res, next);
    });
  });

  describe('POST /start-review/:id', () => {
    it('should start review workflow for a document', async () => {
      const response = await request(app)
        .post('/api/v1/review/start-review/test-job-id')
        .send({
          notes: 'Starting review',
          priority: 2
        })
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        message: 'Review workflow started',
        documentId: 'test-job-id',
        status: 'in-review',
        assignedTo: 'test-user-id',
        startedAt: expect.any(String)
      });

      expect(mockQueueManager.getJob).toHaveBeenCalledWith('manual-review', 'test-job-id');
      expect(mockJob.changePriority).toHaveBeenCalledWith(2);
      expect(mockJob.update).toHaveBeenCalledWith({
        ...mockJob.data,
        status: 'in-review',
        reviewStartedBy: 'test-user-id',
        reviewStartedAt: expect.any(String),
        reviewNotes: 'Starting review',
        workflowStage: 'review',
        assignedTo: 'test-user-id'
      });
    });

    it('should return 404 if document not found', async () => {
      mockQueueManager.getJob.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/v1/review/start-review/nonexistent-id')
        .set('x-api-key', 'test-api-key')
        .send({ notes: 'Test notes' })
        .expect(404);

      expect(response.body.error).toBe('Document nonexistent-id not found');
    });
  });

  describe('POST /bulk/approve', () => {
    it('should bulk approve multiple documents', async () => {
      const documentIds = ['doc1', 'doc2', 'doc3'];
      
      const response = await request(app)
        .post('/api/v1/review/bulk/approve')
        .send({
          documentIds,
          notes: 'Bulk approval',
          visibility: 'public',
          tags: ['approved', 'bulk']
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.results).toHaveLength(3);
      expect(response.body.errors).toHaveLength(0);
      expect(response.body.summary).toEqual({
        total: 3,
        successful: 3,
        failed: 0
      });

      expect(mockQueueManager.getJob).toHaveBeenCalledTimes(3);
      expect(mockJob.update).toHaveBeenCalledTimes(3);
      expect(mockQueueManager.addJob).toHaveBeenCalledTimes(3);
      expect(mockJob.moveToCompleted).toHaveBeenCalledTimes(3);
    });

    it('should handle errors for some documents in bulk operation', async () => {
      const documentIds = ['doc1', 'doc2', 'doc3'];
      
      // Make second document fail
      mockQueueManager.getJob
        .mockResolvedValueOnce(mockJob)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockJob);

      const response = await request(app)
        .post('/api/v1/review/bulk/approve')
        .send({
          documentIds,
          notes: 'Bulk approval'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.results).toHaveLength(2);
      expect(response.body.errors).toHaveLength(1);
      expect(response.body.errors[0]).toEqual({
        documentId: 'doc2',
        error: 'Document not found'
      });
    });

    it('should return 400 if documentIds is not provided', async () => {
      const response = await request(app)
        .post('/api/v1/review/bulk/approve')
        .set('x-api-key', 'test-api-key')
        .send({ notes: 'Test notes' })
        .expect(400);

      expect(response.body.error).toBe('Document IDs array is required');
    });
  });

  describe('POST /bulk/reject', () => {
    it('should bulk reject multiple documents', async () => {
      const documentIds = ['doc1', 'doc2'];
      
      const response = await request(app)
        .post('/api/v1/review/bulk/reject')
        .send({
          documentIds,
          reason: 'Quality issues',
          notes: 'Bulk rejection',
          permanent: false
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.results).toHaveLength(2);
      expect(response.body.errors).toHaveLength(0);

      expect(mockJob.update).toHaveBeenCalledWith({
        ...mockJob.data,
        status: 'rejected',
        rejectedBy: 'test-user-id',
        rejectedAt: expect.any(String),
        rejectionReason: 'Quality issues',
        reviewNotes: 'Bulk rejection',
        permanent: false,
        decision: 'reject',
        bulkOperation: true
      });
    });

    it('should return 400 if reason is not provided', async () => {
      const response = await request(app)
        .post('/api/v1/review/bulk/reject')
        .set('x-api-key', 'test-api-key')
        .send({ documentIds: ['doc1'] })
        .expect(400);

      expect(response.body.error).toBe('Rejection reason is required');
    });
  });

  describe('POST /bulk/start-review', () => {
    it('should bulk start review for multiple documents', async () => {
      const documentIds = ['doc1', 'doc2'];
      
      const response = await request(app)
        .post('/api/v1/review/bulk/start-review')
        .send({
          documentIds,
          notes: 'Bulk start review',
          assignTo: 'reviewer-id'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.results).toHaveLength(2);
      expect(response.body.errors).toHaveLength(0);

      expect(mockJob.update).toHaveBeenCalledWith({
        ...mockJob.data,
        status: 'in-review',
        reviewStartedBy: 'test-user-id',
        reviewStartedAt: expect.any(String),
        reviewNotes: 'Bulk start review',
        workflowStage: 'review',
        assignedTo: 'reviewer-id',
        bulkOperation: true
      });
    });
  });

  describe('GET /workflow/status', () => {
    it('should get workflow status for multiple documents', async () => {
      const response = await request(app)
        .get('/api/v1/review/workflow/status')
        .query({ documentIds: 'doc1,doc2' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.statuses).toHaveLength(2);
      expect(response.body.statuses[0]).toEqual({
        documentId: 'doc1',
        status: 'pending',
        workflowStage: 'pending',
        assignedTo: undefined,
        reviewStartedAt: undefined,
        lastUpdated: expect.any(Number)
      });
    });

    it('should return 400 if documentIds not provided', async () => {
      const response = await request(app)
        .get('/api/v1/review/workflow/status')
        .set('x-api-key', 'test-api-key')
        .expect(400);

      expect(response.body.error).toBe('Document IDs are required');
    });
  });

  describe('GET /workflow/metrics', () => {
    it('should get workflow metrics', async () => {
      // Mock jobs with different statuses
      const mockJobs = [
        { ...mockJob, data: { ...mockJob.data, status: 'pending' } },
        { ...mockJob, data: { ...mockJob.data, status: 'in-review' } },
        { ...mockJob, data: { ...mockJob.data, status: 'approved' } },
        { ...mockJob, data: { ...mockJob.data, status: 'rejected' } }
      ];
      
      mockQueueManager.getJobs.mockResolvedValue(mockJobs);

      const response = await request(app)
        .get('/api/v1/review/workflow/metrics')
        .query({ timeframe: '24h' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.metrics).toHaveProperty('queue');
      expect(response.body.metrics).toHaveProperty('workflow');
      expect(response.body.metrics).toHaveProperty('performance');
      expect(response.body.metrics).toHaveProperty('workload');
      expect(response.body.timeframe).toBe('24h');

      expect(response.body.metrics.queue).toEqual({
        waiting: 5,
        active: 2,
        completed: 10
      });

      expect(response.body.metrics.workflow).toEqual({
        pending: 1,
        inReview: 1,
        approved: 1,
        rejected: 1,
        flagged: 0
      });
    });
  });

  describe('Error handling', () => {
    it('should handle queue manager errors gracefully', async () => {
      mockQueueManager.getJob.mockRejectedValue(new Error('Queue error'));

      const response = await request(app)
        .post('/api/v1/review/start-review/test-doc-1')
        .set('x-api-key', 'test-api-key')
        .send({ notes: 'Test notes' })
        .expect(500);

      // For generic errors, the error handler returns "Internal Server Error" for security
      expect(response.body.error).toBe('Internal Server Error');
      expect(response.body.type).toBe('Error');
    });

    it('should handle job update errors in bulk operations', async () => {
      mockJob.update.mockRejectedValue(new Error('Update failed'));

      const response = await request(app)
        .post('/api/v1/review/bulk/approve')
        .send({
          documentIds: ['doc1'],
          notes: 'Bulk approval'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.results).toHaveLength(0);
      expect(response.body.errors).toHaveLength(1);
      expect(response.body.errors[0].error).toBe('Update failed');
    });
  });

  describe('Permission checks', () => {
    it('should require appropriate permissions for each endpoint', () => {
      expect(requirePermission).toHaveBeenCalledWith('write');
      expect(requirePermission).toHaveBeenCalledWith('approve');
      expect(requirePermission).toHaveBeenCalledWith('reject');
      expect(requirePermission).toHaveBeenCalledWith('read');
    });
  });
});
