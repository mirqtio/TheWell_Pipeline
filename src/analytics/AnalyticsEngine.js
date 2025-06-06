const EventEmitter = require('events');
const Redis = require('ioredis');
const { Pool } = require('pg');
const logger = require('../utils/logger');

class AnalyticsEngine extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379
    });

    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000
    });

    // Configuration
    this.config = {
      windowSizes: options.windowSizes || [60, 300, 900, 3600], // 1m, 5m, 15m, 1h
      aggregationInterval: options.aggregationInterval || 5000, // 5 seconds
      anomalyThreshold: options.anomalyThreshold || 3, // Standard deviations
      retentionPeriods: options.retentionPeriods || {
        raw: 3600, // 1 hour
        minutely: 86400, // 1 day
        hourly: 604800, // 1 week
        daily: 2592000 // 30 days
      }
    };

    // In-memory buffers for high-frequency data
    this.metricBuffers = new Map();
    this.aggregationTimers = new Map();
    
    // Moving average calculators
    this.movingAverages = new Map();
    
    // Anomaly detection state
    this.baselineStats = new Map();
    
    this.initialize();
  }

  async initialize() {
    try {
      // Start aggregation workers
      this.startAggregationWorkers();
      
      // Load baseline statistics
      await this.loadBaselineStats();
      
      // Setup Redis subscriptions
      await this.setupRedisSubscriptions();
      
      logger.info('Analytics Engine initialized');
    } catch (error) {
      logger.error('Failed to initialize Analytics Engine', error);
      throw error;
    }
  }

  // Core metric recording
  async recordMetric(metric, value, tags = {}, timestamp = Date.now()) {
    try {
      // Buffer high-frequency metrics
      const metricKey = this.getMetricKey(metric, tags);
      
      if (!this.metricBuffers.has(metricKey)) {
        this.metricBuffers.set(metricKey, []);
      }
      
      this.metricBuffers.get(metricKey).push({
        value,
        timestamp,
        tags
      });

      // Check for anomalies
      const anomaly = await this.detectAnomaly(metric, value, tags);
      if (anomaly) {
        this.emit('anomaly', {
          metric,
          value,
          tags,
          anomaly,
          timestamp
        });
        
        // Publish anomaly alert
        await this.redis.publish('alert:trigger', JSON.stringify({
          type: 'anomaly',
          severity: anomaly.severity,
          message: `Anomaly detected in ${metric}: ${value} (${anomaly.deviation} std devs)`,
          metadata: { metric, value, tags, anomaly }
        }));
      }

      // Calculate real-time aggregations
      this.updateRealTimeAggregations(metric, value, tags, timestamp);
      
      // Trigger immediate aggregation if buffer is large
      if (this.metricBuffers.get(metricKey).length > 1000) {
        await this.aggregateMetric(metricKey);
      }
    } catch (error) {
      logger.error('Error recording metric', { metric, error });
    }
  }

  // Time-series data processing
  updateRealTimeAggregations(metric, value, tags, timestamp) {
    const metricKey = this.getMetricKey(metric, tags);
    
    // Update moving averages
    this.config.windowSizes.forEach(windowSize => {
      const maKey = `${metricKey}:ma:${windowSize}`;
      
      if (!this.movingAverages.has(maKey)) {
        this.movingAverages.set(maKey, {
          values: [],
          sum: 0,
          windowSize: windowSize * 1000 // Convert to milliseconds
        });
      }
      
      const ma = this.movingAverages.get(maKey);
      const cutoffTime = timestamp - ma.windowSize;
      
      // Add new value
      ma.values.push({ value, timestamp });
      ma.sum += value;
      
      // Remove old values
      while (ma.values.length > 0 && ma.values[0].timestamp < cutoffTime) {
        ma.sum -= ma.values[0].value;
        ma.values.shift();
      }
      
      // Calculate average
      const average = ma.values.length > 0 ? ma.sum / ma.values.length : 0;
      
      // Emit moving average update
      this.emit('movingAverage', {
        metric,
        tags,
        windowSize,
        average,
        count: ma.values.length,
        timestamp
      });
    });
  }

  // Anomaly detection
  async detectAnomaly(metric, value, tags) {
    const metricKey = this.getMetricKey(metric, tags);
    const baseline = this.baselineStats.get(metricKey);
    
    if (!baseline || baseline.count < 100) {
      // Not enough data for anomaly detection
      return null;
    }
    
    const deviation = Math.abs(value - baseline.mean) / baseline.stdDev;
    
    if (deviation > this.config.anomalyThreshold) {
      return {
        deviation: deviation.toFixed(2),
        severity: deviation > this.config.anomalyThreshold * 2 ? 'high' : 'medium',
        baseline: {
          mean: baseline.mean,
          stdDev: baseline.stdDev,
          count: baseline.count
        }
      };
    }
    
    return null;
  }

  // Aggregation workers
  startAggregationWorkers() {
    // Set up periodic aggregation for each metric
    this.aggregationInterval = setInterval(() => {
      this.metricBuffers.forEach(async (buffer, metricKey) => {
        if (buffer.length > 0) {
          await this.aggregateMetric(metricKey);
        }
      });
    }, this.config.aggregationInterval);

    // Set up data retention cleanup
    this.cleanupInterval = setInterval(() => {
      this.cleanupOldData();
    }, 3600000); // Run every hour
  }

  async aggregateMetric(metricKey) {
    const buffer = this.metricBuffers.get(metricKey);
    if (!buffer || buffer.length === 0) return;

    const points = [...buffer];
    this.metricBuffers.set(metricKey, []);

    try {
      // Calculate aggregations
      const aggregations = this.calculateAggregations(points);
      const [metric, ...tagParts] = metricKey.split(':');
      const tags = this.parseTagsFromKey(tagParts.join(':'));
      
      // Store in database
      await this.storeAggregations(metric, aggregations, tags);
      
      // Update baseline statistics
      await this.updateBaselineStats(metricKey, aggregations);
      
      // Publish real-time update
      await this.redis.publish('analytics:update', JSON.stringify({
        metric,
        value: aggregations.last,
        aggregation: {
          min: aggregations.min,
          max: aggregations.max,
          avg: aggregations.avg,
          count: aggregations.count,
          sum: aggregations.sum,
          p50: aggregations.p50,
          p95: aggregations.p95,
          p99: aggregations.p99
        },
        timeWindow: {
          start: aggregations.startTime,
          end: aggregations.endTime
        },
        tags
      }));
    } catch (error) {
      logger.error('Error aggregating metric', { metricKey, error });
    }
  }

  calculateAggregations(points) {
    const values = points.map(p => p.value).sort((a, b) => a - b);
    const timestamps = points.map(p => p.timestamp);
    
    return {
      count: values.length,
      sum: values.reduce((a, b) => a + b, 0),
      min: values[0],
      max: values[values.length - 1],
      avg: values.reduce((a, b) => a + b, 0) / values.length,
      last: points[points.length - 1].value,
      p50: this.percentile(values, 0.5),
      p95: this.percentile(values, 0.95),
      p99: this.percentile(values, 0.99),
      startTime: Math.min(...timestamps),
      endTime: Math.max(...timestamps)
    };
  }

  percentile(sortedValues, p) {
    const index = Math.ceil(sortedValues.length * p) - 1;
    return sortedValues[Math.max(0, index)];
  }

  async storeAggregations(metric, aggregations, tags) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      
      // Store raw aggregation
      await client.query(`
        INSERT INTO analytics_metrics (
          metric_name, tags, timestamp, time_bucket,
          count, sum, min, max, avg, last,
          p50, p95, p99
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (metric_name, tags, time_bucket) DO UPDATE SET
          count = analytics_metrics.count + EXCLUDED.count,
          sum = analytics_metrics.sum + EXCLUDED.sum,
          min = LEAST(analytics_metrics.min, EXCLUDED.min),
          max = GREATEST(analytics_metrics.max, EXCLUDED.max),
          avg = (analytics_metrics.sum + EXCLUDED.sum) / (analytics_metrics.count + EXCLUDED.count),
          last = EXCLUDED.last,
          p50 = EXCLUDED.p50,
          p95 = EXCLUDED.p95,
          p99 = EXCLUDED.p99,
          updated_at = NOW()
      `, [
        metric,
        JSON.stringify(tags),
        new Date(aggregations.endTime),
        new Date(Math.floor(aggregations.endTime / 60000) * 60000), // Minute bucket
        aggregations.count,
        aggregations.sum,
        aggregations.min,
        aggregations.max,
        aggregations.avg,
        aggregations.last,
        aggregations.p50,
        aggregations.p95,
        aggregations.p99
      ]);
      
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async updateBaselineStats(metricKey, aggregations) {
    let baseline = this.baselineStats.get(metricKey);
    
    if (!baseline) {
      baseline = {
        count: 0,
        sum: 0,
        sumSquares: 0,
        mean: 0,
        stdDev: 0
      };
    }
    
    // Update running statistics using Welford's algorithm
    const newCount = baseline.count + aggregations.count;
    const newSum = baseline.sum + aggregations.sum;
    const newMean = newSum / newCount;
    
    // Update sum of squares for standard deviation
    const delta = aggregations.avg - baseline.mean;
    const newSumSquares = baseline.sumSquares + 
      aggregations.count * (delta * delta) * 
      (baseline.count / newCount);
    
    baseline.count = newCount;
    baseline.sum = newSum;
    baseline.sumSquares = newSumSquares;
    baseline.mean = newMean;
    baseline.stdDev = Math.sqrt(newSumSquares / newCount);
    
    this.baselineStats.set(metricKey, baseline);
  }

  async loadBaselineStats() {
    const client = await this.pool.connect();
    try {
      const result = await client.query(`
        SELECT 
          metric_name,
          tags,
          COUNT(*) as count,
          AVG(avg) as mean,
          STDDEV(avg) as std_dev
        FROM analytics_metrics
        WHERE timestamp > NOW() - INTERVAL '7 days'
        GROUP BY metric_name, tags
      `);
      
      result.rows.forEach(row => {
        const metricKey = this.getMetricKey(row.metric_name, row.tags);
        this.baselineStats.set(metricKey, {
          count: parseInt(row.count),
          mean: parseFloat(row.mean),
          stdDev: parseFloat(row.std_dev) || 1,
          sum: 0,
          sumSquares: 0
        });
      });
      
      logger.info(`Loaded baseline stats for ${result.rows.length} metrics`);
    } finally {
      client.release();
    }
  }

  async setupRedisSubscriptions() {
    const subscriber = this.redis.duplicate();
    
    await subscriber.subscribe('analytics:query');
    
    // Store subscriber reference for cleanup
    this.subscriber = subscriber;
    
    subscriber.on('message', async (channel, message) => {
      try {
        const data = JSON.parse(message);
        
        if (channel === 'analytics:query') {
          const result = await this.processQuery(data.query);
          this.emit('queryResult', {
            userId: data.userId,
            query: data.query,
            result,
            timestamp: Date.now()
          });
        }
      } catch (error) {
        logger.error('Error processing Redis message', { channel, error });
      }
    });
  }

  async processQuery(query) {
    const { metric, tags, timeRange, aggregation } = query;
    
    const client = await this.pool.connect();
    try {
      let sql = `
        SELECT 
          time_bucket,
          ${aggregation || 'avg'} as value,
          count,
          min,
          max,
          p95,
          p99
        FROM analytics_metrics
        WHERE metric_name = $1
      `;
      
      const params = [metric];
      let paramIndex = 2;
      
      if (tags && Object.keys(tags).length > 0) {
        sql += ` AND tags @> $${paramIndex}::jsonb`;
        params.push(JSON.stringify(tags));
        paramIndex++;
      }
      
      if (timeRange) {
        sql += ` AND timestamp >= $${paramIndex} AND timestamp <= $${paramIndex + 1}`;
        params.push(new Date(timeRange.start), new Date(timeRange.end));
        paramIndex += 2;
      }
      
      sql += ' ORDER BY time_bucket DESC LIMIT 1000';
      
      const result = await client.query(sql, params);
      
      return {
        metric,
        tags,
        timeRange,
        data: result.rows
      };
    } finally {
      client.release();
    }
  }

  async cleanupOldData() {
    const client = await this.pool.connect();
    try {
      // Clean up based on retention periods
      for (const [granularity, retention] of Object.entries(this.config.retentionPeriods)) {
        await client.query(`
          DELETE FROM analytics_metrics
          WHERE 
            timestamp < NOW() - INTERVAL '${retention} seconds' AND
            granularity = $1
        `, [granularity]);
      }
      
      logger.info('Cleaned up old analytics data');
    } catch (error) {
      logger.error('Error cleaning up old data', error);
    } finally {
      client.release();
    }
  }

  // Utility methods
  getMetricKey(metric, tags) {
    const tagString = Object.entries(tags)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${v}`)
      .join(',');
    return `${metric}:${tagString}`;
  }

  parseTagsFromKey(tagString) {
    if (!tagString) return {};
    
    const tags = {};
    tagString.split(',').forEach(pair => {
      const [key, value] = pair.split(':');
      if (key && value) {
        tags[key] = value;
      }
    });
    return tags;
  }

  // Public API
  async getMetricHistory(metric, tags, timeRange, granularity = 'minute') {
    const client = await this.pool.connect();
    try {
      const result = await client.query(`
        SELECT 
          time_bucket,
          avg,
          min,
          max,
          count,
          p95,
          p99
        FROM analytics_metrics
        WHERE 
          metric_name = $1 AND
          tags @> $2::jsonb AND
          timestamp >= $3 AND
          timestamp <= $4 AND
          granularity = $5
        ORDER BY time_bucket ASC
      `, [
        metric,
        JSON.stringify(tags),
        new Date(timeRange.start),
        new Date(timeRange.end),
        granularity
      ]);
      
      return result.rows;
    } finally {
      client.release();
    }
  }

  async getCurrentMetrics() {
    const metrics = {};
    
    this.movingAverages.forEach((ma, key) => {
      const [metric, , , windowSize] = key.split(':');
      if (!metrics[metric]) {
        metrics[metric] = {};
      }
      metrics[metric][`ma_${windowSize}`] = ma.values.length > 0 
        ? ma.sum / ma.values.length 
        : 0;
    });
    
    return metrics;
  }

  // Graceful shutdown
  async shutdown() {
    logger.info('Shutting down Analytics Engine...');
    
    // Clear intervals
    if (this.aggregationInterval) {
      clearInterval(this.aggregationInterval);
    }
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    
    // Aggregate remaining buffered metrics
    for (const [metricKey, buffer] of this.metricBuffers.entries()) {
      if (buffer.length > 0) {
        await this.aggregateMetric(metricKey);
      }
    }
    
    // Close connections
    if (this.subscriber) {
      await this.subscriber.quit();
    }
    await this.redis.quit();
    await this.pool.end();
    
    logger.info('Analytics Engine shut down');
  }
}

module.exports = AnalyticsEngine;