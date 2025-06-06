const AlertRulesEngine = require('../alerts/AlertRulesEngine');
const DatabaseManager = require('../database/DatabaseManager');
const logger = require('../utils/logger');

/**
 * Service for managing alerts with database persistence
 */
class AlertService {
  constructor(options = {}) {
    this.db = null;
    this.engine = new AlertRulesEngine(options);
    this.actionHandlers = new Map();
    
    // Lazy load database
    this._getDb = () => {
      if (!this.db) {
        this.db = DatabaseManager.getInstance().getDatabase();
      }
      return this.db;
    };
    
    // Initialize actions and rules
    this._initialize().catch(err => {
      logger.error('Failed to initialize AlertService:', err);
    });
  }
  
  /**
   * Initialize service by loading actions and rules
   */
  async _initialize() {
    await this.loadActions();
    await this.loadRules();
  }
  
  /**
   * Create a new alert rule
   */
  async createRule(config, userId = null) {
    try {
      // Create rule in engine
      const rule = this.engine.createRule(config);
      
      // Save to database
      await this._getDb().query(`
        INSERT INTO alert_rules (
          id, name, description, type, conditions, actions, 
          severity, is_active, cooldown, tags, metadata, created_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      `, [
        rule.id,
        rule.name,
        config.description || null,
        rule.type,
        JSON.stringify(rule.conditions),
        rule.actions,
        config.severity || 'warning',
        rule.isActive,
        rule.cooldown,
        rule.tags,
        JSON.stringify(rule.metadata),
        userId
      ]);
      
      logger.info('Alert rule saved to database', { ruleId: rule.id });
      
      return rule;
    } catch (error) {
      logger.error('Failed to create alert rule:', error);
      throw error;
    }
  }
  
  /**
   * Update an alert rule
   */
  async updateRule(ruleId, updates) {
    try {
      // Update in engine
      const rule = this.engine.updateRule(ruleId, updates);
      
      // Build update query dynamically
      const updateFields = [];
      const values = [];
      let paramCount = 1;
      
      const allowedFields = [
        'name', 'description', 'conditions', 'actions', 
        'severity', 'is_active', 'cooldown', 'tags', 'metadata'
      ];
      
      for (const field of allowedFields) {
        if (updates[field] !== undefined) {
          updateFields.push(`${field} = $${paramCount}`);
          
          // Handle JSON fields
          if (['conditions', 'metadata'].includes(field)) {
            values.push(JSON.stringify(updates[field]));
          } else {
            values.push(updates[field]);
          }
          
          paramCount++;
        }
      }
      
      if (updateFields.length > 0) {
        updateFields.push(`updated_at = NOW()`);
        values.push(ruleId);
        
        await this._getDb().query(`
          UPDATE alert_rules 
          SET ${updateFields.join(', ')}
          WHERE id = $${paramCount}
        `, values);
        
        logger.info('Alert rule updated in database', { ruleId });
      }
      
      return rule;
    } catch (error) {
      logger.error('Failed to update alert rule:', error);
      throw error;
    }
  }
  
  /**
   * Delete an alert rule
   */
  async deleteRule(ruleId) {
    try {
      // Delete from engine
      const deleted = this.engine.deleteRule(ruleId);
      
      if (deleted) {
        // Delete from database
        await this._getDb().query(
          'DELETE FROM alert_rules WHERE id = $1',
          [ruleId]
        );
        
        logger.info('Alert rule deleted from database', { ruleId });
      }
      
      return deleted;
    } catch (error) {
      logger.error('Failed to delete alert rule:', error);
      throw error;
    }
  }
  
  /**
   * Evaluate a rule and record history
   */
  async evaluateRule(ruleId, data = {}) {
    try {
      const result = this.engine.evaluateRule(ruleId, data);
      
      // Record in history if triggered
      if (result.triggered) {
        await this._recordAlertHistory(ruleId, 'alerting', result.reason, data);
        await this.updateMetrics(ruleId, true);
      } else {
        // Check if there's an active alert to resolve
        await this._checkAndResolveAlert(ruleId);
      }
      
      return result;
    } catch (error) {
      logger.error('Failed to evaluate rule:', error);
      throw error;
    }
  }
  
  /**
   * Evaluate rule and execute actions
   */
  async evaluateAndExecute(ruleId, data = {}) {
    try {
      const result = await this.engine.evaluateAndExecute(ruleId, data);
      
      if (result.triggered) {
        await this._recordAlertHistory(
          ruleId, 
          'alerting', 
          result.reason, 
          data,
          result.actionResults,
          result.actionErrors
        );
        
        const actionSuccess = !result.actionErrors || result.actionErrors.length === 0;
        await this.updateMetrics(ruleId, true, actionSuccess);
      } else {
        await this._checkAndResolveAlert(ruleId);
      }
      
      return result;
    } catch (error) {
      logger.error('Failed to evaluate and execute rule:', error);
      throw error;
    }
  }
  
  /**
   * Load rules from database
   */
  async loadRules() {
    try {
      const result = await this._getDb().query(`
        SELECT * FROM alert_rules WHERE is_active = true
      `);
      
      if (result && result.rows) {
        const rules = result.rows.map(row => ({
          id: row.id,
          name: row.name,
          type: row.type,
          conditions: typeof row.conditions === 'string' 
            ? JSON.parse(row.conditions) 
            : row.conditions,
          actions: row.actions,
          isActive: row.is_active,
          cooldown: row.cooldown,
          tags: row.tags,
          metadata: row.metadata,
          createdAt: row.created_at,
          updatedAt: row.updated_at
        }));
        
        this.engine.importRules(rules);
        
        logger.info('Alert rules loaded from database', { count: rules.length });
      }
    } catch (error) {
      logger.error('Failed to load alert rules:', error);
    }
  }
  
  /**
   * Load and register actions
   */
  async loadActions() {
    try {
      const result = await this._getDb().query(`
        SELECT * FROM alert_actions WHERE is_enabled = true
      `);
      
      if (result && result.rows) {
        for (const action of result.rows) {
          const handler = this._createActionHandler(action);
          this.engine.registerAction(action.name, handler);
          this.actionHandlers.set(action.name, handler);
        }
        
        logger.info('Alert actions loaded', { count: result.rows.length });
      }
    } catch (error) {
      logger.error('Failed to load alert actions:', error);
    }
  }
  
  /**
   * Register a custom action
   */
  async registerAction(config, handler) {
    try {
      // Save to database
      await this._getDb().query(`
        INSERT INTO alert_actions (name, type, configuration)
        VALUES ($1, $2, $3)
        ON CONFLICT (name) DO UPDATE
        SET type = $2, configuration = $3, updated_at = NOW()
      `, [config.name, config.type, JSON.stringify(config.configuration)]);
      
      // Register with engine
      this.engine.registerAction(config.name, handler);
      this.actionHandlers.set(config.name, handler);
      
      logger.info('Alert action registered', { name: config.name });
    } catch (error) {
      logger.error('Failed to register action:', error);
      throw error;
    }
  }
  
  /**
   * Record pattern event
   */
  async recordPatternEvent(ruleId, eventType, metadata = {}) {
    try {
      // Record in engine
      this.engine.recordEvent(ruleId, eventType, metadata);
      
      // Record in database
      await this._getDb().query(`
        INSERT INTO alert_pattern_events (rule_id, event_type, metadata)
        VALUES ($1, $2, $3)
      `, [ruleId, eventType, JSON.stringify(metadata)]);
      
    } catch (error) {
      logger.error('Failed to record pattern event:', error);
    }
  }
  
  /**
   * Clean up old pattern events
   */
  async cleanupOldPatternEvents() {
    try {
      await this._getDb().query('SELECT cleanup_old_pattern_events()');
      logger.info('Old pattern events cleaned up');
    } catch (error) {
      logger.error('Failed to cleanup pattern events:', error);
    }
  }
  
  /**
   * Update alert metrics
   */
  async updateMetrics(ruleId, triggered, actionSuccess = null) {
    try {
      await this._getDb().query(
        'SELECT update_alert_metrics($1, $2, $3)',
        [ruleId, triggered, actionSuccess]
      );
    } catch (error) {
      logger.error('Failed to update alert metrics:', error);
    }
  }
  
  /**
   * Get alert statistics
   */
  async getAlertStatistics(options = {}) {
    try {
      const { ruleId, days = 30 } = options;
      
      let query = `
        SELECT 
          rule_id,
          SUM(trigger_count) as trigger_count,
          SUM(false_positive_count) as false_positive_count,
          SUM(action_success_count) as action_success_count,
          SUM(action_failure_count) as action_failure_count,
          AVG(avg_response_time_ms) as avg_response_time_ms
        FROM alert_metrics
        WHERE metric_date >= CURRENT_DATE - INTERVAL '${days} days'
      `;
      
      const params = [];
      if (ruleId) {
        query += ' AND rule_id = $1';
        params.push(ruleId);
      }
      
      query += ' GROUP BY rule_id';
      
      const result = await this._getDb().query(query, params);
      return result.rows;
    } catch (error) {
      logger.error('Failed to get alert statistics:', error);
      throw error;
    }
  }
  
  /**
   * Create user subscription
   */
  async createSubscription(subscription) {
    try {
      const result = await this._getDb().query(`
        INSERT INTO alert_subscriptions (
          user_id, rule_id, tag_filter, severity_filter, 
          notification_channels, is_active
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id
      `, [
        subscription.userId,
        subscription.ruleId || null,
        subscription.tagFilter || null,
        subscription.severityFilter || null,
        subscription.notificationChannels || ['email'],
        subscription.isActive !== false
      ]);
      
      return result.rows[0];
    } catch (error) {
      logger.error('Failed to create subscription:', error);
      throw error;
    }
  }
  
  /**
   * Get user subscriptions
   */
  async getUserSubscriptions(userId) {
    try {
      const result = await this._getDb().query(`
        SELECT * FROM alert_subscriptions
        WHERE user_id = $1 AND is_active = true
      `, [userId]);
      
      return result.rows;
    } catch (error) {
      logger.error('Failed to get user subscriptions:', error);
      throw error;
    }
  }
  
  /**
   * Create rule from template
   */
  async createFromTemplate(templateName, params, userId = null) {
    try {
      // Get template from database
      const result = await this._getDb().query(
        'SELECT * FROM alert_templates WHERE name = $1',
        [templateName]
      );
      
      if (result.rows.length === 0) {
        throw new Error(`Template ${templateName} not found`);
      }
      
      const template = result.rows[0];
      
      // Merge template with params
      const config = {
        type: template.type,
        conditions: { ...template.default_conditions, ...params },
        actions: template.default_actions,
        severity: template.default_severity,
        tags: template.default_tags,
        ...params
      };
      
      return this.createRule(config, userId);
    } catch (error) {
      logger.error('Failed to create rule from template:', error);
      throw error;
    }
  }
  
  /**
   * Get active alerts
   */
  async getActiveAlerts() {
    try {
      const result = await this._getDb().query(
        'SELECT * FROM active_alerts'
      );
      
      return result.rows;
    } catch (error) {
      logger.error('Failed to get active alerts:', error);
      throw error;
    }
  }
  
  /**
   * Record alert history
   */
  async _recordAlertHistory(ruleId, state, reason, data, actionsExecuted = [], actionErrors = []) {
    try {
      await this._getDb().query(`
        INSERT INTO alert_history (
          rule_id, state, trigger_reason, data, 
          actions_executed, action_errors
        )
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [
        ruleId,
        state,
        reason,
        JSON.stringify(data),
        actionsExecuted,
        actionErrors.length > 0 ? JSON.stringify(actionErrors) : null
      ]);
    } catch (error) {
      logger.error('Failed to record alert history:', error);
    }
  }
  
  /**
   * Check and resolve active alerts
   */
  async _checkAndResolveAlert(ruleId) {
    try {
      // Check for active alert
      const result = await this._getDb().query(`
        SELECT id FROM alert_history
        WHERE rule_id = $1 
          AND state = 'alerting'
          AND resolved_at IS NULL
        ORDER BY triggered_at DESC
        LIMIT 1
      `, [ruleId]);
      
      if (result.rows.length > 0) {
        // Resolve the alert
        await this._getDb().query(`
          UPDATE alert_history
          SET state = 'resolved',
              resolved_at = NOW(),
              duration_ms = EXTRACT(EPOCH FROM (NOW() - triggered_at)) * 1000
          WHERE id = $1
        `, [result.rows[0].id]);
        
        logger.info('Alert resolved', { ruleId, historyId: result.rows[0].id });
      }
    } catch (error) {
      logger.error('Failed to check/resolve alert:', error);
    }
  }
  
  /**
   * Create action handler based on type
   */
  _createActionHandler(action) {
    const config = action.configuration;
    
    switch (action.type) {
      case 'email':
        return this._createEmailHandler(config);
      case 'slack':
        return this._createSlackHandler(config);
      case 'webhook':
        return this._createWebhookHandler(config);
      case 'log':
        return this._createLogHandler(config);
      default:
        return async () => {
          logger.warn(`Unknown action type: ${action.type}`);
        };
    }
  }
  
  /**
   * Create email action handler
   */
  _createEmailHandler(config) {
    return async ({ rule, data, result }) => {
      logger.info('Email alert triggered', {
        rule: rule.name,
        recipients: config.default_recipients,
        reason: result.reason
      });
      // TODO: Implement actual email sending
    };
  }
  
  /**
   * Create Slack action handler
   */
  _createSlackHandler(config) {
    return async ({ rule, data, result }) => {
      logger.info('Slack alert triggered', {
        rule: rule.name,
        channel: config.channel,
        reason: result.reason
      });
      // TODO: Implement actual Slack notification
    };
  }
  
  /**
   * Create webhook action handler
   */
  _createWebhookHandler(config) {
    return async ({ rule, data, result }) => {
      logger.info('Webhook alert triggered', {
        rule: rule.name,
        url: config.url,
        reason: result.reason
      });
      // TODO: Implement actual webhook call
    };
  }
  
  /**
   * Create log action handler
   */
  _createLogHandler(config) {
    return async ({ rule, data, result }) => {
      const level = config.level || 'warn';
      logger[level](`Alert: ${rule.name}`, {
        reason: result.reason,
        data
      });
    };
  }
}

module.exports = AlertService;