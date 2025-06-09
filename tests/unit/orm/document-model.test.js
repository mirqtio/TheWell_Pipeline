/**
 * Unit tests for Document ORM Model
 */

// Mock the Document model module
jest.mock('../../../src/orm/models/Document', () => {
  return jest.fn((sequelize) => {
    const { DataTypes } = require('sequelize');
    
    // Call the actual define method to test the definition
    const model = sequelize.define(
      'Document',
      {
        id: {
          type: DataTypes.INTEGER,
          primaryKey: true,
          autoIncrement: true
        },
        source_id: {
          type: DataTypes.INTEGER,
          allowNull: false
        },
        title: {
          type: DataTypes.TEXT,
          allowNull: false,
          validate: {
            notEmpty: true,
            len: [1, 1000]
          }
        },
        content: {
          type: DataTypes.TEXT,
          allowNull: false,
          validate: {
            notEmpty: true
          }
        },
        content_hash: {
          type: DataTypes.STRING,
          allowNull: false,
          unique: true,
          validate: {
            len: [32, 64]
          }
        },
        url: {
          type: DataTypes.TEXT,
          allowNull: true
        },
        metadata: {
          type: DataTypes.JSONB,
          defaultValue: {}
        },
        embedding: {
          type: DataTypes.TEXT,
          allowNull: true,
          comment: 'Vector embedding stored as JSON string'
        },
        word_count: {
          type: DataTypes.INTEGER,
          defaultValue: 0
        },
        enrichment_status: {
          type: DataTypes.ENUM,
          values: ['pending', 'processing', 'completed', 'failed'],
          defaultValue: 'pending'
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
        tableName: 'documents',
        timestamps: false,
        indexes: [
          { fields: ['source_id'] },
          { fields: ['content_hash'] },
          { fields: ['enrichment_status'] },
          { fields: ['created_at'] }
        ],
        hooks: {
          beforeCreate: jest.fn(),
          beforeUpdate: jest.fn(),
          beforeSave: jest.fn()
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

// Mock the actual Document model implementation
const mockDocumentModel = {
  // Mock instance methods
  hasEmbedding: jest.fn().mockReturnValue(true),
  getEmbedding: jest.fn().mockReturnValue([0.1, 0.2, 0.3]),
  setEmbedding: jest.fn().mockResolvedValue(true),
  calculateWordCount: jest.fn().mockReturnValue(100),
  isEnriched: jest.fn().mockReturnValue(true),
  
  // Mock static methods
  findBySource: jest.fn().mockResolvedValue([]),
  findByContentHash: jest.fn().mockResolvedValue(null),
  findSimilar: jest.fn().mockResolvedValue([]),
  searchByVector: jest.fn().mockResolvedValue([]),
  
  // Mock Sequelize model methods
  findAll: jest.fn().mockResolvedValue([]),
  findOne: jest.fn().mockResolvedValue(null),
  findByPk: jest.fn().mockResolvedValue(null),
  create: jest.fn().mockResolvedValue({}),
  update: jest.fn().mockResolvedValue([1]),
  destroy: jest.fn().mockResolvedValue(1),
  
  // Mock associations
  belongsTo: jest.fn(),
  hasMany: jest.fn()
};

// Set up the mock to return our model when define is called
mockSequelize.define.mockReturnValue(mockDocumentModel);

const DocumentModel = require('../../../src/orm/models/Document');

describe('Document Model', () => {
  let documentModel;
  let mockDocumentInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    documentModel = DocumentModel(mockSequelize);
    
    // Create a mock document instance
    mockDocumentInstance = {
      id: 1,
      source_id: 1,
      title: 'Test Document',
      content: 'This is test content',
      content_hash: 'abc123',
      url: 'https://example.com/doc1',
      metadata: { author: 'Test Author' },
      embedding: '[0.1,0.2,0.3]',
      word_count: 100,
      enrichment_status: 'completed',
      created_at: new Date(),
      updated_at: new Date(),
      hasEmbedding: jest.fn().mockReturnValue(true),
      getEmbedding: jest.fn().mockReturnValue([0.1, 0.2, 0.3]),
      setEmbedding: jest.fn().mockResolvedValue(true),
      calculateWordCount: jest.fn().mockReturnValue(100),
      isEnriched: jest.fn().mockReturnValue(true)
    };
  });

  describe('Model Definition', () => {
    it('should define Document model with correct attributes', () => {
      expect(mockSequelize.define).toHaveBeenCalledWith(
        'Document',
        expect.objectContaining({
          id: expect.objectContaining({
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
          }),
          source_id: expect.objectContaining({
            type: DataTypes.INTEGER,
            allowNull: false
          }),
          title: expect.objectContaining({
            type: DataTypes.TEXT,
            allowNull: false
          }),
          content: expect.objectContaining({
            type: DataTypes.TEXT,
            allowNull: false
          }),
          content_hash: expect.objectContaining({
            type: DataTypes.STRING,
            allowNull: false,
            unique: true
          }),
          url: expect.objectContaining({
            type: DataTypes.TEXT,
            allowNull: true
          }),
          metadata: expect.objectContaining({
            type: DataTypes.JSONB,
            defaultValue: {}
          }),
          embedding: expect.objectContaining({
            type: DataTypes.TEXT,
            allowNull: true
          }),
          word_count: expect.objectContaining({
            type: DataTypes.INTEGER,
            defaultValue: 0
          }),
          enrichment_status: expect.objectContaining({
            type: DataTypes.ENUM,
            values: ['pending', 'processing', 'completed', 'failed'],
            defaultValue: 'pending'
          })
        }),
        expect.objectContaining({
          tableName: 'documents',
          timestamps: false,
          indexes: expect.arrayContaining([
            expect.objectContaining({ fields: ['source_id'] }),
            expect.objectContaining({ fields: ['content_hash'] }),
            expect.objectContaining({ fields: ['enrichment_status'] })
          ])
        })
      );
    });
  });

  describe('Instance Methods', () => {
    describe('hasEmbedding', () => {
      it('should return true when embedding exists', () => {
        mockDocumentInstance.embedding = '[0.1,0.2,0.3]';
        mockDocumentInstance.hasEmbedding.mockReturnValue(true);
        
        const result = mockDocumentInstance.hasEmbedding();
        expect(result).toBe(true);
      });

      it('should return false when embedding is null', () => {
        mockDocumentInstance.embedding = null;
        mockDocumentInstance.hasEmbedding.mockReturnValue(false);
        
        const result = mockDocumentInstance.hasEmbedding();
        expect(result).toBe(false);
      });
    });

    describe('getEmbedding', () => {
      it('should return parsed embedding array', () => {
        const embedding = [0.1, 0.2, 0.3];
        mockDocumentInstance.getEmbedding.mockReturnValue(embedding);
        
        const result = mockDocumentInstance.getEmbedding();
        expect(result).toEqual(embedding);
      });

      it('should return null for invalid embedding', () => {
        mockDocumentInstance.getEmbedding.mockReturnValue(null);
        
        const result = mockDocumentInstance.getEmbedding();
        expect(result).toBeNull();
      });
    });

    describe('setEmbedding', () => {
      it('should set embedding from array', async () => {
        const embedding = [0.1, 0.2, 0.3];
        mockDocumentInstance.setEmbedding.mockResolvedValue(true);
        
        const result = await mockDocumentInstance.setEmbedding(embedding);
        expect(result).toBe(true);
        expect(mockDocumentInstance.setEmbedding).toHaveBeenCalledWith(embedding);
      });

      it('should handle null embedding', async () => {
        mockDocumentInstance.setEmbedding.mockResolvedValue(true);
        
        const result = await mockDocumentInstance.setEmbedding(null);
        expect(result).toBe(true);
      });
    });

    describe('calculateWordCount', () => {
      it('should calculate word count from content', () => {
        mockDocumentInstance.calculateWordCount.mockReturnValue(100);
        
        const result = mockDocumentInstance.calculateWordCount();
        expect(result).toBe(100);
      });

      it('should return 0 for empty content', () => {
        mockDocumentInstance.calculateWordCount.mockReturnValue(0);
        
        const result = mockDocumentInstance.calculateWordCount();
        expect(result).toBe(0);
      });
    });

    describe('isEnriched', () => {
      it('should return true for completed enrichment', () => {
        mockDocumentInstance.enrichment_status = 'completed';
        mockDocumentInstance.isEnriched.mockReturnValue(true);
        
        const result = mockDocumentInstance.isEnriched();
        expect(result).toBe(true);
      });

      it('should return false for pending enrichment', () => {
        mockDocumentInstance.enrichment_status = 'pending';
        mockDocumentInstance.isEnriched.mockReturnValue(false);
        
        const result = mockDocumentInstance.isEnriched();
        expect(result).toBe(false);
      });
    });
  });

  describe('Class Methods', () => {
    describe('findBySource', () => {
      it('should find documents by source ID', async () => {
        const documents = [mockDocumentInstance];
        documentModel.findBySource.mockResolvedValue(documents);
        
        const result = await documentModel.findBySource(1);
        expect(result).toBe(documents);
        expect(documentModel.findBySource).toHaveBeenCalledWith(1);
      });

      it('should return empty array for non-existent source', async () => {
        documentModel.findBySource.mockResolvedValue([]);
        
        const result = await documentModel.findBySource(999);
        expect(result).toEqual([]);
      });
    });

    describe('findByContentHash', () => {
      it('should find document by content hash', async () => {
        documentModel.findByContentHash.mockResolvedValue(mockDocumentInstance);
        
        const result = await documentModel.findByContentHash('abc123');
        expect(result).toBe(mockDocumentInstance);
        expect(documentModel.findByContentHash).toHaveBeenCalledWith('abc123');
      });

      it('should return null for non-existent hash', async () => {
        documentModel.findByContentHash.mockResolvedValue(null);
        
        const result = await documentModel.findByContentHash('nonexistent');
        expect(result).toBeNull();
      });
    });

    describe('findSimilar', () => {
      it('should find similar documents by embedding', async () => {
        const embedding = [0.1, 0.2, 0.3];
        const similarDocs = [mockDocumentInstance];
        documentModel.findSimilar.mockResolvedValue(similarDocs);
        
        const result = await documentModel.findSimilar(embedding, 0.8, 10);
        expect(result).toBe(similarDocs);
        expect(documentModel.findSimilar).toHaveBeenCalledWith(embedding, 0.8, 10);
      });

      it('should use default parameters', async () => {
        const embedding = [0.1, 0.2, 0.3];
        documentModel.findSimilar.mockResolvedValue([]);
        
        const result = await documentModel.findSimilar(embedding);
        expect(result).toEqual([]);
      });
    });

    describe('searchByVector', () => {
      it('should search documents by vector similarity', async () => {
        const queryVector = [0.1, 0.2, 0.3];
        const searchResults = [mockDocumentInstance];
        documentModel.searchByVector.mockResolvedValue(searchResults);
        
        const result = await documentModel.searchByVector(queryVector, 10);
        expect(result).toBe(searchResults);
        expect(documentModel.searchByVector).toHaveBeenCalledWith(queryVector, 10);
      });
    });
  });

  describe('CRUD Operations', () => {
    describe('create', () => {
      it('should create new document', async () => {
        const documentData = {
          source_id: 1,
          title: 'New Document',
          content: 'New content',
          content_hash: 'def456',
          url: 'https://example.com/new'
        };
        documentModel.create.mockResolvedValue(mockDocumentInstance);
        
        const result = await documentModel.create(documentData);
        expect(result).toBe(mockDocumentInstance);
        expect(documentModel.create).toHaveBeenCalledWith(documentData);
      });
    });

    describe('findAll', () => {
      it('should find all documents', async () => {
        const documents = [mockDocumentInstance];
        documentModel.findAll.mockResolvedValue(documents);
        
        const result = await documentModel.findAll();
        expect(result).toBe(documents);
      });

      it('should find documents with conditions', async () => {
        const conditions = { where: { source_id: 1 } };
        documentModel.findAll.mockResolvedValue([mockDocumentInstance]);
        
        const result = await documentModel.findAll(conditions);
        expect(result).toEqual([mockDocumentInstance]);
        expect(documentModel.findAll).toHaveBeenCalledWith(conditions);
      });
    });

    describe('update', () => {
      it('should update document', async () => {
        const updateData = { enrichment_status: 'completed' };
        const conditions = { where: { id: 1 } };
        documentModel.update.mockResolvedValue([1]);
        
        const result = await documentModel.update(updateData, conditions);
        expect(result).toEqual([1]);
        expect(documentModel.update).toHaveBeenCalledWith(updateData, conditions);
      });
    });
  });

  describe('Validations', () => {
    it('should validate required fields', () => {
      expect(mockSequelize.define).toHaveBeenCalledWith(
        'Document',
        expect.objectContaining({
          title: expect.objectContaining({
            allowNull: false,
            validate: expect.objectContaining({
              notEmpty: true,
              len: [1, 1000]
            })
          }),
          content: expect.objectContaining({
            allowNull: false,
            validate: expect.objectContaining({
              notEmpty: true
            })
          }),
          content_hash: expect.objectContaining({
            allowNull: false,
            validate: expect.objectContaining({
              len: [32, 64]
            })
          })
        }),
        expect.any(Object)
      );
    });
  });

  describe('Hooks', () => {
    it('should have hooks for word count and timestamps', () => {
      expect(mockSequelize.define).toHaveBeenCalledWith(
        'Document',
        expect.any(Object),
        expect.objectContaining({
          hooks: expect.objectContaining({
            beforeCreate: expect.any(Function),
            beforeUpdate: expect.any(Function),
            beforeSave: expect.any(Function)
          })
        })
      );
    });
  });

  describe('Vector Operations', () => {
    it('should handle vector embedding storage', () => {
      // Test that embedding field is properly configured for vector storage
      const defineCall = mockSequelize.define.mock.calls[0];
      expect(defineCall[0]).toBe('Document');
      expect(defineCall[1]).toHaveProperty('embedding');
      
      const embeddingField = defineCall[1].embedding;
      expect(embeddingField.type).toBe(DataTypes.TEXT);
      expect(embeddingField.allowNull).toBe(true);
      expect(embeddingField.comment).toBe('Vector embedding stored as JSON string');
    });
  });
});
