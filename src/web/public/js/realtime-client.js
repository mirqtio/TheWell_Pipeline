/**
 * Real-time Analytics Client
 * Handles WebSocket connections and real-time data updates
 */

class RealtimeClient {
  constructor(options = {}) {
    this.socketUrl = options.socketUrl || window.location.origin;
    this.authToken = options.authToken || localStorage.getItem('auth_token');
    this.reconnectDelay = options.reconnectDelay || 1000;
    this.maxReconnectDelay = options.maxReconnectDelay || 30000;
    this.reconnectAttempts = 0;
    
    this.socket = null;
    this.namespaces = {};
    this.eventHandlers = new Map();
    this.connectionState = 'disconnected';
    
    // Auto-connect if auth token is available
    if (this.authToken) {
      this.connect();
    }
  }

  connect() {
    if (this.connectionState === 'connected' || this.connectionState === 'connecting') {
      return;
    }

    this.connectionState = 'connecting';
    
    // Load Socket.io library dynamically if not already loaded
    if (typeof io === 'undefined') {
      const script = document.createElement('script');
      script.src = '/socket.io/socket.io.js';
      script.onload = () => this.initializeConnection();
      document.head.appendChild(script);
    } else {
      this.initializeConnection();
    }
  }

  initializeConnection() {
    // Connect to main namespace first
    this.socket = io(this.socketUrl, {
      auth: {
        token: this.authToken
      },
      reconnection: true,
      reconnectionDelay: this.reconnectDelay,
      reconnectionDelayMax: this.maxReconnectDelay,
      transports: ['websocket', 'polling']
    });

    this.setupMainSocketHandlers();
    this.connectToNamespaces();
  }

  setupMainSocketHandlers() {
    this.socket.on('connect', () => {
      console.log('Connected to real-time server');
      this.connectionState = 'connected';
      this.reconnectAttempts = 0;
      this.emit('connection:established');
    });

    this.socket.on('disconnect', (reason) => {
      console.log('Disconnected from real-time server:', reason);
      this.connectionState = 'disconnected';
      this.emit('connection:lost', reason);
    });

    this.socket.on('connect_error', (error) => {
      console.error('Connection error:', error.message);
      this.connectionState = 'error';
      this.reconnectAttempts++;
      
      if (error.message === 'Authentication failed') {
        this.emit('auth:failed');
      }
    });

    this.socket.on('reconnect', (attemptNumber) => {
      console.log('Reconnected after', attemptNumber, 'attempts');
      this.emit('connection:reconnected', attemptNumber);
    });
  }

  connectToNamespaces() {
    const namespaceConfigs = [
      { name: 'documents', path: '/documents' },
      { name: 'analytics', path: '/analytics' },
      { name: 'alerts', path: '/alerts' },
      { name: 'performance', path: '/performance' },
      { name: 'activity', path: '/activity' },
      { name: 'errors', path: '/errors' }
    ];

    namespaceConfigs.forEach(config => {
      this.connectToNamespace(config.name, config.path);
    });
  }

  connectToNamespace(name, path) {
    const namespace = io(`${this.socketUrl}${path}`, {
      auth: {
        token: this.authToken
      }
    });

    namespace.on('connect', () => {
      console.log(`Connected to ${name} namespace`);
    });

    this.namespaces[name] = namespace;
    this.setupNamespaceHandlers(name, namespace);
  }

  setupNamespaceHandlers(name, namespace) {
    switch (name) {
      case 'documents':
        this.setupDocumentHandlers(namespace);
        break;
      case 'analytics':
        this.setupAnalyticsHandlers(namespace);
        break;
      case 'alerts':
        this.setupAlertHandlers(namespace);
        break;
      case 'performance':
        this.setupPerformanceHandlers(namespace);
        break;
      case 'activity':
        this.setupActivityHandlers(namespace);
        break;
      case 'errors':
        this.setupErrorHandlers(namespace);
        break;
    }
  }

  setupDocumentHandlers(namespace) {
    namespace.on('status:update', (data) => {
      this.emit('document:status', data);
      
      // Update UI if handler exists
      if (window.documentStatusHandler) {
        window.documentStatusHandler(data);
      }
    });
  }

  setupAnalyticsHandlers(namespace) {
    namespace.on('metric:update', (data) => {
      this.emit('analytics:metric', data);
      
      // Update charts if handler exists
      if (window.updateMetricChart) {
        window.updateMetricChart(data);
      }
    });
  }

  setupAlertHandlers(namespace) {
    namespace.on('alert:new', (data) => {
      this.emit('alert:received', data);
      
      // Show notification
      this.showAlertNotification(data);
    });
  }

  setupPerformanceHandlers(namespace) {
    namespace.on('metric:update', (data) => {
      this.emit('performance:update', data);
      
      // Update performance dashboard
      if (window.updatePerformanceMetrics) {
        window.updatePerformanceMetrics(data);
      }
    });
  }

  setupActivityHandlers(namespace) {
    namespace.on('activity:new', (data) => {
      this.emit('activity:update', data);
      
      // Update activity feed
      if (window.updateActivityFeed) {
        window.updateActivityFeed(data);
      }
    });
  }

  setupErrorHandlers(namespace) {
    namespace.on('error:new', (data) => {
      this.emit('error:reported', data);
      
      // Log to console in development
      if (window.location.hostname === 'localhost') {
        console.error('Real-time error:', data);
      }
    });
  }

  // Public API methods
  subscribeToDocument(documentId) {
    if (this.namespaces.documents) {
      this.namespaces.documents.emit('subscribe:document', documentId);
    }
  }

  unsubscribeFromDocument(documentId) {
    if (this.namespaces.documents) {
      this.namespaces.documents.emit('unsubscribe:document', documentId);
    }
  }

  subscribeToMetrics(metrics) {
    if (this.namespaces.analytics) {
      this.namespaces.analytics.emit('subscribe:metrics', metrics);
    }
  }

  queryRealtime(query, callback) {
    if (this.namespaces.analytics) {
      this.namespaces.analytics.emit('query:realtime', query, callback);
    }
  }

  subscribeToAlerts(alertTypes) {
    if (this.namespaces.alerts) {
      this.namespaces.alerts.emit('subscribe:alerts', alertTypes);
    }
  }

  acknowledgeAlert(alertId, callback) {
    if (this.namespaces.alerts) {
      this.namespaces.alerts.emit('acknowledge:alert', alertId, callback);
    }
  }

  subscribeToPerformance() {
    if (this.namespaces.performance) {
      this.namespaces.performance.emit('subscribe:metrics');
    }
  }

  subscribeToActivity(scope = 'personal') {
    if (this.namespaces.activity) {
      this.namespaces.activity.emit('subscribe:activity', scope);
    }
  }

  subscribeToErrors(errorLevels = ['error', 'warning']) {
    if (this.namespaces.errors) {
      this.namespaces.errors.emit('subscribe:errors', errorLevels);
    }
  }

  // Event handling
  on(event, handler) {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event).push(handler);
  }

  off(event, handler) {
    if (this.eventHandlers.has(event)) {
      const handlers = this.eventHandlers.get(event);
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  emit(event, data) {
    if (this.eventHandlers.has(event)) {
      this.eventHandlers.get(event).forEach(handler => {
        try {
          handler(data);
        } catch (error) {
          console.error('Error in event handler:', error);
        }
      });
    }
  }

  // UI helpers
  showAlertNotification(alert) {
    // Check if browser supports notifications
    if ('Notification' in window && Notification.permission === 'granted') {
      const notification = new Notification('System Alert', {
        body: alert.message,
        icon: '/img/alert-icon.png',
        tag: alert.alertId,
        requireInteraction: alert.severity === 'high'
      });

      notification.onclick = () => {
        window.focus();
        // Navigate to alerts page
        if (window.location.pathname !== '/alerts') {
          window.location.href = '/alerts';
        }
      };
    }

    // Also show in-app notification
    if (window.showToast) {
      window.showToast({
        type: alert.severity,
        message: alert.message,
        duration: alert.severity === 'high' ? 0 : 5000,
        action: {
          text: 'View',
          handler: () => this.acknowledgeAlert(alert.alertId, () => {})
        }
      });
    }
  }

  // Connection management
  disconnect() {
    Object.values(this.namespaces).forEach(namespace => {
      namespace.disconnect();
    });
    
    if (this.socket) {
      this.socket.disconnect();
    }
    
    this.connectionState = 'disconnected';
  }

  reconnect() {
    this.disconnect();
    setTimeout(() => this.connect(), 100);
  }

  updateAuthToken(token) {
    this.authToken = token;
    localStorage.setItem('auth_token', token);
    this.reconnect();
  }

  getConnectionState() {
    return this.connectionState;
  }

  isConnected() {
    return this.connectionState === 'connected';
  }
}

// Create global instance
window.realtimeClient = new RealtimeClient();

// Request notification permissions
if ('Notification' in window && Notification.permission === 'default') {
  Notification.requestPermission();
}