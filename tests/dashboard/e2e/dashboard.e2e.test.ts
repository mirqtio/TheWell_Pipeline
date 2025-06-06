import { test, expect, Page } from '@playwright/test';

const DASHBOARD_URL = 'http://localhost:3001/dashboard';

test.describe('Dashboard E2E Tests', () => {
  let page: Page;

  test.beforeEach(async ({ page: testPage }) => {
    page = testPage;
    await page.goto(DASHBOARD_URL);
    await page.waitForLoadState('networkidle');
  });

  test('dashboard loads successfully', async () => {
    // Check main layout elements
    await expect(page.locator('h6:has-text("TheWell Pipeline Dashboard")')).toBeVisible();
    await expect(page.locator('text=Overview')).toBeVisible();
    await expect(page.locator('text=Documents')).toBeVisible();
    await expect(page.locator('text=Search')).toBeVisible();
    await expect(page.locator('text=Alerts')).toBeVisible();
    await expect(page.locator('text=Reports')).toBeVisible();
  });

  test('overview page displays metrics', async () => {
    // Wait for metrics to load
    await page.waitForSelector('text=Daily Cost');
    
    // Check metric cards are visible
    await expect(page.locator('text=Daily Cost')).toBeVisible();
    await expect(page.locator('text=System Health')).toBeVisible();
    await expect(page.locator('text=Error Rate')).toBeVisible();
    await expect(page.locator('text=Active Connections')).toBeVisible();
    
    // Check charts are rendered
    await expect(page.locator('text=Cost Trend')).toBeVisible();
    await expect(page.locator('text=Provider Usage')).toBeVisible();
    await expect(page.locator('text=Quality Metrics')).toBeVisible();
    
    // Check activity feed
    await expect(page.locator('text=Recent Activity')).toBeVisible();
  });

  test('navigation between pages works', async () => {
    // Navigate to Documents
    await page.click('text=Documents');
    await expect(page.locator('h4:has-text("Documents")')).toBeVisible();
    await expect(page.locator('button:has-text("Add Document")')).toBeVisible();
    
    // Navigate to Search
    await page.click('text=Search');
    await expect(page.locator('h4:has-text("Search Analytics")')).toBeVisible();
    await expect(page.locator('input[placeholder*="Search documents"]')).toBeVisible();
    
    // Navigate to Alerts
    await page.click('text=Alerts');
    await expect(page.locator('h4:has-text("Alerts & Notifications")')).toBeVisible();
    await expect(page.locator('button:has-text("Create Alert Rule")')).toBeVisible();
    
    // Navigate to Reports
    await page.click('text=Reports');
    await expect(page.locator('h4:has-text("Reports & Analytics")')).toBeVisible();
    await expect(page.locator('button:has-text("Generate Report")')).toBeVisible();
  });

  test('sidebar drawer toggle works', async () => {
    // Check drawer is initially visible
    const drawer = page.locator('.MuiDrawer-paper');
    await expect(drawer).toBeVisible();
    
    // Toggle drawer closed
    await page.click('button[aria-label="toggle drawer"]');
    await expect(drawer).not.toBeVisible();
    
    // Toggle drawer open
    await page.click('button[aria-label="toggle drawer"]');
    await expect(drawer).toBeVisible();
  });

  test('filter panel interaction', async () => {
    // Check filter panel exists
    await expect(page.locator('text=Filters')).toBeVisible();
    
    // Open time range dropdown
    await page.click('label:has-text("Time Range")');
    await page.click('text=Last 7 Days');
    
    // Verify selection
    await expect(page.locator('text=Last 7 Days')).toBeVisible();
  });

  test('documents page functionality', async () => {
    await page.click('text=Documents');
    await page.waitForSelector('h4:has-text("Documents")');
    
    // Check statistics cards
    await expect(page.locator('text=Total Documents')).toBeVisible();
    await expect(page.locator('text=Processing')).toBeVisible();
    await expect(page.locator('text=Completed')).toBeVisible();
    await expect(page.locator('text=Failed')).toBeVisible();
    
    // Check data table
    await expect(page.locator('.MuiDataGrid-root')).toBeVisible();
    
    // Test filter panel
    await page.click('button[aria-label*="expand"]');
    await expect(page.locator('input[placeholder="Search..."]')).toBeVisible();
  });

  test('search page functionality', async () => {
    await page.click('text=Search');
    await page.waitForSelector('h4:has-text("Search Analytics")');
    
    // Check search input
    const searchInput = page.locator('input[placeholder*="Search documents"]');
    await expect(searchInput).toBeVisible();
    
    // Perform a search
    await searchInput.fill('test query');
    await page.click('button:has-text("Search")');
    
    // Check for results or no results message
    await page.waitForSelector('text=/Found|No results found/');
  });

  test('alerts page tabs and filtering', async () => {
    await page.click('text=Alerts');
    await page.waitForSelector('h4:has-text("Alerts & Notifications")');
    
    // Check tabs
    await expect(page.locator('text=Active')).toBeVisible();
    await expect(page.locator('text=Acknowledged')).toBeVisible();
    await expect(page.locator('text=Resolved')).toBeVisible();
    
    // Switch tabs
    await page.click('text=Acknowledged');
    await expect(page.locator('text=Acknowledged Alerts')).toBeVisible();
    
    await page.click('text=Resolved');
    await expect(page.locator('text=Resolved Alerts')).toBeVisible();
  });

  test('reports page dialog interactions', async () => {
    await page.click('text=Reports');
    await page.waitForSelector('h4:has-text("Reports & Analytics")');
    
    // Open generate report dialog
    await page.click('button:has-text("Generate Report")');
    await expect(page.locator('text=Generate New Report')).toBeVisible();
    
    // Fill form
    await page.fill('input[label="Report Name"]', 'Test Report');
    
    // Close dialog
    await page.click('button:has-text("Cancel")');
    await expect(page.locator('text=Generate New Report')).not.toBeVisible();
    
    // Open schedule dialog
    await page.click('button:has-text("Schedule Report")');
    await expect(page.locator('text=Schedule Report')).toBeVisible();
    await page.click('button:has-text("Cancel")');
  });

  test('real-time updates simulation', async () => {
    // Wait for initial load
    await page.waitForSelector('text=Daily Cost');
    
    // Get initial value
    const initialValue = await page.locator('text=Daily Cost').locator('..').locator('div:has-text("$")').textContent();
    
    // Wait for potential update (30 second auto-refresh)
    // In real scenario, this would test WebSocket updates
    await page.waitForTimeout(1000);
    
    // Verify page is still responsive
    await expect(page.locator('text=Daily Cost')).toBeVisible();
  });

  test('responsive behavior', async () => {
    // Test mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    
    // Drawer should be closed on mobile
    const drawer = page.locator('.MuiDrawer-paper');
    await expect(drawer).not.toBeVisible();
    
    // Toggle button should be visible
    await expect(page.locator('button[aria-label="toggle drawer"]')).toBeVisible();
    
    // Test tablet viewport
    await page.setViewportSize({ width: 768, height: 1024 });
    
    // Test desktop viewport
    await page.setViewportSize({ width: 1920, height: 1080 });
    await expect(drawer).toBeVisible();
  });

  test('error handling', async () => {
    // Simulate network error by blocking API calls
    await page.route('**/api/dashboard/**', route => route.abort());
    
    // Reload page
    await page.reload();
    
    // Should show error state
    await expect(page.locator('text=/Error|Failed to load/')).toBeVisible({ timeout: 10000 });
  });
});