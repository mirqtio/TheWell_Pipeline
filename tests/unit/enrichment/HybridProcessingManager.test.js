/**
 * Unit tests for HybridProcessingManager
 */

const HybridProcessingManager = require('../../../src/enrichment/HybridProcessingManager');

describe('HybridProcessingManager', () => {
  let manager;
  let mockProviderManager;

  beforeEach(() => {
    // Mock provider manager
    mockProviderManager = {
      executeWithPrompt: jest.fn().mockResolvedValue({
        content: 'Mock enriched content',
        metadata: { processed: true }
      })
    };

    manager = new HybridProcessingManager({
      documentSizeThreshold: 1000,
      complexityThreshold: 0.5,
      costThreshold: 0.05,
      maxConcurrentLocal: 2,
      maxConcurrentCloud: 5
    });
  });

  afterEach(async () => {
    await manager.shutdown();
  });

  describe('initialization', () => {
    it('should initialize with default configuration', () => {
      const defaultManager = new HybridProcessingManager();
      expect(defaultManager.config.documentSizeThreshold).toBe(10000);
      expect(defaultManager.config.complexityThreshold).toBe(0.7);
      expect(defaultManager.metrics.processedDocuments).toBe(0);
    });

    it('should initialize with custom configuration', () => {
      expect(manager.config.documentSizeThreshold).toBe(1000);
      expect(manager.config.complexityThreshold).toBe(0.5);
      expect(manager.config.costThreshold).toBe(0.05);
    });

    it('should initialize strategy usage metrics', () => {
      expect(manager.metrics.strategyUsage.monolithic).toBe(0);
      expect(manager.metrics.strategyUsage.chunked).toBe(0);
      expect(manager.metrics.strategyUsage.agent).toBe(0);
      expect(manager.metrics.strategyUsage.hybrid).toBe(0);
    });
  });

  describe('document analysis', () => {
    it('should analyze simple document correctly', async () => {
      const document = 'This is a simple test document.';
      const analysis = await manager.analyzeDocument(document, { documentId: 'test-1' });

      expect(analysis.size).toBeGreaterThan(0);
      expect(analysis.complexity).toBeGreaterThanOrEqual(0);
      expect(analysis.complexity).toBeLessThanOrEqual(1);
      expect(analysis.sensitivity).toBe(0); // public by default
      expect(analysis.contentType).toBe('text');
    });

    it('should detect code content type', async () => {
      const document = 'function test() {\n  return "hello";\n}';
      const analysis = await manager.analyzeDocument(document);

      expect(analysis.contentType).toBe('code');
    });

    it('should detect markdown content type', async () => {
      const document = '# Header\n\nThis is markdown content.';
      const analysis = await manager.analyzeDocument(document);

      expect(analysis.contentType).toBe('markdown');
    });

    it('should calculate complexity based on document characteristics', async () => {
      const simpleDoc = 'Hello world.';
      const complexDoc = 'The implementation of quantum computing algorithms requires sophisticated understanding of linear algebra, probability theory, and computational complexity. Various quantum gates such as Hadamard, CNOT, and Toffoli gates enable quantum superposition and entanglement.';

      const simpleAnalysis = await manager.analyzeDocument(simpleDoc);
      const complexAnalysis = await manager.analyzeDocument(complexDoc);

      expect(complexAnalysis.complexity).toBeGreaterThan(simpleAnalysis.complexity);
    });

    it('should determine sensitivity from metadata', async () => {
      const document = 'Test document';
      
      const publicAnalysis = await manager.analyzeDocument(document, {});
      const internalAnalysis = await manager.analyzeDocument(document, {
        sensitivityMarkers: ['internal']
      });
      const confidentialAnalysis = await manager.analyzeDocument(document, {
        sensitivityMarkers: ['confidential']
      });

      expect(publicAnalysis.sensitivity).toBe(0);
      expect(internalAnalysis.sensitivity).toBe(1);
      expect(confidentialAnalysis.sensitivity).toBe(2);
    });
  });

  describe('strategy selection', () => {
    it('should select monolithic strategy for simple documents', () => {
      const analysis = {
        size: 500,
        complexity: 0.3,
        sensitivity: 0,
        estimatedCost: 0.01,
        estimatedLatency: 1000
      };

      const strategy = manager.selectProcessingStrategy(analysis);
      expect(strategy.strategy).toBe('monolithic');
    });

    it('should select chunked strategy for large documents', () => {
      const analysis = {
        size: 2000,
        complexity: 0.4,
        sensitivity: 0,
        estimatedCost: 0.03,
        estimatedLatency: 2000
      };

      const strategy = manager.selectProcessingStrategy(analysis);
      expect(strategy.strategy).toBe('chunked');
    });

    it('should select agent strategy for complex documents', () => {
      const analysis = {
        size: 800,
        complexity: 0.8,
        sensitivity: 0,
        estimatedCost: 0.02,
        estimatedLatency: 1500
      };

      const strategy = manager.selectProcessingStrategy(analysis);
      expect(strategy.strategy).toBe('agent');
    });

    it('should enforce local processing for sensitive data', () => {
      const analysis = {
        size: 500,
        complexity: 0.3,
        sensitivity: 2, // confidential
        estimatedCost: 0.01,
        estimatedLatency: 1000
      };

      const strategy = manager.selectProcessingStrategy(analysis);
      expect(strategy.routing.processingLocation).toBe('local');
    });

    it('should consider cost constraints in strategy selection', () => {
      const analysis = {
        size: 500,
        complexity: 0.3,
        sensitivity: 0,
        estimatedCost: 0.1, // high cost
        estimatedLatency: 1000
      };

      const strategy = manager.selectProcessingStrategy(analysis);
      // Should prefer local processing for cost savings
      expect(strategy.routing.processingLocation).toMatch(/local|hybrid/);
    });
  });

  describe('provider routing', () => {
    it('should route to local providers for sensitive data', () => {
      const strategy = 'monolithic';
      const analysis = { sensitivity: 2 }; // confidential
      const constraints = { requiresLocalProcessing: true };

      const routing = manager.determineProviderRouting(strategy, analysis, constraints);

      expect(routing.processingLocation).toBe('local');
      expect(routing.primaryProviders).toEqual(['local-llm', 'ollama']);
    });

    it('should route to cloud providers for non-sensitive data', () => {
      const strategy = 'monolithic';
      const analysis = { sensitivity: 0, estimatedCost: 0.01 };
      const constraints = {};

      const routing = manager.determineProviderRouting(strategy, analysis, constraints);

      expect(routing.processingLocation).toBe('cloud');
      expect(routing.primaryProviders).toEqual(['openai', 'anthropic']);
    });

    it('should allocate appropriate resources based on strategy', () => {
      const monolithicRouting = manager.determineProviderRouting('monolithic', {}, {});
      const agentRouting = manager.determineProviderRouting('agent', {}, {});

      expect(monolithicRouting.resourceAllocation.workers).toBe(1);
      expect(agentRouting.resourceAllocation.workers).toBe(3);
      expect(agentRouting.resourceAllocation.memory).toBe('high');
    });
  });

  describe('monolithic processing', () => {
    it('should execute monolithic processing successfully', async () => {
      const document = 'Test document';
      const metadata = { documentId: 'test-1' };
      const strategy = { strategy: 'monolithic' };

      const result = await manager.executeMonolithicProcessing(
        document,
        metadata,
        strategy,
        mockProviderManager
      );

      expect(result.strategy).toBe('monolithic');
      expect(result.chunks).toBe(1);
      expect(result.processingSteps).toBe(1);
      expect(mockProviderManager.executeWithPrompt).toHaveBeenCalledWith(
        'enrichment-standard',
        document,
        expect.objectContaining({
          documentId: 'test-1',
          processingStrategy: 'monolithic'
        })
      );
    });
  });

  describe('chunked processing', () => {
    it('should split document into chunks and process them', async () => {
      // Create a manager with smaller chunk size for testing
      const testManager = new HybridProcessingManager({
        documentSizeThreshold: 1000,
        complexityThreshold: 0.5,
        costThreshold: 0.05,
        maxConcurrentLocal: 2,
        maxConcurrentCloud: 5,
        maxChunkSize: 100 // Small chunk size for testing
      });
      
      // Create a large document that will be chunked (over 400 characters = 100 tokens)
      const document = 'A'.repeat(500);
      const metadata = { documentId: 'test-1' };
      const strategy = {
        strategy: 'chunked',
        routing: { resourceAllocation: { workers: 2 } }
      };

      const result = await testManager.executeChunkedProcessing(
        document,
        metadata,
        strategy,
        mockProviderManager
      );

      expect(result.strategy).toBe('chunked');
      expect(result.chunks).toBeGreaterThan(1);
      expect(result.processingSteps).toBeGreaterThan(1);
      expect(mockProviderManager.executeWithPrompt).toHaveBeenCalledWith(
        'enrichment-chunked',
        expect.any(String),
        expect.objectContaining({
          processingStrategy: 'chunked'
        })
      );
      
      await testManager.shutdown();
    });
  });

  describe('agent processing', () => {
    it('should execute multi-step agent processing', async () => {
      const document = 'Complex document requiring agent processing';
      const metadata = { documentId: 'test-1' };
      const strategy = { strategy: 'agent' };

      const result = await manager.executeAgentProcessing(
        document,
        metadata,
        strategy,
        mockProviderManager
      );

      expect(result.strategy).toBe('agent');
      expect(result.processingSteps).toBe(3); // analysis, extraction, synthesis
      expect(result.stepResults).toHaveLength(3);
      
      // Should call provider for each step
      expect(mockProviderManager.executeWithPrompt).toHaveBeenCalledTimes(3);
      expect(mockProviderManager.executeWithPrompt).toHaveBeenCalledWith(
        'enrichment-analysis',
        expect.any(String),
        expect.objectContaining({ processingStep: 'analysis' })
      );
    });
  });

  describe('hybrid processing', () => {
    it('should analyze sections and apply different strategies', async () => {
      const document = '# Header 1\nSimple content.\n\n# Header 2\nThis is a more complex section with technical details and sophisticated vocabulary that requires advanced processing capabilities.';
      const metadata = { documentId: 'test-1' };
      const strategy = { strategy: 'hybrid' };

      const result = await manager.executeHybridProcessing(
        document,
        metadata,
        strategy,
        mockProviderManager
      );

      expect(result.strategy).toBe('hybrid');
      expect(result.sectionResults).toBeDefined();
      expect(result.sectionResults.length).toBeGreaterThan(0);
    });
  });

  describe('full processing workflow', () => {
    it('should complete full processing workflow for simple document', async () => {
      const document = 'This is a test document.';
      const metadata = { documentId: 'test-1' };

      // Analyze document
      const analysis = await manager.analyzeDocument(document, metadata);
      
      // Select strategy
      const strategy = manager.selectProcessingStrategy(analysis);
      
      // Execute processing
      const result = await manager.executeProcessing(
        document,
        metadata,
        strategy,
        mockProviderManager
      );

      expect(result.strategy).toBeDefined();
      expect(result.result).toBeDefined();
      expect(manager.metrics.processedDocuments).toBe(1);
    });

    it('should emit processing events', async () => {
      const document = 'Test document';
      const metadata = { documentId: 'test-1' };
      
      const completeHandler = jest.fn();
      manager.on('processing_complete', completeHandler);

      const analysis = await manager.analyzeDocument(document, metadata);
      const strategy = manager.selectProcessingStrategy(analysis);
      
      await manager.executeProcessing(document, metadata, strategy, mockProviderManager);

      expect(completeHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          strategy: expect.any(String),
          documentId: 'test-1',
          success: true
        })
      );
    });

    it('should handle processing failures gracefully', async () => {
      const document = 'Test document';
      const metadata = { documentId: 'test-1' };
      
      // Mock provider to throw error
      mockProviderManager.executeWithPrompt.mockRejectedValue(new Error('Provider error'));
      
      const failHandler = jest.fn();
      manager.on('processing_failed', failHandler);

      const analysis = await manager.analyzeDocument(document, metadata);
      const strategy = manager.selectProcessingStrategy(analysis);
      
      await expect(
        manager.executeProcessing(document, metadata, strategy, mockProviderManager)
      ).rejects.toThrow('Provider error');

      expect(failHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          documentId: 'test-1',
          error: 'Provider error'
        })
      );
    });
  });

  describe('resource management', () => {
    it('should track resource usage correctly', async () => {
      const document = 'Test document';
      const metadata = { documentId: 'test-1' };

      const analysis = await manager.analyzeDocument(document, metadata);
      const strategy = manager.selectProcessingStrategy(analysis);
      
      // Start processing (should increment resource usage)
      const processingPromise = manager.executeProcessing(
        document,
        metadata,
        strategy,
        mockProviderManager
      );

      // Check resource usage during processing
      const metrics = manager.getMetrics();
      expect(metrics.activeProcesses).toBe(1);

      // Wait for completion
      await processingPromise;

      // Check resource usage after completion
      const finalMetrics = manager.getMetrics();
      expect(finalMetrics.activeProcesses).toBe(0);
    });

    it('should respect concurrency limits', () => {
      expect(manager.config.maxConcurrentLocal).toBe(2);
      expect(manager.config.maxConcurrentCloud).toBe(5);
    });
  });

  describe('metrics and recommendations', () => {
    it('should provide processing metrics', () => {
      const metrics = manager.getMetrics();
      
      expect(metrics.processedDocuments).toBe(0);
      expect(metrics.strategyUsage).toBeDefined();
      expect(metrics.averageProcessingTime).toBe(0);
      expect(metrics.activeProcesses).toBe(0);
      expect(metrics.resourceUsage).toBeDefined();
    });

    it('should provide processing recommendations', () => {
      const highCostAnalysis = {
        estimatedCost: 0.2,
        estimatedLatency: 2000,
        complexity: 0.3
      };

      const recommendations = manager.getProcessingRecommendations(highCostAnalysis);
      
      expect(recommendations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'cost_optimization',
            impact: 'high'
          })
        ])
      );
    });

    it('should recommend latency optimization for slow processing', () => {
      const highLatencyAnalysis = {
        estimatedCost: 0.01,
        estimatedLatency: 10000, // 10 seconds
        complexity: 0.3
      };

      const recommendations = manager.getProcessingRecommendations(highLatencyAnalysis);
      
      expect(recommendations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'latency_optimization',
            impact: 'medium'
          })
        ])
      );
    });
  });

  describe('utility functions', () => {
    it('should calculate document size correctly', () => {
      const textDoc = 'Hello world';
      const objectDoc = { text: 'Hello world', metadata: { id: 1 } };

      const textSize = manager.calculateDocumentSize(textDoc);
      const objectSize = manager.calculateDocumentSize(objectDoc);

      expect(textSize).toBeGreaterThan(0);
      expect(objectSize).toBeGreaterThan(textSize);
    });

    it('should split documents into chunks correctly', () => {
      // Override chunk size for testing
      const originalChunkSize = manager.config.maxChunkSize;
      manager.config.maxChunkSize = 10; // 10 tokens = ~40 chars
      
      const longDocument = 'A'.repeat(200);
      const chunks = manager.splitDocumentIntoChunks(longDocument);

      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks[0].length).toBeLessThanOrEqual(40);

      manager.config.maxChunkSize = originalChunkSize;
    });

    it('should analyze document sections correctly', () => {
      const document = '# Section 1\nContent 1\n\n# Section 2\nContent 2';
      const sections = manager.analyzeDocumentSections(document);

      expect(sections.length).toBeGreaterThanOrEqual(2);
      expect(sections[0].content).toContain('Section 1');
      expect(sections[1].content).toContain('Section 2');
    });

    it('should generate unique process IDs', () => {
      const id1 = manager.generateProcessId();
      const id2 = manager.generateProcessId();

      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^proc_\d+_[a-z0-9]+$/);
    });
  });

  describe('shutdown', () => {
    it('should shutdown gracefully', async () => {
      await manager.shutdown();
      
      expect(manager.activeProcesses.size).toBe(0);
      expect(manager.resourceUsage.local).toBe(0);
      expect(manager.resourceUsage.cloud).toBe(0);
    });

    it('should wait for active processes during shutdown', async () => {
      // Simulate an active process
      manager.activeProcesses.set('test-process', {
        strategy: 'monolithic',
        startTime: Date.now(),
        documentId: 'test-1'
      });

      const shutdownPromise = manager.shutdown();
      
      // Remove the process after a short delay
      setTimeout(() => {
        manager.activeProcesses.delete('test-process');
      }, 100);

      await shutdownPromise;
      expect(manager.activeProcesses.size).toBe(0);
    });
  });
});
