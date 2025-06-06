/**
 * Feedback Workflows E2E Tests
 * Tests complete feedback workflows including submission, querying, updating, and aggregates
 */

jest.unmock('pg');

// E2E tests require a real PostgreSQL database
// These tests can be skipped if no database is available
let skipIfNoDatabase = process.env.SKIP_DB_TESTS === 'true';

const request = require('supertest');
const app = require('../../../src/web/app');
const DatabaseManager = require('../../../src/database/DatabaseManager');

describe('Feedback Workflows E2E Tests', () => {
  let server;
  let databaseManager;
  let testDocumentId;

  beforeAll(async () => {
    // Set up test database - use same config as database integration tests
    databaseManager = new DatabaseManager({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME || 'thewell_test',
      user: process.env.DB_USER || 'thewell_test',
      password: process.env.DB_PASSWORD || 'thewell_test_password'
    });

    await databaseManager.initialize();

    // Apply database schema
    try {
      await databaseManager.applySchema();
    } catch (error) {
      // Schema might already exist, try running the setup script
      console.log('Schema application warning:', error.message);
      
      // Run the test database setup
      const { setupTestSchema } = require('../../helpers/setup-test-db');
      await setupTestSchema();
    }

    // Create test document
    const testDoc = await databaseManager.query(
      `INSERT INTO documents (id, title, content) 
       VALUES (uuid_generate_v4(), 'Test Document', 'Test content') 
       RETURNING id`
    );
    testDocumentId = testDoc.rows[0].id;

    // Set up server with mock dependencies
    const mockQueueManager = {
      isInitialized: true,
      getQueueNames: () => ['test-queue'],
      getJobs: () => [],
      getJob: () => null
    };

    const mockIngestionEngine = {
      isInitialized: true,
      getRegisteredSources: () => []
    };

    // Set environment for development mode (bypass auth)
    process.env.NODE_ENV = 'development';
    
    // Set up app dependencies
    app.set('databaseManager', databaseManager);
    app.set('feedbackDAO', require('../../../src/database/FeedbackDAO'));
    
    // Start server
    const port = 3456; // Use specific port for this test
    server = app.listen(port);
  });

  afterAll(async () => {
    // Clean up test data
    if (testDocumentId) {
      await databaseManager.query('DELETE FROM feedback WHERE document_id = $1', [testDocumentId]);
      await databaseManager.query('DELETE FROM feedback_aggregates WHERE document_id = $1', [testDocumentId]);
      await databaseManager.query('DELETE FROM documents WHERE id = $1', [testDocumentId]);
    }

    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    
    await databaseManager.close();
  });

  afterEach(async () => {
    // Clean up feedback entries after each test
    await databaseManager.query('DELETE FROM feedback WHERE document_id = $1', [testDocumentId]);
    await databaseManager.query('DELETE FROM feedback_aggregates WHERE document_id = $1', [testDocumentId]);
  });

  describe('Complete Feedback Submission Workflow', () => {
    it('should handle complete feedback submission and retrieval workflow', async () => {
      // Step 1: Submit initial feedback
      const feedbackData = {
        documentId: testDocumentId,
        appId: 'e2e-app',
        feedbackType: 'rating',
        content: { 
          rating: 5, 
          comment: 'Excellent document for E2E testing',
          categories: ['accuracy', 'usefulness']
        },
        userId: 'e2e-user-1',
        sessionId: 'e2e-session-1'
      };

      const createResponse = await request(app)
        .post('/api/feedback')
        .send(feedbackData)
        .expect(201);

      expect(createResponse.body.success).toBe(true);
      const feedbackId = createResponse.body.data.feedback.id;

      // Step 2: Retrieve the feedback by ID
      const getResponse = await request(app)
        .get(`/api/feedback/${feedbackId}`)
        .expect(200);

      expect(getResponse.body.data.feedback).toMatchObject({
        id: feedbackId,
        document_id: testDocumentId,
        app_id: 'e2e-app',
        feedback_type: 'rating',
        content: feedbackData.content,
        user_id: 'e2e-user-1',
        session_id: 'e2e-session-1'
      });

      // Step 3: Update the feedback
      const updateData = {
        content: { 
          rating: 4, 
          comment: 'Updated comment after review',
          categories: ['accuracy', 'usefulness', 'clarity']
        }
      };

      const updateResponse = await request(app)
        .put(`/api/feedback/${feedbackId}`)
        .send(updateData)
        .expect(200);

      expect(updateResponse.body.data.feedback.content).toEqual(updateData.content);

      // Step 4: Retrieve feedback by document ID
      const docFeedbackResponse = await request(app)
        .get(`/api/feedback/document/${testDocumentId}`)
        .expect(200);

      expect(docFeedbackResponse.body.data.feedback).toHaveLength(1);
      expect(docFeedbackResponse.body.data.feedback[0].content).toEqual(updateData.content);
    });

    it('should handle multiple feedback submissions and aggregation workflow', async () => {
      // Submit multiple feedback entries
      const feedbackEntries = [
        {
          documentId: testDocumentId,
          appId: 'e2e-app',
          feedbackType: 'rating',
          content: { rating: 5, comment: 'Excellent' },
          userId: 'user-1'
        },
        {
          documentId: testDocumentId,
          appId: 'e2e-app',
          feedbackType: 'rating',
          content: { rating: 4, comment: 'Good' },
          userId: 'user-2'
        },
        {
          documentId: testDocumentId,
          appId: 'e2e-app',
          feedbackType: 'quality',
          content: { rating: 3, comment: 'Average quality' },
          userId: 'user-3'
        }
      ];

      // Use bulk creation
      const bulkResponse = await request(app)
        .post('/api/feedback/bulk')
        .send({ feedback: feedbackEntries })
        .expect(201);

      expect(bulkResponse.body.data.created).toBe(3);

      // Trigger aggregates update
      const FeedbackDAO = require('../../../src/database/FeedbackDAO');
      const feedbackDAO = new FeedbackDAO(databaseManager);
      await feedbackDAO.updateFeedbackAggregates(testDocumentId);

      // Check aggregates
      const aggregatesResponse = await request(app)
        .get(`/api/feedback/document/${testDocumentId}/aggregates`)
        .expect(200);

      expect(aggregatesResponse.body.data.aggregates).toMatchObject({
        document_id: testDocumentId,
        total_feedback: 3,
        average_rating: expect.any(Number)
      });

      // Check statistics
      const statsResponse = await request(app)
        .get(`/api/feedback/statistics?documentIds=${testDocumentId}`)
        .expect(200);

      expect(statsResponse.body.data.statistics).toMatchObject({
        total_feedback: 3,
        average_rating: expect.any(Number),
        feedback_by_type: expect.objectContaining({
          rating: expect.any(Number),
          quality: expect.any(Number)
        })
      });
    });
  });

  describe('Feedback Filtering and Pagination Workflow', () => {
    beforeEach(async () => {
      // Create test feedback with different types and users
      const feedbackEntries = [
        {
          documentId: testDocumentId,
          appId: 'e2e-app',
          feedbackType: 'rating',
          content: { rating: 5 },
          userId: 'filter-user-1'
        },
        {
          documentId: testDocumentId,
          appId: 'e2e-app',
          feedbackType: 'quality',
          content: { rating: 4 },
          userId: 'filter-user-2'
        },
        {
          documentId: testDocumentId,
          appId: 'e2e-app',
          feedbackType: 'rating',
          content: { rating: 3 },
          userId: 'filter-user-1'
        },
        {
          documentId: testDocumentId,
          appId: 'e2e-app',
          feedbackType: 'usefulness',
          content: { rating: 4 },
          userId: 'filter-user-3'
        }
      ];

      await request(app)
        .post('/api/feedback/bulk')
        .send({ feedback: feedbackEntries })
        .expect(201);
    });

    it('should filter feedback by type', async () => {
      const ratingResponse = await request(app)
        .get(`/api/feedback/document/${testDocumentId}?feedbackType=rating`)
        .expect(200);

      expect(ratingResponse.body.data.feedback).toHaveLength(2);
      ratingResponse.body.data.feedback.forEach(feedback => {
        expect(feedback.feedback_type).toBe('rating');
      });

      const qualityResponse = await request(app)
        .get(`/api/feedback/document/${testDocumentId}?feedbackType=quality`)
        .expect(200);

      expect(qualityResponse.body.data.feedback).toHaveLength(1);
      expect(qualityResponse.body.data.feedback[0].feedback_type).toBe('quality');
    });

    it('should handle pagination correctly', async () => {
      // Get first page
      const page1Response = await request(app)
        .get(`/api/feedback/document/${testDocumentId}?limit=2&offset=0`)
        .expect(200);

      expect(page1Response.body.data.feedback).toHaveLength(2);
      expect(page1Response.body.data.pagination).toMatchObject({
        total: 4,
        limit: 2,
        offset: 0
      });

      // Get second page
      const page2Response = await request(app)
        .get(`/api/feedback/document/${testDocumentId}?limit=2&offset=2`)
        .expect(200);

      expect(page2Response.body.data.feedback).toHaveLength(2);
      expect(page2Response.body.data.pagination).toMatchObject({
        total: 4,
        limit: 2,
        offset: 2
      });

      // Ensure no overlap between pages
      const page1Ids = page1Response.body.data.feedback.map(f => f.id);
      const page2Ids = page2Response.body.data.feedback.map(f => f.id);
      expect(page1Ids).not.toEqual(expect.arrayContaining(page2Ids));
    });

    it('should retrieve feedback by user ID', async () => {
      const userResponse = await request(app)
        .get('/api/feedback/user/filter-user-1')
        .expect(200);

      expect(userResponse.body.data.feedback).toHaveLength(2);
      userResponse.body.data.feedback.forEach(feedback => {
        expect(feedback.user_id).toBe('filter-user-1');
      });
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle invalid feedback data gracefully', async () => {
      const invalidData = {
        documentId: '00000000-0000-0000-0000-000000000001', // Use a valid UUID format that doesn't exist
        appId: 'test-app',
        feedbackType: 'rating',
        content: { rating: 'invalid' }
      };

      const response = await request(app)
        .post('/api/feedback')
        .send(invalidData)
        .expect(404); // Expect 404 for non-existent document, not 500

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Document not found');
    });

    it('should handle non-existent document gracefully', async () => {
      const fakeDocId = '00000000-0000-0000-0000-000000000000';
      
      const response = await request(app)
        .get(`/api/feedback/document/${fakeDocId}`)
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Document not found');
    });

    it('should handle feedback deletion workflow', async () => {
      // Create feedback
      const createResponse = await request(app)
        .post('/api/feedback')
        .send({
          documentId: testDocumentId,
          appId: 'e2e-app',
          feedbackType: 'rating',
          content: { rating: 3 },
          userId: 'delete-user'
        })
        .expect(201);

      const feedbackId = createResponse.body.data.feedback.id;

      // Delete feedback
      await request(app)
        .delete(`/api/feedback/${feedbackId}`)
        .expect(200);

      // Verify deletion
      await request(app)
        .get(`/api/feedback/${feedbackId}`)
        .expect(404);
    });
  });
});
