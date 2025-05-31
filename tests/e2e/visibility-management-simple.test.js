/**
 * Simplified E2E tests for visibility management workflow
 * Tests the complete flow without browser automation
 */

const request = require('supertest');
const { spawn } = require('child_process');
const path = require('path');

describe('Visibility Management E2E Workflow', () => {
  let serverProcess;
  let baseUrl;

  beforeAll(async () => {
    // Start the web server
    return new Promise((resolve, reject) => {
      const serverPath = path.join(__dirname, '../../src/web/start.js');
      serverProcess = spawn('node', [serverPath], {
        env: { ...process.env, PORT: '0' }, // Use random port
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let output = '';
      serverProcess.stdout.on('data', (data) => {
        output += data.toString();
        // Look for server started message
        if (output.includes('Manual review server started')) {
          const portMatch = output.match(/port:\s*(\d+)/);
          if (portMatch) {
            baseUrl = `http://localhost:${portMatch[1]}`;
            resolve();
          }
        }
      });

      serverProcess.stderr.on('data', (data) => {
        console.error('Server error:', data.toString());
      });

      serverProcess.on('error', reject);

      // Timeout after 10 seconds
      setTimeout(() => {
        reject(new Error('Server failed to start within timeout'));
      }, 10000);
    });
  }, 15000);

  afterAll(async () => {
    if (serverProcess) {
      serverProcess.kill();
      // Wait for process to exit
      await new Promise((resolve) => {
        serverProcess.on('exit', resolve);
        setTimeout(resolve, 1000); // Fallback timeout
      });
    }
  });

  describe('Manual Review Interface', () => {
    it('should serve the main interface', async () => {
      const response = await request(baseUrl)
        .get('/')
        .expect(200);

      expect(response.text).toContain('TheWell Pipeline');
      expect(response.text).toContain('Manual Review');
      expect(response.text).toContain('visibility-view');
    });

    it('should serve static assets', async () => {
      await request(baseUrl)
        .get('/app.js')
        .expect(200);

      await request(baseUrl)
        .get('/styles.css')
        .expect(200);
    });
  });

  describe('API Endpoints', () => {
    it('should return system status', async () => {
      const response = await request(baseUrl)
        .get('/api/status')
        .expect(200);

      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('timestamp');
    });

    it('should handle review API endpoints', async () => {
      // Test documents endpoint (should work even without auth for basic structure)
      const response = await request(baseUrl)
        .get('/api/review/documents')
        .expect(200);

      expect(response.body).toHaveProperty('documents');
      expect(Array.isArray(response.body.documents)).toBe(true);
    });

    it('should handle jobs API endpoints', async () => {
      const response = await request(baseUrl)
        .get('/api/jobs/status')
        .expect(200);

      expect(response.body).toHaveProperty('status');
    });
  });

  describe('Visibility Management API Structure', () => {
    it('should have visibility endpoints available', async () => {
      // Test that visibility endpoints exist (even if they return 401/503)
      const endpoints = [
        '/api/visibility/document/test',
        '/api/visibility/approvals',
        '/api/visibility/rules',
        '/api/visibility/audit'
      ];

      for (const endpoint of endpoints) {
        const response = await request(baseUrl).get(endpoint);
        // Should not return 404 (endpoint exists)
        expect(response.status).not.toBe(404);
        // Should return either 401 (auth required) or 503 (not enabled) or 200
        expect([200, 401, 503]).toContain(response.status);
      }
    });

    it('should handle visibility document updates', async () => {
      const response = await request(baseUrl)
        .put('/api/visibility/document/test-doc')
        .send({ visibility: 'public', reason: 'Test' });

      // Should not return 404 (endpoint exists)
      expect(response.status).not.toBe(404);
      // Should return either 401 (auth required) or 503 (not enabled) or 400 (validation)
      expect([400, 401, 503]).toContain(response.status);
    });

    it('should handle bulk visibility updates', async () => {
      const response = await request(baseUrl)
        .put('/api/visibility/bulk-update')
        .send({
          updates: [{ documentId: 'doc1', visibility: 'internal' }],
          reason: 'Test bulk update'
        });

      // Should not return 404 (endpoint exists)
      expect(response.status).not.toBe(404);
      expect([400, 401, 503]).toContain(response.status);
    });
  });

  describe('Frontend Integration', () => {
    it('should include visibility management JavaScript', async () => {
      const response = await request(baseUrl)
        .get('/app.js')
        .expect(200);

      // Check for visibility management functions
      expect(response.text).toContain('loadVisibilityData');
      expect(response.text).toContain('setDocumentVisibility');
      expect(response.text).toContain('bulkUpdateVisibility');
      expect(response.text).toContain('approveVisibilityChange');
      expect(response.text).toContain('rejectVisibilityChange');
      expect(response.text).toContain('addVisibilityRule');
    });

    it('should include visibility management UI elements', async () => {
      const response = await request(baseUrl)
        .get('/')
        .expect(200);

      // Check for visibility UI elements
      expect(response.text).toContain('visibility-view');
      expect(response.text).toContain('visibility-documents-container');
      expect(response.text).toContain('pending-approvals-container');
      expect(response.text).toContain('visibility-rules-container');
      expect(response.text).toContain('audit-log-container');

      // Check for modals
      expect(response.text).toContain('bulkVisibilityModal');
      expect(response.text).toContain('addRuleModal');
      expect(response.text).toContain('documentVisibilityModal');
    });

    it('should include proper navigation for visibility tab', async () => {
      const response = await request(baseUrl)
        .get('/')
        .expect(200);

      expect(response.text).toContain('data-view="visibility"');
      expect(response.text).toContain('Visibility Management');
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid routes gracefully', async () => {
      await request(baseUrl)
        .get('/api/invalid-endpoint')
        .expect(404);
    });

    it('should handle malformed API requests', async () => {
      const response = await request(baseUrl)
        .post('/api/visibility/rules')
        .send({ invalid: 'data' });

      expect([400, 401, 503]).toContain(response.status);
    });
  });

  describe('Performance and Reliability', () => {
    it('should respond to multiple concurrent requests', async () => {
      const requests = Array(5).fill().map(() => 
        request(baseUrl).get('/api/status')
      );

      const responses = await Promise.all(requests);
      responses.forEach(response => {
        expect(response.status).toBe(200);
      });
    });

    it('should maintain consistent response times', async () => {
      const startTime = Date.now();
      
      await request(baseUrl)
        .get('/')
        .expect(200);
      
      const responseTime = Date.now() - startTime;
      expect(responseTime).toBeLessThan(5000); // Should respond within 5 seconds
    });
  });
});
