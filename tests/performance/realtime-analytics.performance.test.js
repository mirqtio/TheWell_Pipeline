const { performance } = require('perf_hooks');
const { createServer } = require('http');
const Client = require('socket.io-client');
const jwt = require('jsonwebtoken');
const WebSocketServer = require('../../src/realtime/WebSocketServer');
const AnalyticsEngine = require('../../src/analytics/AnalyticsEngine');
const RealtimeAnalyticsService = require('../../src/services/RealtimeAnalyticsService');

describe('Real-time Analytics Performance Tests', () => {
  let httpServer;
  let wsServer;
  let analyticsEngine;
  let realtimeService;
  let serverPort;

  const TEST_TOKEN = jwt.sign(
    { userId: 'perf-test-user', permissions: ['admin'] },
    process.env.JWT_SECRET || 'your-secret-key'
  );

  beforeAll(async () => {
    // Mock database to avoid I/O in performance tests
    jest.mock('pg', () => ({
      Pool: jest.fn().mockImplementation(() => ({
        connect: jest.fn().mockResolvedValue({
          query: jest.fn().mockResolvedValue({ rows: [] }),
          release: jest.fn()
        }),
        end: jest.fn()
      }))
    }));

    analyticsEngine = new AnalyticsEngine({
      aggregationInterval: 5000
    });

    httpServer = createServer();
    await new Promise((resolve) => {
      httpServer.listen(0, () => {
        serverPort = httpServer.address().port;
        resolve();
      });
    });

    wsServer = new WebSocketServer(httpServer);
    
    realtimeService = new RealtimeAnalyticsService({
      analyticsEngine,
      batchSize: 1000,
      flushInterval: 100
    });
  });

  afterAll(async () => {
    if (realtimeService) await realtimeService.shutdown();
    if (wsServer) await wsServer.shutdown();
    if (analyticsEngine) await analyticsEngine.shutdown();
    if (httpServer) {
      await new Promise((resolve) => httpServer.close(resolve));
    }
  });

  describe('Metric Recording Performance', () => {
    test('should handle 10,000 metrics per second', async () => {
      const metricsPerSecond = 10000;
      const testDuration = 1000; // 1 second
      const metrics = [];

      // Generate test metrics
      for (let i = 0; i < metricsPerSecond; i++) {
        metrics.push({
          name: `metric.${i % 100}`,
          value: Math.random() * 1000,
          tags: {
            service: `service${i % 10}`,
            region: `region${i % 5}`
          }
        });
      }

      const startTime = performance.now();
      
      // Record all metrics
      await Promise.all(
        metrics.map(m => analyticsEngine.recordMetric(m.name, m.value, m.tags))
      );

      const endTime = performance.now();
      const duration = endTime - startTime;

      console.log(`Recorded ${metricsPerSecond} metrics in ${duration.toFixed(2)}ms`);
      console.log(`Rate: ${(metricsPerSecond / (duration / 1000)).toFixed(0)} metrics/second`);

      expect(duration).toBeLessThan(testDuration);
    });

    test('should maintain low latency with high cardinality', async () => {
      const iterations = 1000;
      const latencies = [];

      for (let i = 0; i < iterations; i++) {
        const startTime = performance.now();
        
        await analyticsEngine.recordMetric(
          'high.cardinality.metric',
          Math.random() * 100,
          {
            userId: `user${i}`,
            sessionId: `session${i}`,
            endpoint: `/api/endpoint${i % 100}`,
            method: ['GET', 'POST', 'PUT', 'DELETE'][i % 4]
          }
        );

        const latency = performance.now() - startTime;
        latencies.push(latency);
      }

      const avgLatency = latencies.reduce((a, b) => a + b) / latencies.length;
      const p95Latency = latencies.sort((a, b) => a - b)[Math.floor(latencies.length * 0.95)];
      const p99Latency = latencies.sort((a, b) => a - b)[Math.floor(latencies.length * 0.99)];

      console.log(`Average latency: ${avgLatency.toFixed(2)}ms`);
      console.log(`P95 latency: ${p95Latency.toFixed(2)}ms`);
      console.log(`P99 latency: ${p99Latency.toFixed(2)}ms`);

      expect(avgLatency).toBeLessThan(1); // Sub-millisecond average
      expect(p99Latency).toBeLessThan(5); // P99 under 5ms
    });
  });

  describe('WebSocket Broadcasting Performance', () => {
    test('should broadcast to 1000 connected clients efficiently', async () => {
      const clientCount = 1000;
      const clients = [];
      const messageReceivedPromises = [];

      // Connect clients
      const connectStart = performance.now();
      
      for (let i = 0; i < clientCount; i++) {
        const client = Client(`http://localhost:${serverPort}/analytics`, {
          auth: { token: TEST_TOKEN },
          transports: ['websocket']
        });
        
        clients.push(client);
        
        messageReceivedPromises.push(new Promise((resolve) => {
          client.on('metric:update', () => resolve(performance.now()));
        }));
      }

      // Wait for all connections
      await Promise.all(clients.map(client => 
        new Promise(resolve => client.on('connect', resolve))
      ));

      const connectDuration = performance.now() - connectStart;
      console.log(`Connected ${clientCount} clients in ${connectDuration.toFixed(2)}ms`);

      // Subscribe all clients to metrics
      clients.forEach(client => {
        client.emit('subscribe:metrics', ['test.broadcast.metric']);
      });

      // Broadcast a metric update
      const broadcastStart = performance.now();
      
      wsServer.broadcastAnalyticsUpdate({
        metric: 'test.broadcast.metric',
        value: 123.45,
        timestamp: Date.now()
      });

      // Wait for all clients to receive the message
      const receiveTimes = await Promise.all(messageReceivedPromises);
      const broadcastEnd = Math.max(...receiveTimes);
      const broadcastDuration = broadcastEnd - broadcastStart;

      console.log(`Broadcast to ${clientCount} clients completed in ${broadcastDuration.toFixed(2)}ms`);

      // Calculate message delivery spread
      const minReceiveTime = Math.min(...receiveTimes);
      const maxReceiveTime = Math.max(...receiveTimes);
      const spread = maxReceiveTime - minReceiveTime;

      console.log(`Message delivery spread: ${spread.toFixed(2)}ms`);

      expect(broadcastDuration).toBeLessThan(100); // Under 100ms for 1000 clients
      expect(spread).toBeLessThan(50); // Tight delivery window

      // Cleanup
      clients.forEach(client => client.disconnect());
    });

    test('should handle rapid-fire updates', async () => {
      const updateCount = 1000;
      const client = Client(`http://localhost:${serverPort}/analytics`, {
        auth: { token: TEST_TOKEN },
        transports: ['websocket']
      });

      await new Promise(resolve => client.on('connect', resolve));
      
      client.emit('subscribe:metrics', ['rapid.fire.metric']);

      let receivedCount = 0;
      const startTime = performance.now();

      const receivedPromise = new Promise((resolve) => {
        client.on('metric:update', () => {
          receivedCount++;
          if (receivedCount === updateCount) {
            resolve();
          }
        });
      });

      // Send rapid updates
      for (let i = 0; i < updateCount; i++) {
        wsServer.broadcastAnalyticsUpdate({
          metric: 'rapid.fire.metric',
          value: i,
          timestamp: Date.now()
        });
      }

      await receivedPromise;
      const duration = performance.now() - startTime;

      console.log(`Received ${updateCount} updates in ${duration.toFixed(2)}ms`);
      console.log(`Rate: ${(updateCount / (duration / 1000)).toFixed(0)} updates/second`);

      expect(receivedCount).toBe(updateCount);
      expect(duration).toBeLessThan(1000); // All updates in under 1 second

      client.disconnect();
    });
  });

  describe('Aggregation Performance', () => {
    test('should aggregate large batches efficiently', async () => {
      const batchSize = 10000;
      const points = [];

      // Generate test data
      const now = Date.now();
      for (let i = 0; i < batchSize; i++) {
        points.push({
          value: Math.random() * 1000,
          timestamp: now - i * 10 // 10ms intervals
        });
      }

      const startTime = performance.now();
      const aggregations = analyticsEngine.calculateAggregations(points);
      const duration = performance.now() - startTime;

      console.log(`Aggregated ${batchSize} points in ${duration.toFixed(2)}ms`);

      expect(duration).toBeLessThan(50); // Under 50ms for 10k points
      expect(aggregations).toMatchObject({
        count: batchSize,
        min: expect.any(Number),
        max: expect.any(Number),
        avg: expect.any(Number),
        p95: expect.any(Number),
        p99: expect.any(Number)
      });
    });
  });

  describe('Memory Usage', () => {
    test('should maintain stable memory with continuous metric flow', async () => {
      const testDuration = 5000; // 5 seconds
      const metricsPerSecond = 1000;
      const memorySnapshots = [];

      // Take initial memory snapshot
      if (global.gc) global.gc();
      const initialMemory = process.memoryUsage().heapUsed;

      const startTime = Date.now();
      const endTime = startTime + testDuration;

      // Continuous metric recording
      const recordingInterval = setInterval(async () => {
        const promises = [];
        
        for (let i = 0; i < metricsPerSecond / 10; i++) {
          promises.push(
            analyticsEngine.recordMetric(
              `memory.test.metric.${i % 50}`,
              Math.random() * 1000,
              { test: true, iteration: i }
            )
          );
        }

        await Promise.all(promises);

        // Take memory snapshot
        memorySnapshots.push(process.memoryUsage().heapUsed);
      }, 100); // Every 100ms

      // Wait for test duration
      await new Promise(resolve => setTimeout(resolve, testDuration));
      clearInterval(recordingInterval);

      // Force aggregation
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Take final memory snapshot
      if (global.gc) global.gc();
      const finalMemory = process.memoryUsage().heapUsed;

      const memoryIncrease = finalMemory - initialMemory;
      const memoryIncreaseMB = memoryIncrease / 1024 / 1024;

      console.log(`Initial memory: ${(initialMemory / 1024 / 1024).toFixed(2)}MB`);
      console.log(`Final memory: ${(finalMemory / 1024 / 1024).toFixed(2)}MB`);
      console.log(`Memory increase: ${memoryIncreaseMB.toFixed(2)}MB`);

      // Check for memory leaks
      expect(memoryIncreaseMB).toBeLessThan(50); // Less than 50MB increase

      // Check memory stability
      const avgMemory = memorySnapshots.reduce((a, b) => a + b) / memorySnapshots.length;
      const maxMemory = Math.max(...memorySnapshots);
      const stabilityRatio = maxMemory / avgMemory;

      console.log(`Memory stability ratio: ${stabilityRatio.toFixed(2)}`);
      expect(stabilityRatio).toBeLessThan(1.5); // Max should not be 50% higher than average
    });
  });

  describe('Concurrent Operations', () => {
    test('should handle concurrent metric recording and querying', async () => {
      const concurrentOps = 100;
      const opsPerType = 50;

      const operations = [];
      const startTime = performance.now();

      // Mix of operations
      for (let i = 0; i < concurrentOps; i++) {
        if (i % 2 === 0) {
          // Record metric
          operations.push(
            analyticsEngine.recordMetric(
              `concurrent.metric.${i % 10}`,
              Math.random() * 100,
              { concurrent: true }
            )
          );
        } else {
          // Query metric
          operations.push(
            analyticsEngine.processQuery({
              metric: `concurrent.metric.${i % 10}`,
              tags: { concurrent: true },
              timeRange: {
                start: Date.now() - 3600000,
                end: Date.now()
              }
            })
          );
        }
      }

      await Promise.all(operations);
      const duration = performance.now() - startTime;

      console.log(`Completed ${concurrentOps} concurrent operations in ${duration.toFixed(2)}ms`);
      console.log(`Average operation time: ${(duration / concurrentOps).toFixed(2)}ms`);

      expect(duration).toBeLessThan(1000); // Under 1 second for 100 ops
    });
  });
});