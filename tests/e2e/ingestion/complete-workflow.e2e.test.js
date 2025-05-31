const path = require('path');
const fs = require('fs').promises;
const IngestionEngine = require('../../../src/ingestion/IngestionEngine');
const { SOURCE_TYPES } = require('../../../src/ingestion/types');

describe('Complete Ingestion Workflow E2E Tests', () => {
  let testDataDir;
  let engine;
  let processedDocuments = [];

  beforeAll(async () => {
    // Create comprehensive test data directory structure
    testDataDir = path.join(__dirname, 'e2e-test-data');
    await fs.mkdir(testDataDir, { recursive: true });

    // Create various document types
    await fs.writeFile(
      path.join(testDataDir, 'technical-doc.md'),
      '# Technical Documentation\n\nThis document contains **important** technical information.\n\n## Overview\n\nSystem architecture details...'
    );

    await fs.writeFile(
      path.join(testDataDir, 'user-manual.txt'),
      'User Manual\n\nThis is a comprehensive user manual with step-by-step instructions for using the system.'
    );

    await fs.writeFile(
      path.join(testDataDir, 'api-spec.json'),
      JSON.stringify({
        title: 'API Specification',
        version: '1.0.0',
        description: 'RESTful API specification for the system',
        endpoints: [
          { path: '/api/users', method: 'GET', description: 'Get all users' },
          { path: '/api/users/:id', method: 'GET', description: 'Get user by ID' }
        ]
      }, null, 2)
    );

    await fs.writeFile(
      path.join(testDataDir, 'changelog.md'),
      '# Changelog\n\n## Version 1.0.0\n- Initial release\n- Added user management\n- Implemented API endpoints'
    );

    // Create subdirectories with nested content
    const docsDir = path.join(testDataDir, 'docs');
    await fs.mkdir(docsDir, { recursive: true });
    
    await fs.writeFile(
      path.join(docsDir, 'installation.md'),
      '# Installation Guide\n\n## Prerequisites\n\n- Node.js 18+\n- PostgreSQL 13+\n\n## Steps\n\n1. Clone repository\n2. Install dependencies\n3. Configure database'
    );

    await fs.writeFile(
      path.join(docsDir, 'troubleshooting.txt'),
      'Troubleshooting Guide\n\nCommon issues and solutions:\n\n1. Database connection errors\n2. Authentication failures\n3. Performance issues'
    );

    // Create archived content
    const archiveDir = path.join(testDataDir, 'archive');
    await fs.mkdir(archiveDir, { recursive: true });
    
    await fs.writeFile(
      path.join(archiveDir, 'legacy-system.md'),
      '# Legacy System Documentation\n\nThis document describes the old system that was replaced.'
    );
  });

  afterAll(async () => {
    // Cleanup test data
    try {
      await fs.rm(testDataDir, { recursive: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  beforeEach(async () => {
    engine = new IngestionEngine();
    await engine.initialize();
    processedDocuments = [];

    // Set up event listeners to track processing
    engine.on('documentProcessingCompleted', (sourceId, docId) => {
      processedDocuments.push({ sourceId, docId });
    });
  });

  afterEach(async () => {
    if (engine) {
      await engine.shutdown();
    }
  });

  describe('Single Source Complete Workflow', () => {
    test('should complete full workflow for static source', async () => {
      // Step 1: Configure and add source
      const sourceConfig = {
        id: 'e2e-static-source',
        type: SOURCE_TYPES.STATIC,
        config: {
          basePath: testDataDir,
          fileTypes: ['md', 'txt', 'json'],
          recursive: false
        }
      };

      await engine.addSource(sourceConfig);
      
      // Verify source was added
      const sources = engine.getSources();
      expect(sources).toHaveLength(1);
      expect(sources[0].id).toBe('e2e-static-source');

      // Step 2: Discover documents
      const discoveredDocs = await engine.discoverDocuments('e2e-static-source');
      expect(discoveredDocs.length).toBeGreaterThanOrEqual(4);
      
      // Verify document properties
      discoveredDocs.forEach(doc => {
        expect(doc).toHaveProperty('id');
        expect(doc).toHaveProperty('title');
        expect(doc).toHaveProperty('url');
        expect(doc).toHaveProperty('metadata');
        expect(doc.metadata.sourceId).toBe('e2e-static-source');
      });

      // Step 3: Process all documents
      const results = await engine.processAllDocuments('e2e-static-source');
      
      expect(results.processed.length).toBe(discoveredDocs.length);
      expect(results.failed).toHaveLength(0);
      
      // Verify processed documents have required properties
      results.processed.forEach(doc => {
        expect(doc).toHaveProperty('id');
        expect(doc).toHaveProperty('title');
        expect(doc).toHaveProperty('content');
        expect(doc).toHaveProperty('metadata');
        expect(doc.metadata).toHaveProperty('wordCount');
        expect(doc.metadata).toHaveProperty('characterCount');
        expect(doc.metadata).toHaveProperty('sourceId');
        expect(doc.metadata).toHaveProperty('processedAt');
        expect(doc.metadata.sourceId).toBe('e2e-static-source');
      });

      // Step 4: Verify content extraction
      const techDoc = results.processed.find(doc => doc.title === 'Technical Documentation');
      expect(techDoc).toBeDefined();
      expect(techDoc.content).toContain('System architecture details');

      const userManual = results.processed.find(doc => doc.title === 'user-manual');
      expect(userManual).toBeDefined();
      expect(userManual.content).toContain('step-by-step instructions');

      const apiSpec = results.processed.find(doc => doc.title === 'api-spec');
      expect(apiSpec).toBeDefined();
      expect(apiSpec.content).toContain('API Specification');

      // Step 5: Verify event tracking
      expect(processedDocuments.length).toBe(discoveredDocs.length);
      processedDocuments.forEach(event => {
        expect(event.sourceId).toBe('e2e-static-source');
      });
    });

    test('should handle recursive discovery workflow', async () => {
      const sourceConfig = {
        id: 'e2e-recursive-source',
        type: SOURCE_TYPES.STATIC,
        config: {
          basePath: testDataDir,
          fileTypes: ['md', 'txt'],
          recursive: true
        }
      };

      await engine.addSource(sourceConfig);
      
      const discoveredDocs = await engine.discoverDocuments('e2e-recursive-source');
      
      // Should find documents in subdirectories
      expect(discoveredDocs.length).toBeGreaterThanOrEqual(6);
      
      const docTitles = discoveredDocs.map(d => d.title);
      expect(docTitles).toContain('installation.md');
      expect(docTitles).toContain('troubleshooting.txt');
      expect(docTitles).toContain('legacy-system.md');

      const results = await engine.processAllDocuments('e2e-recursive-source');
      expect(results.processed.length).toBe(discoveredDocs.length);
      expect(results.failed).toHaveLength(0);
    });
  });

  describe('Multi-Source Workflow', () => {
    test('should handle multiple sources simultaneously', async () => {
      // Configure multiple sources
      const source1Config = {
        id: 'e2e-docs-source',
        type: SOURCE_TYPES.STATIC,
        config: {
          basePath: path.join(testDataDir, 'docs'),
          fileTypes: ['md', 'txt'],
          recursive: false
        }
      };

      const source2Config = {
        id: 'e2e-root-source',
        type: SOURCE_TYPES.STATIC,
        config: {
          basePath: testDataDir,
          fileTypes: ['json'],
          recursive: false
        }
      };

      await engine.addSource(source1Config);
      await engine.addSource(source2Config);

      // Verify both sources are registered
      const sources = engine.getSources();
      expect(sources).toHaveLength(2);

      // Process all sources
      const allResults = await engine.processAllSources();
      expect(allResults).toHaveLength(2);

      const docsResults = allResults.find(r => r.sourceId === 'e2e-docs-source');
      const rootResults = allResults.find(r => r.sourceId === 'e2e-root-source');

      expect(docsResults.processed.length).toBeGreaterThan(0);
      expect(rootResults.processed.length).toBeGreaterThan(0);
      expect(docsResults.failed).toHaveLength(0);
      expect(rootResults.failed).toHaveLength(0);

      // Verify source isolation
      docsResults.processed.forEach(doc => {
        expect(doc.metadata.sourceId).toBe('e2e-docs-source');
      });

      rootResults.processed.forEach(doc => {
        expect(doc.metadata.sourceId).toBe('e2e-root-source');
      });
    });
  });

  describe('Error Handling and Recovery Workflow', () => {
    test('should handle partial failures gracefully', async () => {
      const sourceConfig = {
        id: 'e2e-error-source',
        type: SOURCE_TYPES.STATIC,
        config: {
          basePath: testDataDir,
          fileTypes: ['md', 'txt'],
          recursive: false
        }
      };

      await engine.addSource(sourceConfig);
      
      // Mock extraction failure for specific document
      const source = engine.getSource('e2e-error-source');
      const originalExtract = source.handler.extract.bind(source.handler);
      
      source.handler.extract = jest.fn().mockImplementation((doc) => {
        if (doc.title === 'technical-doc.md') {
          throw new Error('Simulated extraction failure');
        }
        return originalExtract(doc);
      });

      const results = await engine.processAllDocuments('e2e-error-source');
      
      expect(results.failed.length).toBeGreaterThan(0);
      expect(results.processed.length).toBeGreaterThan(0);
      
      // Verify failed document information
      const failedDoc = results.failed.find(f => f.document.title === 'technical-doc.md');
      expect(failedDoc).toBeDefined();
      expect(failedDoc.error).toContain('Simulated extraction failure');
    });

    test('should handle source configuration errors', async () => {
      const invalidConfig = {
        id: 'e2e-invalid-source',
        type: SOURCE_TYPES.STATIC,
        config: {
          basePath: '/non-existent-directory',
          fileTypes: ['txt']
        }
      };

      await expect(engine.addSource(invalidConfig)).rejects.toThrow();
      
      // Verify engine state is not corrupted
      const sources = engine.getSources();
      expect(sources).toHaveLength(0);
    });
  });

  describe('Performance and Scalability Workflow', () => {
    test('should handle large document sets efficiently', async () => {
      // Create many test documents
      const perfTestDir = path.join(testDataDir, 'performance');
      await fs.mkdir(perfTestDir, { recursive: true });

      const docCount = 25;
      for (let i = 0; i < docCount; i++) {
        await fs.writeFile(
          path.join(perfTestDir, `doc-${i}.txt`),
          `Performance test document ${i}\n\nThis is document number ${i} with some content for testing performance and scalability.`
        );
      }

      const sourceConfig = {
        id: 'e2e-performance-source',
        type: SOURCE_TYPES.STATIC,
        config: {
          basePath: perfTestDir,
          fileTypes: ['txt'],
          recursive: false
        }
      };

      await engine.addSource(sourceConfig);

      // Measure discovery performance
      const discoveryStart = Date.now();
      const discoveredDocs = await engine.discoverDocuments('e2e-performance-source');
      const discoveryTime = Date.now() - discoveryStart;

      expect(discoveredDocs).toHaveLength(docCount);
      expect(discoveryTime).toBeLessThan(1000); // Should complete within 1 second

      // Measure processing performance
      const processStart = Date.now();
      const results = await engine.processAllDocuments('e2e-performance-source');
      const processTime = Date.now() - processStart;

      expect(results.processed).toHaveLength(docCount);
      expect(results.failed).toHaveLength(0);
      expect(processTime).toBeLessThan(3000); // Should complete within 3 seconds

      // Cleanup performance test files
      await fs.rm(perfTestDir, { recursive: true });
    });
  });

  describe('Configuration Management Workflow', () => {
    test('should handle source updates and reconfigurations', async () => {
      // Initial configuration
      const initialConfig = {
        id: 'e2e-config-source',
        type: SOURCE_TYPES.STATIC,
        config: {
          basePath: testDataDir,
          fileTypes: ['txt'],
          recursive: false
        }
      };

      await engine.addSource(initialConfig);
      
      const initialDocs = await engine.discoverDocuments('e2e-config-source');
      const txtDocsCount = initialDocs.length;

      // Update configuration to include more file types
      const updatedConfig = {
        ...initialConfig,
        config: {
          ...initialConfig.config,
          fileTypes: ['txt', 'md', 'json']
        }
      };

      await engine.updateSource('e2e-config-source', updatedConfig);
      
      const updatedDocs = await engine.discoverDocuments('e2e-config-source');
      expect(updatedDocs.length).toBeGreaterThan(txtDocsCount);

      // Verify new file types are included
      const extensions = updatedDocs.map(d => d.extension);
      expect(extensions).toContain('.md');
      expect(extensions).toContain('.json');
    });

    test('should handle source removal workflow', async () => {
      const sourceConfig = {
        id: 'e2e-removable-source',
        type: SOURCE_TYPES.STATIC,
        config: {
          basePath: testDataDir,
          fileTypes: ['txt']
        }
      };

      await engine.addSource(sourceConfig);
      expect(engine.getSources()).toHaveLength(1);

      await engine.removeSource('e2e-removable-source');
      expect(engine.getSources()).toHaveLength(0);

      // Verify operations on removed source fail appropriately
      await expect(engine.discoverDocuments('e2e-removable-source')).rejects.toThrow();
    });
  });

  describe('Engine Lifecycle Workflow', () => {
    test('should handle complete engine lifecycle', async () => {
      // Test initialization
      expect(engine.isInitialized).toBe(true);
      
      const stats = engine.getStatistics();
      expect(stats.isInitialized).toBe(true);
      expect(stats.totalSources).toBe(0);

      // Add sources and verify statistics
      const sourceConfig = {
        id: 'e2e-lifecycle-source',
        type: SOURCE_TYPES.STATIC,
        config: {
          basePath: testDataDir,
          fileTypes: ['txt']
        }
      };

      await engine.addSource(sourceConfig);
      
      const updatedStats = engine.getStatistics();
      expect(updatedStats.totalSources).toBe(1);
      expect(updatedStats.sourceTypes[SOURCE_TYPES.STATIC]).toBe(1);

      // Test shutdown
      await engine.shutdown();
      expect(engine.isInitialized).toBe(false);
      expect(engine.getSources()).toHaveLength(0);
    });
  });
});
