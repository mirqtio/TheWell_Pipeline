/**
 * Monitoring Module Index
 * Exports all monitoring and observability components
 */

const CostTracker = require('./CostTracker');
const CostReporter = require('./CostReporter');
const CostDAO = require('./CostDAO');
const QualityMetrics = require('./QualityMetrics');
const QualityDAO = require('./QualityDAO');
const QualityMiddleware = require('./QualityMiddleware');
const PrometheusExporter = require('./PrometheusExporter');
const AlertManager = require('./AlertManager');
const DashboardManager = require('./dashboard/DashboardManager');

module.exports = {
  // Cost tracking
  CostTracker,
  CostReporter,
  CostDAO,
  
  // Quality monitoring
  QualityMetrics,
  QualityDAO,
  QualityMiddleware,
  
  // Observability
  PrometheusExporter,
  AlertManager,
  
  // Dashboard
  DashboardManager
};