const { createServer } = require('http');
const Client = require('socket.io-client');
const jwt = require('jsonwebtoken');
const Redis = require('ioredis');
const { Pool } = require('pg');
const WebSocketServer = require('../../../src/realtime/WebSocketServer');
const AnalyticsEngine = require('../../../src/analytics/AnalyticsEngine');
const RealtimeAnalyticsService = require('../../../src/services/RealtimeAnalyticsService');
const DatabaseManager = require('../../../src/database/DatabaseManager');

// Test configuration
const TEST_PORT = 0; // Let system assign port
const TEST_TOKEN = jwt.sign(
  { userId: 'test-user', permissions: ['admin'] },
  process.env.JWT_SECRET || 'your-secret-key'
);

describe('Real-time Analytics Integration', () => {
  let httpServer;
  let wsServer;
  let analyticsEngine;
  let realtimeService;
  let dbManager;
  let serverPort;
  let redis;
  let pgPool;

  beforeAll(async () => {
    // Set up test database
    pgPool = new Pool({
      connectionString: process.env.TEST_DATABASE_URL || 'postgresql://thewell_test:test123@localhost:5432/thewell_test'
    });

    // Create tables if needed
    const client = await pgPool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS analytics_metrics (
          id BIGSERIAL PRIMARY KEY,
          metric_name VARCHAR(255) NOT NULL,
          tags JSONB DEFAULT '{}',
          timestamp TIMESTAMPTZ NOT NULL,
          time_bucket TIMESTAMPTZ NOT NULL,
          count INTEGER DEFAULT 1,
          sum DOUBLE PRECISION,
          avg DOUBLE PRECISION,
          min DOUBLE PRECISION,
          max DOUBLE PRECISION,
          p95 DOUBLE PRECISION,
          p99 DOUBLE PRECISION,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
    } finally {
      client.release();
    }

    // Set up Redis
    redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      db: 1 // Use separate DB for tests
    });
    await redis.flushdb();

    // Initialize components
    dbManager = new DatabaseManager({
      connectionString: process.env.TEST_DATABASE_URL
    });

    analyticsEngine = new AnalyticsEngine({
      aggregationInterval: 1000 // Fast for testing
    });

    // Create HTTP server
    httpServer = createServer();
    await new Promise((resolve) => {
      httpServer.listen(TEST_PORT, () => {
        serverPort = httpServer.address().port;
        resolve();
      });
    });

    // Initialize WebSocket server
    wsServer = new WebSocketServer(httpServer);

    // Initialize real-time analytics service
    realtimeService = new RealtimeAnalyticsService({
      analyticsEngine,
      dbManager,
      flushInterval: 100 // Fast for testing
    });
  });

  afterAll(async () => {
    // Cleanup
    if (realtimeService) await realtimeService.shutdown();
    if (wsServer) await wsServer.shutdown();
    if (analyticsEngine) await analyticsEngine.shutdown();
    if (httpServer) {
      await new Promise((resolve) => httpServer.close(resolve));
    }
    if (redis) await redis.quit();
    if (pgPool) await pgPool.end();
  });

  describe('End-to-End Metric Flow', () => {
    test('should track and broadcast document processing metrics', (done) => {
      const documentId = 'test-doc-123';
      const client = Client(`http://localhost:${serverPort}/documents`, {
        auth: { token: TEST_TOKEN }
      });

      client.on('connect', () => {
        // Subscribe to document updates
        client.emit('subscribe:document', documentId);

        // Track document processing
        realtimeService.trackDocumentProcessing(documentId, 'processing', {
          progress: 50,
          step: 'enrichment'
        });

        // Should receive status update
        client.on('status:update', (data) => {
          expect(data).toMatchObject({
            documentId,
            status: 'processing',
            progress: 50,
            metadata: { step: 'enrichment' }
          });
          client.disconnect();
          done();
        });
      });
    });

    test('should track search queries and compute analytics', async () => {
      const query = 'test search query';
      const results = [{ id: 1 }, { id: 2 }, { id: 3 }];
      
      await realtimeService.trackSearchQuery(query, results, {
        responseTime: 125,
        userId: 'test-user',
        source: 'api'
      });

      // Wait for aggregation
      await new Promise(resolve => setTimeout(resolve, 1500));

      // Check metrics were recorded
      const client = await pgPool.connect();
      try {
        const result = await client.query(`
          SELECT * FROM analytics_metrics 
          WHERE metric_name = 'search.query.latency'
          ORDER BY timestamp DESC
          LIMIT 1
        `);

        expect(result.rows).toHaveLength(1);
        expect(result.rows[0].avg).toBe(125);
      } finally {
        client.release();
      }
    });

    test('should detect and broadcast anomalies', (done) => {
      const alertClient = Client(`http://localhost:${serverPort}/alerts`, {
        auth: { token: TEST_TOKEN }
      });

      alertClient.on('connect', async () => {
        // Subscribe to anomaly alerts
        alertClient.emit('subscribe:alerts', ['anomaly']);

        // Set up baseline for anomaly detection
        const metricKey = analyticsEngine.getMetricKey('test.anomaly.metric', {});
        analyticsEngine.baselineStats.set(metricKey, {
          count: 1000,
          mean: 100,
          stdDev: 10,
          sum: 100000,
          sumSquares: 0
        });

        // Listen for anomaly alert
        alertClient.on('alert:new', (alert) => {
          expect(alert.type).toBe('anomaly');
          expect(alert.severity).toBeDefined();
          expect(alert.message).toContain('Anomaly detected');
          alertClient.disconnect();
          done();
        });

        // Record anomalous value
        await analyticsEngine.recordMetric('test.anomaly.metric', 150, {});
      });
    });
  });

  describe('Real-time Dashboard Updates', () => {
    test('should stream analytics updates to connected clients', (done) => {
      const analyticsClient = Client(`http://localhost:${serverPort}/analytics`, {
        auth: { token: TEST_TOKEN }
      });

      analyticsClient.on('connect', async () => {
        // Subscribe to metrics
        analyticsClient.emit('subscribe:metrics', ['api.request.count']);

        // Listen for metric updates
        analyticsClient.on('metric:update', (data) => {
          expect(data.metric).toBe('api.request.count');
          expect(data.value).toBe(1);
          expect(data.aggregation).toBeDefined();
          analyticsClient.disconnect();
          done();
        });

        // Track API request
        await realtimeService.trackAPIRequest('/api/test', 'GET', 200, 50, {
          userId: 'test-user'
        });
      });
    });

    test('should handle concurrent metric updates', async () => {
      const promises = [];
      
      // Simulate concurrent requests
      for (let i = 0; i < 100; i++) {
        promises.push(
          realtimeService.trackAPIRequest(`/api/endpoint${i % 10}`, 'GET', 200, 
            Math.random() * 200, { userId: `user${i % 5}` })
        );
      }

      await Promise.all(promises);

      // Wait for aggregation
      await new Promise(resolve => setTimeout(resolve, 1500));

      // Verify metrics were recorded
      const client = await pgPool.connect();
      try {
        const result = await client.query(`
          SELECT COUNT(*) as count FROM analytics_metrics 
          WHERE metric_name = 'api.request.count'
        `);

        expect(parseInt(result.rows[0].count)).toBeGreaterThan(0);
      } finally {
        client.release();
      }
    });
  });

  describe('Performance and Reliability', () => {
    test('should handle client disconnections gracefully', async () => {
      const clients = [];
      
      // Connect multiple clients
      for (let i = 0; i < 5; i++) {
        const client = Client(`http://localhost:${serverPort}/analytics`, {
          auth: { token: TEST_TOKEN }
        });
        clients.push(client);
      }

      // Wait for connections
      await Promise.all(clients.map(client => 
        new Promise(resolve => client.on('connect', resolve))
      ));

      // Disconnect half the clients
      clients.slice(0, 3).forEach(client => client.disconnect());

      // Send update to remaining clients
      await new Promise(resolve => setTimeout(resolve, 100));
      
      wsServer.broadcastAnalyticsUpdate({
        metric: 'test.metric',
        value: 100
      });

      // Verify remaining clients receive updates
      const receivedPromises = clients.slice(3).map(client =>
        new Promise(resolve => {
          client.on('metric:update', (data) => {
            expect(data.metric).toBe('test.metric');
            resolve();
          });
        })
      );

      await Promise.race([
        Promise.all(receivedPromises),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 1000))
      ]);

      // Cleanup
      clients.forEach(client => client.disconnect());
    });

    test('should recover from Redis connection issues', async () => {
      // Simulate Redis disconnect
      await wsServer.redis.disconnect();

      // Should not throw when broadcasting
      expect(() => {
        wsServer.broadcastDocumentStatus({
          documentId: 'test',
          status: 'completed'
        });
      }).not.toThrow();

      // Reconnect Redis
      await wsServer.redis.connect();
    });

    test('should apply rate limiting for high-frequency events', async () => {
      const startTime = Date.now();
      const events = [];

      // Generate high-frequency events
      for (let i = 0; i < 1000; i++) {
        events.push(
          realtimeService.trackSystemMetrics({
            cpu: Math.random() * 100,
            memory: Math.random() * 100,
            hostname: 'test-host'
          })
        );
      }

      await Promise.all(events);
      const duration = Date.now() - startTime;

      // Should complete quickly despite high volume
      expect(duration).toBeLessThan(1000);

      // Verify sampling worked
      const sampledEvents = realtimeService.eventQueue.filter(
        e => e.type === 'system.metrics'
      );
      
      // Should have sampled down based on configured rate
      expect(sampledEvents.length).toBeLessThan(100); // 5% sampling rate
    });
  });

  describe('Query Processing', () => {
    test('should handle real-time queries through WebSocket', (done) => {
      const client = Client(`http://localhost:${serverPort}/analytics`, {
        auth: { token: TEST_TOKEN }
      });

      client.on('connect', () => {
        const query = {
          metric: 'api.request.latency',
          tags: { endpoint: '/api/test' },
          timeRange: {
            start: Date.now() - 3600000,
            end: Date.now()
          }
        };

        client.emit('query:realtime', query, (response) => {
          expect(response.status).toBe('processing');
          client.disconnect();
          done();
        });
      });
    });
  });

  describe('Alert Management', () => {
    test('should acknowledge alerts through WebSocket', (done) => {
      const client = Client(`http://localhost:${serverPort}/alerts`, {
        auth: { token: TEST_TOKEN }
      });

      client.on('connect', () => {
        const alertId = 'test-alert-123';

        client.emit('acknowledge:alert', alertId, (response) => {
          expect(response.status).toBe('acknowledged');
          client.disconnect();
          done();
        });
      });
    });
  });
});