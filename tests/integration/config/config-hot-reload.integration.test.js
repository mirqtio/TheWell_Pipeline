const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { ConfigManager, ConfigIntegration } = require('../../../src/config');

describe('Configuration Hot-Reload Integration', () => {
  let tempDir;
  let configIntegration;
  let mockComponent;

  beforeEach(async () => {
    // Create temporary directory for test configurations
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'config-integration-test-'));
    
    // Create mock component that can receive configuration updates
    mockComponent = {
      name: 'TestComponent',
      currentConfig: null,
      updateConfig: jest.fn(async (configType, newConfig) => {
        mockComponent.currentConfig = newConfig;
      }),
      handlesConfigType: jest.fn((configType) => {
        return ['sources', 'ingestion', 'queue'].includes(configType);
      }),
      handleConfigRemoval: jest.fn(async (configType) => {
        mockComponent.currentConfig = null;
      })
    };

    // Initialize ConfigIntegration with test directory
    configIntegration = new ConfigIntegration({
      configManager: {
        configDir: tempDir,
        watchOptions: { ignoreInitial: true }
      }
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
      await new Promise(resolve => {
        configIntegration.configManager.on('ready', resolve);
      });

      // Create a new sources configuration file
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

      const configPath = path.join(tempDir, 'sources.json');
      await fs.writeFile(configPath, JSON.stringify(sourcesConfig, null, 2));

      // Wait for file change to be processed
      await new Promise(resolve => setTimeout(resolve, 200));

      // Verify component received the configuration update
      expect(mockComponent.updateConfig).toHaveBeenCalledWith(
        'sources',
        expect.objectContaining(sourcesConfig),
        undefined
      );
      expect(mockComponent.currentConfig).toEqual(expect.objectContaining(sourcesConfig));
    });

    it('should detect and apply configuration file changes', async () => {
      await configIntegration.initialize();
      
      // Wait for watcher to be ready
      await new Promise(resolve => {
        configIntegration.configManager.on('ready', resolve);
      });

      // Create initial configuration
      const initialConfig = {
        batchSize: 50,
        maxRetries: 2,
        timeout: 15000
      };

      const configPath = path.join(tempDir, 'ingestion.json');
      await fs.writeFile(configPath, JSON.stringify(initialConfig, null, 2));

      // Wait for initial file to be processed
      await new Promise(resolve => setTimeout(resolve, 200));

      // Clear mock calls from initial creation
      mockComponent.updateConfig.mockClear();

      // Update the configuration
      const updatedConfig = {
        batchSize: 100,
        maxRetries: 5,
        timeout: 30000,
        concurrency: 2
      };

      await fs.writeFile(configPath, JSON.stringify(updatedConfig, null, 2));

      // Wait for file change to be processed
      await new Promise(resolve => setTimeout(resolve, 200));

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
      await new Promise(resolve => {
        configIntegration.configManager.on('ready', resolve);
      });

      // Create configuration file
      const queueConfig = {
        redis: { host: 'localhost', port: 6379 },
        queues: { concurrency: 3 }
      };

      const configPath = path.join(tempDir, 'queue.json');
      await fs.writeFile(configPath, JSON.stringify(queueConfig, null, 2));

      // Wait for file creation to be processed
      await new Promise(resolve => setTimeout(resolve, 200));

      // Clear mock calls from creation
      mockComponent.handleConfigRemoval.mockClear();

      // Remove the configuration file
      await fs.unlink(configPath);

      // Wait for file removal to be processed
      await new Promise(resolve => setTimeout(resolve, 200));

      // Verify component was notified of removal
      expect(mockComponent.handleConfigRemoval).toHaveBeenCalledWith(
        'queue',
        expect.objectContaining(queueConfig)
      );
    });

    it('should validate configurations before applying changes', async () => {
      await configIntegration.initialize();
      
      // Wait for watcher to be ready
      await new Promise(resolve => {
        configIntegration.configManager.on('ready', resolve);
      });

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
      await new Promise(resolve => {
        configIntegration.configManager.on('ready', resolve);
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
      await Promise.all([
        fs.writeFile(path.join(tempDir, 'sources.json'), JSON.stringify(sourcesConfig, null, 2)),
        fs.writeFile(path.join(tempDir, 'ingestion.json'), JSON.stringify(ingestionConfig, null, 2)),
        fs.writeFile(path.join(tempDir, 'queue.json'), JSON.stringify(queueConfig, null, 2))
      ]);

      // Wait for all files to be processed
      await new Promise(resolve => setTimeout(resolve, 300));

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
        expect.objectContaining(queueConfig),
        undefined
      );

      // Verify component received the latest configuration
      const allConfigs = configIntegration.getAllConfigs();
      expect(allConfigs).toEqual({
        sources: expect.objectContaining(sourcesConfig),
        ingestion: expect.objectContaining(ingestionConfig),
        queue: expect.objectContaining(queueConfig)
      });
    });
  });

  describe('Component Integration', () => {
    it('should support components with selective configuration handling', async () => {
      // Create a component that only handles specific config types
      const selectiveComponent = {
        updateConfig: jest.fn(),
        handlesConfigType: jest.fn((configType) => configType === 'sources')
      };

      configIntegration.registerComponent('selectiveComponent', selectiveComponent);
      await configIntegration.initialize();
      
      // Wait for watcher to be ready
      await new Promise(resolve => {
        configIntegration.configManager.on('ready', resolve);
      });

      // Create sources and ingestion configurations
      const sourcesConfig = { sources: [] };
      const ingestionConfig = { batchSize: 100 };

      await Promise.all([
        fs.writeFile(path.join(tempDir, 'sources.json'), JSON.stringify(sourcesConfig)),
        fs.writeFile(path.join(tempDir, 'ingestion.json'), JSON.stringify(ingestionConfig))
      ]);

      // Wait for files to be processed
      await new Promise(resolve => setTimeout(resolve, 200));

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
        handlesConfigType: jest.fn(() => true)
      };

      configIntegration.registerComponent('failingComponent', failingComponent);
      await configIntegration.initialize();
      
      // Wait for watcher to be ready
      await new Promise(resolve => {
        configIntegration.configManager.on('ready', resolve);
      });

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

      await fs.writeFile(path.join(tempDir, 'sources.json'), JSON.stringify(sourcesConfig));

      // Wait for file to be processed
      await new Promise(resolve => setTimeout(resolve, 200));

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
      await new Promise(resolve => {
        configIntegration.configManager.on('ready', resolve);
      });

      // Create valid and invalid configurations
      const validSourcesConfig = {
        sources: [
          {
            id: 'valid-source',
            type: 'static',
            name: 'Valid Source',
            enabled: true,
            config: { basePath: '/valid' }
          }
        ]
      };

      const validIngestionConfig = {
        batchSize: 100,
        maxRetries: 3
      };

      await Promise.all([
        fs.writeFile(path.join(tempDir, 'sources.json'), JSON.stringify(validSourcesConfig)),
        fs.writeFile(path.join(tempDir, 'ingestion.json'), JSON.stringify(validIngestionConfig))
      ]);

      // Wait for files to be processed
      await new Promise(resolve => setTimeout(resolve, 200));

      // Validate all configurations
      const validationResults = await configIntegration.validateAllConfigs();

      expect(validationResults.sources.valid).toBe(true);
      expect(validationResults.ingestion.valid).toBe(true);
    });
  });

  describe('Error Handling and Recovery', () => {
    it('should handle file system errors gracefully', async () => {
      await configIntegration.initialize();
      
      // Wait for watcher to be ready
      await new Promise(resolve => {
        configIntegration.configManager.on('ready', resolve);
      });

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
      configIntegration.configManager.on('error', errorHandler);

      await configIntegration.initialize();
      
      // Wait for watcher to be ready
      await new Promise(resolve => {
        configIntegration.configManager.on('ready', resolve);
      });

      // Create invalid configuration that will cause validation error
      const invalidConfig = {
        sources: [
          {
            id: 'invalid-source',
            type: 'invalid-type'
            // Missing required fields
          }
        ]
      };

      await fs.writeFile(path.join(tempDir, 'sources.json'), JSON.stringify(invalidConfig));

      // Wait for file to be processed
      await new Promise(resolve => setTimeout(resolve, 200));

      // Verify error event was emitted
      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'config-change-error'
        })
      );
    });
  });

  describe('Performance and Resource Management', () => {
    it('should handle rapid configuration changes efficiently', async () => {
      await configIntegration.initialize();
      
      // Wait for watcher to be ready
      await new Promise(resolve => {
        configIntegration.configManager.on('ready', resolve);
      });

      const configPath = path.join(tempDir, 'ingestion.json');
      
      // Make rapid configuration changes
      for (let i = 0; i < 5; i++) {
        const config = {
          batchSize: 50 + i * 10,
          maxRetries: 2 + i,
          timeout: 15000 + i * 5000
        };
        
        await fs.writeFile(configPath, JSON.stringify(config));
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      // Wait for all changes to be processed
      await new Promise(resolve => setTimeout(resolve, 300));

      // Verify final configuration is applied
      const finalConfig = configIntegration.getConfig('ingestion');
      expect(finalConfig.batchSize).toBe(90);
      expect(finalConfig.maxRetries).toBe(6);
      expect(finalConfig.timeout).toBe(35000);
    });

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