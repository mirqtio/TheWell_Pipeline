const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const alertsRoutes = require('../../../../src/web/routes/alerts');
const AlertService = require('../../../../src/services/AlertService');

jest.mock('../../../../src/services/AlertService');

describe('Alerts API Routes', () => {
  let app;
  let mockAlertService;
  let authToken;
  
  beforeEach(() => {
    app = express();
    app.use(express.json());
    
    // Mock alert service
    mockAlertService = {
      engine: {
        listRules: jest.fn(),
        getRule: jest.fn(),
        evaluateAll: jest.fn()
      },
      createRule: jest.fn(),
      updateRule: jest.fn(),
      deleteRule: jest.fn(),
      evaluateRule: jest.fn(),
      evaluateAndExecute: jest.fn(),
      getActiveAlerts: jest.fn(),
      getAlertStatistics: jest.fn(),
      getUserSubscriptions: jest.fn(),
      createSubscription: jest.fn(),
      recordPatternEvent: jest.fn(),
      createFromTemplate: jest.fn(),
      _getDb: jest.fn().mockReturnValue({
        query: jest.fn()
      })
    };
    
    // Mock AlertService constructor
    AlertService.mockImplementation(() => mockAlertService);
    
    // Mock auth middleware
    const mockAuth = (req, res, next) => {
      req.user = { id: 1, permissions: ['alerts.view', 'alerts.create', 'alerts.update', 'alerts.delete', 'alerts.evaluate', 'alerts.subscribe'] };
      next();
    };
    
    const mockRequirePermission = () => mockAuth;
    
    // Mock auth module
    jest.doMock('../../../../src/web/middleware/auth', () => ({
      requirePermission: mockRequirePermission
    }));
    
    // Initialize routes
    app.use('/api/alerts', alertsRoutes());
    
    // Generate auth token
    authToken = jwt.sign(
      { id: 1, email: 'test@example.com' },
      process.env.JWT_SECRET || 'test-secret'
    );
  });
  
  afterEach(() => {
    jest.clearAllMocks();
  });
  
  describe('GET /api/alerts/rules', () => {
    it('should list alert rules', async () => {
      const mockRules = [
        {
          id: 'rule1',
          name: 'CPU Alert',
          type: 'threshold',
          toJSON: () => ({ id: 'rule1', name: 'CPU Alert', type: 'threshold' })
        },
        {
          id: 'rule2',
          name: 'Memory Alert',
          type: 'threshold',
          toJSON: () => ({ id: 'rule2', name: 'Memory Alert', type: 'threshold' })
        }
      ];
      
      mockAlertService.engine.listRules.mockReturnValue(mockRules);
      
      const response = await request(app)
        .get('/api/alerts/rules')
        .set('Authorization', `Bearer ${authToken}`);
      
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.count).toBe(2);
      expect(response.body.rules).toHaveLength(2);
    });
    
    it('should filter rules by type', async () => {
      mockAlertService.engine.listRules.mockReturnValue([]);
      
      await request(app)
        .get('/api/alerts/rules?type=pattern')
        .set('Authorization', `Bearer ${authToken}`);
      
      expect(mockAlertService.engine.listRules).toHaveBeenCalledWith({
        active: undefined,
        type: 'pattern',
        tags: undefined
      });
    });
  });
  
  describe('POST /api/alerts/rules', () => {
    it('should create a new alert rule', async () => {
      const ruleConfig = {
        name: 'New Alert',
        type: 'threshold',
        conditions: { metric: 'cpu', operator: '>', value: 80 }
      };
      
      const mockRule = {
        id: 'new-rule',
        ...ruleConfig,
        toJSON: () => ({ id: 'new-rule', ...ruleConfig })
      };
      
      mockAlertService.createRule.mockResolvedValue(mockRule);
      
      const response = await request(app)
        .post('/api/alerts/rules')
        .set('Authorization', `Bearer ${authToken}`)
        .send(ruleConfig);
      
      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.rule.id).toBe('new-rule');
      expect(mockAlertService.createRule).toHaveBeenCalledWith(ruleConfig, 1);
    });
  });
  
  describe('GET /api/alerts/rules/:ruleId', () => {
    it('should get rule by ID', async () => {
      const mockRule = {
        id: 'rule1',
        name: 'Test Rule',
        toJSON: () => ({ id: 'rule1', name: 'Test Rule' })
      };
      
      mockAlertService.engine.getRule.mockReturnValue(mockRule);
      
      const response = await request(app)
        .get('/api/alerts/rules/rule1')
        .set('Authorization', `Bearer ${authToken}`);
      
      expect(response.status).toBe(200);
      expect(response.body.rule.id).toBe('rule1');
    });
    
    it('should return 404 for non-existent rule', async () => {
      mockAlertService.engine.getRule.mockReturnValue(null);
      
      const response = await request(app)
        .get('/api/alerts/rules/nonexistent')
        .set('Authorization', `Bearer ${authToken}`);
      
      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
    });
  });
  
  describe('PUT /api/alerts/rules/:ruleId', () => {
    it('should update alert rule', async () => {
      const updates = { name: 'Updated Rule' };
      const mockRule = {
        id: 'rule1',
        name: 'Updated Rule',
        toJSON: () => ({ id: 'rule1', name: 'Updated Rule' })
      };
      
      mockAlertService.updateRule.mockResolvedValue(mockRule);
      
      const response = await request(app)
        .put('/api/alerts/rules/rule1')
        .set('Authorization', `Bearer ${authToken}`)
        .send(updates);
      
      expect(response.status).toBe(200);
      expect(response.body.rule.name).toBe('Updated Rule');
    });
  });
  
  describe('DELETE /api/alerts/rules/:ruleId', () => {
    it('should delete alert rule', async () => {
      mockAlertService.deleteRule.mockResolvedValue(true);
      
      const response = await request(app)
        .delete('/api/alerts/rules/rule1')
        .set('Authorization', `Bearer ${authToken}`);
      
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });
  
  describe('POST /api/alerts/evaluate/:ruleId', () => {
    it('should evaluate a single rule', async () => {
      const mockResult = {
        triggered: true,
        reason: 'cpu (85) > 80',
        rule: { name: 'CPU Alert' }
      };
      
      mockAlertService.evaluateRule.mockResolvedValue(mockResult);
      
      const response = await request(app)
        .post('/api/alerts/evaluate/rule1')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ cpu: 85 });
      
      expect(response.status).toBe(200);
      expect(response.body.result.triggered).toBe(true);
    });
  });
  
  describe('POST /api/alerts/evaluate-all', () => {
    it('should evaluate all active rules', async () => {
      const mockResults = [
        { rule: { name: 'Rule 1' }, triggered: true, reason: 'High CPU' },
        { rule: { name: 'Rule 2' }, triggered: false, reason: 'Normal' }
      ];
      
      mockAlertService.engine.evaluateAll.mockReturnValue(mockResults);
      
      const response = await request(app)
        .post('/api/alerts/evaluate-all')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ data: { cpu: 85 } });
      
      expect(response.status).toBe(200);
      expect(response.body.triggeredCount).toBe(1);
      expect(response.body.totalCount).toBe(2);
    });
  });
  
  describe('GET /api/alerts/templates', () => {
    it('should list alert templates', async () => {
      const mockTemplates = [
        { name: 'high_cpu', description: 'High CPU usage' }
      ];
      
      mockAlertService._getDb().query.mockResolvedValue({ rows: mockTemplates });
      
      const response = await request(app)
        .get('/api/alerts/templates')
        .set('Authorization', `Bearer ${authToken}`);
      
      expect(response.status).toBe(200);
      expect(response.body.templates).toEqual(mockTemplates);
    });
  });
  
  describe('POST /api/alerts/templates/:templateName', () => {
    it('should create rule from template', async () => {
      const mockRule = {
        id: 'new-rule',
        name: 'My CPU Alert',
        toJSON: () => ({ id: 'new-rule', name: 'My CPU Alert' })
      };
      
      mockAlertService.createFromTemplate.mockResolvedValue(mockRule);
      
      const response = await request(app)
        .post('/api/alerts/templates/high_cpu')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'My CPU Alert' });
      
      expect(response.status).toBe(201);
      expect(response.body.rule.name).toBe('My CPU Alert');
    });
  });
  
  describe('GET /api/alerts/active', () => {
    it('should get active alerts', async () => {
      const mockAlerts = [
        { rule_id: 'rule1', rule_name: 'CPU Alert', state: 'alerting' }
      ];
      
      mockAlertService.getActiveAlerts.mockResolvedValue(mockAlerts);
      
      const response = await request(app)
        .get('/api/alerts/active')
        .set('Authorization', `Bearer ${authToken}`);
      
      expect(response.status).toBe(200);
      expect(response.body.alerts).toEqual(mockAlerts);
    });
  });
  
  describe('GET /api/alerts/statistics', () => {
    it('should get alert statistics', async () => {
      const mockStats = [
        { rule_id: 'rule1', trigger_count: 10 }
      ];
      
      mockAlertService.getAlertStatistics.mockResolvedValue(mockStats);
      
      const response = await request(app)
        .get('/api/alerts/statistics?days=7')
        .set('Authorization', `Bearer ${authToken}`);
      
      expect(response.status).toBe(200);
      expect(response.body.statistics).toEqual(mockStats);
    });
  });
  
  describe('POST /api/alerts/subscriptions', () => {
    it('should create alert subscription', async () => {
      const mockSub = { id: 1 };
      
      mockAlertService.createSubscription.mockResolvedValue(mockSub);
      
      const response = await request(app)
        .post('/api/alerts/subscriptions')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ ruleId: 'rule1', notificationChannels: ['email'] });
      
      expect(response.status).toBe(201);
      expect(response.body.subscription.id).toBe(1);
    });
  });
  
  describe('POST /api/alerts/pattern-events', () => {
    it('should record pattern event', async () => {
      mockAlertService.recordPatternEvent.mockResolvedValue();
      
      const response = await request(app)
        .post('/api/alerts/pattern-events')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ 
          ruleId: 'rule1', 
          eventType: 'failed_login',
          metadata: { user: 'test@example.com' }
        });
      
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });
});