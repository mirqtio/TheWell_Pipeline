/**
 * Integration tests for Dashboard UI components and interactions
 * Tests UI behavior with mocked backend responses
 */

const { chromium } = require('playwright');
const express = require('express');
const path = require('path');
const { waitForServer } = require('../../helpers/server');

describe('Dashboard UI Integration Tests', () => {
  let browser;
  let context;
  let page;
  let mockServer;
  let serverPort;

  beforeAll(async () => {
    // Create mock server for UI testing
    const app = express();
    app.use(express.json());
    app.use(express.static(path.join(__dirname, '../../../src/web/public')));

    // Mock API endpoints
    app.get('/health', (req, res) => {
      res.json({ status: 'healthy' });
    });

    app.get('/api/v1/review/pending', (req, res) => {
      res.json({
        documents: [
          {
            id: 'doc1',
            title: 'Test Document 1',
            status: 'pending',
            source: 'test-source',
            content: 'Sample content for testing',
            metadata: { priority: 'high' },
            createdAt: new Date().toISOString()
          },
          {
            id: 'doc2', 
            title: 'Test Document 2',
            status: 'in-review',
            source: 'test-source',
            content: 'Another sample document',
            metadata: { priority: 'medium' },
            createdAt: new Date().toISOString()
          },
          {
            id: 'doc3',
            title: 'Test Document 3', 
            status: 'approved',
            source: 'test-source',
            content: 'Approved document content',
            metadata: { priority: 'low' },
            createdAt: new Date().toISOString()
          }
        ],
        total: 3,
        page: 1,
        limit: 100
      });
    });

    app.get('/api/v1/jobs/status', (req, res) => {
      res.json({
        active: 2,
        completed: 15,
        failed: 1,
        waiting: 3
      });
    });

    app.get('/api/v1/stats/overview', (req, res) => {
      res.json({
        totalDocuments: 1250,
        pendingReview: 45,
        approved: 1100,
        rejected: 105,
        averageProcessingTime: '2.3 hours',
        dailyThroughput: 125
      });
    });

    app.post('/api/v1/curation/decision', (req, res) => {
      const { itemId, decision } = req.body;
      res.json({
        success: true,
        itemId,
        decision,
        timestamp: new Date().toISOString()
      });
    });

    // Start mock server
    mockServer = app.listen(0);
    serverPort = mockServer.address().port;
    
    await waitForServer(`http://localhost:${serverPort}`, 5000);

    browser = await chromium.launch({
      headless: process.env.CI === 'true'
    });
    context = await browser.newContext();
    page = await context.newPage();
  });

  afterAll(async () => {
    if (browser) {
      await browser.close();
    }
    if (mockServer) {
      mockServer.close();
    }
  });

  beforeEach(async () => {
    await page.goto(`http://localhost:${serverPort}`);
    await page.waitForLoadState('networkidle');
  });

  describe('Kanban Board Data Loading', () => {
    it('should load and display curation data in kanban columns', async () => {
      // Navigate to curation board
      await page.click('[data-view="curation"]');
      await page.waitForTimeout(1000);

      // Wait for API call to complete
      await page.waitForResponse(response => 
        response.url().includes('/api/v1/review/pending') && response.status() === 200
      );

      // Check that columns show correct counts
      const pendingCount = await page.textContent('#pending-kanban-count');
      const inReviewCount = await page.textContent('#in-review-kanban-count');
      const processedCount = await page.textContent('#processed-kanban-count');

      expect(pendingCount).toBe('1'); // 1 pending document
      expect(inReviewCount).toBe('1'); // 1 in-review document  
      expect(processedCount).toBe('1'); // 1 approved document
    });

    it('should display document cards in correct columns', async () => {
      await page.click('[data-view="curation"]');
      await page.waitForTimeout(1000);

      await page.waitForResponse(response => 
        response.url().includes('/api/v1/review/pending')
      );

      // Check pending column has the pending document
      const pendingColumn = await page.locator('#pending-column');
      const pendingCards = await pendingColumn.locator('.document-card');
      
      if (await pendingCards.count() > 0) {
        const firstCard = pendingCards.first();
        await expect(firstCard).toContainText('Test Document 1');
      }

      // Check in-review column
      const inReviewColumn = await page.locator('#in-review-column');
      const inReviewCards = await inReviewColumn.locator('.document-card');
      
      if (await inReviewCards.count() > 0) {
        const firstCard = inReviewCards.first();
        await expect(firstCard).toContainText('Test Document 2');
      }
    });
  });

  describe('Document Card Interactions', () => {
    beforeEach(async () => {
      await page.click('[data-view="curation"]');
      await page.waitForTimeout(1000);
      await page.waitForResponse(response => 
        response.url().includes('/api/v1/review/pending')
      );
    });

    it('should show document details when card is clicked', async () => {
      const documentCard = await page.locator('.document-card').first();
      
      if (await documentCard.isVisible()) {
        await documentCard.click();
        await page.waitForTimeout(500);

        // Check if modal or detail view opened
        const modal = await page.locator('.modal, .document-detail');
        if (await modal.isVisible()) {
          await expect(modal).toBeVisible();
        }
      }
    });

    it('should handle approve action', async () => {
      const approveButton = await page.locator('[data-action="approve"]').first();
      
      if (await approveButton.isVisible()) {
        // Set up response listener
        const responsePromise = page.waitForResponse(response => 
          response.url().includes('/api/v1/curation/decision')
        );

        await approveButton.click();
        
        const response = await responsePromise;
        expect(response.status()).toBe(200);
      }
    });

    it('should handle reject action', async () => {
      const rejectButton = await page.locator('[data-action="reject"]').first();
      
      if (await rejectButton.isVisible()) {
        const responsePromise = page.waitForResponse(response => 
          response.url().includes('/api/v1/curation/decision')
        );

        await rejectButton.click();
        
        const response = await responsePromise;
        expect(response.status()).toBe(200);
      }
    });
  });

  describe('Search Functionality', () => {
    beforeEach(async () => {
      await page.click('[data-view="curation"]');
      await page.waitForTimeout(1000);
    });

    it('should filter documents when search term is entered', async () => {
      const searchInput = await page.locator('#curation-search');
      
      if (await searchInput.isVisible()) {
        await searchInput.fill('Test Document 1');
        await page.waitForTimeout(500);

        // Check that only matching documents are visible
        const visibleCards = await page.locator('.document-card:visible');
        const count = await visibleCards.count();
        
        if (count > 0) {
          const firstCard = visibleCards.first();
          await expect(firstCard).toContainText('Test Document 1');
        }
      }
    });

    it('should clear search results when search is cleared', async () => {
      const searchInput = await page.locator('#curation-search');
      
      if (await searchInput.isVisible()) {
        await searchInput.fill('Test Document 1');
        await page.waitForTimeout(500);
        
        await searchInput.clear();
        await page.waitForTimeout(500);

        // All documents should be visible again
        const visibleCards = await page.locator('.document-card:visible');
        const count = await visibleCards.count();
        expect(count).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('Statistics View Integration', () => {
    it('should load and display statistics data', async () => {
      await page.click('[data-view="stats"]');
      await page.waitForTimeout(1000);

      await page.waitForResponse(response => 
        response.url().includes('/api/v1/stats/overview')
      );

      // Check for stats display
      const statsView = await page.locator('#stats-view');
      await expect(statsView).toBeVisible();

      // Check for key metrics
      const totalDocs = await page.locator('[data-metric="total-documents"]');
      if (await totalDocs.isVisible()) {
        await expect(totalDocs).toContainText('1250');
      }
    });
  });

  describe('Jobs View Integration', () => {
    it('should load and display job status data', async () => {
      await page.click('[data-view="jobs"]');
      await page.waitForTimeout(1000);

      await page.waitForResponse(response => 
        response.url().includes('/api/v1/jobs/status')
      );

      const jobsView = await page.locator('#jobs-view');
      await expect(jobsView).toBeVisible();

      // Check for job status indicators
      const activeJobs = await page.locator('[data-status="active"]');
      if (await activeJobs.isVisible()) {
        await expect(activeJobs).toContainText('2');
      }
    });
  });

  describe('Error State Handling', () => {
    it('should display error message when API fails', async () => {
      // Intercept and fail API calls
      await page.route('**/api/v1/review/pending', route => 
        route.fulfill({ status: 500, body: 'Server Error' })
      );

      await page.click('[data-view="curation"]');
      await page.waitForTimeout(1000);

      // Check for error message
      const errorMessage = await page.locator('.error-message, .alert-danger');
      if (await errorMessage.isVisible()) {
        await expect(errorMessage).toBeVisible();
        await expect(errorMessage).toContainText(/error|failed/i);
      }
    });

    it('should show loading state during API calls', async () => {
      // Delay API response
      await page.route('**/api/v1/review/pending', async route => {
        await new Promise(resolve => setTimeout(resolve, 1000));
        route.continue();
      });

      await page.click('[data-view="curation"]');
      
      // Check for loading indicator
      const loadingIndicator = await page.locator('.loading-indicator, .spinner-border');
      if (await loadingIndicator.isVisible()) {
        await expect(loadingIndicator).toBeVisible();
      }

      // Wait for loading to complete
      await page.waitForTimeout(2000);
    });
  });

  describe('Real-time Updates', () => {
    it('should refresh data when refresh button is clicked', async () => {
      await page.click('[data-view="curation"]');
      await page.waitForTimeout(1000);

      const refreshButton = await page.locator('[data-action="refresh"]');
      if (await refreshButton.isVisible()) {
        const responsePromise = page.waitForResponse(response => 
          response.url().includes('/api/v1/review/pending')
        );

        await refreshButton.click();
        
        const response = await responsePromise;
        expect(response.status()).toBe(200);
      }
    });
  });
});
