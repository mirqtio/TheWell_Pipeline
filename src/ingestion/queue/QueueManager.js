const Queue = require('bull');
const Redis = require('redis');
const { EventEmitter } = require('events');
const logger = require('../../utils/logger'); // Assuming logger is defined in a separate file

/**
 * Queue Manager for TheWell Pipeline Ingestion System
 * Manages job queues, processing, retries, and monitoring
 */
class QueueManager extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      redis: {
        host: config.redis?.host || process.env.REDIS_HOST || 'localhost',
        port: config.redis?.port || process.env.REDIS_PORT || 6379,
        password: config.redis?.password || process.env.REDIS_PASSWORD,
        db: config.redis?.db || 0
      },
      queues: {
        ingestion: {
          name: 'ingestion-queue',
          concurrency: config.concurrency || 5,
          attempts: config.attempts || 3,
          backoff: {
            type: 'exponential',
            delay: 2000
          }
        }
      },
      ...config
    };

    this.queues = new Map();
    this.redisClient = null;
    this.isInitialized = false;
    this.stats = {
      totalJobs: 0,
      completedJobs: 0,
      failedJobs: 0,
      activeJobs: 0,
      waitingJobs: 0
    };
  }

  /**
   * Initialize the queue manager and create queues
   */
  async initialize(config = {}) {
    try {
      // Merge provided config with defaults
      const finalConfig = {
        redis: {
          host: config.redis?.host || this.config.redis.host,
          port: config.redis?.port || this.config.redis.port,
          password: config.redis?.password || this.config.redis.password,
          db: config.redis?.db !== undefined ? config.redis.db : this.config.redis.db
        },
        queues: {
          ingestion: {
            name: config.queues?.ingestion?.name || this.config.queues.ingestion.name,
            attempts: config.queues?.ingestion?.attempts || this.config.queues.ingestion.attempts,
            backoff: config.queues?.ingestion?.backoff || this.config.queues.ingestion.backoff
          }
        }
      };

      // Create Redis client for monitoring
      const redisConfig = {
        socket: {
          host: finalConfig.redis.host,
          port: finalConfig.redis.port
        }
      };

      if (finalConfig.redis.password) {
        redisConfig.password = finalConfig.redis.password;
      }

      if (finalConfig.redis.db !== undefined) {
        redisConfig.database = finalConfig.redis.db;
      }

      this.redisClient = Redis.createClient(redisConfig);
      
      // Connect to Redis
      await this.redisClient.connect();

      // Create ingestion queue
      const ingestionQueue = new Queue(
        finalConfig.queues.ingestion.name,
        {
          redis: redisConfig,
          defaultJobOptions: {
            attempts: finalConfig.queues.ingestion.attempts,
            backoff: finalConfig.queues.ingestion.backoff,
            removeOnComplete: 100, // Keep last 100 completed jobs
            removeOnFail: 50 // Keep last 50 failed jobs
          }
        }
      );

      // Set up event listeners
      this._setupQueueEventListeners(ingestionQueue);

      this.queues.set('ingestion', ingestionQueue);
      this.isInitialized = true;
      this.emit('initialized');
      return true;
    } catch (error) {
      throw new Error(`Failed to initialize QueueManager: ${error.message}`);
    }
  }

  /**
   * Add a job to the ingestion queue
   */
  async addIngestionJob(jobData, options = {}) {
    if (!this.isInitialized) {
      throw new Error('QueueManager not initialized');
    }

    const queue = this.queues.get('ingestion');
    const jobOptions = {
      priority: options.priority || 0,
      delay: options.delay || 0,
      ...options
    };

    try {
      const job = await queue.add('process-ingestion', jobData, jobOptions);
      this.stats.totalJobs++;
      this.stats.waitingJobs++;
      
      this.emit('job-added', {
        jobId: job.id,
        type: 'ingestion',
        data: jobData
      });

      return job;
    } catch (error) {
      this.emit('error', error);
      throw new Error(`Failed to add ingestion job: ${error.message}`);
    }
  }

  /**
   * Process ingestion jobs
   */
  async startProcessing(processor) {
    if (!this.isInitialized) {
      throw new Error('QueueManager not initialized');
    }

    const queue = this.queues.get('ingestion');
    const concurrency = this.config.queues.ingestion.concurrency;

    queue.process('process-ingestion', concurrency, async (job) => {
      try {
        this.stats.activeJobs++;
        this.stats.waitingJobs--;

        this.emit('job-started', {
          jobId: job.id,
          data: job.data
        });

        const result = await processor(job.data, job);
        
        this.stats.activeJobs--;
        this.stats.completedJobs++;

        this.emit('job-completed', {
          jobId: job.id,
          result
        });

        return result;
      } catch (error) {
        this.stats.activeJobs--;
        this.stats.failedJobs++;

        this.emit('job-failed', {
          jobId: job.id,
          error: error.message
        });

        throw error;
      }
    });

    this.emit('processing-started');
  }

  /**
   * Get queue statistics
   */
  async getStats() {
    if (!this.isInitialized) {
      return this.stats;
    }

    try {
      const queue = this.queues.get('ingestion');
      const waiting = await queue.getWaiting();
      const active = await queue.getActive();
      const completed = await queue.getCompleted();
      const failed = await queue.getFailed();

      return {
        ...this.stats,
        waitingJobs: waiting.length,
        activeJobs: active.length,
        completedJobs: completed.length,
        failedJobs: failed.length,
        totalJobs: this.stats.totalJobs
      };
    } catch (error) {
      this.emit('error', error);
      return this.stats;
    }
  }

  /**
   * Get job by ID
   */
  async getJob(jobId) {
    if (!this.isInitialized) {
      throw new Error('QueueManager not initialized');
    }

    const queue = this.queues.get('ingestion');
    return await queue.getJob(jobId);
  }

  /**
   * Remove job by ID
   */
  async removeJob(jobId) {
    if (!this.isInitialized) {
      throw new Error('QueueManager not initialized');
    }

    const queue = this.queues.get('ingestion');
    const job = await queue.getJob(jobId);
    
    if (job) {
      await job.remove();
      this.emit('job-removed', { jobId });
      return true;
    }
    
    return false;
  }

  /**
   * Retry failed job
   */
  async retryJob(jobId) {
    if (!this.isInitialized) {
      throw new Error('QueueManager not initialized');
    }

    const queue = this.queues.get('ingestion');
    const job = await queue.getJob(jobId);
    
    if (job) {
      await job.retry();
      this.emit('job-retried', { jobId });
      return true;
    }
    
    return false;
  }

  /**
   * Pause queue processing
   */
  async pauseQueue() {
    if (!this.isInitialized) {
      throw new Error('QueueManager not initialized');
    }

    const queue = this.queues.get('ingestion');
    await queue.pause();
    this.emit('queue-paused');
  }

  /**
   * Resume queue processing
   */
  async resumeQueue() {
    if (!this.isInitialized) {
      throw new Error('QueueManager not initialized');
    }

    const queue = this.queues.get('ingestion');
    await queue.resume();
    this.emit('queue-resumed');
  }

  /**
   * Clean up completed and failed jobs
   */
  async cleanQueue(grace = 24 * 60 * 60 * 1000) { // 24 hours default
    if (!this.isInitialized) {
      throw new Error('QueueManager not initialized');
    }

    const queue = this.queues.get('ingestion');
    
    // Clean completed jobs older than grace period
    await queue.clean(grace, 'completed');
    
    // Clean failed jobs older than grace period
    await queue.clean(grace, 'failed');
    
    this.emit('queue-cleaned');
  }

  /**
   * Shutdown the queue manager
   */
  async shutdown() {
    if (!this.isInitialized) {
      return;
    }

    try {
      // Close all queues
      for (const [name, queue] of this.queues) {
        await queue.close();
      }

      // Close Redis client
      if (this.redisClient) {
        await this.redisClient.quit();
      }

      this.queues.clear();
      this.isInitialized = false;
      
      this.emit('shutdown');
    } catch (error) {
      throw new Error(`Failed to shutdown QueueManager: ${error.message}`);
    }
  }

  /**
   * Update queue configuration dynamically
   */
  async updateConfig(newConfig) {
    logger.info('Updating queue configuration', { newConfig });
    
    try {
      const previousConfig = { ...this.config };
      
      // Merge new configuration with existing
      this.config = {
        ...this.config,
        ...newConfig,
        redis: {
          ...this.config.redis,
          ...newConfig.redis
        },
        queues: {
          ...this.config.queues,
          ...newConfig.queues
        }
      };
      
      // Check if Redis configuration changed
      const redisChanged = 
        previousConfig.redis.host !== this.config.redis.host ||
        previousConfig.redis.port !== this.config.redis.port ||
        previousConfig.redis.db !== this.config.redis.db;
      
      if (redisChanged && this.isInitialized) {
        logger.info('Redis configuration changed, reconnecting...');
        await this.shutdown();
        await this.initialize();
      } else if (this.isInitialized) {
        // Update existing queues with new configuration
        for (const [queueName, queue] of this.queues) {
          if (this.config.queues[queueName]) {
            // Update queue settings that can be changed at runtime
            const queueConfig = this.config.queues[queueName];
            if (queueConfig.concurrency !== undefined) {
              queue.concurrency = queueConfig.concurrency;
            }
          }
        }
      }
      
      this.emit('configUpdated', {
        previousConfig,
        newConfig: this.config
      });
      
      logger.info('Queue configuration updated successfully');
      
    } catch (error) {
      logger.error('Failed to update queue configuration', { error: error.message });
      throw error;
    }
  }

  /**
   * Set up event listeners for queue monitoring
   */
  _setupQueueEventListeners(queue) {
    queue.on('completed', (job, result) => {
      this.emit('job-completed', {
        jobId: job.id,
        result
      });
    });

    queue.on('failed', (job, error) => {
      this.emit('job-failed', {
        jobId: job.id,
        error: error.message
      });
    });

    queue.on('stalled', (job) => {
      this.emit('job-stalled', {
        jobId: job.id
      });
    });

    queue.on('progress', (job, progress) => {
      this.emit('job-progress', {
        jobId: job.id,
        progress
      });
    });

    queue.on('error', (error) => {
      this.emit('error', error);
    });
  }
}

module.exports = QueueManager;
