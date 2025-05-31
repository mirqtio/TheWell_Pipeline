#!/usr/bin/env node

/**
 * Startup script for TheWell Pipeline Manual Review Web Interface
 */

const path = require('path');
const ManualReviewServer = require('./server');
const logger = require('../utils/logger');

// Mock dependencies for development
class MockQueueManager {
  constructor() {
    this.initialized = true;
    this.connected = true;
  }

  async getJobs(options = {}) {
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

  async searchDocuments(query, options = {}) {
    logger.info(`Searching documents for: ${query}`);
    return {
      results: [],
      total: 0
    };
  }

  async exportData(format, options = {}) {
    logger.info(`Exporting data in ${format} format`);
    return {
      url: '/api/exports/sample.json',
      filename: `export_${Date.now()}.${format}`
    };
  }
}

async function startWebServer() {
  try {
    // Initialize mock dependencies
    const queueManager = new MockQueueManager();
    const ingestionEngine = new MockIngestionEngine();

    logger.info('Starting TheWell Pipeline Manual Review Web Interface...');

    // Create and start server
    const webServer = new ManualReviewServer({
      queueManager,
      ingestionEngine,
      logger
    });

    const port = process.env.WEB_PORT || 3001;
    const host = process.env.WEB_HOST || 'localhost';

    await webServer.start();
    
    logger.info(`Manual Review Web Interface started successfully`);
    logger.info(`Server running at http://${host}:${port}`);
    logger.info('Available endpoints:');
    logger.info('  - GET  /              - Manual Review Interface');
    logger.info('  - GET  /api/status    - System Status');
    logger.info('  - GET  /api/review/*  - Review API');
    logger.info('  - GET  /api/jobs/*    - Jobs API');

    // Graceful shutdown
    process.on('SIGTERM', () => {
      logger.info('Received SIGTERM, shutting down gracefully...');
      webServer.shutdown().then(() => {
        logger.info('Web server closed');
        process.exit(0);
      });
    });

    process.on('SIGINT', () => {
      logger.info('Received SIGINT, shutting down gracefully...');
      webServer.shutdown().then(() => {
        logger.info('Web server closed');
        process.exit(0);
      });
    });

  } catch (error) {
    logger.error('Failed to start web server:', error);
    process.exit(1);
  }
}

// Start the server if this script is run directly
if (require.main === module) {
  startWebServer();
}

module.exports = { startWebServer, MockQueueManager, MockIngestionEngine };
