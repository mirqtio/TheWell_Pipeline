/**
 * Live E2E tests for visibility management using existing server
 * Tests against the running development server
 */

const request = require('supertest');

describe('Visibility Management Live E2E Tests', () => {
  const baseUrl = 'http://localhost:3001'; // Use the running server

  describe('Server Connectivity', () => {
    it('should connect to the running server', async () => {
      const response = await request(baseUrl)
        .get('/api/status')
        .expect(200);

      expect(response.body).toHaveProperty('status');
    });
  });

  describe('Frontend Assets', () => {
    it('should serve the main interface with visibility features', async () => {
      const response = await request(baseUrl)
        .get('/')
        .expect(200);

      expect(response.text).toContain('TheWell Pipeline');
      expect(response.text).toContain('visibility-view');
      expect(response.text).toContain('data-view="visibility"');
    });

    it('should serve JavaScript with visibility functions', async () => {
      const response = await request(baseUrl)
        .get('/app.js')
        .expect(200);

      // Check for key visibility management functions
      expect(response.text).toContain('loadVisibilityData');
      expect(response.text).toContain('setDocumentVisibility');
      expect(response.text).toContain('bulkUpdateVisibility');
    });

    it('should serve CSS with visibility styling', async () => {
      const response = await request(baseUrl)
        .get('/styles.css')
        .expect(200);

      expect(response.text.length).toBeGreaterThan(0);
    });
  });

  describe('API Endpoint Structure', () => {
    it('should have visibility document endpoint', async () => {
      const response = await request(baseUrl)
        .get('/api/visibility/document/test-doc');

      // Should not be 404 (endpoint exists)
      expect(response.status).not.toBe(404);
    });

    it('should have visibility approvals endpoint', async () => {
      const response = await request(baseUrl)
        .get('/api/visibility/approvals');

      expect(response.status).not.toBe(404);
    });

    it('should have visibility rules endpoint', async () => {
      const response = await request(baseUrl)
        .get('/api/visibility/rules');

      expect(response.status).not.toBe(404);
    });

    it('should have visibility audit endpoint', async () => {
      const response = await request(baseUrl)
        .get('/api/visibility/audit');

      expect(response.status).not.toBe(404);
    });
  });

  describe('UI Component Integration', () => {
    it('should include all required visibility UI elements', async () => {
      const response = await request(baseUrl)
        .get('/')
        .expect(200);

      const requiredElements = [
        'visibility-documents-container',
        'pending-approvals-container', 
        'visibility-rules-container',
        'audit-log-container',
        'bulkVisibilityModal',
        'addRuleModal',
        'documentVisibilityModal'
      ];

      requiredElements.forEach(element => {
        expect(response.text).toContain(element);
      });
    });

    it('should include visibility navigation tabs', async () => {
      const response = await request(baseUrl)
        .get('/')
        .expect(200);

      expect(response.text).toContain('visibility-tabs');
      expect(response.text).toContain('Documents');
      expect(response.text).toContain('Pending Approvals');
      expect(response.text).toContain('Rules');
      expect(response.text).toContain('Audit Log');
    });
  });

  describe('API Response Structure', () => {
    it('should handle review documents API', async () => {
      const response = await request(baseUrl)
        .get('/api/review/documents')
        .expect(200);

      expect(response.body).toHaveProperty('documents');
      expect(Array.isArray(response.body.documents)).toBe(true);
    });

    it('should handle jobs status API', async () => {
      const response = await request(baseUrl)
        .get('/api/jobs/status')
        .expect(200);

      expect(response.body).toHaveProperty('status');
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for invalid routes', async () => {
      await request(baseUrl)
        .get('/api/nonexistent-endpoint')
        .expect(404);
    });

    it('should handle malformed requests gracefully', async () => {
      const response = await request(baseUrl)
        .post('/api/visibility/document/test')
        .send({ invalid: 'data' });

      // Should return proper error status, not crash
      expect([400, 401, 503]).toContain(response.status);
    });
  });

  describe('Performance Validation', () => {
    it('should respond to status requests quickly', async () => {
      const startTime = Date.now();
      
      await request(baseUrl)
        .get('/api/status')
        .expect(200);
      
      const responseTime = Date.now() - startTime;
      expect(responseTime).toBeLessThan(1000); // Should respond within 1 second
    });

    it('should handle concurrent requests', async () => {
      const requests = Array(3).fill().map(() => 
        request(baseUrl).get('/api/status')
      );

      const responses = await Promise.all(requests);
      responses.forEach(response => {
        expect(response.status).toBe(200);
      });
    });
  });

  describe('Feature Integration Validation', () => {
    it('should have complete visibility management workflow', async () => {
      const response = await request(baseUrl)
        .get('/app.js')
        .expect(200);

      // Verify all core workflow functions exist
      const requiredFunctions = [
        'loadVisibilityData',
        'loadVisibilityDocuments',
        'loadPendingApprovals', 
        'setDocumentVisibility',
        'bulkUpdateVisibility',
        'approveVisibilityChange',
        'rejectVisibilityChange',
        'addVisibilityRule',
        'getVisibilityBadge'
      ];

      requiredFunctions.forEach(func => {
        expect(response.text).toContain(func);
      });
    });

    it('should have proper modal and form integration', async () => {
      const response = await request(baseUrl)
        .get('/')
        .expect(200);

      // Check for form elements and modals
      expect(response.text).toContain('bulk-visibility-form');
      expect(response.text).toContain('document-visibility-form');
      expect(response.text).toContain('add-rule-form');
      expect(response.text).toContain('modal-backdrop');
    });
  });
});
