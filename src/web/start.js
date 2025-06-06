#!/usr/bin/env node

/**
 * Startup script for TheWell Pipeline Manual Review Web Interface
 */

const path = require('path'); // eslint-disable-line no-unused-vars
const ManualReviewServer = require('./server');
const logger = require('../utils/logger');
const { ConfigManager } = require('../config');
const SourceReliabilityService = require('../services/SourceReliabilityService');
const QueueManager = require('../ingestion/queue/QueueManager');
const IngestionEngine = require('../ingestion/IngestionEngine');
const DatabaseManager = require('../database/DatabaseManager');
const AuditService = require('../services/AuditService');
const CategorizationService = require('../services/CategorizationService');
const EmbeddingService = require('../enrichment/EmbeddingService');
const { LLMProviderManager } = require('../enrichment/LLMProviderManager');

// Mock dependencies for development
class MockQueueManager {
  constructor() {
    this.initialized = true;
    this.connected = true;
    this.isInitialized = true;
    this.isConnected = true;
  }

  getQueueNames() {
    return ['ingestion', 'enrichment', 'export'];
  }

  async getJobs(options = {}) { // eslint-disable-line no-unused-vars
    return {
      jobs: [
        {
          id: 'job-001',
          queue: 'ingestion',
          name: 'Process PDF Document',
          status: 'active',
          progress: 75,
          priority: 1,
          createdAt: new Date().toISOString(),
          data: { source: 'documents/sample.pdf' }
        },
        {
          id: 'job-002',
          queue: 'enrichment',
          name: 'LLM Analysis',
          status: 'completed',
          progress: 100,
          priority: 2,
          createdAt: new Date(Date.now() - 3600000).toISOString(),
          data: { documentId: 'doc-123' }
        },
        {
          id: 'job-003',
          queue: 'ingestion',
          name: 'Web Scraping',
          status: 'failed',
          progress: 25,
          priority: 3,
          createdAt: new Date(Date.now() - 7200000).toISOString(),
          data: { url: 'https://example.com' }
        }
      ],
      pagination: {
        page: 1,
        pages: 1,
        total: 3,
        hasNext: false,
        hasPrev: false
      }
    };
  }

  async getJob(queue, jobId) {
    const jobs = await this.getJobs();
    return jobs.jobs.find(job => job.id === jobId && job.queue === queue);
  }

  async retryJob(queue, jobId) {
    logger.info(`Retrying job ${jobId} in queue ${queue}`);
    return { success: true };
  }

  async removeJob(queue, jobId) {
    logger.info(`Removing job ${jobId} from queue ${queue}`);
    return { success: true };
  }

  async getQueueStats() {
    return {
      queues: {
        ingestion: {
          waiting: 5,
          active: 2,
          completed: 150,
          failed: 3
        },
        enrichment: {
          waiting: 2,
          active: 1,
          completed: 89,
          failed: 1
        },
        vectorization: {
          waiting: 0,
          active: 0,
          completed: 45,
          failed: 0
        }
      }
    };
  }
}

class MockIngestionEngine {
  constructor() {
    this.initialized = true;
    this.isInitialized = true;
    this.isRunning = true;
  }

  getRegisteredSources() {
    return ['documents', 'web-scraper', 'api-feeds'];
  }

  async getPendingDocuments(options = {}) {
    const mockDocuments = [
      {
        id: 'doc-001',
        title: 'Introduction to Machine Learning',
        contentPreview: 'Machine learning is a subset of artificial intelligence that focuses on algorithms that can learn from and make predictions on data...',
        content: 'Machine learning is a subset of artificial intelligence that focuses on algorithms that can learn from and make predictions on data. It involves training algorithms on large datasets to identify patterns and make decisions with minimal human intervention.',
        source: {
          type: 'pdf',
          name: 'ML_Introduction.pdf',
          url: 'https://example.com/docs/ml-intro.pdf'
        },
        metadata: {
          fileType: 'pdf',
          fileSize: 2048576,
          wordCount: 1250,
          language: 'en'
        },
        priority: 2,
        flags: [
          {
            type: 'quality-check',
            notes: 'Needs technical review',
            flaggedBy: 'system',
            flaggedAt: new Date().toISOString()
          }
        ],
        assignedTo: null,
        createdAt: new Date().toISOString(),
        status: 'pending'
      },
      {
        id: 'doc-002',
        title: 'Data Science Best Practices',
        contentPreview: 'This document outlines the essential best practices for data science projects, including data collection, preprocessing, model selection...',
        content: 'This document outlines the essential best practices for data science projects, including data collection, preprocessing, model selection, and evaluation methodologies.',
        source: {
          type: 'web',
          name: 'Data Science Blog',
          url: 'https://datascience.example.com/best-practices'
        },
        metadata: {
          fileType: 'html',
          fileSize: 512000,
          wordCount: 850,
          language: 'en'
        },
        priority: 1,
        flags: [],
        assignedTo: 'reviewer-1',
        createdAt: new Date(Date.now() - 1800000).toISOString(),
        status: 'pending'
      },
      {
        id: 'doc-003',
        title: 'Neural Network Architectures',
        contentPreview: 'Deep neural networks have revolutionized the field of artificial intelligence. This comprehensive guide explores various architectures...',
        content: 'Deep neural networks have revolutionized the field of artificial intelligence. This comprehensive guide explores various architectures including CNNs, RNNs, and Transformers.',
        source: {
          type: 'pdf',
          name: 'Neural_Networks_Guide.pdf',
          url: null
        },
        metadata: {
          fileType: 'pdf',
          fileSize: 4096000,
          wordCount: 2100,
          language: 'en'
        },
        priority: 0,
        flags: [],
        assignedTo: null,
        createdAt: new Date(Date.now() - 3600000).toISOString(),
        status: 'pending'
      }
    ];

    const { page = 1, limit = 20, filter = 'all', search = '' } = options;
    
    let filteredDocs = mockDocuments;
    
    if (search) {
      filteredDocs = filteredDocs.filter(doc => 
        doc.title.toLowerCase().includes(search.toLowerCase()) ||
        doc.content.toLowerCase().includes(search.toLowerCase())
      );
    }

    if (filter !== 'all') {
      switch (filter) {
      case 'flagged':
        filteredDocs = filteredDocs.filter(doc => doc.flags.length > 0);
        break;
      case 'assigned':
        filteredDocs = filteredDocs.filter(doc => doc.assignedTo);
        break;
      case 'unassigned':
        filteredDocs = filteredDocs.filter(doc => !doc.assignedTo);
        break;
      case 'priority':
        filteredDocs = filteredDocs.filter(doc => doc.priority > 0);
        break;
      }
    }

    const total = filteredDocs.length;
    const pages = Math.ceil(total / limit);
    const start = (page - 1) * limit;
    const documents = filteredDocs.slice(start, start + limit);

    return {
      documents,
      pagination: {
        page,
        pages,
        total,
        hasNext: page < pages,
        hasPrev: page > 1
      }
    };
  }

  async getDocument(documentId) {
    const result = await this.getPendingDocuments();
    const document = result.documents.find(doc => doc.id === documentId);
    if (!document) {
      throw new Error('Document not found');
    }
    return { document };
  }

  async approveDocument(documentId, data) {
    logger.info(`Approving document ${documentId}`, data);
    return { success: true };
  }

  async rejectDocument(documentId, data) {
    logger.info(`Rejecting document ${documentId}`, data);
    return { success: true };
  }

  async flagDocument(documentId, data) {
    logger.info(`Flagging document ${documentId}`, data);
    return { success: true };
  }

  async getReviewStats() {
    return {
      stats: {
        queue: {
          waiting: 15,
          reviewing: 3,
          completed: 245
        },
        recent: {
          approved: 89,
          rejected: 12,
          flagged: 5,
          approvalRate: 88
        },
        performance: {
          avgReviewTime: 180,
          documentsPerHour: 12
        }
      }
    };
  }

  async searchDocuments(query, options = {}) { // eslint-disable-line no-unused-vars
    logger.info(`Searching documents for: ${query}`);
    return {
      results: [],
      total: 0
    };
  }

  async exportData(format, options = {}) { // eslint-disable-line no-unused-vars
    logger.info(`Exporting data in ${format} format`);
    return {
      url: '/api/exports/sample.json',
      filename: `export_${Date.now()}.${format}`
    };
  }
}

// Mock SourceReliabilityService for development
class MockSourceReliabilityService {
  constructor() {
    this.initialized = true;
  }

  async getReliabilityScore(sourceId) {
    return {
      sourceId,
      overallScore: 0.85,
      reliabilityLevel: 'high',
      breakdown: {
        quality: { score: 0.9, weight: 0.3 },
        consistency: { score: 0.8, weight: 0.2 },
        feedback: { score: 0.85, weight: 0.2 },
        historical: { score: 0.75, weight: 0.15 },
        error: { score: 0.95, weight: 0.15 }
      },
      metrics: {
        totalDocuments: 100,
        averageQuality: 0.9
      },
      calculatedAt: new Date().toISOString(),
      timeframe: '30 days'
    };
  }

  async calculateReliabilityScore(sourceId, options = {}) { // eslint-disable-line no-unused-vars
    return this.getReliabilityScore(sourceId);
  }

  async getAllReliabilityScores() {
    return [
      { sourceId: 'source1', overallScore: 0.9, reliabilityLevel: 'high' },
      { sourceId: 'source2', overallScore: 0.8, reliabilityLevel: 'medium' }
    ];
  }
}

async function startWebServer() {
  try {
    const isProduction = process.env.NODE_ENV === 'production';
    let queueManager, ingestionEngine, sourceReliabilityService, categorizationService;
    let databaseManager; // Declare at function scope for cleanup

    if (isProduction) {
      logger.info('Initializing production services...');
      
      // Initialize real dependencies for production
      databaseManager = new DatabaseManager({
        host: process.env.DB_HOST || 'postgres',
        port: parseInt(process.env.DB_PORT || '5432'),
        database: process.env.DB_NAME || 'thewell_prod',
        username: process.env.DB_USER || 'thewell',
        password: process.env.DB_PASSWORD || process.env.POSTGRES_PASSWORD
      });
      await databaseManager.initialize();
      
      logger.info('Initializing ConfigManager...');
      const configManager = new ConfigManager({
        configDir: process.env.CONFIG_DIR || '/app/config'
        // watchOptions can be specified here if defaults are not suitable
      });
      await configManager.startWatching();
      logger.info('ConfigManager started watching.');
      
      queueManager = new QueueManager({
        redis: {
          host: process.env.REDIS_HOST || 'redis',
          port: parseInt(process.env.REDIS_PORT || '6379'),
          password: process.env.REDIS_PASSWORD
        }
      });
      await queueManager.initialize();
      
      ingestionEngine = new IngestionEngine({
        queueManager,
        databaseManager,
        configManager
      });
      await ingestionEngine.initialize();
      
      // Initialize AuditService
      const auditService = new AuditService({ databaseManager });
      
      sourceReliabilityService = new SourceReliabilityService({
        databaseManager,
        auditService // Pass the auditService instance
      });
      
      // Initialize LLM Provider Manager
      const llmProviderManager = new LLMProviderManager({
        providers: {
          openai: {
            apiKey: process.env.OPENAI_API_KEY,
            model: process.env.OPENAI_MODEL || 'gpt-3.5-turbo'
          },
          anthropic: {
            apiKey: process.env.ANTHROPIC_API_KEY,
            model: process.env.ANTHROPIC_MODEL || 'claude-2'
          }
        },
        defaultProvider: process.env.DEFAULT_LLM_PROVIDER || 'openai'
      });
      await llmProviderManager.initialize();
      
      // Initialize Embedding Service
      const embeddingService = new EmbeddingService({
        provider: process.env.EMBEDDING_PROVIDER || 'openai',
        apiKey: process.env.OPENAI_API_KEY,
        model: process.env.EMBEDDING_MODEL || 'text-embedding-3-small'
      });
      
      // Initialize Categorization Service
      categorizationService = new CategorizationService({
        database: databaseManager,
        embeddingService,
        llmProvider: llmProviderManager.getProvider()
      });
      await categorizationService.initialize();
    } else {
      logger.info('Using mock services for development...');
      
      // Initialize mock dependencies for development
      queueManager = new MockQueueManager();
      ingestionEngine = new MockIngestionEngine();
      sourceReliabilityService = new MockSourceReliabilityService();
    }

    logger.info('Starting TheWell Pipeline Manual Review Web Interface...');

    // Create and start server
    const port = process.env.WEB_PORT || 3001;
    const host = process.env.WEB_HOST || 'localhost';
    
    const webServer = new ManualReviewServer({
      port: port === '0' ? 0 : parseInt(port), // Handle port 0 for dynamic assignment
      host,
      queueManager,
      ingestionEngine,
      sourceReliabilityService,
      categorizationService,
      databaseManager,
      logger
    });

    await webServer.start();
    
    logger.info('Manual Review Web Interface started successfully');
    logger.info(`Server running at http://${host}:${webServer.port}`);
    logger.info('Available endpoints:');
    logger.info('  - GET  /              - Manual Review Interface');
    logger.info('  - GET  /api/status    - System Status');
    logger.info('  - GET  /api/review/*  - Review API');
    logger.info('  - GET  /api/jobs/*    - Jobs API');

    // Graceful shutdown
    const gracefulShutdown = async (signal) => {
      logger.info(`Received ${signal}, shutting down gracefully...`);
      
      try {
        await webServer.shutdown();
        logger.info('Web server closed');
        
        if (isProduction) {
          // Cleanup production services
          if (queueManager && typeof queueManager.close === 'function') {
            await queueManager.close();
            logger.info('Queue manager closed');
          }
          if (ingestionEngine && typeof ingestionEngine.stop === 'function') {
            await ingestionEngine.stop();
            logger.info('Ingestion engine stopped');
          }
          if (databaseManager && typeof databaseManager.close === 'function') {
            await databaseManager.close();
            logger.info('Database manager closed');
          }
        }
        
        process.exit(0);
      } catch (error) {
        logger.error('Error during shutdown:', error);
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  } catch (error) {
    logger.error('Failed to start web server:', error);
    process.exit(1);
  }
}

// Start the server if this script is run directly
if (require.main === module) {
  startWebServer();
}

module.exports = { startWebServer, MockQueueManager, MockIngestionEngine, MockSourceReliabilityService };
