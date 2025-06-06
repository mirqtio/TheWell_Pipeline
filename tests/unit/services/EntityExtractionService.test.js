const EntityExtractionService = require('../../../src/services/EntityExtractionService');
const EntityExtractor = require('../../../src/enrichment/EntityExtractor');
const DatabaseManager = require('../../../src/database/DatabaseManager');

jest.mock('../../../src/enrichment/EntityExtractor');
jest.mock('../../../src/database/DatabaseManager');

describe('EntityExtractionService', () => {
  let service;
  let mockDb;
  let mockExtractor;
  
  beforeEach(async () => {
    jest.clearAllMocks();
    
    mockDb = {
      query: jest.fn(),
      connect: jest.fn().mockResolvedValue({}),
      release: jest.fn()
    };
    
    mockExtractor = {
      extractFromDocument: jest.fn(),
      addCustomPattern: jest.fn()
    };
    
    DatabaseManager.getInstance = jest.fn().mockReturnValue({
      getDatabase: jest.fn().mockReturnValue(mockDb)
    });
    
    EntityExtractor.mockImplementation(() => mockExtractor);
    
    // Mock custom patterns query first
    mockDb.query.mockResolvedValueOnce({ rows: [] });
    
    service = new EntityExtractionService();
    
    // Wait for async initialization
    await new Promise(resolve => setTimeout(resolve, 10));
    
    // Reset for tests
    mockDb.query.mockReset();
  });
  
  describe('processDocument', () => {
    it('should extract and store entities from document', async () => {
      const document = {
        id: 1,
        title: 'Test Document',
        content: 'John Smith from Microsoft will meet in New York.'
      };
      
      const extractedEntities = {
        persons: [{ name: 'John Smith', type: 'PERSON', confidence: 0.9 }],
        organizations: [{ name: 'Microsoft', type: 'ORGANIZATION', confidence: 1.0 }],
        locations: [{ name: 'New York', type: 'LOCATION', confidence: 0.9 }],
        dates: [],
        times: [],
        emails: [],
        urls: [],
        money: [],
        phones: [],
        custom: []
      };
      
      mockExtractor.extractFromDocument.mockResolvedValue({
        documentId: 1,
        entities: extractedEntities,
        extractedAt: new Date()
      });
      
      // Mock job creation
      mockDb.query
        .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // Create job
        .mockResolvedValue({ rows: [] }); // All other queries
      
      const result = await service.processDocument(document);
      
      expect(result.success).toBe(true);
      expect(result.jobId).toBe(1);
      expect(result.entityCounts).toEqual({
        PERSON: 1,
        ORGANIZATION: 1,
        LOCATION: 1
      });
      
      // Verify job was created
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO entity_extraction_jobs'),
        expect.any(Array)
      );
      
      // Verify entities were inserted
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO extracted_entities'),
        expect.any(Array)
      );
    });
    
    it('should handle extraction errors gracefully', async () => {
      const document = { id: 1, title: 'Test', content: 'Test content' };
      
      mockExtractor.extractFromDocument.mockRejectedValue(new Error('Extraction failed'));
      
      // Mock job creation and update
      mockDb.query
        .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // Create job
        .mockResolvedValue({ rows: [] }); // All other queries
      
      const result = await service.processDocument(document);
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('Extraction failed');
      
      // Verify job was marked as failed
      const updateCall = mockDb.query.mock.calls.find(call => 
        call[0].includes('UPDATE entity_extraction_jobs')
      );
      expect(updateCall).toBeTruthy();
      expect(updateCall[1]).toEqual(['Extraction failed', 1]);
    });
  });
  
  describe('getDocumentEntities', () => {
    it('should retrieve entities for a document', async () => {
      mockDb.query.mockReset();
      const mockEntities = [
        { 
          id: 1,
          entity_type: 'PERSON',
          entity_text: 'John Smith',
          confidence: 0.9,
          entity_value: null
        },
        {
          id: 2,
          entity_type: 'ORGANIZATION',
          entity_text: 'Microsoft',
          confidence: 1.0,
          entity_value: null
        }
      ];
      
      mockDb.query.mockResolvedValue({ rows: mockEntities });
      
      const result = await service.getDocumentEntities(1, { minConfidence: 0.8 });
      
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        id: 1,
        type: 'PERSON',
        text: 'John Smith',
        confidence: 0.9
      });
      
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM extracted_entities'),
        [1, 0.8]
      );
    });
    
    it('should filter by entity types', async () => {
      mockDb.query.mockReset();
      mockDb.query.mockResolvedValue({ rows: [] });
      
      await service.getDocumentEntities(1, { 
        types: ['PERSON', 'ORGANIZATION']
      });
      
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('entity_type = ANY($3)'),
        [1, 0.7, ['PERSON', 'ORGANIZATION']]
      );
    });
  });
  
  describe('searchEntities', () => {
    it('should search for entities by text', async () => {
      mockDb.query.mockReset();
      const mockResults = [
        {
          entity_text: 'John Smith',
          entity_type: 'PERSON',
          occurrence_count: '5',
          document_count: '3',
          avg_confidence: '0.85'
        }
      ];
      
      mockDb.query.mockResolvedValue({ rows: mockResults });
      
      const result = await service.searchEntities('John', {
        types: ['PERSON'],
        limit: 10
      });
      
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        text: 'John Smith',
        type: 'PERSON',
        occurrences: 5,
        documents: 3,
        avgConfidence: 0.85
      });
    });
  });
  
  describe('addCustomPattern', () => {
    it('should add custom extraction pattern', async () => {
      mockDb.query.mockReset();
      mockDb.query.mockResolvedValue({ 
        rows: [{ id: 1, name: 'PROJECT_ID', pattern: 'PROJ-\\d+' }] 
      });
      
      const result = await service.addCustomPattern({
        name: 'PROJECT_ID',
        pattern: 'PROJ-\\d+',
        entityType: 'PROJECT',
        description: 'Project identifiers'
      });
      
      expect(result.id).toBe(1);
      expect(mockExtractor.addCustomPattern).toHaveBeenCalledWith(
        'PROJECT',
        'PROJ-\\d+'
      );
    });
  });
  
  describe('getEntityStatistics', () => {
    it('should return entity statistics', async () => {
      mockDb.query.mockReset();
      const mockStats = [
        {
          entity_type: 'PERSON',
          total_count: '150',
          unique_count: '45',
          avg_confidence: '0.87'
        },
        {
          entity_type: 'ORGANIZATION',
          total_count: '75',
          unique_count: '20',
          avg_confidence: '0.92'
        }
      ];
      
      mockDb.query.mockResolvedValue({ rows: mockStats });
      
      const result = await service.getEntityStatistics();
      
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        type: 'PERSON',
        totalCount: 150,
        uniqueCount: 45,
        avgConfidence: 0.87
      });
    });
  });
  
  describe('createEntityRelationship', () => {
    it('should create relationship between entities', async () => {
      mockDb.query.mockReset();
      mockDb.query.mockResolvedValue({ 
        rows: [{ id: 1, relationship_type: 'WORKS_FOR' }] 
      });
      
      const result = await service.createEntityRelationship(1, 2, 'WORKS_FOR', 0.9);
      
      expect(result.id).toBe(1);
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO entity_relationships'),
        [1, 2, 'WORKS_FOR', 0.9, '{}']
      );
    });
  });
  
  describe('batch processing', () => {
    it('should process multiple documents in batch', async () => {
      const documents = [
        { id: 1, title: 'Doc 1', content: 'Content 1' },
        { id: 2, title: 'Doc 2', content: 'Content 2' }
      ];
      
      mockDb.query.mockReset();
      
      // Mock successful extraction for both
      mockExtractor.extractFromDocument
        .mockResolvedValueOnce({
          documentId: 1,
          entities: { persons: [], organizations: [], locations: [], dates: [], times: [], emails: [], urls: [], money: [], phones: [], custom: [] }
        })
        .mockResolvedValueOnce({
          documentId: 2,
          entities: { persons: [], organizations: [], locations: [], dates: [], times: [], emails: [], urls: [], money: [], phones: [], custom: [] }
        });
      
      mockDb.query.mockResolvedValue({ rows: [{ id: 1 }] });
      
      const results = await service.processBatch(documents);
      
      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(true);
    });
  });
});