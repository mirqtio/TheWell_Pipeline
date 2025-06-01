/**
 * Basic Configuration Integration Test
 * Tests that configuration hot-reload works with real components
 */

const { ConfigManager, ConfigIntegration } = require('../../../src/config');
const QueueManager = require('../../../src/ingestion/queue/QueueManager');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');

describe('Configuration Hot-Reload - Basic Integration', () => {
  let tempDir;
  let configManager;
  let configIntegration;
  let queueManager;

  beforeEach(async () => {
    // Create temporary directory
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'config-basic-test-'));
    
    // Create ConfigManager
    configManager = new ConfigManager({
      configDir: tempDir
    });

    // Create ConfigIntegration
    configIntegration = new ConfigIntegration({
      configManager
    });

    // Create QueueManager with basic config
    queueManager = new QueueManager({
      redis: {
        host: 'localhost',
        port: 6379,
        db: 0
      },
      queues: {
        'static-source': { concurrency: 2 },
        'semi-static': { concurrency: 1 }
      }
    });

    // Register QueueManager with ConfigIntegration
    configIntegration.registerComponent('queueManager', queueManager);
  });

  afterEach(async () => {
    // Cleanup
    if (configIntegration && configIntegration.isInitialized) {
      await configIntegration.shutdown();
    }
    
    if (configManager && configManager.isWatching) {
      await configManager.stopWatching();
    }

    if (queueManager && queueManager.isInitialized) {
      await queueManager.shutdown();
    }

    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  it('should initialize configuration system', async () => {
    await configIntegration.initialize();
    
    // Poll for watcher to be ready (handles async timing issues)
    let attempts = 0;
    const maxAttempts = 50; // 500ms total wait time
    while (!configManager.isWatching && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 10));
      attempts++;
    }
    
    // Check watcher status after initialization and ready
    expect(configIntegration.isInitialized).toBe(true);
    expect(configManager.isWatching).toBe(true);
    
    const stats = configIntegration.getStats();
    expect(stats.componentCount).toBe(1);
    expect(stats.registeredComponents).toContain('queueManager');
  });

  it('should load and validate queue configuration', async () => {
    // Create a valid queue configuration
    const queueConfig = {
      redis: {
        host: 'localhost',
        port: 6379,
        db: 1
      },
      queues: {
        'static-source': { concurrency: 4 },
        'semi-static': { concurrency: 2 },
        'dynamic': { concurrency: 3 }
      }
    };

    const configPath = path.join(tempDir, 'queue.json');
    await fs.writeFile(configPath, JSON.stringify(queueConfig, null, 2));

    // Load configuration manually
    await configManager.loadConfig(configPath);
    
    // Verify configuration was loaded
    const loadedConfig = configManager.getConfig('queue');
    expect(loadedConfig).toBeDefined();
    expect(loadedConfig.redis.db).toBe(1);
    expect(loadedConfig.queues['dynamic']).toBeDefined();
  });

  it('should apply configuration changes to QueueManager', async () => {
    await configIntegration.initialize();
    
    // Spy on QueueManager updateConfig method
    const updateConfigSpy = jest.spyOn(queueManager, 'updateConfig');
    
    // Create configuration change event
    const configEvent = {
      type: 'config-changed',
      configType: 'queue',
      filePath: path.join(tempDir, 'queue.json'),
      newConfig: {
        redis: {
          host: 'localhost',
          port: 6379,
          db: 2
        },
        queues: {
          'static-source': { concurrency: 8 }
        }
      },
      hasChanges: true,
      isValid: true
    };

    // Apply configuration change
    await configIntegration.handleConfigChange(configEvent);

    // Verify QueueManager was updated
    expect(updateConfigSpy).toHaveBeenCalledWith(
      'queue',
      configEvent.newConfig,
      undefined
    );
    
    updateConfigSpy.mockRestore();
  });

  it('should handle configuration validation errors', async () => {
    // Create an invalid queue configuration
    const invalidConfig = {
      redis: {
        host: 'localhost',
        port: 'invalid-port' // This should be a number
      },
      queues: {
        concurrency: 'invalid' // This should be a number
      }
    };

    const configPath = path.join(tempDir, 'queue.json');
    await fs.writeFile(configPath, JSON.stringify(invalidConfig, null, 2));

    // Loading invalid config should throw validation error
    await expect(configManager.loadConfig(configPath)).rejects.toThrow('"redis.port" must be a number');
  });

  it('should provide configuration statistics', async () => {
    await configIntegration.initialize();
    
    const stats = configIntegration.getStats();
    
    expect(stats).toHaveProperty('isInitialized', true);
    expect(stats).toHaveProperty('componentCount', 1);
    expect(stats).toHaveProperty('registeredComponents');
    expect(stats).toHaveProperty('configManager');
    
    expect(Array.isArray(stats.registeredComponents)).toBe(true);
    expect(stats.registeredComponents).toContain('queueManager');
  });
});
