const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const Redis = require('ioredis');
const logger = require('../utils/logger');

class WebSocketServer {
  constructor(httpServer, options = {}) {
    this.io = new Server(httpServer, {
      cors: {
        origin: process.env.CORS_ORIGIN || '*',
        credentials: true
      },
      transports: ['websocket', 'polling'],
      ...options
    });

    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      retryStrategy: (times) => Math.min(times * 50, 2000)
    });

    this.redisSub = this.redis.duplicate();
    this.redisPub = this.redis.duplicate();

    // Namespaces for different data streams
    this.namespaces = {
      documents: this.io.of('/documents'),
      analytics: this.io.of('/analytics'),
      alerts: this.io.of('/alerts'),
      performance: this.io.of('/performance'),
      activity: this.io.of('/activity'),
      errors: this.io.of('/errors')
    };

    this.setupMiddleware();
    this.setupEventHandlers();
    this.setupRedisListeners();
  }

  setupMiddleware() {
    // Authentication middleware for all namespaces
    Object.values(this.namespaces).forEach(namespace => {
      namespace.use(async (socket, next) => {
        try {
          const token = socket.handshake.auth.token;
          if (!token) {
            return next(new Error('Authentication required'));
          }

          const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
          socket.userId = decoded.userId;
          socket.permissions = decoded.permissions || [];
          
          logger.info('WebSocket client authenticated', {
            userId: socket.userId,
            namespace: namespace.name
          });
          
          next();
        } catch (err) {
          logger.error('WebSocket authentication failed', err);
          next(new Error('Authentication failed'));
        }
      });
    });
  }

  setupEventHandlers() {
    // Document processing namespace
    this.namespaces.documents.on('connection', (socket) => {
      logger.info('Client connected to documents namespace', { userId: socket.userId });

      socket.on('subscribe:document', async (documentId) => {
        if (this.hasPermission(socket, 'documents:read')) {
          socket.join(`document:${documentId}`);
          logger.info('Client subscribed to document updates', { documentId, userId: socket.userId });
        }
      });

      socket.on('unsubscribe:document', (documentId) => {
        socket.leave(`document:${documentId}`);
      });

      socket.on('disconnect', () => {
        logger.info('Client disconnected from documents namespace', { userId: socket.userId });
      });
    });

    // Analytics namespace
    this.namespaces.analytics.on('connection', (socket) => {
      logger.info('Client connected to analytics namespace', { userId: socket.userId });

      socket.on('subscribe:metrics', async (metrics) => {
        if (this.hasPermission(socket, 'analytics:read')) {
          metrics.forEach(metric => socket.join(`metric:${metric}`));
          logger.info('Client subscribed to metrics', { metrics, userId: socket.userId });
        }
      });

      socket.on('query:realtime', async (query, callback) => {
        if (this.hasPermission(socket, 'analytics:read')) {
          try {
            // This will be handled by AnalyticsEngine
            this.redisPub.publish('analytics:query', JSON.stringify({
              userId: socket.userId,
              query,
              timestamp: Date.now()
            }));
            callback({ status: 'processing' });
          } catch (error) {
            callback({ status: 'error', message: error.message });
          }
        }
      });
    });

    // Alerts namespace
    this.namespaces.alerts.on('connection', (socket) => {
      logger.info('Client connected to alerts namespace', { userId: socket.userId });

      socket.on('subscribe:alerts', async (alertTypes) => {
        if (this.hasPermission(socket, 'alerts:read')) {
          socket.join(`alerts:${socket.userId}`);
          if (alertTypes && alertTypes.length > 0) {
            alertTypes.forEach(type => socket.join(`alert:${type}`));
          }
        }
      });

      socket.on('acknowledge:alert', async (alertId, callback) => {
        if (this.hasPermission(socket, 'alerts:write')) {
          this.redisPub.publish('alert:acknowledge', JSON.stringify({
            alertId,
            userId: socket.userId,
            timestamp: Date.now()
          }));
          callback({ status: 'acknowledged' });
        }
      });
    });

    // Performance namespace
    this.namespaces.performance.on('connection', (socket) => {
      logger.info('Client connected to performance namespace', { userId: socket.userId });

      socket.on('subscribe:metrics', async () => {
        if (this.hasPermission(socket, 'performance:read')) {
          socket.join('performance:all');
        }
      });
    });

    // Activity namespace
    this.namespaces.activity.on('connection', (socket) => {
      logger.info('Client connected to activity namespace', { userId: socket.userId });

      socket.on('subscribe:activity', async (scope) => {
        if (this.hasPermission(socket, 'activity:read')) {
          if (scope === 'personal') {
            socket.join(`activity:user:${socket.userId}`);
          } else if (scope === 'all' && this.hasPermission(socket, 'activity:read:all')) {
            socket.join('activity:all');
          }
        }
      });
    });

    // Error namespace
    this.namespaces.errors.on('connection', (socket) => {
      logger.info('Client connected to errors namespace', { userId: socket.userId });

      socket.on('subscribe:errors', async (errorLevels) => {
        if (this.hasPermission(socket, 'errors:read')) {
          errorLevels.forEach(level => socket.join(`error:${level}`));
        }
      });
    });
  }

  setupRedisListeners() {
    // Subscribe to Redis channels for broadcasting
    this.redisSub.subscribe(
      'document:status',
      'analytics:update',
      'alert:trigger',
      'performance:metric',
      'activity:log',
      'error:report'
    );

    this.redisSub.on('message', (channel, message) => {
      try {
        const data = JSON.parse(message);
        
        switch (channel) {
        case 'document:status':
          this.broadcastDocumentStatus(data);
          break;
        case 'analytics:update':
          this.broadcastAnalyticsUpdate(data);
          break;
        case 'alert:trigger':
          this.broadcastAlert(data);
          break;
        case 'performance:metric':
          this.broadcastPerformanceMetric(data);
          break;
        case 'activity:log':
          this.broadcastActivity(data);
          break;
        case 'error:report':
          this.broadcastError(data);
          break;
        }
      } catch (error) {
        logger.error('Error processing Redis message', { channel, error });
      }
    });
  }

  // Broadcasting methods
  broadcastDocumentStatus(data) {
    const { documentId, status, progress, metadata } = data;
    this.namespaces.documents
      .to(`document:${documentId}`)
      .emit('status:update', {
        documentId,
        status,
        progress,
        metadata,
        timestamp: Date.now()
      });
  }

  broadcastAnalyticsUpdate(data) {
    const { metric, value, aggregation, timeWindow } = data;
    this.namespaces.analytics
      .to(`metric:${metric}`)
      .emit('metric:update', {
        metric,
        value,
        aggregation,
        timeWindow,
        timestamp: Date.now()
      });
  }

  broadcastAlert(data) {
    const { alertId, type, severity, message, userId, metadata } = data;
    
    // Broadcast to specific user if userId is provided
    if (userId) {
      this.namespaces.alerts
        .to(`alerts:${userId}`)
        .emit('alert:new', {
          alertId,
          type,
          severity,
          message,
          metadata,
          timestamp: Date.now()
        });
    }
    
    // Also broadcast to alert type subscribers
    this.namespaces.alerts
      .to(`alert:${type}`)
      .emit('alert:new', {
        alertId,
        type,
        severity,
        message,
        metadata,
        timestamp: Date.now()
      });
  }

  broadcastPerformanceMetric(data) {
    this.namespaces.performance
      .to('performance:all')
      .emit('metric:update', {
        ...data,
        timestamp: Date.now()
      });
  }

  broadcastActivity(data) {
    const { userId, action, resource, metadata } = data;
    
    // Broadcast to specific user
    this.namespaces.activity
      .to(`activity:user:${userId}`)
      .emit('activity:new', {
        userId,
        action,
        resource,
        metadata,
        timestamp: Date.now()
      });
    
    // Broadcast to all activity subscribers
    this.namespaces.activity
      .to('activity:all')
      .emit('activity:new', {
        userId,
        action,
        resource,
        metadata,
        timestamp: Date.now()
      });
  }

  broadcastError(data) {
    const { level, message, stack, context } = data;
    this.namespaces.errors
      .to(`error:${level}`)
      .emit('error:new', {
        level,
        message,
        stack,
        context,
        timestamp: Date.now()
      });
  }

  // Utility methods
  hasPermission(socket, permission) {
    return socket.permissions.includes(permission) || 
           socket.permissions.includes('admin');
  }

  // Public methods for external use
  emitToDocument(documentId, event, data) {
    this.namespaces.documents
      .to(`document:${documentId}`)
      .emit(event, data);
  }

  emitToUser(userId, namespace, event, data) {
    if (this.namespaces[namespace]) {
      this.namespaces[namespace]
        .to(`user:${userId}`)
        .emit(event, data);
    }
  }

  // Graceful shutdown
  async shutdown() {
    logger.info('Shutting down WebSocket server...');
    
    // Close all namespace connections
    Object.values(this.namespaces).forEach(namespace => {
      namespace.disconnectSockets(true);
    });
    
    // Close Redis connections
    await this.redis.quit();
    await this.redisSub.quit();
    await this.redisPub.quit();
    
    // Close Socket.io server
    await new Promise((resolve) => {
      this.io.close(() => {
        logger.info('WebSocket server closed');
        resolve();
      });
    });
  }
}

module.exports = WebSocketServer;