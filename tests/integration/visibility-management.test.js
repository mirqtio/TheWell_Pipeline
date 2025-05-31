/**
 * Integration tests for visibility management API endpoints
 */

const request = require('supertest');
const express = require('express');
const bodyParser = require('body-parser');

// Mock visibility management module
const mockVisibilityManager = {
  isEnabled: jest.fn().mockReturnValue(true),
  getDocumentVisibility: jest.fn(),
  setDocumentVisibility: jest.fn(),
  bulkUpdateVisibility: jest.fn(),
  getPendingApprovals: jest.fn(),
  approveVisibilityChange: jest.fn(),
  rejectVisibilityChange: jest.fn(),
  addVisibilityRule: jest.fn(),
  getVisibilityRules: jest.fn(),
  getAuditLog: jest.fn()
};

// Mock authentication middleware
const mockAuthMiddleware = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey || apiKey !== 'test-api-key') {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  req.user = { id: 'test-user', role: 'admin' };
  next();
};

// Create test app with visibility routes
function createTestApp() {
  const app = express();
  app.use(bodyParser.json());

  // Visibility routes
  app.get('/api/visibility/document/:documentId', mockAuthMiddleware, async (req, res) => {
    try {
      if (!mockVisibilityManager.isEnabled()) {
        return res.status(503).json({ error: 'Visibility management not enabled' });
      }

      const { documentId } = req.params;
      const visibility = await mockVisibilityManager.getDocumentVisibility(documentId);
      
      if (!visibility) {
        return res.status(404).json({ error: 'Document not found' });
      }

      res.json(visibility);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put('/api/visibility/document/:documentId', mockAuthMiddleware, async (req, res) => {
    try {
      if (!mockVisibilityManager.isEnabled()) {
        return res.status(503).json({ error: 'Visibility management not enabled' });
      }

      const { documentId } = req.params;
      const { visibility, reason, metadata } = req.body;

      if (!visibility) {
        return res.status(400).json({ error: 'Visibility is required' });
      }

      const validVisibilities = ['internal', 'external', 'restricted', 'public', 'draft', 'archived'];
      if (!validVisibilities.includes(visibility)) {
        return res.status(400).json({ error: 'Invalid visibility value' });
      }

      const result = await mockVisibilityManager.setDocumentVisibility(
        documentId,
        visibility,
        reason,
        req.user.id,
        metadata
      );

      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put('/api/visibility/bulk-update', mockAuthMiddleware, async (req, res) => {
    try {
      if (!mockVisibilityManager.isEnabled()) {
        return res.status(503).json({ error: 'Visibility management not enabled' });
      }

      const { updates, reason } = req.body;

      if (!Array.isArray(updates) || updates.length === 0) {
        return res.status(400).json({ error: 'Updates array is required' });
      }

      // Validate each update
      const validVisibilities = ['internal', 'external', 'restricted', 'public', 'draft', 'archived'];
      for (const update of updates) {
        if (!update.documentId || !update.visibility) {
          return res.status(400).json({ error: 'Each update must have documentId and visibility' });
        }
        if (!validVisibilities.includes(update.visibility)) {
          return res.status(400).json({ error: `Invalid visibility value: ${update.visibility}` });
        }
      }

      const result = await mockVisibilityManager.bulkUpdateVisibility(updates, reason, req.user.id);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/visibility/approvals', mockAuthMiddleware, async (req, res) => {
    try {
      if (!mockVisibilityManager.isEnabled()) {
        return res.status(503).json({ error: 'Visibility management not enabled' });
      }

      const approvals = await mockVisibilityManager.getPendingApprovals();
      res.json(approvals);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/visibility/approvals/:approvalId/approve', mockAuthMiddleware, async (req, res) => {
    try {
      if (!mockVisibilityManager.isEnabled()) {
        return res.status(503).json({ error: 'Visibility management not enabled' });
      }

      const { approvalId } = req.params;
      const { notes } = req.body;

      const result = await mockVisibilityManager.approveVisibilityChange(approvalId, req.user.id, notes);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/visibility/approvals/:approvalId/reject', mockAuthMiddleware, async (req, res) => {
    try {
      if (!mockVisibilityManager.isEnabled()) {
        return res.status(503).json({ error: 'Visibility management not enabled' });
      }

      const { approvalId } = req.params;
      const { reason } = req.body;

      const result = await mockVisibilityManager.rejectVisibilityChange(approvalId, req.user.id, reason);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/visibility/rules', mockAuthMiddleware, async (req, res) => {
    try {
      if (!mockVisibilityManager.isEnabled()) {
        return res.status(503).json({ error: 'Visibility management not enabled' });
      }

      const { ruleId, rule } = req.body;

      if (!ruleId || !rule) {
        return res.status(400).json({ error: 'ruleId and rule are required' });
      }

      if (!rule.name || !rule.visibility) {
        return res.status(400).json({ error: 'Rule must have name and visibility' });
      }

      const result = await mockVisibilityManager.addVisibilityRule(ruleId, rule, req.user.id);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/visibility/rules', mockAuthMiddleware, async (req, res) => {
    try {
      if (!mockVisibilityManager.isEnabled()) {
        return res.status(503).json({ error: 'Visibility management not enabled' });
      }

      const rules = await mockVisibilityManager.getVisibilityRules();
      res.json(rules);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/visibility/audit', mockAuthMiddleware, async (req, res) => {
    try {
      if (!mockVisibilityManager.isEnabled()) {
        return res.status(503).json({ error: 'Visibility management not enabled' });
      }

      const { documentId, limit = 50, offset = 0 } = req.query;
      const auditLog = await mockVisibilityManager.getAuditLog({ documentId, limit: parseInt(limit), offset: parseInt(offset) });
      res.json(auditLog);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  return app;
}

describe('Visibility Management API Integration Tests', () => {
  let app;

  beforeEach(() => {
    app = createTestApp();
    jest.clearAllMocks();
    mockVisibilityManager.isEnabled.mockReturnValue(true);
  });

  describe('GET /api/visibility/document/:documentId', () => {
    it('should get document visibility successfully', async () => {
      const mockVisibility = {
        documentId: 'doc1',
        visibility: 'internal',
        lastModified: '2023-01-01T00:00:00.000Z',
        modifiedBy: 'user1'
      };

      mockVisibilityManager.getDocumentVisibility.mockResolvedValue(mockVisibility);

      const response = await request(app)
        .get('/api/visibility/document/doc1')
        .set('x-api-key', 'test-api-key')
        .expect(200);

      expect(response.body).toEqual(mockVisibility);
      expect(mockVisibilityManager.getDocumentVisibility).toHaveBeenCalledWith('doc1');
    });

    it('should return 404 when document not found', async () => {
      mockVisibilityManager.getDocumentVisibility.mockResolvedValue(null);

      const response = await request(app)
        .get('/api/visibility/document/nonexistent')
        .set('x-api-key', 'test-api-key')
        .expect(404);

      expect(response.body.error).toBe('Document not found');
    });

    it('should return 401 when unauthorized', async () => {
      await request(app)
        .get('/api/visibility/document/doc1')
        .expect(401);
    });

    it('should return 503 when visibility management disabled', async () => {
      mockVisibilityManager.isEnabled.mockReturnValue(false);

      const response = await request(app)
        .get('/api/visibility/document/doc1')
        .set('x-api-key', 'test-api-key')
        .expect(503);

      expect(response.body.error).toBe('Visibility management not enabled');
    });
  });

  describe('PUT /api/visibility/document/:documentId', () => {
    it('should update document visibility successfully', async () => {
      const mockResult = {
        documentId: 'doc1',
        visibility: 'public',
        previousVisibility: 'internal',
        modifiedBy: 'test-user',
        modifiedAt: '2023-01-01T00:00:00.000Z'
      };

      mockVisibilityManager.setDocumentVisibility.mockResolvedValue(mockResult);

      const response = await request(app)
        .put('/api/visibility/document/doc1')
        .set('x-api-key', 'test-api-key')
        .send({
          visibility: 'public',
          reason: 'Making document public',
          metadata: { source: 'manual-review' }
        })
        .expect(200);

      expect(response.body).toEqual(mockResult);
      expect(mockVisibilityManager.setDocumentVisibility).toHaveBeenCalledWith(
        'doc1',
        'public',
        'Making document public',
        'test-user',
        { source: 'manual-review' }
      );
    });

    it('should return 400 when visibility is missing', async () => {
      const response = await request(app)
        .put('/api/visibility/document/doc1')
        .set('x-api-key', 'test-api-key')
        .send({ reason: 'Test reason' })
        .expect(400);

      expect(response.body.error).toBe('Visibility is required');
    });

    it('should return 400 when visibility is invalid', async () => {
      const response = await request(app)
        .put('/api/visibility/document/doc1')
        .set('x-api-key', 'test-api-key')
        .send({ visibility: 'invalid' })
        .expect(400);

      expect(response.body.error).toBe('Invalid visibility value');
    });
  });

  describe('PUT /api/visibility/bulk-update', () => {
    it('should bulk update visibility successfully', async () => {
      const updates = [
        { documentId: 'doc1', visibility: 'public' },
        { documentId: 'doc2', visibility: 'internal' }
      ];

      const mockResult = {
        updated: 2,
        failed: 0,
        results: updates.map(u => ({ ...u, success: true }))
      };

      mockVisibilityManager.bulkUpdateVisibility.mockResolvedValue(mockResult);

      const response = await request(app)
        .put('/api/visibility/bulk-update')
        .set('x-api-key', 'test-api-key')
        .send({
          updates,
          reason: 'Bulk update test'
        })
        .expect(200);

      expect(response.body).toEqual(mockResult);
      expect(mockVisibilityManager.bulkUpdateVisibility).toHaveBeenCalledWith(
        updates,
        'Bulk update test',
        'test-user'
      );
    });

    it('should return 400 when updates array is empty', async () => {
      const response = await request(app)
        .put('/api/visibility/bulk-update')
        .set('x-api-key', 'test-api-key')
        .send({ updates: [] })
        .expect(400);

      expect(response.body.error).toBe('Updates array is required');
    });

    it('should return 400 when update is missing required fields', async () => {
      const response = await request(app)
        .put('/api/visibility/bulk-update')
        .set('x-api-key', 'test-api-key')
        .send({
          updates: [{ documentId: 'doc1' }] // missing visibility
        })
        .expect(400);

      expect(response.body.error).toBe('Each update must have documentId and visibility');
    });
  });

  describe('GET /api/visibility/approvals', () => {
    it('should get pending approvals successfully', async () => {
      const mockApprovals = [
        {
          id: 'approval1',
          documentId: 'doc1',
          requestedBy: 'user1',
          requestedAt: '2023-01-01T00:00:00.000Z',
          currentVisibility: 'internal',
          requestedVisibility: 'public',
          reason: 'Need to make public'
        }
      ];

      mockVisibilityManager.getPendingApprovals.mockResolvedValue(mockApprovals);

      const response = await request(app)
        .get('/api/visibility/approvals')
        .set('x-api-key', 'test-api-key')
        .expect(200);

      expect(response.body).toEqual(mockApprovals);
    });
  });

  describe('POST /api/visibility/approvals/:approvalId/approve', () => {
    it('should approve visibility change successfully', async () => {
      const mockResult = {
        approvalId: 'approval1',
        status: 'approved',
        approvedBy: 'test-user',
        approvedAt: '2023-01-01T00:00:00.000Z'
      };

      mockVisibilityManager.approveVisibilityChange.mockResolvedValue(mockResult);

      const response = await request(app)
        .post('/api/visibility/approvals/approval1/approve')
        .set('x-api-key', 'test-api-key')
        .send({ notes: 'Approved for public access' })
        .expect(200);

      expect(response.body).toEqual(mockResult);
      expect(mockVisibilityManager.approveVisibilityChange).toHaveBeenCalledWith(
        'approval1',
        'test-user',
        'Approved for public access'
      );
    });
  });

  describe('POST /api/visibility/approvals/:approvalId/reject', () => {
    it('should reject visibility change successfully', async () => {
      const mockResult = {
        approvalId: 'approval1',
        status: 'rejected',
        rejectedBy: 'test-user',
        rejectedAt: '2023-01-01T00:00:00.000Z'
      };

      mockVisibilityManager.rejectVisibilityChange.mockResolvedValue(mockResult);

      const response = await request(app)
        .post('/api/visibility/approvals/approval1/reject')
        .set('x-api-key', 'test-api-key')
        .send({ reason: 'Security concerns' })
        .expect(200);

      expect(response.body).toEqual(mockResult);
      expect(mockVisibilityManager.rejectVisibilityChange).toHaveBeenCalledWith(
        'approval1',
        'test-user',
        'Security concerns'
      );
    });
  });

  describe('POST /api/visibility/rules', () => {
    it('should add visibility rule successfully', async () => {
      const rule = {
        name: 'PDF Auto-Internal',
        description: 'Automatically set PDF documents to internal',
        priority: 1,
        visibility: 'internal',
        conditions: { sourceType: 'PDF' }
      };

      const mockResult = {
        ruleId: 'rule1',
        rule,
        createdBy: 'test-user',
        createdAt: '2023-01-01T00:00:00.000Z'
      };

      mockVisibilityManager.addVisibilityRule.mockResolvedValue(mockResult);

      const response = await request(app)
        .post('/api/visibility/rules')
        .set('x-api-key', 'test-api-key')
        .send({ ruleId: 'rule1', rule })
        .expect(200);

      expect(response.body).toEqual(mockResult);
      expect(mockVisibilityManager.addVisibilityRule).toHaveBeenCalledWith(
        'rule1',
        rule,
        'test-user'
      );
    });

    it('should return 400 when rule is missing required fields', async () => {
      const response = await request(app)
        .post('/api/visibility/rules')
        .set('x-api-key', 'test-api-key')
        .send({
          ruleId: 'rule1',
          rule: { name: 'Test Rule' } // missing visibility
        })
        .expect(400);

      expect(response.body.error).toBe('Rule must have name and visibility');
    });
  });

  describe('GET /api/visibility/rules', () => {
    it('should get visibility rules successfully', async () => {
      const mockRules = [
        {
          ruleId: 'rule1',
          name: 'PDF Auto-Internal',
          visibility: 'internal',
          priority: 1,
          enabled: true
        }
      ];

      mockVisibilityManager.getVisibilityRules.mockResolvedValue(mockRules);

      const response = await request(app)
        .get('/api/visibility/rules')
        .set('x-api-key', 'test-api-key')
        .expect(200);

      expect(response.body).toEqual(mockRules);
    });
  });

  describe('GET /api/visibility/audit', () => {
    it('should get audit log successfully', async () => {
      const mockAuditLog = {
        entries: [
          {
            id: 'audit1',
            documentId: 'doc1',
            action: 'visibility_changed',
            previousVisibility: 'internal',
            newVisibility: 'public',
            changedBy: 'user1',
            changedAt: '2023-01-01T00:00:00.000Z',
            reason: 'Made public for sharing'
          }
        ],
        total: 1,
        limit: 50,
        offset: 0
      };

      mockVisibilityManager.getAuditLog.mockResolvedValue(mockAuditLog);

      const response = await request(app)
        .get('/api/visibility/audit')
        .set('x-api-key', 'test-api-key')
        .query({ documentId: 'doc1', limit: 10 })
        .expect(200);

      expect(response.body).toEqual(mockAuditLog);
      expect(mockVisibilityManager.getAuditLog).toHaveBeenCalledWith({
        documentId: 'doc1',
        limit: 10,
        offset: 0
      });
    });
  });

  describe('Error handling', () => {
    it('should handle internal server errors', async () => {
      mockVisibilityManager.getDocumentVisibility.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .get('/api/visibility/document/doc1')
        .set('x-api-key', 'test-api-key')
        .expect(500);

      expect(response.body.error).toBe('Database error');
    });
  });
});
