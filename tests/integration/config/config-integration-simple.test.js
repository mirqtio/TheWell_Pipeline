/**
 * Simple Configuration Integration Tests
 * Tests the core configuration hot-reload functionality without complex file watching
 */

const { ConfigManager, ConfigIntegration } = require('../../../src/config');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');

describe('Configuration Integration - Core Functionality', () => {
  let tempDir;
  let configManager;
  let configIntegration;
  let mockComponent;

  beforeEach(async () => {
    // Create temporary directory
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'config-simple-test-'));
    
    // Create mock component
    mockComponent = {
      updateConfig: jest.fn(),
      handlesConfigType: jest.fn((configType) => configType === 'sources')
    };

    // Create ConfigManager
    configManager = new ConfigManager({
      configDir: tempDir,
      watchOptions: { persistent: false }
    });

    // Create ConfigIntegration
    configIntegration = new ConfigIntegration({
      configManager
    });

    // Register mock component
    configIntegration.registerComponent('testComponent', mockComponent);
  });

  afterEach(async () => {
    // Cleanup
    if (configIntegration && configIntegration.isInitialized) {
      await configIntegration.shutdown();
    }
    
    if (configManager && configManager.isWatching) {
      await configManager.stopWatching();
    }

    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }

    jest.clearAllMocks();
  });

  describe('Configuration Loading and Validation', () => {
    it('should load and validate configuration files', async () => {
      // Create a valid sources configuration
      const sourcesConfig = {
        sources: [
          {
            id: 'test-source',
            type: 'static',
            name: 'Test Source',
            enabled: true,
            config: {
              basePath: '/test/path',
              fileTypes: ['txt', 'md']
            }
          }
        ]
      };

      const configPath = path.join(tempDir, 'sources.json');
      await fs.writeFile(configPath, JSON.stringify(sourcesConfig, null, 2));

      // Load configuration
      await configManager.loadConfig(configPath);
      
      // Verify configuration was loaded
      const loadedConfig = configManager.getConfig('sources');
      expect(loadedConfig).toBeDefined();
      expect(loadedConfig.sources).toHaveLength(1);
      expect(loadedConfig.sources[0].id).toBe('test-source');
    });

    it('should reject invalid configuration', async () => {
      // Create an invalid sources configuration
      const invalidConfig = {
        sources: [
          {
            id: 'test-source',
            type: 'invalid-type', // Invalid type
            name: 'Test Source'
            // Missing required fields
          }
        ]
      };

      const configPath = path.join(tempDir, 'sources.json');
      await fs.writeFile(configPath, JSON.stringify(invalidConfig, null, 2));

      // Load configuration should fail validation
      await expect(configManager.loadConfig(configPath)).rejects.toThrow('Configuration validation failed');
    });
  });

  describe('Component Integration', () => {
    it('should register and manage components', async () => {
      await configIntegration.initialize();

      // Verify component is registered
      const stats = configIntegration.getStats();
      expect(stats.registeredComponents).toHaveLength(1);
      expect(stats.registeredComponents[0]).toBe('testComponent');

      // Verify component count
      expect(stats.componentCount).toBe(1);
    });

    it('should apply configuration changes to components', async () => {
      await configIntegration.initialize();

      // Create configuration change event
      const configEvent = {
        type: 'config-changed',
        configType: 'sources',
        filePath: path.join(tempDir, 'sources.json'),
        newConfig: {
          sources: [
            {
              id: 'new-source',
              type: 'static',
              name: 'New Source',
              enabled: true,
              config: {
                basePath: '/new/path',
                fileTypes: ['txt']
              }
            }
          ]
        },
        hasChanges: true,
        isValid: true
      };

      // Apply configuration change
      await configIntegration.handleConfigChange(configEvent);

      // Verify component was called
      expect(mockComponent.updateConfig).toHaveBeenCalledTimes(1);
      expect(mockComponent.updateConfig.mock.calls[0][0]).toBe('sources');
      expect(mockComponent.updateConfig.mock.calls[0][1]).toEqual(configEvent.newConfig);
    });
  });

  describe('Configuration Management', () => {
    it('should manage configuration state', async () => {
      await configIntegration.initialize();

      // Create test configuration
      const sourcesConfig = {
        sources: [
          {
            id: 'test-source',
            type: 'static',
            name: 'Test Source',
            enabled: true,
            config: {
              basePath: '/test/path',
              fileTypes: ['txt']
            }
          }
        ]
      };

      // Set configuration through ConfigIntegration
      configIntegration.configManager.configs.set('sources', sourcesConfig);

      // Verify configuration is accessible
      expect(configIntegration.getConfig('sources')).toEqual(sourcesConfig);
      
      const allConfigs = configIntegration.getAllConfigs();
      expect(allConfigs.sources).toEqual(sourcesConfig);
    });

    it('should provide configuration statistics', async () => {
      await configIntegration.initialize();

      const stats = configIntegration.getStats();
      
      expect(stats).toHaveProperty('componentCount');
      expect(stats).toHaveProperty('isInitialized');
      expect(stats).toHaveProperty('registeredComponents');
      expect(stats.configManager).toHaveProperty('configCount');
    });
  });

  describe('Error Handling', () => {
    it('should handle component update failures gracefully', async () => {
      // Make component update fail
      mockComponent.updateConfig.mockRejectedValue(new Error('Component update failed'));

      await configIntegration.initialize();

      const configEvent = {
        type: 'config-changed',
        configType: 'sources',
        filePath: path.join(tempDir, 'sources.json'),
        newConfig: { sources: [] },
        hasChanges: true,
        isValid: true
      };

      // Should not throw error
      await expect(configIntegration.handleConfigChange(configEvent)).resolves.not.toThrow();

      // Component should have been called
      expect(mockComponent.updateConfig).toHaveBeenCalledTimes(1);
      expect(mockComponent.updateConfig.mock.calls[0][0]).toBe('sources');
      expect(mockComponent.updateConfig.mock.calls[0][1]).toEqual({ sources: [] });
    });

    it('should handle invalid configuration events', async () => {
      await configIntegration.initialize();

      const invalidEvent = {
        type: 'config-changed',
        configType: 'sources',
        filePath: path.join(tempDir, 'sources.json'),
        newConfig: { sources: [] },
        hasChanges: true,
        isValid: false,
        validationError: 'Invalid configuration'
      };

      // Should still call component update (handleConfigChange doesn't check isValid)
      await configIntegration.handleConfigChange(invalidEvent);

      expect(mockComponent.updateConfig).toHaveBeenCalledTimes(1);
      expect(mockComponent.updateConfig.mock.calls[0][0]).toBe('sources');
      expect(mockComponent.updateConfig.mock.calls[0][1]).toEqual({ sources: [] });
    });
  });
});
