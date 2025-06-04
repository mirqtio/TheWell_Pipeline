/**
 * End-to-end tests for enrichment pipeline visualization
 * Tests complete user workflows in the admin dashboard
 */

const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const { waitForServer, killProcess } = require('../../helpers/server');

describe('Enrichment Pipeline E2E Tests', () => {
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
  }, 35000);

  afterAll(async () => {
    if (browser) {
      await browser.close();
    }
    if (webServer) {
      await killProcess(webServer);
    }
  });

  describe('Admin Dashboard Enrichment Visualization', () => {
    it('should load admin dashboard and display enrichment tab', async () => {
      await page.goto(`${baseUrl}/admin`);
      
      // Wait for page to load
      await page.waitForSelector('.admin-sidebar');
      
      // Check for enrichment tab
      const enrichmentTab = await page.$('[data-tab="enrichment"]');
      expect(enrichmentTab).toBeTruthy();
      
      // Verify tab text
      const tabText = await page.evaluate(el => el.textContent, enrichmentTab);
      expect(tabText).toContain('Enrichment Pipeline');
    });

    it('should load enrichment visualization when tab is clicked', async () => {
      await page.goto(`${baseUrl}/admin`);
      await page.waitForSelector('.admin-sidebar');
      
      // Click enrichment tab
      await page.click('[data-tab="enrichment"]');
      
      // Wait for content to load
      await page.waitForSelector('.enrichment-pipeline', { timeout: 10000 });
      
      // Verify pipeline visualization is displayed
      const pipelineElement = await page.$('.enrichment-pipeline');
      expect(pipelineElement).toBeTruthy();
      
      // Check for pipeline stages
      const stages = await page.$$('.pipeline-stage');
      expect(stages.length).toBeGreaterThan(0);
    });

    it('should display pipeline metrics overview', async () => {
      await page.goto(`${baseUrl}/admin`);
      await page.waitForSelector('.admin-sidebar');
      await page.click('[data-tab="enrichment"]');
      await page.waitForSelector('.enrichment-pipeline');
      
      // Check for metrics cards
      const metricsCards = await page.$$('.metric-card');
      expect(metricsCards.length).toBeGreaterThan(0);
      
      // Verify specific metrics are displayed
      const pageContent = await page.content();
      expect(pageContent).toMatch(/Total Processed/);
      expect(pageContent).toMatch(/Success Rate/);
      expect(pageContent).toMatch(/Throughput/);
    });

    it('should toggle between pipeline flow and metrics views', async () => {
      await page.goto(`${baseUrl}/admin`);
      await page.waitForSelector('.admin-sidebar');
      await page.click('[data-tab="enrichment"]');
      await page.waitForSelector('.enrichment-pipeline');
      
      // Find view toggle buttons
      const flowViewBtn = await page.$('[onclick*="showPipelineFlow"]');
      const metricsViewBtn = await page.$('[onclick*="showPipelineMetrics"]');
      
      if (flowViewBtn && metricsViewBtn) {
        // Test flow view
        await flowViewBtn.click();
        await page.waitForTimeout(500);
        
        const flowViewVisible = await page.evaluate(() => {
          const flowView = document.getElementById('pipeline-flow-view');
          return flowView && flowView.style.display !== 'none';
        });
        expect(flowViewVisible).toBe(true);
        
        // Test metrics view
        await metricsViewBtn.click();
        await page.waitForTimeout(500);
        
        const metricsViewVisible = await page.evaluate(() => {
          const metricsView = document.getElementById('pipeline-metrics-view');
          return metricsView && metricsView.style.display !== 'none';
        });
        expect(metricsViewVisible).toBe(true);
      }
    });

    it('should display provider performance information', async () => {
      await page.goto(`${baseUrl}/admin`);
      await page.waitForSelector('.admin-sidebar');
      await page.click('[data-tab="enrichment"]');
      await page.waitForSelector('.enrichment-pipeline');
      
      // Check for provider cards
      const providerCards = await page.$$('.provider-card');
      expect(providerCards.length).toBeGreaterThan(0);
      
      // Verify provider information is displayed
      const pageContent = await page.content();
      expect(pageContent).toMatch(/Response Time/);
      expect(pageContent).toMatch(/Success Rate/);
      expect(pageContent).toMatch(/Requests Today/);
      expect(pageContent).toMatch(/Cost Today/);
    });

    it('should display strategy distribution and performance', async () => {
      await page.goto(`${baseUrl}/admin`);
      await page.waitForSelector('.admin-sidebar');
      await page.click('[data-tab="enrichment"]');
      await page.waitForSelector('.enrichment-pipeline');
      
      // Check for strategy section
      const strategySection = await page.$('.strategy-distribution');
      expect(strategySection).toBeTruthy();
      
      // Verify strategy information is displayed
      const pageContent = await page.content();
      expect(pageContent).toMatch(/Strategy Distribution/);
      expect(pageContent).toMatch(/Performance Metrics/);
      
      // Check for strategy bars
      const strategyBars = await page.$$('.strategy-bar');
      expect(strategyBars.length).toBeGreaterThan(0);
    });

    it('should display recent activity feed', async () => {
      await page.goto(`${baseUrl}/admin`);
      await page.waitForSelector('.admin-sidebar');
      await page.click('[data-tab="enrichment"]');
      await page.waitForSelector('.enrichment-pipeline');
      
      // Check for activity feed
      const activityFeed = await page.$('.activity-feed');
      expect(activityFeed).toBeTruthy();
      
      // Check for activity items
      const activityItems = await page.$$('.activity-item');
      expect(activityItems.length).toBeGreaterThan(0);
      
      // Verify activity information is displayed
      const pageContent = await page.content();
      expect(pageContent).toMatch(/Recent Activity/);
    });

    it('should handle API errors gracefully', async () => {
      // Intercept API request and return error
      await page.setRequestInterception(true);
      
      page.on('request', (request) => {
        if (request.url().includes('/api/dashboard/admin/data/enrichment')) {
          request.respond({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'Internal server error' })
          });
        } else {
          request.continue();
        }
      });
      
      await page.goto(`${baseUrl}/admin`);
      await page.waitForSelector('.admin-sidebar');
      await page.click('[data-tab="enrichment"]');
      
      // Wait for error handling
      await page.waitForTimeout(2000);
      
      // Check for error message
      const pageContent = await page.content();
      expect(pageContent).toMatch(/Error loading enrichment data/);
      
      // Clean up request interception
      await page.setRequestInterception(false);
    });
  });
});
