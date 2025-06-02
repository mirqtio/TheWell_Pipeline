/**
 * RAGManager Unit Tests
 */

const RAGManager = require('../../../src/rag/RAGManager');

// Mock all components
jest.mock('../../../src/rag/components/InputProcessor');
jest.mock('../../../src/rag/components/DocumentRetriever');
jest.mock('../../../src/rag/components/ResponseGenerator');
jest.mock('../../../src/rag/components/OutputFormatter');

// Mock logger to prevent console output during tests
jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
}));

const InputProcessor = require('../../../src/rag/components/InputProcessor');
const DocumentRetriever = require('../../../src/rag/components/DocumentRetriever');
const ResponseGenerator = require('../../../src/rag/components/ResponseGenerator');
const OutputFormatter = require('../../../src/rag/components/OutputFormatter');

describe('RAGManager', () => {
  let ragManager;
  let mockDatabaseManager;
  let mockLLMProviderManager;
  let mockVisibilityDatabase;
  let mockCacheManager;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Create mock dependencies
    mockDatabaseManager = {
      query: jest.fn(),
      isInitialized: true
    };

    mockLLMProviderManager = {
      executeWithFailover: jest.fn(),
      isInitialized: true
    };

    mockVisibilityDatabase = {
      filterByVisibility: jest.fn(),
      isInitialized: true
    };

    mockCacheManager = {
      get: jest.fn(),
      set: jest.fn(),
      isInitialized: true
    };

    // Setup component mocks
    InputProcessor.mockImplementation(() => ({
      initialize: jest.fn().mockResolvedValue(),
      process: jest.fn().mockResolvedValue({
        query: 'processed query',
        filters: {},
        options: {},
        context: { userId: 'user123' }
      }),
      getStatus: jest.fn().mockResolvedValue({ initialized: false }),
      shutdown: jest.fn().mockResolvedValue()
    }));

    DocumentRetriever.mockImplementation(() => ({
      initialize: jest.fn().mockResolvedValue(),
      retrieve: jest.fn().mockResolvedValue([
        { id: 1, title: 'Doc 1', content: 'Content 1', score: 0.9 }
      ]),
      getStatus: jest.fn().mockResolvedValue({ initialized: false }),
      shutdown: jest.fn().mockResolvedValue()
    }));

    ResponseGenerator.mockImplementation(() => ({
      initialize: jest.fn().mockResolvedValue(),
      generate: jest.fn().mockResolvedValue({
        content: 'Generated response',
        confidence: 0.85,
        metadata: { model: 'gpt-3.5-turbo' }
      }),
      getStatus: jest.fn().mockResolvedValue({ initialized: false }),
      shutdown: jest.fn().mockResolvedValue()
    }));

    OutputFormatter.mockImplementation(() => ({
      initialize: jest.fn().mockResolvedValue(),
      format: jest.fn().mockResolvedValue({
        answer: 'Formatted response',
        confidence: 0.85,
        sources: [],
        metadata: {}
      }),
      getStatus: jest.fn().mockResolvedValue({ initialized: false }),
      shutdown: jest.fn().mockResolvedValue()
    }));

    // Create RAGManager instance
    ragManager = new RAGManager({
      databaseManager: mockDatabaseManager,
      llmProviderManager: mockLLMProviderManager,
      visibilityDatabase: mockVisibilityDatabase,
      cacheManager: mockCacheManager
    });
  });

  afterEach(async () => {
    if (ragManager) {
      await ragManager.shutdown();
    }
  });

  describe('constructor', () => {
    it('should initialize with required dependencies', () => {
      expect(ragManager.databaseManager).toBe(mockDatabaseManager);
      expect(ragManager.llmProviderManager).toBe(mockLLMProviderManager);
      expect(ragManager.visibilityDatabase).toBe(mockVisibilityDatabase);
      expect(ragManager.cacheManager).toBe(mockCacheManager);
      expect(ragManager.isInitialized).toBe(false);
    });

    it('should initialize components', () => {
      expect(ragManager.inputProcessor).toBeDefined();
      expect(ragManager.documentRetriever).toBeDefined();
      expect(ragManager.responseGenerator).toBeDefined();
      expect(ragManager.outputFormatter).toBeDefined();
    });
  });

  describe('initialize', () => {
    it('should initialize all components successfully', async () => {
      await ragManager.initialize();

      expect(ragManager.inputProcessor.initialize).toHaveBeenCalled();
      expect(ragManager.documentRetriever.initialize).toHaveBeenCalled();
      expect(ragManager.responseGenerator.initialize).toHaveBeenCalled();
      expect(ragManager.outputFormatter.initialize).toHaveBeenCalled();
      expect(ragManager.isInitialized).toBe(true);
    });

    it('should handle initialization errors', async () => {
      ragManager.inputProcessor.initialize.mockRejectedValue(new Error('Init failed'));

      await expect(ragManager.initialize()).rejects.toThrow('Init failed');
      expect(ragManager.isInitialized).toBe(false);
    });
  });

  describe('processQuery', () => {
    beforeEach(async () => {
      await ragManager.initialize();
    });

    it('should process query successfully', async () => {
      const queryData = {
        query: 'test query',
        options: { maxResults: 10 }
      };

      const userContext = {
        userId: 'user123',
        roles: ['user']
      };

      const processedInput = {
        query: 'processed query',
        filters: {},
        options: {},
        context: { userId: 'user123' }
      };

      const retrievedDocs = [
        { id: 1, title: 'Doc 1', content: 'Content 1', score: 0.9 }
      ];

      const generatedResponse = {
        content: 'Generated response',
        confidence: 0.85,
        metadata: { model: 'gpt-3.5-turbo' }
      };

      const formattedOutput = {
        answer: 'Formatted response',
        confidence: 0.85,
        sources: [],
        metadata: {}
      };

      ragManager.inputProcessor.process.mockResolvedValue(processedInput);
      ragManager.documentRetriever.retrieve.mockResolvedValue(retrievedDocs);
      ragManager.responseGenerator.generate.mockResolvedValue(generatedResponse);
      ragManager.outputFormatter.format.mockResolvedValue(formattedOutput);

      const result = await ragManager.processQuery(queryData, userContext);

      expect(ragManager.inputProcessor.process).toHaveBeenCalledWith(queryData, userContext);
      expect(ragManager.documentRetriever.retrieve).toHaveBeenCalledWith(
        processedInput.query,
        processedInput.filters,
        userContext
      );
      expect(ragManager.responseGenerator.generate).toHaveBeenCalledWith(
        processedInput.query,
        retrievedDocs,
        processedInput.context
      );
      expect(ragManager.outputFormatter.format).toHaveBeenCalledWith(generatedResponse, retrievedDocs, expect.any(Object));
      expect(result).toEqual(formattedOutput);
    });

    it('should handle input processing errors', async () => {
      const queryData = { query: 'test query' };
      const userContext = { userId: 'user123' };

      ragManager.inputProcessor.process.mockRejectedValue(new Error('Invalid input'));

      await expect(ragManager.processQuery(queryData, userContext)).rejects.toThrow('Invalid input');
    });

    it('should handle document retrieval errors', async () => {
      const queryData = { query: 'test query' };
      const userContext = { userId: 'user123' };

      ragManager.inputProcessor.process.mockResolvedValue({ query: 'processed query' });
      ragManager.documentRetriever.retrieve.mockRejectedValue(new Error('Retrieval failed'));

      await expect(ragManager.processQuery(queryData, userContext)).rejects.toThrow('Retrieval failed');
    });

    it('should handle response generation errors', async () => {
      const queryData = { query: 'test query' };
      const userContext = { userId: 'user123' };

      ragManager.inputProcessor.process.mockResolvedValue({ query: 'processed query' });
      ragManager.documentRetriever.retrieve.mockResolvedValue([]);
      ragManager.responseGenerator.generate.mockRejectedValue(new Error('Generation failed'));

      await expect(ragManager.processQuery(queryData, userContext)).rejects.toThrow('Generation failed');
    });

    it('should require initialization before processing', async () => {
      const ragManager2 = new RAGManager({
        databaseManager: mockDatabaseManager,
        llmProviderManager: mockLLMProviderManager,
        visibilityDatabase: mockVisibilityDatabase,
        cacheManager: mockCacheManager
      });

      await expect(ragManager2.processQuery({}, {})).rejects.toThrow('RAG Manager not initialized');
    });
  });

  describe('getHealthStatus', () => {
    it('should return health status when not initialized', async () => {
      const status = await ragManager.getHealthStatus();

      expect(status).toEqual({
        initialized: false,
        components: {
          inputProcessor: { initialized: false },
          documentRetriever: { initialized: false },
          responseGenerator: { initialized: false },
          outputFormatter: { initialized: false }
        },
        timestamp: expect.any(String)
      });
    });

    it('should return health status when initialized', async () => {
      // Update mocks to return initialized: true after initialization
      ragManager.inputProcessor.getStatus.mockResolvedValue({ initialized: true });
      ragManager.documentRetriever.getStatus.mockResolvedValue({ initialized: true });
      ragManager.responseGenerator.getStatus.mockResolvedValue({ initialized: true });
      ragManager.outputFormatter.getStatus.mockResolvedValue({ initialized: true });

      await ragManager.initialize();
      const status = await ragManager.getHealthStatus();

      expect(status.initialized).toBe(true);
      expect(status.components.inputProcessor.initialized).toBe(true);
      expect(status.components.documentRetriever.initialized).toBe(true);
      expect(status.components.responseGenerator.initialized).toBe(true);
      expect(status.components.outputFormatter.initialized).toBe(true);
      expect(status.timestamp).toBeDefined();
    });

    it('should handle component status errors', async () => {
      await ragManager.initialize();
      
      // Mock a component to throw an error
      ragManager.inputProcessor.getStatus.mockRejectedValue(new Error('Status error'));

      await expect(ragManager.getHealthStatus()).rejects.toThrow('Status error');
    });
  });

  describe('shutdown', () => {
    it('should shutdown all components', async () => {
      await ragManager.initialize();
      await ragManager.shutdown();

      expect(ragManager.inputProcessor.shutdown).toHaveBeenCalled();
      expect(ragManager.documentRetriever.shutdown).toHaveBeenCalled();
      expect(ragManager.responseGenerator.shutdown).toHaveBeenCalled();
      expect(ragManager.outputFormatter.shutdown).toHaveBeenCalled();
      expect(ragManager.isInitialized).toBe(false);
    });

    it('should handle shutdown when not initialized', async () => {
      // Should not throw error when shutting down uninitialized manager
      await expect(ragManager.shutdown()).resolves.toBeUndefined();
      expect(ragManager.isInitialized).toBe(false);
    });
  });
});
