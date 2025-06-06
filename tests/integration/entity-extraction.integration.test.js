// Unmock pg for integration tests
jest.unmock('pg');

const request = require('supertest');
const DatabaseManager = require('../../src/database/DatabaseManager');
const path = require('path');
const fs = require('fs');

// Only require app after DatabaseManager is available
let app;

describe('Entity Extraction Integration', () => {
  let db;
  let testDocumentId;
  
  beforeAll(async () => {
    // Skip if no database available
    if (process.env.SKIP_DB_TESTS === 'true') {
      console.log('Skipping entity extraction integration tests - SKIP_DB_TESTS=true');
      return;
    }
    
    // Initialize database
    const dbManager = DatabaseManager.getInstance();
    db = await dbManager.getDatabase();
    
    // Require app after database is ready
    app = require('../../src/web/app');
    
    // Run migration
    const migrationPath = path.join(__dirname, '../../src/database/migrations/0007_add_entity_extraction.sql');
    const migration = fs.readFileSync(migrationPath, 'utf8');
    
    // Execute migration
    try {
      await db.query('BEGIN');
      const statements = migration
        .split(';')
        .map(s => s.trim())
        .filter(s => s && !s.match(/^(BEGIN|COMMIT)/i));
      
      for (const statement of statements) {
        try {
          await db.query(statement);
        } catch (error) {
          if (!error.message.includes('already exists')) {
            throw error;
          }
        }
      }
      await db.query('COMMIT');
    } catch (error) {
      await db.query('ROLLBACK');
      console.error('Migration error:', error);
    }
    
    // Create test document
    const docResult = await db.query(`
      INSERT INTO documents (title, content, source_id, raw_content, metadata)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id
    `, [
      'Test Document for Entity Extraction',
      'John Smith, CEO of TechCorp, announced a $5 million investment. The meeting will be held on December 15, 2024 in New York. Contact: john@techcorp.com or call (555) 123-4567.',
      1,
      'raw content',
      JSON.stringify({ test: true })
    ]);
    
    testDocumentId = docResult.rows[0].id;
  });
  
  afterAll(async () => {
    if (process.env.SKIP_DB_TESTS === 'true') {
      return;
    }
    
    // Cleanup
    if (db && testDocumentId) {
      await db.query('DELETE FROM documents WHERE id = $1', [testDocumentId]);
    }
    
    const dbManager = DatabaseManager.getInstance();
    await dbManager.close();
  });
  
  describe('POST /api/v1/entities/extract/:documentId', () => {
    it('should extract entities from document', async () => {
      if (process.env.SKIP_DB_TESTS === 'true') {
        return;
      }
      const response = await request(app)
        .post(`/api/v1/entities/extract/${testDocumentId}`)
        .expect(200);
      
      expect(response.body.success).toBe(true);
      expect(response.body.data).toMatchObject({
        jobId: expect.any(Number),
        entityCounts: expect.objectContaining({
          PERSON: expect.any(Number),
          ORGANIZATION: expect.any(Number),
          MONEY: expect.any(Number),
          DATE: expect.any(Number),
          LOCATION: expect.any(Number),
          EMAIL: expect.any(Number),
          PHONE: expect.any(Number)
        })
      });
      
      // Verify entities were extracted
      expect(response.body.data.entityCounts.PERSON).toBeGreaterThan(0);
      expect(response.body.data.entityCounts.ORGANIZATION).toBeGreaterThan(0);
    });
    
    it('should handle non-existent document', async () => {
      const response = await request(app)
        .post('/api/v1/entities/extract/99999')
        .expect(404);
      
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Document not found');
    });
  });
  
  describe('GET /api/v1/entities/document/:documentId', () => {
    it('should retrieve entities for document', async () => {
      // First extract entities
      await request(app)
        .post(`/api/v1/entities/extract/${testDocumentId}`)
        .expect(200);
      
      // Wait for extraction to complete
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Get entities
      const response = await request(app)
        .get(`/api/v1/entities/document/${testDocumentId}`)
        .expect(200);
      
      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeInstanceOf(Array);
      expect(response.body.data.length).toBeGreaterThan(0);
      
      // Check entity structure
      const entity = response.body.data[0];
      expect(entity).toHaveProperty('id');
      expect(entity).toHaveProperty('type');
      expect(entity).toHaveProperty('text');
      expect(entity).toHaveProperty('confidence');
    });
    
    it('should filter by entity type', async () => {
      const response = await request(app)
        .get(`/api/v1/entities/document/${testDocumentId}`)
        .query({ types: ['PERSON', 'ORGANIZATION'] })
        .expect(200);
      
      expect(response.body.success).toBe(true);
      expect(response.body.data.every(e => 
        ['PERSON', 'ORGANIZATION'].includes(e.type)
      )).toBe(true);
    });
    
    it('should filter by confidence', async () => {
      const response = await request(app)
        .get(`/api/v1/entities/document/${testDocumentId}`)
        .query({ minConfidence: 0.9 })
        .expect(200);
      
      expect(response.body.success).toBe(true);
      expect(response.body.data.every(e => e.confidence >= 0.9)).toBe(true);
    });
  });
  
  describe('GET /api/v1/entities/search', () => {
    it('should search entities across documents', async () => {
      const response = await request(app)
        .get('/api/v1/entities/search')
        .query({ q: 'John' })
        .expect(200);
      
      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeInstanceOf(Array);
      
      if (response.body.data.length > 0) {
        const result = response.body.data[0];
        expect(result).toHaveProperty('text');
        expect(result).toHaveProperty('type');
        expect(result).toHaveProperty('occurrences');
        expect(result).toHaveProperty('documents');
      }
    });
  });
  
  describe('GET /api/v1/entities/statistics', () => {
    it('should return entity statistics', async () => {
      const response = await request(app)
        .get('/api/v1/entities/statistics')
        .expect(200);
      
      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeInstanceOf(Array);
      
      if (response.body.data.length > 0) {
        const stat = response.body.data[0];
        expect(stat).toHaveProperty('type');
        expect(stat).toHaveProperty('totalCount');
        expect(stat).toHaveProperty('uniqueCount');
        expect(stat).toHaveProperty('avgConfidence');
      }
    });
  });
  
  describe('Custom Patterns', () => {
    let patternId;
    
    it('should create custom extraction pattern', async () => {
      const response = await request(app)
        .post('/api/v1/entities/patterns')
        .send({
          name: 'TEST_PATTERN',
          pattern: 'TEST-\\d+',
          entityType: 'TEST_ID',
          description: 'Test pattern for IDs'
        })
        .expect(201);
      
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('id');
      expect(response.body.data.name).toBe('TEST_PATTERN');
      
      patternId = response.body.data.id;
    });
    
    it('should list custom patterns', async () => {
      const response = await request(app)
        .get('/api/v1/entities/patterns')
        .expect(200);
      
      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeInstanceOf(Array);
      expect(response.body.data.some(p => p.name === 'TEST_PATTERN')).toBe(true);
    });
    
    afterAll(async () => {
      // Cleanup custom pattern
      if (patternId) {
        await db.query('DELETE FROM custom_entity_patterns WHERE id = $1', [patternId]);
      }
    });
  });
  
  describe('Entity Relationships', () => {
    it('should create entity relationship', async () => {
      // Get two entities
      const entitiesResponse = await request(app)
        .get(`/api/v1/entities/document/${testDocumentId}`)
        .query({ limit: 2 })
        .expect(200);
      
      if (entitiesResponse.body.data.length >= 2) {
        const [entity1, entity2] = entitiesResponse.body.data;
        
        const response = await request(app)
          .post('/api/v1/entities/relationships')
          .send({
            sourceEntityId: entity1.id,
            targetEntityId: entity2.id,
            relationshipType: 'WORKS_FOR',
            confidence: 0.85
          })
          .expect(201);
        
        expect(response.body.success).toBe(true);
        expect(response.body.data).toHaveProperty('id');
        expect(response.body.data.relationship_type).toBe('WORKS_FOR');
      }
    });
  });
  
  describe('Batch Processing', () => {
    it('should process multiple documents in batch', async () => {
      // Create additional test documents
      const doc2Result = await db.query(`
        INSERT INTO documents (title, content, source_id, raw_content, metadata)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
      `, [
        'Second Test Document',
        'Jane Doe from Microsoft spoke at the conference.',
        1,
        'raw content 2',
        JSON.stringify({})
      ]);
      
      const doc2Id = doc2Result.rows[0].id;
      
      try {
        const response = await request(app)
          .post('/api/v1/entities/extract/batch')
          .send({
            documentIds: [testDocumentId, doc2Id]
          })
          .expect(200);
        
        expect(response.body.success).toBe(true);
        expect(response.body.data).toHaveLength(2);
        expect(response.body.data.every(r => r.success)).toBe(true);
      } finally {
        // Cleanup
        await db.query('DELETE FROM documents WHERE id = $1', [doc2Id]);
      }
    });
  });
});