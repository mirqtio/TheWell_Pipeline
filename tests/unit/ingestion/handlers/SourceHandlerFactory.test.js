// Mock filesystem before any imports
jest.mock('fs', () => ({
  promises: {
    access: jest.fn(),
    readdir: jest.fn(),
    stat: jest.fn(),
    readFile: jest.fn()
  }
}));

// Mock Puppeteer to prevent import issues
jest.mock('puppeteer', () => ({
  launch: jest.fn().mockResolvedValue({
    newPage: jest.fn().mockResolvedValue({
      goto: jest.fn().mockResolvedValue(undefined),
      evaluate: jest.fn().mockResolvedValue({}),
      waitForSelector: jest.fn().mockResolvedValue({}),
      click: jest.fn().mockResolvedValue(undefined),
      url: jest.fn().mockReturnValue('https://example.com'),
      close: jest.fn().mockResolvedValue(undefined)
    }),
    close: jest.fn().mockResolvedValue(undefined)
  })
}));

const SourceHandlerFactory = require('../../../../src/ingestion/handlers/SourceHandlerFactory');
const { SOURCE_TYPES } = require('../../../../src/ingestion/types');
const StaticSourceHandler = require('../../../../src/ingestion/handlers/StaticSourceHandler');
const SemiStaticSourceHandler = require('../../../../src/ingestion/handlers/SemiStaticSourceHandler');
const DynamicConsistentSourceHandler = require('../../../../src/ingestion/handlers/DynamicConsistentSourceHandler');
const DynamicUnstructuredSourceHandler = require('../../../../src/ingestion/handlers/DynamicUnstructuredSourceHandler');

const fs = require('fs').promises;

describe('SourceHandlerFactory', () => {
  let factory;
  let mockLogger;

  beforeEach(() => {
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    };

    // Mock filesystem access to always succeed for unit tests
    fs.access.mockResolvedValue();

    factory = new SourceHandlerFactory(mockLogger);
  });

  describe('Handler Registration', () => {
    test('should register all default handlers', () => {
      expect(factory.getRegisteredTypes()).toContain(SOURCE_TYPES.STATIC);
      expect(factory.getRegisteredTypes()).toContain(SOURCE_TYPES.SEMI_STATIC);
      expect(factory.getRegisteredTypes()).toContain(SOURCE_TYPES.DYNAMIC_CONSISTENT);
      expect(factory.getRegisteredTypes()).toContain(SOURCE_TYPES.DYNAMIC_UNSTRUCTURED);
    });

    test('should register custom handler', () => {
      class CustomHandler {
        constructor(config) {
          this.config = config;
        }
      }

      factory.registerHandler('custom', CustomHandler);

      expect(factory.getRegisteredTypes()).toContain('custom');
    });

    test('should throw error when registering handler with existing type', () => {
      class DuplicateHandler {}

      expect(() => {
        factory.registerHandler(SOURCE_TYPES.STATIC, DuplicateHandler);
      }).toThrow('Handler for type static is already registered');
    });

    test('should allow overriding existing handler when force is true', () => {
      class NewStaticHandler {}

      factory.registerHandler(SOURCE_TYPES.STATIC, NewStaticHandler, true);

      expect(factory.getRegisteredTypes()).toContain(SOURCE_TYPES.STATIC);
    });
  });

  describe('Handler Creation', () => {
    test('should create StaticSourceHandler', () => {
      const config = {
        id: 'test-static',
        type: SOURCE_TYPES.STATIC,
        config: {
          basePath: '/test/path',
          fileTypes: ['txt', 'md']
        }
      };

      const handler = factory.createHandler(config);

      expect(handler).toBeInstanceOf(StaticSourceHandler);
      expect(handler.config).toEqual(config);
    });

    test('should create SemiStaticSourceHandler', () => {
      const config = {
        id: 'test-semi-static',
        type: SOURCE_TYPES.SEMI_STATIC,
        config: {
          baseUrl: 'https://api.example.com',
          endpoints: ['/data']
        }
      };

      const handler = factory.createHandler(config);

      expect(handler).toBeInstanceOf(SemiStaticSourceHandler);
      expect(handler.config).toEqual(config);
    });

    test('should create DynamicConsistentSourceHandler', () => {
      const config = {
        id: 'test-dynamic-consistent',
        type: SOURCE_TYPES.DYNAMIC_CONSISTENT,
        config: {
          sources: [
            {
              type: 'rss',
              url: 'https://example.com/feed.xml'
            }
          ]
        }
      };

      const handler = factory.createHandler(config);

      expect(handler).toBeInstanceOf(DynamicConsistentSourceHandler);
      expect(handler.config).toEqual(config);
    });

    test('should create DynamicUnstructuredSourceHandler', () => {
      const config = {
        id: 'test-dynamic-unstructured',
        type: SOURCE_TYPES.DYNAMIC_UNSTRUCTURED,
        config: {
          targets: [
            {
              name: 'Test Site',
              baseUrl: 'https://example.com',
              selectors: {
                articleLinks: 'a.article'
              }
            }
          ]
        }
      };

      const handler = factory.createHandler(config);

      expect(handler).toBeInstanceOf(DynamicUnstructuredSourceHandler);
      expect(handler.config).toEqual(config);
    });

    test('should throw error for unsupported handler type', () => {
      const config = {
        id: 'test-unsupported',
        type: 'unsupported-type',
        config: {}
      };

      expect(() => {
        factory.createHandler(config);
      }).toThrow('No handler registered for type: unsupported-type');
    });

    test('should throw error for invalid configuration', () => {
      const config = null;

      expect(() => {
        factory.createHandler(config);
      }).toThrow('Configuration is required');
    });

    test('should throw error for configuration without type', () => {
      const config = {
        id: 'test-no-type',
        config: {}
      };

      expect(() => {
        factory.createHandler(config);
      }).toThrow('Configuration must specify a type');
    });
  });

  describe('Handler Validation', () => {
    test('should validate handler configuration before creation', async () => {
      const config = {
        id: 'test-static',
        type: SOURCE_TYPES.STATIC,
        config: {
          basePath: '/test/path',
          fileTypes: ['txt']
        }
      };

      const isValid = await factory.validateHandlerConfig(config);

      expect(isValid).toBe(true);
    });

    test('should reject invalid handler configuration', async () => {
      const config = {
        id: 'test-static',
        type: SOURCE_TYPES.STATIC,
        config: {
          // Missing required basePath
          fileTypes: ['txt']
        }
      };

      await expect(factory.validateHandlerConfig(config))
        .rejects.toThrow();
    });

    test('should handle validation for unsupported type', async () => {
      const config = {
        id: 'test-unsupported',
        type: 'unsupported-type',
        config: {}
      };

      await expect(factory.validateHandlerConfig(config))
        .rejects.toThrow('No handler registered for source type: unsupported-type');
    });
  });

  describe('Handler Introspection', () => {
    test('should return list of registered handler types', () => {
      const types = factory.getRegisteredTypes();

      expect(types).toBeInstanceOf(Array);
      expect(types.length).toBeGreaterThan(0);
      expect(types).toContain(SOURCE_TYPES.STATIC);
    });

    test('should check if handler type is supported', () => {
      expect(factory.isTypeSupported(SOURCE_TYPES.STATIC)).toBe(true);
      expect(factory.isTypeSupported('unsupported-type')).toBe(false);
    });

    test('should return handler class for registered type', () => {
      const HandlerClass = factory.getHandlerClass(SOURCE_TYPES.STATIC);

      expect(HandlerClass).toBe(StaticSourceHandler);
    });

    test('should return null for unregistered type', () => {
      const HandlerClass = factory.getHandlerClass('unsupported-type');

      expect(HandlerClass).toBeNull();
    });
  });

  describe('Batch Operations', () => {
    test('should create multiple handlers from configurations', () => {
      const configs = [
        {
          id: 'static-1',
          type: SOURCE_TYPES.STATIC,
          config: { basePath: '/path1', fileTypes: ['txt'] }
        },
        {
          id: 'static-2',
          type: SOURCE_TYPES.STATIC,
          config: { basePath: '/path2', fileTypes: ['md'] }
        }
      ];

      const handlers = factory.createHandlers(configs);

      expect(handlers).toHaveLength(2);
      expect(handlers[0]).toBeInstanceOf(StaticSourceHandler);
      expect(handlers[1]).toBeInstanceOf(StaticSourceHandler);
      expect(handlers[0].config.id).toBe('static-1');
      expect(handlers[1].config.id).toBe('static-2');
    });

    test('should handle errors in batch creation gracefully', () => {
      const configs = [
        {
          id: 'valid',
          type: SOURCE_TYPES.STATIC,
          config: { basePath: '/path', fileTypes: ['txt'] }
        },
        {
          id: 'invalid',
          type: 'unsupported-type',
          config: {}
        }
      ];

      expect(() => {
        factory.createHandlers(configs);
      }).toThrow('No handler registered for type: unsupported-type');
    });

    test('should validate multiple configurations', async () => {
      const configs = [
        {
          id: 'static-1',
          type: SOURCE_TYPES.STATIC,
          config: { basePath: '/path1', fileTypes: ['txt'] }
        },
        {
          id: 'static-2',
          type: SOURCE_TYPES.STATIC,
          config: { basePath: '/path2', fileTypes: ['md'] }
        }
      ];

      const results = await factory.validateHandlerConfigs(configs);

      expect(results).toHaveLength(2);
      expect(results[0].valid).toBe(true);
      expect(results[1].valid).toBe(true);
    });
  });

  describe('Error Handling', () => {
    test('should handle handler constructor errors', () => {
      class FaultyHandler {
        constructor() {
          throw new Error('Constructor error');
        }
      }

      factory.registerHandler('faulty', FaultyHandler, true);

      const config = {
        id: 'test-faulty',
        type: 'faulty',
        config: {}
      };

      expect(() => {
        factory.createHandler(config);
      }).toThrow('Constructor error');
    });

    test('should provide detailed error information', () => {
      const config = {
        id: 'test-invalid',
        type: 'invalid-type',
        config: {}
      };

      try {
        factory.createHandler(config);
      } catch (error) {
        expect(error.message).toContain('invalid-type');
        expect(error.message).toContain('No handler registered');
      }
    });
  });

  describe('Configuration Helpers', () => {
    test('should provide default configuration for handler type', () => {
      const defaultConfig = factory.getDefaultConfig(SOURCE_TYPES.STATIC);

      expect(defaultConfig).toMatchObject({
        type: SOURCE_TYPES.STATIC,
        enabled: true,
        config: expect.any(Object)
      });
    });

    test('should return null for unsupported type default config', () => {
      const defaultConfig = factory.getDefaultConfig('unsupported-type');

      expect(defaultConfig).toBeNull();
    });

    test('should merge user config with defaults', () => {
      const userConfig = {
        id: 'test-static',
        type: SOURCE_TYPES.STATIC,
        config: {
          basePath: '/custom/path'
        }
      };

      const mergedConfig = factory.mergeWithDefaults(userConfig);

      expect(mergedConfig.type).toBe(SOURCE_TYPES.STATIC);
      expect(mergedConfig.enabled).toBe(true);
      expect(mergedConfig.config.basePath).toBe('/custom/path');
    });
  });

  describe('Handler Lifecycle', () => {
    test('should initialize handler after creation', async () => {
      const config = {
        id: 'test-static',
        type: SOURCE_TYPES.STATIC,
        config: {
          basePath: '/test/path',
          fileTypes: ['txt']
        }
      };

      const handler = factory.createHandler(config);
      handler.initialize = jest.fn().mockResolvedValue(undefined);

      await factory.initializeHandler(handler);

      expect(handler.initialize).toHaveBeenCalled();
    });

    test('should cleanup handler resources', async () => {
      const config = {
        id: 'test-static',
        type: SOURCE_TYPES.STATIC,
        config: {
          basePath: '/test/path',
          fileTypes: ['txt']
        }
      };

      const handler = factory.createHandler(config);
      handler.cleanup = jest.fn().mockResolvedValue(undefined);

      await factory.cleanupHandler(handler);

      expect(handler.cleanup).toHaveBeenCalled();
    });
  });
});
