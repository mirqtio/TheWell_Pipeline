/**
 * Quality Metrics Middleware
 * Automatically collects quality metrics from API requests
 */

const logger = require('../utils/logger');

class QualityMiddleware {
  constructor(qualityMetrics) {
    this.qualityMetrics = qualityMetrics;
  }

  /**
   * Express middleware for API request monitoring
   */
  apiMonitoring() {
    return (req, res, next) => {
      const startTime = Date.now();
      const originalSend = res.send;
      
      // Override res.send to capture response
      res.send = function(data) {
        const responseTime = Date.now() - startTime;
        const statusCode = res.statusCode;
        const method = req.method;
        const endpoint = req.route ? req.route.path : req.path;
        const userId = req.user ? req.user.id : null;
        
        // Record API metrics
        try {
          this.qualityMetrics.recordAPIRequest(
            endpoint,
            method,
            statusCode,
            responseTime,
            userId
          );
        } catch (error) {
          logger.error('Failed to record API metrics', { error: error.message });
        }
        
        // Call original send
        return originalSend.call(this, data);
      }.bind(this);
      
      next();
    };
  }

  /**
   * Database operation wrapper
   */
  wrapDatabaseOperation(operation, table, fn) {
    return async (...args) => {
      const startTime = Date.now();
      let success = false;
      let error = null;
      
      try {
        const result = await fn(...args);
        success = true;
        return result;
      } catch (err) {
        error = err;
        throw err;
      } finally {
        const duration = Date.now() - startTime;
        
        try {
          this.qualityMetrics.recordDatabaseOperation(
            operation,
            table,
            duration,
            success,
            error
          );
        } catch (metricsError) {
          logger.error('Failed to record database metrics', { 
            error: metricsError.message 
          });
        }
      }
    };
  }

  /**
   * LLM processing wrapper
   */
  wrapLLMProcessing(provider, model, operation, fn) {
    return async (...args) => {
      const startTime = Date.now();
      let success = false;
      let error = null;
      
      try {
        const result = await fn(...args);
        success = true;
        return result;
      } catch (err) {
        error = err;
        throw err;
      } finally {
        const processingTime = Date.now() - startTime;
        
        try {
          this.qualityMetrics.recordLLMProcessing(
            provider,
            model,
            operation,
            processingTime,
            success,
            error
          );
        } catch (metricsError) {
          logger.error('Failed to record LLM metrics', { 
            error: metricsError.message 
          });
        }
      }
    };
  }

  /**
   * Generic function wrapper for any operation
   */
  wrapOperation(metricType, labels, fn) {
    return async (...args) => {
      const startTime = Date.now();
      let success = false;
      let error = null;
      
      try {
        const result = await fn(...args);
        success = true;
        return result;
      } catch (err) {
        error = err;
        throw err;
      } finally {
        const duration = Date.now() - startTime;
        
        try {
          this.qualityMetrics.recordMetric(metricType, duration, {
            ...labels,
            success,
            error: error ? error.message : null
          });
        } catch (metricsError) {
          logger.error('Failed to record operation metrics', { 
            error: metricsError.message 
          });
        }
      }
    };
  }

  /**
   * Error handling middleware
   */
  errorMonitoring() {
    return (err, req, res, next) => {
      const endpoint = req.route ? req.route.path : req.path;
      const method = req.method;
      
      // Record error metric
      try {
        this.qualityMetrics.recordMetric('error_count', 1, {
          endpoint,
          method,
          errorType: err.name,
          errorMessage: err.message,
          statusCode: err.status || 500
        });
      } catch (metricsError) {
        logger.error('Failed to record error metrics', { 
          error: metricsError.message 
        });
      }
      
      next(err);
    };
  }

  /**
   * Health check endpoint
   */
  healthCheck() {
    return async (req, res) => {
      try {
        const summary = this.qualityMetrics.getMetricsSummary();
        const sloCompliance = this.qualityMetrics.getAllSLOCompliance();
        
        const healthStatus = {
          status: 'healthy',
          timestamp: new Date().toISOString(),
          metrics: summary,
          slos: {
            total: sloCompliance.length,
            compliant: sloCompliance.filter(slo => slo.isCompliant).length,
            violations: sloCompliance.filter(slo => !slo.isCompliant).length
          }
        };
        
        // Determine overall health based on critical SLO violations
        const criticalViolations = sloCompliance.filter(slo => 
          !slo.isCompliant && (
            slo.name.includes('Availability') || 
            slo.name.includes('Error Rate')
          )
        );
        
        if (criticalViolations.length > 0) {
          healthStatus.status = 'degraded';
          healthStatus.criticalViolations = criticalViolations;
        }
        
        res.json(healthStatus);
      } catch (error) {
        logger.error('Health check failed', { error: error.message });
        res.status(500).json({
          status: 'unhealthy',
          timestamp: new Date().toISOString(),
          error: error.message
        });
      }
    };
  }

  /**
   * Metrics endpoint
   */
  metricsEndpoint() {
    return async (req, res) => {
      try {
        const window = req.query.window || '5m';
        const metricType = req.query.type;
        const labels = req.query.labels ? JSON.parse(req.query.labels) : {};
        
        let result;
        
        if (metricType) {
          // Get specific metric
          result = this.qualityMetrics.calculateMetrics(metricType, labels, window);
        } else {
          // Get quality report
          result = await this.qualityMetrics.generateQualityReport(window);
        }
        
        res.json({
          timestamp: new Date().toISOString(),
          window,
          data: result
        });
      } catch (error) {
        logger.error('Metrics endpoint failed', { error: error.message });
        res.status(500).json({
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }
    };
  }

  /**
   * SLO compliance endpoint
   */
  sloEndpoint() {
    return async (req, res) => {
      try {
        const sloId = req.params.sloId;
        const window = req.query.window;
        
        let result;
        
        if (sloId) {
          // Get specific SLO compliance
          result = this.qualityMetrics.checkSLOCompliance(sloId, window);
        } else {
          // Get all SLO compliance
          result = this.qualityMetrics.getAllSLOCompliance();
        }
        
        res.json({
          timestamp: new Date().toISOString(),
          data: result
        });
      } catch (error) {
        logger.error('SLO endpoint failed', { error: error.message });
        res.status(500).json({
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }
    };
  }
}

module.exports = QualityMiddleware;
