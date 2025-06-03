/**
 * Quality Metrics Collection and Analysis
 * Tracks error rates, latency, uptime, and SLO compliance
 */

const EventEmitter = require('events');
const logger = require('../utils/logger');

class QualityMetrics extends EventEmitter {
  constructor(dao) {
    super();
    this.dao = dao;
    this.metrics = new Map();
    this.slos = new Map();
    this.windows = {
      '1m': 60 * 1000,
      '5m': 5 * 60 * 1000,
      '15m': 15 * 60 * 1000,
      '1h': 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000
    };
    
    // Initialize default SLOs
    this.initializeDefaultSLOs();
    
    // Start periodic cleanup
    this.startCleanup();
  }

  initializeDefaultSLOs() {
    // API Response Time SLOs
    this.slos.set('api_response_time_p95', {
      name: 'API Response Time P95',
      target: 2000, // 2 seconds
      metric: 'response_time',
      percentile: 95,
      window: '5m',
      threshold: 0.95 // 95% of requests should meet this
    });

    this.slos.set('api_response_time_p99', {
      name: 'API Response Time P99',
      target: 5000, // 5 seconds
      metric: 'response_time',
      percentile: 99,
      window: '5m',
      threshold: 0.99
    });

    // Error Rate SLOs
    this.slos.set('api_error_rate', {
      name: 'API Error Rate',
      target: 0.01, // 1% error rate
      metric: 'error_rate',
      window: '5m',
      threshold: 0.99 // 99% of time should be below 1% error rate
    });

    // Availability SLO
    this.slos.set('service_availability', {
      name: 'Service Availability',
      target: 0.999, // 99.9% uptime
      metric: 'availability',
      window: '24h',
      threshold: 0.999
    });

    // LLM Processing SLOs
    this.slos.set('llm_processing_time_p95', {
      name: 'LLM Processing Time P95',
      target: 10000, // 10 seconds
      metric: 'llm_processing_time',
      percentile: 95,
      window: '15m',
      threshold: 0.95
    });

    this.slos.set('llm_success_rate', {
      name: 'LLM Success Rate',
      target: 0.98, // 98% success rate
      metric: 'llm_success_rate',
      window: '15m',
      threshold: 0.98
    });
  }

  /**
   * Record a metric event
   */
  recordMetric(type, value, labels = {}) {
    const timestamp = Date.now();
    const metricKey = this.getMetricKey(type, labels);
    
    if (!this.metrics.has(metricKey)) {
      this.metrics.set(metricKey, []);
    }
    
    const metrics = this.metrics.get(metricKey);
    metrics.push({ timestamp, value, labels });
    
    // Keep only recent metrics (last 24 hours)
    const cutoff = timestamp - this.windows['24h'];
    const filtered = metrics.filter(m => m.timestamp > cutoff);
    this.metrics.set(metricKey, filtered);
    
    // Check SLO violations
    this.checkSLOViolations(type, labels);
    
    // Emit metric event
    this.emit('metric', { type, value, labels, timestamp });
  }

  /**
   * Record API request metrics
   */
  recordAPIRequest(endpoint, method, statusCode, responseTime, userId = null) {
    try {
      const labels = { endpoint, method, userId };
      
      // Record response time
      this.recordMetric('response_time', responseTime, labels);
      
      // Record request count
      this.recordMetric('request_count', 1, labels);
      
      // Record error if status code indicates failure
      if (statusCode >= 400) {
        this.recordMetric('error_count', 1, { ...labels, statusCode });
      } else {
        this.recordMetric('success_count', 1, labels);
      }
      
      // Record availability (successful request)
      this.recordMetric('availability', statusCode < 500 ? 1 : 0, labels);
    } catch (error) {
      logger.error('Failed to record API request metrics', { 
        error: error.message, 
        endpoint, 
        method, 
        statusCode 
      });
    }
  }

  /**
   * Record LLM processing metrics
   */
  recordLLMProcessing(provider, model, operation, processingTime, success, error = null) {
    const labels = { provider, model, operation };
    
    // Record processing time
    this.recordMetric('llm_processing_time', processingTime, labels);
    
    // Record success/failure
    this.recordMetric('llm_success_rate', success ? 1 : 0, labels);
    
    if (!success && error) {
      this.recordMetric('llm_error_count', 1, { ...labels, error: error.message });
    }
  }

  /**
   * Record database operation metrics
   */
  recordDatabaseOperation(operation, table, duration, success, error = null) {
    const labels = { operation, table };
    
    // Record operation duration
    this.recordMetric('db_operation_time', duration, labels);
    
    // Record success/failure
    this.recordMetric('db_success_rate', success ? 1 : 0, labels);
    
    if (!success && error) {
      this.recordMetric('db_error_count', 1, { ...labels, error: error.message });
    }
  }

  /**
   * Calculate metrics for a time window
   */
  calculateMetrics(type, labels = {}, window = '5m') {
    const metricKey = this.getMetricKey(type, labels);
    const metrics = this.metrics.get(metricKey) || [];
    
    const windowMs = this.windows[window];
    const cutoff = Date.now() - windowMs;
    const windowMetrics = metrics.filter(m => m.timestamp > cutoff);
    
    if (windowMetrics.length === 0) {
      return {
        count: 0,
        avg: 0,
        min: 0,
        max: 0,
        p50: 0,
        p95: 0,
        p99: 0,
        sum: 0
      };
    }
    
    const values = windowMetrics.map(m => m.value).sort((a, b) => a - b);
    const sum = values.reduce((acc, val) => acc + val, 0);
    
    return {
      count: values.length,
      avg: sum / values.length,
      min: values[0],
      max: values[values.length - 1],
      p50: this.percentile(values, 50),
      p95: this.percentile(values, 95),
      p99: this.percentile(values, 99),
      sum
    };
  }

  /**
   * Calculate error rate for a time window
   */
  calculateErrorRate(labels = {}, window = '5m') {
    const errorMetrics = this.calculateMetrics('error_count', labels, window);
    const successMetrics = this.calculateMetrics('success_count', labels, window);
    
    const totalRequests = errorMetrics.sum + successMetrics.sum;
    if (totalRequests === 0) return 0;
    
    return errorMetrics.sum / totalRequests;
  }

  /**
   * Calculate availability for a time window
   */
  calculateAvailability(labels = {}, window = '24h') {
    const availabilityMetrics = this.calculateMetrics('availability', labels, window);
    
    if (availabilityMetrics.count === 0) return 1; // Assume available if no data
    
    return availabilityMetrics.avg;
  }

  /**
   * Check SLO compliance
   */
  checkSLOCompliance(sloId, window = null) {
    const slo = this.slos.get(sloId);
    if (!slo) {
      throw new Error(`SLO not found: ${sloId}`);
    }
    
    const checkWindow = window || slo.window;
    let currentValue;
    
    switch (slo.metric) {
    case 'response_time': {
      const responseMetrics = this.calculateMetrics('response_time', {}, checkWindow);
      currentValue = slo.percentile === 95 ? responseMetrics.p95 : responseMetrics.p99;
      break;
    }
        
    case 'error_rate':
      currentValue = this.calculateErrorRate({}, checkWindow);
      break;
        
    case 'availability':
      currentValue = this.calculateAvailability({}, checkWindow);
      break;
        
    case 'llm_processing_time': {
      const llmMetrics = this.calculateMetrics('llm_processing_time', {}, checkWindow);
      currentValue = slo.percentile === 95 ? llmMetrics.p95 : llmMetrics.p99;
      break;
    }
        
    case 'llm_success_rate': {
      const llmSuccessMetrics = this.calculateMetrics('llm_success_rate', {}, checkWindow);
      currentValue = llmSuccessMetrics.avg;
      break;
    }
        
    default:
      throw new Error(`Unknown SLO metric: ${slo.metric}`);
    }
    
    const isCompliant = (slo.metric === 'error_rate' || slo.metric === 'response_time' || slo.metric === 'llm_processing_time') ? 
      currentValue <= slo.target : 
      currentValue >= slo.target;
    
    return {
      sloId,
      name: slo.name,
      target: slo.target,
      current: currentValue,
      isCompliant,
      threshold: slo.threshold,
      window: checkWindow
    };
  }

  /**
   * Get all SLO compliance status
   */
  getAllSLOCompliance() {
    const results = [];
    
    for (const sloId of this.slos.keys()) {
      try {
        results.push(this.checkSLOCompliance(sloId));
      } catch (error) {
        logger.error('Error checking SLO compliance', { sloId, error: error.message });
      }
    }
    
    return results;
  }

  /**
   * Check for SLO violations and emit alerts
   */
  checkSLOViolations(metricType, labels) {
    // Check relevant SLOs based on metric type
    const relevantSLOs = Array.from(this.slos.entries()).filter(([_, slo]) => {
      return slo.metric === metricType || 
             (metricType === 'response_time' && slo.metric === 'response_time') ||
             (metricType === 'error_count' && slo.metric === 'error_rate') ||
             (metricType === 'availability' && slo.metric === 'availability');
    });
    
    for (const [sloId, slo] of relevantSLOs) {
      try {
        const compliance = this.checkSLOCompliance(sloId);
        
        if (!compliance.isCompliant) {
          this.emit('sloViolation', {
            sloId,
            slo,
            compliance,
            labels,
            timestamp: Date.now()
          });
          
          logger.warn('SLO violation detected', {
            sloId,
            target: slo.target,
            current: compliance.current,
            labels
          });
        }
      } catch (error) {
        logger.error('Error checking SLO violation', { sloId, error: error.message });
      }
    }
  }

  /**
   * Generate quality report
   */
  async generateQualityReport(window = '24h') {
    const report = {
      timestamp: new Date().toISOString(),
      window,
      metrics: {},
      slos: this.getAllSLOCompliance(),
      summary: {}
    };
    
    // API Metrics
    report.metrics.api = {
      responseTime: this.calculateMetrics('response_time', {}, window),
      errorRate: this.calculateErrorRate({}, window),
      availability: this.calculateAvailability({}, window),
      requestCount: this.calculateMetrics('request_count', {}, window).sum
    };
    
    // LLM Metrics
    report.metrics.llm = {
      processingTime: this.calculateMetrics('llm_processing_time', {}, window),
      successRate: this.calculateMetrics('llm_success_rate', {}, window).avg,
      errorCount: this.calculateMetrics('llm_error_count', {}, window).sum
    };
    
    // Database Metrics
    report.metrics.database = {
      operationTime: this.calculateMetrics('db_operation_time', {}, window),
      successRate: this.calculateMetrics('db_success_rate', {}, window).avg,
      errorCount: this.calculateMetrics('db_error_count', {}, window).sum
    };
    
    // Summary
    const violatedSLOs = report.slos.filter(slo => !slo.isCompliant);
    report.summary = {
      totalSLOs: report.slos.length,
      violatedSLOs: violatedSLOs.length,
      complianceRate: (report.slos.length - violatedSLOs.length) / report.slos.length,
      criticalViolations: violatedSLOs.filter(slo => 
        slo.name.includes('Availability') || slo.name.includes('Error Rate')
      ).length
    };
    
    // Persist report if DAO is available
    if (this.dao && typeof this.dao.saveQualityReport === 'function') {
      try {
        await this.dao.saveQualityReport(report);
      } catch (error) {
        logger.error('Failed to save quality report', { error: error.message });
      }
    }
    
    return report;
  }

  /**
   * Helper methods
   */
  getMetricKey(type, labels) {
    const sortedLabels = Object.keys(labels).sort().map(key => `${key}:${labels[key]}`).join(',');
    return `${type}|${sortedLabels}`;
  }

  percentile(values, p) {
    if (values.length === 0) return 0;
    const index = Math.ceil((p / 100) * values.length) - 1;
    return values[Math.max(0, Math.min(index, values.length - 1))];
  }

  startCleanup() {
    // Clean up old metrics every hour
    this.cleanupInterval = setInterval(() => {
      const cutoff = Date.now() - this.windows['24h'];
      
      for (const [key, metrics] of this.metrics.entries()) {
        const filtered = metrics.filter(m => m.timestamp > cutoff);
        if (filtered.length === 0) {
          this.metrics.delete(key);
        } else {
          this.metrics.set(key, filtered);
        }
      }
    }, 60 * 60 * 1000); // 1 hour
  }
  
  /**
   * Stop cleanup interval
   */
  stopCleanup() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Get current metrics summary
   */
  getMetricsSummary() {
    const summary = {
      totalMetricTypes: new Set(),
      totalDataPoints: 0,
      memoryUsage: 0
    };
    
    for (const [key, metrics] of this.metrics.entries()) {
      const [type] = key.split('|');
      summary.totalMetricTypes.add(type);
      summary.totalDataPoints += metrics.length;
    }
    
    summary.totalMetricTypes = summary.totalMetricTypes.size;
    summary.memoryUsage = JSON.stringify([...this.metrics.entries()]).length;
    
    return summary;
  }
}

module.exports = QualityMetrics;
