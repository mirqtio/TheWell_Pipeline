const { SourceHandlerRegistry } = require('../handlers/SourceHandlerRegistry');
const { IngestionEngine } = require('../IngestionEngine');

/**
 * Ingestion Job Processor
 * Handles processing of ingestion jobs from the queue
 */
class IngestionJobProcessor {
  constructor(config = {}) {
    this.config = config;
    this.sourceHandlerRegistry = new SourceHandlerRegistry();
    this.ingestionEngine = new IngestionEngine();
    this.isInitialized = false;
  }

  /**
   * Initialize the job processor
   */
  async initialize() {
    try {
      await this.sourceHandlerRegistry.initialize();
      await this.ingestionEngine.initialize();
      this.isInitialized = true;
      return true;
    } catch (error) {
      throw new Error(`Failed to initialize IngestionJobProcessor: ${error.message}`);
    }
  }

  /**
   * Process an ingestion job
   * @param {Object} jobData - Job data containing source configuration and options
   * @param {Object} job - Bull job instance for progress reporting
   */
  async processJob(jobData, job) {
    if (!this.isInitialized) {
      throw new Error('IngestionJobProcessor not initialized');
    }

    const { sourceConfig, options = {} } = jobData;
    
    if (!sourceConfig) {
      throw new Error('Missing source configuration in job data');
    }

    try {
      // Report initial progress
      await job.progress(0);

      // Step 1: Register source if not already registered
      await job.progress(10);
      let sourceId = sourceConfig.id;
      
      if (!this.sourceHandlerRegistry.hasSource(sourceId)) {
        sourceId = await this.sourceHandlerRegistry.registerSource(sourceConfig);
      }

      // Step 2: Discover documents
      await job.progress(25);
      const handler = this.sourceHandlerRegistry.getHandler(sourceId);
      const documents = await handler.discover();

      // Step 3: Process each document
      const totalDocuments = documents.length;
      const processedDocuments = [];
      const errors = [];

      for (let i = 0; i < totalDocuments; i++) {
        const document = documents[i];
        
        try {
          // Extract content
          const extractedContent = await handler.extract(document);
          
          // Transform content
          const transformedContent = await handler.transform(extractedContent);
          
          processedDocuments.push(transformedContent);
          
          // Update progress
          const progress = 25 + Math.floor((i + 1) / totalDocuments * 65);
          await job.progress(progress);
          
        } catch (error) {
          errors.push({
            document: document.id || document.url,
            error: error.message
          });
          
          // Continue processing other documents unless configured to stop on error
          if (options.stopOnError) {
            throw new Error(`Processing stopped due to error: ${error.message}`);
          }
        }
      }

      // Step 4: Final processing and cleanup
      await job.progress(95);
      
      const result = {
        sourceId,
        documentsProcessed: processedDocuments.length,
        documentsTotal: totalDocuments,
        errors: errors.length,
        processedDocuments: options.includeDocuments ? processedDocuments : undefined,
        errorDetails: errors.length > 0 ? errors : undefined,
        completedAt: new Date().toISOString()
      };

      await job.progress(100);
      return result;

    } catch (error) {
      // Clean up on error
      if (sourceConfig.id && this.sourceHandlerRegistry.hasSource(sourceConfig.id)) {
        try {
          await this.sourceHandlerRegistry.unregisterSource(sourceConfig.id);
        } catch (cleanupError) {
          // Log cleanup error but don't mask original error
          console.error('Failed to cleanup source after error:', cleanupError.message);
        }
      }
      
      throw new Error(`Ingestion job failed: ${error.message}`);
    }
  }

  /**
   * Process a batch of sources
   */
  async processBatch(jobData, job) {
    if (!this.isInitialized) {
      throw new Error('IngestionJobProcessor not initialized');
    }

    const { sources, options = {} } = jobData;
    
    if (!Array.isArray(sources) || sources.length === 0) {
      throw new Error('Missing or empty sources array in job data');
    }

    try {
      await job.progress(0);
      
      const results = [];
      const totalSources = sources.length;

      for (let i = 0; i < totalSources; i++) {
        const sourceConfig = sources[i];
        
        try {
          // Process individual source
          const result = await this.processJob({ sourceConfig, options }, {
            progress: async (progress) => {
              // Scale progress for this source within the batch
              const batchProgress = Math.floor((i / totalSources) * 100 + (progress / totalSources));
              await job.progress(batchProgress);
            }
          });
          
          results.push({
            sourceId: sourceConfig.id,
            status: 'completed',
            result
          });
          
        } catch (error) {
          results.push({
            sourceId: sourceConfig.id,
            status: 'failed',
            error: error.message
          });
          
          if (options.stopOnError) {
            throw new Error(`Batch processing stopped due to error in source ${sourceConfig.id}: ${error.message}`);
          }
        }
      }

      await job.progress(100);
      
      return {
        batchId: jobData.batchId || `batch-${Date.now()}`,
        sourcesProcessed: results.filter(r => r.status === 'completed').length,
        sourcesTotal: totalSources,
        sourcesFailed: results.filter(r => r.status === 'failed').length,
        results: options.includeResults ? results : undefined,
        completedAt: new Date().toISOString()
      };

    } catch (error) {
      throw new Error(`Batch ingestion job failed: ${error.message}`);
    }
  }

  /**
   * Shutdown the job processor
   */
  async shutdown() {
    if (!this.isInitialized) {
      return;
    }

    try {
      await this.sourceHandlerRegistry.cleanup();
      await this.ingestionEngine.shutdown();
      this.isInitialized = false;
    } catch (error) {
      throw new Error(`Failed to shutdown IngestionJobProcessor: ${error.message}`);
    }
  }
}

module.exports = IngestionJobProcessor;
