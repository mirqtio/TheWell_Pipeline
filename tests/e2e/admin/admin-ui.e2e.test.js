/**
 * Admin UI End-to-End Tests
 * Tests the admin interface functionality using Playwright
 */

const { test, expect } = require('@playwright/test');

// Configuration
const BASE_URL = process.env.ADMIN_UI_URL || 'http://localhost:3001';
const API_KEY = process.env.API_KEY || 'test-api-key';

test.describe('Admin UI - Navigation', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to admin UI and handle any authentication
    await page.goto(BASE_URL);
    
    // If there's an API key prompt, fill it
    const apiKeyInput = page.locator('input[name="apiKey"], input[placeholder*="API Key"]');
    if (await apiKeyInput.isVisible({ timeout: 1000 })) {
      await apiKeyInput.fill(API_KEY);
      await page.locator('button:has-text("Submit"), button:has-text("Login")').click();
    }
  });

  test('should load the dashboard', async ({ page }) => {
    await expect(page).toHaveTitle(/TheWell.*Admin|Dashboard/i);
    await expect(page.locator('h1, h2').first()).toContainText(/Dashboard|TheWell/i);
  });

  test('should navigate to review queue', async ({ page }) => {
    // Click on review/curation link
    await page.locator('a:has-text("Review"), a:has-text("Curation")').first().click();
    
    // Check we're on the review page
    await expect(page.url()).toContain('/review');
    await expect(page.locator('h1, h2').first()).toContainText(/Review|Curation/i);
  });

  test('should navigate to jobs queue', async ({ page }) => {
    // Click on jobs link
    await page.locator('a:has-text("Jobs"), a:has-text("Queue")').first().click();
    
    // Check we're on the jobs page
    await expect(page.url()).toContain('/jobs');
    await expect(page.locator('h1, h2').first()).toContainText(/Jobs|Queue/i);
  });

  test('should show system status', async ({ page }) => {
    // Look for status indicators
    const statusElement = page.locator('[data-testid="system-status"], .status, .health-status').first();
    await expect(statusElement).toBeVisible();
    
    // Should show some status information
    const statusText = await statusElement.textContent();
    expect(statusText).toMatch(/healthy|online|active|connected/i);
  });
});

test.describe('Admin UI - Document Review', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE_URL}/review`);
    
    // Handle authentication if needed
    const apiKeyInput = page.locator('input[name="apiKey"], input[placeholder*="API Key"]');
    if (await apiKeyInput.isVisible({ timeout: 1000 })) {
      await apiKeyInput.fill(API_KEY);
      await page.locator('button:has-text("Submit"), button:has-text("Login")').click();
    }
  });

  test('should display pending documents', async ({ page }) => {
    // Wait for documents to load
    await page.waitForSelector('.document-item, .review-item, tr[data-document-id]', { 
      timeout: 5000 
    }).catch(() => {
      // If no documents, check for empty state
    });
    
    // Check for document list or empty state
    const hasDocuments = await page.locator('.document-item, .review-item, tr[data-document-id]').count() > 0;
    const hasEmptyState = await page.locator('text=/no.*documents|empty/i').isVisible();
    
    expect(hasDocuments || hasEmptyState).toBeTruthy();
  });

  test('should filter documents', async ({ page }) => {
    // Look for filter controls
    const filterSelect = page.locator('select[name*="filter"], select[data-testid*="filter"]').first();
    
    if (await filterSelect.isVisible()) {
      // Change filter
      await filterSelect.selectOption({ index: 1 });
      
      // Wait for potential reload
      await page.waitForTimeout(500);
      
      // Verify filter was applied (URL or UI should change)
      const url = page.url();
      const hasFilterInUrl = url.includes('filter=');
      const filterLabel = await page.locator('.active-filter, .filter-badge').textContent().catch(() => '');
      
      expect(hasFilterInUrl || filterLabel).toBeTruthy();
    }
  });

  test('should search documents', async ({ page }) => {
    // Look for search input
    const searchInput = page.locator('input[type="search"], input[placeholder*="Search"]').first();
    
    if (await searchInput.isVisible()) {
      // Perform search
      await searchInput.fill('test search query');
      await searchInput.press('Enter');
      
      // Wait for results
      await page.waitForTimeout(1000);
      
      // Verify search was applied
      const url = page.url();
      expect(url).toContain('search');
    }
  });

  test('should open document details', async ({ page }) => {
    // Wait for documents
    const documentItem = page.locator('.document-item, .review-item, tr[data-document-id]').first();
    
    if (await documentItem.isVisible()) {
      // Click to view details
      await documentItem.click();
      
      // Should show document details
      await expect(page.locator('.document-details, .document-content, [data-testid="document-content"]')).toBeVisible();
      
      // Should show action buttons
      await expect(page.locator('button:has-text("Approve"), button:has-text("Accept")')).toBeVisible();
      await expect(page.locator('button:has-text("Reject"), button:has-text("Decline")')).toBeVisible();
    }
  });
});

test.describe('Admin UI - Job Management', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE_URL}/jobs`);
    
    // Handle authentication if needed
    const apiKeyInput = page.locator('input[name="apiKey"], input[placeholder*="API Key"]');
    if (await apiKeyInput.isVisible({ timeout: 1000 })) {
      await apiKeyInput.fill(API_KEY);
      await page.locator('button:has-text("Submit"), button:has-text("Login")').click();
    }
  });

  test('should display job queues', async ({ page }) => {
    // Should show queue statistics
    await expect(page.locator('text=/ingestion|enrichment|processing/i')).toBeVisible();
    
    // Should show job counts
    const statElements = page.locator('.stat-value, .queue-count, [data-testid*="count"]');
    expect(await statElements.count()).toBeGreaterThan(0);
  });

  test('should display job list', async ({ page }) => {
    // Wait for job list
    await page.waitForSelector('.job-item, .job-row, tr[data-job-id]', { 
      timeout: 5000 
    }).catch(() => {
      // If no jobs, check for empty state
    });
    
    // Should show jobs or empty state
    const hasJobs = await page.locator('.job-item, .job-row, tr[data-job-id]').count() > 0;
    const hasEmptyState = await page.locator('text=/no.*jobs|empty/i').isVisible();
    
    expect(hasJobs || hasEmptyState).toBeTruthy();
  });

  test('should filter jobs by status', async ({ page }) => {
    // Look for status filter
    const statusFilter = page.locator('button:has-text("Active"), button:has-text("Failed"), button:has-text("Completed")').first();
    
    if (await statusFilter.isVisible()) {
      // Click filter
      await statusFilter.click();
      
      // Wait for update
      await page.waitForTimeout(500);
      
      // Verify filter is active
      await expect(statusFilter).toHaveClass(/active|selected/);
    }
  });

  test('should retry failed jobs', async ({ page }) => {
    // Look for a failed job
    const failedJob = page.locator('.job-item.failed, tr:has-text("failed")').first();
    
    if (await failedJob.isVisible()) {
      // Find retry button
      const retryButton = failedJob.locator('button:has-text("Retry")');
      
      if (await retryButton.isVisible()) {
        // Click retry
        await retryButton.click();
        
        // Should show confirmation or success message
        await expect(page.locator('.toast, .notification, .alert-success')).toBeVisible();
      }
    }
  });
});

test.describe('Admin UI - System Monitoring', () => {
  test('should display metrics', async ({ page }) => {
    await page.goto(`${BASE_URL}/monitoring`);
    
    // Should show some metrics
    await expect(page.locator('text=/requests|latency|errors|uptime/i')).toBeVisible();
    
    // Should show metric values
    const metricValues = page.locator('.metric-value, .stat-number, [data-metric]');
    expect(await metricValues.count()).toBeGreaterThan(0);
  });

  test('should display cost information', async ({ page }) => {
    await page.goto(`${BASE_URL}/costs`);
    
    // Should show cost data
    await expect(page.locator('text=/cost|budget|spending/i')).toBeVisible();
    
    // Should show currency values
    const costElements = page.locator('text=/\\$|USD|cost/i');
    expect(await costElements.count()).toBeGreaterThan(0);
  });
});

test.describe('Admin UI - Responsiveness', () => {
  test('should be responsive on mobile', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    
    await page.goto(BASE_URL);
    
    // Check for mobile menu
    const mobileMenu = page.locator('.mobile-menu, .hamburger, button[aria-label*="Menu"]');
    await expect(mobileMenu).toBeVisible();
    
    // Open mobile menu
    await mobileMenu.click();
    
    // Navigation should be visible
    await expect(page.locator('nav, .navigation')).toBeVisible();
  });

  test('should handle errors gracefully', async ({ page }) => {
    // Try to access non-existent page
    await page.goto(`${BASE_URL}/non-existent-page-12345`);
    
    // Should show 404 or redirect to valid page
    const has404 = await page.locator('text=/404|not found/i').isVisible();
    const isRedirected = page.url().includes('/dashboard') || page.url() === BASE_URL + '/';
    
    expect(has404 || isRedirected).toBeTruthy();
  });
});