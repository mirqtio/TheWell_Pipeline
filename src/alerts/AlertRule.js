const { v4: uuidv4 } = require('uuid');

/**
 * Represents an alert rule
 */
class AlertRule {
  constructor(config) {
    this.id = config.id || uuidv4();
    this.name = config.name;
    this.type = config.type; // threshold, pattern, composite
    this.conditions = config.conditions;
    this.actions = config.actions || [];
    this.isActive = config.isActive !== undefined ? config.isActive : true;
    this.cooldown = config.cooldown || 0; // seconds
    this.lastTriggered = null;
    this.metadata = config.metadata || {};
    this.tags = config.tags || [];
    this.createdAt = config.createdAt || new Date();
    this.updatedAt = config.updatedAt || new Date();
  }
  
  /**
   * Check if rule is in cooldown period
   */
  isInCooldown() {
    if (!this.cooldown || !this.lastTriggered) {
      return false;
    }
    
    const cooldownEnd = new Date(this.lastTriggered.getTime() + this.cooldown * 1000);
    return new Date() < cooldownEnd;
  }
  
  /**
   * Update rule properties
   */
  update(updates) {
    const allowedUpdates = [
      'name', 'conditions', 'actions', 'isActive', 
      'cooldown', 'metadata', 'tags'
    ];
    
    allowedUpdates.forEach(field => {
      if (updates[field] !== undefined) {
        this[field] = updates[field];
      }
    });
    
    this.updatedAt = new Date();
  }
  
  /**
   * Mark rule as triggered
   */
  markTriggered() {
    this.lastTriggered = new Date();
  }
  
  /**
   * Export rule as JSON
   */
  toJSON() {
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      conditions: this.conditions,
      actions: this.actions,
      isActive: this.isActive,
      cooldown: this.cooldown,
      lastTriggered: this.lastTriggered,
      metadata: this.metadata,
      tags: this.tags,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }
  
  /**
   * Create rule from JSON
   */
  static fromJSON(json) {
    return new AlertRule(json);
  }
}

module.exports = AlertRule;