const ConfigManager = require('../../../src/config/ConfigManager');

// Mock ConfigManager
jest.mock('../../../src/config/ConfigManager');

// Mock logger before requiring ConfigIntegration
jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

const ConfigIntegration = require('../../../src/config/ConfigIntegration');
const logger = require('../../../src/utils/logger');

describe('ConfigIntegration', () => {
  let configIntegration;
  let mockConfigManager;

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();
    
    // Create mock ConfigManager instance
    mockConfigManager = {
      on: jest.fn(),
      removeListener: jest.fn(),
      startWatching: jest.fn().mockResolvedValue(),
      stopWatching: jest.fn().mockResolvedValue(),
      getConfig: jest.fn(),
      getAllConfigs: jest.fn(),
      loadConfig: jest.fn().mockResolvedValue(),
      validateConfig: jest.fn().mockResolvedValue()
    };
    
    ConfigManager.mockImplementation(() => mockConfigManager);
    
    configIntegration = new ConfigIntegration();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with default options', () => {
      expect(configIntegration.components).toBeInstanceOf(Map);
      expect(configIntegration.isInitialized).toBe(false);
      expect(ConfigManager).toHaveBeenCalledWith({});
    });

    it('should initialize with custom options', () => {
      const options = {
        configDir: '/custom/path'
      };
      
      new ConfigIntegration(options);
      
      expect(ConfigManager).toHaveBeenCalledWith(options);
    });

    it('should use provided configManager instance', () => {
      const mockConfigManager = {
        startWatching: jest.fn(),
        stopWatching: jest.fn(),
        on: jest.fn(),
        off: jest.fn()
      };
      
      const options = {
        configManager: mockConfigManager
      };
      
      const integration = new ConfigIntegration(options);
      
      expect(integration.configManager).toBe(mockConfigManager);
      expect(ConfigManager).not.toHaveBeenCalledWith(mockConfigManager);
    });
  });

  describe('initialization', () => {
    it('should initialize successfully', async () => {
      await configIntegration.initialize();
      
      expect(mockConfigManager.on).toHaveBeenCalledWith('config-changed', expect.any(Function));
      expect(mockConfigManager.on).toHaveBeenCalledWith('config-removed', expect.any(Function));
      expect(mockConfigManager.on).toHaveBeenCalledWith('error', expect.any(Function));
      expect(mockConfigManager.startWatching).toHaveBeenCalled();
      expect(configIntegration.isInitialized).toBe(true);
    });

    it('should not initialize if already initialized', async () => {
      configIntegration.isInitialized = true;
      
      await configIntegration.initialize();
      
      expect(logger.warn).toHaveBeenCalledWith('ConfigIntegration is already initialized');
      expect(mockConfigManager.startWatching).not.toHaveBeenCalled();
    });

    it('should handle initialization errors', async () => {
      const error = new Error('Initialization failed');
      mockConfigManager.startWatching.mockRejectedValue(error);
      
      await expect(configIntegration.initialize()).rejects.toThrow('Initialization failed');
      expect(logger.error).toHaveBeenCalledWith('Failed to initialize ConfigIntegration', { error: error.message });
    });
  });

  describe('shutdown', () => {
    beforeEach(async () => {
      await configIntegration.initialize();
    });

    it('should shutdown successfully', async () => {
      await configIntegration.shutdown();
      
      expect(mockConfigManager.removeListener).toHaveBeenCalledWith('config-changed', expect.any(Function));
      expect(mockConfigManager.removeListener).toHaveBeenCalledWith('config-removed', expect.any(Function));
      expect(mockConfigManager.removeListener).toHaveBeenCalledWith('error', expect.any(Function));
      expect(mockConfigManager.stopWatching).toHaveBeenCalled();
      expect(configIntegration.isInitialized).toBe(false);
    });

    it('should not shutdown if not initialized', async () => {
      configIntegration.isInitialized = false;
      
      await configIntegration.shutdown();
      
      expect(mockConfigManager.stopWatching).not.toHaveBeenCalled();
    });

    it('should handle shutdown errors', async () => {
      const error = new Error('Shutdown failed');
      mockConfigManager.stopWatching.mockRejectedValue(error);
      
      await expect(configIntegration.shutdown()).rejects.toThrow('Shutdown failed');
      expect(logger.error).toHaveBeenCalledWith('Error during ConfigIntegration shutdown', { error: error.message });
    });
  });

  describe('component registration', () => {
    let mockComponent;

    beforeEach(() => {
      mockComponent = {
        updateConfig: jest.fn().mockResolvedValue(),
        handlesConfigType: jest.fn().mockReturnValue(true),
        handleConfigRemoval: jest.fn().mockResolvedValue()
      };
    });

    it('should register a component', () => {
      configIntegration.registerComponent('testComponent', mockComponent);
      
      expect(configIntegration.components.get('testComponent')).toBe(mockComponent);
    });

    it('should throw error for invalid component registration', () => {
      expect(() => {
        configIntegration.registerComponent();
      }).toThrow('Component name and instance are required');
      
      expect(() => {
        configIntegration.registerComponent('test');
      }).toThrow('Component name and instance are required');
      
      expect(() => {
        configIntegration.registerComponent('test', {});
      }).toThrow('Component must have an updateConfig method');
    });

    it('should unregister a component', () => {
      configIntegration.registerComponent('testComponent', mockComponent);
      configIntegration.unregisterComponent('testComponent');
      
      expect(configIntegration.components.has('testComponent')).toBe(false);
    });

    it('should handle unregistering non-existent component', () => {
      configIntegration.unregisterComponent('nonExistent');
      
      expect(configIntegration.components.has('nonExistent')).toBe(false);
    });
  });

  describe('configuration access', () => {
    it('should get specific configuration', () => {
      const mockConfig = { key: 'value' };
      mockConfigManager.getConfig.mockReturnValue(mockConfig);
      
      const result = configIntegration.getConfig('sources');
      
      expect(mockConfigManager.getConfig).toHaveBeenCalledWith('sources');
      expect(result).toBe(mockConfig);
    });

    it('should get all configurations', () => {
      const mockConfigs = { sources: {}, ingestion: {} };
      mockConfigManager.getAllConfigs.mockReturnValue(mockConfigs);
      
      const result = configIntegration.getAllConfigs();
      
      expect(mockConfigManager.getAllConfigs).toHaveBeenCalled();
      expect(result).toBe(mockConfigs);
    });
  });

  describe('configuration reloading', () => {
    it('should reload configuration successfully', async () => {
      const filePath = '/path/to/config.json';
      
      await configIntegration.reloadConfig(filePath);
      
      expect(mockConfigManager.loadConfig).toHaveBeenCalledWith(filePath);
      expect(logger.info).toHaveBeenCalledWith('Configuration reloaded successfully', { filePath });
    });

    it('should handle reload errors', async () => {
      const filePath = '/path/to/config.json';
      const error = new Error('Reload failed');
      mockConfigManager.loadConfig.mockRejectedValue(error);
      
      await expect(configIntegration.reloadConfig(filePath)).rejects.toThrow('Reload failed');
      expect(logger.error).toHaveBeenCalledWith('Failed to reload configuration', { filePath, error: error.message });
    });
  });

  describe('configuration change handling', () => {
    let mockComponent;

    beforeEach(() => {
      mockComponent = {
        updateConfig: jest.fn().mockResolvedValue(),
        handlesConfigType: jest.fn().mockReturnValue(true)
      };
      
      configIntegration.registerComponent('testComponent', mockComponent);
    });

    it('should handle configuration changes', async () => {
      const event = {
        configType: 'sources',
        newConfig: { sources: [] },
        previousConfig: null,
        filePath: '/path/to/sources.json'
      };
      
      await configIntegration.handleConfigChange(event);
      
      expect(mockComponent.updateConfig).toHaveBeenCalledWith(
        'sources',
        { sources: [] },
        null
      );
    });

    it('should handle component update errors with rollback', async () => {
      const event = {
        configType: 'sources',
        newConfig: { sources: [] },
        previousConfig: { sources: [{ id: 'old' }] },
        filePath: '/path/to/sources.json'
      };
      
      mockComponent.updateConfig
        .mockRejectedValueOnce(new Error('Update failed'))
        .mockResolvedValueOnce(); // Rollback succeeds
      
      await configIntegration.handleConfigChange(event);
      
      expect(mockComponent.updateConfig).toHaveBeenCalledTimes(2);
      expect(logger.info).toHaveBeenCalledWith('Configuration rollback successful', { configType: 'sources' });
    });

    it('should handle rollback failure', async () => {
      const event = {
        configType: 'sources',
        newConfig: { sources: [] },
        previousConfig: { sources: [{ id: 'old' }] },
        filePath: '/path/to/sources.json'
      };
      
      mockComponent.updateConfig
        .mockRejectedValueOnce(new Error('Update failed'))
        .mockRejectedValueOnce(new Error('Rollback failed'));
      
      await configIntegration.handleConfigChange(event);
      
      expect(logger.error).toHaveBeenCalledWith('Configuration rollback failed', {
        configType: 'sources',
        error: 'Rollback failed'
      });
    });
  });

  describe('configuration removal handling', () => {
    let mockComponent;

    beforeEach(() => {
      mockComponent = {
        updateConfig: jest.fn().mockResolvedValue(),
        handlesConfigType: jest.fn().mockReturnValue(true),
        handleConfigRemoval: jest.fn().mockResolvedValue()
      };
      
      configIntegration.registerComponent('testComponent', mockComponent);
    });

    it('should handle configuration removal', async () => {
      const event = {
        configType: 'sources',
        previousConfig: { sources: [] },
        filePath: '/path/to/sources.json'
      };
      
      await configIntegration.handleConfigRemoval(event);
      
      expect(mockComponent.handleConfigRemoval).toHaveBeenCalledWith('sources', { sources: [] });
    });

    it('should handle components without handleConfigRemoval method', async () => {
      const componentWithoutRemoval = {
        updateConfig: jest.fn().mockResolvedValue(),
        handlesConfigType: jest.fn().mockReturnValue(true)
      };
      
      configIntegration.registerComponent('simpleComponent', componentWithoutRemoval);
      
      const event = {
        configType: 'sources',
        previousConfig: { sources: [] },
        filePath: '/path/to/sources.json'
      };
      
      await expect(configIntegration.handleConfigRemoval(event)).resolves.not.toThrow();
    });
  });

  describe('component filtering', () => {
    it('should get applicable components with handlesConfigType method', () => {
      const component1 = {
        updateConfig: jest.fn(),
        handlesConfigType: jest.fn().mockReturnValue(true)
      };
      
      const component2 = {
        updateConfig: jest.fn(),
        handlesConfigType: jest.fn().mockReturnValue(false)
      };
      
      configIntegration.registerComponent('component1', component1);
      configIntegration.registerComponent('component2', component2);
      
      const applicable = configIntegration.getApplicableComponents('sources');
      
      expect(applicable).toHaveLength(1);
      expect(applicable[0].name).toBe('component1');
    });

    it('should include all components without handlesConfigType method', () => {
      const component1 = {
        updateConfig: jest.fn()
      };
      
      const component2 = {
        updateConfig: jest.fn()
      };
      
      configIntegration.registerComponent('component1', component1);
      configIntegration.registerComponent('component2', component2);
      
      const applicable = configIntegration.getApplicableComponents('sources');
      
      expect(applicable).toHaveLength(2);
    });
  });

  describe('configuration validation', () => {
    it('should validate all configurations', async () => {
      const mockConfigs = {
        sources: { sources: [] },
        ingestion: { batchSize: 100 }
      };
      
      mockConfigManager.getAllConfigs.mockReturnValue(mockConfigs);
      mockConfigManager.validateConfig
        .mockResolvedValueOnce({ sources: [] })
        .mockRejectedValueOnce(new Error('Validation failed'));
      
      const results = await configIntegration.validateAllConfigs();
      
      expect(results).toEqual({
        sources: { valid: true },
        ingestion: { 
          valid: false, 
          error: 'Validation failed',
          details: undefined
        }
      });
    });
  });

  describe('statistics', () => {
    it('should return integration statistics', () => {
      const mockStats = {
        isWatching: true,
        configDir: '/config',
        configCount: 2,
        validatorCount: 3,
        configTypes: ['sources', 'ingestion']
      };
      
      mockConfigManager.getStats = jest.fn().mockReturnValue(mockStats);
      
      configIntegration.registerComponent('component1', { updateConfig: jest.fn() });
      configIntegration.registerComponent('component2', { updateConfig: jest.fn() });
      configIntegration.isInitialized = true;
      
      const stats = configIntegration.getStats();
      
      expect(stats).toEqual({
        isInitialized: true,
        componentCount: 2,
        registeredComponents: ['component1', 'component2'],
        configManager: mockStats
      });
    });
  });

  describe('error handling', () => {
    it('should handle configuration errors', () => {
      const event = {
        type: 'config-change-error',
        error: new Error('Test error'),
        filePath: '/path/to/config.json'
      };
      
      configIntegration.handleConfigError(event);
      
      expect(logger.error).toHaveBeenCalledWith('Configuration error occurred', {
        type: 'config-change-error',
        filePath: '/path/to/config.json',
        error: 'Test error'
      });
    });

    it('should emit integration-error event when listeners exist', () => {
      const event = {
        type: 'config-change-error',
        error: new Error('Test error')
      };
      
      mockConfigManager.listenerCount = jest.fn().mockReturnValue(1);
      mockConfigManager.emit = jest.fn();
      
      configIntegration.handleConfigError(event);
      
      expect(mockConfigManager.emit).toHaveBeenCalledWith('integration-error', event);
    });
  });
});