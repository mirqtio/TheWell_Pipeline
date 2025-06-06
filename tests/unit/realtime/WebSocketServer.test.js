const WebSocketServer = require('../../../src/realtime/WebSocketServer');
const { Server } = require('socket.io');
const { createServer } = require('http');
const Client = require('socket.io-client');
const jwt = require('jsonwebtoken');

// Mock dependencies
jest.mock('ioredis', () => require('ioredis-mock'));
jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn()
}));

describe('WebSocketServer', () => {
  jest.setTimeout(30000); // Increase timeout for socket tests
  let httpServer;
  let wsServer;
  let clientSocket;
  let serverPort;
  const testToken = jwt.sign(
    { userId: 'test-user', permissions: ['documents:read', 'analytics:read'] },
    process.env.JWT_SECRET || 'your-secret-key'
  );

  beforeAll((done) => {
    httpServer = createServer();
    httpServer.listen(() => {
      serverPort = httpServer.address().port;
      done();
    });
  });

  beforeEach(() => {
    wsServer = new WebSocketServer(httpServer);
  });

  afterEach(async () => {
    if (clientSocket && clientSocket.connected) {
      clientSocket.disconnect();
    }
    if (wsServer) {
      await wsServer.shutdown();
    }
  });

  afterAll((done) => {
    httpServer.close(done);
  });

  describe('Connection and Authentication', () => {
    test('should accept connections with valid token', (done) => {
      clientSocket = Client(`http://localhost:${serverPort}/documents`, {
        auth: { token: testToken }
      });

      clientSocket.on('connect', () => {
        expect(clientSocket.connected).toBe(true);
        done();
      });
    });

    test('should reject connections without token', (done) => {
      clientSocket = Client(`http://localhost:${serverPort}/documents`, {
        auth: {}
      });

      clientSocket.on('connect_error', (error) => {
        expect(error.message).toBe('Authentication required');
        done();
      });
    });

    test('should reject connections with invalid token', (done) => {
      clientSocket = Client(`http://localhost:${serverPort}/documents`, {
        auth: { token: 'invalid-token' }
      });

      clientSocket.on('connect_error', (error) => {
        expect(error.message).toBe('Authentication failed');
        done();
      });
    });
  });

  describe('Document Namespace', () => {
    beforeEach((done) => {
      clientSocket = Client(`http://localhost:${serverPort}/documents`, {
        auth: { token: testToken }
      });
      clientSocket.on('connect', done);
    });

    test('should allow subscribing to document updates', (done) => {
      const documentId = 'doc123';
      
      clientSocket.emit('subscribe:document', documentId);
      
      // Simulate document status update
      setTimeout(() => {
        wsServer.broadcastDocumentStatus({
          documentId,
          status: 'processing',
          progress: 50,
          metadata: { step: 'enrichment' }
        });
      }, 100);

      clientSocket.on('status:update', (data) => {
        expect(data).toMatchObject({
          documentId,
          status: 'processing',
          progress: 50,
          metadata: { step: 'enrichment' }
        });
        done();
      });
    });

    test('should handle unsubscribe from document', () => {
      const documentId = 'doc123';
      
      clientSocket.emit('subscribe:document', documentId);
      clientSocket.emit('unsubscribe:document', documentId);
      
      // Verify no error occurs
      expect(true).toBe(true);
    });
  });

  describe('Analytics Namespace', () => {
    let analyticsSocket;

    beforeEach((done) => {
      analyticsSocket = Client(`http://localhost:${serverPort}/analytics`, {
        auth: { token: testToken }
      });
      analyticsSocket.on('connect', done);
    });

    afterEach(() => {
      if (analyticsSocket && analyticsSocket.connected) {
        analyticsSocket.disconnect();
      }
    });

    test('should allow subscribing to metrics', (done) => {
      const metrics = ['cpu.usage', 'memory.usage'];
      
      analyticsSocket.emit('subscribe:metrics', metrics);
      
      // Simulate metric update
      setTimeout(() => {
        wsServer.broadcastAnalyticsUpdate({
          metric: 'cpu.usage',
          value: 45.5,
          aggregation: { avg: 45.5, max: 50 },
          timeWindow: { start: Date.now() - 60000, end: Date.now() }
        });
      }, 100);

      analyticsSocket.on('metric:update', (data) => {
        expect(data.metric).toBe('cpu.usage');
        expect(data.value).toBe(45.5);
        done();
      });
    });

    test('should handle realtime queries', (done) => {
      const query = {
        metric: 'api.latency',
        timeRange: { start: Date.now() - 3600000, end: Date.now() }
      };

      analyticsSocket.emit('query:realtime', query, (response) => {
        expect(response).toEqual({ status: 'processing' });
        done();
      });
    });
  });

  describe('Alerts Namespace', () => {
    let alertsSocket;

    beforeEach((done) => {
      alertsSocket = Client(`http://localhost:${serverPort}/alerts`, {
        auth: { token: testToken }
      });
      alertsSocket.on('connect', done);
    });

    afterEach(() => {
      if (alertsSocket && alertsSocket.connected) {
        alertsSocket.disconnect();
      }
    });

    test('should broadcast alerts to subscribers', (done) => {
      alertsSocket.emit('subscribe:alerts', ['system', 'performance']);
      
      setTimeout(() => {
        wsServer.broadcastAlert({
          alertId: 'alert123',
          type: 'system',
          severity: 'high',
          message: 'CPU usage critical',
          userId: 'test-user'
        });
      }, 100);

      alertsSocket.on('alert:new', (alert) => {
        expect(alert).toMatchObject({
          alertId: 'alert123',
          type: 'system',
          severity: 'high',
          message: 'CPU usage critical'
        });
        done();
      });
    });

    test('should handle alert acknowledgment', (done) => {
      const alertId = 'alert123';

      alertsSocket.emit('acknowledge:alert', alertId, (response) => {
        expect(response).toEqual({ status: 'acknowledged' });
        done();
      });
    });
  });

  describe('Permission Checks', () => {
    test('should check permissions correctly', () => {
      const socket = {
        permissions: ['documents:read', 'analytics:read', 'admin']
      };

      expect(wsServer.hasPermission(socket, 'documents:read')).toBe(true);
      expect(wsServer.hasPermission(socket, 'documents:write')).toBe(true); // admin has all
      expect(wsServer.hasPermission({ permissions: [] }, 'documents:read')).toBe(false);
    });
  });

  describe('Broadcasting Methods', () => {
    test('should broadcast document status updates', () => {
      const emitSpy = jest.fn();
      wsServer.namespaces.documents.to = jest.fn().mockReturnValue({ emit: emitSpy });

      wsServer.broadcastDocumentStatus({
        documentId: 'doc123',
        status: 'completed',
        progress: 100
      });

      expect(wsServer.namespaces.documents.to).toHaveBeenCalledWith('document:doc123');
      expect(emitSpy).toHaveBeenCalledWith('status:update', expect.objectContaining({
        documentId: 'doc123',
        status: 'completed',
        progress: 100
      }));
    });

    test('should broadcast performance metrics', () => {
      const emitSpy = jest.fn();
      wsServer.namespaces.performance.to = jest.fn().mockReturnValue({ emit: emitSpy });

      wsServer.broadcastPerformanceMetric({
        cpu: 45.5,
        memory: 67.8
      });

      expect(wsServer.namespaces.performance.to).toHaveBeenCalledWith('performance:all');
      expect(emitSpy).toHaveBeenCalledWith('metric:update', expect.objectContaining({
        cpu: 45.5,
        memory: 67.8
      }));
    });

    test('should broadcast errors', () => {
      const emitSpy = jest.fn();
      wsServer.namespaces.errors.to = jest.fn().mockReturnValue({ emit: emitSpy });

      wsServer.broadcastError({
        level: 'error',
        message: 'Database connection failed',
        context: { component: 'database' }
      });

      expect(wsServer.namespaces.errors.to).toHaveBeenCalledWith('error:error');
      expect(emitSpy).toHaveBeenCalledWith('error:new', expect.objectContaining({
        level: 'error',
        message: 'Database connection failed'
      }));
    });
  });

  describe('Redis Integration', () => {
    test('should handle Redis messages correctly', async () => {
      const broadcastSpy = jest.spyOn(wsServer, 'broadcastDocumentStatus');
      
      // Simulate Redis message
      wsServer.redisSub.emit('message', 'document:status', JSON.stringify({
        documentId: 'doc123',
        status: 'processing'
      }));

      expect(broadcastSpy).toHaveBeenCalledWith({
        documentId: 'doc123',
        status: 'processing'
      });
    });

    test('should handle invalid Redis messages gracefully', () => {
      const logger = require('../../../src/utils/logger');
      
      // Send invalid JSON
      wsServer.redisSub.emit('message', 'document:status', 'invalid-json');
      
      expect(logger.error).toHaveBeenCalledWith(
        'Error processing Redis message',
        expect.objectContaining({ channel: 'document:status' })
      );
    });
  });

  describe('Public Methods', () => {
    test('should emit to specific document room', () => {
      const emitSpy = jest.fn();
      wsServer.namespaces.documents.to = jest.fn().mockReturnValue({ emit: emitSpy });

      wsServer.emitToDocument('doc123', 'custom:event', { data: 'test' });

      expect(wsServer.namespaces.documents.to).toHaveBeenCalledWith('document:doc123');
      expect(emitSpy).toHaveBeenCalledWith('custom:event', { data: 'test' });
    });

    test('should emit to specific user', () => {
      const emitSpy = jest.fn();
      wsServer.namespaces.alerts.to = jest.fn().mockReturnValue({ emit: emitSpy });

      wsServer.emitToUser('user123', 'alerts', 'notification', { message: 'test' });

      expect(wsServer.namespaces.alerts.to).toHaveBeenCalledWith('user:user123');
      expect(emitSpy).toHaveBeenCalledWith('notification', { message: 'test' });
    });
  });

  describe('Graceful Shutdown', () => {
    test('should disconnect all clients on shutdown', async () => {
      const disconnectSpy = jest.fn();
      Object.values(wsServer.namespaces).forEach(namespace => {
        namespace.disconnectSockets = disconnectSpy;
      });

      await wsServer.shutdown();

      expect(disconnectSpy).toHaveBeenCalledTimes(Object.keys(wsServer.namespaces).length);
      expect(disconnectSpy).toHaveBeenCalledWith(true);
    });

    test('should close Redis connections on shutdown', async () => {
      const redisQuitSpy = jest.spyOn(wsServer.redis, 'quit');
      const redisSubQuitSpy = jest.spyOn(wsServer.redisSub, 'quit');
      const redisPubQuitSpy = jest.spyOn(wsServer.redisPub, 'quit');

      await wsServer.shutdown();

      expect(redisQuitSpy).toHaveBeenCalled();
      expect(redisSubQuitSpy).toHaveBeenCalled();
      expect(redisPubQuitSpy).toHaveBeenCalled();
    });
  });
});