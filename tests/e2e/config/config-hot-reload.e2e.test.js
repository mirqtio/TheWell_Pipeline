const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { ConfigIntegration } = require('../../../src/config');
const IngestionEngine = require('../../../src/ingestion/IngestionEngine');
const QueueManager = require('../../../src/ingestion/queue/QueueManager');

describe('Configuration Hot-Reload E2E', () => {
  let tempDir;
  let configIntegration;
  let ingestionEngine;
  let queueManager;

  beforeAll(async () => {
    // Create temporary directory for test configurations
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'config-e2e-test-'));
    
    // Initialize components
    queueManager = new QueueManager({
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379,
        db: 1 // Use test database
      }
    });

    ingestionEngine = new IngestionEngine({
      queueManager,
      batchSize: 10
    });

    configIntegration = new ConfigIntegration({
      configManager: {
        configDir: tempDir,
        watchOptions: { ignoreInitial: true }
      }
    });

    // Register ingestion engine with config integration
    configIntegration.registerComponent('ingestionEngine', {
      updateConfig: async (configType, newConfig) => {
        if (configType === 'sources') {
          await ingestionEngine.updateSources(newConfig.sources || []);
        } else if (configType === 'ingestion') {
          ingestionEngine.updateSettings(newConfig);
        }
      },
      handlesConfigType: (configType) => ['sources', 'ingestion'].includes(configType)
    });

    // Register queue manager with config integration
    configIntegration.registerComponent('queueManager', {
      updateConfig: async (configType, newConfig) => {
        if (configType === 'queue') {
          await queueManager.updateConfig(newConfig);
        }
      },
      handlesConfigType: (configType) => configType === 'queue'
    });

    await configIntegration.initialize();
    await ingestionEngine.initialize();
  });

  afterAll(async () => {
    try {
      // Shutdown in reverse order
      if (configIntegration && configIntegration.isInitialized) {
        await configIntegration.shutdown();
      }
      
      // Force cleanup of configManager watchers
      if (configIntegration && configIntegration.configManager && configIntegration.configManager.watcher) {
        configIntegration.configManager.watcher.removeAllListeners();
        await configIntegration.configManager.watcher.close();
        configIntegration.configManager.watcher = null;
        configIntegration.configManager.isWatching = false;
      }
      
      if (ingestionEngine) {
        await ingestionEngine.shutdown();
      }
      if (queueManager) {
        await queueManager.shutdown();
      }
      
      // Clean up temporary directory
      await fs.rm(tempDir, { recursive: true, force: true });
      
      // Clear environment variables
      delete process.env.REDIS_HOST;
      delete process.env.REDIS_PORT;
      delete process.env.EXAMPLE_API_KEY;
      
    } catch (error) {
      console.error('Cleanup error:', error);
    } finally {
      // Force clear any remaining timers
      jest.clearAllTimers();
      jest.useRealTimers();
      
      // Give time for cleanup
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('End-to-End Configuration Hot-Reload', () => {
    it('should dynamically add and configure new sources without restart', async () => {
      // Wait for config integration to be ready
      await new Promise(resolve => {
        configIntegration.configManager.on('ready', resolve);
      });

      // Create initial empty sources configuration
      const initialConfig = { sources: [] };
      const sourcesPath = path.join(tempDir, 'sources.json');
      
      await fs.writeFile(sourcesPath, JSON.stringify(initialConfig, null, 2));
      await new Promise(resolve => setTimeout(resolve, 200));

      // Verify no sources initially
      expect(ingestionEngine.getActiveSources()).toHaveLength(0);

      // Add new sources via configuration file update
      const newSourcesConfig = {
        sources: [
          {
            id: 'e2e-static-source',
            type: 'static',
            name: 'E2E Static Source',
            enabled: true,
            config: {
              basePath: path.join(__dirname, '../../fixtures/static-content'),
              fileTypes: ['txt', 'md']
            },
            schedule: {
              enabled: false
            }
          },
          {
            id: 'e2e-semi-static-source',
            type: 'semi-static',
            name: 'E2E Semi-Static Source',
            enabled: true,
            config: {
              url: 'https://api.example.com/content',
              apiKey: '${TEST_API_KEY}',
              updateInterval: 3600000
            },
            schedule: {
              enabled: false
            }
          }
        ]
      };

      await fs.writeFile(sourcesPath, JSON.stringify(newSourcesConfig, null, 2));
      await new Promise(resolve => setTimeout(resolve, 300));

      // Verify sources were added dynamically
      const activeSources = ingestionEngine.getActiveSources();
      expect(activeSources).toHaveLength(2);
      expect(activeSources.map(s => s.id)).toContain('e2e-static-source');
      expect(activeSources.map(s => s.id)).toContain('e2e-semi-static-source');
    });

    it('should dynamically update ingestion settings and apply them immediately', async () => {
      // Wait for config integration to be ready
      await new Promise(resolve => {
        configIntegration.configManager.on('ready', resolve);
      });

      // Create initial ingestion configuration
      const initialIngestionConfig = {
        batchSize: 25,
        maxRetries: 2,
        timeout: 10000,
        concurrency: 1
      };

      const ingestionPath = path.join(tempDir, 'ingestion.json');
      await fs.writeFile(ingestionPath, JSON.stringify(initialIngestionConfig, null, 2));
      await new Promise(resolve => setTimeout(resolve, 200));

      // Verify initial settings applied
      expect(ingestionEngine.settings.batchSize).toBe(25);
      expect(ingestionEngine.settings.maxRetries).toBe(2);

      // Update ingestion configuration
      const updatedIngestionConfig = {
        batchSize: 100,
        maxRetries: 5,
        timeout: 30000,
        concurrency: 3,
        enableValidation: true
      };

      await fs.writeFile(ingestionPath, JSON.stringify(updatedIngestionConfig, null, 2));
      await new Promise(resolve => setTimeout(resolve, 200));

      // Verify updated settings applied
      expect(ingestionEngine.settings.batchSize).toBe(100);
      expect(ingestionEngine.settings.maxRetries).toBe(5);
      expect(ingestionEngine.settings.enableValidation).toBe(true);
    });

    it('should handle queue configuration updates and reconnect if needed', async () => {
      // Wait for config integration to be ready
      await new Promise(resolve => {
        configIntegration.configManager.on('ready', resolve);
      });

      // Create initial queue configuration
      const initialQueueConfig = {
        redis: {
          host: process.env.REDIS_HOST || 'localhost',
          port: process.env.REDIS_PORT || 6379,
          db: 1
        },
        queues: {
          concurrency: 2,
          defaultJobOptions: {
            removeOnComplete: 50,
            removeOnFail: 25,
            attempts: 2
          }
        }
      };

      const queuePath = path.join(tempDir, 'queue.json');
      await fs.writeFile(queuePath, JSON.stringify(initialQueueConfig, null, 2));
      await new Promise(resolve => setTimeout(resolve, 200));

      // Verify initial queue configuration
      expect(queueManager.config.queues.concurrency).toBe(2);

      // Update queue configuration
      const updatedQueueConfig = {
        redis: {
          host: process.env.REDIS_HOST || 'localhost',
          port: process.env.REDIS_PORT || 6379,
          db: 1
        },
        queues: {
          concurrency: 5,
          defaultJobOptions: {
            removeOnComplete: 100,
            removeOnFail: 50,
            attempts: 4,
            backoff: {
              type: 'exponential',
              delay: 3000
            }
          }
        }
      };

      await fs.writeFile(queuePath, JSON.stringify(updatedQueueConfig, null, 2));
      await new Promise(resolve => setTimeout(resolve, 200));

      // Verify updated queue configuration
      expect(queueManager.config.queues.concurrency).toBe(5);
      expect(queueManager.config.queues.defaultJobOptions.attempts).toBe(4);
    });

    it('should handle complete workflow with dynamic configuration changes', async () => {
      // Wait for config integration to be ready
      await new Promise(resolve => {
        configIntegration.configManager.on('ready', resolve);
      });

      // Create test content directory
      const testContentDir = path.join(tempDir, 'test-content');
      await fs.mkdir(testContentDir, { recursive: true });
      
      // Create test content files
      await fs.writeFile(
        path.join(testContentDir, 'document1.txt'),
        'This is test document 1 content for E2E testing.'
      );
      await fs.writeFile(
        path.join(testContentDir, 'document2.md'),
        '# Test Document 2\n\nThis is markdown content for testing.'
      );

      // Configure complete system via configuration files
      const sourcesConfig = {
        sources: [
          {
            id: 'e2e-workflow-source',
            type: 'static',
            name: 'E2E Workflow Source',
            enabled: true,
            config: {
              basePath: testContentDir,
              fileTypes: ['txt', 'md']
            },
            schedule: {
              enabled: false
            }
          }
        ]
      };

      const ingestionConfig = {
        batchSize: 5,
        maxRetries: 3,
        timeout: 15000,
        concurrency: 2
      };

      const queueConfig = {
        redis: {
          host: process.env.REDIS_HOST || 'localhost',
          port: process.env.REDIS_PORT || 6379,
          db: 1
        },
        queues: {
          concurrency: 3,
          defaultJobOptions: {
            removeOnComplete: 10,
            removeOnFail: 5,
            attempts: 2
          }
        }
      };

      // Write all configuration files
      await Promise.all([
        fs.writeFile(path.join(tempDir, 'sources.json'), JSON.stringify(sourcesConfig, null, 2)),
        fs.writeFile(path.join(tempDir, 'ingestion.json'), JSON.stringify(ingestionConfig, null, 2)),
        fs.writeFile(path.join(tempDir, 'queue.json'), JSON.stringify(queueConfig, null, 2))
      ]);

      // Wait for all configurations to be applied
      await new Promise(resolve => setTimeout(resolve, 300));

      // Verify system is configured correctly
      expect(ingestionEngine.getActiveSources()).toHaveLength(1);
      expect(ingestionEngine.settings.batchSize).toBe(5);
      expect(queueManager.config.queues.concurrency).toBe(3);

      // Start ingestion process
      const ingestionResult = await ingestionEngine.ingestFromSource('e2e-workflow-source');
      
      // Verify ingestion completed successfully
      expect(ingestionResult.success).toBe(true);
      expect(ingestionResult.documentsProcessed).toBeGreaterThan(0);

      // Update configuration during runtime
      const updatedSourcesConfig = {
        sources: [
          {
            id: 'e2e-workflow-source',
            type: 'static',
            name: 'E2E Workflow Source Updated',
            enabled: true,
            config: {
              basePath: testContentDir,
              fileTypes: ['txt', 'md', 'json']
            },
            schedule: {
              enabled: false
            }
          },
          {
            id: 'e2e-additional-source',
            type: 'static',
            name: 'E2E Additional Source',
            enabled: true,
            config: {
              basePath: testContentDir,
              fileTypes: ['txt']
            },
            schedule: {
              enabled: false
            }
          }
        ]
      };

      await fs.writeFile(
        path.join(tempDir, 'sources.json'),
        JSON.stringify(updatedSourcesConfig, null, 2)
      );

      // Wait for configuration update
      await new Promise(resolve => setTimeout(resolve, 200));

      // Verify dynamic update applied
      expect(ingestionEngine.getActiveSources()).toHaveLength(2);
      
      // Test ingestion with updated configuration
      const updatedIngestionResult = await ingestionEngine.ingestFromSource('e2e-additional-source');
      expect(updatedIngestionResult.success).toBe(true);
    });

    it('should handle configuration validation errors gracefully in production scenario', async () => {
      // Wait for config integration to be ready
      await new Promise(resolve => {
        configIntegration.configManager.on('ready', resolve);
      });

      // Set up error event listener
      const errorEvents = [];
      configIntegration.configManager.on('error', (error) => {
        errorEvents.push(error);
      });

      // Create valid initial configuration
      const validConfig = {
        sources: [
          {
            id: 'valid-source',
            type: 'static',
            name: 'Valid Source',
            enabled: true,
            config: {
              basePath: '/valid/path'
            }
          }
        ]
      };

      const sourcesPath = path.join(tempDir, 'sources.json');
      await fs.writeFile(sourcesPath, JSON.stringify(validConfig, null, 2));
      await new Promise(resolve => setTimeout(resolve, 200));

      // Verify valid configuration applied
      expect(ingestionEngine.getActiveSources()).toHaveLength(1);

      // Attempt to apply invalid configuration
      const invalidConfig = {
        sources: [
          {
            id: 'invalid-source',
            type: 'nonexistent-type', // Invalid type
            name: 'Invalid Source'
            // Missing required config
          }
        ]
      };

      await fs.writeFile(sourcesPath, JSON.stringify(invalidConfig, null, 2));
      await new Promise(resolve => setTimeout(resolve, 200));

      // Verify invalid configuration was rejected and system remains stable
      expect(ingestionEngine.getActiveSources()).toHaveLength(1);
      expect(ingestionEngine.getActiveSources()[0].id).toBe('valid-source');
      expect(errorEvents.length).toBeGreaterThan(0);
      expect(errorEvents[0].type).toBe('config-change-error');
    });

    it('should support environment variable substitution in configurations', async () => {
      // Set test environment variable
      process.env.E2E_TEST_API_KEY = 'test-api-key-12345';
      process.env.E2E_TEST_BASE_PATH = '/test/env/path';

      // Wait for config integration to be ready
      await new Promise(resolve => {
        configIntegration.configManager.on('ready', resolve);
      });

      // Create configuration with environment variables
      const configWithEnvVars = {
        sources: [
          {
            id: 'env-var-source',
            type: 'semi-static',
            name: 'Environment Variable Source',
            enabled: true,
            config: {
              url: 'https://api.example.com/data',
              apiKey: '${E2E_TEST_API_KEY}',
              basePath: '${E2E_TEST_BASE_PATH}',
              timeout: 30000
            }
          }
        ]
      };

      const sourcesPath = path.join(tempDir, 'sources.json');
      await fs.writeFile(sourcesPath, JSON.stringify(configWithEnvVars, null, 2));
      await new Promise(resolve => setTimeout(resolve, 200));

      // Verify environment variables were substituted
      const activeSources = ingestionEngine.getActiveSources();
      expect(activeSources).toHaveLength(1);
      
      const source = activeSources[0];
      expect(source.config.apiKey).toBe('test-api-key-12345');
      expect(source.config.basePath).toBe('/test/env/path');

      // Clean up environment variables
      delete process.env.E2E_TEST_API_KEY;
      delete process.env.E2E_TEST_BASE_PATH;
    });
  });

  describe('Performance and Reliability', () => {
    it('should handle high-frequency configuration changes without performance degradation', async () => {
      // Wait for config integration to be ready
      await new Promise(resolve => {
        configIntegration.configManager.on('ready', resolve);
      });

      const ingestionPath = path.join(tempDir, 'ingestion.json');
      const startTime = Date.now();

      // Make many rapid configuration changes
      for (let i = 0; i < 20; i++) {
        const config = {
          batchSize: 10 + i,
          maxRetries: 2 + (i % 3),
          timeout: 15000 + i * 1000,
          concurrency: 1 + (i % 4)
        };
        
        await fs.writeFile(ingestionPath, JSON.stringify(config, null, 2));
        await new Promise(resolve => setTimeout(resolve, 25));
      }

      // Wait for all changes to be processed
      await new Promise(resolve => setTimeout(resolve, 500));

      const endTime = Date.now();
      const processingTime = endTime - startTime;

      // Verify final configuration is correct
      expect(ingestionEngine.settings.batchSize).toBe(29);
      expect(ingestionEngine.settings.maxRetries).toBe(4);

      // Verify processing completed in reasonable time (should be under 5 seconds)
      expect(processingTime).toBeLessThan(5000);
    });

    it('should maintain system stability during configuration errors', async () => {
      // Wait for config integration to be ready
      await new Promise(resolve => {
        configIntegration.configManager.on('ready', resolve);
      });

      // Set up valid initial state
      const validConfig = {
        batchSize: 50,
        maxRetries: 3,
        timeout: 20000
      };

      const ingestionPath = path.join(tempDir, 'ingestion.json');
      await fs.writeFile(ingestionPath, JSON.stringify(validConfig, null, 2));
      await new Promise(resolve => setTimeout(resolve, 200));

      // Verify initial state
      expect(ingestionEngine.settings.batchSize).toBe(50);

      // Introduce various error conditions
      const errorConditions = [
        '{ invalid json }',
        JSON.stringify({ batchSize: 'not-a-number' }),
        JSON.stringify({ batchSize: -1 }), // Invalid value
        JSON.stringify({ unknownField: 'value' })
      ];

      for (const errorConfig of errorConditions) {
        await fs.writeFile(ingestionPath, errorConfig);
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Verify system maintains valid state despite errors
        expect(ingestionEngine.settings.batchSize).toBe(50);
      }

      // Restore valid configuration
      const restoredConfig = {
        batchSize: 75,
        maxRetries: 4,
        timeout: 25000
      };

      await fs.writeFile(ingestionPath, JSON.stringify(restoredConfig, null, 2));
      await new Promise(resolve => setTimeout(resolve, 200));

      // Verify system recovered and applied new valid configuration
      expect(ingestionEngine.settings.batchSize).toBe(75);
      expect(ingestionEngine.settings.maxRetries).toBe(4);
    });
  });
});