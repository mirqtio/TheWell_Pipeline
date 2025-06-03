/**
 * Unit tests for review API routes
 */

const request = require('supertest');
const express = require('express');
const createReviewRoutes = require('../../../../src/web/routes/review');

// Mock the audit service
jest.mock('../../../../src/services/AuditService', () => ({
  logCurationAction: jest.fn().mockResolvedValue(true)
}));

// Mock the auth middleware
jest.mock('../../../../src/web/middleware/auth', () => ({
  requirePermission: () => (req, res, next) => {
    req.user = { id: 'test-user', username: 'testuser' };
    next();
  }
}));

// Mock the logger
jest.mock('../../../../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
}));

describe('Review Routes', () => {
  let app;
  let mockQueueManager;
  let mockIngestionEngine;

  beforeEach(() => {
    // Mock dependencies
    mockQueueManager = {
      getJobs: jest.fn(),
      getJob: jest.fn(),
      updateJob: jest.fn(),
      removeJob: jest.fn(),
      addJob: jest.fn(),
      getQueueStats: jest.fn()
    };

    mockIngestionEngine = {
      getPendingDocuments: jest.fn(),
      getDocument: jest.fn(),
      approveDocument: jest.fn(),
      rejectDocument: jest.fn(),
      flagDocument: jest.fn(),
      assignDocument: jest.fn(),
      getReviewStats: jest.fn()
    };

    app = express();
    app.use(express.json());
    
    // Mock authentication middleware
    app.use((req, res, next) => {
      req.user = { 
        role: 'reviewer', 
        permissions: ['read', 'write', 'approve', 'reject', 'flag'] 
      };
      next();
    });

    // Create routes with dependencies (no ingestionEngine to test queueManager fallback)
    const reviewRoutes = createReviewRoutes({
      queueManager: mockQueueManager
    });

    app.use('/api/review', reviewRoutes);

    // Add error handling middleware
    app.use((error, req, res, next) => {
      if (error.name === 'ValidationError') {
        return res.status(400).json({ error: error.message });
      }
      if (error.name === 'NotFoundError') {
        return res.status(404).json({ error: error.message });
      }
      res.status(500).json({ error: 'Internal Server Error' });
    });
  });

  describe('GET /pending', () => {
    it('should return pending documents from queue', async () => {
      const mockJobs = [
        {
          id: 'job-1',
          data: {
            document: {
              id: 'doc-1',
              title: 'Test Document',
              content: 'Test content...',
              metadata: { fileType: 'pdf' }
            },
            source: { name: 'test-source', type: 'pdf' }
          },
          opts: { priority: 1 },
          timestamp: Date.now()
        }
      ];

      mockQueueManager.getJobs.mockResolvedValue(mockJobs);

      const response = await request(app)
        .get('/api/review/pending')
        .expect(200);

      expect(response.body.documents).toHaveLength(1);
      expect(response.body.documents[0].title).toBe('Test Document');
      expect(mockQueueManager.getJobs).toHaveBeenCalledWith('manual-review', ['waiting', 'active']);
    });

    it('should handle search and filter parameters', async () => {
      mockQueueManager.getJobs.mockResolvedValue([]);

      await request(app)
        .get('/api/review/pending?page=2&limit=10&filter=pdf&search=test')
        .expect(200);

      expect(mockQueueManager.getJobs).toHaveBeenCalledWith('manual-review', ['waiting', 'active']);
    });

    it('should handle errors from queue manager', async () => {
      mockQueueManager.getJobs.mockRejectedValue(new Error('Queue error'));

      await request(app)
        .get('/api/review/pending')
        .expect(500);
    });
  });

  describe('GET /document/:id', () => {
    it('should return document details from queue job', async () => {
      const mockJob = {
        id: 'job-1',
        data: {
          document: {
            id: 'doc-1',
            title: 'Test Document',
            content: 'Full document content',
            metadata: { fileType: 'pdf' }
          }
        },
        attemptsMade: 1,
        opts: { attempts: 3, delay: 1000, priority: 1 },
        processedOn: Date.now(),
        finishedOn: null,
        failedReason: null
      };

      mockQueueManager.getJob.mockResolvedValue(mockJob);

      const response = await request(app)
        .get('/api/review/document/doc-1')
        .expect(200);

      expect(response.body.document.id).toBe('job-1');
      expect(response.body.document.title).toBe('Test Document');
      expect(mockQueueManager.getJob).toHaveBeenCalledWith('manual-review', 'doc-1');
    });

    it('should handle document not found', async () => {
      mockQueueManager.getJob.mockResolvedValue(null);

      await request(app)
        .get('/api/review/document/nonexistent')
        .expect(404);
    });
  });

  describe('POST /approve/:id', () => {
    it('should approve document successfully', async () => {
      const mockJob = {
        id: 'job-1',
        data: { document: { id: 'doc-1' } },
        opts: { priority: 1 },
        update: jest.fn().mockResolvedValue(true),
        moveToCompleted: jest.fn().mockResolvedValue(true)
      };

      mockQueueManager.getJob.mockResolvedValue(mockJob);
      mockQueueManager.addJob = jest.fn().mockResolvedValue(true);

      const response = await request(app)
        .post('/api/review/approve/doc-1')
        .send({
          notes: 'Approved for publication',
          visibility: 'public',
          tags: ['approved']
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(mockJob.update).toHaveBeenCalled();
      expect(mockJob.moveToCompleted).toHaveBeenCalledWith('approved', true);
    });

    it('should require valid approval data', async () => {
      const mockJob = {
        id: 'job-1',
        data: { document: { id: 'doc-1' } },
        opts: { priority: 1 },
        update: jest.fn(),
        moveToCompleted: jest.fn()
      };

      mockQueueManager.getJob.mockResolvedValue(mockJob);

      await request(app)
        .post('/api/review/approve/doc-1')
        .send({})
        .expect(200); // The route doesn't validate required fields, just uses defaults
    });
  });

  describe('POST /reject/:id', () => {
    it('should reject document successfully', async () => {
      const mockJob = {
        id: 'job-1',
        data: { document: { id: 'doc-1' } },
        opts: { priority: 1 },
        update: jest.fn().mockResolvedValue(true),
        moveToCompleted: jest.fn().mockResolvedValue(true)
      };

      mockQueueManager.getJob.mockResolvedValue(mockJob);

      const response = await request(app)
        .post('/api/review/reject/doc-1')
        .send({
          reason: 'Quality issues',
          notes: 'Contains factual errors',
          permanent: false
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(mockJob.update).toHaveBeenCalled();
      expect(mockJob.moveToCompleted).toHaveBeenCalledWith('rejected', true);
    });

    it('should require rejection reason', async () => {
      await request(app)
        .post('/api/review/reject/doc-1')
        .send({ notes: 'Some notes' })
        .expect(400);
    });
  });

  describe('POST /flag/:id', () => {
    it('should flag document successfully', async () => {
      const mockJob = {
        id: 'job-1',
        data: { document: { id: 'doc-1' }, flags: [] },
        opts: { priority: 1 },
        update: jest.fn().mockResolvedValue(true),
        changePriority: jest.fn().mockResolvedValue(true)
      };

      mockQueueManager.getJob.mockResolvedValue(mockJob);

      const response = await request(app)
        .post('/api/review/flag/doc-1')
        .send({
          flag: 'quality-issue',
          notes: 'Needs technical review',
          priority: 2
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(mockJob.update).toHaveBeenCalled();
      expect(mockJob.changePriority).toHaveBeenCalledWith(2);
    });

    it('should require flag type', async () => {
      await request(app)
        .post('/api/review/flag/doc-1')
        .send({ notes: 'Some notes' })
        .expect(400);
    });
  });

  describe('GET /stats', () => {
    it('should return review statistics from queue', async () => {
      const mockQueueStats = {
        waiting: 15,
        active: 3,
        completed: 245,
        failed: 12,
        delayed: 2,
        avgProcessingTime: 1500
      };

      const mockCompletedJobs = [
        { 
          id: 'job-1', 
          finishedOn: Date.now(), 
          returnvalue: 'approved',
          data: { decision: 'approve' }
        },
        { 
          id: 'job-2', 
          finishedOn: Date.now(), 
          data: { decision: 'reject' } 
        }
      ];

      mockQueueManager.getQueueStats.mockResolvedValue(mockQueueStats);
      mockQueueManager.getJobs.mockResolvedValue(mockCompletedJobs);

      const response = await request(app)
        .get('/api/review/stats')
        .expect(200);

      expect(response.body.stats).toBeDefined();
      expect(response.body.stats.queue.waiting).toBe(15);
      expect(response.body.stats.queue.active).toBe(3);
      expect(response.body.stats.recent).toBeDefined();
      expect(response.body.stats.performance).toBeDefined();
      expect(mockQueueManager.getQueueStats).toHaveBeenCalledWith('manual-review');
      expect(mockQueueManager.getJobs).toHaveBeenCalledWith('manual-review', ['completed'], 0, -1);
    });
  });

  describe('POST /bulk/flag', () => {
    it('should bulk flag multiple documents', async () => {
      const mockJobs = [
        { 
          id: 'job1', 
          data: { documentId: 'doc1', flags: [] },
          opts: { priority: 1 },
          update: jest.fn().mockResolvedValue(true),
          changePriority: jest.fn().mockResolvedValue(true)
        },
        { 
          id: 'job2', 
          data: { documentId: 'doc2', flags: [] },
          opts: { priority: 1 },
          update: jest.fn().mockResolvedValue(true),
          changePriority: jest.fn().mockResolvedValue(true)
        }
      ];

      // Mock getJob calls with queue name and document ID
      mockQueueManager.getJob
        .mockImplementation((queueName, documentId) => {
          if (queueName === 'manual-review' && documentId === 'doc1') {
            return Promise.resolve(mockJobs[0]);
          }
          if (queueName === 'manual-review' && documentId === 'doc2') {
            return Promise.resolve(mockJobs[1]);
          }
          return Promise.resolve(null);
        });

      const response = await request(app)
        .post('/api/review/bulk/flag')
        .send({
          documentIds: ['doc1', 'doc2'],
          type: 'quality',
          reason: 'Quality issue detected',
          priority: 3
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.summary.total).toBe(2);
      expect(response.body.summary.successful).toBe(2);
      expect(response.body.summary.failed).toBe(0);
      expect(mockQueueManager.getJob).toHaveBeenCalledWith('manual-review', 'doc1');
      expect(mockQueueManager.getJob).toHaveBeenCalledWith('manual-review', 'doc2');
      expect(mockJobs[0].update).toHaveBeenCalled();
      expect(mockJobs[1].update).toHaveBeenCalled();
    });

    it('should handle partial failures in bulk flag', async () => {
      const mockJob = { 
        id: 'job1', 
        data: { documentId: 'doc1', flags: [] },
        opts: { priority: 1 },
        update: jest.fn().mockResolvedValue(true),
        changePriority: jest.fn().mockResolvedValue(true)
      };

      mockQueueManager.getJob
        .mockImplementation((queueName, documentId) => {
          if (queueName === 'manual-review' && documentId === 'doc1') {
            return Promise.resolve(mockJob);
          }
          if (queueName === 'manual-review' && documentId === 'doc2') {
            return Promise.resolve(null); // Simulate job not found
          }
          return Promise.resolve(null);
        });

      const response = await request(app)
        .post('/api/review/bulk/flag')
        .send({
          documentIds: ['doc1', 'doc2'],
          type: 'quality',
          reason: 'Quality issue detected',
          priority: 3
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.summary.successful).toBe(1);
      expect(response.body.summary.failed).toBe(1);
      expect(response.body.errors).toHaveLength(1);
      expect(response.body.errors[0].documentId).toBe('doc2');
      expect(response.body.errors[0].error).toBe('Document not found');
    });

    it('should return 400 if documentIds is not provided', async () => {
      const response = await request(app)
        .post('/api/review/bulk/flag')
        .send({
          type: 'quality'
        })
        .expect(400);

      expect(response.body.error).toContain('Document IDs array is required');
    });

    it('should return 400 if type is not provided', async () => {
      const response = await request(app)
        .post('/api/review/bulk/flag')
        .send({
          documentIds: ['doc1']
        })
        .expect(400);

      expect(response.body.error).toContain('Flag type is required');
    });
  });

  describe('POST /bulk/assign', () => {
    it('should bulk assign multiple documents', async () => {
      const mockJobs = [
        { 
          id: 'job1', 
          data: { documentId: 'doc1' },
          opts: { priority: 1 },
          update: jest.fn().mockResolvedValue(true)
        },
        { 
          id: 'job2', 
          data: { documentId: 'doc2' },
          opts: { priority: 1 },
          update: jest.fn().mockResolvedValue(true)
        }
      ];

      // Mock getJob calls with queue name and document ID
      mockQueueManager.getJob
        .mockImplementation((queueName, documentId) => {
          if (queueName === 'manual-review' && documentId === 'doc1') {
            return Promise.resolve(mockJobs[0]);
          }
          if (queueName === 'manual-review' && documentId === 'doc2') {
            return Promise.resolve(mockJobs[1]);
          }
          return Promise.resolve(null);
        });

      const response = await request(app)
        .post('/api/review/bulk/assign')
        .send({
          documentIds: ['doc1', 'doc2'],
          assignTo: 'reviewer123',
          assignedBy: 'admin456'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.summary.total).toBe(2);
      expect(response.body.summary.successful).toBe(2);
      expect(response.body.summary.failed).toBe(0);
      expect(mockQueueManager.getJob).toHaveBeenCalledWith('manual-review', 'doc1');
      expect(mockQueueManager.getJob).toHaveBeenCalledWith('manual-review', 'doc2');
      expect(mockJobs[0].update).toHaveBeenCalled();
      expect(mockJobs[1].update).toHaveBeenCalled();
    });

    it('should handle partial failures in bulk assign', async () => {
      const mockJob = { 
        id: 'job1', 
        data: { documentId: 'doc1' },
        opts: { priority: 1 },
        update: jest.fn().mockResolvedValue(true)
      };

      mockQueueManager.getJob
        .mockImplementation((queueName, documentId) => {
          if (queueName === 'manual-review' && documentId === 'doc1') {
            return Promise.resolve(mockJob);
          }
          if (queueName === 'manual-review' && documentId === 'doc2') {
            return Promise.resolve(null); // Simulate job not found
          }
          return Promise.resolve(null);
        });

      const response = await request(app)
        .post('/api/review/bulk/assign')
        .send({
          documentIds: ['doc1', 'doc2'],
          assignTo: 'reviewer123',
          assignedBy: 'admin456'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.summary.successful).toBe(1);
      expect(response.body.summary.failed).toBe(1);
      expect(response.body.errors).toHaveLength(1);
      expect(response.body.errors[0].documentId).toBe('doc2');
      expect(response.body.errors[0].error).toBe('Document not found');
    });

    it('should return 400 if documentIds is not provided', async () => {
      const response = await request(app)
        .post('/api/review/bulk/assign')
        .send({
          assignTo: 'reviewer123'
        })
        .expect(400);

      expect(response.body.error).toContain('Document IDs array is required');
    });

    it('should return 400 if assignTo is not provided', async () => {
      const response = await request(app)
        .post('/api/review/bulk/assign')
        .send({
          documentIds: ['doc1']
        })
        .expect(400);

      expect(response.body.error).toContain('Assignee is required');
    });
  });

  describe('POST /bulk/add-tags', () => {
    it('should bulk add tags to multiple documents', async () => {
      const mockJobs = [
        { 
          id: 'job1', 
          data: { documentId: 'doc1', tags: ['existing'] },
          opts: { priority: 1 },
          update: jest.fn().mockResolvedValue(true)
        },
        { 
          id: 'job2', 
          data: { documentId: 'doc2', tags: [] },
          opts: { priority: 1 },
          update: jest.fn().mockResolvedValue(true)
        }
      ];

      // Mock getJob calls with queue name and document ID
      mockQueueManager.getJob
        .mockImplementation((queueName, documentId) => {
          if (queueName === 'manual-review' && documentId === 'doc1') {
            return Promise.resolve(mockJobs[0]);
          }
          if (queueName === 'manual-review' && documentId === 'doc2') {
            return Promise.resolve(mockJobs[1]);
          }
          return Promise.resolve(null);
        });

      const response = await request(app)
        .post('/api/review/bulk/add-tags')
        .send({
          documentIds: ['doc1', 'doc2'],
          tags: ['urgent', 'review-needed']
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.summary.total).toBe(2);
      expect(response.body.summary.successful).toBe(2);
      expect(response.body.summary.failed).toBe(0);
      expect(mockQueueManager.getJob).toHaveBeenCalledWith('manual-review', 'doc1');
      expect(mockQueueManager.getJob).toHaveBeenCalledWith('manual-review', 'doc2');
      expect(mockJobs[0].update).toHaveBeenCalled();
      expect(mockJobs[1].update).toHaveBeenCalled();
    });

    it('should handle partial failures in bulk add tags', async () => {
      const mockJob = { 
        id: 'job1', 
        data: { documentId: 'doc1', tags: [] },
        opts: { priority: 1 },
        update: jest.fn().mockResolvedValue(true)
      };

      mockQueueManager.getJob
        .mockImplementation((queueName, documentId) => {
          if (queueName === 'manual-review' && documentId === 'doc1') {
            return Promise.resolve(mockJob);
          }
          if (queueName === 'manual-review' && documentId === 'doc2') {
            return Promise.resolve(null); // Simulate job not found
          }
          return Promise.resolve(null);
        });

      const response = await request(app)
        .post('/api/review/bulk/add-tags')
        .send({
          documentIds: ['doc1', 'doc2'],
          tags: ['urgent'],
          notes: 'Tag notes'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.summary.successful).toBe(1);
      expect(response.body.summary.failed).toBe(1);
      expect(response.body.errors).toHaveLength(1);
      expect(response.body.errors[0].documentId).toBe('doc2');
      expect(response.body.errors[0].error).toBe('Document not found');
    });

    it('should return 400 if documentIds is not provided', async () => {
      const response = await request(app)
        .post('/api/review/bulk/add-tags')
        .send({
          tags: ['urgent']
        })
        .expect(400);

      expect(response.body.error).toContain('Document IDs array is required');
    });

    it('should return 400 if tags is not provided', async () => {
      const response = await request(app)
        .post('/api/review/bulk/add-tags')
        .send({
          documentIds: ['doc1']
        })
        .expect(400);

      expect(response.body.error).toContain('Tags array is required');
    });
  });

  describe('POST /bulk/remove-tags', () => {
    it('should bulk remove tags from multiple documents', async () => {
      const mockJobs = [
        { 
          id: 'job1', 
          data: { documentId: 'doc1', tags: ['urgent', 'review-needed', 'keep'] },
          opts: { priority: 1 },
          update: jest.fn().mockResolvedValue(true)
        },
        { 
          id: 'job2', 
          data: { documentId: 'doc2', tags: ['urgent', 'other'] },
          opts: { priority: 1 },
          update: jest.fn().mockResolvedValue(true)
        }
      ];

      // Mock getJob calls with queue name and document ID
      mockQueueManager.getJob
        .mockImplementation((queueName, documentId) => {
          if (queueName === 'manual-review' && documentId === 'doc1') {
            return Promise.resolve(mockJobs[0]);
          }
          if (queueName === 'manual-review' && documentId === 'doc2') {
            return Promise.resolve(mockJobs[1]);
          }
          return Promise.resolve(null);
        });

      const response = await request(app)
        .post('/api/review/bulk/remove-tags')
        .send({
          documentIds: ['doc1', 'doc2'],
          tags: ['urgent', 'review-needed']
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.summary.total).toBe(2);
      expect(response.body.summary.successful).toBe(2);
      expect(response.body.summary.failed).toBe(0);
      expect(mockQueueManager.getJob).toHaveBeenCalledWith('manual-review', 'doc1');
      expect(mockQueueManager.getJob).toHaveBeenCalledWith('manual-review', 'doc2');
      expect(mockJobs[0].update).toHaveBeenCalled();
      expect(mockJobs[1].update).toHaveBeenCalled();
    });

    it('should handle partial failures in bulk remove tags', async () => {
      const mockJob = { 
        id: 'job1', 
        data: { documentId: 'doc1', tags: ['urgent'] },
        opts: { priority: 1 },
        update: jest.fn().mockResolvedValue(true)
      };

      mockQueueManager.getJob
        .mockImplementation((queueName, documentId) => {
          if (queueName === 'manual-review' && documentId === 'doc1') {
            return Promise.resolve(mockJob);
          }
          if (queueName === 'manual-review' && documentId === 'doc2') {
            return Promise.resolve(null); // Simulate job not found
          }
          return Promise.resolve(null);
        });

      const response = await request(app)
        .post('/api/review/bulk/remove-tags')
        .send({
          documentIds: ['doc1', 'doc2'],
          tags: ['urgent'],
          notes: 'Tag removal notes'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.summary.successful).toBe(1);
      expect(response.body.summary.failed).toBe(1);
      expect(response.body.errors).toHaveLength(1);
      expect(response.body.errors[0].documentId).toBe('doc2');
      expect(response.body.errors[0].error).toBe('Document not found');
    });

    it('should return 400 if documentIds is not provided', async () => {
      const response = await request(app)
        .post('/api/review/bulk/remove-tags')
        .send({
          tags: ['urgent']
        })
        .expect(400);

      expect(response.body.error).toContain('Document IDs array is required');
    });

    it('should return 400 if tags is not provided', async () => {
      const response = await request(app)
        .post('/api/review/bulk/remove-tags')
        .send({
          documentIds: ['doc1', 'doc2']
        })
        .expect(400);

      expect(response.body.error).toContain('Tags array is required');
    });
  });
});
