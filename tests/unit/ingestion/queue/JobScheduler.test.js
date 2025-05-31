const JobScheduler = require('../../../../src/ingestion/queue/JobScheduler');

// Mock dependencies
jest.mock('../../../../src/ingestion/queue/QueueManager');
jest.mock('../../../../src/ingestion/queue/IngestionJobProcessor');

const QueueManager = require('../../../../src/ingestion/queue/QueueManager');
const IngestionJobProcessor = require('../../../../src/ingestion/queue/IngestionJobProcessor');

describe('JobScheduler', () => {
  let scheduler;
  let mockQueueManager;
  let mockJobProcessor;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock QueueManager
    mockQueueManager = {
      initialize: jest.fn().mockResolvedValue(undefined),
      startProcessing: jest.fn().mockResolvedValue(undefined),
      addIngestionJob: jest.fn().mockResolvedValue({ id: 'test-job-1' }),
      getJob: jest.fn(),
      getStats: jest.fn().mockResolvedValue({
        totalJobs: 10,
        completedJobs: 5,
        failedJobs: 1,
        activeJobs: 2,
        waitingJobs: 2
      }),
      retryJob: jest.fn().mockResolvedValue(true),
      removeJob: jest.fn().mockResolvedValue(true),
      pauseQueue: jest.fn().mockResolvedValue(undefined),
      resumeQueue: jest.fn().mockResolvedValue(undefined),
      cleanQueue: jest.fn().mockResolvedValue(undefined),
      shutdown: jest.fn().mockResolvedValue(undefined),
      on: jest.fn()
    };
    QueueManager.mockImplementation(() => mockQueueManager);

    // Mock IngestionJobProcessor
    mockJobProcessor = {
      initialize: jest.fn().mockResolvedValue(undefined),
      processJob: jest.fn().mockResolvedValue({ result: 'success' }),
      processBatch: jest.fn().mockResolvedValue({ result: 'batch-success' }),
      shutdown: jest.fn().mockResolvedValue(undefined)
    };
    IngestionJobProcessor.mockImplementation(() => mockJobProcessor);

    scheduler = new JobScheduler();
  });

  describe('Initialization', () => {
    test('should initialize successfully', async () => {
      const result = await scheduler.initialize();

      expect(result).toBe(true);
      expect(scheduler.isInitialized).toBe(true);
      expect(mockQueueManager.initialize).toHaveBeenCalled();
      expect(mockJobProcessor.initialize).toHaveBeenCalled();
      expect(mockQueueManager.startProcessing).toHaveBeenCalled();
    });

    test('should emit initialized event', async () => {
      const initSpy = jest.fn();
      scheduler.on('initialized', initSpy);

      await scheduler.initialize();

      expect(initSpy).toHaveBeenCalled();
    });

    test('should handle initialization errors', async () => {
      mockQueueManager.initialize.mockRejectedValue(new Error('Queue init failed'));

      await expect(scheduler.initialize()).rejects.toThrow('Failed to initialize JobScheduler');
    });

    test('should set up event forwarding', async () => {
      await scheduler.initialize();

      expect(mockQueueManager.on).toHaveBeenCalledWith('job-added', expect.any(Function));
      expect(mockQueueManager.on).toHaveBeenCalledWith('job-started', expect.any(Function));
      expect(mockQueueManager.on).toHaveBeenCalledWith('job-completed', expect.any(Function));
      expect(mockQueueManager.on).toHaveBeenCalledWith('job-failed', expect.any(Function));
      expect(mockQueueManager.on).toHaveBeenCalledWith('error', expect.any(Function));
    });
  });

  describe('Single Job Scheduling', () => {
    beforeEach(async () => {
      await scheduler.initialize();
    });

    test('should schedule ingestion job successfully', async () => {
      const sourceConfig = {
        id: 'test-source',
        type: 'static'
      };

      const jobId = await scheduler.scheduleIngestion(sourceConfig);

      expect(jobId).toBe('test-job-1');
      expect(mockQueueManager.addIngestionJob).toHaveBeenCalledWith(
        {
          type: 'single',
          sourceConfig,
          options: {},
          scheduledAt: expect.any(String)
        },
        {
          priority: 0,
          delay: 0,
          attempts: 3
        }
      );
    });

    test('should schedule job with custom options', async () => {
      const sourceConfig = { id: 'test-source', type: 'static' };
      const options = {
        priority: 'high',
        delay: 5000,
        attempts: 5
      };

      await scheduler.scheduleIngestion(sourceConfig, options);

      expect(mockQueueManager.addIngestionJob).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceConfig,
          options
        }),
        {
          priority: 10, // high priority
          delay: 5000,
          attempts: 5
        }
      );
    });

    test('should emit job-scheduled event', async () => {
      const scheduledSpy = jest.fn();
      scheduler.on('job-scheduled', scheduledSpy);

      const sourceConfig = { id: 'test-source', type: 'static' };
      await scheduler.scheduleIngestion(sourceConfig);

      expect(scheduledSpy).toHaveBeenCalledWith({
        jobId: 'test-job-1',
        sourceId: 'test-source',
        type: 'single',
        priority: 0
      });
    });

    test('should fail when not initialized', async () => {
      const uninitializedScheduler = new JobScheduler();
      const sourceConfig = { id: 'test-source', type: 'static' };

      await expect(uninitializedScheduler.scheduleIngestion(sourceConfig))
        .rejects.toThrow('JobScheduler not initialized');
    });
  });

  describe('Batch Job Scheduling', () => {
    beforeEach(async () => {
      await scheduler.initialize();
    });

    test('should schedule batch job successfully', async () => {
      const sources = [
        { id: 'source1', type: 'static' },
        { id: 'source2', type: 'static' }
      ];

      const jobId = await scheduler.scheduleBatch(sources);

      expect(jobId).toBe('test-job-1');
      expect(mockQueueManager.addIngestionJob).toHaveBeenCalledWith(
        {
          type: 'batch',
          batchId: expect.stringMatching(/^batch-\d+$/),
          sources,
          options: {},
          scheduledAt: expect.any(String)
        },
        expect.any(Object)
      );
    });

    test('should schedule batch with custom batch ID', async () => {
      const sources = [{ id: 'source1', type: 'static' }];
      const options = { batchId: 'custom-batch-id' };

      await scheduler.scheduleBatch(sources, options);

      expect(mockQueueManager.addIngestionJob).toHaveBeenCalledWith(
        expect.objectContaining({
          batchId: 'custom-batch-id'
        }),
        expect.any(Object)
      );
    });

    test('should emit batch-scheduled event', async () => {
      const batchSpy = jest.fn();
      scheduler.on('batch-scheduled', batchSpy);

      const sources = [{ id: 'source1', type: 'static' }];
      await scheduler.scheduleBatch(sources);

      expect(batchSpy).toHaveBeenCalledWith({
        jobId: 'test-job-1',
        batchId: expect.stringMatching(/^batch-\d+$/),
        sourcesCount: 1,
        priority: 0
      });
    });

    test('should fail with empty sources array', async () => {
      await expect(scheduler.scheduleBatch([])).rejects.toThrow('Sources must be a non-empty array');
    });

    test('should fail with non-array sources', async () => {
      await expect(scheduler.scheduleBatch(null)).rejects.toThrow('Sources must be a non-empty array');
    });
  });

  describe('Recurring Job Scheduling', () => {
    beforeEach(async () => {
      await scheduler.initialize();
    });

    test('should schedule recurring job successfully', async () => {
      const sourceConfig = { id: 'test-source', type: 'static' };
      const schedule = '0 2 * * *'; // Daily at 2 AM

      const scheduleId = await scheduler.scheduleRecurring(sourceConfig, schedule);

      expect(scheduleId).toMatch(/^recurring-test-source-\d+$/);
      expect(scheduler.scheduledJobs.has(scheduleId)).toBe(true);

      const job = scheduler.scheduledJobs.get(scheduleId);
      expect(job).toMatchObject({
        scheduleId,
        sourceConfig,
        schedule,
        isActive: true
      });
    });

    test('should emit recurring-scheduled event', async () => {
      const recurringSpy = jest.fn();
      scheduler.on('recurring-scheduled', recurringSpy);

      const sourceConfig = { id: 'test-source', type: 'static' };
      const schedule = '0 2 * * *';

      const scheduleId = await scheduler.scheduleRecurring(sourceConfig, schedule);

      expect(recurringSpy).toHaveBeenCalledWith({
        scheduleId,
        sourceId: 'test-source',
        schedule,
        nextRun: expect.any(String)
      });
    });

    test('should cancel recurring job', async () => {
      const sourceConfig = { id: 'test-source', type: 'static' };
      const schedule = '0 2 * * *';

      const scheduleId = await scheduler.scheduleRecurring(sourceConfig, schedule);
      const result = await scheduler.cancelRecurring(scheduleId);

      expect(result).toBe(true);

      const job = scheduler.scheduledJobs.get(scheduleId);
      expect(job.isActive).toBe(false);
      expect(job.cancelledAt).toBeDefined();
    });

    test('should fail to cancel non-existent recurring job', async () => {
      await expect(scheduler.cancelRecurring('non-existent'))
        .rejects.toThrow('Recurring job not found: non-existent');
    });
  });

  describe('Job Status and Management', () => {
    beforeEach(async () => {
      await scheduler.initialize();
    });

    test('should get job status', async () => {
      const mockJob = {
        id: 'test-job',
        data: { test: 'data' },
        progress: jest.fn().mockReturnValue(50),
        getState: jest.fn().mockResolvedValue('active'),
        timestamp: Date.now(),
        processedOn: Date.now(),
        finishedOn: null,
        failedReason: null,
        returnvalue: null
      };

      mockQueueManager.getJob.mockResolvedValue(mockJob);

      const status = await scheduler.getJobStatus('test-job');

      expect(status).toMatchObject({
        id: 'test-job',
        data: { test: 'data' },
        progress: 50,
        state: 'active'
      });
    });

    test('should return null for non-existent job', async () => {
      mockQueueManager.getJob.mockResolvedValue(null);

      const status = await scheduler.getJobStatus('non-existent');

      expect(status).toBeNull();
    });

    test('should get statistics', async () => {
      // Add some recurring jobs
      await scheduler.scheduleRecurring({ id: 'source1', type: 'static' }, '0 2 * * *');
      await scheduler.scheduleRecurring({ id: 'source2', type: 'static' }, '0 3 * * *');
      const scheduleId = await scheduler.scheduleRecurring({ id: 'source3', type: 'static' }, '0 4 * * *');
      await scheduler.cancelRecurring(scheduleId);

      const stats = await scheduler.getStats();

      expect(stats).toEqual({
        queue: {
          totalJobs: 10,
          completedJobs: 5,
          failedJobs: 1,
          activeJobs: 2,
          waitingJobs: 2
        },
        recurring: {
          total: 3,
          active: 2,
          inactive: 1
        }
      });
    });

    test('should retry job', async () => {
      const result = await scheduler.retryJob('test-job');

      expect(result).toBe(true);
      expect(mockQueueManager.retryJob).toHaveBeenCalledWith('test-job');
    });

    test('should remove job', async () => {
      const result = await scheduler.removeJob('test-job');

      expect(result).toBe(true);
      expect(mockQueueManager.removeJob).toHaveBeenCalledWith('test-job');
    });
  });

  describe('Queue Control', () => {
    beforeEach(async () => {
      await scheduler.initialize();
    });

    test('should pause processing', async () => {
      const pauseSpy = jest.fn();
      scheduler.on('paused', pauseSpy);

      await scheduler.pause();

      expect(mockQueueManager.pauseQueue).toHaveBeenCalled();
      expect(pauseSpy).toHaveBeenCalled();
    });

    test('should resume processing', async () => {
      const resumeSpy = jest.fn();
      scheduler.on('resumed', resumeSpy);

      await scheduler.resume();

      expect(mockQueueManager.resumeQueue).toHaveBeenCalled();
      expect(resumeSpy).toHaveBeenCalled();
    });

    test('should cleanup old jobs', async () => {
      const cleanSpy = jest.fn();
      scheduler.on('cleaned', cleanSpy);

      await scheduler.cleanup(1000);

      expect(mockQueueManager.cleanQueue).toHaveBeenCalledWith(1000);
      expect(cleanSpy).toHaveBeenCalled();
    });
  });

  describe('Priority Handling', () => {
    beforeEach(async () => {
      await scheduler.initialize();
    });

    test('should handle string priorities', async () => {
      const sourceConfig = { id: 'test-source', type: 'static' };

      await scheduler.scheduleIngestion(sourceConfig, { priority: 'high' });
      expect(mockQueueManager.addIngestionJob).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ priority: 10 })
      );

      await scheduler.scheduleIngestion(sourceConfig, { priority: 'low' });
      expect(mockQueueManager.addIngestionJob).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ priority: -10 })
      );
    });

    test('should handle numeric priorities', async () => {
      const sourceConfig = { id: 'test-source', type: 'static' };

      await scheduler.scheduleIngestion(sourceConfig, { priority: 15 });
      expect(mockQueueManager.addIngestionJob).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ priority: 15 })
      );
    });

    test('should default to normal priority for unknown strings', async () => {
      const sourceConfig = { id: 'test-source', type: 'static' };

      await scheduler.scheduleIngestion(sourceConfig, { priority: 'unknown' });
      expect(mockQueueManager.addIngestionJob).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ priority: 0 })
      );
    });
  });

  describe('Job Processing Integration', () => {
    beforeEach(async () => {
      await scheduler.initialize();
    });

    test('should process single job through processor', async () => {
      // Get the processor function passed to startProcessing
      const processorFn = mockQueueManager.startProcessing.mock.calls[0][0];

      const jobData = {
        type: 'single',
        sourceConfig: { id: 'test-source' }
      };
      const mockJob = { id: 'test-job' };

      const result = await processorFn(jobData, mockJob);

      expect(mockJobProcessor.processJob).toHaveBeenCalledWith(jobData, mockJob);
      expect(result).toEqual({ result: 'success' });
    });

    test('should process batch job through processor', async () => {
      const processorFn = mockQueueManager.startProcessing.mock.calls[0][0];

      const jobData = {
        type: 'batch',
        sources: [{ id: 'source1' }]
      };
      const mockJob = { id: 'test-job' };

      const result = await processorFn(jobData, mockJob);

      expect(mockJobProcessor.processBatch).toHaveBeenCalledWith(jobData, mockJob);
      expect(result).toEqual({ result: 'batch-success' });
    });

    test('should handle unknown job type', async () => {
      const processorFn = mockQueueManager.startProcessing.mock.calls[0][0];

      const jobData = {
        type: 'unknown'
      };
      const mockJob = { id: 'test-job' };

      await expect(processorFn(jobData, mockJob)).rejects.toThrow('Unknown job type: unknown');
    });
  });

  describe('Shutdown', () => {
    test('should shutdown successfully', async () => {
      await scheduler.initialize();

      const shutdownSpy = jest.fn();
      scheduler.on('shutdown', shutdownSpy);

      await scheduler.shutdown();

      expect(mockQueueManager.shutdown).toHaveBeenCalled();
      expect(mockJobProcessor.shutdown).toHaveBeenCalled();
      expect(scheduler.isInitialized).toBe(false);
      expect(scheduler.scheduledJobs.size).toBe(0);
      expect(shutdownSpy).toHaveBeenCalled();
    });

    test('should handle shutdown when not initialized', async () => {
      await expect(scheduler.shutdown()).resolves.toBeUndefined();
    });

    test('should handle shutdown errors', async () => {
      await scheduler.initialize();
      mockQueueManager.shutdown.mockRejectedValue(new Error('Shutdown failed'));

      await expect(scheduler.shutdown()).rejects.toThrow('Failed to shutdown JobScheduler');
    });
  });
});
