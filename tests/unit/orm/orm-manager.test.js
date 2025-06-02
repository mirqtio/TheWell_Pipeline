/**
 * Unit tests for ORM Manager
 */

const { ORMManager, getORM, initializeORM, closeORM } = require('../../../src/orm');

// Mock the SequelizeORM class
jest.mock('../../../src/orm/sequelize', () => {
  return jest.fn().mockImplementation(() => ({
    initialize: jest.fn().mockResolvedValue(true),
    getModel: jest.fn(),
    getModels: jest.fn().mockReturnValue({}),
    getSequelize: jest.fn().mockReturnValue({ authenticate: jest.fn().mockResolvedValue() }),
    isReady: jest.fn().mockReturnValue(true),
    transaction: jest.fn(),
    query: jest.fn(),
    sync: jest.fn(),
    close: jest.fn().mockResolvedValue()
  }));
});

// Mock logger
jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
}));

describe('ORMManager', () => {
  let ormManager;
  let mockSequelizeORM;

  beforeEach(() => {
    jest.clearAllMocks();
    ormManager = new ORMManager();
    mockSequelizeORM = ormManager.orm;
  });

  afterEach(async () => {
    if (ormManager.isInitialized) {
      await ormManager.close();
    }
  });

  describe('constructor', () => {
    it('should create ORM manager with default config', () => {
      expect(ormManager).toBeInstanceOf(ORMManager);
      expect(ormManager.isInitialized).toBe(false);
      expect(ormManager.orm).toBeDefined();
    });

    it('should create ORM manager with custom config', () => {
      const config = { host: 'localhost', port: 5432 };
      const manager = new ORMManager(config);
      expect(manager).toBeInstanceOf(ORMManager);
    });
  });

  describe('initialize', () => {
    it('should initialize ORM successfully', async () => {
      const result = await ormManager.initialize();
      
      expect(result).toBe(true);
      expect(ormManager.isInitialized).toBe(true);
      expect(mockSequelizeORM.initialize).toHaveBeenCalledTimes(1);
    });

    it('should handle initialization errors', async () => {
      const error = new Error('Initialization failed');
      mockSequelizeORM.initialize.mockRejectedValueOnce(error);

      await expect(ormManager.initialize()).rejects.toThrow('Initialization failed');
      expect(ormManager.isInitialized).toBe(false);
    });
  });

  describe('getModel', () => {
    it('should get model when initialized', async () => {
      await ormManager.initialize();
      const mockModel = { name: 'TestModel' };
      mockSequelizeORM.getModel.mockReturnValue(mockModel);

      const result = ormManager.getModel('TestModel');
      
      expect(result).toBe(mockModel);
      expect(mockSequelizeORM.getModel).toHaveBeenCalledWith('TestModel');
    });

    it('should throw error when not initialized', () => {
      expect(() => ormManager.getModel('TestModel')).toThrow('ORM Manager not initialized');
    });
  });

  describe('getModels', () => {
    it('should get all models when initialized', async () => {
      await ormManager.initialize();
      const mockModels = { Source: {}, Document: {} };
      mockSequelizeORM.getModels.mockReturnValue(mockModels);

      const result = ormManager.getModels();
      
      expect(result).toBe(mockModels);
      expect(mockSequelizeORM.getModels).toHaveBeenCalledTimes(1);
    });

    it('should throw error when not initialized', () => {
      expect(() => ormManager.getModels()).toThrow('ORM Manager not initialized');
    });
  });

  describe('getSequelize', () => {
    it('should get Sequelize instance when initialized', async () => {
      await ormManager.initialize();
      const mockSequelize = { authenticate: jest.fn() };
      mockSequelizeORM.getSequelize.mockReturnValue(mockSequelize);

      const result = ormManager.getSequelize();
      
      expect(result).toBe(mockSequelize);
      expect(mockSequelizeORM.getSequelize).toHaveBeenCalledTimes(1);
    });

    it('should throw error when not initialized', () => {
      expect(() => ormManager.getSequelize()).toThrow('ORM Manager not initialized');
    });
  });

  describe('isReady', () => {
    it('should return true when initialized and ready', async () => {
      await ormManager.initialize();
      mockSequelizeORM.isReady.mockReturnValue(true);

      const result = ormManager.isReady();
      
      expect(result).toBe(true);
    });

    it('should return false when not initialized', () => {
      const result = ormManager.isReady();
      
      expect(result).toBe(false);
    });
  });

  describe('transaction', () => {
    it('should execute transaction when initialized', async () => {
      await ormManager.initialize();
      const callback = jest.fn();
      const mockResult = { success: true };
      mockSequelizeORM.transaction.mockResolvedValue(mockResult);

      const result = await ormManager.transaction(callback);
      
      expect(result).toBe(mockResult);
      expect(mockSequelizeORM.transaction).toHaveBeenCalledWith(callback);
    });

    it('should throw error when not initialized', async () => {
      const callback = jest.fn();
      
      await expect(ormManager.transaction(callback)).rejects.toThrow('ORM Manager not initialized');
    });
  });

  describe('query', () => {
    it('should execute query when initialized', async () => {
      await ormManager.initialize();
      const sql = 'SELECT * FROM sources';
      const options = { type: 'SELECT' };
      const mockResult = [{ id: 1 }];
      mockSequelizeORM.query.mockResolvedValue(mockResult);

      const result = await ormManager.query(sql, options);
      
      expect(result).toBe(mockResult);
      expect(mockSequelizeORM.query).toHaveBeenCalledWith(sql, options);
    });

    it('should execute query with default options', async () => {
      await ormManager.initialize();
      const sql = 'SELECT * FROM sources';
      mockSequelizeORM.query.mockResolvedValue([]);

      await ormManager.query(sql);
      
      expect(mockSequelizeORM.query).toHaveBeenCalledWith(sql, {});
    });

    it('should throw error when not initialized', async () => {
      const sql = 'SELECT * FROM sources';
      
      await expect(ormManager.query(sql)).rejects.toThrow('ORM Manager not initialized');
    });
  });

  describe('sync', () => {
    it('should sync models when initialized', async () => {
      await ormManager.initialize();
      const options = { force: false };
      const mockResult = { success: true };
      mockSequelizeORM.sync.mockResolvedValue(mockResult);

      const result = await ormManager.sync(options);
      
      expect(result).toBe(mockResult);
      expect(mockSequelizeORM.sync).toHaveBeenCalledWith(options);
    });

    it('should sync with default options', async () => {
      await ormManager.initialize();
      mockSequelizeORM.sync.mockResolvedValue({});

      await ormManager.sync();
      
      expect(mockSequelizeORM.sync).toHaveBeenCalledWith({});
    });

    it('should throw error when not initialized', async () => {
      await expect(ormManager.sync()).rejects.toThrow('ORM Manager not initialized');
    });
  });

  describe('close', () => {
    it('should close ORM when initialized', async () => {
      await ormManager.initialize();
      
      await ormManager.close();
      
      expect(ormManager.isInitialized).toBe(false);
      expect(mockSequelizeORM.close).toHaveBeenCalledTimes(1);
    });

    it('should handle close when not initialized', async () => {
      await ormManager.close();
      
      expect(mockSequelizeORM.close).not.toHaveBeenCalled();
    });
  });

  describe('healthCheck', () => {
    it('should return healthy status when initialized and connected', async () => {
      await ormManager.initialize();
      mockSequelizeORM.getModels.mockReturnValue({ Source: {}, Document: {} });
      mockSequelizeORM.isReady.mockReturnValue(true);

      const result = await ormManager.healthCheck();
      
      expect(result).toEqual({
        status: 'healthy',
        message: 'ORM connection is active',
        models: 2,
        connected: true
      });
    });

    it('should return error status when not initialized', async () => {
      const result = await ormManager.healthCheck();
      
      expect(result).toEqual({
        status: 'error',
        message: 'ORM not initialized'
      });
    });

    it('should return error status when authentication fails', async () => {
      await ormManager.initialize();
      const error = new Error('Connection failed');
      mockSequelizeORM.getSequelize.mockReturnValue({
        authenticate: jest.fn().mockRejectedValue(error)
      });

      const result = await ormManager.healthCheck();
      
      expect(result).toEqual({
        status: 'error',
        message: 'Connection failed',
        connected: false
      });
    });
  });
});

describe('ORM Module Functions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset singleton
    require('../../../src/orm').closeORM();
  });

  afterEach(async () => {
    await closeORM();
  });

  describe('getORM', () => {
    it('should create singleton ORM instance', () => {
      const orm1 = getORM();
      const orm2 = getORM();
      
      expect(orm1).toBe(orm2);
      expect(orm1).toBeInstanceOf(ORMManager);
    });

    it('should create ORM with config', () => {
      const config = { host: 'localhost' };
      const orm = getORM(config);
      
      expect(orm).toBeInstanceOf(ORMManager);
    });
  });

  describe('initializeORM', () => {
    it('should initialize ORM and return instance', async () => {
      const orm = await initializeORM();
      
      expect(orm).toBeInstanceOf(ORMManager);
      expect(orm.isInitialized).toBe(true);
    });

    it('should initialize ORM with config', async () => {
      const config = { host: 'localhost' };
      const orm = await initializeORM(config);
      
      expect(orm).toBeInstanceOf(ORMManager);
      expect(orm.isInitialized).toBe(true);
    });
  });

  describe('closeORM', () => {
    it('should close ORM instance', async () => {
      const orm = await initializeORM();
      expect(orm.isInitialized).toBe(true);
      
      await closeORM();
      
      expect(orm.isInitialized).toBe(false);
    });

    it('should handle close when no instance exists', async () => {
      await expect(closeORM()).resolves.not.toThrow();
    });
  });
});
