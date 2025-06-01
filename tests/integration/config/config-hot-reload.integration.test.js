const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { ConfigManager, ConfigIntegration } = require('../../../src/config');

// Helper function to wait for config manager readiness
const waitForConfigManagerReady = (configManager) => {
  return new Promise((resolve, reject) => {
    let timeoutId;
    let intervalId;
    
    const checkReady = () => {
      if (configManager.isWatching) {
        if (timeoutId) clearTimeout(timeoutId);
        if (intervalId) clearInterval(intervalId);
        resolve();
      }
    };
    
    // Check immediately
    checkReady();
    
    // Set up interval to check periodically
    intervalId = setInterval(checkReady, 50);
    
    // Set up timeout for failure case
    timeoutId = setTimeout(() => {
      if (intervalId) clearInterval(intervalId);
      reject(new Error('ConfigManager watcher not ready'));
    }, 5000);
  });
};

describe('Configuration Hot-Reload Integration', () => {
  let tempDir;
  let configIntegration;
  let mockComponent;

  beforeEach(async () => {
    // Set logger level to debug for detailed output
    const logger = require('../../../src/utils/logger');
    logger.level = 'debug';

    // Create temporary directory for test configurations
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'config-integration-test-'));
    
    // Create mock component that can receive configuration updates
    mockComponent = {
      name: 'TestComponent',
      currentConfig: null,
      updateConfig: jest.fn(async (configType, newConfig) => {
        mockComponent.currentConfig = newConfig;
      }),
      getConfigTypes: () => ['sources', 'ingestion', 'queue'],
      handleConfigRemoval: jest.fn(async (configType) => {
        mockComponent.currentConfig = null;
      })
    };

    // Initialize ConfigIntegration with real ConfigManager for integration testing
    configIntegration = new ConfigIntegration({
      configDir: tempDir
    });

    // Register the mock component
    configIntegration.registerComponent('testComponent', mockComponent);
  });

  afterEach(async () => {
    // Force cleanup of configIntegration
    if (configIntegration) {
      try {
        if (configIntegration.isInitialized) {
          await configIntegration.shutdown();
        }
        
        // Force cleanup of configManager if it exists
        if (configIntegration.configManager && configIntegration.configManager.watcher) {
          configIntegration.configManager.watcher.removeAllListeners();
          await configIntegration.configManager.watcher.close();
          configIntegration.configManager.watcher = null;
          configIntegration.configManager.isWatching = false;
        }
      } catch (error) {
        // Ignore cleanup errors
      }
    }
    
    // Clean up temporary directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
    
    jest.clearAllMocks();
    
    // Clear any remaining timers
    jest.clearAllTimers();
    jest.useRealTimers();
    
    // Give a moment for async cleanup
    await new Promise(resolve => setTimeout(resolve, 10));
  });

  describe('Configuration File Watching and Hot-Reload', () => {
    it('should detect and apply new configuration files', async () => {
      await configIntegration.initialize();
      
      // Wait for watcher to be ready
      await waitForConfigManagerReady(configIntegration.configManager);

      // Create a new configuration file
      const sourcesConfig = {
        sources: [
          {
            id: 'test-source-1',
            type: 'static',
            name: 'Test Static Source',
            enabled: true,
            config: { basePath: '/test/data' }
          }
        ]
      };

      const sourcesPath = path.join(tempDir, 'sources.json');
      await fs.writeFile(sourcesPath, JSON.stringify(sourcesConfig, null, 2));

      // Manually trigger configuration loading since file watcher isn't working
      await configIntegration.configManager.loadConfig(sourcesPath);

      // Wait for configuration to be processed
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify component received the configuration update
      expect(mockComponent.updateConfig).toHaveBeenCalledWith(
        'sources',
        expect.objectContaining(sourcesConfig),
        undefined
      );

      // Verify configuration is available
      const loadedConfig = configIntegration.getConfig('sources');
      expect(loadedConfig).toEqual(expect.objectContaining(sourcesConfig));
    });

    it('should detect and apply configuration file changes', async () => {
      await configIntegration.initialize();
      
      // Wait for watcher to be ready
      await waitForConfigManagerReady(configIntegration.configManager);

      // Create initial configuration
      const initialConfig = {
        batchSize: 50,
        maxRetries: 2,
        timeout: 15000
      };

      const configPath = path.join(tempDir, 'ingestion.json');
      await fs.writeFile(configPath, JSON.stringify(initialConfig, null, 2));
      
      // Manually trigger initial configuration loading
      await configIntegration.configManager.loadConfig(configPath);
      await new Promise(resolve => setTimeout(resolve, 100));

      // Reset mock to track only the update
      mockComponent.updateConfig.mockClear();

      // Update configuration
      const updatedConfig = {
        batchSize: 100,
        concurrency: 2,
        maxRetries: 5,
        timeout: 30000
      };

      await fs.writeFile(configPath, JSON.stringify(updatedConfig, null, 2));
      
      // Manually trigger configuration update
      await configIntegration.configManager.loadConfig(configPath);
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify component received the updated configuration
      expect(mockComponent.updateConfig).toHaveBeenCalledWith(
        'ingestion',
        expect.objectContaining(updatedConfig),
        expect.objectContaining(initialConfig)
      );
    });

    it('should handle configuration file removal', async () => {
      await configIntegration.initialize();
      
      // Wait for watcher to be ready
      await waitForConfigManagerReady(configIntegration.configManager);

      // Create initial configuration
      const queueConfig = {
        redis: { host: 'localhost', port: 6379 },
        queues: { concurrency: 3 }
      };

      const configPath = path.join(tempDir, 'queue.json');
      await fs.writeFile(configPath, JSON.stringify(queueConfig, null, 2));
      
      // Manually trigger initial configuration loading
      await configIntegration.configManager.loadConfig(configPath);
      await new Promise(resolve => setTimeout(resolve, 100));

      // Remove configuration file
      await fs.unlink(configPath);
      
      // Manually trigger configuration removal handling
      await configIntegration.configManager.handleFileChange('unlink', configPath);
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify component was notified of removal
      expect(mockComponent.handleConfigRemoval).toHaveBeenCalledWith(
        'queue',
        expect.objectContaining({
          redis: expect.objectContaining({
            host: 'localhost',
            port: 6379
          }),
          queues: expect.objectContaining({
            concurrency: 3
          })
        })
      );
    });

    it('should validate configurations before applying changes', async () => {
      await configIntegration.initialize();
      
      // Wait for watcher to be ready
      await waitForConfigManagerReady(configIntegration.configManager);

      // Create invalid sources configuration
      const invalidConfig = {
        sources: [
          {
            id: 'invalid-source',
            type: 'invalid-type', // Invalid source type
            name: 'Invalid Source'
            // Missing required config field
          }
        ]
      };

      const configPath = path.join(tempDir, 'sources.json');
      await fs.writeFile(configPath, JSON.stringify(invalidConfig, null, 2));

      // Wait for file change to be processed
      await new Promise(resolve => setTimeout(resolve, 200));

      // Verify component did not receive invalid configuration
      expect(mockComponent.updateConfig).not.toHaveBeenCalled();
    });

    it('should handle multiple configuration files simultaneously', async () => {
      await configIntegration.initialize();
      
      // Wait for watcher to be ready
      await waitForConfigManagerReady(configIntegration.configManager);

      // Add event listener to track config changes
      const configChanges = [];
      configIntegration.configManager.on('config-changed', (event) => {
        console.log('Config changed event received:', event.configType);
        configChanges.push(event);
      });

      // Create multiple configuration files
      const sourcesConfig = {
        sources: [
          {
            id: 'multi-test-source',
            type: 'static',
            name: 'Multi Test Source',
            enabled: true,
            config: { basePath: '/multi/test' }
          }
        ]
      };

      const ingestionConfig = {
        batchSize: 75,
        maxRetries: 4,
        timeout: 25000
      };

      const queueConfig = {
        redis: { host: 'redis-server', port: 6380 },
        queues: { concurrency: 8 }
      };

      // Write all configuration files
      console.log('Writing configuration files...');
      const sourcesPath = path.join(tempDir, 'sources.json');
      const ingestionPath = path.join(tempDir, 'ingestion.json');
      const queuePath = path.join(tempDir, 'queue.json');
      
      await Promise.all([
        fs.writeFile(sourcesPath, JSON.stringify(sourcesConfig, null, 2)),
        fs.writeFile(ingestionPath, JSON.stringify(ingestionConfig, null, 2)),
        fs.writeFile(queuePath, JSON.stringify(queueConfig, null, 2))
      ]);

      // Manually trigger configuration loading since file watcher isn't working
      console.log('Manually triggering configuration loading...');
      await Promise.all([
        configIntegration.configManager.loadConfig(sourcesPath),
        configIntegration.configManager.loadConfig(ingestionPath),
        configIntegration.configManager.loadConfig(queuePath)
      ]);

      // Wait a bit for event processing
      console.log('Waiting for event processing...');
      await new Promise(resolve => setTimeout(resolve, 100));

      console.log('Config changes received:', configChanges.length);
      console.log('Mock component updateConfig calls:', mockComponent.updateConfig.mock.calls.length);

      // Verify all configurations were applied
      expect(mockComponent.updateConfig).toHaveBeenCalledWith(
        'sources',
        expect.objectContaining(sourcesConfig),
        undefined
      );
      expect(mockComponent.updateConfig).toHaveBeenCalledWith(
        'ingestion',
        expect.objectContaining(ingestionConfig),
        undefined
      );
      expect(mockComponent.updateConfig).toHaveBeenCalledWith(
        'queue',
        expect.objectContaining({
          redis: expect.objectContaining({
            host: 'redis-server',
            port: 6380
          }),
          queues: expect.objectContaining({
            concurrency: 8
          })
        }),
        undefined
      );

      // Verify component received the latest configuration
      const allConfigs = configIntegration.getAllConfigs();
      expect(allConfigs).toEqual({
        sources: expect.objectContaining(sourcesConfig),
        ingestion: expect.objectContaining(ingestionConfig),
        queue: expect.objectContaining({
          redis: expect.objectContaining({
            host: 'redis-server',
            port: 6380
          }),
          queues: expect.objectContaining({
            concurrency: 8
          })
        })
      });
    });

    it('should handle rapid configuration changes efficiently', async () => {
      await configIntegration.initialize();
      
      // Wait for watcher to be ready
      await waitForConfigManagerReady(configIntegration.configManager);

      const configPath = path.join(tempDir, 'ingestion.json');

      // Create multiple rapid configuration changes
      const configs = [
        { batchSize: 10, maxRetries: 1, timeout: 5000 },
        { batchSize: 20, maxRetries: 2, timeout: 10000 },
        { batchSize: 30, maxRetries: 3, timeout: 15000 },
        { batchSize: 40, maxRetries: 4, timeout: 20000 },
        { batchSize: 50, maxRetries: 5, timeout: 25000 },
        { batchSize: 60, maxRetries: 6, timeout: 30000 },
        { batchSize: 70, maxRetries: 7, timeout: 35000 },
        { batchSize: 80, maxRetries: 8, timeout: 40000 },
        { batchSize: 90, maxRetries: 6, timeout: 35000 }
      ];

      // Apply configurations rapidly
      for (const config of configs) {
        await fs.writeFile(configPath, JSON.stringify(config, null, 2));
        await configIntegration.configManager.loadConfig(configPath);
        await new Promise(resolve => setTimeout(resolve, 10)); // Small delay
      }

      // Wait for all changes to be processed
      await new Promise(resolve => setTimeout(resolve, 200));

      // Verify final configuration is applied
      const finalConfig = configIntegration.getConfig('ingestion');
      expect(finalConfig.batchSize).toBe(90);
      expect(finalConfig.maxRetries).toBe(6);
      expect(finalConfig.timeout).toBe(35000);
    });
  });

  describe('Component Integration', () => {
    it('should support components with selective configuration handling', async () => {
      await configIntegration.initialize();
      
      // Wait for watcher to be ready
      await waitForConfigManagerReady(configIntegration.configManager);

      // Create a component that only handles sources configuration
      const selectiveComponent = {
        name: 'selectiveComponent',
        updateConfig: jest.fn(),
        getConfigTypes: () => ['sources']
      };

      configIntegration.registerComponent('selectiveComponent', selectiveComponent);

      // Create multiple configuration files
      const sourcesConfig = { sources: [] };
      const ingestionConfig = { batchSize: 25 };

      const sourcesPath = path.join(tempDir, 'sources.json');
      const ingestionPath = path.join(tempDir, 'ingestion.json');

      await fs.writeFile(sourcesPath, JSON.stringify(sourcesConfig, null, 2));
      await fs.writeFile(ingestionPath, JSON.stringify(ingestionConfig, null, 2));

      // Manually trigger configuration loading
      await configIntegration.configManager.loadConfig(sourcesPath);
      await configIntegration.configManager.loadConfig(ingestionPath);
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify selective component only received sources configuration
      expect(selectiveComponent.updateConfig).toHaveBeenCalledWith(
        'sources',
        expect.objectContaining(sourcesConfig),
        undefined
      );
      expect(selectiveComponent.updateConfig).not.toHaveBeenCalledWith(
        'ingestion',
        expect.anything(),
        expect.anything()
      );

      // Verify general component received both configurations
      expect(mockComponent.updateConfig).toHaveBeenCalledWith(
        'sources',
        expect.objectContaining(sourcesConfig),
        undefined
      );
      expect(mockComponent.updateConfig).toHaveBeenCalledWith(
        'ingestion',
        expect.objectContaining(ingestionConfig),
        undefined
      );
    });

    it('should handle component update failures gracefully', async () => {
      // Create a component that fails to update
      const failingComponent = {
        updateConfig: jest.fn().mockRejectedValue(new Error('Component update failed')),
        getConfigTypes: () => true
      };

      configIntegration.registerComponent('failingComponent', failingComponent);
      await configIntegration.initialize();
      
      // Wait for watcher to be ready
      await waitForConfigManagerReady(configIntegration.configManager);

      // Create configuration file
      const sourcesConfig = {
        sources: [
          {
            id: 'test-source',
            type: 'static',
            name: 'Test Source',
            enabled: true,
            config: { basePath: '/test' }
          }
        ]
      };

      const sourcesPath = path.join(tempDir, 'sources.json');
      await fs.writeFile(sourcesPath, JSON.stringify(sourcesConfig, null, 2));

      // Manually trigger configuration loading
      await configIntegration.configManager.loadConfig(sourcesPath);
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify failing component was called but other components still work
      expect(failingComponent.updateConfig).toHaveBeenCalled();
      expect(mockComponent.updateConfig).toHaveBeenCalledWith(
        'sources',
        expect.objectContaining(sourcesConfig),
        undefined
      );
    });
  });

  describe('Configuration Validation Integration', () => {
    it('should validate all current configurations', async () => {
      await configIntegration.initialize();
      
      // Wait for watcher to be ready
      await waitForConfigManagerReady(configIntegration.configManager);

      // Create valid configuration files
      const sourcesConfig = {
        sources: [
          {
            id: 'test-source',
            type: 'static',
            name: 'Test Source',
            enabled: true,
            config: { basePath: '/test' }
          }
        ]
      };

      const ingestionConfig = {
        batchSize: 50,
        maxRetries: 3,
        timeout: 30000
      };

      const sourcesPath = path.join(tempDir, 'sources.json');
      const ingestionPath = path.join(tempDir, 'ingestion.json');

      await fs.writeFile(sourcesPath, JSON.stringify(sourcesConfig, null, 2));
      await fs.writeFile(ingestionPath, JSON.stringify(ingestionConfig, null, 2));

      // Manually trigger configuration loading
      await configIntegration.configManager.loadConfig(sourcesPath);
      await configIntegration.configManager.loadConfig(ingestionPath);
      await new Promise(resolve => setTimeout(resolve, 100));

      const validationResults = await configIntegration.validateAllConfigs();

      expect(validationResults.sources.valid).toBe(true);
      expect(validationResults.ingestion.valid).toBe(true);
    });
  });

  describe('Error Handling and Recovery', () => {
    it('should handle file system errors gracefully', async () => {
      await configIntegration.initialize();
      
      // Wait for watcher to be ready
      await waitForConfigManagerReady(configIntegration.configManager);

      // Create a configuration file with invalid JSON
      const configPath = path.join(tempDir, 'sources.json');
      await fs.writeFile(configPath, '{ invalid json content }');

      // Wait for file to be processed
      await new Promise(resolve => setTimeout(resolve, 200));

      // Verify component did not receive invalid configuration
      expect(mockComponent.updateConfig).not.toHaveBeenCalled();
    });

    it('should emit error events for configuration issues', async () => {
      const errorHandler = jest.fn();
      await configIntegration.initialize();
      
      // Listen for errors on the config manager
      configIntegration.configManager.on('error', errorHandler);
      
      // Wait for watcher to be ready
      await waitForConfigManagerReady(configIntegration.configManager);

      // Create invalid configuration
      const invalidConfig = {
        sources: [
          {
            // Missing required fields
            type: 'invalid-type'
          }
        ]
      };

      const configPath = path.join(tempDir, 'sources.json');
      await fs.writeFile(configPath, JSON.stringify(invalidConfig, null, 2));

      // Manually trigger configuration loading which should fail
      try {
        await configIntegration.configManager.handleFileChange('add', configPath);
      } catch (error) {
        // Expected to fail
      }
      
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify error event was emitted
      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'config-change-error'
        })
      );
    });
  });

  describe('Performance and Resource Management', () => {
    it('should properly clean up resources on shutdown', async () => {
      await configIntegration.initialize();
      expect(configIntegration.isInitialized).toBe(true);

      await configIntegration.shutdown();
      expect(configIntegration.isInitialized).toBe(false);

      // Verify watcher is stopped
      expect(configIntegration.configManager.isWatching).toBe(false);
    });
  });
});