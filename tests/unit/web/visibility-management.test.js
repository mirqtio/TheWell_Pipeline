/**
 * Unit tests for visibility management frontend functionality
 */

const { JSDOM } = require('jsdom');

// Mock Bootstrap
global.bootstrap = {
  Modal: class {
    constructor(element) {
      this.element = element;
    }
    show() {}
    hide() {}
    static getInstance(element) {
      return new this(element);
    }
  },
  Toast: class {
    constructor(element) {
      this.element = element;
    }
    show() {}
  }
};

// Mock fetch
global.fetch = jest.fn();

describe('Visibility Management Frontend', () => {
  let dom;
  let document;
  let window;
  let ManualReviewApp;
  let app;

  beforeEach(() => {
    // Setup DOM
    dom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <head><title>Test</title></head>
        <body>
          <div id="visibility-documents-container"></div>
          <div id="pending-approvals-container"></div>
          <div id="pending-approvals-count">0</div>
          <div id="visibility-rules-container"></div>
          <div id="audit-log-container"></div>
          
          <!-- Modals -->
          <div id="bulkVisibilityModal">
            <form id="bulkVisibilityForm">
              <textarea id="bulkDocumentIds"></textarea>
              <select id="bulkVisibilitySelect"></select>
              <textarea id="bulkVisibilityReason"></textarea>
            </form>
          </div>
          
          <div id="addRuleModal">
            <form id="addRuleForm">
              <input id="ruleId" />
              <input id="ruleName" />
              <input id="ruleDescription" />
              <input id="rulePriority" type="number" value="1" />
              <select id="ruleVisibility"></select>
              <textarea id="ruleConditions"></textarea>
            </form>
          </div>
          
          <div id="documentVisibilityModal">
            <form id="documentVisibilityForm">
              <input id="documentVisibilityDocumentId" />
              <select id="documentVisibilitySelect"></select>
              <textarea id="documentVisibilityReason"></textarea>
            </form>
          </div>
          
          <input id="auditDocumentSearch" />
        </body>
      </html>
    `, {
      url: 'http://localhost:3000',
      pretendToBeVisual: true,
      resources: 'usable'
    });

    document = dom.window.document;
    window = dom.window;
    
    // Setup globals
    global.document = document;
    global.window = window;
    global.localStorage = {
      getItem: jest.fn().mockReturnValue('test-api-key'),
      setItem: jest.fn()
    };

    // Load the app class (simplified version for testing)
    ManualReviewApp = class {
      constructor() {
        this.apiKey = 'test-api-key';
        this.currentView = 'visibility';
        this.loadingStates = new Set();
      }

      async loadVisibilityData() {
        if (this.currentView !== 'visibility') return;
        await Promise.all([
          this.loadVisibilityDocuments(),
          this.loadPendingApprovals(),
          this.loadVisibilityRules(),
          this.loadAuditLog()
        ]);
      }

      async loadVisibilityDocuments() {
        const container = document.getElementById('visibility-documents-container');
        if (!container) return;

        try {
          this.setLoading('visibility-documents', true);
          const response = await this.apiCall('/api/review/documents', { method: 'GET' });
          
          if (response.success && response.data) {
            this.renderVisibilityDocuments(response.data.documents || []);
          } else {
            throw new Error(response.error || 'Failed to load documents');
          }
        } catch (error) {
          container.innerHTML = `
            <div class="alert alert-danger">
              <i class="bi bi-exclamation-triangle"></i>
              Failed to load documents: ${error.message}
            </div>
          `;
        } finally {
          this.setLoading('visibility-documents', false);
        }
      }

      renderVisibilityDocuments(documents) {
        const container = document.getElementById('visibility-documents-container');
        if (!container) return;

        if (documents.length === 0) {
          container.innerHTML = `
            <div class="text-center py-4">
              <i class="bi bi-inbox" style="font-size: 3rem; color: #6c757d;"></i>
              <p class="mt-2 text-muted">No documents found</p>
            </div>
          `;
          return;
        }

        const documentsHtml = documents.map(doc => {
          const visibilityBadge = this.getVisibilityBadge(doc.visibility || 'internal');
          const lastModified = doc.lastModified ? new Date(doc.lastModified).toLocaleDateString() : 'Unknown';
          
          return `
            <div class="card mb-3 document-card" data-document-id="${doc.id}">
              <div class="card-body">
                <div class="row align-items-center">
                  <div class="col-md-6">
                    <h6 class="card-title mb-1">${this.escapeHtml(doc.title || doc.id)}</h6>
                    <small class="text-muted">
                      <i class="bi bi-calendar"></i> ${lastModified}
                      <span class="ms-2">
                        <i class="bi bi-file-text"></i> ${doc.sourceType || 'Unknown'}
                      </span>
                    </small>
                  </div>
                  <div class="col-md-3 text-center">
                    ${visibilityBadge}
                  </div>
                  <div class="col-md-3 text-end">
                    <div class="btn-group" role="group">
                      <button class="btn btn-outline-primary btn-sm" onclick="showDocumentVisibilityModal('${doc.id}', '${doc.visibility || 'internal'}')">
                        <i class="bi bi-pencil"></i> Change
                      </button>
                      <button class="btn btn-outline-info btn-sm" onclick="viewDocumentAudit('${doc.id}')">
                        <i class="bi bi-clock-history"></i> Audit
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          `;
        }).join('');

        container.innerHTML = documentsHtml;
      }

      getVisibilityBadge(visibility) {
        const badges = {
          'internal': '<span class="badge bg-primary">Internal</span>',
          'external': '<span class="badge bg-info">External</span>',
          'restricted': '<span class="badge bg-warning text-dark">Restricted</span>',
          'public': '<span class="badge bg-success">Public</span>',
          'draft': '<span class="badge bg-secondary">Draft</span>',
          'archived': '<span class="badge bg-dark">Archived</span>'
        };
        return badges[visibility] || '<span class="badge bg-light text-dark">Unknown</span>';
      }

      async loadPendingApprovals() {
        const container = document.getElementById('pending-approvals-container');
        const countBadge = document.getElementById('pending-approvals-count');
        if (!container) return;

        try {
          this.setLoading('pending-approvals', true);
          const response = await this.apiCall('/api/visibility/approvals', { method: 'GET' });

          if (response.success && response.data) {
            const approvals = response.data;
            this.renderPendingApprovals(approvals);
            if (countBadge) {
              countBadge.textContent = approvals.length;
            }
          } else {
            throw new Error(response.error || 'Failed to load pending approvals');
          }
        } catch (error) {
          container.innerHTML = `
            <div class="alert alert-warning">
              <i class="bi bi-exclamation-triangle"></i>
              Visibility management may not be enabled or there was an error loading approvals.
            </div>
          `;
          if (countBadge) {
            countBadge.textContent = '0';
          }
        } finally {
          this.setLoading('pending-approvals', false);
        }
      }

      renderPendingApprovals(approvals) {
        const container = document.getElementById('pending-approvals-container');
        if (!container) return;

        if (approvals.length === 0) {
          container.innerHTML = `
            <div class="text-center py-4">
              <i class="bi bi-check-circle" style="font-size: 3rem; color: #28a745;"></i>
              <p class="mt-2 text-muted">No pending approvals</p>
            </div>
          `;
          return;
        }

        const approvalsHtml = approvals.map(approval => {
          const requestedDate = new Date(approval.requestedAt).toLocaleDateString();
          const visibilityBadge = this.getVisibilityBadge(approval.requestedVisibility);
          
          return `
            <div class="card mb-3">
              <div class="card-body">
                <div class="row align-items-center">
                  <div class="col-md-6">
                    <h6 class="mb-1">Document: ${this.escapeHtml(approval.documentId)}</h6>
                    <small class="text-muted">
                      Requested by: ${this.escapeHtml(approval.requestedBy)} on ${requestedDate}
                    </small>
                    ${approval.reason ? `<p class="mt-2 mb-0"><small><strong>Reason:</strong> ${this.escapeHtml(approval.reason)}</small></p>` : ''}
                  </div>
                  <div class="col-md-3 text-center">
                    <div>Current: ${this.getVisibilityBadge(approval.currentVisibility)}</div>
                    <div class="mt-1">Requested: ${visibilityBadge}</div>
                  </div>
                  <div class="col-md-3 text-end">
                    <div class="btn-group" role="group">
                      <button class="btn btn-success btn-sm" onclick="approveVisibilityChange('${approval.id}')">
                        <i class="bi bi-check"></i> Approve
                      </button>
                      <button class="btn btn-danger btn-sm" onclick="rejectVisibilityChange('${approval.id}')">
                        <i class="bi bi-x"></i> Reject
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          `;
        }).join('');

        container.innerHTML = approvalsHtml;
      }

      async loadVisibilityRules() {
        const container = document.getElementById('visibility-rules-container');
        if (!container) return;

        try {
          this.setLoading('visibility-rules', true);
          container.innerHTML = `
            <div class="alert alert-info">
              <i class="bi bi-info-circle"></i>
              Visibility rules are configured in the backend system. Use the "Add Rule" button to create new rules via the API.
            </div>
          `;
        } finally {
          this.setLoading('visibility-rules', false);
        }
      }

      async loadAuditLog() {
        const container = document.getElementById('audit-log-container');
        if (!container) return;

        try {
          this.setLoading('audit-log', true);
          container.innerHTML = `
            <div class="alert alert-info">
              <i class="bi bi-info-circle"></i>
              Audit log will show visibility changes once documents have visibility modifications.
            </div>
          `;
        } finally {
          this.setLoading('audit-log', false);
        }
      }

      async setDocumentVisibility(documentId, visibility, reason = '') {
        const response = await this.apiCall(`/api/visibility/document/${documentId}`, {
          method: 'PUT',
          body: JSON.stringify({ visibility, reason, metadata: { changedVia: 'manual-review-ui', timestamp: new Date().toISOString() } })
        });

        if (response.success) {
          await this.loadVisibilityData();
          return response.data;
        } else {
          throw new Error(response.error || 'Failed to update visibility');
        }
      }

      async bulkUpdateVisibility(updates, reason = '') {
        const response = await this.apiCall('/api/visibility/bulk-update', {
          method: 'PUT',
          body: JSON.stringify({ updates, reason })
        });

        if (response.success) {
          await this.loadVisibilityData();
          return response.data;
        } else {
          throw new Error(response.error || 'Failed to bulk update visibility');
        }
      }

      async approveVisibilityChange(approvalId, notes = '') {
        const response = await this.apiCall(`/api/visibility/approvals/${approvalId}/approve`, {
          method: 'POST',
          body: JSON.stringify({ notes })
        });

        if (response.success) {
          await this.loadPendingApprovals();
          return response.data;
        } else {
          throw new Error(response.error || 'Failed to approve visibility change');
        }
      }

      async rejectVisibilityChange(approvalId, reason = '') {
        const response = await this.apiCall(`/api/visibility/approvals/${approvalId}/reject`, {
          method: 'POST',
          body: JSON.stringify({ reason })
        });

        if (response.success) {
          await this.loadPendingApprovals();
          return response.data;
        } else {
          throw new Error(response.error || 'Failed to reject visibility change');
        }
      }

      async addVisibilityRule(ruleId, rule) {
        const response = await this.apiCall('/api/visibility/rules', {
          method: 'POST',
          body: JSON.stringify({ ruleId, rule })
        });

        if (response.success) {
          await this.loadVisibilityRules();
          return response.data;
        } else {
          throw new Error(response.error || 'Failed to add visibility rule');
        }
      }

      setLoading(component, isLoading) {
        if (isLoading) {
          this.loadingStates.add(component);
        } else {
          this.loadingStates.delete(component);
        }
      }

      escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
      }

      async apiCall(url, options = {}) {
        return await fetch(url, {
          headers: { 'Content-Type': 'application/json', 'X-API-Key': this.apiKey },
          ...options
        }).then(async response => {
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
          return { success: true, data };
        }).catch(error => ({ success: false, error: error.message }));
      }
    };

    app = new ManualReviewApp();
  });

  afterEach(() => {
    jest.clearAllMocks();
    dom.window.close();
  });

  describe('loadVisibilityData', () => {
    it('should load all visibility data when current view is visibility', async () => {
      const loadSpy = jest.spyOn(app, 'loadVisibilityDocuments').mockResolvedValue();
      const approvalsSpy = jest.spyOn(app, 'loadPendingApprovals').mockResolvedValue();
      const rulesSpy = jest.spyOn(app, 'loadVisibilityRules').mockResolvedValue();
      const auditSpy = jest.spyOn(app, 'loadAuditLog').mockResolvedValue();

      await app.loadVisibilityData();

      expect(loadSpy).toHaveBeenCalled();
      expect(approvalsSpy).toHaveBeenCalled();
      expect(rulesSpy).toHaveBeenCalled();
      expect(auditSpy).toHaveBeenCalled();
    });

    it('should not load data when current view is not visibility', async () => {
      app.currentView = 'review';
      const loadSpy = jest.spyOn(app, 'loadVisibilityDocuments').mockResolvedValue();

      await app.loadVisibilityData();

      expect(loadSpy).not.toHaveBeenCalled();
    });
  });

  describe('loadVisibilityDocuments', () => {
    it('should render documents when API call succeeds', async () => {
      const mockDocuments = [
        { id: 'doc1', title: 'Test Document', visibility: 'internal', lastModified: '2023-01-01', sourceType: 'PDF' }
      ];

      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ documents: mockDocuments })
      });

      await app.loadVisibilityDocuments();

      const container = document.getElementById('visibility-documents-container');
      expect(container.innerHTML).toContain('Test Document');
      expect(container.innerHTML).toContain('Internal');
    });

    it('should show error message when API call fails', async () => {
      fetch.mockRejectedValueOnce(new Error('Network error'));

      await app.loadVisibilityDocuments();

      const container = document.getElementById('visibility-documents-container');
      expect(container.innerHTML).toContain('Failed to load documents');
    });

    it('should show empty state when no documents', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ documents: [] })
      });

      await app.loadVisibilityDocuments();

      const container = document.getElementById('visibility-documents-container');
      expect(container.innerHTML).toContain('No documents found');
    });
  });

  describe('getVisibilityBadge', () => {
    it('should return correct badge for each visibility type', () => {
      expect(app.getVisibilityBadge('internal')).toContain('bg-primary');
      expect(app.getVisibilityBadge('external')).toContain('bg-info');
      expect(app.getVisibilityBadge('restricted')).toContain('bg-warning');
      expect(app.getVisibilityBadge('public')).toContain('bg-success');
      expect(app.getVisibilityBadge('draft')).toContain('bg-secondary');
      expect(app.getVisibilityBadge('archived')).toContain('bg-dark');
      expect(app.getVisibilityBadge('unknown')).toContain('bg-light');
    });
  });

  describe('loadPendingApprovals', () => {
    it('should render pending approvals when API call succeeds', async () => {
      const mockApprovals = [
        {
          id: 'approval1',
          documentId: 'doc1',
          requestedBy: 'user1',
          requestedAt: '2023-01-01',
          currentVisibility: 'internal',
          requestedVisibility: 'public',
          reason: 'Test reason'
        }
      ];

      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockApprovals
      });

      await app.loadPendingApprovals();

      const container = document.getElementById('pending-approvals-container');
      const countBadge = document.getElementById('pending-approvals-count');
      
      expect(container.innerHTML).toContain('doc1');
      expect(container.innerHTML).toContain('user1');
      expect(countBadge.textContent).toBe('1');
    });

    it('should show empty state when no pending approvals', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => []
      });

      await app.loadPendingApprovals();

      const container = document.getElementById('pending-approvals-container');
      expect(container.innerHTML).toContain('No pending approvals');
    });
  });

  describe('setDocumentVisibility', () => {
    it('should update document visibility successfully', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true })
      });

      const loadSpy = jest.spyOn(app, 'loadVisibilityData').mockResolvedValue();

      const result = await app.setDocumentVisibility('doc1', 'public', 'Test reason');

      expect(fetch).toHaveBeenCalledWith('/api/visibility/document/doc1', expect.objectContaining({
        method: 'PUT',
        body: expect.stringContaining('"visibility":"public"'),
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key'
        })
      }));
      expect(loadSpy).toHaveBeenCalled();
    });

    it('should throw error when API call fails', async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Unauthorized' })
      });

      await expect(app.setDocumentVisibility('doc1', 'public')).rejects.toThrow('Unauthorized');
    });
  });

  describe('bulkUpdateVisibility', () => {
    it('should update multiple documents successfully', async () => {
      const updates = [
        { documentId: 'doc1', visibility: 'public' },
        { documentId: 'doc2', visibility: 'internal' }
      ];

      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true })
      });

      const loadSpy = jest.spyOn(app, 'loadVisibilityData').mockResolvedValue();

      await app.bulkUpdateVisibility(updates, 'Bulk update reason');

      expect(fetch).toHaveBeenCalledWith('/api/visibility/bulk-update', expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          updates,
          reason: 'Bulk update reason'
        })
      }));
      expect(loadSpy).toHaveBeenCalled();
    });
  });

  describe('approveVisibilityChange', () => {
    it('should approve visibility change successfully', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true })
      });

      const loadSpy = jest.spyOn(app, 'loadPendingApprovals').mockResolvedValue();

      await app.approveVisibilityChange('approval1', 'Approved by admin');

      expect(fetch).toHaveBeenCalledWith('/api/visibility/approvals/approval1/approve', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ notes: 'Approved by admin' })
      }));
      expect(loadSpy).toHaveBeenCalled();
    });
  });

  describe('rejectVisibilityChange', () => {
    it('should reject visibility change successfully', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true })
      });

      const loadSpy = jest.spyOn(app, 'loadPendingApprovals').mockResolvedValue();

      await app.rejectVisibilityChange('approval1', 'Rejected for security');

      expect(fetch).toHaveBeenCalledWith('/api/visibility/approvals/approval1/reject', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ reason: 'Rejected for security' })
      }));
      expect(loadSpy).toHaveBeenCalled();
    });
  });

  describe('addVisibilityRule', () => {
    it('should add visibility rule successfully', async () => {
      const rule = {
        name: 'Test Rule',
        description: 'Test description',
        priority: 1,
        visibility: 'internal',
        conditions: { sourceType: 'PDF' }
      };

      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true })
      });

      const loadSpy = jest.spyOn(app, 'loadVisibilityRules').mockResolvedValue();

      await app.addVisibilityRule('rule1', rule);

      expect(fetch).toHaveBeenCalledWith('/api/visibility/rules', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ ruleId: 'rule1', rule })
      }));
      expect(loadSpy).toHaveBeenCalled();
    });
  });
});
