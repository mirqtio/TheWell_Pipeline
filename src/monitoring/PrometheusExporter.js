/**
 * Prometheus Metrics Exporter
 * Exports system metrics in Prometheus format for monitoring stack integration
 */

const promClient = require('prom-client');
const logger = require('../utils/logger');

class PrometheusExporter {
  constructor(config = {}) {
    this.config = {
      enableDefaultMetrics: config.enableDefaultMetrics !== false,
      prefix: config.prefix || 'thewell_',
      collectInterval: config.collectInterval || 10000, // 10 seconds
      ...config
    };

    // Initialize Prometheus client
    this.register = new promClient.Registry();
    
    // Add default metrics if enabled
    if (this.config.enableDefaultMetrics) {
      promClient.collectDefaultMetrics({
        register: this.register,
        prefix: this.config.prefix
      });
    }

    // Initialize custom metrics
    this.initializeCustomMetrics();
    
    this.isInitialized = false;
  }

  initializeCustomMetrics() {
    // Cost metrics
    this.costMetrics = {
      totalCost: new promClient.Gauge({
        name: `${this.config.prefix}cost_total`,
        help: 'Total cost incurred',
        labelNames: ['provider', 'model', 'source_type']
      }),
      
      costRate: new promClient.Gauge({
        name: `${this.config.prefix}cost_rate`,
        help: 'Cost rate per hour',
        labelNames: ['provider', 'model']
      }),

      budgetUtilization: new promClient.Gauge({
        name: `${this.config.prefix}budget_utilization`,
        help: 'Budget utilization percentage',
        labelNames: ['budget_name', 'period']
      }),

      tokensProcessed: new promClient.Counter({
        name: `${this.config.prefix}tokens_processed_total`,
        help: 'Total tokens processed',
        labelNames: ['provider', 'model', 'type']
      })
    };

    // Quality metrics
    this.qualityMetrics = {
      apiResponseTime: new promClient.Histogram({
        name: `${this.config.prefix}api_response_time_seconds`,
        help: 'API response time in seconds',
        labelNames: ['endpoint', 'method', 'status_code'],
        buckets: [0.1, 0.5, 1, 2, 5, 10]
      }),

      errorRate: new promClient.Gauge({
        name: `${this.config.prefix}error_rate`,
        help: 'Error rate percentage',
        labelNames: ['service', 'endpoint']
      }),

      sloCompliance: new promClient.Gauge({
        name: `${this.config.prefix}slo_compliance`,
        help: 'SLO compliance percentage',
        labelNames: ['slo_name', 'window']
      }),

      documentProcessingTime: new promClient.Histogram({
        name: `${this.config.prefix}document_processing_time_seconds`,
        help: 'Document processing time in seconds',
        labelNames: ['strategy', 'content_type'],
        buckets: [1, 5, 10, 30, 60, 300]
      })
    };

    // System metrics
    this.systemMetrics = {
      activeConnections: new promClient.Gauge({
        name: `${this.config.prefix}active_connections`,
        help: 'Number of active connections',
        labelNames: ['service']
      }),

      queueSize: new promClient.Gauge({
        name: `${this.config.prefix}queue_size`,
        help: 'Queue size',
        labelNames: ['queue_name']
      }),

      cacheHitRate: new promClient.Gauge({
        name: `${this.config.prefix}cache_hit_rate`,
        help: 'Cache hit rate percentage',
        labelNames: ['cache_type']
      }),

      documentsIngested: new promClient.Counter({
        name: `${this.config.prefix}documents_ingested_total`,
        help: 'Total documents ingested',
        labelNames: ['source_type', 'status']
      })
    };

    // Register all metrics
    Object.values(this.costMetrics).forEach(metric => this.register.registerMetric(metric));
    Object.values(this.qualityMetrics).forEach(metric => this.register.registerMetric(metric));
    Object.values(this.systemMetrics).forEach(metric => this.register.registerMetric(metric));
  }

  async initialize() {
    try {
      logger.info('Initializing Prometheus Exporter...');
      this.isInitialized = true;
      logger.info('Prometheus Exporter initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Prometheus Exporter:', error);
      throw error;
    }
  }

  // Cost tracking methods
  recordCost(provider, model, sourceType, amount) {
    this.costMetrics.totalCost.set(
      { provider, model, source_type: sourceType },
      amount
    );
  }

  recordTokens(provider, model, type, count) {
    this.costMetrics.tokensProcessed.inc(
      { provider, model, type },
      count
    );
  }

  updateBudgetUtilization(budgetName, period, percentage) {
    this.costMetrics.budgetUtilization.set(
      { budget_name: budgetName, period },
      percentage
    );
  }

  // Quality tracking methods
  recordApiResponse(endpoint, method, statusCode, responseTime) {
    this.qualityMetrics.apiResponseTime
      .labels(endpoint, method, statusCode)
      .observe(responseTime / 1000); // Convert to seconds
  }

  updateErrorRate(service, endpoint, rate) {
    this.qualityMetrics.errorRate.set(
      { service, endpoint },
      rate
    );
  }

  updateSloCompliance(sloName, window, compliance) {
    this.qualityMetrics.sloCompliance.set(
      { slo_name: sloName, window },
      compliance
    );
  }

  recordDocumentProcessing(strategy, contentType, processingTime) {
    this.qualityMetrics.documentProcessingTime
      .labels(strategy, contentType)
      .observe(processingTime / 1000); // Convert to seconds
  }

  // System tracking methods
  updateActiveConnections(service, count) {
    this.systemMetrics.activeConnections.set({ service }, count);
  }

  updateQueueSize(queueName, size) {
    this.systemMetrics.queueSize.set({ queue_name: queueName }, size);
  }

  updateCacheHitRate(cacheType, rate) {
    this.systemMetrics.cacheHitRate.set({ cache_type: cacheType }, rate);
  }

  recordDocumentIngested(sourceType, status) {
    this.systemMetrics.documentsIngested.inc({ source_type: sourceType, status });
  }

  // Export methods
  async getMetrics() {
    return await this.register.metrics();
  }

  async getMetricsAsString() {
    return await this.register.metrics();
  }

  getContentType() {
    return this.register.contentType;
  }

  // Integration with existing monitoring components
  integrateWithCostTracker(costTracker) {
    if (!costTracker) return;

    costTracker.on('cost_tracked', (event) => {
      this.recordCost(
        event.provider,
        event.model,
        event.sourceType,
        event.totalCost
      );

      this.recordTokens(
        event.provider,
        event.model,
        'input',
        event.inputTokens
      );

      this.recordTokens(
        event.provider,
        event.model,
        'output',
        event.outputTokens
      );
    });

    costTracker.on('budget_check', (event) => {
      this.updateBudgetUtilization(
        event.budgetName,
        event.period,
        event.utilizationPercentage
      );
    });
  }

  integrateWithQualityMetrics(qualityMetrics) {
    if (!qualityMetrics) return;

    qualityMetrics.on('metric_recorded', (event) => {
      if (event.type === 'api_response_time') {
        this.recordApiResponse(
          event.endpoint,
          event.method,
          event.statusCode,
          event.responseTime
        );
      } else if (event.type === 'document_processing') {
        this.recordDocumentProcessing(
          event.strategy,
          event.contentType,
          event.processingTime
        );
      }
    });

    qualityMetrics.on('slo_checked', (event) => {
      this.updateSloCompliance(
        event.sloName,
        event.window,
        event.compliance
      );
    });
  }

  // Health check
  getStatus() {
    return {
      initialized: this.isInitialized,
      registeredMetrics: this.register.getMetricsAsArray().length,
      config: {
        prefix: this.config.prefix,
        collectInterval: this.config.collectInterval
      }
    };
  }

  async shutdown() {
    try {
      logger.info('Shutting down Prometheus Exporter...');
      this.register.clear();
      this.isInitialized = false;
      logger.info('Prometheus Exporter shutdown complete');
    } catch (error) {
      logger.error('Error during Prometheus Exporter shutdown:', error);
      throw error;
    }
  }
}

module.exports = PrometheusExporter;