/**
 * End-to-end tests for Manual Review UI workflow
 */

const puppeteer = require('puppeteer');
const ManualReviewServer = require('../../../src/web/server');

describe('Manual Review UI E2E Tests', () => {
  let browser;
  let page;
  let server;
  let serverUrl;

  beforeAll(async () => {
    // Start browser
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    // Mock dependencies for server
    const mockQueueManager = {
      getJobs: jest.fn().mockResolvedValue({
        jobs: [
          {
            id: 'job-1',
            queue: 'ingestion',
            name: 'Process PDF Document',
            status: 'active',
            progress: 75,
            data: { filename: 'sample.pdf' },
            createdAt: new Date().toISOString(),
            startedAt: new Date(Date.now() - 300000).toISOString()
          },
          {
            id: 'job-2',
            queue: 'enrichment',
            name: 'Extract Entities',
            status: 'completed',
            progress: 100,
            data: { documentId: 'doc-1' },
            createdAt: new Date(Date.now() - 600000).toISOString(),
            completedAt: new Date(Date.now() - 60000).toISOString()
          }
        ],
        pagination: { page: 1, pages: 1, total: 2, hasNext: false, hasPrev: false }
      }),
      getQueueStats: jest.fn().mockResolvedValue({
        queues: {
          ingestion: { waiting: 5, active: 2, completed: 150, failed: 3 },
          enrichment: { waiting: 2, active: 1, completed: 89, failed: 1 }
        }
      })
    };

    const mockIngestionEngine = {
      getPendingDocuments: jest.fn().mockResolvedValue({
        documents: [
          {
            id: 'doc-1',
            title: 'Introduction to Machine Learning',
            contentPreview: 'Machine learning is a subset of artificial intelligence that focuses on algorithms...',
            status: 'pending',
            metadata: { 
              fileType: 'pdf', 
              size: 2048576,
              source: 'academic-papers',
              uploadedAt: new Date().toISOString()
            },
            flags: []
          },
          {
            id: 'doc-2',
            title: 'Data Science Best Practices',
            contentPreview: 'This document outlines the fundamental principles and best practices...',
            status: 'pending',
            metadata: { 
              fileType: 'docx', 
              size: 1024000,
              source: 'internal-docs',
              uploadedAt: new Date(Date.now() - 3600000).toISOString()
            },
            flags: [{ type: 'quality-review', priority: 2 }]
          }
        ],
        pagination: { page: 1, pages: 1, total: 2, hasNext: false, hasPrev: false }
      }),
      getDocument: jest.fn().mockImplementation((id) => {
        const documents = {
          'doc-1': {
            id: 'doc-1',
            title: 'Introduction to Machine Learning',
            content: 'Machine learning is a subset of artificial intelligence that focuses on algorithms and statistical models that enable computer systems to improve their performance on a specific task through experience...',
            metadata: { 
              fileType: 'pdf', 
              size: 2048576,
              source: 'academic-papers',
              author: 'Dr. Jane Smith',
              uploadedAt: new Date().toISOString()
            },
            flags: []
          },
          'doc-2': {
            id: 'doc-2',
            title: 'Data Science Best Practices',
            content: 'This document outlines the fundamental principles and best practices for data science projects, including data collection, cleaning, analysis, and visualization techniques...',
            metadata: { 
              fileType: 'docx', 
              size: 1024000,
              source: 'internal-docs',
              author: 'John Doe',
              uploadedAt: new Date(Date.now() - 3600000).toISOString()
            },
            flags: [{ type: 'quality-review', priority: 2, notes: 'Needs technical verification' }]
          }
        };
        return Promise.resolve({ document: documents[id] });
      }),
      approveDocument: jest.fn().mockResolvedValue({ success: true }),
      rejectDocument: jest.fn().mockResolvedValue({ success: true }),
      flagDocument: jest.fn().mockResolvedValue({ success: true }),
      getReviewStats: jest.fn().mockResolvedValue({
        stats: {
          queue: { waiting: 15, reviewing: 3, completed: 245 },
          recent: { approved: 89, rejected: 12, flagged: 5, approvalRate: 88 },
          performance: { avgReviewTime: 180, documentsPerHour: 12 }
        }
      })
    };

    // Start server
    server = new ManualReviewServer({
      queueManager: mockQueueManager,
      ingestionEngine: mockIngestionEngine,
      port: 0, // Random port
      host: 'localhost'
    });

    await server.start();
    const address = server.server.address();
    serverUrl = `http://localhost:${address.port}`;
  });

  afterAll(async () => {
    if (server) {
      await server.shutdown();
    }
    if (browser) {
      await browser.close();
    }
  });

  beforeEach(async () => {
    page = await browser.newPage();
    
    // Set API key in localStorage for authentication
    await page.evaluateOnNewDocument(() => {
      localStorage.setItem('reviewApiKey', 'dev-review-key');
    });
    
    await page.goto(serverUrl);
  });

  afterEach(async () => {
    if (page) {
      await page.close();
    }
  });

  describe('Page Load and Navigation', () => {
    it('should load the manual review interface', async () => {
      await page.waitForSelector('.navbar-brand');
      
      const title = await page.$eval('.navbar-brand', el => el.textContent);
      expect(title).toContain('Manual Review');
      
      // Check that main navigation is present
      const navItems = await page.$$eval('.nav-link', els => els.map(el => el.textContent));
      expect(navItems).toContain('Review');
      expect(navItems).toContain('Jobs');
      expect(navItems).toContain('Stats');
    });

    it('should navigate between different views', async () => {
      // Start on review view (default)
      await page.waitForSelector('#review-view');
      expect(await page.$('#review-view')).toBeTruthy();

      // Navigate to jobs view
      await page.click('a[href="#jobs"]');
      await page.waitForSelector('#jobs-view');
      expect(await page.$('#jobs-view')).toBeTruthy();

      // Navigate to stats view
      await page.click('a[href="#stats"]');
      await page.waitForSelector('#stats-view');
      expect(await page.$('#stats-view')).toBeTruthy();

      // Navigate back to review view
      await page.click('a[href="#review"]');
      await page.waitForSelector('#review-view');
      expect(await page.$('#review-view')).toBeTruthy();
    });
  });

  describe('Document Review Workflow', () => {
    beforeEach(async () => {
      // Ensure we're on the review view
      await page.click('a[href="#review"]');
      await page.waitForSelector('#review-view');
    });

    it('should display pending documents list', async () => {
      await page.waitForSelector('.document-item');
      
      const documents = await page.$$('.document-item');
      expect(documents.length).toBe(2);
      
      // Check document titles
      const titles = await page.$$eval('.document-title', els => els.map(el => el.textContent));
      expect(titles).toContain('Introduction to Machine Learning');
      expect(titles).toContain('Data Science Best Practices');
    });

    it('should open document details modal', async () => {
      await page.waitForSelector('.document-item');
      
      // Click on first document
      await page.click('.document-item:first-child .btn-outline-primary');
      
      // Wait for modal to open
      await page.waitForSelector('#documentModal.show');
      
      // Check modal content
      const modalTitle = await page.$eval('#documentModalLabel', el => el.textContent);
      expect(modalTitle).toBe('Introduction to Machine Learning');
      
      const content = await page.$eval('#documentContent', el => el.textContent);
      expect(content).toContain('Machine learning is a subset of artificial intelligence');
    });

    it('should approve a document', async () => {
      await page.waitForSelector('.document-item');
      
      // Open document modal
      await page.click('.document-item:first-child .btn-outline-primary');
      await page.waitForSelector('#documentModal.show');
      
      // Click approve button
      await page.click('#approveBtn');
      
      // Fill approval form
      await page.waitForSelector('#approvalNotes');
      await page.type('#approvalNotes', 'Document approved for publication');
      await page.select('#approvalVisibility', 'public');
      
      // Submit approval
      await page.click('#confirmApproval');
      
      // Wait for success toast
      await page.waitForSelector('.toast.show');
      const toastText = await page.$eval('.toast-body', el => el.textContent);
      expect(toastText).toContain('approved successfully');
    });

    it('should reject a document', async () => {
      await page.waitForSelector('.document-item');
      
      // Open document modal
      await page.click('.document-item:first-child .btn-outline-primary');
      await page.waitForSelector('#documentModal.show');
      
      // Click reject button
      await page.click('#rejectBtn');
      
      // Fill rejection form
      await page.waitForSelector('#rejectionReason');
      await page.select('#rejectionReason', 'quality');
      await page.type('#rejectionNotes', 'Document contains factual errors');
      
      // Submit rejection
      await page.click('#confirmRejection');
      
      // Wait for success toast
      await page.waitForSelector('.toast.show');
      const toastText = await page.$eval('.toast-body', el => el.textContent);
      expect(toastText).toContain('rejected successfully');
    });

    it('should flag a document', async () => {
      await page.waitForSelector('.document-item');
      
      // Open document modal
      await page.click('.document-item:first-child .btn-outline-primary');
      await page.waitForSelector('#documentModal.show');
      
      // Click flag button
      await page.click('#flagBtn');
      
      // Fill flag form
      await page.waitForSelector('#flagType');
      await page.select('#flagType', 'quality-issue');
      await page.type('#flagNotes', 'Needs technical review');
      await page.select('#flagPriority', '2');
      
      // Submit flag
      await page.click('#confirmFlag');
      
      // Wait for success toast
      await page.waitForSelector('.toast.show');
      const toastText = await page.$eval('.toast-body', el => el.textContent);
      expect(toastText).toContain('flagged successfully');
    });
  });

  describe('Jobs Management', () => {
    beforeEach(async () => {
      await page.click('a[href="#jobs"]');
      await page.waitForSelector('#jobs-view');
    });

    it('should display jobs list', async () => {
      await page.waitForSelector('.job-row');
      
      const jobs = await page.$$('.job-row');
      expect(jobs.length).toBe(2);
      
      // Check job names
      const names = await page.$$eval('.job-name', els => els.map(el => el.textContent));
      expect(names).toContain('Process PDF Document');
      expect(names).toContain('Extract Entities');
    });

    it('should filter jobs by status', async () => {
      await page.waitForSelector('#statusFilter');
      
      // Filter by active jobs
      await page.select('#statusFilter', 'active');
      
      // Wait for filter to apply
      await page.waitForTimeout(500);
      
      const visibleJobs = await page.$$('.job-row:not(.d-none)');
      expect(visibleJobs.length).toBe(1);
    });

    it('should show job details', async () => {
      await page.waitForSelector('.job-row');
      
      // Click on first job
      await page.click('.job-row:first-child .btn-outline-info');
      
      // Wait for job details to load
      await page.waitForSelector('.job-details');
      
      const jobId = await page.$eval('.job-id', el => el.textContent);
      expect(jobId).toContain('job-1');
    });
  });

  describe('Statistics Dashboard', () => {
    beforeEach(async () => {
      await page.click('a[href="#stats"]');
      await page.waitForSelector('#stats-view');
    });

    it('should display review statistics', async () => {
      await page.waitForSelector('.stats-card');
      
      const statsCards = await page.$$('.stats-card');
      expect(statsCards.length).toBeGreaterThan(0);
      
      // Check for key metrics
      const cardTitles = await page.$$eval('.card-title', els => els.map(el => el.textContent));
      expect(cardTitles).toContain('Queue Status');
      expect(cardTitles).toContain('Recent Activity');
    });

    it('should show approval rate', async () => {
      await page.waitForSelector('.approval-rate');
      
      const approvalRate = await page.$eval('.approval-rate', el => el.textContent);
      expect(approvalRate).toContain('88%');
    });
  });

  describe('Search and Filtering', () => {
    beforeEach(async () => {
      await page.click('a[href="#review"]');
      await page.waitForSelector('#review-view');
    });

    it('should search documents', async () => {
      await page.waitForSelector('#searchInput');
      
      // Search for specific term
      await page.type('#searchInput', 'Machine Learning');
      await page.click('#searchBtn');
      
      // Wait for search results
      await page.waitForTimeout(500);
      
      const visibleDocs = await page.$$('.document-item:not(.d-none)');
      expect(visibleDocs.length).toBe(1);
    });

    it('should filter documents by status', async () => {
      await page.waitForSelector('#filterSelect');
      
      // Filter by flagged documents
      await page.select('#filterSelect', 'flagged');
      
      // Wait for filter to apply
      await page.waitForTimeout(500);
      
      const visibleDocs = await page.$$('.document-item:not(.d-none)');
      expect(visibleDocs.length).toBe(1);
    });
  });

  describe('Responsive Design', () => {
    it('should work on mobile viewport', async () => {
      await page.setViewport({ width: 375, height: 667 });
      
      await page.waitForSelector('.navbar-toggler');
      
      // Check that mobile menu toggle is visible
      const togglerVisible = await page.$eval('.navbar-toggler', el => 
        window.getComputedStyle(el).display !== 'none'
      );
      expect(togglerVisible).toBe(true);
      
      // Test mobile navigation
      await page.click('.navbar-toggler');
      await page.waitForSelector('.navbar-collapse.show');
      
      const navCollapse = await page.$('.navbar-collapse.show');
      expect(navCollapse).toBeTruthy();
    });
  });
});
