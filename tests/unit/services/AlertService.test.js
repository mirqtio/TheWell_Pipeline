const AlertService = require('../../../src/services/AlertService');
const AlertRulesEngine = require('../../../src/alerts/AlertRulesEngine');
const DatabaseManager = require('../../../src/database/DatabaseManager');

jest.mock('../../../src/alerts/AlertRulesEngine');
jest.mock('../../../src/database/DatabaseManager');

describe('AlertService', () => {
  let service;
  let mockDb;
  let mockEngine;
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    mockDb = {
      query: jest.fn(),
      connect: jest.fn().mockResolvedValue({}),
      release: jest.fn()
    };
    
    mockEngine = {
      createRule: jest.fn(),
      updateRule: jest.fn(),
      deleteRule: jest.fn(),
      evaluateRule: jest.fn(),
      evaluateAndExecute: jest.fn(),
      listRules: jest.fn(),
      exportRules: jest.fn(),
      importRules: jest.fn(),
      registerAction: jest.fn()
    };
    
    DatabaseManager.getInstance = jest.fn().mockReturnValue({
      getDatabase: jest.fn().mockReturnValue(mockDb)
    });
    
    AlertRulesEngine.mockImplementation(() => mockEngine);
    
    service = new AlertService();
  });
  
  describe('rule persistence', () => {
    it('should save rule to database when created', async () => {
      const ruleConfig = {
        name: 'Test Rule',
        type: 'threshold',
        conditions: { metric: 'cpu', operator: '>', value: 80 },
        actions: ['email'],
        severity: 'warning'
      };
      
      const mockRule = {
        id: 'test-uuid',
        ...ruleConfig,
        toJSON: jest.fn().mockReturnValue({ id: 'test-uuid', ...ruleConfig })
      };
      
      mockEngine.createRule.mockReturnValue(mockRule);
      mockDb.query.mockResolvedValue({ rows: [{ id: 'test-uuid' }] });
      
      const result = await service.createRule(ruleConfig, 1);
      
      expect(mockEngine.createRule).toHaveBeenCalledWith(ruleConfig);
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO alert_rules'),
        expect.arrayContaining(['test-uuid', 'Test Rule'])
      );
      expect(result).toEqual(mockRule);
    });
    
    it('should update rule in database', async () => {
      const updates = { name: 'Updated Rule', conditions: { metric: 'cpu', operator: '>', value: 90 } };
      const mockRule = {
        id: 'test-uuid',
        name: 'Updated Rule',
        toJSON: jest.fn().mockReturnValue({ id: 'test-uuid', name: 'Updated Rule' })
      };
      
      mockEngine.updateRule.mockReturnValue(mockRule);
      mockDb.query.mockResolvedValue({ rows: [{ id: 'test-uuid' }] });
      
      const result = await service.updateRule('test-uuid', updates);
      
      expect(mockEngine.updateRule).toHaveBeenCalledWith('test-uuid', updates);
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE alert_rules'),
        expect.arrayContaining(['Updated Rule'])
      );
    });
    
    it('should delete rule from database', async () => {
      mockEngine.deleteRule.mockReturnValue(true);
      mockDb.query.mockResolvedValue({ rowCount: 1 });
      
      const result = await service.deleteRule('test-uuid');
      
      expect(result).toBe(true);
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM alert_rules'),
        ['test-uuid']
      );
    });
    
    it('should load rules from database on init', async () => {
      const mockRules = [
        { id: 'rule1', name: 'Rule 1', type: 'threshold', conditions: '{"metric":"cpu","operator":">","value":80}' },
        { id: 'rule2', name: 'Rule 2', type: 'pattern', conditions: '{"pattern":"error","count":5,"window":60}' }
      ];
      
      mockDb.query.mockResolvedValue({ rows: mockRules });
      
      await service.loadRules();
      
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM alert_rules WHERE is_active = true')
      );
      expect(mockEngine.importRules).toHaveBeenCalled();
    });
  });
  
  describe('rule evaluation', () => {
    it('should evaluate rule and save history', async () => {
      const mockResult = {
        rule: { id: 'test-uuid', name: 'Test Rule' },
        triggered: true,
        reason: 'cpu (85) > 80'
      };
      
      mockEngine.evaluateRule.mockReturnValue(mockResult);
      mockDb.query.mockResolvedValue({ rows: [{ id: 1 }] });
      
      const result = await service.evaluateRule('test-uuid', { cpu: 85 });
      
      expect(result).toEqual(mockResult);
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO alert_history'),
        expect.arrayContaining(['test-uuid', 'alerting'])
      );
    });
    
    it('should resolve alert when condition no longer met', async () => {
      // First set up an active alert
      mockDb.query
        .mockResolvedValueOnce({ rows: [{ id: 1, state: 'alerting' }] }) // Get active alert
        .mockResolvedValueOnce({ rows: [] }); // Update alert
      
      const mockResult = {
        rule: { id: 'test-uuid', name: 'Test Rule' },
        triggered: false,
        reason: 'cpu (75) not > 80'
      };
      
      mockEngine.evaluateRule.mockReturnValue(mockResult);
      
      await service.evaluateRule('test-uuid', { cpu: 75 });
      
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE alert_history'),
        expect.any(Array)
      );
    });
  });
  
  describe('action management', () => {
    it('should register action in database and engine', async () => {
      const actionConfig = {
        name: 'custom_webhook',
        type: 'webhook',
        configuration: { url: 'https://example.com/webhook' }
      };
      
      mockDb.query.mockResolvedValue({ rows: [{ id: 1 }] });
      
      await service.registerAction(actionConfig, jest.fn());
      
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO alert_actions'),
        expect.arrayContaining(['custom_webhook', 'webhook'])
      );
      expect(mockEngine.registerAction).toHaveBeenCalled();
    });
    
    it('should load and register actions on init', async () => {
      const mockActions = [
        { name: 'email', type: 'email', configuration: { recipients: ['test@example.com'] } },
        { name: 'slack', type: 'slack', configuration: { webhook: 'https://slack.com/webhook' } }
      ];
      
      mockDb.query.mockResolvedValue({ rows: mockActions });
      
      await service.loadActions();
      
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM alert_actions WHERE is_enabled = true')
      );
      expect(mockEngine.registerAction).toHaveBeenCalledTimes(2);
    });
  });
  
  describe('pattern events', () => {
    it('should record pattern event', async () => {
      mockDb.query.mockResolvedValue({ rows: [{ id: 1 }] });
      mockEngine.recordEvent = jest.fn();
      
      await service.recordPatternEvent('test-uuid', 'failed_login', { user: 'test@example.com' });
      
      expect(mockEngine.recordEvent).toHaveBeenCalledWith(
        'test-uuid', 
        'failed_login', 
        { user: 'test@example.com' }
      );
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO alert_pattern_events'),
        expect.arrayContaining(['test-uuid', 'failed_login'])
      );
    });
    
    it('should clean up old pattern events', async () => {
      mockDb.query.mockResolvedValue({ rows: [] });
      
      await service.cleanupOldPatternEvents();
      
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('cleanup_old_pattern_events')
      );
    });
  });
  
  describe('metrics and monitoring', () => {
    it('should update alert metrics', async () => {
      mockDb.query.mockResolvedValue({ rows: [] });
      
      await service.updateMetrics('test-uuid', true, true);
      
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('update_alert_metrics'),
        ['test-uuid', true, true]
      );
    });
    
    it('should get alert statistics', async () => {
      const mockStats = [
        { rule_id: 'rule1', trigger_count: 10, false_positive_count: 2 }
      ];
      
      mockDb.query.mockResolvedValue({ rows: mockStats });
      
      const stats = await service.getAlertStatistics({ days: 7 });
      
      expect(stats).toEqual(mockStats);
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
        expect.any(Array)
      );
    });
  });
  
  describe('subscriptions', () => {
    it('should create user subscription', async () => {
      const subscription = {
        userId: 1,
        ruleId: 'test-uuid',
        notificationChannels: ['email', 'slack']
      };
      
      mockDb.query.mockResolvedValue({ rows: [{ id: 1 }] });
      
      await service.createSubscription(subscription);
      
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO alert_subscriptions'),
        expect.arrayContaining([1, 'test-uuid'])
      );
    });
    
    it('should get user subscriptions', async () => {
      const mockSubs = [
        { rule_id: 'rule1', notification_channels: ['email'] }
      ];
      
      mockDb.query.mockResolvedValue({ rows: mockSubs });
      
      const subs = await service.getUserSubscriptions(1);
      
      expect(subs).toEqual(mockSubs);
    });
  });
  
  describe('templates', () => {
    it('should create rule from template', async () => {
      const mockTemplate = {
        name: 'high_cpu',
        type: 'threshold',
        default_conditions: { metric: 'cpu', operator: '>', value: 80 },
        default_actions: ['email']
      };
      
      mockDb.query.mockResolvedValue({ rows: [mockTemplate] });
      
      const mockRule = {
        id: 'new-rule',
        name: 'My CPU Alert',
        type: 'threshold'
      };
      
      mockEngine.createRule.mockReturnValue(mockRule);
      
      const result = await service.createFromTemplate('high_cpu', {
        name: 'My CPU Alert',
        value: 90
      });
      
      expect(result).toEqual(mockRule);
    });
  });
});