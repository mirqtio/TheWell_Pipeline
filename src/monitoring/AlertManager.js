/**
 * Alert Manager
 * Handles alert routing, notification, and escalation
 */

const EventEmitter = require('events');
const logger = require('../utils/logger');

class AlertManager extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      enableNotifications: config.enableNotifications !== false,
      escalationTimeouts: {
        warning: config.warningEscalationTimeout || 30 * 60 * 1000, // 30 minutes
        critical: config.criticalEscalationTimeout || 10 * 60 * 1000 // 10 minutes
      },
      notificationChannels: config.notificationChannels || [],
      retryAttempts: config.retryAttempts || 3,
      retryDelay: config.retryDelay || 5000,
      ...config
    };

    // Alert state tracking
    this.activeAlerts = new Map();
    this.alertHistory = [];
    this.escalationTimers = new Map();
    this.notificationQueue = [];
    
    // Statistics
    this.stats = {
      totalAlerts: 0,
      alertsByType: new Map(),
      alertsBySeverity: new Map(),
      notificationsSent: 0,
      notificationFailures: 0
    };

    this.isInitialized = false;
    this.processingTimer = null;
  }

  async initialize() {
    try {
      logger.info('Initializing Alert Manager...');
      
      // Start alert processing
      this.startAlertProcessing();
      
      this.isInitialized = true;
      logger.info('Alert Manager initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Alert Manager:', error);
      throw error;
    }
  }

  // Alert creation and management
  createAlert(alertType, severity, title, description, metadata = {}) {
    const alert = {
      id: this.generateAlertId(),
      type: alertType,
      severity,
      title,
      description,
      metadata,
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
      acknowledgedAt: null,
      resolvedAt: null,
      notificationsSent: 0,
      escalationLevel: 0
    };

    this.activeAlerts.set(alert.id, alert);
    this.alertHistory.push({ ...alert });
    
    // Update statistics
    this.stats.totalAlerts++;
    this.stats.alertsByType.set(alertType, (this.stats.alertsByType.get(alertType) || 0) + 1);
    this.stats.alertsBySeverity.set(severity, (this.stats.alertsBySeverity.get(severity) || 0) + 1);

    // Queue notification
    this.queueNotification(alert);
    
    // Set escalation timer for critical alerts
    if (severity === 'critical') {
      this.setEscalationTimer(alert);
    }

    // Emit event
    this.emit('alert_created', alert);
    
    logger.info(`Alert created: ${alert.id} - ${title} (${severity})`);
    return alert;
  }

  acknowledgeAlert(alertId, acknowledgedBy = 'system') {
    const alert = this.activeAlerts.get(alertId);
    if (!alert) {
      throw new Error(`Alert not found: ${alertId}`);
    }

    alert.status = 'acknowledged';
    alert.acknowledgedAt = new Date();
    alert.acknowledgedBy = acknowledgedBy;
    alert.updatedAt = new Date();

    // Clear escalation timer
    this.clearEscalationTimer(alertId);

    this.emit('alert_acknowledged', alert);
    logger.info(`Alert acknowledged: ${alertId} by ${acknowledgedBy}`);
    
    return alert;
  }

  resolveAlert(alertId, resolvedBy = 'system', resolution = '') {
    const alert = this.activeAlerts.get(alertId);
    if (!alert) {
      throw new Error(`Alert not found: ${alertId}`);
    }

    alert.status = 'resolved';
    alert.resolvedAt = new Date();
    alert.resolvedBy = resolvedBy;
    alert.resolution = resolution;
    alert.updatedAt = new Date();

    // Remove from active alerts
    this.activeAlerts.delete(alertId);
    
    // Clear escalation timer
    this.clearEscalationTimer(alertId);

    this.emit('alert_resolved', alert);
    logger.info(`Alert resolved: ${alertId} by ${resolvedBy}`);
    
    return alert;
  }

  // Notification handling
  queueNotification(alert) {
    if (!this.config.enableNotifications) {
      return;
    }

    const notification = {
      id: this.generateNotificationId(),
      alertId: alert.id,
      alert,
      channels: this.selectNotificationChannels(alert),
      attempts: 0,
      maxAttempts: this.config.retryAttempts,
      scheduledAt: new Date(),
      status: 'pending'
    };

    this.notificationQueue.push(notification);
  }

  selectNotificationChannels(alert) {
    // Select channels based on severity and alert type
    const channels = [];
    
    for (const channel of this.config.notificationChannels) {
      if (this.shouldNotifyChannel(channel, alert)) {
        channels.push(channel);
      }
    }
    
    return channels;
  }

  shouldNotifyChannel(channel, alert) {
    // Check severity filter
    if (channel.severityFilter && !channel.severityFilter.includes(alert.severity)) {
      return false;
    }
    
    // Check alert type filter
    if (channel.typeFilter && !channel.typeFilter.includes(alert.type)) {
      return false;
    }
    
    // Check time-based filters
    if (channel.timeFilter) {
      const now = new Date();
      const hour = now.getHours();
      
      if (hour < channel.timeFilter.startHour || hour > channel.timeFilter.endHour) {
        return false;
      }
    }
    
    return true;
  }

  async sendNotification(notification) {
    try {
      notification.attempts++;
      notification.lastAttemptAt = new Date();

      for (const channel of notification.channels) {
        await this.sendToChannel(channel, notification);
      }

      notification.status = 'sent';
      notification.sentAt = new Date();
      
      // Update alert notification count
      const alert = this.activeAlerts.get(notification.alertId);
      if (alert) {
        alert.notificationsSent++;
      }

      this.stats.notificationsSent++;
      this.emit('notification_sent', notification);
      
    } catch (error) {
      logger.error(`Failed to send notification ${notification.id}:`, error);
      
      notification.status = 'failed';
      notification.error = error.message;
      
      this.stats.notificationFailures++;
      
      // Retry if attempts remaining
      if (notification.attempts < notification.maxAttempts) {
        notification.status = 'pending';
        notification.scheduledAt = new Date(Date.now() + this.config.retryDelay);
      }
    }
  }

  async sendToChannel(channel, notification) {
    switch (channel.type) {
    case 'webhook':
      return this.sendWebhookNotification(channel, notification);
    case 'email':
      return this.sendEmailNotification(channel, notification);
    case 'slack':
      return this.sendSlackNotification(channel, notification);
    case 'console':
      return this.sendConsoleNotification(channel, notification);
    default:
      throw new Error(`Unsupported notification channel type: ${channel.type}`);
    }
  }

  async sendWebhookNotification(channel, notification) {
    const payload = {
      alert: notification.alert,
      timestamp: new Date().toISOString(),
      severity: notification.alert.severity,
      type: notification.alert.type
    };

    // Implementation would use HTTP client to send webhook
    logger.info(`Webhook notification sent to ${channel.url}: ${notification.alert.title}`, { payload });
  }

  async sendEmailNotification(channel, notification) {
    // Implementation would use email service
    logger.info(`Email notification sent to ${channel.recipients.join(', ')}: ${notification.alert.title}`);
  }

  async sendSlackNotification(channel, notification) {
    // Implementation would use Slack API
    logger.info(`Slack notification sent to ${channel.channel}: ${notification.alert.title}`);
  }

  async sendConsoleNotification(channel, notification) {
    const { alert } = notification;
    const timestamp = new Date().toISOString();
    
    logger.info(`\n🚨 ALERT [${alert.severity.toUpperCase()}] - ${timestamp}`);
    logger.info(`📋 ${alert.title}`);
    logger.info(`📄 ${alert.description}`);
    if (Object.keys(alert.metadata).length > 0) {
      logger.info(`🔍 Metadata: ${JSON.stringify(alert.metadata, null, 2)}`);
    }
    logger.info('─'.repeat(50));
  }

  // Escalation handling
  setEscalationTimer(alert) {
    const timeout = this.config.escalationTimeouts[alert.severity] || this.config.escalationTimeouts.warning;
    
    const timer = setTimeout(() => {
      this.escalateAlert(alert.id);
    }, timeout);
    
    this.escalationTimers.set(alert.id, timer);
  }

  clearEscalationTimer(alertId) {
    const timer = this.escalationTimers.get(alertId);
    if (timer) {
      clearTimeout(timer);
      this.escalationTimers.delete(alertId);
    }
  }

  escalateAlert(alertId) {
    const alert = this.activeAlerts.get(alertId);
    if (!alert || alert.status !== 'active') {
      return;
    }

    alert.escalationLevel++;
    alert.updatedAt = new Date();

    // Create escalation alert
    this.createAlert(
      'escalation',
      'critical',
      `Alert Escalation: ${alert.title}`,
      `Alert ${alertId} has been escalated (level ${alert.escalationLevel}) - ${alert.description}`,
      {
        originalAlertId: alertId,
        escalationLevel: alert.escalationLevel,
        originalSeverity: alert.severity
      }
    );

    this.emit('alert_escalated', alert);
  }

  // Processing loop
  startAlertProcessing() {
    this.processingTimer = setInterval(() => {
      this.processNotificationQueue();
    }, 5000); // Process every 5 seconds
  }

  processNotificationQueue() {
    const now = new Date();
    const readyNotifications = this.notificationQueue.filter(
      notification => notification.status === 'pending' && notification.scheduledAt <= now
    );

    for (const notification of readyNotifications) {
      this.sendNotification(notification).catch(error => {
        logger.error('Error processing notification:', error);
      });
    }

    // Clean up completed notifications
    this.notificationQueue = this.notificationQueue.filter(
      notification => notification.status === 'pending'
    );
  }

  // Integration methods
  integrateWithCostTracker(costTracker) {
    if (!costTracker) return;

    costTracker.on('budget_threshold_exceeded', (event) => {
      this.createAlert(
        'budget_threshold',
        event.percentage >= 100 ? 'critical' : 'warning',
        `Budget Threshold Exceeded: ${event.budgetName}`,
        `Budget ${event.budgetName} is at ${event.percentage.toFixed(1)}% utilization ($${event.currentSpend}/$${event.budgetAmount})`,
        event
      );
    });

    costTracker.on('cost_anomaly_detected', (event) => {
      this.createAlert(
        'cost_anomaly',
        'warning',
        'Cost Anomaly Detected',
        `Unusual cost pattern detected: ${event.description}`,
        event
      );
    });
  }

  integrateWithQualityMetrics(qualityMetrics) {
    if (!qualityMetrics) return;

    qualityMetrics.on('slo_violation', (event) => {
      this.createAlert(
        'slo_violation',
        event.severity || 'warning',
        `SLO Violation: ${event.sloName}`,
        `SLO ${event.sloName} is at ${event.compliance.toFixed(1)}% compliance (target: ${event.target}%)`,
        event
      );
    });

    qualityMetrics.on('error_rate_high', (event) => {
      this.createAlert(
        'high_error_rate',
        event.rate > 10 ? 'critical' : 'warning',
        'High Error Rate Detected',
        `Error rate is ${event.rate.toFixed(1)}% for ${event.service}/${event.endpoint}`,
        event
      );
    });
  }

  // Utility methods
  generateAlertId() {
    return `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  generateNotificationId() {
    return `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Query methods
  getActiveAlerts(filters = {}) {
    let alerts = Array.from(this.activeAlerts.values());
    
    if (filters.severity) {
      alerts = alerts.filter(alert => alert.severity === filters.severity);
    }
    
    if (filters.type) {
      alerts = alerts.filter(alert => alert.type === filters.type);
    }
    
    return alerts.sort((a, b) => {
      // Sort by severity (critical > warning > info) then by creation time
      const severityOrder = { critical: 3, warning: 2, info: 1 };
      const severityDiff = (severityOrder[b.severity] || 0) - (severityOrder[a.severity] || 0);
      return severityDiff !== 0 ? severityDiff : b.createdAt - a.createdAt;
    });
  }

  getAlertHistory(limit = 100) {
    return this.alertHistory
      .slice(-limit)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  getStatistics() {
    return {
      ...this.stats,
      activeAlertsCount: this.activeAlerts.size,
      queuedNotifications: this.notificationQueue.length,
      alertsByType: Object.fromEntries(this.stats.alertsByType),
      alertsBySeverity: Object.fromEntries(this.stats.alertsBySeverity)
    };
  }

  getStatus() {
    return {
      initialized: this.isInitialized,
      activeAlerts: this.activeAlerts.size,
      queuedNotifications: this.notificationQueue.length,
      statistics: this.getStatistics(),
      config: {
        enableNotifications: this.config.enableNotifications,
        notificationChannels: this.config.notificationChannels.length
      }
    };
  }

  async shutdown() {
    try {
      logger.info('Shutting down Alert Manager...');
      
      // Clear timers
      if (this.processingTimer) {
        clearInterval(this.processingTimer);
      }
      
      for (const timer of this.escalationTimers.values()) {
        clearTimeout(timer);
      }
      this.escalationTimers.clear();
      
      this.isInitialized = false;
      logger.info('Alert Manager shutdown complete');
    } catch (error) {
      logger.error('Error during Alert Manager shutdown:', error);
      throw error;
    }
  }
}

module.exports = AlertManager;