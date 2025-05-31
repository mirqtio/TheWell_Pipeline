const path = require('path');
const fs = require('fs').promises;
const StaticSourceHandler = require('../../../src/ingestion/handlers/StaticSourceHandler');
const SemiStaticSourceHandler = require('../../../src/ingestion/handlers/SemiStaticSourceHandler');
const SourceHandlerFactory = require('../../../src/ingestion/handlers/SourceHandlerFactory');
const SourceHandlerRegistry = require('../../../src/ingestion/handlers/SourceHandlerRegistry');
const { SOURCE_TYPES } = require('../../../src/ingestion/types');

describe('Source Handlers Integration Tests', () => {
  let testDataDir;
  let factory;
  let registry;

  beforeAll(async () => {
    // Create test data directory
    testDataDir = path.join(__dirname, 'test-data');
    await fs.mkdir(testDataDir, { recursive: true });

    // Create test files
    await fs.writeFile(
      path.join(testDataDir, 'test.txt'),
      'This is a test document with some content.'
    );
    await fs.writeFile(
      path.join(testDataDir, 'test.md'),
      '# Test Document\n\nThis is a markdown document with **bold** text.'
    );
    await fs.writeFile(
      path.join(testDataDir, 'test.json'),
      JSON.stringify({ title: 'JSON Document', content: 'JSON content' })
    );

    factory = new SourceHandlerFactory();
    registry = new SourceHandlerRegistry(factory);
  });

  afterAll(async () => {
    // Cleanup test data
    try {
      await fs.rmdir(testDataDir, { recursive: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('StaticSourceHandler Integration', () => {
    let handler;

    beforeEach(async () => {
      const config = {
        id: 'static-integration-test',
        type: SOURCE_TYPES.STATIC,
        config: {
          basePath: testDataDir,
          fileTypes: ['txt', 'md', 'json'],
          recursive: false
        }
      };

      handler = new StaticSourceHandler(config);
      await handler.initialize();
    });

    afterEach(async () => {
      if (handler) {
        await handler.cleanup();
      }
    });

    test('should discover files in directory', async () => {
      const documents = await handler.discover();

      expect(documents).toHaveLength(3);
      expect(documents.map(d => d.title)).toContain('test.txt');
      expect(documents.map(d => d.title)).toContain('test.md');
      expect(documents.map(d => d.title)).toContain('test.json');
    });

    test('should extract and transform content', async () => {
      const documents = await handler.discover();
      const textDoc = documents.find(d => d.title === 'test.txt');

      const extractedContent = await handler.extract(textDoc);
      expect(extractedContent.content).toContain('This is a test document');

      const transformedDoc = await handler.transform(extractedContent);
      expect(transformedDoc.content).toContain('This is a test document');
      expect(transformedDoc.metadata.wordCount).toBeGreaterThan(0);
      expect(transformedDoc.metadata.characterCount).toBeGreaterThan(0);
    });

    test('should handle markdown files correctly', async () => {
      const documents = await handler.discover();
      const mdDoc = documents.find(d => d.title === 'test.md');

      const extractedContent = await handler.extract(mdDoc);
      const transformedDoc = await handler.transform(extractedContent);

      expect(transformedDoc.title).toBe('Test Document');
      expect(transformedDoc.content).toContain('This is a markdown document');
    });
  });

  describe('SourceHandlerFactory Integration', () => {
    test('should create and validate handlers', async () => {
      const config = {
        id: 'factory-test',
        type: SOURCE_TYPES.STATIC,
        config: {
          basePath: testDataDir,
          fileTypes: ['txt']
        }
      };

      // Validate configuration
      const isValid = await factory.validateConfig(config);
      expect(isValid).toBe(true);

      // Create handler
      const handler = factory.createHandler(config);
      expect(handler).toBeInstanceOf(StaticSourceHandler);

      // Initialize and test
      await handler.initialize();
      const documents = await handler.discover();
      expect(documents).toHaveLength(1);

      await handler.cleanup();
    });

    test('should handle multiple handler types', () => {
      const staticConfig = {
        id: 'static-test',
        type: SOURCE_TYPES.STATIC,
        config: { basePath: testDataDir }
      };

      const semiStaticConfig = {
        id: 'semi-static-test',
        type: SOURCE_TYPES.SEMI_STATIC,
        config: {
          endpoints: [{ url: 'https://api.example.com', name: 'test' }]
        }
      };

      const staticHandler = factory.createHandler(staticConfig);
      const semiStaticHandler = factory.createHandler(semiStaticConfig);

      expect(staticHandler).toBeInstanceOf(StaticSourceHandler);
      expect(semiStaticHandler).toBeInstanceOf(SemiStaticSourceHandler);
    });
  });

  describe('SourceHandlerRegistry Integration', () => {
    test('should register and manage handlers', async () => {
      const config = {
        id: 'registry-test',
        type: SOURCE_TYPES.STATIC,
        config: {
          basePath: testDataDir,
          fileTypes: ['txt']
        }
      };

      // Register handler
      const handler = await registry.registerHandler(config);
      expect(handler).toBeInstanceOf(StaticSourceHandler);

      // Check registration
      expect(registry.getHandler('registry-test')).toBe(handler);
      expect(registry.isHandlerEnabled('registry-test')).toBe(true);

      // Test discovery aggregation
      const results = await registry.discoverAll();
      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true);
      expect(results[0].documents).toHaveLength(1);

      // Cleanup
      await registry.unregisterHandler('registry-test');
      expect(registry.getHandler('registry-test')).toBeUndefined();
    });

    test('should handle multiple handlers', async () => {
      const configs = [
        {
          id: 'multi-test-1',
          type: SOURCE_TYPES.STATIC,
          config: {
            basePath: testDataDir,
            fileTypes: ['txt']
          }
        },
        {
          id: 'multi-test-2',
          type: SOURCE_TYPES.STATIC,
          config: {
            basePath: testDataDir,
            fileTypes: ['md']
          }
        }
      ];

      // Register multiple handlers
      const results = await registry.registerHandlers(configs);
      expect(results).toHaveLength(2);
      expect(results.every(r => r.success)).toBe(true);

      // Test discovery from all handlers
      const discoveryResults = await registry.discoverAll();
      expect(discoveryResults).toHaveLength(2);
      expect(discoveryResults.every(r => r.success)).toBe(true);

      // Cleanup
      await registry.cleanup();
      expect(registry.getHandlerCount()).toBe(0);
    });

    test('should handle handler enable/disable', async () => {
      const config = {
        id: 'enable-test',
        type: SOURCE_TYPES.STATIC,
        config: {
          basePath: testDataDir,
          fileTypes: ['txt']
        }
      };

      await registry.registerHandler(config);

      // Disable handler
      registry.disableHandler('enable-test');
      expect(registry.isHandlerEnabled('enable-test')).toBe(false);

      // Discovery should skip disabled handlers
      const results = await registry.discoverAll();
      expect(results).toHaveLength(0);

      // Re-enable handler
      registry.enableHandler('enable-test');
      expect(registry.isHandlerEnabled('enable-test')).toBe(true);

      const enabledResults = await registry.discoverAll();
      expect(enabledResults).toHaveLength(1);

      await registry.cleanup();
    });
  });

  describe('Error Handling Integration', () => {
    test('should handle invalid configurations gracefully', async () => {
      const invalidConfig = {
        id: 'invalid-test',
        type: SOURCE_TYPES.STATIC,
        config: {
          basePath: '/non-existent-path'
        }
      };

      const handler = factory.createHandler(invalidConfig);
      
      // Should fail during initialization
      await expect(handler.initialize()).rejects.toThrow();
    });

    test('should handle missing files gracefully', async () => {
      const config = {
        id: 'missing-file-test',
        type: SOURCE_TYPES.STATIC,
        config: {
          basePath: testDataDir,
          fileTypes: ['txt']
        }
      };

      const handler = factory.createHandler(config);
      await handler.initialize();

      // Try to extract non-existent file
      const fakeDoc = {
        id: 'fake',
        title: 'non-existent.txt',
        url: path.join(testDataDir, 'non-existent.txt'),
        metadata: {}
      };

      await expect(handler.extract(fakeDoc)).rejects.toThrow();
      await handler.cleanup();
    });

    test('should handle registry errors gracefully', async () => {
      const invalidConfig = {
        id: 'registry-error-test',
        type: 'invalid-type',
        config: {}
      };

      // Should fail to register invalid handler
      await expect(registry.registerHandler(invalidConfig)).rejects.toThrow();
    });
  });

  describe('Performance Integration', () => {
    test('should handle multiple files efficiently', async () => {
      // Create multiple test files
      const fileCount = 10;
      for (let i = 0; i < fileCount; i++) {
        await fs.writeFile(
          path.join(testDataDir, `perf-test-${i}.txt`),
          `Performance test file ${i} with content.`
        );
      }

      const config = {
        id: 'perf-test',
        type: SOURCE_TYPES.STATIC,
        config: {
          basePath: testDataDir,
          fileTypes: ['txt']
        }
      };

      const handler = factory.createHandler(config);
      await handler.initialize();

      const startTime = Date.now();
      const documents = await handler.discover();
      const discoveryTime = Date.now() - startTime;

      expect(documents.length).toBeGreaterThanOrEqual(fileCount);
      expect(discoveryTime).toBeLessThan(1000); // Should complete within 1 second

      await handler.cleanup();

      // Cleanup performance test files
      for (let i = 0; i < fileCount; i++) {
        try {
          await fs.unlink(path.join(testDataDir, `perf-test-${i}.txt`));
        } catch (error) {
          // Ignore cleanup errors
        }
      }
    });
  });
});
