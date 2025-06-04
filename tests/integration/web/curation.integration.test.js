/**
 * Curation API Integration Tests
 */

const request = require('supertest');
const app = require('../../../src/web/app');
const { setupTestDatabase, cleanupTestDatabase } = require('../../helpers/database');

describe('Curation API Integration', () => {
  let testDocuments = [];
  let authToken;

  beforeAll(async () => {
    await setupTestDatabase();
    
    // Create mock auth token (in real implementation would use proper auth)
    authToken = 'test-curator-token';
  });

  afterAll(async () => {
    await cleanupTestDatabase();
  });

  beforeEach(async () => {
    // Create test documents for curation
    const DocumentDAO = require('../../../src/database/DocumentDAO');
    const documentDAO = new DocumentDAO();
    
    const testDocs = [
      {
        source_id: 1,
        external_id: 'test-doc-1',
        title: 'Test Document 1',
        content: 'This is a test document for curation testing.',
        content_type: 'text/plain',
        priority: 'high',
        curation_status: 'pending'
      },
      {
        source_id: 1,
        external_id: 'test-doc-2',
        title: 'Test Document 2',
        content: 'Another test document for curation workflow.',
        content_type: 'text/plain',
        priority: 'medium',
        curation_status: 'in_review'
      },
      {
        source_id: 1,
        external_id: 'test-doc-3',
        title: 'Test Document 3',
        content: 'A processed test document.',
        content_type: 'text/plain',
        priority: 'low',
        curation_status: 'approved'
      }
    ];

    for (const doc of testDocs) {
      const created = await documentDAO.create(doc);
      testDocuments.push(created);
    }
  });

  afterEach(async () => {
    // Clean up test documents
    testDocuments = [];
  });

  describe('GET /api/v1/curation/items', () => {
    it('should return curation items organized by status', async () => {
      const response = await request(app)
        .get('/api/v1/curation/items')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('items');
      expect(response.body.items).toHaveProperty('pending');
      expect(response.body.items).toHaveProperty('inReview');
      expect(response.body.items).toHaveProperty('processed');
      expect(response.body).toHaveProperty('pagination');

      // Check that documents are in correct categories
      expect(response.body.items.pending).toHaveLength(1);
      expect(response.body.items.inReview).toHaveLength(1);
      expect(response.body.items.processed).toHaveLength(1);
    });

    it('should filter by priority', async () => {
      const response = await request(app)
        .get('/api/v1/curation/items?priority=high')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      const allItems = [
        ...response.body.items.pending,
        ...response.body.items.inReview,
        ...response.body.items.processed
      ];

      allItems.forEach(item => {
        expect(item.priority).toBe('high');
      });
    });

    it('should require authentication', async () => {
      await request(app)
        .get('/api/v1/curation/items')
        .expect(401);
    });
  });

  describe('POST /api/v1/curation/items/:id/move', () => {
    it('should move document between curation stages', async () => {
      const pendingDoc = testDocuments.find(doc => doc.curation_status === 'pending');
      
      const response = await request(app)
        .post(`/api/v1/curation/items/${pendingDoc.id}/move`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          from: 'pending',
          to: 'inReview',
          curatorId: 'test-curator-1'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.item.status).toBe('inReview');
    });

    it('should return 404 for non-existent document', async () => {
      await request(app)
        .post('/api/v1/curation/items/99999/move')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          from: 'pending',
          to: 'inReview',
          curatorId: 'test-curator-1'
        })
        .expect(404);
    });
  });

  describe('POST /api/v1/curation/decision', () => {
    it('should approve a document with edited content', async () => {
      const pendingDoc = testDocuments.find(doc => doc.curation_status === 'pending');
      
      const response = await request(app)
        .post('/api/v1/curation/decision')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          itemId: pendingDoc.id,
          decision: 'APPROVE',
          curatorId: 'test-curator-1',
          notes: 'Document approved after review',
          editedContent: 'This is the edited content after curation.',
          tags: ['approved', 'curated'],
          visibilityFlag: 'external'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.item.status).toBe('approved');
      expect(response.body.event.decision).toBe('APPROVE');
    });

    it('should reject a document with reason', async () => {
      const pendingDoc = testDocuments.find(doc => doc.curation_status === 'pending');
      
      const response = await request(app)
        .post('/api/v1/curation/decision')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          itemId: pendingDoc.id,
          decision: 'REJECT',
          curatorId: 'test-curator-1',
          notes: 'Document rejected due to quality issues'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.item.status).toBe('rejected');
      expect(response.body.event.decision).toBe('REJECT');
    });

    it('should validate decision values', async () => {
      const pendingDoc = testDocuments.find(doc => doc.curation_status === 'pending');
      
      await request(app)
        .post('/api/v1/curation/decision')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          itemId: pendingDoc.id,
          decision: 'INVALID',
          curatorId: 'test-curator-1'
        })
        .expect(400);
    });
  });

  describe('POST /api/v1/curation/bulk', () => {
    it('should approve multiple documents in bulk', async () => {
      const docIds = testDocuments.slice(0, 2).map(doc => doc.id);
      
      const response = await request(app)
        .post('/api/v1/curation/bulk')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          action: 'approve',
          itemIds: docIds,
          reason: 'Bulk approval for testing',
          curatorId: 'test-curator-1'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.summary.total).toBe(2);
      expect(response.body.summary.successful).toBe(2);
      expect(response.body.summary.failed).toBe(0);
    });

    it('should reject multiple documents in bulk', async () => {
      const docIds = testDocuments.slice(0, 2).map(doc => doc.id);
      
      const response = await request(app)
        .post('/api/v1/curation/bulk')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          action: 'reject',
          itemIds: docIds,
          reason: 'Bulk rejection for testing',
          curatorId: 'test-curator-1'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.summary.total).toBe(2);
      expect(response.body.summary.successful).toBe(2);
    });

    it('should validate bulk action parameters', async () => {
      await request(app)
        .post('/api/v1/curation/bulk')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          action: 'invalid_action',
          itemIds: [1, 2],
          curatorId: 'test-curator-1'
        })
        .expect(400);
    });

    it('should validate item IDs array', async () => {
      await request(app)
        .post('/api/v1/curation/bulk')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          action: 'approve',
          itemIds: 'not-an-array',
          curatorId: 'test-curator-1'
        })
        .expect(400);
    });
  });

  describe('GET /api/v1/curation/stats', () => {
    it('should return curation statistics', async () => {
      const response = await request(app)
        .get('/api/v1/curation/stats')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('timeframe');
      expect(response.body).toHaveProperty('stats');
      expect(response.body.stats).toHaveProperty('totalPending');
      expect(response.body.stats).toHaveProperty('totalInReview');
      expect(response.body.stats).toHaveProperty('totalProcessed');
      expect(response.body.stats).toHaveProperty('approvalRate');
      expect(response.body.stats).toHaveProperty('avgProcessingTime');
    });

    it('should accept timeframe parameter', async () => {
      const response = await request(app)
        .get('/api/v1/curation/stats?timeframe=24h')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.timeframe).toBe('24h');
    });
  });

  describe('GET /api/v1/curation/audit/:itemId', () => {
    it('should return audit trail for a document', async () => {
      const testDoc = testDocuments[0];
      
      const response = await request(app)
        .get(`/api/v1/curation/audit/${testDoc.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('itemId');
      expect(response.body).toHaveProperty('auditTrail');
      expect(response.body.itemId).toBe(testDoc.id.toString());
      expect(Array.isArray(response.body.auditTrail)).toBe(true);
    });

    it('should return empty audit trail for document without history', async () => {
      const testDoc = testDocuments[0];
      
      const response = await request(app)
        .get(`/api/v1/curation/audit/${testDoc.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.auditTrail).toEqual([]);
    });
  });

  describe('Error Handling', () => {
    it('should handle database connection errors gracefully', async () => {
      // Mock database error by passing invalid parameters
      const response = await request(app)
        .get('/api/v1/curation/items?limit=invalid')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(500);

      expect(response.body).toHaveProperty('error');
    });

    it('should handle missing required fields', async () => {
      await request(app)
        .post('/api/v1/curation/decision')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          // Missing required fields
        })
        .expect(400);
    });
  });

  describe('Authorization', () => {
    it('should require curator role for curation endpoints', async () => {
      // Test with invalid token
      await request(app)
        .get('/api/v1/curation/items')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);
    });

    it('should allow admin role access', async () => {
      const adminToken = 'test-admin-token';
      
      const response = await request(app)
        .get('/api/v1/curation/items')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('items');
    });
  });
});