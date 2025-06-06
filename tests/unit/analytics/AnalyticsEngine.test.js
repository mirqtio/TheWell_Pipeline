const AnalyticsEngine = require('../../../src/analytics/AnalyticsEngine');
const Redis = require('ioredis-mock');
const { EventEmitter } = require('events');

// Mock dependencies
jest.mock('ioredis', () => require('ioredis-mock'));
jest.mock('pg', () => {
  const mockClient = {
    query: jest.fn(),
    release: jest.fn()
  };
  
  return {
    Pool: jest.fn().mockImplementation(() => ({
      connect: jest.fn().mockResolvedValue(mockClient),
      end: jest.fn().mockResolvedValue(undefined),
      query: jest.fn()
    }))
  };
});

describe('AnalyticsEngine', () => {
  let analyticsEngine;
  let mockPool;
  let mockClient;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Get mock instances
    const { Pool } = require('pg');
    mockPool = new Pool();
    mockClient = {
      query: jest.fn(),
      release: jest.fn()
    };
    mockPool.connect.mockResolvedValue(mockClient);
    
    analyticsEngine = new AnalyticsEngine({
      windowSizes: [60, 300], // 1m, 5m for testing
      aggregationInterval: 100, // Fast for testing
      anomalyThreshold: 2 // Lower threshold for testing
    });
  });

  afterEach(async () => {
    if (analyticsEngine) {
      // Clear timers
      clearInterval(analyticsEngine.aggregationTimer);
      await analyticsEngine.shutdown();
    }
  });

  describe('Metric Recording', () => {
    test('should record a metric successfully', async () => {
      const metric = 'test.metric';
      const value = 100;
      const tags = { service: 'test' };

      await analyticsEngine.recordMetric(metric, value, tags);

      const metricKey = analyticsEngine.getMetricKey(metric, tags);
      expect(analyticsEngine.metricBuffers.has(metricKey)).toBe(true);
      
      const buffer = analyticsEngine.metricBuffers.get(metricKey);
      expect(buffer).toHaveLength(1);
      expect(buffer[0]).toMatchObject({
        value,
        tags
      });
    });

    test('should update moving averages', async () => {
      const metric = 'test.metric';
      const values = [100, 200, 150, 175];
      
      for (const value of values) {
        await analyticsEngine.recordMetric(metric, value);
      }

      // Check moving averages were calculated
      const maKey60 = `${metric}::ma:60`;
      expect(analyticsEngine.movingAverages.has(maKey60)).toBe(true);
      
      const ma60 = analyticsEngine.movingAverages.get(maKey60);
      expect(ma60.values.length).toBe(values.length);
      expect(ma60.sum).toBe(values.reduce((a, b) => a + b, 0));
    });

    test('should trigger aggregation when buffer is full', async () => {
      const metric = 'test.metric';
      const aggregateSpy = jest.spyOn(analyticsEngine, 'aggregateMetric');
      
      // Fill buffer beyond threshold
      for (let i = 0; i < 1001; i++) {
        await analyticsEngine.recordMetric(metric, i);
      }

      expect(aggregateSpy).toHaveBeenCalled();
    });
  });

  describe('Anomaly Detection', () => {
    test('should detect anomalies when value deviates significantly', async () => {
      const metric = 'test.anomaly';
      const metricKey = analyticsEngine.getMetricKey(metric, {});
      
      // Set up baseline stats
      analyticsEngine.baselineStats.set(metricKey, {
        count: 1000,
        mean: 100,
        stdDev: 10,
        sum: 100000,
        sumSquares: 0
      });

      // Normal value - no anomaly
      const normalAnomaly = await analyticsEngine.detectAnomaly(metric, 105, {});
      expect(normalAnomaly).toBeNull();

      // Anomalous value - should detect
      const highAnomaly = await analyticsEngine.detectAnomaly(metric, 130, {});
      expect(highAnomaly).not.toBeNull();
      expect(highAnomaly.severity).toBe('medium');
      expect(parseFloat(highAnomaly.deviation)).toBeGreaterThan(2);
    });

    test('should not detect anomalies with insufficient data', async () => {
      const metric = 'test.new.metric';
      const anomaly = await analyticsEngine.detectAnomaly(metric, 1000, {});
      expect(anomaly).toBeNull();
    });

    test('should emit anomaly event when detected', async () => {
      const metric = 'test.anomaly.event';
      const metricKey = analyticsEngine.getMetricKey(metric, {});
      
      // Set up for anomaly detection
      analyticsEngine.baselineStats.set(metricKey, {
        count: 1000,
        mean: 100,
        stdDev: 5,
        sum: 100000,
        sumSquares: 0
      });

      const anomalyPromise = new Promise(resolve => {
        analyticsEngine.once('anomaly', resolve);
      });

      await analyticsEngine.recordMetric(metric, 150, {});
      
      const anomalyEvent = await anomalyPromise;
      expect(anomalyEvent).toMatchObject({
        metric,
        value: 150,
        anomaly: expect.objectContaining({
          severity: expect.any(String),
          deviation: expect.any(String)
        })
      });
    });
  });

  describe('Aggregation', () => {
    test('should calculate correct aggregations', () => {
      const points = [
        { value: 10, timestamp: Date.now() },
        { value: 20, timestamp: Date.now() + 1000 },
        { value: 30, timestamp: Date.now() + 2000 },
        { value: 40, timestamp: Date.now() + 3000 },
        { value: 50, timestamp: Date.now() + 4000 }
      ];

      const aggregations = analyticsEngine.calculateAggregations(points);

      expect(aggregations).toMatchObject({
        count: 5,
        sum: 150,
        min: 10,
        max: 50,
        avg: 30,
        last: 50,
        p50: 30,
        p95: 50,
        p99: 50
      });
    });

    test('should calculate percentiles correctly', () => {
      const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      
      expect(analyticsEngine.percentile(values, 0.5)).toBe(5);
      expect(analyticsEngine.percentile(values, 0.9)).toBe(9);
      expect(analyticsEngine.percentile(values, 0.95)).toBe(10);
    });

    test('should store aggregations in database', async () => {
      const metric = 'test.store';
      const aggregations = {
        count: 10,
        sum: 100,
        min: 5,
        max: 15,
        avg: 10,
        last: 12,
        p50: 10,
        p95: 14,
        p99: 15,
        startTime: Date.now() - 60000,
        endTime: Date.now()
      };
      const tags = { service: 'test' };

      mockClient.query.mockResolvedValue({ rows: [] });

      await analyticsEngine.storeAggregations(metric, aggregations, tags);

      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO analytics_metrics'),
        expect.arrayContaining([metric, JSON.stringify(tags)])
      );
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe('Baseline Statistics', () => {
    test('should update baseline statistics correctly', async () => {
      const metricKey = 'test.baseline:service:test';
      
      // Initial aggregation
      await analyticsEngine.updateBaselineStats(metricKey, {
        count: 10,
        sum: 100,
        avg: 10
      });

      let baseline = analyticsEngine.baselineStats.get(metricKey);
      expect(baseline.count).toBe(10);
      expect(baseline.mean).toBe(10);

      // Update with new data
      await analyticsEngine.updateBaselineStats(metricKey, {
        count: 10,
        sum: 200,
        avg: 20
      });

      baseline = analyticsEngine.baselineStats.get(metricKey);
      expect(baseline.count).toBe(20);
      expect(baseline.mean).toBe(15); // (100 + 200) / 20
    });

    test('should load baseline stats from database', async () => {
      mockClient.query.mockResolvedValue({
        rows: [
          {
            metric_name: 'test.metric',
            tags: { service: 'test' },
            count: '100',
            mean: '50.5',
            std_dev: '5.2'
          }
        ]
      });

      await analyticsEngine.loadBaselineStats();

      const metricKey = analyticsEngine.getMetricKey('test.metric', { service: 'test' });
      const baseline = analyticsEngine.baselineStats.get(metricKey);
      
      expect(baseline).toBeDefined();
      expect(baseline.count).toBe(100);
      expect(baseline.mean).toBe(50.5);
      expect(baseline.stdDev).toBe(5.2);
    });
  });

  describe('Query Processing', () => {
    test('should process metric queries correctly', async () => {
      const query = {
        metric: 'test.metric',
        tags: { service: 'test' },
        timeRange: {
          start: Date.now() - 3600000,
          end: Date.now()
        },
        aggregation: 'avg'
      };

      mockClient.query.mockResolvedValue({
        rows: [
          { time_bucket: new Date(), value: 10 },
          { time_bucket: new Date(), value: 20 }
        ]
      });

      const result = await analyticsEngine.processQuery(query);

      expect(result).toMatchObject({
        metric: query.metric,
        tags: query.tags,
        timeRange: query.timeRange,
        data: expect.arrayContaining([
          expect.objectContaining({ value: 10 }),
          expect.objectContaining({ value: 20 })
        ])
      });

      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
        expect.arrayContaining([query.metric])
      );
    });
  });

  describe('Utility Methods', () => {
    test('should generate correct metric keys', () => {
      const metric = 'test.metric';
      const tags = { service: 'api', region: 'us-east' };
      
      const key = analyticsEngine.getMetricKey(metric, tags);
      expect(key).toBe('test.metric:region:us-east,service:api');
    });

    test('should parse tags from key correctly', () => {
      const tagString = 'service:api,region:us-east';
      const tags = analyticsEngine.parseTagsFromKey(tagString);
      
      expect(tags).toEqual({
        service: 'api',
        region: 'us-east'
      });
    });

    test('should handle empty tags', () => {
      const key = analyticsEngine.getMetricKey('test.metric', {});
      expect(key).toBe('test.metric:');
      
      const tags = analyticsEngine.parseTagsFromKey('');
      expect(tags).toEqual({});
    });
  });

  describe('Public API', () => {
    test('should get metric history', async () => {
      mockClient.query.mockResolvedValue({
        rows: [
          { time_bucket: new Date(), avg: 10, min: 5, max: 15 }
        ]
      });

      const history = await analyticsEngine.getMetricHistory(
        'test.metric',
        { service: 'test' },
        { start: Date.now() - 3600000, end: Date.now() },
        'minute'
      );

      expect(history).toHaveLength(1);
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
        expect.arrayContaining(['test.metric', JSON.stringify({ service: 'test' })])
      );
    });

    test('should get current metrics', async () => {
      // Add some moving average data
      analyticsEngine.movingAverages.set('test.metric::ma:60', {
        values: [{ value: 10 }, { value: 20 }],
        sum: 30,
        windowSize: 60000
      });

      const metrics = await analyticsEngine.getCurrentMetrics();
      
      expect(metrics).toEqual({
        'test.metric': {
          ma_60: 15
        }
      });
    });
  });

  describe('Graceful Shutdown', () => {
    test('should aggregate remaining metrics on shutdown', async () => {
      const metric = 'test.shutdown';
      await analyticsEngine.recordMetric(metric, 100);
      
      const aggregateSpy = jest.spyOn(analyticsEngine, 'aggregateMetric');
      
      await analyticsEngine.shutdown();
      
      expect(aggregateSpy).toHaveBeenCalledWith(
        expect.stringContaining(metric)
      );
    });

    test('should close all connections on shutdown', async () => {
      const redisQuitSpy = jest.spyOn(analyticsEngine.redis, 'quit');
      const poolEndSpy = jest.spyOn(analyticsEngine.pool, 'end');
      
      await analyticsEngine.shutdown();
      
      expect(redisQuitSpy).toHaveBeenCalled();
      expect(poolEndSpy).toHaveBeenCalled();
    });
  });
});