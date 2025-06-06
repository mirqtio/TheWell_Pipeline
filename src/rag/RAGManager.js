/**
 * RAG Manager
 * Orchestrates the Retrieval-Augmented Generation pipeline with performance optimizations
 */

const logger = require('../utils/logger');
const DocumentRetriever = require('./components/DocumentRetriever');
const ResponseGenerator = require('./components/ResponseGenerator');
const InputProcessor = require('./components/InputProcessor');
const OutputFormatter = require('./components/OutputFormatter');
const { RAGTracing } = require('../tracing');
const { ParallelSearchManager, PerformanceBenchmark, DatabaseOptimizer } = require('./performance');
const MLIntegration = require('../ml/MLIntegration');

class RAGManager {
  constructor(options = {}) {
    this.databaseManager = options.databaseManager;
    this.llmProviderManager = options.llmProviderManager;
    this.visibilityDatabase = options.visibilityDatabase;
    this.cacheManager = options.cacheManager;
    
    // Performance optimization settings
    this.enableParallelSearch = options.enableParallelSearch !== false;
    this.enableDatabaseOptimization = options.enableDatabaseOptimization !== false;
    this.enablePerformanceBenchmarking = options.enablePerformanceBenchmarking !== false;
    
    // ML enhancement settings
    this.enableMLEnhancement = options.enableMLEnhancement !== false;
    this.mlIntegration = MLIntegration;
    
    // Initialize tracing
    this.ragTracing = new RAGTracing(options.tracingManager);
    
    // Initialize components
    this.inputProcessor = new InputProcessor({
      maxQueryLength: options.maxQueryLength || 1000,
      allowedLanguages: options.allowedLanguages || ['en']
    });
    
    this.documentRetriever = new DocumentRetriever({
      databaseManager: this.databaseManager,
      visibilityDatabase: this.visibilityDatabase,
      maxResults: options.maxResults || 10,
      similarityThreshold: options.similarityThreshold || 0.7,
      openaiApiKey: options.openaiApiKey,
      embeddingModel: options.embeddingModel
    });
    
    this.responseGenerator = new ResponseGenerator({
      llmProviderManager: this.llmProviderManager,
      maxTokens: options.maxTokens || 2048,
      temperature: options.temperature || 0.7
    });
    
    this.outputFormatter = new OutputFormatter({
      includeMetadata: options.includeMetadata !== false,
      includeSources: options.includeSources !== false
    });

    // Initialize performance optimization components
    if (this.enableDatabaseOptimization) {
      this.databaseOptimizer = new DatabaseOptimizer({
        databaseManager: this.databaseManager,
        enableQueryCaching: options.enableQueryCaching !== false,
        cacheSize: options.cacheSize || 1000,
        cacheTTL: options.cacheTTL || 300000
      });
    }

    if (this.enableParallelSearch) {
      this.parallelSearchManager = new ParallelSearchManager({
        documentRetriever: this.documentRetriever,
        maxConcurrency: options.maxConcurrency || 3,
        timeoutMs: options.timeoutMs || 5000
      });
    }

    if (this.enablePerformanceBenchmarking) {
      this.performanceBenchmark = new PerformanceBenchmark({
        ragManager: this,
        parallelSearchManager: this.parallelSearchManager
      });
    }
    
    this.isInitialized = false;
  }

  /**
   * Initialize the RAG Manager
   */
  async initialize() {
    try {
      logger.info('Initializing RAG Manager...');
      
      // Initialize all components
      await this.inputProcessor.initialize();
      await this.documentRetriever.initialize();
      await this.responseGenerator.initialize();
      await this.outputFormatter.initialize();
      
      if (this.enableDatabaseOptimization) {
        await this.databaseOptimizer.initialize();
      }

      if (this.enableParallelSearch) {
        await this.parallelSearchManager.initialize();
      }

      if (this.enablePerformanceBenchmarking) {
        await this.performanceBenchmark.initialize();
      }
      
      this.isInitialized = true;
      logger.info('RAG Manager initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize RAG Manager:', error);
      throw error;
    }
  }

  /**
   * Process a RAG query
   * @param {Object} queryData - The query data
   * @param {string} queryData.query - The user's query
   * @param {Object} queryData.context - Additional context
   * @param {Object} userAuth - User authentication data
   * @returns {Object} The RAG response
   */
  async processQuery(queryData, userAuth) {
    if (!this.isInitialized) {
      throw new Error('RAG Manager not initialized');
    }

    return this.ragTracing.traceRAGQuery(
      queryData.query,
      {
        queryType: queryData.queryType,
        filters: queryData.filters,
        limit: queryData.limit,
        offset: queryData.offset,
      },
      async (_querySpan) => {
        const startTime = Date.now();
        const traceId = queryData.traceId || this.generateTraceId();
        
        try {
          logger.info('Processing RAG query', {
            traceId,
            userId: userAuth.userId,
            queryLength: queryData.query?.length
          });

          // Step 1: Process and validate input
          const processedInput = await this.ragTracing.traceOperation(
            'rag.input.processing',
            { 'rag.step': 'input_processing' },
            async () => {
              return await this.inputProcessor.process(queryData, userAuth);
            }
          );
          
          // Step 2: Retrieve relevant documents
          let retrievedDocs = await this.ragTracing.traceRetrieval(
            'hybrid', // Default strategy, could be configurable
            {
              limit: processedInput.filters?.limit || 10,
              filters: processedInput.filters,
              threshold: processedInput.filters?.threshold || 0.7,
            },
            async () => {
              if (this.enableParallelSearch) {
                return await this.parallelSearchManager.performParallelSearch(
                  processedInput.query,
                  processedInput.filters,
                  userAuth
                );
              } else {
                return await this.documentRetriever.retrieve(
                  processedInput.query,
                  processedInput.filters,
                  userAuth
                );
              }
            }
          );
          
          // Step 2b: ML-enhanced ranking and filtering
          if (this.enableMLEnhancement && retrievedDocs.length > 0) {
            try {
              // Re-rank documents using ML similarity
              retrievedDocs = await this.mlIntegration.enhanceSearchRanking(
                processedInput.query,
                retrievedDocs
              );
              
              // Assess quality and filter low-quality results
              const qualityThreshold = 0.3;
              const enhancedDocs = await Promise.all(
                retrievedDocs.map(async (doc) => {
                  const quality = await this.mlIntegration.assessDocumentQuality(
                    doc.content || doc.text || ''
                  );
                  return {
                    ...doc,
                    qualityScore: quality.overallScore,
                    qualityLevel: quality.qualityLevel
                  };
                })
              );
              
              // Filter by quality
              retrievedDocs = enhancedDocs.filter(doc => doc.qualityScore >= qualityThreshold);
              
              logger.debug('ML-enhanced document filtering', {
                originalCount: enhancedDocs.length,
                filteredCount: retrievedDocs.length
              });
            } catch (error) {
              logger.warn('ML enhancement failed during retrieval', { error: error.message });
            }
          }
          
          // Step 3: Generate response using LLM
          const generatedResponse = await this.ragTracing.traceGeneration(
            this.llmProviderManager?.getCurrentProvider() || 'unknown',
            {
              model: this.responseGenerator.getModel(),
              promptVersion: '1.0',
              temperature: this.responseGenerator.getTemperature(),
            },
            async () => {
              return await this.responseGenerator.generate(
                processedInput.query,
                retrievedDocs,
                processedInput.context
              );
            }
          );
          
          // Step 4: Format output
          const formattedOutput = await this.ragTracing.traceOperation(
            'rag.output.formatting',
            { 'rag.step': 'output_formatting' },
            async () => {
              return await this.outputFormatter.format(
                generatedResponse,
                retrievedDocs,
                {
                  traceId,
                  processingTime: Date.now() - startTime,
                  metadata: processedInput.metadata
                }
              );
            }
          );
          
          logger.info('RAG query processed successfully', {
            traceId,
            processingTime: Date.now() - startTime,
            documentsRetrieved: retrievedDocs.length,
            responseLength: generatedResponse.content?.length
          });
          
          return {
            ...formattedOutput,
            fromCache: false,
            searchType: 'hybrid',
            totalCount: retrievedDocs.length,
            maxScore: Math.max(...retrievedDocs.map(doc => doc.score || 0)),
            documents: retrievedDocs,
          };
          
        } catch (error) {
          logger.error('Failed to process RAG query', {
            traceId,
            error: error.message,
            processingTime: Date.now() - startTime
          });
          throw error;
        }
      }
    );
  }

  /**
   * Process search results from parallel search manager
   * @param {Array} searchResults - Raw search results from parallel search
   * @param {Object} queryData - Original query data
   * @param {Object} userAuth - User authentication data
   * @returns {Object} Processed RAG response
   */
  async processSearchResults(searchResults, queryData, userAuth) {
    if (!this.isInitialized) {
      throw new Error('RAG Manager not initialized');
    }

    const startTime = Date.now();
    const traceId = queryData.traceId || this.generateTraceId();
    
    try {
      logger.info('Processing parallel search results', {
        traceId,
        userId: userAuth.userId,
        resultCount: searchResults.length
      });

      // Process input for context
      const processedInput = await this.inputProcessor.process(queryData, userAuth);
      
      // Generate response using the search results
      const generatedResponse = await this.ragTracing.traceGeneration(
        this.llmProviderManager?.getCurrentProvider() || 'unknown',
        {
          model: this.responseGenerator.getModel(),
          promptVersion: '1.0',
          temperature: this.responseGenerator.getTemperature(),
        },
        async () => {
          return await this.responseGenerator.generate(
            processedInput.query,
            searchResults,
            processedInput.context
          );
        }
      );
      
      // Format output
      const formattedOutput = await this.outputFormatter.format(
        generatedResponse,
        searchResults,
        {
          traceId,
          processingTime: Date.now() - startTime,
          metadata: processedInput.metadata
        }
      );
      
      logger.info('Parallel search results processed successfully', {
        traceId,
        processingTime: Date.now() - startTime,
        documentsProcessed: searchResults.length,
        responseLength: generatedResponse.content?.length
      });
      
      return {
        ...formattedOutput,
        fromCache: false,
        searchType: 'parallel',
        totalCount: searchResults.length,
        maxScore: Math.max(...searchResults.map(doc => doc.score || 0)),
        documents: searchResults,
      };
      
    } catch (error) {
      logger.error('Failed to process parallel search results', {
        traceId,
        error: error.message,
        processingTime: Date.now() - startTime
      });
      throw error;
    }
  }

  /**
   * Get system health status
   */
  async getHealthStatus() {
    const status = {
      initialized: this.isInitialized,
      components: {
        inputProcessor: await this.inputProcessor.getStatus(),
        documentRetriever: await this.documentRetriever.getStatus(),
        responseGenerator: await this.responseGenerator.getStatus(),
        outputFormatter: await this.outputFormatter.getStatus()
      },
      timestamp: new Date().toISOString()
    };
    
    if (this.enableDatabaseOptimization) {
      status.components.databaseOptimizer = await this.databaseOptimizer.getStatus();
    }

    if (this.enableParallelSearch) {
      status.components.parallelSearchManager = await this.parallelSearchManager.getStatus();
    }

    if (this.enablePerformanceBenchmarking) {
      status.components.performanceBenchmark = await this.performanceBenchmark.getStatus();
    }
    
    return status;
  }

  /**
   * Generate a unique trace ID
   */
  generateTraceId() {
    return `rag_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Shutdown the RAG Manager
   */
  async shutdown() {
    logger.info('Shutting down RAG Manager...');
    
    try {
      await Promise.all([
        this.inputProcessor.shutdown(),
        this.documentRetriever.shutdown(),
        this.responseGenerator.shutdown(),
        this.outputFormatter.shutdown()
      ]);
      
      if (this.enableDatabaseOptimization) {
        await this.databaseOptimizer.shutdown();
      }

      if (this.enableParallelSearch) {
        await this.parallelSearchManager.shutdown();
      }

      if (this.enablePerformanceBenchmarking) {
        await this.performanceBenchmark.shutdown();
      }
      
      this.isInitialized = false;
      logger.info('RAG Manager shut down successfully');
    } catch (error) {
      logger.error('Error during RAG Manager shutdown:', error);
      throw error;
    }
  }
}

module.exports = RAGManager;
