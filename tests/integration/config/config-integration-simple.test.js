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
            },
            schedule: {
              enabled: false
            }
          }
        ]
      };

      const configPath = path.join(tempDir, 'sources.json');
      await fs.writeFile(configPath, JSON.stringify(sourcesConfig, null, 2));

      // Load configuration
      const result = await configManager.loadConfigFile(configPath);
      
      expect(result).toBeDefined();
      expect(result.configType).toBe('sources');
      expect(result.config).toEqual(sourcesConfig);
      expect(result.isValid).toBe(true);
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
      const result = await configManager.loadConfigFile(configPath);
      
      expect(result).toBeDefined();
      expect(result.configType).toBe('sources');
      expect(result.isValid).toBe(false);
      expect(result.validationError).toBeDefined();
    });
  });

  describe('Component Integration', () => {
    it('should register and manage components', async () => {
      await configIntegration.initialize();

      // Verify component is registered
      const components = configIntegration.getRegisteredComponents();
      expect(components).toHaveLength(1);
      expect(components[0]).toBe('testComponent');

      // Test component filtering
      const sourcesComponents = configIntegration.getComponentsForConfigType('sources');
      expect(sourcesComponents).toHaveLength(1);
      expect(sourcesComponents[0]).toBe('testComponent');

      const otherComponents = configIntegration.getComponentsForConfigType('queue');
      expect(otherComponents).toHaveLength(0);
    });

    it('should apply configuration changes to components', async () => {
      await configIntegration.initialize();

      // Create configuration change event
      const configEvent = {
        type: 'config-changed',
        configType: 'sources',
        filePath: path.join(tempDir, 'sources.json'),
        config: {
          sources: [
            {
              id: 'new-source',
              type: 'static',
              name: 'New Source',
              enabled: true,
              config: {
                basePath: '/new/path',
                fileTypes: ['txt']
              },
              schedule: {
                enabled: false
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
      expect(mockComponent.updateConfig).toHaveBeenCalledWith(
        'sources',
        configEvent.config
      );
    });
  });

  describe('Configuration Management', () => {
    it('should manage configuration state', async () => {
      await configIntegration.initialize();

      // Initially no configurations
      expect(configIntegration.getConfig('sources')).toBeUndefined();
      expect(configIntegration.getAllConfigs()).toEqual({});

      // Add configuration
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
            },
            schedule: {
              enabled: false
            }
          }
        ]
      };

      configManager.configs.set('sources', sourcesConfig);

      // Verify configuration is accessible
      expect(configIntegration.getConfig('sources')).toEqual(sourcesConfig);
      
      const allConfigs = configIntegration.getAllConfigs();
      expect(allConfigs.sources).toEqual(sourcesConfig);
    });

    it('should provide configuration statistics', async () => {
      await configIntegration.initialize();

      const stats = configIntegration.getStats();
      
      expect(stats).toHaveProperty('configCount');
      expect(stats).toHaveProperty('componentCount');
      expect(stats).toHaveProperty('isWatching');
      expect(stats).toHaveProperty('lastUpdate');
      
      expect(typeof stats.configCount).toBe('number');
      expect(typeof stats.componentCount).toBe('number');
      expect(typeof stats.isWatching).toBe('boolean');
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
        config: { sources: [] },
        hasChanges: true,
        isValid: true
      };

      // Should not throw error
      await expect(configIntegration.handleConfigChange(configEvent)).resolves.not.toThrow();

      // Component should have been called
      expect(mockComponent.updateConfig).toHaveBeenCalled();
    });

    it('should handle invalid configuration events', async () => {
      await configIntegration.initialize();

      const invalidEvent = {
        type: 'config-changed',
        configType: 'sources',
        filePath: path.join(tempDir, 'sources.json'),
        config: { sources: [] },
        hasChanges: true,
        isValid: false,
        validationError: 'Invalid configuration'
      };

      // Should not call component update for invalid config
      await configIntegration.handleConfigChange(invalidEvent);

      expect(mockComponent.updateConfig).not.toHaveBeenCalled();
    });
  });
});
