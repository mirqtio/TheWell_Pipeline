/**
 * Cost Tracking Service
 * 
 * Comprehensive cost tracking system for LLM usage across all providers.
 * Tracks costs, generates reports, and provides budget monitoring.
 */

const logger = require('../utils/logger');
const { EventEmitter } = require('events');
const CostDAO = require('./CostDAO');

class CostTracker extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      budgetLimits: {
        daily: config.dailyBudget || 100,
        monthly: config.monthlyBudget || 2000,
        perDocument: config.perDocumentBudget || 1
      },
      alertThresholds: {
        daily: config.dailyAlertThreshold || 0.8,
        monthly: config.monthlyAlertThreshold || 0.8,
        perDocument: config.perDocumentAlertThreshold || 0.9
      },
      retentionDays: config.retentionDays || 90,
      enablePersistence: true,
      ...config
    };
    
    // In-memory cache for performance
    this.costRecords = [];
    this.dailyTotals = new Map();
    this.monthlyTotals = new Map();
    this.providerTotals = new Map();
    this.budgets = new Map();
    
    // Database persistence
    this.dao = config.dao || new CostDAO(config.database);
    this.isInitialized = false;
    
    // Cost rates per 1K tokens (can be overridden via config)
    this.costRates = {
      openai: {
        'gpt-4-turbo': { input: 0.01, output: 0.03 },
        'gpt-4': { input: 0.03, output: 0.06 },
        'gpt-3.5-turbo': { input: 0.0005, output: 0.0015 }
      },
      anthropic: {
        'claude-3-opus': { input: 0.015, output: 0.075 },
        'claude-3-sonnet': { input: 0.003, output: 0.015 },
        'claude-3-haiku': { input: 0.00025, output: 0.00125 }
      },
      ...config.costRates
    };
    
    logger.info('CostTracker: Initialized with persistence enabled', { 
      retentionDays: this.config.retentionDays,
      enablePersistence: this.config.enablePersistence
    });
  }

  /**
   * Initialize the cost tracker and load existing data
   */
  async initialize() {
    try {
      if (this.config.enablePersistence) {
        await this.dao.initialize();
        await this.loadBudgets();
        await this.loadRecentEvents();
      }
      
      // Set up periodic cleanup
      this.setupCleanup();
      
      // Set up budget monitoring
      this.setupBudgetMonitoring();
      
      this.isInitialized = true;
      logger.info('CostTracker: Initialization complete');
    } catch (error) {
      logger.error('CostTracker: Failed to initialize', { error: error.message });
      throw error;
    }
  }

  /**
   * Load budgets from database
   */
  async loadBudgets() {
    try {
      const budgets = await this.dao.getActiveBudgets();
      this.budgets.clear();
      
      for (const budget of budgets) {
        this.budgets.set(budget.id, budget);
      }
      
      logger.info('CostTracker: Loaded budgets from database', { count: budgets.length });
    } catch (error) {
      logger.error('CostTracker: Failed to load budgets', { error: error.message });
      // Continue without budgets if database fails
    }
  }

  /**
   * Load recent events for in-memory cache
   */
  async loadRecentEvents() {
    try {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 7); // Load last 7 days
      
      const events = await this.dao.getCostEvents(startDate, endDate);
      this.costRecords = events;
      
      // Rebuild totals from loaded events
      this.rebuildTotals();
      
      logger.info('CostTracker: Loaded recent events from database', { count: events.length });
    } catch (error) {
      logger.error('CostTracker: Failed to load recent events', { error: error.message });
      // Continue with empty cache if database fails
    }
  }

  /**
   * Rebuild totals from loaded events
   */
  rebuildTotals() {
    this.dailyTotals.clear();
    this.monthlyTotals.clear();
    this.providerTotals.clear();
    
    for (const event of this.costRecords) {
      const date = new Date(event.timestamp);
      const dayKey = date.toISOString().split('T')[0];
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      
      // Update daily totals
      this.dailyTotals.set(dayKey, (this.dailyTotals.get(dayKey) || 0) + event.totalCost);
      
      // Update monthly totals
      this.monthlyTotals.set(monthKey, (this.monthlyTotals.get(monthKey) || 0) + event.totalCost);
      
      // Update provider totals
      this.providerTotals.set(event.provider, (this.providerTotals.get(event.provider) || 0) + event.totalCost);
    }
  }

  /**
   * Track a cost event from LLM usage
   * @param {Object} event - Cost event data
   * @param {string} event.provider - Provider name (openai, anthropic)
   * @param {string} event.model - Model name
   * @param {number} event.inputTokens - Input token count
   * @param {number} event.outputTokens - Output token count
   * @param {string} event.documentId - Document ID
   * @param {string} event.sourceType - Source type
   * @param {string} event.operation - Operation type (enrichment, completion, etc.)
   * @param {Object} event.metadata - Additional metadata
   */
  async trackCostEvent(event) {
    try {
      const timestamp = new Date();
      const costs = this.calculateCosts(event.provider, event.model, event.inputTokens, event.outputTokens);
      
      const costRecord = {
        id: this.generateId(),
        timestamp,
        provider: event.provider,
        model: event.model,
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
        inputCost: costs.inputCost,
        outputCost: costs.outputCost,
        totalCost: costs.totalCost,
        documentId: event.documentId,
        sourceType: event.sourceType,
        operation: event.operation,
        metadata: event.metadata || {}
      };
      
      // Save to database if persistence is enabled
      let savedEvent = costRecord;
      if (this.config.enablePersistence) {
        savedEvent = await this.dao.saveCostEvent(costRecord);
      }
      
      // Add to in-memory cache
      this.costRecords.push(savedEvent);
      
      // Update running totals
      this.updateTotals(savedEvent);
      
      // Check budget limits
      await this.checkBudgetLimits(savedEvent);
      
      logger.debug('Cost event tracked', {
        provider: event.provider,
        model: event.model,
        totalCost: costs.totalCost,
        documentId: event.documentId
      });
      
      this.emit('cost_tracked', savedEvent);
      
      return savedEvent;
    } catch (error) {
      logger.error('Failed to track cost event', { error: error.message, event });
      throw error;
    }
  }

  /**
   * Calculate costs for a provider and model
   * @param {string} provider - Provider name
   * @param {string} model - Model name
   * @param {number} inputTokens - Input token count
   * @param {number} outputTokens - Output token count
   * @returns {Object} Cost breakdown
   */
  calculateCosts(provider, model, inputTokens, outputTokens) {
    const rates = this.costRates[provider]?.[model];
    
    if (!rates) {
      logger.warn('Unknown provider/model combination for cost calculation', { provider, model });
      return {
        inputCost: 0,
        outputCost: 0,
        totalCost: 0
      };
    }
    
    const inputCost = (inputTokens / 1000) * rates.input;
    const outputCost = (outputTokens / 1000) * rates.output;
    const totalCost = inputCost + outputCost;
    
    return {
      inputCost: Number(inputCost.toFixed(6)),
      outputCost: Number(outputCost.toFixed(6)),
      totalCost: Number(totalCost.toFixed(6))
    };
  }

  /**
   * Update running totals
   * @param {Object} costRecord - Cost record
   */
  updateTotals(costRecord) {
    const date = costRecord.timestamp.toISOString().split('T')[0]; // YYYY-MM-DD
    const month = date.substring(0, 7); // YYYY-MM
    
    // Daily totals
    const currentDaily = this.dailyTotals.get(date) || 0;
    this.dailyTotals.set(date, currentDaily + costRecord.totalCost);
    
    // Monthly totals
    const currentMonthly = this.monthlyTotals.get(month) || 0;
    this.monthlyTotals.set(month, currentMonthly + costRecord.totalCost);
    
    // Provider totals
    const currentProvider = this.providerTotals.get(costRecord.provider) || 0;
    this.providerTotals.set(costRecord.provider, currentProvider + costRecord.totalCost);
  }

  /**
   * Check if spending exceeds budget limits
   */
  async checkBudgetLimits(costEvent) {
    try {
      const now = new Date();
      
      // Check each active budget
      for (const [budgetId, budget] of this.budgets) {
        if (!budget.isActive) continue;
        
        // Calculate period boundaries
        const { periodStart, periodEnd } = this.getBudgetPeriod(budget.budgetType, now);
        
        // Get current spending for this budget
        let currentSpending;
        if (this.config.enablePersistence) {
          const spending = await this.dao.getBudgetSpending(budgetId, periodStart, periodEnd);
          currentSpending = spending.currentSpending;
        } else {
          currentSpending = this.calculateInMemorySpending(budget, periodStart, periodEnd);
        }
        
        const percentage = (currentSpending / budget.limitAmount) * 100;
        
        // Check if threshold exceeded
        if (percentage >= budget.alertThreshold * 100) {
          const alert = {
            budgetId: budgetId,
            alertType: percentage >= 100 ? 'exceeded' : 'threshold',
            currentAmount: currentSpending,
            limitAmount: budget.limitAmount,
            percentage: percentage,
            periodStart: periodStart,
            periodEnd: periodEnd,
            message: `Budget "${budget.name}" is at ${percentage.toFixed(1)}% of limit ($${currentSpending.toFixed(2)} / $${budget.limitAmount})`
          };
          
          // Save alert to database
          if (this.config.enablePersistence) {
            await this.dao.saveCostAlert(alert);
          }
          
          // Emit alert event
          this.emit('budgetAlert', alert);
          
          logger.warn('Budget alert triggered', {
            budgetName: budget.name,
            percentage: percentage.toFixed(1),
            currentSpending,
            limit: budget.limitAmount
          });
        }
      }
    } catch (error) {
      logger.error('CostTracker: Failed to check budget limits', { 
        error: error.message,
        costEvent 
      });
      // Don't throw - budget checking shouldn't break cost tracking
    }
  }

  /**
   * Calculate in-memory spending for a budget (fallback when database unavailable)
   */
  calculateInMemorySpending(budget, periodStart, periodEnd) {
    return this.costRecords
      .filter(event => {
        const eventDate = new Date(event.timestamp);
        return eventDate >= periodStart && eventDate <= periodEnd &&
               (!budget.providerFilter || event.provider === budget.providerFilter) &&
               (!budget.operationFilter || event.operation === budget.operationFilter) &&
               (!budget.sourceTypeFilter || event.sourceType === budget.sourceTypeFilter);
      })
      .reduce((sum, event) => sum + event.totalCost, 0);
  }

  /**
   * Get budget period boundaries
   */
  getBudgetPeriod(budgetType, date = new Date()) {
    const periodStart = new Date(date);
    const periodEnd = new Date(date);
    
    switch (budgetType) {
    case 'daily':
      periodStart.setHours(0, 0, 0, 0);
      periodEnd.setHours(23, 59, 59, 999);
      break;
    case 'weekly': {
      const dayOfWeek = periodStart.getDay();
      periodStart.setDate(periodStart.getDate() - dayOfWeek);
      periodStart.setHours(0, 0, 0, 0);
      periodEnd.setDate(periodStart.getDate() + 6);
      periodEnd.setHours(23, 59, 59, 999);
      break;
    }
    case 'monthly':
      periodStart.setDate(1);
      periodStart.setHours(0, 0, 0, 0);
      periodEnd.setMonth(periodEnd.getMonth() + 1, 0);
      periodEnd.setHours(23, 59, 59, 999);
      break;
    case 'yearly':
      periodStart.setMonth(0, 1);
      periodStart.setHours(0, 0, 0, 0);
      periodEnd.setMonth(11, 31);
      periodEnd.setHours(23, 59, 59, 999);
      break;
    default:
      throw new Error(`Invalid budget type: ${budgetType}`);
    }
    
    return { periodStart, periodEnd };
  }

  /**
   * Get cost summary for a date range
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date
   * @returns {Object} Cost summary
   */
  getCostSummary(startDate, endDate) {
    const filteredRecords = this.costRecords.filter(record => 
      record.timestamp >= startDate && record.timestamp <= endDate
    );
    
    const summary = {
      totalCost: 0,
      totalTokens: 0,
      recordCount: filteredRecords.length,
      byProvider: {},
      byModel: {},
      byOperation: {},
      bySourceType: {}
    };
    
    filteredRecords.forEach(record => {
      summary.totalCost += record.totalCost;
      summary.totalTokens += record.inputTokens + record.outputTokens;
      
      // By provider
      if (!summary.byProvider[record.provider]) {
        summary.byProvider[record.provider] = { cost: 0, tokens: 0, count: 0 };
      }
      summary.byProvider[record.provider].cost += record.totalCost;
      summary.byProvider[record.provider].tokens += record.inputTokens + record.outputTokens;
      summary.byProvider[record.provider].count++;
      
      // By model
      if (!summary.byModel[record.model]) {
        summary.byModel[record.model] = { cost: 0, tokens: 0, count: 0 };
      }
      summary.byModel[record.model].cost += record.totalCost;
      summary.byModel[record.model].tokens += record.inputTokens + record.outputTokens;
      summary.byModel[record.model].count++;
      
      // By operation
      if (!summary.byOperation[record.operation]) {
        summary.byOperation[record.operation] = { cost: 0, tokens: 0, count: 0 };
      }
      summary.byOperation[record.operation].cost += record.totalCost;
      summary.byOperation[record.operation].tokens += record.inputTokens + record.outputTokens;
      summary.byOperation[record.operation].count++;
      
      // By source type
      if (!summary.bySourceType[record.sourceType]) {
        summary.bySourceType[record.sourceType] = { cost: 0, tokens: 0, count: 0 };
      }
      summary.bySourceType[record.sourceType].cost += record.totalCost;
      summary.bySourceType[record.sourceType].tokens += record.inputTokens + record.outputTokens;
      summary.bySourceType[record.sourceType].count++;
    });
    
    return summary;
  }

  /**
   * Get daily cost totals
   * @returns {Map} Daily totals
   */
  getDailyTotals() {
    return new Map(this.dailyTotals);
  }

  /**
   * Get monthly cost totals
   * @returns {Map} Monthly totals
   */
  getMonthlyTotals() {
    return new Map(this.monthlyTotals);
  }

  /**
   * Get provider cost totals
   * @returns {Map} Provider totals
   */
  getProviderTotals() {
    return new Map(this.providerTotals);
  }

  /**
   * Get current budget status
   * @returns {Object} Budget status
   */
  getBudgetStatus() {
    const today = new Date().toISOString().split('T')[0];
    const thisMonth = today.substring(0, 7);
    
    const dailySpent = this.dailyTotals.get(today) || 0;
    const monthlySpent = this.monthlyTotals.get(thisMonth) || 0;
    
    return {
      daily: {
        spent: dailySpent,
        limit: this.config.budgetLimits.daily,
        remaining: Math.max(0, this.config.budgetLimits.daily - dailySpent),
        percentage: (dailySpent / this.config.budgetLimits.daily) * 100
      },
      monthly: {
        spent: monthlySpent,
        limit: this.config.budgetLimits.monthly,
        remaining: Math.max(0, this.config.budgetLimits.monthly - monthlySpent),
        percentage: (monthlySpent / this.config.budgetLimits.monthly) * 100
      }
    };
  }

  /**
   * Set up periodic cleanup of old records
   */
  setupCleanup() {
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 24 * 60 * 60 * 1000); // Daily cleanup
  }

  /**
   * Clean up old cost records
   */
  async cleanup() {
    try {
      const retentionDate = new Date();
      retentionDate.setDate(retentionDate.getDate() - this.config.retentionDays);
      
      let deletedCount = 0;
      
      // Clean up database records if persistence is enabled
      if (this.config.enablePersistence) {
        deletedCount = await this.dao.cleanupOldEvents(this.config.retentionDays);
      }
      
      // Clean up in-memory records
      const initialCount = this.costRecords.length;
      this.costRecords = this.costRecords.filter(record => 
        new Date(record.timestamp) > retentionDate
      );
      const memoryDeleted = initialCount - this.costRecords.length;
      
      // Rebuild totals after cleanup
      this.rebuildTotals();
      
      logger.info('CostTracker: Cleanup completed', {
        databaseDeleted: deletedCount,
        memoryDeleted: memoryDeleted,
        retentionDays: this.config.retentionDays
      });
      
      this.emit('cleanup_completed', { 
        deletedCount: deletedCount + memoryDeleted,
        retentionDays: this.config.retentionDays 
      });
      
      return deletedCount + memoryDeleted;
    } catch (error) {
      logger.error('CostTracker: Failed to cleanup old records', { 
        error: error.message 
      });
      throw error;
    }
  }

  /**
   * Close the cost tracker and cleanup resources
   */
  async close() {
    try {
      // Clear cleanup interval
      if (this.cleanupInterval) {
        clearInterval(this.cleanupInterval);
        this.cleanupInterval = null;
      }
      
      // Close database connection
      if (this.dao && this.config.enablePersistence) {
        await this.dao.close();
      }
      
      // Clear in-memory data
      this.costRecords = [];
      this.dailyTotals.clear();
      this.monthlyTotals.clear();
      this.providerTotals.clear();
      this.budgets.clear();
      
      this.isInitialized = false;
      
      logger.info('CostTracker: Closed successfully');
    } catch (error) {
      logger.error('CostTracker: Error during close', { error: error.message });
      throw error;
    }
  }

  /**
   * Set up budget monitoring
   */
  setupBudgetMonitoring() {
    this.on('budgetAlert', (alert) => {
      logger.warn('Budget alert triggered', alert);
    });
  }

  /**
   * Generate unique ID for cost records
   * @returns {string} Unique ID
   */
  generateId() {
    return `cost_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Shutdown the cost tracker
   */
  async shutdown() {
    logger.info('Shutting down CostTracker');
    this.removeAllListeners();
  }
}

module.exports = CostTracker;
