/**
 * Service Index
 * 
 * Registers all services with the container for lazy initialization
 */

const serviceContainer = require('./ServiceContainer');

// Register service factories
serviceContainer.register('databaseManager', () => {
  const DatabaseManager = require('../database/DatabaseManager');
  return new DatabaseManager({
    host: process.env.DB_HOST || 'postgres',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'thewell_prod',
    username: process.env.DB_USER || 'thewell',
    password: process.env.DB_PASSWORD || process.env.POSTGRES_PASSWORD
  });
});

serviceContainer.register('cacheManager', () => {
  const CacheManager = require('../cache/CacheManager');
  return new CacheManager();
});

serviceContainer.register('configManager', () => {
  const ConfigManager = require('../config/ConfigManager');
  return new ConfigManager({
    configDir: process.env.CONFIG_DIR || '/app/config',
    watchForChanges: true
  });
});

serviceContainer.register('tracingManager', () => {
  const TracingManager = require('../tracing/TracingManager');
  return new TracingManager();
});

serviceContainer.register('ragManager', () => {
  const RAGManager = require('../rag/RAGManager');
  return new RAGManager({
    databaseManager: serviceContainer.get('databaseManager'),
    cacheManager: serviceContainer.get('cacheManager'),
    llmProviderManager: serviceContainer.get('llmProviderManager'),
    visibilityDatabase: serviceContainer.get('visibilityDatabase'),
    tracingManager: serviceContainer.get('tracingManager')
  });
});

serviceContainer.register('llmProviderManager', () => {
  const LLMProviderManager = require('../enrichment/LLMProviderManager');
  return new LLMProviderManager();
});

serviceContainer.register('visibilityDatabase', () => {
  const VisibilityDatabase = require('../ingestion/VisibilityDatabase');
  return new VisibilityDatabase();
});

serviceContainer.register('queueManager', () => {
  const QueueManager = require('../ingestion/queue/QueueManager');
  return new QueueManager({
    redis: {
      host: process.env.REDIS_HOST || 'redis',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD
    }
  });
});

serviceContainer.register('ingestionEngine', () => {
  const IngestionEngine = require('../ingestion/IngestionEngine');
  return new IngestionEngine({
    databaseManager: serviceContainer.get('databaseManager'),
    queueManager: serviceContainer.get('queueManager'),
    visibilityManager: serviceContainer.get('visibilityManager')
  });
});

serviceContainer.register('visibilityManager', () => {
  const VisibilityManager = require('../ingestion/VisibilityManager');
  return new VisibilityManager({
    database: serviceContainer.get('visibilityDatabase'),
    databaseManager: serviceContainer.get('databaseManager')
  });
});

serviceContainer.register('feedbackProcessor', () => {
  const FeedbackProcessor = require('./FeedbackProcessor');
  return new FeedbackProcessor({
    databaseManager: serviceContainer.get('databaseManager')
  });
});

serviceContainer.register('auditService', () => {
  const AuditService = require('./AuditService');
  return new AuditService({
    databaseManager: serviceContainer.get('databaseManager')
  });
});

serviceContainer.register('sourceReliabilityService', () => {
  const SourceReliabilityService = require('./SourceReliabilityService');
  return new SourceReliabilityService({
    databaseManager: serviceContainer.get('databaseManager')
  });
});

serviceContainer.register('costTracker', () => {
  const CostTracker = require('../monitoring/CostTracker');
  return new CostTracker({
    databaseManager: serviceContainer.get('databaseManager')
  });
});

serviceContainer.register('qualityMetrics', () => {
  const QualityMetrics = require('../monitoring/QualityMetrics');
  return new QualityMetrics({
    databaseManager: serviceContainer.get('databaseManager')
  });
});

serviceContainer.register('dashboardManager', () => {
  const DashboardManager = require('../monitoring/dashboard/DashboardManager');
  return new DashboardManager({
    ingestionEngine: serviceContainer.get('ingestionEngine'),
    sourceReliabilityService: serviceContainer.get('sourceReliabilityService'),
    costTracker: serviceContainer.get('costTracker'),
    qualityMetrics: serviceContainer.get('qualityMetrics')
  });
});

// Export service getters
module.exports = {
  getDatabaseManager: () => serviceContainer.get('databaseManager'),
  getCacheManager: () => serviceContainer.get('cacheManager'),
  getConfigManager: () => serviceContainer.get('configManager'),
  getTracingManager: () => serviceContainer.get('tracingManager'),
  getRAGManager: () => serviceContainer.get('ragManager'),
  getLLMProviderManager: () => serviceContainer.get('llmProviderManager'),
  getVisibilityDatabase: () => serviceContainer.get('visibilityDatabase'),
  getQueueManager: () => serviceContainer.get('queueManager'),
  getIngestionEngine: () => serviceContainer.get('ingestionEngine'),
  getVisibilityManager: () => serviceContainer.get('visibilityManager'),
  getFeedbackProcessor: () => serviceContainer.get('feedbackProcessor'),
  getAuditService: () => serviceContainer.get('auditService'),
  getSourceReliabilityService: () => serviceContainer.get('sourceReliabilityService'),
  getCostTracker: () => serviceContainer.get('costTracker'),
  getQualityMetrics: () => serviceContainer.get('qualityMetrics'),
  getDashboardManager: () => serviceContainer.get('dashboardManager'),
  
  // Export container for testing
  serviceContainer
};