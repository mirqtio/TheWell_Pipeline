/**
 * RAG Manager
 * Orchestrates the Retrieval-Augmented Generation pipeline
 */

const logger = require('../utils/logger');
const DocumentRetriever = require('./components/DocumentRetriever');
const ResponseGenerator = require('./components/ResponseGenerator');
const InputProcessor = require('./components/InputProcessor');
const OutputFormatter = require('./components/OutputFormatter');
const { RAGTracing } = require('../tracing');

class RAGManager {
  constructor(options = {}) {
    this.databaseManager = options.databaseManager;
    this.llmProviderManager = options.llmProviderManager;
    this.visibilityDatabase = options.visibilityDatabase;
    this.cacheManager = options.cacheManager;
    
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
      async (querySpan) => {
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
          const retrievedDocs = await this.ragTracing.traceRetrieval(
            'hybrid', // Default strategy, could be configurable
            {
              limit: processedInput.filters?.limit || 10,
              filters: processedInput.filters,
              threshold: processedInput.filters?.threshold || 0.7,
            },
            async () => {
              return await this.documentRetriever.retrieve(
                processedInput.query,
                processedInput.filters,
                userAuth
              );
            }
          );
          
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
      
      this.isInitialized = false;
      logger.info('RAG Manager shut down successfully');
    } catch (error) {
      logger.error('Error during RAG Manager shutdown:', error);
      throw error;
    }
  }
}

module.exports = RAGManager;
