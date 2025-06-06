const AlertService = require('../../../src/services/AlertService');
const AlertRulesEngine = require('../../../src/alerts/AlertRulesEngine');
const DatabaseManager = require('../../../src/database/DatabaseManager');
const { Pool } = require('pg');
const path = require('path');

// Skip this test file in CI environments
const skipInCI = process.env.CI === 'true' || !process.env.DB_HOST;

(skipInCI ? describe.skip : describe)('Alert Rules Integration', () => {
  let service;
  let database;
  let pool;
  
  beforeAll(async () => {
    // Initialize database
    database = DatabaseManager.getInstance();
    await database.initialize();
    pool = database.getDatabase();
    
    // Run migration
    const migrationPath = path.join(__dirname, '../../../src/database/migrations/0008_add_alert_rules.sql');
    const { runMigration } = require('../../../src/database/MigrationManager');
    
    try {
      await runMigration(pool, migrationPath);
    } catch (error) {
      if (!error.message.includes('already exists')) {
        throw error;
      }
    }
    
    // Clean up test data
    await pool.query('DELETE FROM alert_history');
    await pool.query('DELETE FROM alert_rules WHERE name LIKE $1', ['Test%']);
  });
  
  beforeEach(async () => {
    service = new AlertService();
    // Wait for initialization
    await new Promise(resolve => setTimeout(resolve, 100));
  });
  
  afterEach(async () => {
    // Clean up test data
    await pool.query('DELETE FROM alert_history');
    await pool.query('DELETE FROM alert_rules WHERE name LIKE $1', ['Test%']);
  });
  
  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
  });
  
  describe('Rule Lifecycle', () => {
    it('should create, update, and delete rules with database persistence', async () => {
      // Create rule
      const ruleConfig = {
        name: 'Test CPU Alert',
        type: 'threshold',
        conditions: { metric: 'cpu', operator: '>', value: 80 },
        actions: ['log', 'email'],
        severity: 'warning',
        cooldown: 300 // 5 minutes
      };
      
      const rule = await service.createRule(ruleConfig, 1);
      expect(rule.id).toBeDefined();
      expect(rule.name).toBe('Test CPU Alert');
      
      // Verify in database
      const dbResult = await pool.query(
        'SELECT * FROM alert_rules WHERE id = $1',
        [rule.id]
      );
      expect(dbResult.rows).toHaveLength(1);
      expect(dbResult.rows[0].name).toBe('Test CPU Alert');
      
      // Update rule
      const updated = await service.updateRule(rule.id, {
        name: 'Updated CPU Alert',
        conditions: { metric: 'cpu', operator: '>', value: 90 }
      });
      
      expect(updated.name).toBe('Updated CPU Alert');
      
      // Delete rule
      const deleted = await service.deleteRule(rule.id);
      expect(deleted).toBe(true);
      
      // Verify deletion
      const deletedResult = await pool.query(
        'SELECT * FROM alert_rules WHERE id = $1',
        [rule.id]
      );
      expect(deletedResult.rows).toHaveLength(0);
    });
  });
  
  describe('Alert Evaluation and History', () => {
    it('should evaluate rules and record history', async () => {
      // Create threshold rule
      const rule = await service.createRule({
        name: 'Test Memory Alert',
        type: 'threshold',
        conditions: { metric: 'memory', operator: '>', value: 80 },
        actions: ['log']
      });
      
      // Evaluate with high memory - should trigger
      const result1 = await service.evaluateRule(rule.id, { memory: 85 });
      expect(result1.triggered).toBe(true);
      expect(result1.reason).toContain('memory (85) > 80');
      
      // Check history
      const history = await pool.query(
        'SELECT * FROM alert_history WHERE rule_id = $1',
        [rule.id]
      );
      expect(history.rows).toHaveLength(1);
      expect(history.rows[0].state).toBe('alerting');
      
      // Evaluate with low memory - should resolve
      const result2 = await service.evaluateRule(rule.id, { memory: 70 });
      expect(result2.triggered).toBe(false);
      
      // Check if alert was resolved
      const resolved = await pool.query(
        'SELECT * FROM alert_history WHERE rule_id = $1 AND state = $2',
        [rule.id, 'resolved']
      );
      expect(resolved.rows).toHaveLength(1);
    });
    
    it('should respect cooldown periods', async () => {
      const rule = await service.createRule({
        name: 'Test Cooldown Rule',
        type: 'threshold',
        conditions: { metric: 'disk', operator: '>', value: 90 },
        cooldown: 2 // 2 seconds
      });
      
      // First evaluation - should trigger
      const result1 = await service.evaluateRule(rule.id, { disk: 95 });
      expect(result1.triggered).toBe(true);
      
      // Immediate second evaluation - should be in cooldown
      const result2 = await service.evaluateRule(rule.id, { disk: 95 });
      expect(result2.triggered).toBe(false);
      expect(result2.reason).toContain('cooldown');
      
      // Wait for cooldown to expire
      await new Promise(resolve => setTimeout(resolve, 2100));
      
      // Third evaluation - should trigger again
      const result3 = await service.evaluateRule(rule.id, { disk: 95 });
      expect(result3.triggered).toBe(true);
    });
  });
  
  describe('Pattern Rules', () => {
    it('should track pattern events and trigger on threshold', async () => {
      const rule = await service.createRule({
        name: 'Test Login Pattern',
        type: 'pattern',
        conditions: {
          pattern: 'failed_login',
          count: 3,
          window: 60 // 1 minute
        },
        actions: ['log']
      });
      
      // Record events
      await service.recordPatternEvent(rule.id, 'failed_login', { user: 'test1' });
      await service.recordPatternEvent(rule.id, 'failed_login', { user: 'test2' });
      
      // Should not trigger yet
      const result1 = service.engine.evaluateRule(rule.id);
      expect(result1.triggered).toBe(false);
      
      // One more event should trigger
      await service.recordPatternEvent(rule.id, 'failed_login', { user: 'test3' });
      
      const result2 = service.engine.evaluateRule(rule.id);
      expect(result2.triggered).toBe(true);
      expect(result2.reason).toContain('3 times');
    });
  });
  
  describe('Composite Rules', () => {
    it('should evaluate composite rules with multiple conditions', async () => {
      const rule = await service.createRule({
        name: 'Test API Degradation',
        type: 'composite',
        conditions: {
          all: [
            { metric: 'response_time', operator: '>', value: 1000 },
            { metric: 'error_rate', operator: '>', value: 0.05 }
          ]
        }
      });
      
      // Only one condition met - should not trigger
      const result1 = await service.evaluateRule(rule.id, {
        response_time: 1500,
        error_rate: 0.01
      });
      expect(result1.triggered).toBe(false);
      
      // Both conditions met - should trigger
      const result2 = await service.evaluateRule(rule.id, {
        response_time: 1500,
        error_rate: 0.1
      });
      expect(result2.triggered).toBe(true);
    });
  });
  
  describe('Alert Metrics', () => {
    it('should track alert metrics', async () => {
      const rule = await service.createRule({
        name: 'Test Metrics Rule',
        type: 'threshold',
        conditions: { metric: 'requests', operator: '>', value: 1000 }
      });
      
      // Trigger multiple times
      await service.evaluateRule(rule.id, { requests: 1500 });
      await service.evaluateRule(rule.id, { requests: 1200 });
      
      // Get statistics
      const stats = await service.getAlertStatistics({ ruleId: rule.id });
      expect(stats).toHaveLength(1);
      expect(stats[0].trigger_count).toBe('2');
    });
  });
  
  describe('Alert Templates', () => {
    it('should create rules from templates', async () => {
      const rule = await service.createFromTemplate('high_error_rate', {
        name: 'Test Error Rate Alert',
        value: 0.1 // Override default threshold
      });
      
      expect(rule.name).toBe('Test Error Rate Alert');
      expect(rule.type).toBe('threshold');
      expect(rule.conditions.value).toBe(0.1);
    });
  });
  
  describe('Subscriptions', () => {
    it('should manage user subscriptions', async () => {
      const rule = await service.createRule({
        name: 'Test Subscription Rule',
        type: 'threshold',
        conditions: { metric: 'latency', operator: '>', value: 500 }
      });
      
      // Create subscription
      const sub = await service.createSubscription({
        userId: 1,
        ruleId: rule.id,
        notificationChannels: ['email', 'slack']
      });
      
      expect(sub.id).toBeDefined();
      
      // Get user subscriptions
      const subs = await service.getUserSubscriptions(1);
      expect(subs).toHaveLength(1);
      expect(subs[0].rule_id).toBe(rule.id);
    });
  });
});