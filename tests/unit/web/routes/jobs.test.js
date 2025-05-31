/**
 * Unit tests for jobs API routes
 */

const request = require('supertest');
const express = require('express');
const createJobRoutes = require('../../../../src/web/routes/jobs');

describe('Jobs Routes', () => {
  let app;
  let mockQueueManager;

  beforeEach(() => {
    // Mock queue manager
    mockQueueManager = {
      getJobs: jest.fn(),
      getJob: jest.fn(),
      retryJob: jest.fn(),
      removeJob: jest.fn(),
      updateJobPriority: jest.fn(),
      pauseQueue: jest.fn(),
      resumeQueue: jest.fn(),
      cleanQueue: jest.fn(),
      getQueueStats: jest.fn(),
      getQueues: jest.fn()
    };

    app = express();
    app.use(express.json());
    
    // Mock authentication middleware
    app.use((req, res, next) => {
      req.user = { id: 'user-1', role: 'admin', permissions: ['read', 'write'] };
      next();
    });

    // Create routes with dependencies
    const jobRoutes = createJobRoutes({
      queueManager: mockQueueManager
    });

    app.use('/api/jobs', jobRoutes);
  });

  describe('GET /', () => {
    it('should return jobs list from queue manager', async () => {
      const mockJobs = [
        {
          id: 'job-1',
          name: 'Process PDF',
          queue: { name: 'ingestion' },
          data: { filename: 'test.pdf' },
          progress: 50,
          processedOn: Date.now(),
          finishedOn: null,
          failedReason: null,
          opts: { priority: 1 }
        }
      ];

      mockQueueManager.getQueues.mockResolvedValue(['ingestion', 'enrichment']);
      mockQueueManager.getJobs.mockResolvedValue(mockJobs);

      const response = await request(app)
        .get('/api/jobs')
        .expect(200);

      expect(response.body.jobs).toHaveLength(1);
      expect(response.body.jobs[0].id).toBe('job-1');
    });

    it('should handle query parameters correctly', async () => {
      mockQueueManager.getQueues.mockResolvedValue(['ingestion']);
      mockQueueManager.getJobs.mockResolvedValue([]);

      await request(app)
        .get('/api/jobs?page=2&limit=25&status=failed&queue=ingestion')
        .expect(200);

      expect(mockQueueManager.getQueues).toHaveBeenCalled();
    });
  });

  describe('GET /:queue/:jobId', () => {
    it('should return job details', async () => {
      const mockJob = {
        id: 'job-1',
        name: 'Process PDF',
        queue: { name: 'ingestion' },
        data: { filename: 'test.pdf' },
        progress: 100,
        logs: [{ message: 'Started processing' }, { message: 'Completed successfully' }]
      };

      mockQueueManager.getJob.mockResolvedValue(mockJob);

      const response = await request(app)
        .get('/api/jobs/ingestion/job-1')
        .expect(200);

      expect(response.body.job.id).toBe('job-1');
      expect(response.body.job.name).toBe('Process PDF');
      expect(mockQueueManager.getJob).toHaveBeenCalledWith('ingestion', 'job-1');
    });

    it('should handle job not found', async () => {
      mockQueueManager.getJob.mockResolvedValue(null);

      await request(app)
        .get('/api/jobs/ingestion/nonexistent')
        .expect(404);
    });
  });

  describe('POST /:queue/:jobId/retry', () => {
    it('should retry failed job successfully', async () => {
      const mockJob = {
        id: 'job-1',
        failedReason: 'Network timeout'
      };

      mockQueueManager.getJob.mockResolvedValue(mockJob);
      mockQueueManager.retryJob.mockResolvedValue({ success: true });

      const response = await request(app)
        .post('/api/jobs/ingestion/job-1/retry')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(mockQueueManager.retryJob).toHaveBeenCalledWith('ingestion', 'job-1');
    });

    it('should handle retry errors', async () => {
      mockQueueManager.getJob.mockResolvedValue({ id: 'job-1' });
      mockQueueManager.retryJob.mockRejectedValue(new Error('Cannot retry active job'));

      await request(app)
        .post('/api/jobs/ingestion/job-1/retry')
        .expect(500);
    });
  });

  describe('DELETE /:queue/:jobId', () => {
    it('should remove job successfully', async () => {
      const mockJob = { id: 'job-1' };
      
      mockQueueManager.getJob.mockResolvedValue(mockJob);
      mockQueueManager.removeJob.mockResolvedValue({ success: true });

      const response = await request(app)
        .delete('/api/jobs/ingestion/job-1')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(mockQueueManager.removeJob).toHaveBeenCalledWith('ingestion', 'job-1');
    });

    it('should handle removal errors', async () => {
      mockQueueManager.getJob.mockResolvedValue({ id: 'job-1' });
      mockQueueManager.removeJob.mockRejectedValue(new Error('Job not found'));

      await request(app)
        .delete('/api/jobs/ingestion/job-1')
        .expect(500);
    });
  });

  describe('GET /stats/overview', () => {
    it('should return queue statistics', async () => {
      const mockStats = {
        totalJobs: 250,
        activeJobs: 5,
        completedJobs: 200,
        failedJobs: 15,
        queueStats: {
          ingestion: { waiting: 5, active: 2, completed: 150, failed: 3 },
          enrichment: { waiting: 2, active: 1, completed: 89, failed: 1 }
        }
      };

      mockQueueManager.getQueues.mockResolvedValue(['ingestion', 'enrichment']);
      mockQueueManager.getJobs.mockResolvedValue([]);

      const response = await request(app)
        .get('/api/jobs/stats/overview')
        .expect(200);

      expect(response.body.stats).toBeDefined();
    });
  });
});
