const AlertRule = require('./AlertRule');
const logger = require('../utils/logger');

/**
 * Alert Rules Engine - Manages and evaluates alert rules
 */
class AlertRulesEngine {
  constructor(options = {}) {
    this.rules = new Map(); // id -> AlertRule
    this.actions = new Map(); // actionName -> function
    this.templates = new Map(); // templateName -> template config
    this.eventHistory = new Map(); // ruleId -> events array
    this.options = options;
    
    // Register default actions
    this._registerDefaultActions();
  }
  
  /**
   * Create a new alert rule
   */
  createRule(config) {
    const rule = new AlertRule(config);
    this.rules.set(rule.id, rule);
    
    // Initialize event history for pattern rules
    if (rule.type === 'pattern') {
      this.eventHistory.set(rule.id, []);
    }
    
    logger.info('Alert rule created', { 
      ruleId: rule.id, 
      name: rule.name,
      type: rule.type 
    });
    
    return rule;
  }
  
  /**
   * Get a rule by ID
   */
  getRule(ruleId) {
    return this.rules.get(ruleId) || null;
  }
  
  /**
   * List all rules
   */
  listRules(filter = {}) {
    let rules = Array.from(this.rules.values());
    
    // Apply filters
    if (filter.active !== undefined) {
      rules = rules.filter(r => r.isActive === filter.active);
    }
    
    if (filter.type) {
      rules = rules.filter(r => r.type === filter.type);
    }
    
    if (filter.tags && filter.tags.length > 0) {
      rules = rules.filter(r => 
        filter.tags.some(tag => r.tags.includes(tag))
      );
    }
    
    return rules;
  }
  
  /**
   * Update a rule
   */
  updateRule(ruleId, updates) {
    const rule = this.getRule(ruleId);
    if (!rule) {
      throw new Error(`Rule ${ruleId} not found`);
    }
    
    rule.update(updates);
    
    logger.info('Alert rule updated', { 
      ruleId: rule.id, 
      updates: Object.keys(updates) 
    });
    
    return rule;
  }
  
  /**
   * Delete a rule
   */
  deleteRule(ruleId) {
    const rule = this.getRule(ruleId);
    if (!rule) {
      return false;
    }
    
    this.rules.delete(ruleId);
    this.eventHistory.delete(ruleId);
    
    logger.info('Alert rule deleted', { 
      ruleId: rule.id, 
      name: rule.name 
    });
    
    return true;
  }
  
  /**
   * Activate a rule
   */
  activateRule(ruleId) {
    return this.updateRule(ruleId, { isActive: true });
  }
  
  /**
   * Deactivate a rule
   */
  deactivateRule(ruleId) {
    return this.updateRule(ruleId, { isActive: false });
  }
  
  /**
   * Evaluate a single rule
   */
  evaluateRule(ruleId, data = {}) {
    const rule = this.getRule(ruleId);
    if (!rule) {
      throw new Error(`Rule ${ruleId} not found`);
    }
    
    // Check if rule is active
    if (!rule.isActive) {
      return {
        rule,
        triggered: false,
        reason: 'Rule is inactive'
      };
    }
    
    // Check cooldown
    if (rule.isInCooldown()) {
      return {
        rule,
        triggered: false,
        reason: `Rule in cooldown until ${new Date(rule.lastTriggered.getTime() + rule.cooldown * 1000)}`
      };
    }
    
    // Evaluate based on rule type
    let result;
    switch (rule.type) {
    case 'threshold':
      result = this._evaluateThresholdRule(rule, data);
      break;
    case 'composite':
      result = this._evaluateCompositeRule(rule, data);
      break;
    case 'pattern':
      result = this._evaluatePatternRule(rule, data);
      break;
    default:
      throw new Error(`Unknown rule type: ${rule.type}`);
    }
    
    // Mark as triggered if applicable
    if (result.triggered) {
      rule.markTriggered();
    }
    
    return result;
  }
  
  /**
   * Evaluate all active rules
   */
  evaluateAll(data = {}, options = {}) {
    const rules = this.listRules({ 
      active: true,
      tags: options.tags 
    });
    
    return rules.map(rule => {
      try {
        return this.evaluateRule(rule.id, data);
      } catch (error) {
        logger.error('Error evaluating rule', { 
          ruleId: rule.id, 
          error: error.message 
        });
        return {
          rule,
          triggered: false,
          error: error.message
        };
      }
    });
  }
  
  /**
   * Evaluate rule and execute actions if triggered
   */
  async evaluateAndExecute(ruleId, data = {}) {
    const result = this.evaluateRule(ruleId, data);
    
    if (result.triggered && result.rule.actions.length > 0) {
      result.actionResults = [];
      result.actionErrors = [];
      
      for (const actionName of result.rule.actions) {
        try {
          const action = this.actions.get(actionName);
          if (action) {
            await action({ rule: result.rule, data, result });
            result.actionResults.push(`${actionName}: success`);
          } else {
            result.actionErrors.push(`Unknown action: ${actionName}`);
          }
        } catch (error) {
          result.actionErrors.push(`${actionName}: ${error.message}`);
          logger.error('Action execution failed', {
            ruleId: result.rule.id,
            action: actionName,
            error: error.message
          });
        }
      }
    }
    
    return result;
  }
  
  /**
   * Register an action handler
   */
  registerAction(name, handler) {
    if (typeof handler !== 'function') {
      throw new Error('Action handler must be a function');
    }
    
    this.actions.set(name, handler);
    logger.info('Action registered', { action: name });
  }
  
  /**
   * Register a rule template
   */
  registerTemplate(name, template) {
    this.templates.set(name, template);
    logger.info('Template registered', { template: name });
  }
  
  /**
   * Create rule from template
   */
  createFromTemplate(templateName, params) {
    const template = this.templates.get(templateName);
    if (!template) {
      throw new Error(`Template ${templateName} not found`);
    }
    
    // Merge template with params
    const config = {
      ...template,
      ...params,
      conditions: {
        ...template.conditions,
        ...params
      }
    };
    
    return this.createRule(config);
  }
  
  /**
   * Record an event for pattern-based rules
   */
  recordEvent(ruleId, eventType, metadata = {}) {
    const events = this.eventHistory.get(ruleId) || [];
    
    events.push({
      type: eventType,
      timestamp: new Date(),
      metadata
    });
    
    // Keep only recent events based on rule window
    const rule = this.getRule(ruleId);
    if (rule && rule.conditions.window) {
      const cutoff = new Date(Date.now() - rule.conditions.window * 1000);
      const recentEvents = events.filter(e => e.timestamp > cutoff);
      this.eventHistory.set(ruleId, recentEvents);
    } else {
      this.eventHistory.set(ruleId, events);
    }
  }
  
  /**
   * Export all rules
   */
  exportRules() {
    return Array.from(this.rules.values()).map(rule => rule.toJSON());
  }
  
  /**
   * Import rules
   */
  importRules(rulesData) {
    rulesData.forEach(ruleData => {
      const rule = AlertRule.fromJSON(ruleData);
      this.rules.set(rule.id, rule);
      
      if (rule.type === 'pattern') {
        this.eventHistory.set(rule.id, []);
      }
    });
    
    logger.info('Rules imported', { count: rulesData.length });
  }
  
  /**
   * Evaluate threshold rule
   */
  _evaluateThresholdRule(rule, data) {
    const { metric, operator, value } = rule.conditions;
    const metricValue = data[metric];
    
    if (metricValue === undefined) {
      return {
        rule,
        triggered: false,
        reason: `Metric ${metric} not found in data`
      };
    }
    
    const triggered = this._compareValues(metricValue, operator, value);
    
    return {
      rule,
      triggered,
      reason: triggered 
        ? `${metric} (${metricValue}) ${operator} ${value}`
        : `${metric} (${metricValue}) not ${operator} ${value}`
    };
  }
  
  /**
   * Evaluate composite rule
   */
  _evaluateCompositeRule(rule, data) {
    const { all, any } = rule.conditions;
    
    if (all) {
      // AND logic - all conditions must be true
      const results = all.map(condition => 
        this._evaluateCondition(condition, data)
      );
      
      const triggered = results.every(r => r.triggered);
      
      return {
        rule,
        triggered,
        reason: triggered
          ? 'All conditions met'
          : `Failed conditions: ${results.filter(r => !r.triggered).map(r => r.reason).join('; ')}`
      };
    } else if (any) {
      // OR logic - any condition must be true
      const results = any.map(condition => 
        this._evaluateCondition(condition, data)
      );
      
      const triggered = results.some(r => r.triggered);
      
      return {
        rule,
        triggered,
        reason: triggered
          ? `Met conditions: ${results.filter(r => r.triggered).map(r => r.reason).join('; ')}`
          : 'No conditions met'
      };
    }
    
    return {
      rule,
      triggered: false,
      reason: 'Invalid composite rule structure'
    };
  }
  
  /**
   * Evaluate pattern rule
   */
  _evaluatePatternRule(rule, _data) {
    const { pattern, count, window } = rule.conditions;
    const events = this.eventHistory.get(rule.id) || [];
    
    // Filter events by pattern and window
    const cutoff = new Date(Date.now() - window * 1000);
    const matchingEvents = events.filter(e => 
      e.type === pattern && e.timestamp > cutoff
    );
    
    const triggered = matchingEvents.length >= count;
    
    return {
      rule,
      triggered,
      reason: triggered
        ? `Pattern ${pattern} occurred ${matchingEvents.length} times in ${window}s (threshold: ${count})`
        : `Pattern ${pattern} occurred ${matchingEvents.length} times in ${window}s (threshold: ${count})`
    };
  }
  
  /**
   * Evaluate a single condition
   */
  _evaluateCondition(condition, data) {
    const { metric, operator, value } = condition;
    const metricValue = data[metric];
    
    if (metricValue === undefined) {
      return {
        triggered: false,
        reason: `${metric} not found`
      };
    }
    
    const triggered = this._compareValues(metricValue, operator, value);
    
    return {
      triggered,
      reason: `${metric} (${metricValue}) ${operator} ${value}`
    };
  }
  
  /**
   * Compare values based on operator
   */
  _compareValues(actual, operator, expected) {
    switch (operator) {
    case '>':
      return actual > expected;
    case '>=':
      return actual >= expected;
    case '<':
      return actual < expected;
    case '<=':
      return actual <= expected;
    case '==':
      return actual == expected;
    case '!=':
      return actual != expected;
    default:
      throw new Error(`Unknown operator: ${operator}`);
    }
  }
  
  /**
   * Register default actions
   */
  _registerDefaultActions() {
    // Log action
    this.registerAction('log', async ({ rule, data, result }) => {
      logger.warn('Alert triggered', {
        rule: rule.name,
        type: rule.type,
        reason: result.reason,
        data
      });
    });
    
    // Console action (for testing)
    this.registerAction('console', async ({ rule, data: _data, result }) => {
      logger.warn(`ALERT: ${rule.name} - ${result.reason}`);
    });
  }
}

module.exports = AlertRulesEngine;