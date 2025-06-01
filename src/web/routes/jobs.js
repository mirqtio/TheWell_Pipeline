/**
 * Jobs Routes
 * API endpoints for managing ingestion jobs
 */

const express = require('express');
const { asyncHandler, ValidationError, NotFoundError } = require('../middleware/errorHandler');
const { requirePermission } = require('../middleware/auth');
const logger = require('../../utils/logger');

module.exports = (dependencies = {}) => {
  const router = express.Router();
  const { queueManager } = dependencies;

  if (!queueManager) {
    throw new Error('QueueManager is required for job routes');
  }

  /**
   * Get all jobs with filtering and pagination
   */
  router.get('/', requirePermission('read'), asyncHandler(async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const status = req.query.status || 'all';
    const queue = req.query.queue || 'all';
    const search = req.query.search || '';

    logger.info('Fetching jobs', {
      page,
      limit,
      status,
      queue,
      search,
      userId: req.user.id
    });

    // Get available queues
    const queueNames = queueManager.getQueueNames();
    let targetQueues = queue === 'all' ? queueNames : [queue];

    // Validate queue names
    targetQueues = targetQueues.filter(name => queueNames.includes(name));

    const allJobs = [];

    // Get jobs from each queue
    for (const queueName of targetQueues) {
      let jobStates = ['waiting', 'active', 'completed', 'failed', 'delayed'];
      
      if (status !== 'all') {
        jobStates = [status];
      }

      for (const state of jobStates) {
        try {
          const jobs = await queueManager.getJobs(queueName, [state], 0, -1);
          
          jobs.forEach(job => {
            allJobs.push({
              id: job.id,
              queue: queueName,
              name: job.name || 'Unknown',
              data: job.data,
              status: state,
              progress: job.progress || 0,
              attempts: job.attemptsMade || 0,
              maxAttempts: job.opts?.attempts || 1,
              priority: job.opts?.priority || 0,
              delay: job.opts?.delay || 0,
              createdAt: job.timestamp,
              processedOn: job.processedOn,
              finishedOn: job.finishedOn,
              failedReason: job.failedReason,
              returnValue: job.returnvalue
            });
          });
        } catch (error) {
          logger.warn(`Failed to get jobs from queue ${queueName}`, { error: error.message });
        }
      }
    }

    // Apply search filter
    let filteredJobs = allJobs;
    if (search) {
      const searchLower = search.toLowerCase();
      filteredJobs = allJobs.filter(job => 
        job.name.toLowerCase().includes(searchLower) ||
        job.id.toString().includes(searchLower) ||
        JSON.stringify(job.data).toLowerCase().includes(searchLower)
      );
    }

    // Sort by creation time (newest first)
    filteredJobs.sort((a, b) => b.createdAt - a.createdAt);

    // Paginate
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedJobs = filteredJobs.slice(startIndex, endIndex);

    res.json({
      jobs: paginatedJobs,
      pagination: {
        page,
        limit,
        total: filteredJobs.length,
        pages: Math.ceil(filteredJobs.length / limit),
        hasNext: endIndex < filteredJobs.length,
        hasPrev: page > 1
      },
      filters: {
        status: {
          current: status,
          available: ['all', 'waiting', 'active', 'completed', 'failed', 'delayed']
        },
        queue: {
          current: queue,
          available: ['all', ...queueNames]
        }
      }
    });
  }));

  /**
   * Get overview statistics
   */
  router.get('/stats/overview', requirePermission('read'), asyncHandler(async (req, res) => {
    logger.info('Fetching job overview statistics', {
      userId: req.user.id
    });

    const queueNames = queueManager.getQueueNames();
    let totalStats = {
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0,
      delayed: 0
    };

    for (const queueName of queueNames) {
      try {
        const stats = await queueManager.getQueueStats(queueName);
        totalStats.waiting += stats.waiting || 0;
        totalStats.active += stats.active || 0;
        totalStats.completed += stats.completed || 0;
        totalStats.failed += stats.failed || 0;
        totalStats.delayed += stats.delayed || 0;
      } catch (error) {
        logger.warn(`Failed to get stats for queue ${queueName}`, { error: error.message });
      }
    }

    res.json({
      stats: totalStats,
      timestamp: new Date().toISOString()
    });
  }));

  /**
   * Get queue statistics
   */
  router.get('/stats/queues', requirePermission('read'), asyncHandler(async (req, res) => {
    logger.info('Fetching queue statistics', {
      userId: req.user.id
    });

    const queueNames = queueManager.getQueueNames();
    const queueStats = {};

    for (const queueName of queueNames) {
      try {
        const stats = await queueManager.getQueueStats(queueName);
        queueStats[queueName] = {
          name: queueName,
          waiting: stats.waiting || 0,
          active: stats.active || 0,
          completed: stats.completed || 0,
          failed: stats.failed || 0,
          delayed: stats.delayed || 0,
          paused: stats.paused || false
        };
      } catch (error) {
        logger.warn(`Failed to get stats for queue ${queueName}`, { error: error.message });
        queueStats[queueName] = {
          name: queueName,
          error: error.message
        };
      }
    }

    res.json({
      queues: queueStats,
      timestamp: new Date().toISOString()
    });
  }));

  /**
   * Get specific job details
   */
  router.get('/:queue/:id', requirePermission('read'), asyncHandler(async (req, res) => {
    const { queue: queueName, id: jobId } = req.params;

    logger.info('Fetching job details', {
      queueName,
      jobId,
      userId: req.user.id
    });

    const job = await queueManager.getJob(queueName, jobId);
    
    if (!job) {
      throw new NotFoundError(`Job ${jobId} not found in queue ${queueName}`);
    }

    // Get job logs if available
    let logs = [];
    try {
      logs = await job.getState() === 'failed' ? [job.failedReason] : [];
    } catch (error) {
      logger.warn('Failed to get job logs', { error: error.message });
    }

    const jobDetails = {
      id: job.id,
      queue: queueName,
      name: job.name || 'Unknown',
      data: job.data,
      opts: job.opts,
      progress: job.progress || 0,
      attempts: job.attemptsMade || 0,
      maxAttempts: job.opts?.attempts || 1,
      priority: job.opts?.priority || 0,
      delay: job.opts?.delay || 0,
      createdAt: job.timestamp,
      processedOn: job.processedOn,
      finishedOn: job.finishedOn,
      failedReason: job.failedReason,
      returnValue: job.returnvalue,
      logs,
      status: await job.getState()
    };

    res.json({ job: jobDetails });
  }));

  /**
   * Retry failed job
   */
  router.post('/:queue/:id/retry', requirePermission('write'), asyncHandler(async (req, res) => {
    const { queue: queueName, id: jobId } = req.params;

    logger.info('Retrying job', {
      queueName,
      jobId,
      userId: req.user.id
    });

    const job = await queueManager.getJob(queueName, jobId);
    
    if (!job) {
      throw new NotFoundError(`Job ${jobId} not found in queue ${queueName}`);
    }

    const jobState = await job.getState();
    if (jobState !== 'failed') {
      throw new ValidationError(`Job ${jobId} is not in failed state (current: ${jobState})`);
    }

    // Retry the job
    await job.retry();

    logger.info('Job retried successfully', {
      queueName,
      jobId,
      userId: req.user.id
    });

    res.json({
      success: true,
      message: 'Job retried successfully',
      jobId,
      queue: queueName,
      timestamp: new Date().toISOString()
    });
  }));

  /**
   * Remove job
   */
  router.delete('/:queue/:id', requirePermission('write'), asyncHandler(async (req, res) => {
    const { queue: queueName, id: jobId } = req.params;
    const { force = false } = req.query;

    logger.info('Removing job', {
      queueName,
      jobId,
      force,
      userId: req.user.id
    });

    const job = await queueManager.getJob(queueName, jobId);
    
    if (!job) {
      throw new NotFoundError(`Job ${jobId} not found in queue ${queueName}`);
    }

    const jobState = await job.getState();
    
    // Check if job can be safely removed
    if (!force && (jobState === 'active' || jobState === 'waiting')) {
      throw new ValidationError(`Cannot remove ${jobState} job without force=true`);
    }

    // Remove the job
    await job.remove();

    logger.info('Job removed successfully', {
      queueName,
      jobId,
      force,
      userId: req.user.id
    });

    res.json({
      success: true,
      message: 'Job removed successfully',
      jobId,
      queue: queueName,
      timestamp: new Date().toISOString()
    });
  }));

  /**
   * Update job priority
   */
  router.patch('/:queue/:id/priority', requirePermission('write'), asyncHandler(async (req, res) => {
    const { queue: queueName, id: jobId } = req.params;
    const { priority } = req.body;

    if (typeof priority !== 'number') {
      throw new ValidationError('Priority must be a number');
    }

    logger.info('Updating job priority', {
      queueName,
      jobId,
      priority,
      userId: req.user.id
    });

    const job = await queueManager.getJob(queueName, jobId);
    
    if (!job) {
      throw new NotFoundError(`Job ${jobId} not found in queue ${queueName}`);
    }

    // Update job priority
    await job.changePriority(priority);

    res.json({
      success: true,
      message: 'Job priority updated successfully',
      jobId,
      queue: queueName,
      priority,
      timestamp: new Date().toISOString()
    });
  }));

  /**
   * Pause/Resume queue
   */
  router.post('/queues/:queue/pause', requirePermission('write'), asyncHandler(async (req, res) => {
    const { queue: queueName } = req.params;

    logger.info('Pausing queue', {
      queueName,
      userId: req.user.id
    });

    await queueManager.pauseQueue(queueName);

    res.json({
      success: true,
      message: `Queue ${queueName} paused successfully`,
      queue: queueName,
      timestamp: new Date().toISOString()
    });
  }));

  router.post('/queues/:queue/resume', requirePermission('write'), asyncHandler(async (req, res) => {
    const { queue: queueName } = req.params;

    logger.info('Resuming queue', {
      queueName,
      userId: req.user.id
    });

    await queueManager.resumeQueue(queueName);

    res.json({
      success: true,
      message: `Queue ${queueName} resumed successfully`,
      queue: queueName,
      timestamp: new Date().toISOString()
    });
  }));

  /**
   * Clean queue (remove old jobs)
   */
  router.post('/queues/:queue/clean', requirePermission('write'), asyncHandler(async (req, res) => {
    const { queue: queueName } = req.params;
    const { 
      grace = 24 * 60 * 60 * 1000, // 24 hours in milliseconds
      status = 'completed',
      limit = 100 
    } = req.body;

    logger.info('Cleaning queue', {
      queueName,
      grace,
      status,
      limit,
      userId: req.user.id
    });

    const cleaned = await queueManager.cleanQueue(queueName, grace, status, limit);

    res.json({
      success: true,
      message: `Queue ${queueName} cleaned successfully`,
      queue: queueName,
      cleaned,
      timestamp: new Date().toISOString()
    });
  }));

  return router;
};
