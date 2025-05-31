// Mock dependencies
jest.mock('../../../../src/ingestion/handlers/SourceHandlerRegistry', () => {
  return jest.fn().mockImplementation(() => ({
    initialize: jest.fn().mockResolvedValue(undefined),
    registerSource: jest.fn().mockResolvedValue('test-source-id'),
    hasSource: jest.fn().mockReturnValue(false),
    getHandler: jest.fn().mockReturnValue({
      discover: jest.fn(),
      extract: jest.fn(),
      transform: jest.fn()
    }),
    unregisterSource: jest.fn().mockResolvedValue(undefined),
    cleanup: jest.fn().mockResolvedValue(undefined)
  }));
});

jest.mock('../../../../src/ingestion/IngestionEngine', () => {
  return jest.fn().mockImplementation(() => ({
    initialize: jest.fn().mockResolvedValue(undefined),
    shutdown: jest.fn().mockResolvedValue(undefined)
  }));
});

const IngestionJobProcessor = require('../../../../src/ingestion/queue/IngestionJobProcessor');
const SourceHandlerRegistry = require('../../../../src/ingestion/handlers/SourceHandlerRegistry');
const IngestionEngine = require('../../../../src/ingestion/IngestionEngine');

describe('IngestionJobProcessor', () => {
  let processor;
  let mockRegistry;
  let mockEngine;
  let mockHandler;
  let mockJob;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock handler
    mockHandler = {
      discover: jest.fn(),
      extract: jest.fn(),
      transform: jest.fn()
    };

    // Mock registry
    mockRegistry = new SourceHandlerRegistry();
    mockRegistry.initialize.mockResolvedValue(undefined);
    mockRegistry.registerSource.mockResolvedValue('test-source-id');
    mockRegistry.hasSource.mockReturnValue(false);
    mockRegistry.getHandler.mockReturnValue(mockHandler);
    mockRegistry.unregisterSource.mockResolvedValue(undefined);
    mockRegistry.cleanup.mockResolvedValue(undefined);

    // Mock engine
    mockEngine = new IngestionEngine();
    mockEngine.initialize.mockResolvedValue(undefined);
    mockEngine.shutdown.mockResolvedValue(undefined);

    // Mock job
    mockJob = {
      progress: jest.fn().mockResolvedValue(undefined)
    };

    processor = new IngestionJobProcessor();
  });

  describe('Initialization', () => {
    test('should initialize successfully', async () => {
      const result = await processor.initialize();

      expect(result).toBe(true);
      expect(processor.isInitialized).toBe(true);
      expect(mockRegistry.initialize).toHaveBeenCalled();
      expect(mockEngine.initialize).toHaveBeenCalled();
    });

    test('should handle initialization errors', async () => {
      mockRegistry.initialize.mockRejectedValue(new Error('Registry init failed'));

      await expect(processor.initialize()).rejects.toThrow('Failed to initialize IngestionJobProcessor');
    });
  });

  describe('Single Job Processing', () => {
    beforeEach(async () => {
      await processor.initialize();
    });

    test('should process job successfully', async () => {
      const jobData = {
        sourceConfig: {
          id: 'test-source',
          type: 'static'
        }
      };

      const mockDocuments = [
        { id: 'doc1', url: 'file1.md' },
        { id: 'doc2', url: 'file2.md' }
      ];

      const mockExtracted = [
        { id: 'doc1', content: 'content1' },
        { id: 'doc2', content: 'content2' }
      ];

      const mockTransformed = [
        { id: 'doc1', title: 'Title 1', content: 'content1' },
        { id: 'doc2', title: 'Title 2', content: 'content2' }
      ];

      mockHandler.discover.mockResolvedValue(mockDocuments);
      mockHandler.extract.mockResolvedValueOnce(mockExtracted[0])
                          .mockResolvedValueOnce(mockExtracted[1]);
      mockHandler.transform.mockResolvedValueOnce(mockTransformed[0])
                           .mockResolvedValueOnce(mockTransformed[1]);

      const result = await processor.processJob(jobData, mockJob);

      expect(mockRegistry.registerSource).toHaveBeenCalledWith(jobData.sourceConfig);
      expect(mockHandler.discover).toHaveBeenCalled();
      expect(mockHandler.extract).toHaveBeenCalledTimes(2);
      expect(mockHandler.transform).toHaveBeenCalledTimes(2);
      expect(mockJob.progress).toHaveBeenCalledWith(100);

      expect(result).toMatchObject({
        sourceId: 'test-source-id',
        documentsProcessed: 2,
        documentsTotal: 2,
        errors: 0
      });
    });

    test('should handle existing source', async () => {
      const jobData = {
        sourceConfig: {
          id: 'existing-source',
          type: 'static'
        }
      };

      mockRegistry.hasSource.mockReturnValue(true);
      mockHandler.discover.mockResolvedValue([]);

      const result = await processor.processJob(jobData, mockJob);

      expect(mockRegistry.registerSource).not.toHaveBeenCalled();
      expect(mockRegistry.getHandler).toHaveBeenCalledWith('existing-source');
      expect(result.sourceId).toBe('existing-source');
    });

    test('should handle document processing errors', async () => {
      const jobData = {
        sourceConfig: {
          id: 'test-source',
          type: 'static'
        }
      };

      const mockDocuments = [
        { id: 'doc1', url: 'file1.md' },
        { id: 'doc2', url: 'file2.md' }
      ];

      mockHandler.discover.mockResolvedValue(mockDocuments);
      mockHandler.extract.mockResolvedValueOnce({ id: 'doc1', content: 'content1' })
                          .mockRejectedValueOnce(new Error('Extract failed'));
      mockHandler.transform.mockResolvedValueOnce({ id: 'doc1', title: 'Title 1', content: 'content1' });

      const result = await processor.processJob(jobData, mockJob);

      expect(result.documentsProcessed).toBe(1);
      expect(result.documentsTotal).toBe(2);
      expect(result.errors).toBe(1);
      expect(result.errorDetails).toHaveLength(1);
      expect(result.errorDetails[0]).toMatchObject({
        document: 'doc2',
        error: 'Extract failed'
      });
    });

    test('should stop on error when configured', async () => {
      const jobData = {
        sourceConfig: {
          id: 'test-source',
          type: 'static'
        },
        options: {
          stopOnError: true
        }
      };

      const mockDocuments = [
        { id: 'doc1', url: 'file1.md' },
        { id: 'doc2', url: 'file2.md' }
      ];

      mockHandler.discover.mockResolvedValue(mockDocuments);
      mockHandler.extract.mockRejectedValue(new Error('Extract failed'));

      await expect(processor.processJob(jobData, mockJob)).rejects.toThrow('Processing stopped due to error');
    });

    test('should fail without source configuration', async () => {
      const jobData = {};

      await expect(processor.processJob(jobData, mockJob)).rejects.toThrow('Missing source configuration');
    });

    test('should fail when not initialized', async () => {
      const uninitializedProcessor = new IngestionJobProcessor();
      const jobData = { sourceConfig: { id: 'test' } };

      await expect(uninitializedProcessor.processJob(jobData, mockJob))
        .rejects.toThrow('IngestionJobProcessor not initialized');
    });

    test('should cleanup on error', async () => {
      const jobData = {
        sourceConfig: {
          id: 'test-source',
          type: 'static'
        }
      };

      mockHandler.discover.mockRejectedValue(new Error('Discovery failed'));

      await expect(processor.processJob(jobData, mockJob)).rejects.toThrow('Ingestion job failed');
      expect(mockRegistry.unregisterSource).toHaveBeenCalledWith('test-source-id');
    });
  });

  describe('Batch Processing', () => {
    beforeEach(async () => {
      await processor.initialize();
    });

    test('should process batch successfully', async () => {
      const jobData = {
        batchId: 'test-batch',
        sources: [
          { id: 'source1', type: 'static' },
          { id: 'source2', type: 'static' }
        ]
      };

      mockHandler.discover.mockResolvedValue([{ id: 'doc1', url: 'file1.md' }]);
      mockHandler.extract.mockResolvedValue({ id: 'doc1', content: 'content1' });
      mockHandler.transform.mockResolvedValue({ id: 'doc1', title: 'Title 1', content: 'content1' });

      const result = await processor.processBatch(jobData, mockJob);

      expect(result.batchId).toBe('test-batch');
      expect(result.sourcesProcessed).toBe(2);
      expect(result.sourcesTotal).toBe(2);
      expect(result.sourcesFailed).toBe(0);
    });

    test('should handle batch with failed sources', async () => {
      const jobData = {
        sources: [
          { id: 'source1', type: 'static' },
          { id: 'source2', type: 'static' }
        ]
      };

      mockRegistry.registerSource.mockResolvedValueOnce('source1')
                                  .mockRejectedValueOnce(new Error('Registration failed'));
      mockHandler.discover.mockResolvedValue([]);

      const result = await processor.processBatch(jobData, mockJob);

      expect(result.sourcesProcessed).toBe(1);
      expect(result.sourcesFailed).toBe(1);
    });

    test('should stop batch on error when configured', async () => {
      const jobData = {
        sources: [
          { id: 'source1', type: 'static' },
          { id: 'source2', type: 'static' }
        ],
        options: {
          stopOnError: true
        }
      };

      mockRegistry.registerSource.mockRejectedValue(new Error('Registration failed'));

      await expect(processor.processBatch(jobData, mockJob)).rejects.toThrow('Batch ingestion job failed');
    });

    test('should fail with empty sources', async () => {
      const jobData = { sources: [] };

      await expect(processor.processBatch(jobData, mockJob)).rejects.toThrow('Missing or empty sources array');
    });

    test('should fail without sources array', async () => {
      const jobData = {};

      await expect(processor.processBatch(jobData, mockJob)).rejects.toThrow('Missing or empty sources array');
    });

    test('should generate batch ID if not provided', async () => {
      const jobData = {
        sources: [{ id: 'source1', type: 'static' }]
      };

      mockHandler.discover.mockResolvedValue([]);

      const result = await processor.processBatch(jobData, mockJob);

      expect(result.batchId).toMatch(/^batch-\d+$/);
    });
  });

  describe('Shutdown', () => {
    test('should shutdown successfully', async () => {
      await processor.initialize();

      await processor.shutdown();

      expect(mockRegistry.cleanup).toHaveBeenCalled();
      expect(mockEngine.shutdown).toHaveBeenCalled();
      expect(processor.isInitialized).toBe(false);
    });

    test('should handle shutdown when not initialized', async () => {
      await expect(processor.shutdown()).resolves.toBeUndefined();
    });

    test('should handle shutdown errors', async () => {
      await processor.initialize();
      mockRegistry.cleanup.mockRejectedValue(new Error('Cleanup failed'));

      await expect(processor.shutdown()).rejects.toThrow('Failed to shutdown IngestionJobProcessor');
    });
  });

  describe('Progress Reporting', () => {
    beforeEach(async () => {
      await processor.initialize();
    });

    test('should report progress during job processing', async () => {
      const jobData = {
        sourceConfig: {
          id: 'test-source',
          type: 'static'
        }
      };

      const mockDocuments = [
        { id: 'doc1', url: 'file1.md' },
        { id: 'doc2', url: 'file2.md' }
      ];

      mockHandler.discover.mockResolvedValue(mockDocuments);
      mockHandler.extract.mockResolvedValue({ id: 'doc1', content: 'content1' });
      mockHandler.transform.mockResolvedValue({ id: 'doc1', title: 'Title 1', content: 'content1' });

      await processor.processJob(jobData, mockJob);

      expect(mockJob.progress).toHaveBeenCalledWith(0);
      expect(mockJob.progress).toHaveBeenCalledWith(10);
      expect(mockJob.progress).toHaveBeenCalledWith(25);
      expect(mockJob.progress).toHaveBeenCalledWith(95);
      expect(mockJob.progress).toHaveBeenCalledWith(100);
    });

    test('should report progress during batch processing', async () => {
      const jobData = {
        sources: [{ id: 'source1', type: 'static' }]
      };

      mockHandler.discover.mockResolvedValue([]);

      await processor.processBatch(jobData, mockJob);

      expect(mockJob.progress).toHaveBeenCalledWith(0);
      expect(mockJob.progress).toHaveBeenCalledWith(100);
    });
  });
});
