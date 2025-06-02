/**
 * Hybrid Processing Manager
 * 
 * Manages hybrid processing architecture that dynamically selects between
 * different processing strategies based on workload, cost, data sensitivity,
 * and resource availability.
 */

const EventEmitter = require('events');
const logger = require('../utils/logger');

class HybridProcessingManager extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      // Processing strategy thresholds
      documentSizeThreshold: 10000, // bytes - switch to chunked processing
      complexityThreshold: 0.7, // complexity score threshold
      costThreshold: 0.1, // cost per token threshold
      latencyThreshold: 5000, // ms - switch to faster providers
      
      // Resource allocation
      maxConcurrentLocal: 2,
      maxConcurrentCloud: 10,
      maxChunkSize: 4000, // tokens
      chunkOverlap: 200, // tokens
      
      // Data sensitivity levels
      sensitivityLevels: {
        public: 0,
        internal: 1,
        confidential: 2,
        restricted: 3
      },
      
      // Provider routing rules
      localProviders: ['local-llm', 'ollama'],
      cloudProviders: ['openai', 'anthropic'],
      
      // Processing strategies
      strategies: {
        monolithic: {
          name: 'monolithic',
          description: 'Single-pass processing for simple documents',
          maxDocumentSize: 10000,
          maxComplexity: 0.5
        },
        chunked: {
          name: 'chunked',
          description: 'Chunked processing for large documents',
          minDocumentSize: 8000,
          maxComplexity: 0.8
        },
        agent: {
          name: 'agent',
          description: 'Agent-based processing for complex documents',
          minComplexity: 0.7,
          requiresMultiStep: true
        },
        hybrid: {
          name: 'hybrid',
          description: 'Combination of strategies based on content analysis',
          adaptiveThreshold: 0.6
        }
      },
      
      ...config
    };
    
    this.activeProcesses = new Map();
    this.resourceUsage = {
      local: 0,
      cloud: 0
    };
    
    this.metrics = {
      processedDocuments: 0,
      strategyUsage: {},
      averageProcessingTime: 0,
      costSavings: 0
    };
    
    this.initializeStrategies();
  }

  /**
   * Initialize processing strategies
   */
  initializeStrategies() {
    // Initialize strategy usage counters
    Object.keys(this.config.strategies).forEach(strategy => {
      this.metrics.strategyUsage[strategy] = 0;
    });
    
    logger.info('Hybrid processing manager initialized', {
      strategies: Object.keys(this.config.strategies),
      config: {
        documentSizeThreshold: this.config.documentSizeThreshold,
        complexityThreshold: this.config.complexityThreshold,
        costThreshold: this.config.costThreshold,
        maxConcurrentLocal: this.config.maxConcurrentLocal,
        maxConcurrentCloud: this.config.maxConcurrentCloud
      }
    });
  }

  /**
   * Analyze document and determine optimal processing strategy
   */
  async analyzeDocument(document, metadata = {}) {
    try {
      const analysis = {
        size: this.calculateDocumentSize(document),
        complexity: await this.calculateComplexity(document),
        sensitivity: this.determineSensitivity(metadata),
        contentType: this.analyzeContentType(document),
        estimatedCost: 0,
        estimatedLatency: 0
      };

      // Calculate estimated processing cost and latency
      analysis.estimatedCost = this.estimateProcessingCost(analysis);
      analysis.estimatedLatency = this.estimateProcessingLatency(analysis);

      logger.debug('Document analysis completed', {
        documentId: metadata.documentId,
        analysis
      });

      return analysis;
    } catch (error) {
      logger.error('Failed to analyze document', {
        error: error.message,
        documentId: metadata.documentId
      });
      throw error;
    }
  }

  /**
   * Select optimal processing strategy based on document analysis
   */
  async selectProcessingStrategy(analysis) {
    // Apply constraints (budget, time, data sensitivity)
    const effectiveConstraints = {
      maxCost: analysis.maxCost || Infinity,
      maxLatency: analysis.maxLatency || Infinity,
      requiresLocalProcessing: analysis.sensitivity >= this.config.sensitivityLevels.confidential
    };

    let selectedStrategy = 'monolithic'; // default

    // Strategy selection logic
    if (effectiveConstraints.requiresLocalProcessing) {
      // High sensitivity data must be processed locally
      if (analysis.complexity > this.config.complexityThreshold) {
        selectedStrategy = 'agent';
      } else if (analysis.size > this.config.documentSizeThreshold) {
        selectedStrategy = 'chunked';
      } else {
        selectedStrategy = 'monolithic';
      }
    } else {
      // Can use cloud processing
      if (analysis.complexity > this.config.complexityThreshold && 
          analysis.estimatedLatency < effectiveConstraints.maxLatency) {
        selectedStrategy = 'agent';
      } else if (analysis.size > this.config.documentSizeThreshold) {
        selectedStrategy = 'chunked';
      } else if (analysis.estimatedCost > this.config.costThreshold && 
                 this.resourceUsage.local < this.config.maxConcurrentLocal) {
        selectedStrategy = 'monolithic'; // prefer local for cost savings
      } else {
        selectedStrategy = 'monolithic';
      }
    }

    // Check if hybrid strategy would be better
    if (this.shouldUseHybridStrategy(analysis, selectedStrategy)) {
      selectedStrategy = 'hybrid';
    }

    logger.info('Processing strategy selected', {
      strategy: selectedStrategy,
      analysis,
      constraints: effectiveConstraints
    });

    return {
      strategy: selectedStrategy,
      config: this.config.strategies[selectedStrategy],
      routing: this.determineProviderRouting(selectedStrategy, analysis, effectiveConstraints)
    };
  }

  /**
   * Select optimal processing strategy based on document analysis
   */
  async _selectProcessingStrategy(document, metadata, _selectedStrategy) {
    const {
      size,
      complexity,
      sensitivity,
      estimatedCost,
      estimatedLatency
    } = await this.analyzeDocument(document, metadata);

    // Apply constraints (budget, time, data sensitivity)
    const effectiveConstraints = {
      maxCost: metadata.maxCost || Infinity,
      maxLatency: metadata.maxLatency || Infinity,
      requiresLocalProcessing: sensitivity >= this.config.sensitivityLevels.confidential,
      ...metadata
    };

    let selectedStrategy = 'monolithic'; // default

    // Strategy selection logic
    if (effectiveConstraints.requiresLocalProcessing) {
      // High sensitivity data must be processed locally
      if (complexity > this.config.complexityThreshold) {
        selectedStrategy = 'agent';
      } else if (size > this.config.documentSizeThreshold) {
        selectedStrategy = 'chunked';
      } else {
        selectedStrategy = 'monolithic';
      }
    } else {
      // Can use cloud processing
      if (complexity > this.config.complexityThreshold && 
          estimatedLatency < effectiveConstraints.maxLatency) {
        selectedStrategy = 'agent';
      } else if (size > this.config.documentSizeThreshold) {
        selectedStrategy = 'chunked';
      } else if (estimatedCost > this.config.costThreshold && 
                 this.resourceUsage.local < this.config.maxConcurrentLocal) {
        selectedStrategy = 'monolithic'; // prefer local for cost savings
      } else {
        selectedStrategy = 'monolithic';
      }
    }

    // Check if hybrid strategy would be better
    if (this.shouldUseHybridStrategy({ size, complexity, estimatedCost, estimatedLatency }, _selectedStrategy)) {
      selectedStrategy = 'hybrid';
    }

    logger.info('Processing strategy selected', {
      strategy: selectedStrategy,
      analysis: {
        size,
        complexity,
        sensitivity,
        estimatedCost,
        estimatedLatency
      },
      constraints: effectiveConstraints
    });

    return {
      strategy: selectedStrategy,
      config: this.config.strategies[selectedStrategy],
      routing: this.determineProviderRouting(selectedStrategy, { size, complexity, estimatedCost, estimatedLatency }, effectiveConstraints)
    };
  }

  /**
   * Determine provider routing based on strategy and constraints
   */
  determineProviderRouting(strategy, analysis, constraints) {
    const routing = {
      primaryProviders: [],
      fallbackProviders: [],
      processingLocation: 'cloud', // 'local', 'cloud', or 'hybrid'
      resourceAllocation: {}
    };

    if (constraints.requiresLocalProcessing || analysis.sensitivity >= this.config.sensitivityLevels.confidential) {
      routing.processingLocation = 'local';
      routing.primaryProviders = this.config.localProviders;
      routing.fallbackProviders = [];
    } else if (analysis.estimatedCost > this.config.costThreshold && 
               this.resourceUsage.local < this.config.maxConcurrentLocal) {
      routing.processingLocation = 'hybrid';
      routing.primaryProviders = this.config.localProviders;
      routing.fallbackProviders = this.config.cloudProviders;
    } else {
      routing.processingLocation = 'cloud';
      routing.primaryProviders = this.config.cloudProviders;
      routing.fallbackProviders = this.config.localProviders;
    }

    // Resource allocation based on strategy
    switch (strategy) {
    case 'monolithic':
      routing.resourceAllocation = { workers: 1, memory: 'standard' };
      break;
    case 'chunked':
      routing.resourceAllocation = { workers: 2, memory: 'high' };
      break;
    case 'agent':
      routing.resourceAllocation = { workers: 3, memory: 'high' };
      break;
    case 'hybrid':
      routing.resourceAllocation = { workers: 2, memory: 'high' };
      break;
    }

    return routing;
  }

  /**
   * Execute processing with selected strategy
   */
  async executeProcessing(document, metadata, strategy, providerManager) {
    const processId = this.generateProcessId();
    const startTime = Date.now();

    try {
      // Track active process
      this.activeProcesses.set(processId, {
        strategy: strategy.strategy,
        startTime,
        documentId: metadata.documentId
      });

      // Update resource usage
      this.updateResourceUsage(strategy.routing.processingLocation, 1);

      let result;

      switch (strategy.strategy) {
      case 'monolithic':
        result = await this.executeMonolithicProcessing(document, metadata, strategy, providerManager);
        break;
      case 'chunked':
        result = await this.executeChunkedProcessing(document, metadata, strategy, providerManager);
        break;
      case 'agent':
        result = await this.executeAgentProcessing(document, metadata, strategy, providerManager);
        break;
      case 'hybrid':
        result = await this.executeHybridProcessing(document, metadata, strategy, providerManager);
        break;
      default:
        throw new Error(`Unknown processing strategy: ${strategy.strategy}`);
      }

      const processingTime = Date.now() - startTime;
      
      // Update metrics
      this.updateMetrics(strategy.strategy, processingTime);

      // Emit success event
      this.emit('processing_complete', {
        processId,
        strategy: strategy.strategy,
        processingTime,
        documentId: metadata.documentId,
        success: true
      });

      logger.info('Processing completed successfully', {
        processId,
        strategy: strategy.strategy,
        processingTime,
        documentId: metadata.documentId
      });

      return result;

    } catch (error) {
      const processingTime = Date.now() - startTime;
      
      // Emit failure event
      this.emit('processing_failed', {
        processId,
        strategy: strategy.strategy,
        processingTime,
        documentId: metadata.documentId,
        error: error.message
      });

      logger.error('Processing failed', {
        processId,
        strategy: strategy.strategy,
        processingTime,
        documentId: metadata.documentId,
        error: error.message
      });

      throw error;
    } finally {
      // Clean up
      this.activeProcesses.delete(processId);
      this.updateResourceUsage(strategy.routing.processingLocation, -1);
    }
  }

  /**
   * Execute monolithic processing strategy
   */
  async executeMonolithicProcessing(document, metadata, strategy, providerManager) {
    logger.debug('Executing monolithic processing', {
      documentId: metadata.documentId,
      strategy: strategy.strategy
    });

    // Single-pass processing
    const result = await providerManager.executeWithPrompt(
      'enrichment-standard',
      document,
      {
        ...metadata,
        processingStrategy: 'monolithic'
      }
    );

    return {
      strategy: 'monolithic',
      result,
      chunks: 1,
      processingSteps: 1
    };
  }

  /**
   * Execute chunked processing strategy
   */
  async executeChunkedProcessing(document, metadata, strategy, providerManager) {
    const processId = this.generateProcessId();
    const startTime = Date.now();
    
    try {
      this.activeProcesses.set(processId, {
        strategy: 'chunked',
        startTime,
        documentId: metadata.documentId
      });
      
      // Convert document to text if needed
      const text = typeof document === 'string' ? document : JSON.stringify(document);
      
      // Split into chunks
      const chunks = this.splitDocumentIntoChunks(text);
      
      // Process chunks with controlled concurrency
      const maxConcurrent = strategy.routing?.resourceAllocation?.workers || 2;
      const chunkResults = [];
      
      for (let i = 0; i < chunks.length; i += maxConcurrent) {
        const batch = chunks.slice(i, i + maxConcurrent);
        const batchPromises = batch.map((chunk, index) => 
          providerManager.executeWithPrompt(
            'enrichment-chunked',
            chunk,
            {
              ...metadata,
              processingStrategy: 'chunked',
              chunkIndex: i + index,
              totalChunks: chunks.length
            }
          )
        );
        
        const batchResults = await Promise.all(batchPromises);
        chunkResults.push(...batchResults);
      }
      
      // Combine results
      const combinedResult = {
        content: chunkResults.map(r => r.content).join('\n\n'),
        metadata: {
          ...chunkResults[0]?.metadata,
          chunks: chunks.length,
          processingStrategy: 'chunked'
        }
      };
      
      const endTime = Date.now();
      const processingTime = endTime - startTime;
      
      // Update metrics
      this.metrics.processedDocuments++;
      this.metrics.strategyUsage.chunked++;
      this.metrics.totalProcessingTime += processingTime;
      this.metrics.averageProcessingTime = this.metrics.totalProcessingTime / this.metrics.processedDocuments;
      
      const result = {
        strategy: 'chunked',
        result: combinedResult,
        chunks: chunks.length,
        processingSteps: chunks.length,
        processingTime,
        processId
      };
      
      this.emit('processing_complete', {
        strategy: 'chunked',
        documentId: metadata.documentId,
        processingTime,
        chunks: chunks.length,
        success: true
      });
      
      return result;
      
    } catch (error) {
      this.logger.error('Chunked processing failed', { 
        error: error.message,
        documentId: metadata.documentId,
        processId 
      });
      
      this.emit('processing_failed', {
        strategy: 'chunked',
        documentId: metadata.documentId,
        error: error.message,
        processId
      });
      
      throw error;
    } finally {
      this.activeProcesses.delete(processId);
    }
  }

  /**
   * Execute agent-based processing strategy
   */
  async executeAgentProcessing(document, metadata, strategy, providerManager) {
    logger.debug('Executing agent-based processing', {
      documentId: metadata.documentId,
      strategy: strategy.strategy
    });

    // Multi-step agent processing
    const steps = [
      { name: 'analysis', prompt: 'enrichment-analysis' },
      { name: 'extraction', prompt: 'enrichment-extraction' },
      { name: 'synthesis', prompt: 'enrichment-synthesis' }
    ];

    let currentResult = document;
    const stepResults = [];

    for (const step of steps) {
      const stepMetadata = {
        ...metadata,
        processingStep: step.name,
        processingStrategy: 'agent'
      };

      const stepResult = await providerManager.executeWithPrompt(
        step.prompt,
        currentResult,
        stepMetadata
      );

      stepResults.push({
        step: step.name,
        result: stepResult
      });

      currentResult = stepResult.content || stepResult;
    }

    return {
      strategy: 'agent',
      result: currentResult,
      chunks: 1,
      processingSteps: steps.length,
      stepResults
    };
  }

  /**
   * Execute hybrid processing strategy
   */
  async executeHybridProcessing(document, metadata, strategy, providerManager) {
    logger.debug('Executing hybrid processing', {
      documentId: metadata.documentId,
      strategy: strategy.strategy
    });

    // Analyze document sections for different processing approaches
    const sections = this.analyzeDocumentSections(document);
    const sectionResults = [];

    for (const section of sections) {
      let sectionStrategy;
      
      if (section.complexity > this.config.complexityThreshold) {
        sectionStrategy = 'agent';
      } else if (section.size > this.config.documentSizeThreshold / 2) {
        sectionStrategy = 'chunked';
      } else {
        sectionStrategy = 'monolithic';
      }

      const sectionMetadata = {
        ...metadata,
        sectionId: section.id,
        sectionStrategy,
        processingStrategy: 'hybrid'
      };

      let sectionResult;
      switch (sectionStrategy) {
      case 'agent':
        sectionResult = await this.executeAgentProcessing(section.content, sectionMetadata, strategy, providerManager);
        break;
      case 'chunked':
        sectionResult = await this.executeChunkedProcessing(section.content, sectionMetadata, strategy, providerManager);
        break;
      default:
        sectionResult = await this.executeMonolithicProcessing(section.content, sectionMetadata, strategy, providerManager);
      }

      sectionResults.push({
        sectionId: section.id,
        strategy: sectionStrategy,
        result: sectionResult
      });
    }

    // Combine section results
    const combinedResult = await this.combineSectionResults(sectionResults, metadata);

    return {
      strategy: 'hybrid',
      result: combinedResult,
      chunks: sections.length,
      processingSteps: sectionResults.reduce((sum, sr) => sum + sr.result.processingSteps, 0),
      sectionResults
    };
  }

  /**
   * Calculate document size in bytes
   */
  calculateDocumentSize(document) {
    if (typeof document === 'string') {
      return Buffer.byteLength(document, 'utf8');
    }
    return JSON.stringify(document).length;
  }

  /**
   * Calculate document complexity score
   */
  async calculateComplexity(document) {
    // Simple complexity calculation based on various factors
    const text = typeof document === 'string' ? document : JSON.stringify(document);
    
    let complexity = 0;
    
    // Length factor
    complexity += Math.min(text.length / 10000, 0.3);
    
    // Vocabulary diversity
    const words = text.toLowerCase().match(/\b\w+\b/g) || [];
    const uniqueWords = new Set(words);
    const vocabularyDiversity = uniqueWords.size / Math.max(words.length, 1);
    complexity += vocabularyDiversity * 0.3;
    
    // Sentence complexity
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const avgSentenceLength = words.length / Math.max(sentences.length, 1);
    complexity += Math.min(avgSentenceLength / 20, 0.2);
    
    // Technical content indicators
    const technicalPatterns = [
      /\b\d+\.\d+\b/g, // numbers with decimals
      /\b[A-Z]{2,}\b/g, // acronyms
      /\b\w+@\w+\.\w+\b/g, // emails
      /https?:\/\/\S+/g // URLs
    ];
    
    let technicalScore = 0;
    technicalPatterns.forEach(pattern => {
      const matches = text.match(pattern) || [];
      technicalScore += matches.length / Math.max(text.length / 1000, 1);
    });
    complexity += Math.min(technicalScore, 0.2);
    
    return Math.min(complexity, 1.0);
  }

  /**
   * Determine data sensitivity level
   */
  determineSensitivity(metadata) {
    const sensitivityMarkers = metadata.sensitivityMarkers || [];
    const source = metadata.source || '';
    
    // Check for explicit sensitivity markers
    if (sensitivityMarkers.includes('restricted')) {
      return this.config.sensitivityLevels.restricted;
    }
    if (sensitivityMarkers.includes('confidential')) {
      return this.config.sensitivityLevels.confidential;
    }
    if (sensitivityMarkers.includes('internal')) {
      return this.config.sensitivityLevels.internal;
    }
    
    // Infer from source
    if (source.includes('internal') || source.includes('private')) {
      return this.config.sensitivityLevels.internal;
    }
    
    return this.config.sensitivityLevels.public;
  }

  /**
   * Analyze content type
   */
  analyzeContentType(document) {
    const text = typeof document === 'string' ? document : JSON.stringify(document);
    
    // Simple content type detection
    if (text.includes('```') || text.includes('function') || text.includes('class')) {
      return 'code';
    }
    if (text.includes('|') && text.includes('---')) {
      return 'table';
    }
    if (text.match(/^\s*[-*+]\s/m)) {
      return 'list';
    }
    if (text.match(/^#+ /m)) {
      return 'markdown';
    }
    
    return 'text';
  }

  /**
   * Estimate processing cost
   */
  estimateProcessingCost(analysis) {
    const baseTokens = analysis.size / 4; // rough estimate: 4 chars per token
    const complexityMultiplier = 1 + analysis.complexity;
    const estimatedTokens = baseTokens * complexityMultiplier;
    
    // Cost per token (rough estimate)
    const costPerToken = 0.00002; // $0.00002 per token
    
    return estimatedTokens * costPerToken;
  }

  /**
   * Estimate processing latency
   */
  estimateProcessingLatency(analysis) {
    const baseLatency = 1000; // 1 second base
    const sizeMultiplier = Math.log(analysis.size / 1000 + 1);
    const complexityMultiplier = 1 + analysis.complexity * 2;
    
    return baseLatency * sizeMultiplier * complexityMultiplier;
  }

  /**
   * Check if hybrid strategy should be used
   */
  shouldUseHybridStrategy(analysis, _selectedStrategy) {
    // Use hybrid if document has mixed complexity sections
    return analysis.complexity > this.config.strategies.hybrid.adaptiveThreshold &&
           analysis.size > this.config.documentSizeThreshold * 0.8;
  }

  /**
   * Split document into chunks
   */
  splitDocumentIntoChunks(text) {
    const chunks = [];
    const chunkSize = this.config.maxChunkSize || 1000; // tokens
    const overlap = Math.floor(chunkSize * 0.1); // 10% overlap
    
    // Convert tokens to approximate character count (1 token ≈ 4 characters)
    const chunkSizeChars = chunkSize * 4;
    const overlapChars = overlap * 4;
    
    if (text.length <= chunkSizeChars) {
      return [text];
    }
    
    for (let i = 0; i < text.length; i += chunkSizeChars - overlapChars) {
      const chunk = text.slice(i, i + chunkSizeChars);
      if (chunk.trim().length > 0) {
        chunks.push(chunk);
      }
    }
    
    return chunks.length > 0 ? chunks : [text];
  }

  /**
   * Merge chunk results
   */
  async mergeChunkResults(chunkResults, metadata) {
    // Simple merging - in practice, this would be more sophisticated
    const mergedContent = chunkResults.map(result => result.content || result).join('\n\n');
    
    return {
      content: mergedContent,
      metadata: {
        ...metadata,
        processingStrategy: 'chunked',
        chunksProcessed: chunkResults.length
      }
    };
  }

  /**
   * Analyze document sections
   */
  analyzeDocumentSections(document) {
    const text = typeof document === 'string' ? document : JSON.stringify(document);
    
    // Simple section detection based on headers or paragraph breaks
    const sections = [];
    const paragraphs = text.split(/\n\s*\n/);
    
    let currentSection = { id: 0, content: '', size: 0, complexity: 0 };
    
    for (let i = 0; i < paragraphs.length; i++) {
      const paragraph = paragraphs[i].trim();
      
      if (paragraph.length === 0) continue;
      
      // Check if this starts a new section (header pattern)
      if (paragraph.match(/^#+\s/) || paragraph.match(/^[A-Z][^.]*:?\s*$/)) {
        if (currentSection.content.length > 0) {
          currentSection.complexity = this.calculateSectionComplexity(currentSection.content);
          sections.push(currentSection);
        }
        currentSection = {
          id: sections.length,
          content: paragraph + '\n',
          size: paragraph.length,
          complexity: 0
        };
      } else {
        currentSection.content += paragraph + '\n';
        currentSection.size += paragraph.length;
      }
    }
    
    // Add the last section
    if (currentSection.content.length > 0) {
      currentSection.complexity = this.calculateSectionComplexity(currentSection.content);
      sections.push(currentSection);
    }
    
    return sections;
  }

  /**
   * Calculate section complexity
   */
  calculateSectionComplexity(content) {
    // Simplified complexity calculation for sections
    const words = content.split(/\s+/).length;
    const sentences = content.split(/[.!?]+/).length;
    const avgWordsPerSentence = words / Math.max(sentences, 1);
    
    return Math.min(avgWordsPerSentence / 15, 1.0);
  }

  /**
   * Combine section results
   */
  async combineSectionResults(sectionResults, metadata) {
    const combinedContent = sectionResults.map(sr => sr.result.result.content || sr.result.result).join('\n\n');
    
    return {
      content: combinedContent,
      metadata: {
        ...metadata,
        processingStrategy: 'hybrid',
        sectionsProcessed: sectionResults.length,
        sectionStrategies: sectionResults.map(sr => ({
          sectionId: sr.sectionId,
          strategy: sr.strategy
        }))
      }
    };
  }

  /**
   * Update resource usage
   */
  updateResourceUsage(location, delta) {
    if (location === 'local') {
      this.resourceUsage.local = Math.max(0, this.resourceUsage.local + delta);
    } else if (location === 'cloud') {
      this.resourceUsage.cloud = Math.max(0, this.resourceUsage.cloud + delta);
    } else if (location === 'hybrid') {
      // For hybrid, update both
      this.resourceUsage.local = Math.max(0, this.resourceUsage.local + Math.ceil(delta / 2));
      this.resourceUsage.cloud = Math.max(0, this.resourceUsage.cloud + Math.floor(delta / 2));
    }
  }

  /**
   * Update processing metrics
   */
  updateMetrics(strategy, processingTime) {
    this.metrics.processedDocuments++;
    this.metrics.strategyUsage[strategy] = (this.metrics.strategyUsage[strategy] || 0) + 1;
    
    // Update average processing time
    const totalTime = this.metrics.averageProcessingTime * (this.metrics.processedDocuments - 1) + processingTime;
    this.metrics.averageProcessingTime = totalTime / this.metrics.processedDocuments;
  }

  /**
   * Generate unique process ID
   */
  generateProcessId() {
    return `proc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get current metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      activeProcesses: this.activeProcesses.size,
      resourceUsage: { ...this.resourceUsage }
    };
  }

  /**
   * Get processing recommendations
   */
  getProcessingRecommendations(analysis) {
    const recommendations = [];
    
    if (analysis.estimatedCost > this.config.costThreshold) {
      recommendations.push({
        type: 'cost_optimization',
        message: 'Consider using local processing to reduce costs',
        impact: 'high'
      });
    }
    
    if (analysis.estimatedLatency > this.config.latencyThreshold) {
      recommendations.push({
        type: 'latency_optimization',
        message: 'Consider using cloud processing for faster results',
        impact: 'medium'
      });
    }
    
    if (analysis.complexity > this.config.complexityThreshold) {
      recommendations.push({
        type: 'strategy_optimization',
        message: 'Consider using agent-based processing for better results',
        impact: 'high'
      });
    }
    
    return recommendations;
  }

  /**
   * Cleanup and shutdown
   */
  async shutdown() {
    logger.info('Shutting down hybrid processing manager');
    
    // Wait for active processes to complete (with timeout)
    const timeout = 30000; // 30 seconds
    const startTime = Date.now();
    
    while (this.activeProcesses.size > 0 && (Date.now() - startTime) < timeout) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    if (this.activeProcesses.size > 0) {
      logger.warn('Forcing shutdown with active processes', {
        activeProcesses: this.activeProcesses.size
      });
    }
    
    this.activeProcesses.clear();
    this.resourceUsage = { local: 0, cloud: 0 };
    
    logger.info('Hybrid processing manager shutdown complete');
  }
}

module.exports = HybridProcessingManager;
