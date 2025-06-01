/**
 * Cost Reporting Service
 * 
 * Generates detailed cost reports and analytics for LLM usage.
 * Provides various report formats and export capabilities.
 */

const logger = require('../utils/logger');
const CostDAO = require('./CostDAO');

class CostReporter {
  constructor(config = {}) {
    this.config = {
      outputDir: config.outputDir || './reports/cost',
      enablePersistence: config.enablePersistence !== false,
      defaultFormat: config.defaultFormat || 'json',
      defaultDateRange: config.defaultDateRange || 30,
      reportFormats: config.reportFormats || ['json', 'csv', 'html'],
      ...config
    };
    
    // Database access
    this.dao = config.dao || new CostDAO(config.database);
    this.isInitialized = false;
    
    logger.info('CostReporter: Initialized', { 
      outputDir: this.config.outputDir,
      enablePersistence: this.config.enablePersistence
    });
  }

  /**
   * Initialize the cost reporter
   */
  async initialize() {
    try {
      if (this.config.enablePersistence) {
        await this.dao.initialize();
      }
      
      this.isInitialized = true;
      logger.info('CostReporter: Initialization complete');
    } catch (error) {
      logger.error('CostReporter: Failed to initialize', { error: error.message });
      throw error;
    }
  }

  /**
   * Generate a comprehensive cost report
   */
  async generateReport(options = {}) {
    try {
      const {
        startDate = new Date(Date.now() - this.config.defaultDateRange * 24 * 60 * 60 * 1000),
        endDate = new Date(),
        format = this.config.defaultFormat,
        includeAnalytics = true,
        includeTrends = true,
        includeRecommendations = true,
        groupBy = 'provider',
        filters = {}
      } = options;

      logger.info('CostReporter: Generating cost report', {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        format,
        groupBy
      });

      // Get cost events from database
      const costEvents = this.config.enablePersistence 
        ? await this.dao.getCostEvents(startDate, endDate, filters)
        : [];

      // Get cost summary
      const costSummary = this.config.enablePersistence
        ? await this.dao.getCostSummary(startDate, endDate, groupBy)
        : this.generateInMemorySummary(costEvents, groupBy);

      // Get budgets for budget status
      const budgets = this.config.enablePersistence
        ? await this.dao.getActiveBudgets()
        : [];

      // Build comprehensive report
      const report = {
        metadata: {
          generatedAt: new Date().toISOString(),
          dateRange: {
            start: startDate.toISOString(),
            end: endDate.toISOString()
          },
          filters,
          groupBy,
          format
        },
        summary: this.generateOverallSummary(costEvents, costSummary),
        breakdown: costSummary,
        events: costEvents.slice(0, 1000), // Limit events for report size
        ...(includeAnalytics && { analytics: await this.generateAnalytics(costEvents, costSummary) }),
        ...(includeTrends && { trends: this.generateTrends(costEvents) }),
        ...(includeRecommendations && { recommendations: this.generateRecommendations(costSummary, budgets, costEvents) })
      };

      // Save report to database if persistence enabled
      if (this.config.enablePersistence) {
        const reportRecord = {
          reportName: `Cost Report ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`,
          reportType: this.determineReportType(startDate, endDate),
          dateRangeStart: startDate,
          dateRangeEnd: endDate,
          totalCost: report.summary.totalCost,
          totalTokens: report.summary.totalTokens,
          recordCount: costEvents.length,
          reportData: report,
          format: format,
          generatedBy: options.generatedBy || 'system'
        };

        await this.dao.saveCostReport(reportRecord);
      }

      logger.info('CostReporter: Report generated successfully', {
        totalCost: report.summary.totalCost,
        eventCount: costEvents.length,
        format
      });

      return this.formatReport(report, format);
    } catch (error) {
      logger.error('CostReporter: Failed to generate report', { 
        error: error.message,
        options 
      });
      throw error;
    }
  }

  /**
   * Generate overall summary from cost events and breakdown
   */
  generateOverallSummary(costEvents, costSummary) {
    const totalCost = costEvents.reduce((sum, event) => sum + event.totalCost, 0);
    const totalTokens = costEvents.reduce((sum, event) => sum + event.inputTokens + event.outputTokens, 0);
    
    return {
      totalCost: totalCost,
      totalTokens: totalTokens,
      recordCount: costEvents.length,
      avgCostPerEvent: costEvents.length > 0 ? totalCost / costEvents.length : 0,
      avgCostPerToken: totalTokens > 0 ? totalCost / totalTokens : 0,
      dateRange: {
        start: costEvents.length > 0 ? Math.min(...costEvents.map(e => new Date(e.timestamp).getTime())) : null,
        end: costEvents.length > 0 ? Math.max(...costEvents.map(e => new Date(e.timestamp).getTime())) : null
      },
      providers: [...new Set(costEvents.map(e => e.provider))],
      models: [...new Set(costEvents.map(e => e.model))],
      operations: [...new Set(costEvents.map(e => e.operation))]
    };
  }

  /**
   * Generate in-memory summary when database is not available
   */
  generateInMemorySummary(costEvents, groupBy) {
    const groups = new Map();
    
    for (const event of costEvents) {
      const key = event[groupBy] || 'unknown';
      if (!groups.has(key)) {
        groups.set(key, {
          [groupBy]: key,
          eventCount: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalCost: 0,
          avgCost: 0,
          firstEvent: event.timestamp,
          lastEvent: event.timestamp
        });
      }
      
      const group = groups.get(key);
      group.eventCount++;
      group.totalInputTokens += event.inputTokens;
      group.totalOutputTokens += event.outputTokens;
      group.totalCost += event.totalCost;
      group.avgCost = group.totalCost / group.eventCount;
      
      if (new Date(event.timestamp) < new Date(group.firstEvent)) {
        group.firstEvent = event.timestamp;
      }
      if (new Date(event.timestamp) > new Date(group.lastEvent)) {
        group.lastEvent = event.timestamp;
      }
    }
    
    return Array.from(groups.values()).sort((a, b) => b.totalCost - a.totalCost);
  }

  /**
   * Determine report type based on date range
   */
  determineReportType(startDate, endDate) {
    const diffDays = (endDate - startDate) / (1000 * 60 * 60 * 24);
    
    if (diffDays <= 1) return 'daily';
    if (diffDays <= 7) return 'weekly';
    if (diffDays <= 31) return 'monthly';
    if (diffDays <= 365) return 'yearly';
    return 'custom';
  }

  /**
   * Generate detailed analytics
   * @param {Array} costEvents - Cost events
   * @param {Object} costSummary - Cost summary
   * @returns {Object} Analytics data
   */
  async generateAnalytics(costEvents, costSummary) {
    const summary = costSummary;
    
    // Calculate efficiency metrics
    const avgCostPerDocument = summary.recordCount > 0 ? summary.totalCost / summary.recordCount : 0;
    const avgTokensPerDocument = summary.recordCount > 0 ? summary.totalTokens / summary.recordCount : 0;
    const avgCostPerToken = summary.totalTokens > 0 ? summary.totalCost / summary.totalTokens : 0;
    
    // Find most/least expensive operations
    const operationsByEfficiency = Object.entries(summary.byOperation)
      .map(([operation, data]) => ({
        operation,
        ...data,
        avgCostPerDocument: data.count > 0 ? data.cost / data.count : 0,
        avgCostPerToken: data.tokens > 0 ? data.cost / data.tokens : 0
      }))
      .sort((a, b) => b.avgCostPerDocument - a.avgCostPerDocument);

    // Provider efficiency comparison
    const providerEfficiency = Object.entries(summary.byProvider)
      .map(([provider, data]) => ({
        provider,
        ...data,
        avgCostPerDocument: data.count > 0 ? data.cost / data.count : 0,
        avgCostPerToken: data.tokens > 0 ? data.cost / data.tokens : 0,
        marketShare: (data.cost / summary.totalCost) * 100
      }))
      .sort((a, b) => b.marketShare - a.marketShare);

    return {
      efficiency: {
        avgCostPerDocument,
        avgTokensPerDocument,
        avgCostPerToken
      },
      operationsByEfficiency,
      providerEfficiency,
      topModels: this.getTopModels(summary.byModel),
      topSourceTypes: this.getTopSourceTypes(summary.bySourceType)
    };
  }

  /**
   * Generate cost trends over time
   * @param {Array} costEvents - Cost events
   * @returns {Object} Trends data
   */
  async generateTrends(costEvents) {
    const dailyTotals = await this.dao.getDailyTotals();
    const monthlyTotals = await this.dao.getMonthlyTotals();
    
    // Filter data for the requested date range
    const dailyData = [];
    const currentDate = new Date(costEvents[0].date);
    
    while (currentDate <= new Date(costEvents[costEvents.length - 1].date)) {
      const dateStr = currentDate.toISOString().split('T')[0];
      const cost = dailyTotals.get(dateStr) || 0;
      dailyData.push({
        date: dateStr,
        cost
      });
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    // Calculate growth rates
    const dailyGrowthRate = this.calculateGrowthRate(dailyData);
    const weeklyAverage = this.calculateWeeklyAverage(dailyData);
    
    return {
      daily: dailyData,
      weekly: weeklyAverage,
      monthly: Array.from(monthlyTotals.entries()).map(([month, cost]) => ({
        month,
        cost
      })),
      growthRate: dailyGrowthRate,
      projections: this.generateProjections(dailyData)
    };
  }

  /**
   * Generate cost recommendations
   * @param {Object} summary - Cost summary
   * @param {Object} budgetStatus - Budget status
   * @param {Object} trends - Trends data
   * @returns {Array} Recommendations
   */
  generateRecommendations(summary, budgetStatus, trends) {
    const recommendations = [];
    
    // Budget recommendations
    if (budgetStatus.daily.percentage > 80) {
      recommendations.push({
        type: 'budget_alert',
        priority: 'high',
        message: `Daily budget is ${budgetStatus.daily.percentage.toFixed(1)}% utilized`,
        action: 'Consider reducing LLM usage or increasing daily budget'
      });
    }
    
    if (budgetStatus.monthly.percentage > 90) {
      recommendations.push({
        type: 'budget_alert',
        priority: 'critical',
        message: `Monthly budget is ${budgetStatus.monthly.percentage.toFixed(1)}% utilized`,
        action: 'Immediate action required to avoid budget overrun'
      });
    }
    
    // Provider optimization recommendations
    const providers = Object.entries(summary.byProvider);
    if (providers.length > 1) {
      const mostExpensive = providers.reduce((max, current) => 
        current[1].cost > max[1].cost ? current : max
      );
      
      const avgCostPerToken = mostExpensive[1].tokens > 0 ? 
        mostExpensive[1].cost / mostExpensive[1].tokens : 0;
      
      if (avgCostPerToken > 0.001) { // Threshold for expensive tokens
        recommendations.push({
          type: 'optimization',
          priority: 'medium',
          message: `${mostExpensive[0]} has high cost per token (${avgCostPerToken.toFixed(6)})`,
          action: 'Consider using more cost-effective models for routine tasks'
        });
      }
    }
    
    // Usage pattern recommendations
    if (trends.growthRate > 50) {
      recommendations.push({
        type: 'growth_alert',
        priority: 'medium',
        message: `Cost growth rate is ${trends.growthRate.toFixed(1)}% over the period`,
        action: 'Monitor usage patterns and consider optimization strategies'
      });
    }
    
    return recommendations;
  }

  /**
   * Get top models by cost
   * @param {Object} modelData - Model data
   * @returns {Array} Top models
   */
  getTopModels(modelData) {
    return Object.entries(modelData)
      .map(([model, data]) => ({
        model,
        ...data,
        avgCostPerDocument: data.count > 0 ? data.cost / data.count : 0
      }))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 10);
  }

  /**
   * Get top source types by cost
   * @param {Object} sourceTypeData - Source type data
   * @returns {Array} Top source types
   */
  getTopSourceTypes(sourceTypeData) {
    return Object.entries(sourceTypeData)
      .map(([sourceType, data]) => ({
        sourceType,
        ...data,
        avgCostPerDocument: data.count > 0 ? data.cost / data.count : 0
      }))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 10);
  }

  /**
   * Calculate growth rate
   * @param {Array} dailyData - Daily cost data
   * @returns {number} Growth rate percentage
   */
  calculateGrowthRate(dailyData) {
    if (dailyData.length < 2) return 0;
    
    const firstWeek = dailyData.slice(0, 7);
    const lastWeek = dailyData.slice(-7);
    
    const firstWeekAvg = firstWeek.reduce((sum, day) => sum + day.cost, 0) / firstWeek.length;
    const lastWeekAvg = lastWeek.reduce((sum, day) => sum + day.cost, 0) / lastWeek.length;
    
    if (firstWeekAvg === 0) return 0;
    
    return ((lastWeekAvg - firstWeekAvg) / firstWeekAvg) * 100;
  }

  /**
   * Calculate weekly averages
   * @param {Array} dailyData - Daily cost data
   * @returns {Array} Weekly averages
   */
  calculateWeeklyAverage(dailyData) {
    const weeks = [];
    
    for (let i = 0; i < dailyData.length; i += 7) {
      const week = dailyData.slice(i, i + 7);
      const weekAvg = week.reduce((sum, day) => sum + day.cost, 0) / week.length;
      const weekStart = week[0]?.date;
      const weekEnd = week[week.length - 1]?.date;
      
      weeks.push({
        weekStart,
        weekEnd,
        avgDailyCost: weekAvg,
        totalCost: week.reduce((sum, day) => sum + day.cost, 0)
      });
    }
    
    return weeks;
  }

  /**
   * Generate cost projections
   * @param {Array} dailyData - Daily cost data
   * @returns {Object} Projections
   */
  generateProjections(dailyData) {
    if (dailyData.length < 7) return null;
    
    const recentWeek = dailyData.slice(-7);
    const avgDailyCost = recentWeek.reduce((sum, day) => sum + day.cost, 0) / recentWeek.length;
    
    return {
      nextWeek: avgDailyCost * 7,
      nextMonth: avgDailyCost * 30,
      basedOnDays: recentWeek.length
    };
  }

  /**
   * Format report based on requested format
   * @param {Object} report - Report data
   * @param {string} format - Format type
   * @returns {string|Object} Formatted report
   */
  formatReport(report, format) {
    switch (format.toLowerCase()) {
    case 'json':
      return report;
      
    case 'csv':
      return this.formatAsCSV(report);
      
    case 'html':
      return this.formatAsHTML(report);
      
    default:
      return report;
    }
  }

  /**
   * Format report as CSV
   * @param {Object} report - Report data
   * @returns {string} CSV formatted report
   */
  formatAsCSV(report) {
    const lines = [];
    
    // Summary section
    lines.push('COST SUMMARY');
    lines.push('Total Cost,Total Tokens,Record Count');
    lines.push(`${report.summary.totalCost},${report.summary.totalTokens},${report.summary.recordCount}`);
    lines.push('');
    
    // Provider breakdown
    lines.push('PROVIDER BREAKDOWN');
    lines.push('Provider,Cost,Tokens,Count,Avg Cost Per Document');
    Object.entries(report.summary.byProvider).forEach(([provider, data]) => {
      const avgCost = data.count > 0 ? data.cost / data.count : 0;
      lines.push(`${provider},${data.cost},${data.tokens},${data.count},${avgCost}`);
    });
    lines.push('');
    
    // Daily trends
    lines.push('DAILY TRENDS');
    lines.push('Date,Cost');
    report.trends.daily.forEach(day => {
      lines.push(`${day.date},${day.cost}`);
    });
    
    return lines.join('\n');
  }

  /**
   * Format report as HTML
   * @param {Object} report - Report data
   * @returns {string} HTML formatted report
   */
  formatAsHTML(report) {
    return `
<!DOCTYPE html>
<html>
<head>
    <title>Cost Report - ${report.metadata.dateRange.startDate} to ${report.metadata.dateRange.endDate}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        table { border-collapse: collapse; width: 100%; margin: 20px 0; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f2f2f2; }
        .summary { background-color: #f9f9f9; padding: 15px; border-radius: 5px; }
        .alert { color: red; font-weight: bold; }
        .recommendation { background-color: #fff3cd; padding: 10px; margin: 10px 0; border-radius: 5px; }
    </style>
</head>
<body>
    <h1>LLM Cost Report</h1>
    <div class="summary">
        <h2>Summary</h2>
        <p><strong>Total Cost:</strong> $${report.summary.totalCost.toFixed(2)}</p>
        <p><strong>Total Tokens:</strong> ${report.summary.totalTokens.toLocaleString()}</p>
        <p><strong>Records:</strong> ${report.summary.recordCount}</p>
        <p><strong>Period:</strong> ${report.metadata.dateRange.startDate} to ${report.metadata.dateRange.endDate}</p>
    </div>
    
    <h2>Budget Status</h2>
    <table>
        <tr><th>Period</th><th>Spent</th><th>Limit</th><th>Remaining</th><th>Usage %</th></tr>
        <tr>
            <td>Daily</td>
            <td>$${report.budgetStatus.daily.spent.toFixed(2)}</td>
            <td>$${report.budgetStatus.daily.limit.toFixed(2)}</td>
            <td>$${report.budgetStatus.daily.remaining.toFixed(2)}</td>
            <td class="${report.budgetStatus.daily.percentage > 80 ? 'alert' : ''}">${report.budgetStatus.daily.percentage.toFixed(1)}%</td>
        </tr>
        <tr>
            <td>Monthly</td>
            <td>$${report.budgetStatus.monthly.spent.toFixed(2)}</td>
            <td>$${report.budgetStatus.monthly.limit.toFixed(2)}</td>
            <td>$${report.budgetStatus.monthly.remaining.toFixed(2)}</td>
            <td class="${report.budgetStatus.monthly.percentage > 80 ? 'alert' : ''}">${report.budgetStatus.monthly.percentage.toFixed(1)}%</td>
        </tr>
    </table>
    
    <h2>Recommendations</h2>
    ${report.recommendations.map(rec => `
        <div class="recommendation">
            <strong>${rec.priority.toUpperCase()}:</strong> ${rec.message}<br>
            <em>Action:</em> ${rec.action}
        </div>
    `).join('')}
    
    <h2>Provider Breakdown</h2>
    <table>
        <tr><th>Provider</th><th>Cost</th><th>Tokens</th><th>Count</th><th>Avg Cost/Doc</th></tr>
        ${Object.entries(report.summary.byProvider).map(([provider, data]) => `
            <tr>
                <td>${provider}</td>
                <td>$${data.cost.toFixed(2)}</td>
                <td>${data.tokens.toLocaleString()}</td>
                <td>${data.count}</td>
                <td>$${(data.count > 0 ? data.cost / data.count : 0).toFixed(4)}</td>
            </tr>
        `).join('')}
    </table>
</body>
</html>`;
  }

  /**
   * Get default start date
   * @returns {Date} Default start date
   */
  getDefaultStartDate() {
    const date = new Date();
    date.setDate(date.getDate() - this.config.defaultDateRange);
    return date;
  }

  /**
   * Export report to file
   * @param {Object} report - Report data
   * @param {string} format - Format type
   * @param {string} filename - Output filename
   * @returns {string} File path
   */
  async exportReport(report, format, filename) {
    const fs = require('fs').promises;
    const path = require('path');
    
    const formattedReport = this.formatReport(report, format);
    const content = typeof formattedReport === 'string' ? formattedReport : JSON.stringify(formattedReport, null, 2);
    
    const exportDir = path.join(process.cwd(), 'exports', 'cost-reports');
    await fs.mkdir(exportDir, { recursive: true });
    
    const filePath = path.join(exportDir, filename);
    await fs.writeFile(filePath, content);
    
    logger.info('Cost report exported', { filePath, format });
    return filePath;
  }
}

module.exports = CostReporter;
