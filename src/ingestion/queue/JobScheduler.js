const { EventEmitter } = require('events');
const QueueManager = require('./QueueManager');
const IngestionJobProcessor = require('./IngestionJobProcessor');

/**
 * Job Scheduler for TheWell Pipeline
 * Manages scheduling, prioritization, and coordination of ingestion jobs
 */
class JobScheduler extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      priorities: {
        high: 10,
        normal: 0,
        low: -10
      },
      schedules: {
        static: '0 2 * * *',      // Daily at 2 AM
        semiStatic: '0 3 * * 1',  // Weekly on Monday at 3 AM
        dynamic: '0 */6 * * *'    // Every 6 hours
      },
      ...config
    };

    this.queueManager = new QueueManager(config.queue);
    this.jobProcessor = new IngestionJobProcessor(config.processor);
    this.isInitialized = false;
    this.scheduledJobs = new Map();
  }

  /**
   * Initialize the job scheduler
   */
  async initialize() {
    try {
      await this.queueManager.initialize();
      await this.jobProcessor.initialize();

      // Start processing jobs
      await this.queueManager.startProcessing(async (jobData, job) => {
        const jobType = jobData.type || 'single';
        
        switch (jobType) {
        case 'single':
          return await this.jobProcessor.processJob(jobData, job);
        case 'batch':
          return await this.jobProcessor.processBatch(jobData, job);
        default:
          throw new Error(`Unknown job type: ${jobType}`);
        }
      });

      // Set up event forwarding
      this._setupEventForwarding();

      this.isInitialized = true;
      this.emit('initialized');
      return true;
    } catch (error) {
      throw new Error(`Failed to initialize JobScheduler: ${error.message}`);
    }
  }

  /**
   * Schedule a single source ingestion job
   */
  async scheduleIngestion(sourceConfig, options = {}) {
    if (!this.isInitialized) {
      throw new Error('JobScheduler not initialized');
    }

    const jobData = {
      type: 'single',
      sourceConfig,
      options,
      scheduledAt: new Date().toISOString()
    };

    const jobOptions = {
      priority: this._getPriority(options.priority),
      delay: options.delay || 0,
      attempts: options.attempts || 3
    };

    try {
      const job = await this.queueManager.addIngestionJob(jobData, jobOptions);
      
      this.emit('job-scheduled', {
        jobId: job.id,
        sourceId: sourceConfig.id,
        type: 'single',
        priority: jobOptions.priority
      });

      return job.id;
    } catch (error) {
      this.emit('error', error);
      throw new Error(`Failed to schedule ingestion job: ${error.message}`);
    }
  }

  /**
   * Schedule a batch ingestion job for multiple sources
   */
  async scheduleBatch(sources, options = {}) {
    if (!this.isInitialized) {
      throw new Error('JobScheduler not initialized');
    }

    if (!Array.isArray(sources) || sources.length === 0) {
      throw new Error('Sources must be a non-empty array');
    }

    const batchId = options.batchId || `batch-${Date.now()}`;
    const jobData = {
      type: 'batch',
      batchId,
      sources,
      options,
      scheduledAt: new Date().toISOString()
    };

    const jobOptions = {
      priority: this._getPriority(options.priority),
      delay: options.delay || 0,
      attempts: options.attempts || 3
    };

    try {
      const job = await this.queueManager.addIngestionJob(jobData, jobOptions);
      
      this.emit('batch-scheduled', {
        jobId: job.id,
        batchId,
        sourcesCount: sources.length,
        priority: jobOptions.priority
      });

      return job.id;
    } catch (error) {
      this.emit('error', error);
      throw new Error(`Failed to schedule batch job: ${error.message}`);
    }
  }

  /**
   * Schedule recurring ingestion for a source
   */
  async scheduleRecurring(sourceConfig, schedule, options = {}) {
    if (!this.isInitialized) {
      throw new Error('JobScheduler not initialized');
    }

    const scheduleId = options.scheduleId || `recurring-${sourceConfig.id}-${Date.now()}`;
    
    // For now, we'll store the schedule configuration
    // In a full implementation, this would integrate with a cron scheduler
    const recurringJob = {
      scheduleId,
      sourceConfig,
      schedule,
      options,
      createdAt: new Date().toISOString(),
      lastRun: null,
      nextRun: this._calculateNextRun(schedule),
      isActive: true
    };

    this.scheduledJobs.set(scheduleId, recurringJob);
    
    this.emit('recurring-scheduled', {
      scheduleId,
      sourceId: sourceConfig.id,
      schedule,
      nextRun: recurringJob.nextRun
    });

    return scheduleId;
  }

  /**
   * Cancel a recurring job
   */
  async cancelRecurring(scheduleId) {
    if (!this.scheduledJobs.has(scheduleId)) {
      throw new Error(`Recurring job not found: ${scheduleId}`);
    }

    const job = this.scheduledJobs.get(scheduleId);
    job.isActive = false;
    job.cancelledAt = new Date().toISOString();

    this.emit('recurring-cancelled', { scheduleId });
    return true;
  }

  /**
   * Get job status
   */
  async getJobStatus(jobId) {
    if (!this.isInitialized) {
      throw new Error('JobScheduler not initialized');
    }

    const job = await this.queueManager.getJob(jobId);
    
    if (!job) {
      return null;
    }

    return {
      id: job.id,
      data: job.data,
      progress: job.progress(),
      state: await job.getState(),
      createdAt: new Date(job.timestamp).toISOString(),
      processedOn: job.processedOn ? new Date(job.processedOn).toISOString() : null,
      finishedOn: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
      failedReason: job.failedReason,
      returnvalue: job.returnvalue
    };
  }

  /**
   * Get queue statistics
   */
  async getStats() {
    if (!this.isInitialized) {
      throw new Error('JobScheduler not initialized');
    }

    const queueStats = await this.queueManager.getStats();
    const recurringJobs = Array.from(this.scheduledJobs.values());

    return {
      queue: queueStats,
      recurring: {
        total: recurringJobs.length,
        active: recurringJobs.filter(job => job.isActive).length,
        inactive: recurringJobs.filter(job => !job.isActive).length
      }
    };
  }

  /**
   * Retry a failed job
   */
  async retryJob(jobId) {
    if (!this.isInitialized) {
      throw new Error('JobScheduler not initialized');
    }

    return await this.queueManager.retryJob(jobId);
  }

  /**
   * Remove a job
   */
  async removeJob(jobId) {
    if (!this.isInitialized) {
      throw new Error('JobScheduler not initialized');
    }

    return await this.queueManager.removeJob(jobId);
  }

  /**
   * Pause job processing
   */
  async pause() {
    if (!this.isInitialized) {
      throw new Error('JobScheduler not initialized');
    }

    await this.queueManager.pauseQueue();
    this.emit('paused');
  }

  /**
   * Resume job processing
   */
  async resume() {
    if (!this.isInitialized) {
      throw new Error('JobScheduler not initialized');
    }

    await this.queueManager.resumeQueue();
    this.emit('resumed');
  }

  /**
   * Clean up old jobs
   */
  async cleanup(grace = 24 * 60 * 60 * 1000) {
    if (!this.isInitialized) {
      throw new Error('JobScheduler not initialized');
    }

    await this.queueManager.cleanQueue(grace);
    this.emit('cleaned');
  }

  /**
   * Shutdown the job scheduler
   */
  async shutdown() {
    if (!this.isInitialized) {
      return;
    }

    try {
      await this.queueManager.shutdown();
      await this.jobProcessor.shutdown();
      
      this.scheduledJobs.clear();
      this.isInitialized = false;
      
      this.emit('shutdown');
    } catch (error) {
      throw new Error(`Failed to shutdown JobScheduler: ${error.message}`);
    }
  }

  /**
   * Get priority value from string
   */
  _getPriority(priority) {
    if (typeof priority === 'number') {
      return priority;
    }
    
    return this.config.priorities[priority] || this.config.priorities.normal;
  }

  /**
   * Calculate next run time for a schedule
   * This is a simplified implementation - in production, use a proper cron parser
   */
  _calculateNextRun(_schedule) {
    // For now, return a time 1 hour from now
    // In a real implementation, parse the cron expression
    const nextRun = new Date();
    nextRun.setHours(nextRun.getHours() + 1);
    return nextRun.toISOString();
  }

  /**
   * Set up event forwarding from queue manager
   */
  _setupEventForwarding() {
    this.queueManager.on('job-added', (data) => this.emit('job-added', data));
    this.queueManager.on('job-started', (data) => this.emit('job-started', data));
    this.queueManager.on('job-completed', (data) => this.emit('job-completed', data));
    this.queueManager.on('job-failed', (data) => this.emit('job-failed', data));
    this.queueManager.on('job-progress', (data) => this.emit('job-progress', data));
    this.queueManager.on('job-stalled', (data) => this.emit('job-stalled', data));
    this.queueManager.on('job-removed', (data) => this.emit('job-removed', data));
    this.queueManager.on('job-retried', (data) => this.emit('job-retried', data));
    this.queueManager.on('queue-paused', () => this.emit('queue-paused'));
    this.queueManager.on('queue-resumed', () => this.emit('queue-resumed'));
    this.queueManager.on('queue-cleaned', () => this.emit('queue-cleaned'));
    this.queueManager.on('error', (error) => this.emit('error', error));
  }
}

module.exports = JobScheduler;
