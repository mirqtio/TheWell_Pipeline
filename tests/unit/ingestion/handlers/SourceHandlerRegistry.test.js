const SourceHandlerRegistry = require('../../../../src/ingestion/handlers/SourceHandlerRegistry');
const SourceHandlerFactory = require('../../../../src/ingestion/handlers/SourceHandlerFactory');
const { SOURCE_TYPES, VISIBILITY_LEVELS } = require('../../../../src/ingestion/types');

// Mock the factory and handlers
jest.mock('../../../../src/ingestion/handlers/SourceHandlerFactory');

describe('SourceHandlerRegistry', () => {
  let registry;
  let mockFactory;
  let mockLogger;
  let mockHandler1;
  let mockHandler2;

  beforeEach(() => {
    jest.clearAllMocks();

    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    };

    mockHandler1 = {
      config: {
        id: 'handler-1',
        type: SOURCE_TYPES.STATIC,
        enabled: true
      },
      initialize: jest.fn().mockResolvedValue(undefined),
      cleanup: jest.fn().mockResolvedValue(undefined),
      discover: jest.fn().mockResolvedValue([]),
      extract: jest.fn().mockResolvedValue({}),
      transform: jest.fn().mockResolvedValue({})
    };

    mockHandler2 = {
      config: {
        id: 'handler-2',
        type: SOURCE_TYPES.SEMI_STATIC,
        enabled: true
      },
      initialize: jest.fn().mockResolvedValue(undefined),
      cleanup: jest.fn().mockResolvedValue(undefined),
      discover: jest.fn().mockResolvedValue([]),
      extract: jest.fn().mockResolvedValue({}),
      transform: jest.fn().mockResolvedValue({})
    };

    mockFactory = {
      createHandler: jest.fn(),
      validateHandlerConfig: jest.fn().mockResolvedValue(true),
      getRegisteredTypes: jest.fn().mockReturnValue([SOURCE_TYPES.STATIC, SOURCE_TYPES.SEMI_STATIC])
    };

    SourceHandlerFactory.mockImplementation(() => mockFactory);

    registry = new SourceHandlerRegistry(mockLogger);
  });

  describe('Initialization', () => {
    test('should initialize with empty registry', () => {
      expect(registry.getHandlerCount()).toBe(0);
      expect(registry.getAllHandlerIds()).toEqual([]);
    });

    test('should initialize factory correctly', () => {
      expect(SourceHandlerFactory).toHaveBeenCalledWith(mockLogger);
    });
  });

  describe('Handler Registration', () => {
    test('should register single handler', async () => {
      const config = {
        id: 'test-handler',
        type: SOURCE_TYPES.STATIC,
        enabled: true,
        config: { basePath: '/test' }
      };

      mockFactory.createHandler.mockReturnValue(mockHandler1);

      await registry.registerHandler(config);

      expect(mockFactory.validateHandlerConfig).toHaveBeenCalledWith(config);
      expect(mockFactory.createHandler).toHaveBeenCalledWith(config);
      expect(mockHandler1.initialize).toHaveBeenCalled();
      expect(registry.getHandlerCount()).toBe(1);
    });

    test('should register multiple handlers', async () => {
      const configs = [
        {
          id: 'handler-1',
          type: SOURCE_TYPES.STATIC,
          enabled: true,
          config: { basePath: '/test1' }
        },
        {
          id: 'handler-2',
          type: SOURCE_TYPES.SEMI_STATIC,
          enabled: true,
          config: { baseUrl: 'https://api.example.com' }
        }
      ];

      mockFactory.createHandler
        .mockReturnValueOnce(mockHandler1)
        .mockReturnValueOnce(mockHandler2);

      await registry.registerHandlers(configs);

      expect(registry.getHandlerCount()).toBe(2);
      expect(registry.getAllHandlerIds()).toEqual(['handler-1', 'handler-2']);
    });

    test('should reject duplicate handler IDs', async () => {
      const config = {
        id: 'duplicate-id',
        type: SOURCE_TYPES.STATIC,
        enabled: true,
        config: { basePath: '/test' }
      };

      mockFactory.createHandler.mockReturnValue(mockHandler1);

      await registry.registerHandler(config);

      await expect(registry.registerHandler(config))
        .rejects.toThrow('Handler with ID duplicate-id is already registered');
    });

    test('should handle registration validation errors', async () => {
      const config = {
        id: 'invalid-handler',
        type: SOURCE_TYPES.STATIC,
        config: {} // Invalid config
      };

      mockFactory.validateHandlerConfig.mockRejectedValue(new Error('Invalid config'));

      await expect(registry.registerHandler(config))
        .rejects.toThrow('Invalid config');
    });

    test('should handle handler creation errors', async () => {
      const config = {
        id: 'faulty-handler',
        type: SOURCE_TYPES.STATIC,
        enabled: true,
        config: { basePath: '/test' }
      };

      mockFactory.createHandler.mockImplementation(() => {
        throw new Error('Handler creation failed');
      });

      await expect(registry.registerHandler(config))
        .rejects.toThrow('Handler creation failed');
    });

    test('should handle handler initialization errors', async () => {
      const config = {
        id: 'init-fail-handler',
        type: SOURCE_TYPES.STATIC,
        enabled: true,
        config: { basePath: '/test' }
      };

      mockHandler1.initialize.mockRejectedValue(new Error('Initialization failed'));
      mockFactory.createHandler.mockReturnValue(mockHandler1);

      await expect(registry.registerHandler(config))
        .rejects.toThrow('Initialization failed');
    });
  });

  describe('Handler Retrieval', () => {
    beforeEach(async () => {
      mockFactory.createHandler
        .mockReturnValueOnce(mockHandler1)
        .mockReturnValueOnce(mockHandler2);

      await registry.registerHandlers([
        {
          id: 'handler-1',
          type: SOURCE_TYPES.STATIC,
          enabled: true,
          config: { basePath: '/test1' }
        },
        {
          id: 'handler-2',
          type: SOURCE_TYPES.SEMI_STATIC,
          enabled: true,
          config: { baseUrl: 'https://api.example.com' }
        }
      ]);
    });

    test('should get handler by ID', () => {
      const handler = registry.getHandler('handler-1');
      expect(handler).toBe(mockHandler1);
    });

    test('should return null for non-existent handler', () => {
      const handler = registry.getHandler('non-existent');
      expect(handler).toBeNull();
    });

    test('should get all handlers', () => {
      const handlers = registry.getAllHandlers();
      expect(handlers).toHaveLength(2);
      expect(handlers).toContain(mockHandler1);
      expect(handlers).toContain(mockHandler2);
    });

    test('should get handlers by type', () => {
      const staticHandlers = registry.getHandlersByType(SOURCE_TYPES.STATIC);
      expect(staticHandlers).toHaveLength(1);
      expect(staticHandlers[0]).toBe(mockHandler1);
    });

    test('should get enabled handlers only', () => {
      mockHandler2.config.enabled = false;

      const enabledHandlers = registry.getEnabledHandlers();
      expect(enabledHandlers).toHaveLength(1);
      expect(enabledHandlers[0]).toBe(mockHandler1);
    });

    test('should get handlers by visibility', () => {
      mockHandler1.config.visibility = VISIBILITY_LEVELS.INTERNAL;
      mockHandler2.config.visibility = VISIBILITY_LEVELS.EXTERNAL;

      const internalHandlers = registry.getHandlersByVisibility(VISIBILITY_LEVELS.INTERNAL);
      expect(internalHandlers).toHaveLength(1);
      expect(internalHandlers[0]).toBe(mockHandler1);
    });
  });

  describe('Handler Management', () => {
    beforeEach(async () => {
      mockFactory.createHandler.mockReturnValue(mockHandler1);
      await registry.registerHandler({
        id: 'test-handler',
        type: SOURCE_TYPES.STATIC,
        enabled: true,
        config: { basePath: '/test' }
      });
    });

    test('should enable handler', async () => {
      mockHandler1.config.enabled = false;

      await registry.enableHandler('test-handler');

      expect(mockHandler1.config.enabled).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Handler enabled',
        { handlerId: 'test-handler' }
      );
    });

    test('should disable handler', async () => {
      await registry.disableHandler('test-handler');

      expect(mockHandler1.config.enabled).toBe(false);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Handler disabled',
        { handlerId: 'test-handler' }
      );
    });

    test('should unregister handler', async () => {
      await registry.unregisterHandler('test-handler');

      expect(mockHandler1.cleanup).toHaveBeenCalled();
      expect(registry.getHandler('test-handler')).toBeNull();
      expect(registry.getHandlerCount()).toBe(0);
    });

    test('should handle enable/disable of non-existent handler', async () => {
      await expect(registry.enableHandler('non-existent'))
        .rejects.toThrow('Handler with ID non-existent not found');

      await expect(registry.disableHandler('non-existent'))
        .rejects.toThrow('Handler with ID non-existent not found');
    });

    test('should handle unregister of non-existent handler', async () => {
      await expect(registry.unregisterHandler('non-existent'))
        .rejects.toThrow('Handler with ID non-existent not found');
    });
  });

  describe('Batch Operations', () => {
    beforeEach(async () => {
      mockFactory.createHandler
        .mockReturnValueOnce(mockHandler1)
        .mockReturnValueOnce(mockHandler2);

      await registry.registerHandlers([
        {
          id: 'handler-1',
          type: SOURCE_TYPES.STATIC,
          enabled: true,
          config: { basePath: '/test1' }
        },
        {
          id: 'handler-2',
          type: SOURCE_TYPES.SEMI_STATIC,
          enabled: true,
          config: { baseUrl: 'https://api.example.com' }
        }
      ]);
    });

    test('should discover from all enabled handlers', async () => {
      const mockDocuments1 = [{ id: 'doc1' }, { id: 'doc2' }];
      const mockDocuments2 = [{ id: 'doc3' }];

      mockHandler1.discover.mockResolvedValue(mockDocuments1);
      mockHandler2.discover.mockResolvedValue(mockDocuments2);

      const allDocuments = await registry.discoverAll();

      expect(allDocuments).toHaveLength(3);
      expect(allDocuments).toEqual([...mockDocuments1, ...mockDocuments2]);
    });

    test('should skip disabled handlers in discovery', async () => {
      mockHandler2.config.enabled = false;
      mockHandler1.discover.mockResolvedValue([{ id: 'doc1' }]);

      const allDocuments = await registry.discoverAll();

      expect(allDocuments).toHaveLength(1);
      expect(mockHandler1.discover).toHaveBeenCalled();
      expect(mockHandler2.discover).not.toHaveBeenCalled();
    });

    test('should handle discovery errors gracefully', async () => {
      mockHandler1.discover.mockResolvedValue([{ id: 'doc1' }]);
      mockHandler2.discover.mockRejectedValue(new Error('Discovery failed'));

      const allDocuments = await registry.discoverAll();

      expect(allDocuments).toHaveLength(1);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Handler discovery failed',
        expect.objectContaining({ handlerId: 'handler-2' })
      );
    });

    test('should cleanup all handlers', async () => {
      await registry.cleanupAll();

      expect(mockHandler1.cleanup).toHaveBeenCalled();
      expect(mockHandler2.cleanup).toHaveBeenCalled();
    });

    test('should handle cleanup errors gracefully', async () => {
      mockHandler1.cleanup.mockRejectedValue(new Error('Cleanup failed'));

      await registry.cleanupAll();

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Handler cleanup failed',
        expect.objectContaining({ handlerId: 'handler-1' })
      );
      expect(mockHandler2.cleanup).toHaveBeenCalled();
    });
  });

  describe('Registry Statistics', () => {
    beforeEach(async () => {
      mockFactory.createHandler
        .mockReturnValueOnce(mockHandler1)
        .mockReturnValueOnce(mockHandler2);

      await registry.registerHandlers([
        {
          id: 'handler-1',
          type: SOURCE_TYPES.STATIC,
          enabled: true,
          config: { basePath: '/test1' }
        },
        {
          id: 'handler-2',
          type: SOURCE_TYPES.SEMI_STATIC,
          enabled: false,
          config: { baseUrl: 'https://api.example.com' }
        }
      ]);
    });

    test('should return correct handler count', () => {
      expect(registry.getHandlerCount()).toBe(2);
    });

    test('should return correct enabled handler count', () => {
      expect(registry.getEnabledHandlerCount()).toBe(1);
    });

    test('should return handler statistics', () => {
      const stats = registry.getStatistics();

      expect(stats).toMatchObject({
        totalHandlers: 2,
        enabledHandlers: 1,
        disabledHandlers: 1,
        handlersByType: {
          [SOURCE_TYPES.STATIC]: 1,
          [SOURCE_TYPES.SEMI_STATIC]: 1
        }
      });
    });

    test('should return all handler IDs', () => {
      const ids = registry.getAllHandlerIds();
      expect(ids).toEqual(['handler-1', 'handler-2']);
    });
  });

  describe('Configuration Management', () => {
    test('should update handler configuration', async () => {
      mockFactory.createHandler.mockReturnValue(mockHandler1);
      await registry.registerHandler({
        id: 'test-handler',
        type: SOURCE_TYPES.STATIC,
        enabled: true,
        config: { basePath: '/test' }
      });

      const newConfig = {
        id: 'test-handler',
        type: SOURCE_TYPES.STATIC,
        enabled: true,
        config: { basePath: '/new-test' }
      };

      const newHandler = { ...mockHandler1, config: newConfig };
      mockFactory.createHandler.mockReturnValue(newHandler);

      await registry.updateHandlerConfig('test-handler', newConfig);

      expect(mockHandler1.cleanup).toHaveBeenCalled();
      expect(registry.getHandler('test-handler').config.config.basePath).toBe('/new-test');
    });

    test('should validate configuration before update', async () => {
      mockFactory.createHandler.mockReturnValue(mockHandler1);
      await registry.registerHandler({
        id: 'test-handler',
        type: SOURCE_TYPES.STATIC,
        enabled: true,
        config: { basePath: '/test' }
      });

      const invalidConfig = {
        id: 'test-handler',
        type: SOURCE_TYPES.STATIC,
        config: {} // Invalid
      };

      mockFactory.validateHandlerConfig.mockRejectedValue(new Error('Invalid config'));

      await expect(registry.updateHandlerConfig('test-handler', invalidConfig))
        .rejects.toThrow('Invalid config');
    });
  });

  describe('Event Handling', () => {
    test('should emit events on handler registration', async () => {
      const eventListener = jest.fn();
      registry.on('handlerRegistered', eventListener);

      mockFactory.createHandler.mockReturnValue(mockHandler1);
      await registry.registerHandler({
        id: 'test-handler',
        type: SOURCE_TYPES.STATIC,
        enabled: true,
        config: { basePath: '/test' }
      });

      expect(eventListener).toHaveBeenCalledWith({
        handlerId: 'test-handler',
        handlerType: SOURCE_TYPES.STATIC
      });
    });

    test('should emit events on handler unregistration', async () => {
      const eventListener = jest.fn();
      registry.on('handlerUnregistered', eventListener);

      mockFactory.createHandler.mockReturnValue(mockHandler1);
      await registry.registerHandler({
        id: 'test-handler',
        type: SOURCE_TYPES.STATIC,
        enabled: true,
        config: { basePath: '/test' }
      });

      await registry.unregisterHandler('test-handler');

      expect(eventListener).toHaveBeenCalledWith({
        handlerId: 'test-handler',
        handlerType: SOURCE_TYPES.STATIC
      });
    });
  });
});
