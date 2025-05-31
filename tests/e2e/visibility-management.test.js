/**
 * End-to-end tests for visibility management workflow
 */

const puppeteer = require('puppeteer');
const path = require('path');

describe('Visibility Management E2E Tests', () => {
  let browser;
  let page;
  const baseUrl = 'http://localhost:3000';

  beforeAll(async () => {
    browser = await puppeteer.launch({
      headless: process.env.CI === 'true',
      slowMo: 50,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
  });

  afterAll(async () => {
    if (browser) {
      await browser.close();
    }
  });

  beforeEach(async () => {
    page = await browser.newPage();
    
    // Set up request interception for API mocking
    await page.setRequestInterception(true);
    
    page.on('request', (request) => {
      const url = request.url();
      
      // Mock API responses
      if (url.includes('/api/review/documents')) {
        request.respond({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            documents: [
              {
                id: 'doc1',
                title: 'Test Document 1',
                visibility: 'internal',
                lastModified: '2023-01-01T00:00:00.000Z',
                sourceType: 'PDF'
              },
              {
                id: 'doc2',
                title: 'Test Document 2',
                visibility: 'public',
                lastModified: '2023-01-02T00:00:00.000Z',
                sourceType: 'DOCX'
              }
            ]
          })
        });
      } else if (url.includes('/api/visibility/approvals')) {
        request.respond({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            {
              id: 'approval1',
              documentId: 'doc3',
              requestedBy: 'user1',
              requestedAt: '2023-01-01T00:00:00.000Z',
              currentVisibility: 'internal',
              requestedVisibility: 'public',
              reason: 'Need to share with external partners'
            }
          ])
        });
      } else if (url.includes('/api/visibility/document/')) {
        const method = request.method();
        if (method === 'PUT') {
          request.respond({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              documentId: 'doc1',
              visibility: 'public',
              previousVisibility: 'internal',
              modifiedBy: 'test-user',
              modifiedAt: new Date().toISOString()
            })
          });
        } else {
          request.continue();
        }
      } else if (url.includes('/api/visibility/bulk-update')) {
        request.respond({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            updated: 2,
            failed: 0,
            results: [
              { documentId: 'doc1', visibility: 'public', success: true },
              { documentId: 'doc2', visibility: 'internal', success: true }
            ]
          })
        });
      } else if (url.includes('/api/visibility/approvals/') && url.includes('/approve')) {
        request.respond({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            approvalId: 'approval1',
            status: 'approved',
            approvedBy: 'test-user',
            approvedAt: new Date().toISOString()
          })
        });
      } else if (url.includes('/api/visibility/approvals/') && url.includes('/reject')) {
        request.respond({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            approvalId: 'approval1',
            status: 'rejected',
            rejectedBy: 'test-user',
            rejectedAt: new Date().toISOString()
          })
        });
      } else if (url.includes('/api/visibility/rules')) {
        const method = request.method();
        if (method === 'POST') {
          request.respond({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              ruleId: 'rule1',
              rule: {
                name: 'Test Rule',
                description: 'Test description',
                priority: 1,
                visibility: 'internal',
                conditions: { sourceType: 'PDF' }
              },
              createdBy: 'test-user',
              createdAt: new Date().toISOString()
            })
          });
        } else {
          request.respond({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([])
          });
        }
      } else {
        request.continue();
      }
    });

    // Navigate to the application
    await page.goto(baseUrl);
    
    // Set API key in localStorage
    await page.evaluate(() => {
      localStorage.setItem('apiKey', 'test-api-key');
    });
    
    // Wait for page to load
    await page.waitForSelector('nav', { timeout: 5000 });
  });

  afterEach(async () => {
    if (page) {
      await page.close();
    }
  });

  describe('Navigation and Initial Load', () => {
    it('should navigate to visibility tab and load data', async () => {
      // Click on visibility tab
      await page.click('a[data-view="visibility"]');
      
      // Wait for visibility content to load
      await page.waitForSelector('#visibility-documents-container', { timeout: 5000 });
      
      // Check that documents are displayed
      const documentsContainer = await page.$('#visibility-documents-container');
      expect(documentsContainer).toBeTruthy();
      
      // Verify document cards are rendered
      const documentCards = await page.$$('.document-card');
      expect(documentCards.length).toBe(2);
      
      // Check document titles
      const titles = await page.$$eval('.card-title', elements => 
        elements.map(el => el.textContent.trim())
      );
      expect(titles).toContain('Test Document 1');
      expect(titles).toContain('Test Document 2');
      
      // Check visibility badges
      const badges = await page.$$eval('.badge', elements => 
        elements.map(el => el.textContent.trim())
      );
      expect(badges).toContain('Internal');
      expect(badges).toContain('Public');
    });

    it('should load pending approvals', async () => {
      // Navigate to visibility tab
      await page.click('a[data-view="visibility"]');
      
      // Wait for pending approvals section
      await page.waitForSelector('#pending-approvals-container', { timeout: 5000 });
      
      // Check pending approvals count
      const countBadge = await page.$eval('#pending-approvals-count', el => el.textContent);
      expect(countBadge).toBe('1');
      
      // Verify approval card is displayed
      const approvalCards = await page.$$('#pending-approvals-container .card');
      expect(approvalCards.length).toBe(1);
    });
  });

  describe('Document Visibility Management', () => {
    beforeEach(async () => {
      // Navigate to visibility tab
      await page.click('a[data-view="visibility"]');
      await page.waitForSelector('#visibility-documents-container', { timeout: 5000 });
    });

    it('should change individual document visibility', async () => {
      // Click change button for first document
      const changeButton = await page.$('.document-card button[onclick*="showDocumentVisibilityModal"]');
      await changeButton.click();
      
      // Wait for modal to appear
      await page.waitForSelector('#documentVisibilityModal', { visible: true });
      
      // Select new visibility
      await page.select('#documentVisibilitySelect', 'public');
      
      // Add reason
      await page.type('#documentVisibilityReason', 'Making document public for sharing');
      
      // Submit form
      await page.click('#documentVisibilityModal button[type="submit"]');
      
      // Wait for modal to close and data to refresh
      await page.waitForSelector('#documentVisibilityModal', { hidden: true });
      
      // Verify success message (toast)
      await page.waitForFunction(() => {
        const toasts = document.querySelectorAll('.toast');
        return Array.from(toasts).some(toast => 
          toast.textContent.includes('Document visibility updated successfully')
        );
      }, { timeout: 5000 });
    });

    it('should perform bulk visibility update', async () => {
      // Click bulk update button
      await page.click('button[onclick="showBulkVisibilityModal()"]');
      
      // Wait for modal
      await page.waitForSelector('#bulkVisibilityModal', { visible: true });
      
      // Enter document IDs
      await page.type('#bulkDocumentIds', 'doc1\ndoc2');
      
      // Select visibility
      await page.select('#bulkVisibilitySelect', 'internal');
      
      // Add reason
      await page.type('#bulkVisibilityReason', 'Bulk update for security review');
      
      // Submit form
      await page.click('#bulkVisibilityModal button[type="submit"]');
      
      // Wait for modal to close
      await page.waitForSelector('#bulkVisibilityModal', { hidden: true });
      
      // Verify success message
      await page.waitForFunction(() => {
        const toasts = document.querySelectorAll('.toast');
        return Array.from(toasts).some(toast => 
          toast.textContent.includes('Bulk visibility update completed')
        );
      }, { timeout: 5000 });
    });
  });

  describe('Approval Workflow', () => {
    beforeEach(async () => {
      // Navigate to visibility tab
      await page.click('a[data-view="visibility"]');
      await page.waitForSelector('#pending-approvals-container', { timeout: 5000 });
    });

    it('should approve visibility change request', async () => {
      // Click approve button
      const approveButton = await page.$('button[onclick*="approveVisibilityChange"]');
      await approveButton.click();
      
      // Verify success message
      await page.waitForFunction(() => {
        const toasts = document.querySelectorAll('.toast');
        return Array.from(toasts).some(toast => 
          toast.textContent.includes('Visibility change approved successfully')
        );
      }, { timeout: 5000 });
      
      // Verify pending approvals count updated
      await page.waitForFunction(() => {
        const countBadge = document.getElementById('pending-approvals-count');
        return countBadge && countBadge.textContent === '0';
      }, { timeout: 5000 });
    });

    it('should reject visibility change request', async () => {
      // Click reject button
      const rejectButton = await page.$('button[onclick*="rejectVisibilityChange"]');
      await rejectButton.click();
      
      // Verify success message
      await page.waitForFunction(() => {
        const toasts = document.querySelectorAll('.toast');
        return Array.from(toasts).some(toast => 
          toast.textContent.includes('Visibility change rejected successfully')
        );
      }, { timeout: 5000 });
    });
  });

  describe('Visibility Rules Management', () => {
    beforeEach(async () => {
      // Navigate to visibility tab
      await page.click('a[data-view="visibility"]');
      await page.waitForSelector('#visibility-rules-container', { timeout: 5000 });
    });

    it('should add new visibility rule', async () => {
      // Click add rule button
      await page.click('button[onclick="showAddRuleModal()"]');
      
      // Wait for modal
      await page.waitForSelector('#addRuleModal', { visible: true });
      
      // Fill form
      await page.type('#ruleId', 'pdf-internal-rule');
      await page.type('#ruleName', 'PDF Auto-Internal');
      await page.type('#ruleDescription', 'Automatically set PDF documents to internal visibility');
      await page.type('#rulePriority', '1');
      await page.select('#ruleVisibility', 'internal');
      await page.type('#ruleConditions', '{"sourceType": "PDF"}');
      
      // Submit form
      await page.click('#addRuleModal button[type="submit"]');
      
      // Wait for modal to close
      await page.waitForSelector('#addRuleModal', { hidden: true });
      
      // Verify success message
      await page.waitForFunction(() => {
        const toasts = document.querySelectorAll('.toast');
        return Array.from(toasts).some(toast => 
          toast.textContent.includes('Visibility rule added successfully')
        );
      }, { timeout: 5000 });
    });
  });

  describe('Audit Log Navigation', () => {
    beforeEach(async () => {
      // Navigate to visibility tab
      await page.click('a[data-view="visibility"]');
      await page.waitForSelector('#visibility-documents-container', { timeout: 5000 });
    });

    it('should navigate to document audit log', async () => {
      // Click audit button for first document
      const auditButton = await page.$('.document-card button[onclick*="viewDocumentAudit"]');
      await auditButton.click();
      
      // Verify audit log container is visible and filtered
      await page.waitForSelector('#audit-log-container', { timeout: 5000 });
      
      // Check that document search field is populated
      const searchValue = await page.$eval('#auditDocumentSearch', el => el.value);
      expect(searchValue).toBe('doc1');
    });
  });

  describe('Error Handling', () => {
    it('should handle API errors gracefully', async () => {
      // Set up error response
      await page.setRequestInterception(true);
      page.removeAllListeners('request');
      page.on('request', (request) => {
        if (request.url().includes('/api/review/documents')) {
          request.respond({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'Internal server error' })
          });
        } else {
          request.continue();
        }
      });
      
      // Navigate to visibility tab
      await page.click('a[data-view="visibility"]');
      
      // Wait for error message
      await page.waitForFunction(() => {
        const container = document.getElementById('visibility-documents-container');
        return container && container.innerHTML.includes('Failed to load documents');
      }, { timeout: 5000 });
      
      // Verify error alert is displayed
      const errorAlert = await page.$('#visibility-documents-container .alert-danger');
      expect(errorAlert).toBeTruthy();
    });

    it('should handle network failures', async () => {
      // Set up network failure
      await page.setRequestInterception(true);
      page.removeAllListeners('request');
      page.on('request', (request) => {
        if (request.url().includes('/api/visibility/')) {
          request.abort();
        } else {
          request.continue();
        }
      });
      
      // Navigate to visibility tab
      await page.click('a[data-view="visibility"]');
      
      // Try to change document visibility
      await page.waitForSelector('.document-card button[onclick*="showDocumentVisibilityModal"]', { timeout: 5000 });
      const changeButton = await page.$('.document-card button[onclick*="showDocumentVisibilityModal"]');
      await changeButton.click();
      
      await page.waitForSelector('#documentVisibilityModal', { visible: true });
      await page.select('#documentVisibilitySelect', 'public');
      await page.click('#documentVisibilityModal button[type="submit"]');
      
      // Verify error message
      await page.waitForFunction(() => {
        const toasts = document.querySelectorAll('.toast');
        return Array.from(toasts).some(toast => 
          toast.textContent.includes('Failed to update document visibility')
        );
      }, { timeout: 5000 });
    });
  });

  describe('Responsive Design', () => {
    it('should work on mobile viewport', async () => {
      // Set mobile viewport
      await page.setViewport({ width: 375, height: 667 });
      
      // Navigate to visibility tab
      await page.click('a[data-view="visibility"]');
      await page.waitForSelector('#visibility-documents-container', { timeout: 5000 });
      
      // Verify document cards are responsive
      const documentCard = await page.$('.document-card');
      const cardRect = await documentCard.boundingBox();
      expect(cardRect.width).toBeLessThanOrEqual(375);
      
      // Test modal responsiveness
      const changeButton = await page.$('.document-card button[onclick*="showDocumentVisibilityModal"]');
      await changeButton.click();
      
      await page.waitForSelector('#documentVisibilityModal', { visible: true });
      const modal = await page.$('#documentVisibilityModal .modal-dialog');
      const modalRect = await modal.boundingBox();
      expect(modalRect.width).toBeLessThanOrEqual(375);
    });
  });

  describe('Accessibility', () => {
    it('should have proper ARIA labels and keyboard navigation', async () => {
      // Navigate to visibility tab
      await page.click('a[data-view="visibility"]');
      await page.waitForSelector('#visibility-documents-container', { timeout: 5000 });
      
      // Check for ARIA labels on buttons
      const buttons = await page.$$('button');
      for (const button of buttons) {
        const ariaLabel = await button.evaluate(el => el.getAttribute('aria-label'));
        const textContent = await button.evaluate(el => el.textContent.trim());
        
        // Button should have either aria-label or meaningful text content
        expect(ariaLabel || textContent).toBeTruthy();
      }
      
      // Test keyboard navigation
      await page.keyboard.press('Tab');
      const focusedElement = await page.evaluate(() => document.activeElement.tagName);
      expect(['BUTTON', 'A', 'INPUT', 'SELECT'].includes(focusedElement)).toBeTruthy();
    });
  });
});
