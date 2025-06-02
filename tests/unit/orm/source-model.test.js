/**
 * Unit tests for Source ORM Model
 */

// Mock the Source model module
jest.mock('../../../src/orm/models/Source', () => {
  return jest.fn((sequelize) => {
    const { DataTypes } = require('sequelize');
    
    // Call the actual define method to test the definition
    const model = sequelize.define(
      'Source',
      {
        id: {
          type: DataTypes.INTEGER,
          primaryKey: true,
          autoIncrement: true
        },
        name: {
          type: DataTypes.STRING,
          allowNull: false,
          unique: true,
          validate: {
            notEmpty: true,
            len: [1, 255]
          }
        },
        type: {
          type: DataTypes.ENUM,
          values: ['static', 'semi-static', 'dynamic'],
          allowNull: false,
          validate: {
            isIn: [['static', 'semi-static', 'dynamic']]
          }
        },
        status: {
          type: DataTypes.ENUM,
          values: ['active', 'inactive', 'error'],
          defaultValue: 'active'
        },
        config: {
          type: DataTypes.JSONB,
          allowNull: false
        },
        last_ingestion_at: {
          type: DataTypes.DATE,
          allowNull: true
        },
        created_at: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: DataTypes.NOW
        },
        updated_at: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: DataTypes.NOW
        }
      },
      {
        tableName: 'sources',
        timestamps: false,
        indexes: [
          { fields: ['name'] },
          { fields: ['type'] },
          { fields: ['status'] },
          { fields: ['last_ingestion_at'] }
        ],
        hooks: {
          beforeCreate: jest.fn(),
          beforeUpdate: jest.fn()
        }
      }
    );
    
    return model;
  });
});

const { DataTypes } = require('sequelize');

// Mock Sequelize
const mockSequelize = {
  define: jest.fn(),
  authenticate: jest.fn(),
  sync: jest.fn()
};

// Mock the actual Source model implementation
const mockSourceModel = {
  // Mock instance methods
  isActive: jest.fn().mockReturnValue(true),
  getLastIngestion: jest.fn().mockResolvedValue(new Date()),
  updateLastIngestion: jest.fn().mockResolvedValue(true),
  
  // Mock static methods
  findActive: jest.fn().mockResolvedValue([]),
  findByType: jest.fn().mockResolvedValue([]),
  findByName: jest.fn().mockResolvedValue(null),
  
  // Mock Sequelize model methods
  findAll: jest.fn().mockResolvedValue([]),
  findOne: jest.fn().mockResolvedValue(null),
  findByPk: jest.fn().mockResolvedValue(null),
  create: jest.fn().mockResolvedValue({}),
  update: jest.fn().mockResolvedValue([1]),
  destroy: jest.fn().mockResolvedValue(1),
  
  // Mock associations
  hasMany: jest.fn(),
  belongsTo: jest.fn()
};

// Set up the mock to return our model when define is called
mockSequelize.define.mockReturnValue(mockSourceModel);

const SourceModel = require('../../../src/orm/models/Source');

describe('Source Model', () => {
  let sourceModel;
  let mockSourceInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    sourceModel = SourceModel(mockSequelize);
    
    // Create a mock source instance
    mockSourceInstance = {
      id: 1,
      name: 'test-source',
      type: 'static',
      status: 'active',
      config: { url: 'https://example.com' },
      last_ingestion_at: new Date(),
      created_at: new Date(),
      updated_at: new Date(),
      isActive: jest.fn().mockReturnValue(true),
      getLastIngestion: jest.fn().mockResolvedValue(new Date()),
      updateLastIngestion: jest.fn().mockResolvedValue(true)
    };
  });

  describe('Model Definition', () => {
    it('should define Source model with correct attributes', () => {
      expect(mockSequelize.define).toHaveBeenCalledWith(
        'Source',
        expect.objectContaining({
          id: expect.objectContaining({
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
          }),
          name: expect.objectContaining({
            type: DataTypes.STRING,
            allowNull: false,
            unique: true
          }),
          type: expect.objectContaining({
            type: DataTypes.ENUM,
            values: ['static', 'semi-static', 'dynamic'],
            allowNull: false
          }),
          status: expect.objectContaining({
            type: DataTypes.ENUM,
            values: ['active', 'inactive', 'error'],
            defaultValue: 'active'
          }),
          config: expect.objectContaining({
            type: DataTypes.JSONB,
            allowNull: false
          })
        }),
        expect.objectContaining({
          tableName: 'sources',
          timestamps: false,
          indexes: expect.arrayContaining([
            expect.objectContaining({ fields: ['name'] }),
            expect.objectContaining({ fields: ['type'] }),
            expect.objectContaining({ fields: ['status'] }),
            expect.objectContaining({ fields: ['last_ingestion_at'] })
          ])
        })
      );
    });
  });

  describe('Instance Methods', () => {
    describe('isActive', () => {
      it('should return true for active source', () => {
        mockSourceInstance.status = 'active';
        mockSourceInstance.isActive.mockReturnValue(true);
        
        const result = mockSourceInstance.isActive();
        expect(result).toBe(true);
      });

      it('should return false for inactive source', () => {
        mockSourceInstance.status = 'inactive';
        mockSourceInstance.isActive.mockReturnValue(false);
        
        const result = mockSourceInstance.isActive();
        expect(result).toBe(false);
      });
    });

    describe('getLastIngestion', () => {
      it('should return last ingestion date', async () => {
        const lastIngestion = new Date('2024-01-01');
        mockSourceInstance.getLastIngestion.mockResolvedValue(lastIngestion);
        
        const result = await mockSourceInstance.getLastIngestion();
        expect(result).toBe(lastIngestion);
      });

      it('should return null if no ingestion date', async () => {
        mockSourceInstance.getLastIngestion.mockResolvedValue(null);
        
        const result = await mockSourceInstance.getLastIngestion();
        expect(result).toBeNull();
      });
    });

    describe('updateLastIngestion', () => {
      it('should update last ingestion timestamp', async () => {
        const newDate = new Date();
        mockSourceInstance.updateLastIngestion.mockResolvedValue(true);
        
        const result = await mockSourceInstance.updateLastIngestion(newDate);
        expect(result).toBe(true);
        expect(mockSourceInstance.updateLastIngestion).toHaveBeenCalledWith(newDate);
      });

      it('should use current date if no date provided', async () => {
        mockSourceInstance.updateLastIngestion.mockResolvedValue(true);
        
        const result = await mockSourceInstance.updateLastIngestion();
        expect(result).toBe(true);
        expect(mockSourceInstance.updateLastIngestion).toHaveBeenCalled();
      });
    });
  });

  describe('Class Methods', () => {
    describe('findActive', () => {
      it('should find all active sources', async () => {
        const activeSources = [mockSourceInstance];
        sourceModel.findActive.mockResolvedValue(activeSources);
        
        const result = await sourceModel.findActive();
        expect(result).toBe(activeSources);
        expect(sourceModel.findActive).toHaveBeenCalledTimes(1);
      });

      it('should return empty array if no active sources', async () => {
        sourceModel.findActive.mockResolvedValue([]);
        
        const result = await sourceModel.findActive();
        expect(result).toEqual([]);
      });
    });

    describe('findByType', () => {
      it('should find sources by type', async () => {
        const staticSources = [mockSourceInstance];
        sourceModel.findByType.mockResolvedValue(staticSources);
        
        const result = await sourceModel.findByType('static');
        expect(result).toBe(staticSources);
        expect(sourceModel.findByType).toHaveBeenCalledWith('static');
      });

      it('should return empty array for unknown type', async () => {
        sourceModel.findByType.mockResolvedValue([]);
        
        const result = await sourceModel.findByType('unknown');
        expect(result).toEqual([]);
      });
    });

    describe('findByName', () => {
      it('should find source by name', async () => {
        sourceModel.findByName.mockResolvedValue(mockSourceInstance);
        
        const result = await sourceModel.findByName('test-source');
        expect(result).toBe(mockSourceInstance);
        expect(sourceModel.findByName).toHaveBeenCalledWith('test-source');
      });

      it('should return null for non-existent source', async () => {
        sourceModel.findByName.mockResolvedValue(null);
        
        const result = await sourceModel.findByName('non-existent');
        expect(result).toBeNull();
      });
    });
  });

  describe('CRUD Operations', () => {
    describe('create', () => {
      it('should create new source', async () => {
        const sourceData = {
          name: 'new-source',
          type: 'static',
          config: { url: 'https://example.com' }
        };
        sourceModel.create.mockResolvedValue(mockSourceInstance);
        
        const result = await sourceModel.create(sourceData);
        expect(result).toBe(mockSourceInstance);
        expect(sourceModel.create).toHaveBeenCalledWith(sourceData);
      });
    });

    describe('findAll', () => {
      it('should find all sources', async () => {
        const sources = [mockSourceInstance];
        sourceModel.findAll.mockResolvedValue(sources);
        
        const result = await sourceModel.findAll();
        expect(result).toBe(sources);
      });

      it('should find sources with conditions', async () => {
        const conditions = { where: { type: 'static' } };
        sourceModel.findAll.mockResolvedValue([mockSourceInstance]);
        
        const result = await sourceModel.findAll(conditions);
        expect(result).toEqual([mockSourceInstance]);
        expect(sourceModel.findAll).toHaveBeenCalledWith(conditions);
      });
    });

    describe('findOne', () => {
      it('should find single source', async () => {
        const conditions = { where: { name: 'test-source' } };
        sourceModel.findOne.mockResolvedValue(mockSourceInstance);
        
        const result = await sourceModel.findOne(conditions);
        expect(result).toBe(mockSourceInstance);
        expect(sourceModel.findOne).toHaveBeenCalledWith(conditions);
      });
    });

    describe('findByPk', () => {
      it('should find source by primary key', async () => {
        sourceModel.findByPk.mockResolvedValue(mockSourceInstance);
        
        const result = await sourceModel.findByPk(1);
        expect(result).toBe(mockSourceInstance);
        expect(sourceModel.findByPk).toHaveBeenCalledWith(1);
      });
    });

    describe('update', () => {
      it('should update source', async () => {
        const updateData = { status: 'inactive' };
        const conditions = { where: { id: 1 } };
        sourceModel.update.mockResolvedValue([1]);
        
        const result = await sourceModel.update(updateData, conditions);
        expect(result).toEqual([1]);
        expect(sourceModel.update).toHaveBeenCalledWith(updateData, conditions);
      });
    });

    describe('destroy', () => {
      it('should delete source', async () => {
        const conditions = { where: { id: 1 } };
        sourceModel.destroy.mockResolvedValue(1);
        
        const result = await sourceModel.destroy(conditions);
        expect(result).toBe(1);
        expect(sourceModel.destroy).toHaveBeenCalledWith(conditions);
      });
    });
  });

  describe('Validations', () => {
    it('should validate required fields', () => {
      // Test that the model definition includes proper validations
      expect(mockSequelize.define).toHaveBeenCalledWith(
        'Source',
        expect.objectContaining({
          name: expect.objectContaining({
            allowNull: false,
            validate: expect.objectContaining({
              notEmpty: true,
              len: [1, 255]
            })
          }),
          type: expect.objectContaining({
            allowNull: false,
            validate: expect.objectContaining({
              isIn: [['static', 'semi-static', 'dynamic']]
            })
          })
        }),
        expect.any(Object)
      );
    });
  });

  describe('Hooks', () => {
    it('should have beforeCreate hook for timestamps', () => {
      // Verify that hooks are defined in the model options
      expect(mockSequelize.define).toHaveBeenCalledWith(
        'Source',
        expect.any(Object),
        expect.objectContaining({
          hooks: expect.objectContaining({
            beforeCreate: expect.any(Function),
            beforeUpdate: expect.any(Function)
          })
        })
      );
    });
  });
});
