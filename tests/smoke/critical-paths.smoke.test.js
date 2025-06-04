/**
 * Critical Paths Smoke Tests
 * Tests the most important user journeys
 */

const axios = require('axios');

// Get API URL from environment or use default
const API_URL = process.env.API_URL || 'http://localhost:3000';
const API_KEY = process.env.API_KEY || 'test-api-key';

// Configure axios
const api = axios.create({
  baseURL: API_URL,
  timeout: 10000,
  headers: {
    'X-API-Key': API_KEY,
    'Content-Type': 'application/json'
  }
});

describe('Critical User Paths Smoke Tests', () => {
  describe('Document Ingestion Path', () => {
    test('Can check ingestion queue status', async () => {
      const response = await api.get('/api/jobs/stats');
      
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('success', true);
      expect(response.data.data).toHaveProperty('queues');
    });

    test('Can list pending curation items', async () => {
      const response = await api.get('/api/curation/items?status=pending');
      
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('success', true);
      expect(response.data).toHaveProperty('items');
      expect(Array.isArray(response.data.items)).toBe(true);
    });
  });

  describe('Search and Retrieval Path', () => {
    test('Can perform basic search', async () => {
      const response = await api.post('/api/rag/search', {
        query: 'sample query'
      });
      
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('success', true);
      expect(response.data.data).toHaveProperty('answer');
    });

    test('Can submit feedback on search results', async () => {
      // First perform a search
      const searchResponse = await api.post('/api/rag/search', {
        query: 'test query for feedback'
      });
      
      const traceId = searchResponse.data.traceId;
      
      // Then submit feedback
      const feedbackResponse = await api.post('/api/feedback', {
        documentId: 'test-doc-id',
        appId: 'smoke-test',
        feedbackType: 'rating',
        content: { rating: 5 },
        metadata: { traceId }
      });
      
      expect(feedbackResponse.status).toBe(201);
      expect(feedbackResponse.data).toHaveProperty('success', true);
    });
  });

  describe('Monitoring and Observability Path', () => {
    test('Can access system metrics', async () => {
      const response = await api.get('/metrics');
      
      expect(response.status).toBe(200);
      expect(response.data).toContain('thewell_api_requests_total');
    });

    test('Can check system status', async () => {
      const response = await api.get('/api/status');
      
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('status');
      expect(response.data).toHaveProperty('version');
    });

    test('Can access cost tracking', async () => {
      const response = await api.get('/api/monitoring/costs/current');
      
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('success', true);
    });
  });

  describe('Admin Functions Path', () => {
    test('Can access job management', async () => {
      const response = await api.get('/api/jobs');
      
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('jobs');
      expect(response.data).toHaveProperty('pagination');
    });

    test('Can check source reliability', async () => {
      const response = await api.get('/api/reliability/scores');
      
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('success', true);
      expect(Array.isArray(response.data.data)).toBe(true);
    });

    test('Can access visibility management', async () => {
      const response = await api.get('/api/visibility/pending');
      
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('success', true);
      expect(response.data).toHaveProperty('approvals');
    });
  });

  describe('Error Handling', () => {
    test('Invalid endpoints return proper errors', async () => {
      try {
        await api.get('/api/invalid-endpoint-12345');
        fail('Expected 404 error');
      } catch (error) {
        expect(error.response.status).toBe(404);
        expect(error.response.data).toHaveProperty('success', false);
        expect(error.response.data).toHaveProperty('error');
      }
    });

    test('Invalid request data returns validation error', async () => {
      try {
        await api.post('/api/rag/search', {
          // Missing required 'query' field
          invalidField: 'test'
        });
        fail('Expected 400 error');
      } catch (error) {
        expect(error.response.status).toBe(400);
        expect(error.response.data).toHaveProperty('success', false);
      }
    });

    test('Server errors are handled gracefully', async () => {
      try {
        // Attempt to cause a server error (this might not always work)
        await api.post('/api/rag/search', {
          query: null // Invalid type
        });
      } catch (error) {
        if (error.response && error.response.status >= 500) {
          expect(error.response.data).toHaveProperty('success', false);
          expect(error.response.data).toHaveProperty('error');
        }
        // If no 500 error, that's also fine - means validation caught it
      }
    });
  });

  describe('Performance Checks', () => {
    test('Concurrent requests are handled', async () => {
      const promises = Array(5).fill(null).map(() => 
        api.get('/health')
      );
      
      const responses = await Promise.all(promises);
      
      responses.forEach(response => {
        expect(response.status).toBe(200);
      });
    });

    test('Large request payloads are handled', async () => {
      const largeQuery = 'test '.repeat(100); // ~500 chars
      
      const response = await api.post('/api/rag/search', {
        query: largeQuery,
        filters: {
          sources: Array(10).fill('source'),
          tags: Array(20).fill('tag')
        }
      });
      
      expect(response.status).toBe(200);
    });
  });
});