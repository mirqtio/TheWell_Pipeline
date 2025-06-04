/**
 * API Health Smoke Tests
 * Quick validation that the API is running and healthy
 */

const axios = require('axios');

// Get API URL from environment or use default
const API_URL = process.env.API_URL || 'http://localhost:3000';
const API_KEY = process.env.API_KEY || 'test-api-key';

// Configure axios defaults
const api = axios.create({
  baseURL: API_URL,
  timeout: 5000,
  headers: {
    'X-API-Key': API_KEY
  }
});

describe('API Health Smoke Tests', () => {
  test('Health endpoint returns 200', async () => {
    const response = await api.get('/health');
    
    expect(response.status).toBe(200);
    expect(response.data).toHaveProperty('success', true);
    expect(response.data.data).toHaveProperty('status', 'healthy');
  });

  test('Health endpoint includes component statuses', async () => {
    const response = await api.get('/health');
    
    expect(response.data.data).toHaveProperty('components');
    const components = response.data.data.components;
    
    // Check for expected components
    expect(components).toHaveProperty('ragManager');
    expect(components).toHaveProperty('cacheManager');
  });

  test('Database health check returns 200', async () => {
    const response = await api.get('/health/db');
    
    expect(response.status).toBe(200);
    expect(response.data).toHaveProperty('success', true);
  });

  test('Cache health check returns 200', async () => {
    const response = await api.get('/health/cache');
    
    expect(response.status).toBe(200);
    expect(response.data).toHaveProperty('success', true);
  });

  test('API requires authentication', async () => {
    // Make request without API key
    try {
      await axios.get(`${API_URL}/api/documents`);
      fail('Expected 401 error');
    } catch (error) {
      expect(error.response.status).toBe(401);
    }
  });

  test('API returns proper error format', async () => {
    try {
      await api.get('/api/nonexistent-endpoint');
      fail('Expected 404 error');
    } catch (error) {
      expect(error.response.status).toBe(404);
      expect(error.response.data).toHaveProperty('success', false);
      expect(error.response.data).toHaveProperty('error');
      expect(error.response.data).toHaveProperty('message');
    }
  });

  test('API version endpoint exists', async () => {
    const response = await api.get('/api/version');
    
    expect(response.status).toBe(200);
    expect(response.data).toHaveProperty('version');
    expect(response.data).toHaveProperty('name', 'TheWell Pipeline API');
  });

  test('Metrics endpoint is accessible', async () => {
    const response = await api.get('/metrics');
    
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.data).toContain('# HELP');
    expect(response.data).toContain('# TYPE');
  });

  test('API documentation is accessible', async () => {
    const response = await axios.get(`${API_URL}/api-docs`);
    
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
  });

  test('Response time is acceptable', async () => {
    const start = Date.now();
    await api.get('/health');
    const responseTime = Date.now() - start;
    
    // Health check should respond within 1 second
    expect(responseTime).toBeLessThan(1000);
  });
});