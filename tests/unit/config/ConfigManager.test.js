const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const ConfigManager = require('../../../src/config/ConfigManager');

describe('ConfigManager', () => {
  let configManager;
  let tempDir;
  let mockLogger;

  beforeEach(async () => {
    // Create temporary directory for tests
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'config-test-'));
    
    // Mock logger
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    };
    
    // Mock the logger module
    jest.doMock('../../../src/utils/logger', () => mockLogger);
    
    configManager = new ConfigManager({
      configDir: tempDir,
      watchOptions: { ignoreInitial: true }
    });
  });

  afterEach(async () => {
    if (configManager && configManager.isWatching) {
      await configManager.stopWatching();
    }
    
    // Force cleanup
    if (configManager && configManager.watcher) {
      try {
        configManager.watcher.removeAllListeners();
        await configManager.watcher.close();
      } catch (error) {
        // Ignore cleanup errors
      }
      configManager.watcher = null;
      configManager.isWatching = false;
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
  });

  describe('constructor', () => {
    it('should initialize with default options', () => {
      const manager = new ConfigManager();
      
      expect(manager.configDir).toBe(path.join(process.cwd(), 'config'));
      expect(manager.configs).toBeInstanceOf(Map);
      expect(manager.validators).toBeInstanceOf(Map);
      expect(manager.isWatching).toBe(false);
    });

    it('should initialize with custom options', () => {
      const customDir = '/custom/config';
      const manager = new ConfigManager({
        configDir: customDir,
        watchOptions: { depth: 1 }
      });
      
      expect(manager.configDir).toBe(customDir);
      expect(manager.watchOptions.depth).toBe(1);
    });

    it('should register default validators', () => {
      expect(configManager.validators.has('sources')).toBe(true);
      expect(configManager.validators.has('ingestion')).toBe(true);
      expect(configManager.validators.has('queue')).toBe(true);
    });
  });

  describe('validator registration', () => {
    it('should register a new validator', () => {
      const schema = { validate: jest.fn() };
      configManager.registerValidator('test', schema);
      
      expect(configManager.validators.get('test')).toBe(schema);
    });

    it('should throw error for invalid validator registration', () => {
      expect(() => {
        configManager.registerValidator();
      }).toThrow('Config type and schema are required');
      
      expect(() => {
        configManager.registerValidator('test');
      }).toThrow('Config type and schema are required');
    });
  });

  describe('configuration file handling', () => {
    it('should read JSON configuration file', async () => {
      const configPath = path.join(tempDir, 'test.json');
      const configData = { key: 'value' };
      
      await fs.writeFile(configPath, JSON.stringify(configData));
      
      const result = await configManager.readConfigFile(configPath);
      expect(result).toEqual(configData);
    });

    it('should read JavaScript configuration file', async () => {
      const configPath = path.join(tempDir, 'test.js');
      const configData = 'module.exports = { key: "value" };';
      
      await fs.writeFile(configPath, configData);
      
      const result = await configManager.readConfigFile(configPath);
      expect(result).toEqual({ key: 'value' });
    });

    it('should return null for non-existent file', async () => {
      const configPath = path.join(tempDir, 'nonexistent.json');
      
      const result = await configManager.readConfigFile(configPath);
      expect(result).toBeNull();
    });

    it('should throw error for invalid JSON', async () => {
      const configPath = path.join(tempDir, 'invalid.json');
      
      await fs.writeFile(configPath, '{ invalid json }');
      
      await expect(configManager.readConfigFile(configPath)).rejects.toThrow();
    });
  });

  describe('configuration type detection', () => {
    it('should detect sources configuration', () => {
      expect(configManager.getConfigTypeFromPath('/path/sources.json')).toBe('sources');
      expect(configManager.getConfigTypeFromPath('/path/sources-config.js')).toBe('sources');
    });

    it('should detect ingestion configuration', () => {
      expect(configManager.getConfigTypeFromPath('/path/ingestion.json')).toBe('ingestion');
      expect(configManager.getConfigTypeFromPath('/path/ingestion-settings.js')).toBe('ingestion');
    });

    it('should detect queue configuration', () => {
      expect(configManager.getConfigTypeFromPath('/path/queue.json')).toBe('queue');
      expect(configManager.getConfigTypeFromPath('/path/queue-config.js')).toBe('queue');
    });

    it('should return null for unknown configuration type', () => {
      expect(configManager.getConfigTypeFromPath('/path/unknown.json')).toBeNull();
      expect(configManager.getConfigTypeFromPath('/path/random-file.txt')).toBeNull();
    });
  });

  describe('configuration validation', () => {
    it('should validate sources configuration', async () => {
      const validConfig = {
        sources: [
          {
            id: 'test-source',
            type: 'static',
            name: 'Test Source',
            enabled: true,
            config: { path: '/test' }
          }
        ]
      };
      
      const result = await configManager.validateConfig('sources', validConfig);
      expect(result).toEqual(expect.objectContaining(validConfig));
    });

    it('should validate ingestion configuration', async () => {
      const validConfig = {
        batchSize: 50,
        maxRetries: 2,
        timeout: 15000
      };
      
      const result = await configManager.validateConfig('ingestion', validConfig);
      expect(result.batchSize).toBe(50);
      expect(result.maxRetries).toBe(2);
      expect(result.timeout).toBe(15000);
    });

    it('should validate queue configuration', async () => {
      const validConfig = {
        redis: {
          host: 'redis-server',
          port: 6380
        },
        queues: {
          concurrency: 10
        }
      };
      
      const result = await configManager.validateConfig('queue', validConfig);
      expect(result.redis.host).toBe('redis-server');
      expect(result.redis.port).toBe(6380);
      expect(result.queues.concurrency).toBe(10);
    });

    it('should reject invalid sources configuration', async () => {
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
      
      await expect(configManager.validateConfig('sources', invalidConfig))
        .rejects.toThrow('Configuration validation failed');
    });

    it('should handle missing validator gracefully', async () => {
      const config = { key: 'value' };
      
      const result = await configManager.validateConfig('unknown', config);
      expect(result).toEqual(config);
    });
  });

  describe('configuration loading', () => {
    it('should load and validate configuration file', async () => {
      const configPath = path.join(tempDir, 'sources.json');
      const configData = {
        sources: [
          {
            id: 'test-source',
            type: 'static',
            name: 'Test Source',
            enabled: true,
            config: { path: '/test' }
          }
        ]
      };
      
      await fs.writeFile(configPath, JSON.stringify(configData));
      
      await configManager.loadConfig(configPath);
      
      const loadedConfig = configManager.getConfig('sources');
      expect(loadedConfig).toEqual(expect.objectContaining(configData));
    });

    it('should emit config-changed event when loading', async () => {
      const configPath = path.join(tempDir, 'ingestion.json');
      const configData = { batchSize: 75 };
      
      await fs.writeFile(configPath, JSON.stringify(configData));
      
      const changeHandler = jest.fn();
      configManager.on('config-changed', changeHandler);
      
      await configManager.loadConfig(configPath);
      
      expect(changeHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          configType: 'ingestion',
          newConfig: expect.objectContaining(configData),
          filePath: configPath
        })
      );
    });
  });

  describe('file watching', () => {
    it('should start and stop watching', async () => {
      await configManager.startWatching();
      expect(configManager.isWatching).toBe(true);
      
      await configManager.stopWatching();
      expect(configManager.isWatching).toBe(false);
    });

    it('should not start watching if already watching', async () => {
      await configManager.startWatching();
      
      // Try to start again
      await configManager.startWatching();
      
      expect(mockLogger.warn).toHaveBeenCalledWith('ConfigManager is already watching');
    });

    it('should handle file changes', async () => {
      const changeHandler = jest.fn();
      configManager.on('config-changed', changeHandler);
      
      await configManager.startWatching();
      
      // Wait for watcher to be ready
      await new Promise(resolve => {
        configManager.on('ready', resolve);
      });
      
      // Create a configuration file
      const configPath = path.join(tempDir, 'sources.json');
      const configData = {
        sources: [
          {
            id: 'test-source',
            type: 'static',
            name: 'Test Source',
            enabled: true,
            config: { path: '/test' }
          }
        ]
      };
      
      await fs.writeFile(configPath, JSON.stringify(configData));
      
      // Wait for file change to be processed
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(changeHandler).toHaveBeenCalled();
    });
  });

  describe('configuration management', () => {
    beforeEach(async () => {
      // Set up some test configurations
      configManager.configs.set('sources', { sources: [] });
      configManager.configs.set('ingestion', { batchSize: 100 });
    });

    it('should get specific configuration', () => {
      const sourcesConfig = configManager.getConfig('sources');
      expect(sourcesConfig).toEqual({ sources: [] });
    });

    it('should get all configurations', () => {
      const allConfigs = configManager.getAllConfigs();
      expect(allConfigs).toEqual({
        sources: { sources: [] },
        ingestion: { batchSize: 100 }
      });
    });

    it('should return undefined for non-existent configuration', () => {
      const config = configManager.getConfig('nonexistent');
      expect(config).toBeUndefined();
    });
  });

  describe('statistics', () => {
    it('should return configuration statistics', () => {
      configManager.configs.set('sources', { sources: [] });
      configManager.configs.set('ingestion', { batchSize: 100 });
      
      const stats = configManager.getStats();
      
      expect(stats).toEqual({
        isWatching: false,
        configDir: tempDir,
        configCount: 2,
        validatorCount: 3, // Default validators
        configTypes: ['sources', 'ingestion']
      });
    });
  });

  describe('error handling', () => {
    it('should handle watcher errors', () => {
      const errorHandler = jest.fn();
      configManager.on('error', errorHandler);
      
      const testError = new Error('Test watcher error');
      configManager.handleWatcherError(testError);
      
      expect(errorHandler).toHaveBeenCalledWith({
        type: 'watcher-error',
        error: testError
      });
    });

    it('should handle configuration change errors', async () => {
      const errorHandler = jest.fn();
      configManager.on('error', errorHandler);
      
      // Mock validation to throw error
      const mockValidator = {
        validate: jest.fn().mockReturnValue({
          error: new Error('Validation failed')
        })
      };
      configManager.registerValidator('test', mockValidator);
      
      await configManager.handleFileChange('change', path.join(tempDir, 'test.json'));
      
      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'config-change-error'
        })
      );
    });
  });

  describe('directory management', () => {
    it('should create config directory if it does not exist', async () => {
      const newTempDir = path.join(tempDir, 'new-config-dir');
      const manager = new ConfigManager({ configDir: newTempDir });
      
      await manager.ensureConfigDirectory();
      
      const stats = await fs.stat(newTempDir);
      expect(stats.isDirectory()).toBe(true);
    });

    it('should not fail if config directory already exists', async () => {
      await expect(configManager.ensureConfigDirectory()).resolves.not.toThrow();
    });
  });
});