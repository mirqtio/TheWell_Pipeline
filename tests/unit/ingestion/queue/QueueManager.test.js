const QueueManager = require('../../../../src/ingestion/queue/QueueManager');

// Mock Bull and Redis
jest.mock('bull');
jest.mock('redis');

const Bull = require('bull');
const Redis = require('redis');

describe('QueueManager', () => {
  let queueManager;
  let mockQueue;
  let mockRedisClient;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Mock Redis client
    mockRedisClient = {
      connect: jest.fn().mockResolvedValue(undefined),
      quit: jest.fn().mockResolvedValue(undefined)
    };
    Redis.createClient = jest.fn().mockReturnValue(mockRedisClient);

    // Mock Bull queue
    mockQueue = {
      add: jest.fn().mockResolvedValue({ id: 'test-job-1' }),
      process: jest.fn(),
      getWaiting: jest.fn().mockResolvedValue([]),
      getActive: jest.fn().mockResolvedValue([]),
      getCompleted: jest.fn().mockResolvedValue([]),
      getFailed: jest.fn().mockResolvedValue([]),
      getJob: jest.fn(),
      pause: jest.fn().mockResolvedValue(undefined),
      resume: jest.fn().mockResolvedValue(undefined),
      clean: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
      on: jest.fn()
    };
    Bull.mockReturnValue(mockQueue);

    queueManager = new QueueManager({
      redis: {
        host: 'localhost',
        port: 6379
      }
    });
  });

  afterEach(async () => {
    if (queueManager.isInitialized) {
      await queueManager.shutdown();
    }
  });

  describe('Initialization', () => {
    test('should initialize successfully', async () => {
      const result = await queueManager.initialize();

      expect(result).toBe(true);
      expect(queueManager.isInitialized).toBe(true);
      expect(Redis.createClient).toHaveBeenCalledWith({
        socket: {
          host: 'localhost',
          port: 6379
        }
      });
      expect(mockRedisClient.connect).toHaveBeenCalled();
      expect(Bull).toHaveBeenCalledWith('ingestion-queue', expect.objectContaining({
        redis: expect.objectContaining({
          socket: {
            host: 'localhost',
            port: 6379
          }
        }),
        defaultJobOptions: expect.any(Object)
      }));
    });

    test('should emit initialized event', async () => {
      const initSpy = jest.fn();
      queueManager.on('initialized', initSpy);

      await queueManager.initialize();

      expect(initSpy).toHaveBeenCalled();
    });

    test('should handle initialization errors', async () => {
      mockRedisClient.connect.mockRejectedValue(new Error('Redis connection failed'));

      await expect(queueManager.initialize()).rejects.toThrow('Failed to initialize QueueManager');
    });
  });

  describe('Job Management', () => {
    beforeEach(async () => {
      await queueManager.initialize();
    });

    test('should add ingestion job successfully', async () => {
      const jobData = {
        sourceConfig: {
          id: 'test-source',
          type: 'static'
        }
      };

      const job = await queueManager.addIngestionJob(jobData);

      expect(mockQueue.add).toHaveBeenCalledWith(
        'process-ingestion',
        jobData,
        expect.objectContaining({
          priority: 0,
          delay: 0
        })
      );
      expect(job.id).toBe('test-job-1');
      expect(queueManager.stats.totalJobs).toBe(1);
      expect(queueManager.stats.waitingJobs).toBe(1);
    });

    test('should add job with custom options', async () => {
      const jobData = { test: 'data' };
      const options = {
        priority: 10,
        delay: 5000,
        attempts: 5
      };

      await queueManager.addIngestionJob(jobData, options);

      expect(mockQueue.add).toHaveBeenCalledWith(
        'process-ingestion',
        jobData,
        expect.objectContaining(options)
      );
    });

    test('should emit job-added event', async () => {
      const jobAddedSpy = jest.fn();
      queueManager.on('job-added', jobAddedSpy);

      const jobData = { test: 'data' };
      await queueManager.addIngestionJob(jobData);

      expect(jobAddedSpy).toHaveBeenCalledWith({
        jobId: 'test-job-1',
        type: 'ingestion',
        data: jobData
      });
    });

    test('should fail to add job when not initialized', async () => {
      const uninitializedManager = new QueueManager();

      await expect(uninitializedManager.addIngestionJob({}))
        .rejects.toThrow('QueueManager not initialized');
    });
  });

  describe('Job Processing', () => {
    beforeEach(async () => {
      await queueManager.initialize();
    });

    test('should start processing with processor function', async () => {
      const processor = jest.fn().mockResolvedValue('result');

      await queueManager.startProcessing(processor);

      expect(mockQueue.process).toHaveBeenCalledWith(
        'process-ingestion',
        5, // default concurrency
        expect.any(Function)
      );
    });

    test('should emit processing-started event', async () => {
      const processingSpy = jest.fn();
      queueManager.on('processing-started', processingSpy);

      const processor = jest.fn();
      await queueManager.startProcessing(processor);

      expect(processingSpy).toHaveBeenCalled();
    });

    test('should handle job processing with processor wrapper', async () => {
      const processor = jest.fn().mockResolvedValue('test-result');
      let processorWrapper;

      mockQueue.process.mockImplementation((name, concurrency, wrapper) => {
        processorWrapper = wrapper;
      });

      await queueManager.startProcessing(processor);

      // Simulate job processing
      const mockJob = {
        id: 'test-job',
        data: { test: 'data' }
      };

      const result = await processorWrapper(mockJob);

      expect(processor).toHaveBeenCalledWith({ test: 'data' }, mockJob);
      expect(result).toBe('test-result');
      expect(queueManager.stats.completedJobs).toBe(1);
    });

    test('should handle job processing errors', async () => {
      const processor = jest.fn().mockRejectedValue(new Error('Processing failed'));
      let processorWrapper;

      mockQueue.process.mockImplementation((name, concurrency, wrapper) => {
        processorWrapper = wrapper;
      });

      await queueManager.startProcessing(processor);

      const mockJob = {
        id: 'test-job',
        data: { test: 'data' }
      };

      await expect(processorWrapper(mockJob)).rejects.toThrow('Processing failed');
      expect(queueManager.stats.failedJobs).toBe(1);
    });
  });

  describe('Statistics', () => {
    beforeEach(async () => {
      await queueManager.initialize();
    });

    test('should return queue statistics', async () => {
      mockQueue.getWaiting.mockResolvedValue([1, 2]);
      mockQueue.getActive.mockResolvedValue([3]);
      mockQueue.getCompleted.mockResolvedValue([4, 5, 6]);
      mockQueue.getFailed.mockResolvedValue([7]);

      const stats = await queueManager.getStats();

      expect(stats).toEqual({
        totalJobs: 0,
        completedJobs: 3,
        failedJobs: 1,
        activeJobs: 1,
        waitingJobs: 2
      });
    });

    test('should return basic stats when not initialized', async () => {
      const uninitializedManager = new QueueManager();
      const stats = await uninitializedManager.getStats();

      expect(stats).toEqual({
        totalJobs: 0,
        completedJobs: 0,
        failedJobs: 0,
        activeJobs: 0,
        waitingJobs: 0
      });
    });
  });

  describe('Job Operations', () => {
    beforeEach(async () => {
      await queueManager.initialize();
    });

    test('should get job by ID', async () => {
      const mockJob = { id: 'test-job', data: {} };
      mockQueue.getJob.mockResolvedValue(mockJob);

      const job = await queueManager.getJob('test-job');

      expect(mockQueue.getJob).toHaveBeenCalledWith('test-job');
      expect(job).toBe(mockJob);
    });

    test('should remove job by ID', async () => {
      const mockJob = {
        id: 'test-job',
        remove: jest.fn().mockResolvedValue(undefined)
      };
      mockQueue.getJob.mockResolvedValue(mockJob);

      const result = await queueManager.removeJob('test-job');

      expect(mockJob.remove).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    test('should return false when removing non-existent job', async () => {
      mockQueue.getJob.mockResolvedValue(null);

      const result = await queueManager.removeJob('non-existent');

      expect(result).toBe(false);
    });

    test('should retry job by ID', async () => {
      const mockJob = {
        id: 'test-job',
        retry: jest.fn().mockResolvedValue(undefined)
      };
      mockQueue.getJob.mockResolvedValue(mockJob);

      const result = await queueManager.retryJob('test-job');

      expect(mockJob.retry).toHaveBeenCalled();
      expect(result).toBe(true);
    });
  });

  describe('Queue Control', () => {
    beforeEach(async () => {
      await queueManager.initialize();
    });

    test('should pause queue', async () => {
      const pauseSpy = jest.fn();
      queueManager.on('queue-paused', pauseSpy);

      await queueManager.pauseQueue();

      expect(mockQueue.pause).toHaveBeenCalled();
      expect(pauseSpy).toHaveBeenCalled();
    });

    test('should resume queue', async () => {
      const resumeSpy = jest.fn();
      queueManager.on('queue-resumed', resumeSpy);

      await queueManager.resumeQueue();

      expect(mockQueue.resume).toHaveBeenCalled();
      expect(resumeSpy).toHaveBeenCalled();
    });

    test('should clean queue', async () => {
      const cleanSpy = jest.fn();
      queueManager.on('queue-cleaned', cleanSpy);

      await queueManager.cleanQueue(1000);

      expect(mockQueue.clean).toHaveBeenCalledWith(1000, 'completed');
      expect(mockQueue.clean).toHaveBeenCalledWith(1000, 'failed');
      expect(cleanSpy).toHaveBeenCalled();
    });
  });

  describe('Shutdown', () => {
    test('should shutdown successfully', async () => {
      await queueManager.initialize();
      
      const shutdownSpy = jest.fn();
      queueManager.on('shutdown', shutdownSpy);

      await queueManager.shutdown();

      expect(mockQueue.close).toHaveBeenCalled();
      expect(mockRedisClient.quit).toHaveBeenCalled();
      expect(queueManager.isInitialized).toBe(false);
      expect(shutdownSpy).toHaveBeenCalled();
    });

    test('should handle shutdown when not initialized', async () => {
      await expect(queueManager.shutdown()).resolves.toBeUndefined();
    });

    test('should handle shutdown errors', async () => {
      await queueManager.initialize();
      mockQueue.close.mockRejectedValue(new Error('Close failed'));

      await expect(queueManager.shutdown()).rejects.toThrow('Failed to shutdown QueueManager');
      
      // Reset the mock so afterEach doesn't fail
      mockQueue.close.mockResolvedValue();
      queueManager.isInitialized = false; // Prevent afterEach from calling shutdown again
    });
  });

  describe('Event Handling', () => {
    beforeEach(async () => {
      await queueManager.initialize();
    });

    test('should set up queue event listeners', () => {
      expect(mockQueue.on).toHaveBeenCalledWith('completed', expect.any(Function));
      expect(mockQueue.on).toHaveBeenCalledWith('failed', expect.any(Function));
      expect(mockQueue.on).toHaveBeenCalledWith('stalled', expect.any(Function));
      expect(mockQueue.on).toHaveBeenCalledWith('progress', expect.any(Function));
      expect(mockQueue.on).toHaveBeenCalledWith('error', expect.any(Function));
    });

    test('should emit job events from queue events', () => {
      const completedSpy = jest.fn();
      const failedSpy = jest.fn();
      
      queueManager.on('job-completed', completedSpy);
      queueManager.on('job-failed', failedSpy);

      // Get the event handlers that were registered
      const completedHandler = mockQueue.on.mock.calls.find(call => call[0] === 'completed')[1];
      const failedHandler = mockQueue.on.mock.calls.find(call => call[0] === 'failed')[1];

      // Simulate queue events
      completedHandler({ id: 'job-1' }, 'result');
      failedHandler({ id: 'job-2' }, new Error('Failed'));

      expect(completedSpy).toHaveBeenCalledWith({
        jobId: 'job-1',
        result: 'result'
      });
      expect(failedSpy).toHaveBeenCalledWith({
        jobId: 'job-2',
        error: 'Failed'
      });
    });
  });
});
