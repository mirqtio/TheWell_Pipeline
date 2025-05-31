/**
 * Integration tests for Manual Review Web Server
 */

const request = require('supertest');
const ManualReviewServer = require('../../../src/web/server');

describe('Manual Review Server Integration', () => {
  let server;
  let mockQueueManager;
  let mockIngestionEngine;

  beforeEach(async () => {
    // Mock dependencies
    mockQueueManager = {
      getJobs: jest.fn().mockResolvedValue([
        {
          id: 'job-1',
          queue: 'ingestion',
          name: 'Process PDF',
          status: 'active',
          progress: 50,
          data: { filename: 'test.pdf' },
          timestamp: new Date().toISOString(),
          opts: { priority: 1, attempts: 3 }
        }
      ]),
      getJob: jest.fn().mockImplementation((queueName, jobId) => {
        if (queueName === 'ingestion' && jobId === 'job-1') {
          return Promise.resolve({
            id: 'job-1',
            queue: 'ingestion',
            name: 'Process PDF',
            status: 'completed',
            progress: 100,
            getState: jest.fn().mockReturnValue('completed'),
            failedReason: null
          });
        }
        return Promise.resolve(null);
      }),
      getQueueStats: jest.fn().mockResolvedValue({
        waiting: 5,
        active: 2,
        completed: 150,
        failed: 3,
        delayed: 0,
        paused: false
      }),
      getQueueNames: jest.fn().mockReturnValue(['ingestion', 'manual-review']),
      pauseQueue: jest.fn().mockResolvedValue(true),
      resumeQueue: jest.fn().mockResolvedValue(true),
      cleanQueue: jest.fn().mockResolvedValue(25)
    };

    mockIngestionEngine = {
      getPendingDocuments: jest.fn().mockResolvedValue({
        documents: [
          {
            id: 'doc-1',
            title: 'Test Document',
            contentPreview: 'This is a test document...',
            status: 'pending',
            metadata: { fileType: 'pdf', size: 1024 },
            createdAt: new Date().toISOString()
          }
        ],
        pagination: { page: 1, pages: 1, total: 1, hasNext: false, hasPrev: false }
      }),
      getDocument: jest.fn().mockResolvedValue({
        document: {
          id: 'doc-1',
          title: 'Test Document',
          content: 'Full document content here...',
          metadata: { fileType: 'pdf', size: 1024 },
          flags: []
        }
      }),
      approveDocument: jest.fn().mockResolvedValue({ success: true }),
      rejectDocument: jest.fn().mockResolvedValue({ success: true }),
      flagDocument: jest.fn().mockResolvedValue({ success: true }),
      getReviewStats: jest.fn().mockResolvedValue({
        stats: {
          queue: { waiting: 15, reviewing: 3, completed: 245 },
          recent: { approved: 89, rejected: 12, flagged: 5, approvalRate: 88 },
          performance: { avgReviewTime: 180, documentsPerHour: 12 }
        }
      })
    };

    // Create server instance
    server = new ManualReviewServer({
      queueManager: mockQueueManager,
      ingestionEngine: mockIngestionEngine,
      port: 0, // Use random port for testing
      host: 'localhost'
    });

    await server.start();
  });

  afterEach(async () => {
    if (server) {
      await server.shutdown();
    }
  });

  describe('Server Startup and Shutdown', () => {
    it('should start server successfully', () => {
      expect(server.isRunning).toBe(true);
    });

    it('should serve static files', async () => {
      const response = await request(server.app)
        .get('/')
        .expect(200);

      expect(response.text).toContain('TheWell Pipeline - Manual Review');
    });

    it('should handle CORS correctly', async () => {
      const response = await request(server.app)
        .options('/api/status')
        .set('Origin', 'http://localhost:3000')
        .expect(204);

      expect(response.headers['access-control-allow-origin']).toBeDefined();
    });
  });

  describe('API Authentication', () => {
    it('should require API key for protected routes', async () => {
      await request(server.app)
        .get('/api/review/pending')
        .expect(401);
    });

    it('should accept valid API key', async () => {
      await request(server.app)
        .get('/api/review/pending')
        .set('X-API-Key', 'dev-review-key')
        .expect(200);
    });

    it('should reject invalid API key', async () => {
      await request(server.app)
        .get('/api/review/pending')
        .set('X-API-Key', 'invalid-key')
        .expect(401);
    });
  });

  describe('Review API Integration', () => {
    const apiKey = 'dev-review-key';

    it('should get pending documents', async () => {
      const response = await request(server.app)
        .get('/api/review/pending')
        .set('X-API-Key', apiKey)
        .expect(200);

      expect(response.body.documents).toHaveLength(1);
      expect(response.body.documents[0].id).toBe('doc-1');
      expect(mockIngestionEngine.getPendingDocuments).toHaveBeenCalled();
    });

    it('should get document details', async () => {
      const response = await request(server.app)
        .get('/api/review/document/doc-1')
        .set('X-API-Key', apiKey)
        .expect(200);

      expect(response.body.document.id).toBe('doc-1');
      expect(response.body.document.title).toBe('Test Document');
      expect(mockIngestionEngine.getDocument).toHaveBeenCalledWith('doc-1');
    });

    it('should approve document', async () => {
      const response = await request(server.app)
        .post('/api/review/approve/doc-1')
        .set('X-API-Key', apiKey)
        .send({
          notes: 'Approved for publication',
          visibility: 'public',
          tags: ['approved']
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(mockIngestionEngine.approveDocument).toHaveBeenCalledWith('doc-1', expect.objectContaining({
        notes: 'Approved for publication',
        visibility: 'public',
        tags: ['approved']
      }));
    });

    it('should reject document', async () => {
      const response = await request(server.app)
        .post('/api/review/reject/doc-1')
        .set('X-API-Key', apiKey)
        .send({
          reason: 'Quality issues',
          notes: 'Contains factual errors',
          permanent: false
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(mockIngestionEngine.rejectDocument).toHaveBeenCalledWith('doc-1', expect.objectContaining({
        reason: 'Quality issues',
        notes: 'Contains factual errors',
        permanent: false
      }));
    });

    it('should flag document', async () => {
      const response = await request(server.app)
        .post('/api/review/flag/doc-1')
        .set('X-API-Key', apiKey)
        .send({
          flag: 'quality-issue',
          notes: 'Needs technical review',
          priority: 2
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(mockIngestionEngine.flagDocument).toHaveBeenCalledWith('doc-1', expect.objectContaining({
        flag: 'quality-issue',
        notes: 'Needs technical review',
        priority: 2
      }));
    });

    it('should get review statistics', async () => {
      const response = await request(server.app)
        .get('/api/review/stats')
        .set('X-API-Key', apiKey)
        .expect(200);

      expect(response.body.stats.queue.waiting).toBe(15);
      expect(response.body.stats.recent.approvalRate).toBe(88);
      expect(mockIngestionEngine.getReviewStats).toHaveBeenCalled();
    });
  });

  describe('Jobs API Integration', () => {
    const apiKey = 'dev-review-key';

    it('should get jobs list', async () => {
      const response = await request(server.app)
        .get('/api/jobs?queue=ingestion&status=active')
        .set('X-API-Key', apiKey)
        .expect(200);

      expect(response.body.jobs).toHaveLength(1);
      expect(response.body.jobs[0].id).toBe('job-1');
      expect(mockQueueManager.getJobs).toHaveBeenCalled();
    });

    it('should get job details', async () => {
      const response = await request(server.app)
        .get('/api/jobs/ingestion/job-1')
        .set('X-API-Key', apiKey)
        .expect(200);

      expect(response.body.job.id).toBe('job-1');
      expect(response.body.job.status).toBe('completed');
      expect(mockQueueManager.getJob).toHaveBeenCalledWith('ingestion', 'job-1');
    });

    it('should get queue statistics', async () => {
      const response = await request(server.app)
        .get('/api/jobs/stats/queues')
        .set('X-API-Key', apiKey)
        .expect(200);

      expect(response.body.queues.ingestion.waiting).toBe(5);
      expect(mockQueueManager.getQueueStats).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    const apiKey = 'dev-review-key';

    it('should handle 404 for unknown routes', async () => {
      await request(server.app)
        .get('/api/unknown')
        .set('X-API-Key', apiKey)
        .expect(404);
    });

    it('should handle validation errors', async () => {
      await request(server.app)
        .post('/api/review/reject/test-id')
        .set('X-API-Key', apiKey)
        .send({}) // Missing required 'reason' field
        .expect(400);
    });

    it('should handle internal server errors', async () => {
      mockIngestionEngine.getPendingDocuments.mockRejectedValue(new Error('Database error'));

      await request(server.app)
        .get('/api/review/pending')
        .set('X-API-Key', apiKey)
        .expect(500);
    });
  });

  describe('Health Check', () => {
    it('should return system status', async () => {
      const response = await request(server.app)
        .get('/api/status')
        .set('X-API-Key', 'dev-review-key')
        .expect(200);

      expect(response.body.status).toBeDefined();
      expect(response.body.status.timestamp).toBeDefined();
    });
  });
});
