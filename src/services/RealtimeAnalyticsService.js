const EventEmitter = require('events');
const Redis = require('ioredis');
const logger = require('../utils/logger');
const AnalyticsEngine = require('../analytics/AnalyticsEngine');
const DatabaseManager = require('../database/DatabaseManager');

class RealtimeAnalyticsService extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.analyticsEngine = options.analyticsEngine || new AnalyticsEngine();
    this.dbManager = options.dbManager || new DatabaseManager();
    
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379
    });
    
    this.redisPub = this.redis.duplicate();
    
    // Service configuration
    this.config = {
      batchSize: options.batchSize || 100,
      flushInterval: options.flushInterval || 1000, // ms
      samplingRates: options.samplingRates || {
        'document.view': 1.0,
        'search.query': 1.0,
        'api.request': 0.1,
        'system.metric': 0.05
      }
    };
    
    // Stream processing state
    this.eventQueue = [];
    this.flushTimer = null;
    
    this.initialize();
  }

  async initialize() {
    try {
      // Set up event listeners
      this.setupEventListeners();
      
      // Start flush timer
      this.startFlushTimer();
      
      // Subscribe to system events
      await this.subscribeToSystemEvents();
      
      logger.info('RealtimeAnalyticsService initialized');
    } catch (error) {
      logger.error('Failed to initialize RealtimeAnalyticsService', error);
      throw error;
    }
  }

  setupEventListeners() {
    // Listen to analytics engine events
    this.analyticsEngine.on('anomaly', async (data) => {
      await this.handleAnomaly(data);
    });
    
    this.analyticsEngine.on('movingAverage', async (data) => {
      await this.broadcastMetricUpdate(data);
    });
    
    this.analyticsEngine.on('queryResult', async (data) => {
      await this.handleQueryResult(data);
    });
  }

  // Document processing tracking
  async trackDocumentProcessing(documentId, status, metadata = {}) {
    const event = {
      type: 'document.processing',
      documentId,
      status,
      metadata,
      timestamp: Date.now()
    };
    
    this.queueEvent(event);
    
    // Record metrics
    if (status === 'completed' && metadata.processingTime) {
      await this.analyticsEngine.recordMetric(
        'document.processing.time',
        metadata.processingTime,
        { status: 'success', source: metadata.source }
      );
    } else if (status === 'failed') {
      await this.analyticsEngine.recordMetric(
        'document.processing.error',
        1,
        { errorType: metadata.errorType || 'unknown' }
      );
    }
    
    // Broadcast status update
    await this.redisPub.publish('document:status', JSON.stringify({
      documentId,
      status,
      progress: metadata.progress || 100,
      metadata
    }));
  }

  // Search query analytics
  async trackSearchQuery(query, results, metadata = {}) {
    const event = {
      type: 'search.query',
      query,
      resultCount: results.length,
      metadata: {
        ...metadata,
        responseTime: metadata.responseTime || 0,
        userId: metadata.userId,
        source: metadata.source || 'api'
      },
      timestamp: Date.now()
    };
    
    this.queueEvent(event);
    
    // Record metrics
    await this.analyticsEngine.recordMetric(
      'search.query.count',
      1,
      { source: event.metadata.source }
    );
    
    await this.analyticsEngine.recordMetric(
      'search.query.latency',
      event.metadata.responseTime,
      { source: event.metadata.source }
    );
    
    await this.analyticsEngine.recordMetric(
      'search.results.count',
      results.length,
      { source: event.metadata.source }
    );
    
    // Track zero-result queries
    if (results.length === 0) {
      await this.analyticsEngine.recordMetric(
        'search.query.zero_results',
        1,
        { query: this.sanitizeQuery(query) }
      );
    }
  }

  // API request tracking
  async trackAPIRequest(endpoint, method, status, responseTime, metadata = {}) {
    const event = {
      type: 'api.request',
      endpoint,
      method,
      status,
      responseTime,
      metadata,
      timestamp: Date.now()
    };
    
    if (this.shouldSample('api.request')) {
      this.queueEvent(event);
    }
    
    // Always record metrics (not sampled)
    await this.analyticsEngine.recordMetric(
      'api.request.count',
      1,
      { endpoint, method, status: Math.floor(status / 100) + 'xx' }
    );
    
    await this.analyticsEngine.recordMetric(
      'api.request.latency',
      responseTime,
      { endpoint, method }
    );
    
    if (status >= 400) {
      await this.analyticsEngine.recordMetric(
        'api.error.count',
        1,
        { endpoint, method, status }
      );
    }
  }

  // System performance metrics
  async trackSystemMetrics(metrics) {
    const event = {
      type: 'system.metrics',
      metrics,
      timestamp: Date.now()
    };
    
    if (this.shouldSample('system.metric')) {
      this.queueEvent(event);
    }
    
    // Record individual metrics
    if (metrics.cpu) {
      await this.analyticsEngine.recordMetric(
        'system.cpu.usage',
        metrics.cpu,
        { hostname: metrics.hostname }
      );
    }
    
    if (metrics.memory) {
      await this.analyticsEngine.recordMetric(
        'system.memory.usage',
        metrics.memory,
        { hostname: metrics.hostname }
      );
    }
    
    if (metrics.diskIO) {
      await this.analyticsEngine.recordMetric(
        'system.disk.io',
        metrics.diskIO,
        { hostname: metrics.hostname, device: metrics.device }
      );
    }
    
    // Broadcast performance update
    await this.redisPub.publish('performance:metric', JSON.stringify(metrics));
  }

  // User activity tracking
  async trackUserActivity(userId, action, resource, metadata = {}) {
    const event = {
      type: 'user.activity',
      userId,
      action,
      resource,
      metadata,
      timestamp: Date.now()
    };
    
    this.queueEvent(event);
    
    // Record activity metrics
    await this.analyticsEngine.recordMetric(
      'user.activity.count',
      1,
      { action, resourceType: resource.type }
    );
    
    // Broadcast activity
    await this.redisPub.publish('activity:log', JSON.stringify({
      userId,
      action,
      resource,
      metadata
    }));
  }

  // Error tracking
  async trackError(level, message, context = {}) {
    const event = {
      type: 'system.error',
      level,
      message,
      context,
      timestamp: Date.now()
    };
    
    this.queueEvent(event);
    
    // Record error metrics
    await this.analyticsEngine.recordMetric(
      'system.error.count',
      1,
      { level, component: context.component || 'unknown' }
    );
    
    // Broadcast error
    await this.redisPub.publish('error:report', JSON.stringify({
      level,
      message,
      stack: context.stack,
      context
    }));
  }

  // Alert handling
  async handleAnomaly(anomalyData) {
    const { metric, value, tags, anomaly, timestamp } = anomalyData;
    
    // Check if alerts are configured for this metric
    const db = await this.dbManager.getConnection();
    try {
      const alertConfigs = await db.query(`
        SELECT * FROM analytics_alerts
        WHERE metric_name = $1 AND enabled = true
      `, [metric]);
      
      for (const config of alertConfigs.rows) {
        if (this.shouldTriggerAlert(config, anomaly)) {
          await this.triggerAlert(config, {
            metric,
            value,
            tags,
            anomaly,
            timestamp
          });
        }
      }
    } finally {
      db.release();
    }
  }

  shouldTriggerAlert(config, anomaly) {
    // Check if we're in cooldown period
    const lastAlertKey = `alert:cooldown:${config.id}`;
    const lastAlert = this.lastAlerts.get(lastAlertKey);
    
    if (lastAlert && Date.now() - lastAlert < config.cooldown_period * 1000) {
      return false;
    }
    
    return anomaly.severity === 'high' || 
           (anomaly.severity === 'medium' && config.severity !== 'high');
  }

  async triggerAlert(config, data) {
    const alert = {
      alertId: `alert-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: 'anomaly',
      severity: data.anomaly.severity,
      message: `Anomaly detected in ${data.metric}: ${data.value} (${data.anomaly.deviation} standard deviations from baseline)`,
      metadata: {
        metric: data.metric,
        value: data.value,
        tags: data.tags,
        anomaly: data.anomaly,
        config: {
          id: config.id,
          name: config.name
        }
      }
    };
    
    // Record alert in database
    const db = await this.dbManager.getConnection();
    try {
      await db.query(`
        INSERT INTO analytics_alert_history 
        (alert_id, triggered_at, metric_value, threshold_value, tags)
        VALUES ($1, $2, $3, $4, $5)
      `, [
        config.id,
        new Date(data.timestamp),
        data.value,
        data.anomaly.baseline.mean,
        JSON.stringify(data.tags)
      ]);
    } finally {
      db.release();
    }
    
    // Broadcast alert
    await this.redisPub.publish('alert:trigger', JSON.stringify(alert));
    
    // Update cooldown
    this.lastAlerts = this.lastAlerts || new Map();
    this.lastAlerts.set(`alert:cooldown:${config.id}`, Date.now());
  }

  // Stream processing
  queueEvent(event) {
    this.eventQueue.push(event);
    
    // Flush if queue is full
    if (this.eventQueue.length >= this.config.batchSize) {
      this.flush();
    }
  }

  startFlushTimer() {
    this.flushTimer = setInterval(() => {
      if (this.eventQueue.length > 0) {
        this.flush();
      }
    }, this.config.flushInterval);
  }

  async flush() {
    if (this.eventQueue.length === 0) return;
    
    const events = [...this.eventQueue];
    this.eventQueue = [];
    
    try {
      // Process events in batches
      await this.processEventBatch(events);
    } catch (error) {
      logger.error('Error processing event batch', error);
      // Re-queue failed events
      this.eventQueue.unshift(...events);
    }
  }

  async processEventBatch(events) {
    const db = await this.dbManager.getConnection();
    try {
      await db.query('BEGIN');
      
      // Group events by type for efficient processing
      const eventsByType = events.reduce((acc, event) => {
        if (!acc[event.type]) acc[event.type] = [];
        acc[event.type].push(event);
        return acc;
      }, {});
      
      // Process each type
      for (const [type, typeEvents] of Object.entries(eventsByType)) {
        switch (type) {
          case 'document.processing':
            await this.batchInsertDocumentEvents(db, typeEvents);
            break;
          case 'search.query':
            await this.batchInsertSearchEvents(db, typeEvents);
            break;
          case 'user.activity':
            await this.batchInsertActivityEvents(db, typeEvents);
            break;
          // Add more batch processors as needed
        }
      }
      
      await db.query('COMMIT');
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    } finally {
      db.release();
    }
  }

  async batchInsertDocumentEvents(db, events) {
    // Implementation for batch inserting document events
    // This would typically insert into an events table for audit/analytics
  }

  async batchInsertSearchEvents(db, events) {
    // Implementation for batch inserting search events
  }

  async batchInsertActivityEvents(db, events) {
    // Implementation for batch inserting activity events
  }

  // Utility methods
  shouldSample(eventType) {
    const rate = this.config.samplingRates[eventType] || 1.0;
    return Math.random() < rate;
  }

  sanitizeQuery(query) {
    // Remove sensitive information from queries
    return query.substring(0, 100).replace(/['"]/g, '');
  }

  async broadcastMetricUpdate(data) {
    await this.redisPub.publish('analytics:update', JSON.stringify(data));
  }

  async handleQueryResult(data) {
    // Route query results back to requesting user
    await this.redisPub.publish(`analytics:result:${data.userId}`, JSON.stringify(data));
  }

  async subscribeToSystemEvents() {
    // Subscribe to various system events for analytics
    const subscriber = this.redis.duplicate();
    
    // Subscribe to ingestion events
    subscriber.subscribe('ingestion:complete', 'ingestion:error');
    
    // Subscribe to search events
    subscriber.subscribe('search:executed');
    
    subscriber.on('message', async (channel, message) => {
      try {
        const data = JSON.parse(message);
        
        switch (channel) {
          case 'ingestion:complete':
            await this.trackDocumentProcessing(
              data.documentId,
              'completed',
              data.metadata
            );
            break;
          case 'ingestion:error':
            await this.trackDocumentProcessing(
              data.documentId,
              'failed',
              data.metadata
            );
            break;
          case 'search:executed':
            await this.trackSearchQuery(
              data.query,
              data.results,
              data.metadata
            );
            break;
        }
      } catch (error) {
        logger.error('Error processing system event', { channel, error });
      }
    });
  }

  // Dashboard data methods
  async getDashboardMetrics(timeRange = '1h') {
    const metrics = await this.analyticsEngine.getCurrentMetrics();
    
    // Add calculated metrics
    const db = await this.dbManager.getConnection();
    try {
      // Get document processing stats
      const docStats = await db.query(`
        SELECT 
          COUNT(*) as total,
          COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
          COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
          AVG(CASE WHEN status = 'completed' THEN processing_time END) as avg_time
        FROM documents
        WHERE created_at > NOW() - INTERVAL '${timeRange}'
      `);
      
      // Get search stats
      const searchStats = await db.query(`
        SELECT 
          COUNT(*) as total_searches,
          AVG(response_time) as avg_response_time,
          COUNT(CASE WHEN result_count = 0 THEN 1 END) as zero_results
        FROM search_logs
        WHERE created_at > NOW() - INTERVAL '${timeRange}'
      `);
      
      return {
        ...metrics,
        documents: docStats.rows[0],
        search: searchStats.rows[0]
      };
    } finally {
      db.release();
    }
  }

  // Graceful shutdown
  async shutdown() {
    logger.info('Shutting down RealtimeAnalyticsService...');
    
    // Stop flush timer
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    
    // Flush remaining events
    await this.flush();
    
    // Shutdown dependencies
    await this.analyticsEngine.shutdown();
    await this.redis.quit();
    await this.redisPub.quit();
    
    logger.info('RealtimeAnalyticsService shut down');
  }
}

module.exports = RealtimeAnalyticsService;