const AlertRulesEngine = require('../../../src/alerts/AlertRulesEngine');
const AlertRule = require('../../../src/alerts/AlertRule');

describe('AlertRulesEngine', () => {
  let engine;
  
  beforeEach(() => {
    engine = new AlertRulesEngine();
  });
  
  describe('rule creation and management', () => {
    it('should create a simple threshold rule', () => {
      const rule = engine.createRule({
        name: 'High Error Rate',
        type: 'threshold',
        conditions: {
          metric: 'error_rate',
          operator: '>',
          value: 0.05
        },
        actions: ['email', 'slack'],
        metadata: {
          severity: 'high',
          team: 'backend'
        }
      });
      
      expect(rule).toBeInstanceOf(AlertRule);
      expect(rule.id).toBeDefined();
      expect(rule.name).toBe('High Error Rate');
      expect(rule.isActive).toBe(true);
    });
    
    it('should create a complex rule with multiple conditions', () => {
      const rule = engine.createRule({
        name: 'API Performance Degradation',
        type: 'composite',
        conditions: {
          all: [
            { metric: 'response_time_p95', operator: '>', value: 1000 },
            { metric: 'error_rate', operator: '>', value: 0.01 }
          ]
        },
        actions: ['pagerduty'],
        cooldown: 300 // 5 minutes
      });
      
      expect(rule.type).toBe('composite');
      expect(rule.conditions.all).toHaveLength(2);
      expect(rule.cooldown).toBe(300);
    });
    
    it('should create a pattern-based rule', () => {
      const rule = engine.createRule({
        name: 'Suspicious Login Pattern',
        type: 'pattern',
        conditions: {
          pattern: 'failed_login',
          count: 5,
          window: 60 // 1 minute
        },
        actions: ['security_alert']
      });
      
      expect(rule.type).toBe('pattern');
      expect(rule.conditions.count).toBe(5);
      expect(rule.conditions.window).toBe(60);
    });
    
    it('should list all rules', () => {
      engine.createRule({ name: 'Rule 1', type: 'threshold', conditions: { metric: 'cpu', operator: '>', value: 80 } });
      engine.createRule({ name: 'Rule 2', type: 'threshold', conditions: { metric: 'memory', operator: '>', value: 90 } });
      
      const rules = engine.listRules();
      expect(rules).toHaveLength(2);
      expect(rules[0].name).toBe('Rule 1');
      expect(rules[1].name).toBe('Rule 2');
    });
    
    it('should update a rule', () => {
      const rule = engine.createRule({
        name: 'Original Rule',
        type: 'threshold',
        conditions: { metric: 'cpu', operator: '>', value: 80 }
      });
      
      const updated = engine.updateRule(rule.id, {
        name: 'Updated Rule',
        conditions: { metric: 'cpu', operator: '>', value: 90 }
      });
      
      expect(updated.name).toBe('Updated Rule');
      expect(updated.conditions.value).toBe(90);
    });
    
    it('should delete a rule', () => {
      const rule = engine.createRule({
        name: 'To Delete',
        type: 'threshold',
        conditions: { metric: 'cpu', operator: '>', value: 80 }
      });
      
      expect(engine.deleteRule(rule.id)).toBe(true);
      expect(engine.getRule(rule.id)).toBeNull();
    });
    
    it('should activate and deactivate rules', () => {
      const rule = engine.createRule({
        name: 'Toggle Rule',
        type: 'threshold',
        conditions: { metric: 'cpu', operator: '>', value: 80 }
      });
      
      expect(rule.isActive).toBe(true);
      
      engine.deactivateRule(rule.id);
      expect(engine.getRule(rule.id).isActive).toBe(false);
      
      engine.activateRule(rule.id);
      expect(engine.getRule(rule.id).isActive).toBe(true);
    });
  });
  
  describe('rule evaluation', () => {
    it('should evaluate a simple threshold rule', () => {
      const rule = engine.createRule({
        name: 'High CPU',
        type: 'threshold',
        conditions: { metric: 'cpu_usage', operator: '>', value: 80 }
      });
      
      const result1 = engine.evaluateRule(rule.id, { cpu_usage: 85 });
      expect(result1.triggered).toBe(true);
      expect(result1.reason).toContain('cpu_usage (85) > 80');
      
      const result2 = engine.evaluateRule(rule.id, { cpu_usage: 75 });
      expect(result2.triggered).toBe(false);
    });
    
    it('should evaluate comparison operators correctly', () => {
      const testCases = [
        { operator: '>', value: 80, metric: 85, expected: true },
        { operator: '>=', value: 80, metric: 80, expected: true },
        { operator: '<', value: 80, metric: 75, expected: true },
        { operator: '<=', value: 80, metric: 80, expected: true },
        { operator: '==', value: 80, metric: 80, expected: true },
        { operator: '!=', value: 80, metric: 85, expected: true }
      ];
      
      testCases.forEach(({ operator, value, metric, expected }) => {
        const rule = engine.createRule({
          name: `Test ${operator}`,
          type: 'threshold',
          conditions: { metric: 'test', operator, value }
        });
        
        const result = engine.evaluateRule(rule.id, { test: metric });
        expect(result.triggered).toBe(expected);
      });
    });
    
    it('should evaluate composite rules with AND logic', () => {
      const rule = engine.createRule({
        name: 'Complex AND',
        type: 'composite',
        conditions: {
          all: [
            { metric: 'cpu', operator: '>', value: 80 },
            { metric: 'memory', operator: '>', value: 90 }
          ]
        }
      });
      
      const result1 = engine.evaluateRule(rule.id, { cpu: 85, memory: 95 });
      expect(result1.triggered).toBe(true);
      
      const result2 = engine.evaluateRule(rule.id, { cpu: 85, memory: 85 });
      expect(result2.triggered).toBe(false);
    });
    
    it('should evaluate composite rules with OR logic', () => {
      const rule = engine.createRule({
        name: 'Complex OR',
        type: 'composite',
        conditions: {
          any: [
            { metric: 'cpu', operator: '>', value: 80 },
            { metric: 'memory', operator: '>', value: 90 }
          ]
        }
      });
      
      const result1 = engine.evaluateRule(rule.id, { cpu: 85, memory: 50 });
      expect(result1.triggered).toBe(true);
      
      const result2 = engine.evaluateRule(rule.id, { cpu: 50, memory: 50 });
      expect(result2.triggered).toBe(false);
    });
    
    it('should evaluate pattern rules', () => {
      const rule = engine.createRule({
        name: 'Failed Login Pattern',
        type: 'pattern',
        conditions: {
          pattern: 'failed_login',
          count: 3,
          window: 60
        }
      });
      
      // Simulate failed login events
      engine.recordEvent(rule.id, 'failed_login', { user: 'test@example.com' });
      engine.recordEvent(rule.id, 'failed_login', { user: 'test@example.com' });
      
      const result1 = engine.evaluateRule(rule.id);
      expect(result1.triggered).toBe(false); // Only 2 events
      
      engine.recordEvent(rule.id, 'failed_login', { user: 'test@example.com' });
      const result2 = engine.evaluateRule(rule.id);
      expect(result2.triggered).toBe(true); // 3 events within window
    });
    
    it('should respect cooldown period', () => {
      const rule = engine.createRule({
        name: 'Cooldown Test',
        type: 'threshold',
        conditions: { metric: 'cpu', operator: '>', value: 80 },
        cooldown: 60 // 1 minute
      });
      
      const result1 = engine.evaluateRule(rule.id, { cpu: 85 });
      expect(result1.triggered).toBe(true);
      
      // Immediate re-evaluation should not trigger due to cooldown
      const result2 = engine.evaluateRule(rule.id, { cpu: 85 });
      expect(result2.triggered).toBe(false);
      expect(result2.reason).toContain('cooldown');
    });
    
    it('should skip inactive rules', () => {
      const rule = engine.createRule({
        name: 'Inactive Rule',
        type: 'threshold',
        conditions: { metric: 'cpu', operator: '>', value: 80 }
      });
      
      engine.deactivateRule(rule.id);
      
      const result = engine.evaluateRule(rule.id, { cpu: 85 });
      expect(result.triggered).toBe(false);
      expect(result.reason).toContain('inactive');
    });
  });
  
  describe('bulk evaluation', () => {
    it('should evaluate all active rules', () => {
      engine.createRule({
        name: 'CPU Alert',
        type: 'threshold',
        conditions: { metric: 'cpu', operator: '>', value: 80 }
      });
      
      engine.createRule({
        name: 'Memory Alert',
        type: 'threshold',
        conditions: { metric: 'memory', operator: '>', value: 90 }
      });
      
      const results = engine.evaluateAll({ cpu: 85, memory: 95 });
      
      expect(results).toHaveLength(2);
      expect(results.filter(r => r.triggered)).toHaveLength(2);
    });
    
    it('should only evaluate rules matching tags', () => {
      engine.createRule({
        name: 'Backend CPU',
        type: 'threshold',
        conditions: { metric: 'cpu', operator: '>', value: 80 },
        tags: ['backend', 'performance']
      });
      
      engine.createRule({
        name: 'Frontend Error',
        type: 'threshold',
        conditions: { metric: 'error_rate', operator: '>', value: 0.01 },
        tags: ['frontend', 'errors']
      });
      
      const results = engine.evaluateAll(
        { cpu: 85, error_rate: 0.05 },
        { tags: ['backend'] }
      );
      
      expect(results).toHaveLength(1);
      expect(results[0].rule.name).toBe('Backend CPU');
    });
  });
  
  describe('action execution', () => {
    it('should execute actions when rule triggers', async () => {
      const mockAction = jest.fn();
      engine.registerAction('test_action', mockAction);
      
      const rule = engine.createRule({
        name: 'Action Test',
        type: 'threshold',
        conditions: { metric: 'cpu', operator: '>', value: 80 },
        actions: ['test_action']
      });
      
      const result = await engine.evaluateAndExecute(rule.id, { cpu: 85 });
      
      expect(result.triggered).toBe(true);
      expect(mockAction).toHaveBeenCalledWith({
        rule: expect.objectContaining({ name: 'Action Test' }),
        data: { cpu: 85 },
        result: expect.objectContaining({ triggered: true })
      });
    });
    
    it('should not execute actions when rule does not trigger', async () => {
      const mockAction = jest.fn();
      engine.registerAction('test_action', mockAction);
      
      const rule = engine.createRule({
        name: 'No Action Test',
        type: 'threshold',
        conditions: { metric: 'cpu', operator: '>', value: 80 },
        actions: ['test_action']
      });
      
      await engine.evaluateAndExecute(rule.id, { cpu: 75 });
      
      expect(mockAction).not.toHaveBeenCalled();
    });
    
    it('should handle action errors gracefully', async () => {
      const errorAction = jest.fn().mockRejectedValue(new Error('Action failed'));
      engine.registerAction('error_action', errorAction);
      
      const rule = engine.createRule({
        name: 'Error Test',
        type: 'threshold',
        conditions: { metric: 'cpu', operator: '>', value: 80 },
        actions: ['error_action']
      });
      
      const result = await engine.evaluateAndExecute(rule.id, { cpu: 85 });
      
      expect(result.triggered).toBe(true);
      expect(result.actionErrors).toHaveLength(1);
      expect(result.actionErrors[0]).toContain('Action failed');
    });
  });
  
  describe('rule templates', () => {
    it('should create rule from template', () => {
      engine.registerTemplate('high_resource_usage', {
        type: 'threshold',
        operator: '>',
        actions: ['email', 'slack'],
        tags: ['infrastructure', 'performance']
      });
      
      const rule = engine.createFromTemplate('high_resource_usage', {
        name: 'High CPU Usage',
        metric: 'cpu_usage',
        value: 80
      });
      
      expect(rule.name).toBe('High CPU Usage');
      expect(rule.conditions.metric).toBe('cpu_usage');
      expect(rule.conditions.value).toBe(80);
      expect(rule.actions).toEqual(['email', 'slack']);
      expect(rule.tags).toContain('infrastructure');
    });
  });
  
  describe('persistence', () => {
    it('should export and import rules', () => {
      engine.createRule({
        name: 'Export Test 1',
        type: 'threshold',
        conditions: { metric: 'cpu', operator: '>', value: 80 }
      });
      
      engine.createRule({
        name: 'Export Test 2',
        type: 'pattern',
        conditions: { pattern: 'error', count: 10, window: 60 }
      });
      
      const exported = engine.exportRules();
      expect(exported).toHaveLength(2);
      
      // Create new engine and import
      const newEngine = new AlertRulesEngine();
      newEngine.importRules(exported);
      
      const imported = newEngine.listRules();
      expect(imported).toHaveLength(2);
      expect(imported[0].name).toBe('Export Test 1');
      expect(imported[1].name).toBe('Export Test 2');
    });
  });
});