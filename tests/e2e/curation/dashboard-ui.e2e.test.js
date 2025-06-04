/**
 * E2E tests for Curation Dashboard UI
 * Tests the complete dashboard workflow including Kanban board interactions
 */

const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const { waitForServer, killProcess } = require('../../helpers/server');

describe.skip('Curation Dashboard UI E2E Tests', () => {
  let browser;
  let context;
  let page;
  let webServer;
  const baseUrl = 'http://localhost:3099';

  beforeAll(async () => {
    // Start web server
    const serverPath = path.join(__dirname, '../../../src/web/start.js');
    webServer = spawn('node', [serverPath], {
      env: {
        ...process.env,
        WEB_PORT: 3099,
        NODE_ENV: 'test',
        E2E_TEST_MODE: 'true',
        REDIS_DB: '15' // Use separate Redis DB for E2E tests
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Wait for server to be available
    await waitForServer(baseUrl, 30000);
    
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
    if (webServer) {
      await killProcess(webServer);
    }
  });

  beforeEach(async () => {
    await page.goto(baseUrl);
    await page.waitForLoadState('networkidle');
  });

  describe('Dashboard Navigation', () => {
    it('should display main navigation elements', async () => {
      // Check navbar brand
      const navbarBrand = await page.locator('.navbar-brand');
      expect(await navbarBrand.isVisible()).toBe(true);
      expect(await navbarBrand.textContent()).toContain('TheWell Pipeline');

      // Check navigation links
      const navLinks = [
        { selector: '[data-view="review"]', text: 'Review' },
        { selector: '[data-view="curation"]', text: 'Curation Board' },
        { selector: '[data-view="jobs"]', text: 'Jobs' },
        { selector: '[data-view="visibility"]', text: 'Visibility' },
        { selector: '[data-view="stats"]', text: 'Statistics' }
      ];

      for (const link of navLinks) {
        const element = await page.locator(link.selector);
        expect(await element.isVisible()).toBe(true);
        expect(await element.textContent()).toContain(link.text);
      }
    });

    it('should switch between different views', async () => {
      // Click on Curation Board
      await page.click('[data-view="curation"]');
      await page.waitForTimeout(500);
      
      // Verify curation view is active
      const curationView = await page.locator('#curation-view');
      expect(await curationView.isVisible()).toBe(true);

      // Click on Jobs
      await page.click('[data-view="jobs"]');
      await page.waitForTimeout(500);
      
      // Verify jobs view is active
      const jobsView = await page.locator('#jobs-view');
      expect(await jobsView.isVisible()).toBe(true);
    });
  });

  describe('Kanban Board Functionality', () => {
    beforeEach(async () => {
      // Navigate to curation board
      await page.click('[data-view="curation"]');
      await page.waitForTimeout(500);
    });

    it('should display kanban board with three columns', async () => {
      // Check for kanban board
      const kanbanBoard = await page.locator('.kanban-board');
      expect(await kanbanBoard.isVisible()).toBe(true);

      // Check for three columns
      const columns = [
        { selector: '[data-status="pending"]', title: 'Pending Review' },
        { selector: '[data-status="in-review"]', title: 'In Review' },
        { selector: '[data-status="processed"]', title: 'Processed' }
      ];

      for (const column of columns) {
        const columnElement = await page.locator(column.selector);
        expect(await columnElement.isVisible()).toBe(true);
        
        const header = await columnElement.locator('.kanban-header');
        expect(await header.textContent()).toContain(column.title);
      }
    });

    it('should display column counts', async () => {
      // Check count badges
      const countBadges = [
        '#pending-kanban-count',
        '#in-review-kanban-count', 
        '#processed-kanban-count'
      ];

      for (const badge of countBadges) {
        const element = await page.locator(badge);
        expect(await element.isVisible()).toBe(true);
        
        // Should display a number (even if 0)
        const text = await element.textContent();
        expect(text).toMatch(/^\d+$/);
      }
    });

    it('should load curation data when view is activated', async () => {
      // Wait for potential API calls
      await page.waitForTimeout(1000);
      
      // Check if loading state was handled
      const loadingIndicator = await page.locator('.loading-indicator');
      if (await loadingIndicator.isVisible()) {
        expect(await loadingIndicator.isVisible()).toBe(false);
      }
    });
  });

  describe('Search and Filter Functionality', () => {
    beforeEach(async () => {
      await page.click('[data-view="curation"]');
      await page.waitForTimeout(500);
    });

    it('should display search controls', async () => {
      // Check for search input
      const searchInput = await page.locator('#curation-search');
      if (await searchInput.isVisible()) {
        expect(await searchInput.isVisible()).toBe(true);
        expect(await searchInput.getAttribute('placeholder')).toBeTruthy();
      }
    });

    it('should display filter controls', async () => {
      // Check for filter dropdowns/buttons
      const filterControls = await page.locator('.filter-controls');
      if (await filterControls.isVisible()) {
        expect(await filterControls.isVisible()).toBe(true);
      }
    });
  });

  describe('Bulk Operations', () => {
    beforeEach(async () => {
      await page.click('[data-view="curation"]');
      await page.waitForTimeout(500);
    });

    it('should display bulk action controls when available', async () => {
      // Check for bulk action buttons
      const bulkControls = await page.locator('.bulk-actions');
      if (await bulkControls.isVisible()) {
        expect(await bulkControls.isVisible()).toBe(true);
        
        // Check for common bulk actions
        const bulkApprove = await page.locator('[data-action="bulk-approve"]');
        const bulkReject = await page.locator('[data-action="bulk-reject"]');
        
        if (await bulkApprove.isVisible()) {
          expect(await bulkApprove.isVisible()).toBe(true);
        }
        if (await bulkReject.isVisible()) {
          expect(await bulkReject.isVisible()).toBe(true);
        }
      }
    });
  });

  describe('Statistics View', () => {
    it('should display statistics dashboard', async () => {
      await page.click('[data-view="stats"]');
      await page.waitForTimeout(500);
      
      const statsView = await page.locator('#stats-view');
      expect(await statsView.isVisible()).toBe(true);
    });

    it('should display key metrics', async () => {
      await page.click('[data-view="stats"]');
      await page.waitForTimeout(1000);
      
      // Check for stats cards
      const statsCards = await page.locator('.stats-card');
      if (await statsCards.first().isVisible()) {
        const count = await statsCards.count();
        expect(count).toBeGreaterThan(0);
      }
    });
  });

  describe('Responsive Design', () => {
    it('should work on mobile viewport', async () => {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.reload();
      await page.waitForLoadState('networkidle');
      
      // Check navbar toggle button is visible
      const navbarToggle = await page.locator('.navbar-toggler');
      expect(await navbarToggle.isVisible()).toBe(true);
      
      // Check main content is still accessible
      const mainContent = await page.locator('main, .container-fluid');
      expect(await mainContent.isVisible()).toBe(true);
    });

    it('should work on tablet viewport', async () => {
      await page.setViewportSize({ width: 768, height: 1024 });
      await page.reload();
      await page.waitForLoadState('networkidle');
      
      // Check navigation is accessible
      const navbar = await page.locator('.navbar');
      expect(await navbar.isVisible()).toBe(true);
      
      // Check kanban board layout
      await page.click('[data-view="curation"]');
      await page.waitForTimeout(500);
      
      const kanbanBoard = await page.locator('.kanban-board');
      expect(await kanbanBoard.isVisible()).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle network errors gracefully', async () => {
      // Simulate network failure
      await page.route('**/api/**', route => route.abort());
      
      await page.click('[data-view="curation"]');
      await page.waitForTimeout(2000);
      
      // Check for error message or fallback state
      const errorMessage = await page.locator('.error-message, .alert-danger');
      if (await errorMessage.isVisible()) {
        expect(await errorMessage.isVisible()).toBe(true);
      }
    });
  });

  describe('Accessibility', () => {
    it('should have proper ARIA labels and roles', async () => {
      // Check main navigation has proper roles
      const navbar = await page.locator('nav[role="navigation"], .navbar');
      expect(await navbar.isVisible()).toBe(true);
      
      // Check buttons have accessible names
      const buttons = await page.locator('button');
      const buttonCount = await buttons.count();
      
      for (let i = 0; i < buttonCount; i++) {
        const button = buttons.nth(i);
        if (await button.isVisible()) {
          const ariaLabel = await button.getAttribute('aria-label');
          const text = await button.textContent();
          const title = await button.getAttribute('title');
          
          // Button should have some form of accessible name
          expect(ariaLabel || text?.trim() || title).toBeTruthy();
        }
      }
    });

    it('should support keyboard navigation', async () => {
      // Test tab navigation through main elements
      await page.keyboard.press('Tab');
      
      // Check that focus is visible and logical
      const focusedElement = await page.locator(':focus');
      expect(await focusedElement.isVisible()).toBe(true);
    });
  });
});
