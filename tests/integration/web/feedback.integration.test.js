/**
 * Feedback API Integration Tests
 * Tests the feedback API endpoints with real database operations
 */

jest.unmock('pg');

const request = require('supertest');
const express = require('express');
const DatabaseManager = require('../../../src/database/DatabaseManager');
const FeedbackDAO = require('../../../src/database/FeedbackDAO');
const feedbackRoutes = require('../../../src/web/routes/feedback');

// Integration tests require a real PostgreSQL database
// These tests can be skipped if no database is available
let skipIfNoDatabase = process.env.SKIP_DB_TESTS === 'true';

(skipIfNoDatabase ? describe.skip : describe)('Feedback API Integration Tests', () => {
  let app;
  let databaseManager;
  let feedbackDAO;
  let testDocumentId;
  let testFeedbackId;
  let testSourceId;

  beforeAll(async () => {
    // Set up test database - use same config as database integration tests
    databaseManager = new DatabaseManager({
      host: process.env.TEST_DB_HOST || 'localhost',
      port: process.env.TEST_DB_PORT || 5432,
      database: process.env.TEST_DB_NAME || 'thewell_pipeline_test',
      user: process.env.TEST_DB_USER || 'charlieirwin',
      password: process.env.TEST_DB_PASSWORD || 'password'
    });

    try {
      await databaseManager.initialize();
    } catch (error) {
      console.log('Database not available, skipping feedback integration tests:', error.message);
      return;
    }
    
    // Apply database schema
    try {
      await databaseManager.applySchema();
    } catch (error) {
      // Schema might already exist, ignore errors
    }
    
    feedbackDAO = new FeedbackDAO(databaseManager);

    // Set up Express app
    app = express();
    app.use(express.json());
    app.set('feedbackDAO', feedbackDAO);
    app.use('/api/feedback', feedbackRoutes);

    // Create test document
    try {
      const uniqueSourceName = `test-source-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const testSource = await databaseManager.query(
        `INSERT INTO sources (name, type, config) 
         VALUES ($1, 'test', '{}') 
         RETURNING id`,
        [uniqueSourceName]
      );
      testSourceId = testSource.rows[0].id;
      
      const testDoc = await databaseManager.query(
        `INSERT INTO documents (source_id, title, content) 
         VALUES ($1, 'Test Document', 'Test content') 
         RETURNING id`,
        [testSourceId]
      );
      if (!testDoc || !testDoc.rows || testDoc.rows.length === 0) {
        throw new Error('Failed to create test document - no rows returned');
      }
      testDocumentId = testDoc.rows[0].id;
    } catch (error) {
      console.error('Failed to create test document:', error.message);
      throw error;
    }
  }, 30000);

  afterAll(async () => {
    if (!databaseManager) {
      return;
    }
    
    // Clean up test data
    try {
      if (testDocumentId) {
        await databaseManager.query('DELETE FROM feedback WHERE document_id = $1', [testDocumentId]);
        await databaseManager.query('DELETE FROM documents WHERE id = $1', [testDocumentId]);
      }
      if (testSourceId) {
        await databaseManager.query('DELETE FROM sources WHERE id = $1', [testSourceId]);
      }
    } catch (error) {
      console.log('Cleanup error (non-fatal):', error.message);
    }
    
    await databaseManager.close();
  });

  afterEach(async () => {
    // Clean up feedback entries after each test
    await databaseManager.query('DELETE FROM feedback WHERE document_id = $1', [testDocumentId]);
  });

  describe('POST /api/feedback', () => {
    it('should create new feedback entry', async () => {
      const feedbackData = {
        documentId: testDocumentId,
        appId: 'test-app',
        feedbackType: 'rating',
        content: { rating: 5, comment: 'Excellent document' },
        userId: 'test-user-1',
        sessionId: 'test-session-1'
      };

      const response = await request(app)
        .post('/api/feedback')
        .send(feedbackData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.feedback).toMatchObject({
        document_id: testDocumentId,
        app_id: 'test-app',
        feedback_type: 'rating',
        content: { rating: 5, comment: 'Excellent document' },
        user_id: 'test-user-1',
        session_id: 'test-session-1'
      });

      testFeedbackId = response.body.data.feedback.id;
    });

    it('should return 400 for missing required fields', async () => {
      const response = await request(app)
        .post('/api/feedback')
        .send({
          documentId: testDocumentId,
          // Missing appId, feedbackType, content
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Missing required fields');
    });
  });

  describe('GET /api/feedback/:id', () => {
    beforeEach(async () => {
      const feedback = await feedbackDAO.createFeedback({
        documentId: testDocumentId,
        appId: 'test-app',
        feedbackType: 'rating',
        content: { rating: 4, comment: 'Good document' },
        userId: 'test-user-1',
        sessionId: 'test-session-1'
      });
      testFeedbackId = feedback.id;
    });

    it('should retrieve feedback by ID', async () => {
      const response = await request(app)
        .get(`/api/feedback/${testFeedbackId}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.feedback).toMatchObject({
        id: testFeedbackId,
        document_id: testDocumentId,
        app_id: 'test-app',
        feedback_type: 'rating',
        content: { rating: 4, comment: 'Good document' }
      });
    });

    it('should return 404 for non-existent feedback', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const response = await request(app)
        .get(`/api/feedback/${fakeId}`)
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Feedback not found');
    });
  });

  describe('GET /api/feedback/document/:documentId', () => {
    beforeEach(async () => {
      // Create multiple feedback entries
      await feedbackDAO.createFeedback({
        documentId: testDocumentId,
        appId: 'test-app',
        feedbackType: 'rating',
        content: { rating: 5 },
        userId: 'user-1'
      });

      await feedbackDAO.createFeedback({
        documentId: testDocumentId,
        appId: 'test-app',
        feedbackType: 'quality',
        content: { rating: 4 },
        userId: 'user-2'
      });
    });

    it('should retrieve feedback by document ID', async () => {
      const response = await request(app)
        .get(`/api/feedback/document/${testDocumentId}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.feedback).toHaveLength(2);
      expect(response.body.data.pagination).toMatchObject({
        total: 2,
        limit: 50,
        offset: 0
      });
    });

    it('should filter feedback by type', async () => {
      const response = await request(app)
        .get(`/api/feedback/document/${testDocumentId}?feedbackType=rating`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.feedback).toHaveLength(1);
      expect(response.body.data.feedback[0].feedback_type).toBe('rating');
    });

    it('should support pagination', async () => {
      const response = await request(app)
        .get(`/api/feedback/document/${testDocumentId}?limit=1&offset=0`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.feedback).toHaveLength(1);
      expect(response.body.data.pagination.limit).toBe(1);
    });
  });

  describe('PUT /api/feedback/:id', () => {
    beforeEach(async () => {
      const feedback = await feedbackDAO.createFeedback({
        documentId: testDocumentId,
        appId: 'test-app',
        feedbackType: 'rating',
        content: { rating: 3, comment: 'Average' },
        userId: 'test-user-1'
      });
      testFeedbackId = feedback.id;
    });

    it('should update feedback content', async () => {
      const updateData = {
        content: { rating: 5, comment: 'Updated to excellent!' }
      };

      const response = await request(app)
        .put(`/api/feedback/${testFeedbackId}`)
        .send(updateData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.feedback.content).toEqual({
        rating: 5,
        comment: 'Updated to excellent!'
      });
    });

    it('should return 404 for non-existent feedback', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const response = await request(app)
        .put(`/api/feedback/${fakeId}`)
        .send({ content: { rating: 5 } })
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });

  describe('DELETE /api/feedback/:id', () => {
    beforeEach(async () => {
      const feedback = await feedbackDAO.createFeedback({
        documentId: testDocumentId,
        appId: 'test-app',
        feedbackType: 'rating',
        content: { rating: 3 },
        userId: 'test-user-1'
      });
      testFeedbackId = feedback.id;
    });

    it('should delete feedback', async () => {
      const response = await request(app)
        .delete(`/api/feedback/${testFeedbackId}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Feedback deleted successfully');

      // Verify deletion
      const getResponse = await request(app)
        .get(`/api/feedback/${testFeedbackId}`)
        .expect(404);
    });
  });

  describe('GET /api/feedback/document/:documentId/aggregates', () => {
    beforeEach(async () => {
      // Create feedback entries to generate aggregates
      await feedbackDAO.createFeedback({
        documentId: testDocumentId,
        appId: 'test-app',
        feedbackType: 'rating',
        content: { rating: 5 },
        userId: 'user-1'
      });

      await feedbackDAO.createFeedback({
        documentId: testDocumentId,
        appId: 'test-app',
        feedbackType: 'rating',
        content: { rating: 4 },
        userId: 'user-2'
      });

      // Update aggregates
      await feedbackDAO.updateFeedbackAggregates(testDocumentId);
    });

    it('should retrieve feedback aggregates', async () => {
      const response = await request(app)
        .get(`/api/feedback/document/${testDocumentId}/aggregates`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.aggregates).toMatchObject({
        document_id: testDocumentId,
        total_feedback: 2,
        average_rating: 4.5
      });
    });
  });

  describe('GET /api/feedback/statistics', () => {
    beforeEach(async () => {
      // Create feedback entries for statistics
      await feedbackDAO.createFeedback({
        documentId: testDocumentId,
        appId: 'test-app',
        feedbackType: 'rating',
        content: { rating: 5 },
        userId: 'user-1'
      });

      await feedbackDAO.createFeedback({
        documentId: testDocumentId,
        appId: 'test-app',
        feedbackType: 'quality',
        content: { rating: 4 },
        userId: 'user-2'
      });
    });

    it('should retrieve feedback statistics', async () => {
      const response = await request(app)
        .get('/api/feedback/statistics')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.statistics).toMatchObject({
        total_feedback: expect.any(Number),
        average_rating: expect.any(Number),
        feedback_by_type: expect.any(Object)
      });
    });

    it('should filter statistics by document IDs', async () => {
      const response = await request(app)
        .get(`/api/feedback/statistics?documentIds=${testDocumentId}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.statistics.total_feedback).toBe(2);
    });
  });

  describe('GET /api/feedback/trends', () => {
    beforeEach(async () => {
      // Create feedback entries for trends
      await feedbackDAO.createFeedback({
        documentId: testDocumentId,
        appId: 'test-app',
        feedbackType: 'rating',
        content: { rating: 5 },
        userId: 'user-1'
      });
    });

    it('should retrieve feedback trends', async () => {
      const response = await request(app)
        .get('/api/feedback/trends?groupBy=day')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.trends).toBeInstanceOf(Array);
      expect(response.body.data.trends.length).toBeGreaterThan(0);
    });

    it('should filter trends by document ID', async () => {
      const response = await request(app)
        .get(`/api/feedback/trends?documentId=${testDocumentId}&groupBy=day`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.trends).toBeInstanceOf(Array);
    });
  });

  describe('POST /api/feedback/bulk', () => {
    it('should create multiple feedback entries', async () => {
      const feedbackEntries = [
        {
          documentId: testDocumentId,
          appId: 'test-app',
          feedbackType: 'rating',
          content: { rating: 5 },
          userId: 'user-1',
          sessionId: 'session-1'
        },
        {
          documentId: testDocumentId,
          appId: 'test-app',
          feedbackType: 'quality',
          content: { rating: 4 },
          userId: 'user-2',
          sessionId: 'session-2'
        }
      ];

      const response = await request(app)
        .post('/api/feedback/bulk')
        .send({ feedback: feedbackEntries })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.results).toHaveLength(2);
      expect(response.body.data.created).toBe(2);
    });

    it('should return 400 for invalid bulk data', async () => {
      const response = await request(app)
        .post('/api/feedback/bulk')
        .send({ feedback: 'invalid' })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Invalid feedback data');
    });
  });

  describe('Error handling', () => {
    it('should return 503 when feedbackDAO is not available', async () => {
      const testApp = express();
      testApp.use(express.json());
      // Don't set feedbackDAO
      testApp.use('/api/feedback', feedbackRoutes);

      const response = await request(testApp)
        .get('/api/feedback/test')
        .expect(503);

      expect(response.body.error).toBe('Feedback service unavailable');
    });
  });
});
