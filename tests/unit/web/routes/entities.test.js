const request = require('supertest');
const express = require('express');

// Create mocks before modules are loaded
const mockEntityService = {
  processDocument: jest.fn(),
  processBatch: jest.fn(),
  getDocumentEntities: jest.fn(),
  searchEntities: jest.fn(),
  getEntityStatistics: jest.fn(),
  addCustomPattern: jest.fn(),
  getCustomPatterns: jest.fn(),
  createEntityRelationship: jest.fn(),
  getEntityRelationships: jest.fn(),
  processPendingJobs: jest.fn(),
  _loadCustomPatterns: jest.fn().mockResolvedValue([])
};

const mockDocumentDAO = {
  getById: jest.fn()
};

// Mock dependencies
jest.mock('../../../../src/services/EntityExtractionService', () => {
  return jest.fn().mockImplementation(() => mockEntityService);
});

jest.mock('../../../../src/database/DocumentDAO', () => {
  return jest.fn().mockImplementation(() => mockDocumentDAO);
});

jest.mock('../../../../src/web/middleware/rbac', () => ({
  requireAuth: () => (req, res, next) => {
    req.user = { id: 1, email: 'test@example.com' };
    next();
  },
  requirePermission: () => (req, res, next) => next()
}));

// NOW load the routes after mocks are set up
const entitiesRoutes = require('../../../../src/web/routes/entities');

describe('Entity Extraction Routes', () => {
  let app;
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup express app
    app = express();
    app.use(express.json());
    app.use('/api/v1/entities', entitiesRoutes);
  });
  
  describe('POST /api/v1/entities/extract/:documentId', () => {
    it('should extract entities from document', async () => {
      const mockDocument = {
        id: 1,
        title: 'Test Document',
        content: 'John Smith from Microsoft announced...'
      };
      
      const mockResult = {
        success: true,
        jobId: 1,
        entityCounts: {
          PERSON: 1,
          ORGANIZATION: 1
        },
        processingTime: 150
      };
      
      mockDocumentDAO.getById.mockResolvedValue(mockDocument);
      mockEntityService.processDocument.mockResolvedValue(mockResult);
      
      const response = await request(app)
        .post('/api/v1/entities/extract/1')
        .expect(200);
      
      expect(response.body).toEqual({
        success: true,
        data: mockResult
      });
      
      expect(mockDocumentDAO.getById).toHaveBeenCalledWith(1);
      expect(mockEntityService.processDocument).toHaveBeenCalledWith(mockDocument);
    });
    
    it('should handle non-existent document', async () => {
      mockDocumentDAO.getById.mockResolvedValue(null);
      
      const response = await request(app)
        .post('/api/v1/entities/extract/999')
        .expect(404);
      
      expect(response.body).toEqual({
        success: false,
        error: 'Document not found'
      });
    });
  });
  
  describe('GET /api/v1/entities/document/:documentId', () => {
    it('should get entities for document', async () => {
      const mockEntities = [
        {
          id: 1,
          type: 'PERSON',
          text: 'John Smith',
          confidence: 0.9
        },
        {
          id: 2,
          type: 'ORGANIZATION',
          text: 'Microsoft',
          confidence: 1.0
        }
      ];
      
      mockEntityService.getDocumentEntities.mockResolvedValue(mockEntities);
      
      const response = await request(app)
        .get('/api/v1/entities/document/1')
        .query({ minConfidence: 0.8 })
        .expect(200);
      
      expect(response.body).toEqual({
        success: true,
        data: mockEntities,
        count: 2
      });
      
      expect(mockEntityService.getDocumentEntities).toHaveBeenCalledWith(1, {
        minConfidence: 0.8,
        limit: 100,
        offset: 0
      });
    });
  });
  
  describe('GET /api/v1/entities/search', () => {
    it('should search entities', async () => {
      const mockResults = [
        {
          text: 'John Smith',
          type: 'PERSON',
          occurrences: 5,
          documents: 3,
          avgConfidence: 0.87
        }
      ];
      
      mockEntityService.searchEntities.mockResolvedValue(mockResults);
      
      const response = await request(app)
        .get('/api/v1/entities/search')
        .query({ q: 'John' })
        .expect(200);
      
      expect(response.body).toEqual({
        success: true,
        data: mockResults,
        count: 1
      });
    });
    
    it('should require search text', async () => {
      const response = await request(app)
        .get('/api/v1/entities/search')
        .expect(400);
      
      expect(response.body.error).toContain('Search text (q) is required');
    });
  });
  
  describe('POST /api/v1/entities/patterns', () => {
    it('should create custom pattern', async () => {
      const patternData = {
        name: 'PROJECT_ID',
        pattern: 'PROJ-\\d+',
        entityType: 'PROJECT',
        description: 'Project identifiers'
      };
      
      const mockResult = {
        id: 1,
        ...patternData
      };
      
      mockEntityService.addCustomPattern.mockResolvedValue(mockResult);
      
      const response = await request(app)
        .post('/api/v1/entities/patterns')
        .send(patternData)
        .expect(201);
      
      expect(response.body).toEqual({
        success: true,
        data: mockResult
      });
    });
  });
  
  describe('POST /api/v1/entities/relationships', () => {
    it('should create entity relationship', async () => {
      const relationshipData = {
        sourceEntityId: 1,
        targetEntityId: 2,
        relationshipType: 'WORKS_FOR',
        confidence: 0.85
      };
      
      const mockResult = {
        id: 1,
        ...relationshipData
      };
      
      mockEntityService.createEntityRelationship.mockResolvedValue(mockResult);
      
      const response = await request(app)
        .post('/api/v1/entities/relationships')
        .send(relationshipData)
        .expect(201);
      
      expect(response.body).toEqual({
        success: true,
        data: mockResult
      });
    });
  });
  
  describe('POST /api/v1/entities/extract/batch', () => {
    it('should process multiple documents', async () => {
      const mockDocs = [
        { id: 1, title: 'Doc 1', content: 'Content 1' },
        { id: 2, title: 'Doc 2', content: 'Content 2' }
      ];
      
      const mockResults = [
        { success: true, jobId: 1, entityCounts: { PERSON: 1 } },
        { success: true, jobId: 2, entityCounts: { PERSON: 2 } }
      ];
      
      mockDocumentDAO.getById
        .mockResolvedValueOnce(mockDocs[0])
        .mockResolvedValueOnce(mockDocs[1]);
      
      // Mock processBatch directly since it's what the route calls
      // Override the implementation completely
      mockEntityService.processBatch = jest.fn().mockResolvedValue(mockResults);
      
      const response = await request(app)
        .post('/api/v1/entities/extract/batch')
        .send({ documentIds: [1, 2] })
        .expect(200);
      
      // Verify response
      expect(response.body).toEqual({
        success: true,
        data: mockResults,
        processed: 2,
        successful: 2
      });
      
      // Verify processBatch was called with correct documents
      expect(mockEntityService.processBatch).toHaveBeenCalledWith(mockDocs);
    });
  });
});