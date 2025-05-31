const path = require('path');
const fs = require('fs').promises;
const IngestionEngine = require('../../../src/ingestion/IngestionEngine');
const { SOURCE_TYPES } = require('../../../src/ingestion/types');

describe('Ingestion Engine Integration Tests', () => {
  let testDataDir;
  let engine;

  beforeAll(async () => {
    // Create test data directory
    testDataDir = path.join(__dirname, 'engine-test-data');
    await fs.mkdir(testDataDir, { recursive: true });

    // Create test files
    await fs.writeFile(
      path.join(testDataDir, 'document1.txt'),
      'This is the first test document with important content.'
    );
    await fs.writeFile(
      path.join(testDataDir, 'document2.md'),
      '# Important Document\n\nThis document contains **critical** information about the system.'
    );
    await fs.writeFile(
      path.join(testDataDir, 'data.json'),
      JSON.stringify({
        title: 'API Response',
        content: 'This is structured data from an API',
        metadata: { source: 'api', timestamp: '2023-01-01' }
      })
    );

    // Create subdirectory with more files
    const subDir = path.join(testDataDir, 'subdirectory');
    await fs.mkdir(subDir, { recursive: true });
    await fs.writeFile(
      path.join(subDir, 'nested.txt'),
      'This is a nested document in a subdirectory.'
    );
  });

  afterAll(async () => {
    // Cleanup test data
    try {
      await fs.rmdir(testDataDir, { recursive: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  beforeEach(async () => {
    engine = new IngestionEngine();
    await engine.initialize();
  });

  afterEach(async () => {
    if (engine) {
      await engine.shutdown();
    }
  });

  describe('Source Configuration and Management', () => {
    test('should add and configure static source', async () => {
      const sourceConfig = {
        id: 'test-static-source',
        type: SOURCE_TYPES.STATIC,
        config: {
          basePath: testDataDir,
          fileTypes: ['txt', 'md'],
          recursive: false
        }
      };

      await engine.addSource(sourceConfig);
      
      const sources = engine.getSources();
      expect(sources).toHaveLength(1);
      expect(sources[0].id).toBe('test-static-source');
      expect(sources[0].type).toBe(SOURCE_TYPES.STATIC);
    });

    test('should remove source', async () => {
      const sourceConfig = {
        id: 'removable-source',
        type: SOURCE_TYPES.STATIC,
        config: {
          basePath: testDataDir,
          fileTypes: ['txt']
        }
      };

      await engine.addSource(sourceConfig);
      expect(engine.getSources()).toHaveLength(1);

      await engine.removeSource('removable-source');
      expect(engine.getSources()).toHaveLength(0);
    });

    test('should update source configuration', async () => {
      const sourceConfig = {
        id: 'updatable-source',
        type: SOURCE_TYPES.STATIC,
        config: {
          basePath: testDataDir,
          fileTypes: ['txt']
        }
      };

      await engine.addSource(sourceConfig);

      const updatedConfig = {
        ...sourceConfig,
        config: {
          ...sourceConfig.config,
          fileTypes: ['txt', 'md']
        }
      };

      await engine.updateSource('updatable-source', updatedConfig);
      
      const sources = engine.getSources();
      expect(sources[0].config.fileTypes).toContain('md');
    });
  });

  describe('Document Discovery and Processing', () => {
    test('should discover documents from static source', async () => {
      const sourceConfig = {
        id: 'discovery-test',
        type: SOURCE_TYPES.STATIC,
        config: {
          basePath: testDataDir,
          fileTypes: ['txt', 'md'],
          recursive: false
        }
      };

      await engine.addSource(sourceConfig);
      const documents = await engine.discoverDocuments('discovery-test');

      expect(documents).toHaveLength(2);
      expect(documents.map(d => d.title)).toContain('document1.txt');
      expect(documents.map(d => d.title)).toContain('document2.md');
    });

    test('should discover documents recursively', async () => {
      const sourceConfig = {
        id: 'recursive-test',
        type: SOURCE_TYPES.STATIC,
        config: {
          basePath: testDataDir,
          fileTypes: ['txt'],
          recursive: true
        }
      };

      await engine.addSource(sourceConfig);
      const documents = await engine.discoverDocuments('recursive-test');

      expect(documents.length).toBeGreaterThanOrEqual(2);
      expect(documents.map(d => d.title)).toContain('document1.txt');
      expect(documents.map(d => d.title)).toContain('nested.txt');
    });

    test('should process single document', async () => {
      const sourceConfig = {
        id: 'process-test',
        type: SOURCE_TYPES.STATIC,
        config: {
          basePath: testDataDir,
          fileTypes: ['txt']
        }
      };

      await engine.addSource(sourceConfig);
      const documents = await engine.discoverDocuments('process-test');
      const document = documents[0];

      const processedDoc = await engine.processDocument('process-test', document);

      expect(processedDoc.content).toContain('first test document');
      expect(processedDoc.metadata.wordCount).toBeGreaterThan(0);
      expect(processedDoc.metadata.characterCount).toBeGreaterThan(0);
      expect(processedDoc.metadata.sourceId).toBe('process-test');
    });

    test('should process all documents from source', async () => {
      const sourceConfig = {
        id: 'batch-process-test',
        type: SOURCE_TYPES.STATIC,
        config: {
          basePath: testDataDir,
          fileTypes: ['txt', 'md'],
          recursive: false
        }
      };

      await engine.addSource(sourceConfig);
      const results = await engine.processAllDocuments('batch-process-test');

      expect(results.processed).toHaveLength(2);
      expect(results.failed).toHaveLength(0);
      expect(results.processed.every(doc => doc.content)).toBe(true);
      expect(results.processed.every(doc => doc.metadata.sourceId === 'batch-process-test')).toBe(true);
    });
  });

  describe('Multiple Sources Management', () => {
    test('should handle multiple sources simultaneously', async () => {
      const source1Config = {
        id: 'multi-source-1',
        type: SOURCE_TYPES.STATIC,
        config: {
          basePath: testDataDir,
          fileTypes: ['txt']
        }
      };

      const source2Config = {
        id: 'multi-source-2',
        type: SOURCE_TYPES.STATIC,
        config: {
          basePath: testDataDir,
          fileTypes: ['md']
        }
      };

      await engine.addSource(source1Config);
      await engine.addSource(source2Config);

      const sources = engine.getSources();
      expect(sources).toHaveLength(2);

      const docs1 = await engine.discoverDocuments('multi-source-1');
      const docs2 = await engine.discoverDocuments('multi-source-2');

      expect(docs1.every(d => d.title.endsWith('.txt'))).toBe(true);
      expect(docs2.every(d => d.title.endsWith('.md'))).toBe(true);
    });

    test('should process all sources', async () => {
      const source1Config = {
        id: 'all-sources-1',
        type: SOURCE_TYPES.STATIC,
        config: {
          basePath: testDataDir,
          fileTypes: ['txt']
        }
      };

      const source2Config = {
        id: 'all-sources-2',
        type: SOURCE_TYPES.STATIC,
        config: {
          basePath: testDataDir,
          fileTypes: ['md']
        }
      };

      await engine.addSource(source1Config);
      await engine.addSource(source2Config);

      const allResults = await engine.processAllSources();

      expect(allResults).toHaveLength(2);
      expect(allResults.every(result => result.sourceId)).toBe(true);
      expect(allResults.every(result => result.processed.length > 0)).toBe(true);
    });
  });

  describe('Error Handling and Recovery', () => {
    test('should handle invalid source configuration', async () => {
      const invalidConfig = {
        id: 'invalid-source',
        type: SOURCE_TYPES.STATIC,
        config: {
          basePath: '/non-existent-directory',
          fileTypes: ['txt']
        }
      };

      await expect(engine.addSource(invalidConfig)).rejects.toThrow();
    });

    test('should handle missing source operations', async () => {
      await expect(engine.discoverDocuments('non-existent-source')).rejects.toThrow();
      await expect(engine.processAllDocuments('non-existent-source')).rejects.toThrow();
    });

    test('should handle document processing errors gracefully', async () => {
      const sourceConfig = {
        id: 'error-test',
        type: SOURCE_TYPES.STATIC,
        config: {
          basePath: testDataDir,
          fileTypes: ['txt']
        }
      };

      await engine.addSource(sourceConfig);
      
      // Create a fake document that will cause processing errors
      const fakeDocument = {
        id: 'fake-doc',
        title: 'non-existent.txt',
        url: path.join(testDataDir, 'non-existent.txt'),
        metadata: {}
      };

      await expect(engine.processDocument('error-test', fakeDocument)).rejects.toThrow();
    });

    test('should continue processing other documents when one fails', async () => {
      const sourceConfig = {
        id: 'partial-failure-test',
        type: SOURCE_TYPES.STATIC,
        config: {
          basePath: testDataDir,
          fileTypes: ['txt']
        }
      };

      await engine.addSource(sourceConfig);
      
      // Mock the handler to fail on specific documents
      const source = engine.getSource('partial-failure-test');
      const originalExtract = source.handler.extract.bind(source.handler);
      
      source.handler.extract = jest.fn().mockImplementation((doc) => {
        if (doc.title === 'document1.txt') {
          throw new Error('Simulated extraction error');
        }
        return originalExtract(doc);
      });

      const results = await engine.processAllDocuments('partial-failure-test');
      
      expect(results.failed.length).toBeGreaterThan(0);
      expect(results.processed.length).toBeGreaterThan(0);
    });
  });

  describe('Performance and Scalability', () => {
    test('should handle large number of files efficiently', async () => {
      // Create many test files
      const fileCount = 50;
      const perfTestDir = path.join(testDataDir, 'performance');
      await fs.mkdir(perfTestDir, { recursive: true });

      for (let i = 0; i < fileCount; i++) {
        await fs.writeFile(
          path.join(perfTestDir, `perf-${i}.txt`),
          `Performance test document ${i} with content for testing.`
        );
      }

      const sourceConfig = {
        id: 'performance-test',
        type: SOURCE_TYPES.STATIC,
        config: {
          basePath: perfTestDir,
          fileTypes: ['txt']
        }
      };

      await engine.addSource(sourceConfig);

      const startTime = Date.now();
      const documents = await engine.discoverDocuments('performance-test');
      const discoveryTime = Date.now() - startTime;

      expect(documents).toHaveLength(fileCount);
      expect(discoveryTime).toBeLessThan(2000); // Should complete within 2 seconds

      // Test processing performance
      const processStartTime = Date.now();
      const results = await engine.processAllDocuments('performance-test');
      const processTime = Date.now() - processStartTime;

      expect(results.processed).toHaveLength(fileCount);
      expect(processTime).toBeLessThan(5000); // Should complete within 5 seconds

      // Cleanup performance test files
      await fs.rmdir(perfTestDir, { recursive: true });
    });
  });

  describe('Configuration Validation', () => {
    test('should validate source configuration before adding', async () => {
      const invalidConfigs = [
        { id: 'missing-type', config: {} },
        { type: SOURCE_TYPES.STATIC, config: {} }, // missing id
        { id: 'invalid-type', type: 'unknown-type', config: {} },
        { id: 'missing-config', type: SOURCE_TYPES.STATIC }
      ];

      for (const config of invalidConfigs) {
        await expect(engine.addSource(config)).rejects.toThrow();
      }
    });

    test('should validate static source specific configuration', async () => {
      const invalidStaticConfigs = [
        {
          id: 'no-base-path',
          type: SOURCE_TYPES.STATIC,
          config: { fileTypes: ['txt'] }
        },
        {
          id: 'invalid-base-path',
          type: SOURCE_TYPES.STATIC,
          config: { basePath: 123, fileTypes: ['txt'] }
        }
      ];

      for (const config of invalidStaticConfigs) {
        await expect(engine.addSource(config)).rejects.toThrow();
      }
    });
  });
});
