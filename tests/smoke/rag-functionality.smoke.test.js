/**
 * RAG Functionality Smoke Tests
 * Quick validation that RAG search is working
 */

const axios = require('axios');

// Get API URL from environment or use default
const API_URL = process.env.API_URL || 'http://localhost:3000';
const API_KEY = process.env.API_KEY || 'test-api-key';

// Configure axios
const api = axios.create({
  baseURL: API_URL,
  timeout: 10000, // 10 seconds for RAG queries
  headers: {
    'X-API-Key': API_KEY,
    'Content-Type': 'application/json'
  }
});

describe('RAG Functionality Smoke Tests', () => {
  test('RAG search endpoint is accessible', async () => {
    const response = await api.post('/api/rag/search', {
      query: 'test query'
    });
    
    expect(response.status).toBe(200);
    expect(response.data).toHaveProperty('success', true);
    expect(response.data).toHaveProperty('data');
  });

  test('RAG search returns expected structure', async () => {
    const response = await api.post('/api/rag/search', {
      query: 'What is machine learning?'
    });
    
    expect(response.data.data).toHaveProperty('answer');
    expect(response.data.data).toHaveProperty('sources');
    expect(response.data.data).toHaveProperty('metadata');
    expect(Array.isArray(response.data.data.sources)).toBe(true);
  });

  test('RAG search respects SLA (<2s)', async () => {
    const start = Date.now();
    
    await api.post('/api/rag/search', {
      query: 'Quick test query'
    });
    
    const responseTime = Date.now() - start;
    
    // Should respond within 2 seconds as per SLA
    expect(responseTime).toBeLessThan(2000);
  });

  test('RAG search handles filters', async () => {
    const response = await api.post('/api/rag/search', {
      query: 'test query',
      filters: {
        sources: ['web-scraper'],
        dateRange: {
          start: '2024-01-01',
          end: '2024-12-31'
        }
      }
    });
    
    expect(response.status).toBe(200);
    expect(response.data).toHaveProperty('success', true);
  });

  test('RAG search handles options', async () => {
    const response = await api.post('/api/rag/search', {
      query: 'test query',
      options: {
        maxResults: 5,
        includeMetadata: true,
        responseFormat: 'json'
      }
    });
    
    expect(response.status).toBe(200);
    expect(response.data.data.sources.length).toBeLessThanOrEqual(5);
  });

  test('RAG capabilities endpoint works', async () => {
    const response = await api.get('/api/rag/capabilities');
    
    expect(response.status).toBe(200);
    expect(response.data.data).toHaveProperty('version');
    expect(response.data.data).toHaveProperty('supportedFormats');
    expect(response.data.data).toHaveProperty('maxQueryLength');
  });

  test('RAG feedback endpoint accepts feedback', async () => {
    // First do a search to get a trace ID
    const searchResponse = await api.post('/api/rag/search', {
      query: 'test for feedback'
    });
    
    const traceId = searchResponse.data.traceId;
    
    // Submit feedback
    const feedbackResponse = await api.post('/api/rag/feedback', {
      trace_id: traceId,
      rating: 4,
      feedback_type: 'helpful',
      comment: 'Test feedback'
    });
    
    expect(feedbackResponse.status).toBe(200);
    expect(feedbackResponse.data).toHaveProperty('success', true);
  });

  test('RAG handles empty query gracefully', async () => {
    try {
      await api.post('/api/rag/search', {
        query: ''
      });
      fail('Expected 400 error');
    } catch (error) {
      expect(error.response.status).toBe(400);
      expect(error.response.data).toHaveProperty('success', false);
    }
  });

  test('RAG handles long queries', async () => {
    const longQuery = 'a'.repeat(500); // 500 character query
    
    const response = await api.post('/api/rag/search', {
      query: longQuery
    });
    
    expect(response.status).toBe(200);
  });

  test('RAG includes trace ID for debugging', async () => {
    const response = await api.post('/api/rag/search', {
      query: 'debugging test'
    });
    
    expect(response.data).toHaveProperty('traceId');
    expect(typeof response.data.traceId).toBe('string');
    expect(response.data.traceId.length).toBeGreaterThan(0);
  });
});