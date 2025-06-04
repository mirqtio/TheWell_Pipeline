/**
 * AlertManager Unit Tests
 */

const AlertManager = require('../../../src/monitoring/AlertManager');

describe('AlertManager', () => {
  let alertManager;

  beforeEach(() => {
    alertManager = new AlertManager({
      enableNotifications: false, // Disable for testing
      escalationTimeouts: {
        warning: 1000, // 1 second for testing
        critical: 500   // 0.5 seconds for testing
      }
    });
  });

  afterEach(async () => {
    if (alertManager) {
      await alertManager.shutdown();
    }
  });

  describe('Initialization', () => {
    it('should initialize with default configuration', () => {
      const defaultManager = new AlertManager();
      expect(defaultManager.config.enableNotifications).toBe(true);
      expect(defaultManager.config.retryAttempts).toBe(3);
    });

    it('should initialize with custom configuration', () => {
      expect(alertManager.config.enableNotifications).toBe(false);
      expect(alertManager.config.escalationTimeouts.warning).toBe(1000);
    });

    it('should initialize empty state', () => {
      expect(alertManager.activeAlerts.size).toBe(0);
      expect(alertManager.alertHistory).toHaveLength(0);
      expect(alertManager.stats.totalAlerts).toBe(0);
    });
  });

  describe('Alert Creation', () => {
    beforeEach(async () => {
      await alertManager.initialize();
    });

    it('should create alert successfully', () => {
      const alert = alertManager.createAlert(
        'test_alert',
        'warning',
        'Test Alert',
        'This is a test alert',
        { source: 'test' }
      );

      expect(alert.id).toBeDefined();
      expect(alert.type).toBe('test_alert');
      expect(alert.severity).toBe('warning');
      expect(alert.title).toBe('Test Alert');
      expect(alert.description).toBe('This is a test alert');
      expect(alert.metadata.source).toBe('test');
      expect(alert.status).toBe('active');
      expect(alert.createdAt).toBeInstanceOf(Date);
    });

    it('should add alert to active alerts', () => {
      const alert = alertManager.createAlert('test', 'info', 'Test', 'Description');
      
      expect(alertManager.activeAlerts.has(alert.id)).toBe(true);
      expect(alertManager.activeAlerts.get(alert.id)).toEqual(alert);
    });

    it('should add alert to history', () => {
      const alert = alertManager.createAlert('test', 'info', 'Test', 'Description');
      
      expect(alertManager.alertHistory).toHaveLength(1);
      expect(alertManager.alertHistory[0].id).toBe(alert.id);
    });

    it('should update statistics', () => {
      alertManager.createAlert('test', 'warning', 'Test 1', 'Description 1');
      alertManager.createAlert('test', 'critical', 'Test 2', 'Description 2');
      alertManager.createAlert('other', 'warning', 'Test 3', 'Description 3');

      expect(alertManager.stats.totalAlerts).toBe(3);
      expect(alertManager.stats.alertsByType.get('test')).toBe(2);
      expect(alertManager.stats.alertsByType.get('other')).toBe(1);
      expect(alertManager.stats.alertsBySeverity.get('warning')).toBe(2);
      expect(alertManager.stats.alertsBySeverity.get('critical')).toBe(1);
    });

    it('should emit alert_created event', (done) => {
      alertManager.on('alert_created', (alert) => {
        expect(alert.title).toBe('Test Alert');
        done();
      });

      alertManager.createAlert('test', 'info', 'Test Alert', 'Description');
    });
  });

  describe('Alert Management', () => {
    let alertId;

    beforeEach(async () => {
      await alertManager.initialize();
      const alert = alertManager.createAlert('test', 'warning', 'Test Alert', 'Description');
      alertId = alert.id;
    });

    it('should acknowledge alert', () => {
      const alert = alertManager.acknowledgeAlert(alertId, 'test-user');
      
      expect(alert.status).toBe('acknowledged');
      expect(alert.acknowledgedAt).toBeInstanceOf(Date);
      expect(alert.acknowledgedBy).toBe('test-user');
      expect(alert.updatedAt).toBeInstanceOf(Date);
    });

    it('should emit alert_acknowledged event', (done) => {
      alertManager.on('alert_acknowledged', (alert) => {
        expect(alert.id).toBe(alertId);
        done();
      });

      alertManager.acknowledgeAlert(alertId);
    });

    it('should resolve alert', () => {
      const alert = alertManager.resolveAlert(alertId, 'test-user', 'Fixed the issue');
      
      expect(alert.status).toBe('resolved');
      expect(alert.resolvedAt).toBeInstanceOf(Date);
      expect(alert.resolvedBy).toBe('test-user');
      expect(alert.resolution).toBe('Fixed the issue');
      expect(alertManager.activeAlerts.has(alertId)).toBe(false);
    });

    it('should emit alert_resolved event', (done) => {
      alertManager.on('alert_resolved', (alert) => {
        expect(alert.id).toBe(alertId);
        done();
      });

      alertManager.resolveAlert(alertId);
    });

    it('should throw error for non-existent alert', () => {
      expect(() => {
        alertManager.acknowledgeAlert('non-existent');
      }).toThrow('Alert not found: non-existent');

      expect(() => {
        alertManager.resolveAlert('non-existent');
      }).toThrow('Alert not found: non-existent');
    });
  });

  describe('Notification Channel Selection', () => {
    beforeEach(async () => {
      alertManager.config.notificationChannels = [
        {
          type: 'console',
          severityFilter: ['critical', 'warning']
        },
        {
          type: 'email',
          severityFilter: ['critical'],
          typeFilter: ['system_error']
        },
        {
          type: 'slack',
          timeFilter: { startHour: 9, endHour: 17 }
        }
      ];
      await alertManager.initialize();
    });

    it('should select channels based on severity filter', () => {
      const criticalAlert = { severity: 'critical', type: 'test' };
      const warningAlert = { severity: 'warning', type: 'test' };
      const infoAlert = { severity: 'info', type: 'test' };

      expect(alertManager.shouldNotifyChannel(
        alertManager.config.notificationChannels[0], 
        criticalAlert
      )).toBe(true);
      
      expect(alertManager.shouldNotifyChannel(
        alertManager.config.notificationChannels[0], 
        warningAlert
      )).toBe(true);
      
      expect(alertManager.shouldNotifyChannel(
        alertManager.config.notificationChannels[0], 
        infoAlert
      )).toBe(false);
    });

    it('should select channels based on type filter', () => {
      const systemErrorAlert = { severity: 'critical', type: 'system_error' };
      const testAlert = { severity: 'critical', type: 'test' };

      expect(alertManager.shouldNotifyChannel(
        alertManager.config.notificationChannels[1], 
        systemErrorAlert
      )).toBe(true);
      
      expect(alertManager.shouldNotifyChannel(
        alertManager.config.notificationChannels[1], 
        testAlert
      )).toBe(false);
    });
  });

  describe('Escalation', () => {
    beforeEach(async () => {
      await alertManager.initialize();
    });

    it('should set escalation timer for critical alerts', (done) => {
      const alert = alertManager.createAlert('test', 'critical', 'Critical Test', 'Description');
      
      expect(alertManager.escalationTimers.has(alert.id)).toBe(true);
      
      // Listen for escalation
      alertManager.on('alert_escalated', (escalatedAlert) => {
        expect(escalatedAlert.id).toBe(alert.id);
        expect(escalatedAlert.escalationLevel).toBe(1);
        done();
      });
    });

    it('should clear escalation timer when alert is acknowledged', () => {
      const alert = alertManager.createAlert('test', 'critical', 'Critical Test', 'Description');
      expect(alertManager.escalationTimers.has(alert.id)).toBe(true);
      
      alertManager.acknowledgeAlert(alert.id);
      expect(alertManager.escalationTimers.has(alert.id)).toBe(false);
    });

    it('should clear escalation timer when alert is resolved', () => {
      const alert = alertManager.createAlert('test', 'critical', 'Critical Test', 'Description');
      expect(alertManager.escalationTimers.has(alert.id)).toBe(true);
      
      alertManager.resolveAlert(alert.id);
      expect(alertManager.escalationTimers.has(alert.id)).toBe(false);
    });
  });

  describe('Integration', () => {
    beforeEach(async () => {
      await alertManager.initialize();
    });

    it('should integrate with cost tracker', () => {
      const mockCostTracker = {
        on: jest.fn()
      };

      alertManager.integrateWithCostTracker(mockCostTracker);
      
      expect(mockCostTracker.on).toHaveBeenCalledWith('budget_threshold_exceeded', expect.any(Function));
      expect(mockCostTracker.on).toHaveBeenCalledWith('cost_anomaly_detected', expect.any(Function));
    });

    it('should integrate with quality metrics', () => {
      const mockQualityMetrics = {
        on: jest.fn()
      };

      alertManager.integrateWithQualityMetrics(mockQualityMetrics);
      
      expect(mockQualityMetrics.on).toHaveBeenCalledWith('slo_violation', expect.any(Function));
      expect(mockQualityMetrics.on).toHaveBeenCalledWith('error_rate_high', expect.any(Function));
    });

    it('should handle missing integrations gracefully', () => {
      expect(() => {
        alertManager.integrateWithCostTracker(null);
        alertManager.integrateWithQualityMetrics(undefined);
      }).not.toThrow();
    });
  });

  describe('Query Methods', () => {
    beforeEach(async () => {
      await alertManager.initialize();
      
      // Create test alerts
      alertManager.createAlert('test1', 'critical', 'Critical Alert', 'Description');
      alertManager.createAlert('test2', 'warning', 'Warning Alert', 'Description');
      alertManager.createAlert('test1', 'info', 'Info Alert', 'Description');
    });

    it('should get active alerts sorted by severity and time', () => {
      const alerts = alertManager.getActiveAlerts();
      
      expect(alerts).toHaveLength(3);
      expect(alerts[0].severity).toBe('critical');
      expect(alerts[1].severity).toBe('warning');
      expect(alerts[2].severity).toBe('info');
    });

    it('should filter active alerts by severity', () => {
      const criticalAlerts = alertManager.getActiveAlerts({ severity: 'critical' });
      expect(criticalAlerts).toHaveLength(1);
      expect(criticalAlerts[0].severity).toBe('critical');
    });

    it('should filter active alerts by type', () => {
      const test1Alerts = alertManager.getActiveAlerts({ type: 'test1' });
      expect(test1Alerts).toHaveLength(2);
      expect(test1Alerts.every(alert => alert.type === 'test1')).toBe(true);
    });

    it('should get alert history', () => {
      const history = alertManager.getAlertHistory();
      expect(history).toHaveLength(3);
    });

    it('should limit alert history', () => {
      const history = alertManager.getAlertHistory(2);
      expect(history).toHaveLength(2);
    });

    it('should get statistics', () => {
      const stats = alertManager.getStatistics();
      
      expect(stats.totalAlerts).toBe(3);
      expect(stats.activeAlertsCount).toBe(3);
      expect(stats.alertsByType.test1).toBe(2);
      expect(stats.alertsByType.test2).toBe(1);
      expect(stats.alertsBySeverity.critical).toBe(1);
      expect(stats.alertsBySeverity.warning).toBe(1);
      expect(stats.alertsBySeverity.info).toBe(1);
    });
  });

  describe('Status and Health', () => {
    it('should return status when not initialized', () => {
      const status = alertManager.getStatus();
      expect(status.initialized).toBe(false);
      expect(status.activeAlerts).toBe(0);
    });

    it('should return status when initialized', async () => {
      await alertManager.initialize();
      alertManager.createAlert('test', 'info', 'Test', 'Description');
      
      const status = alertManager.getStatus();
      expect(status.initialized).toBe(true);
      expect(status.activeAlerts).toBe(1);
      expect(status.config.enableNotifications).toBe(false);
    });
  });

  describe('Utility Methods', () => {
    it('should generate unique alert IDs', () => {
      const id1 = alertManager.generateAlertId();
      const id2 = alertManager.generateAlertId();
      
      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^alert_\d+_[a-z0-9]+$/);
    });

    it('should generate unique notification IDs', () => {
      const id1 = alertManager.generateNotificationId();
      const id2 = alertManager.generateNotificationId();
      
      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^notif_\d+_[a-z0-9]+$/);
    });
  });

  describe('Shutdown', () => {
    it('should shutdown gracefully', async () => {
      await alertManager.initialize();
      expect(alertManager.isInitialized).toBe(true);
      
      await alertManager.shutdown();
      expect(alertManager.isInitialized).toBe(false);
    });

    it('should clear timers on shutdown', async () => {
      await alertManager.initialize();
      
      // Create critical alert to set escalation timer
      const alert = alertManager.createAlert('test', 'critical', 'Test', 'Description');
      expect(alertManager.escalationTimers.has(alert.id)).toBe(true);
      
      await alertManager.shutdown();
      expect(alertManager.escalationTimers.size).toBe(0);
    });
  });
});