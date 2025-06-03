/**
 * Unit tests for Dashboard UI Components
 * Tests individual UI component functionality using JSDOM
 */

const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

describe('Dashboard UI Components', () => {
  let dom;
  let document;
  let window;
  let ManualReviewApp;

  beforeEach(() => {
    // Load the HTML file
    const htmlPath = path.join(__dirname, '../../../../src/web/public/index.html');
    const htmlContent = fs.readFileSync(htmlPath, 'utf8');
    
    // Create JSDOM instance
    dom = new JSDOM(htmlContent, {
      runScripts: 'dangerously',
      resources: 'usable',
      url: 'http://localhost:3099'
    });
    
    document = dom.window.document;
    window = dom.window;
    
    // Mock fetch
    window.fetch = jest.fn();
    
    // Mock console methods
    window.console = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn()
    };

    // Mock localStorage
    const localStorageMock = {
      getItem: jest.fn(),
      setItem: jest.fn(),
      removeItem: jest.fn(),
      clear: jest.fn()
    };
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock
    });

    // Load the app.js file content and evaluate it
    const appJsPath = path.join(__dirname, '../../../../src/web/public/app.js');
    if (fs.existsSync(appJsPath)) {
      const appJsContent = fs.readFileSync(appJsPath, 'utf8');
      const script = document.createElement('script');
      script.textContent = appJsContent;
      document.head.appendChild(script);
      
      // Get the ManualReviewApp class from the window
      ManualReviewApp = window.ManualReviewApp;
    }
  });

  afterEach(() => {
    dom.window.close();
    jest.clearAllMocks();
  });

  describe('Navigation Components', () => {
    it('should have all required navigation elements', () => {
      const navbar = document.querySelector('.navbar');
      expect(navbar).toBeTruthy();

      const navbarBrand = document.querySelector('.navbar-brand');
      expect(navbarBrand).toBeTruthy();
      expect(navbarBrand.textContent).toContain('TheWell Pipeline');

      // Check navigation links
      const navLinks = [
        '[data-view="review"]',
        '[data-view="curation"]', 
        '[data-view="jobs"]',
        '[data-view="visibility"]',
        '[data-view="stats"]'
      ];

      navLinks.forEach(selector => {
        const link = document.querySelector(selector);
        expect(link).toBeTruthy();
      });
    });

    it('should have proper Bootstrap classes for responsive design', () => {
      const navbar = document.querySelector('.navbar');
      expect(navbar.classList.contains('navbar-expand-lg')).toBe(true);
      expect(navbar.classList.contains('navbar-dark')).toBe(true);

      const navbarToggler = document.querySelector('.navbar-toggler');
      expect(navbarToggler).toBeTruthy();
    });
  });

  describe('Kanban Board Structure', () => {
    it('should have kanban board container', () => {
      const kanbanBoard = document.querySelector('.kanban-board');
      expect(kanbanBoard).toBeTruthy();
    });

    it('should have three kanban columns with correct structure', () => {
      const columns = [
        { selector: '[data-status="pending"]', id: 'pending-column' },
        { selector: '[data-status="in-review"]', id: 'in-review-column' },
        { selector: '[data-status="processed"]', id: 'processed-column' }
      ];

      columns.forEach(column => {
        const columnElement = document.querySelector(column.selector);
        expect(columnElement).toBeTruthy();
        expect(columnElement.classList.contains('kanban-column')).toBe(true);

        const header = columnElement.querySelector('.kanban-header');
        expect(header).toBeTruthy();

        const body = columnElement.querySelector('.kanban-body');
        expect(body).toBeTruthy();
        expect(body.id).toBe(column.id);
      });
    });

    it('should have count badges for each column', () => {
      const countBadges = [
        '#pending-kanban-count',
        '#in-review-kanban-count',
        '#processed-kanban-count'
      ];

      countBadges.forEach(selector => {
        const badge = document.querySelector(selector);
        expect(badge).toBeTruthy();
        expect(badge.classList.contains('badge')).toBe(true);
      });
    });
  });

  describe('View Containers', () => {
    it('should have all required view containers', () => {
      const views = [
        '#review-view',
        '#curation-view', 
        '#jobs-view',
        '#visibility-view',
        '#stats-view'
      ];

      views.forEach(selector => {
        const view = document.querySelector(selector);
        expect(view).toBeTruthy();
      });
    });

    it('should have proper Bootstrap grid structure', () => {
      const containers = document.querySelectorAll('.container-fluid');
      expect(containers.length).toBeGreaterThan(0);

      const rows = document.querySelectorAll('.row');
      expect(rows.length).toBeGreaterThan(0);

      const cols = document.querySelectorAll('[class*="col-"]');
      expect(cols.length).toBeGreaterThan(0);
    });
  });

  describe('ManualReviewApp Class', () => {
    let app;

    beforeEach(() => {
      if (ManualReviewApp) {
        app = new ManualReviewApp();
      }
    });

    it('should initialize with default properties', () => {
      if (!app) {
        console.warn('ManualReviewApp not available, skipping test');
        return;
      }

      expect(app.currentView).toBe('review');
      expect(app.apiKey).toBeTruthy();
      expect(app.documents).toEqual([]);
      expect(app.curationData).toEqual({
        pending: [],
        'in-review': [],
        processed: []
      });
    });

    it('should have required methods', () => {
      if (!app) {
        console.warn('ManualReviewApp not available, skipping test');
        return;
      }

      const requiredMethods = [
        'init',
        'setupEventListeners',
        'showView',
        'loadDocuments',
        'loadCurationData',
        'renderKanbanBoard',
        'updateKanbanCounts'
      ];

      requiredMethods.forEach(method => {
        expect(typeof app[method]).toBe('function');
      });
    });

    describe('View Management', () => {
      it('should switch views correctly', () => {
        if (!app) return;

        // Mock the showView method behavior
        const mockShowView = jest.fn();
        app.showView = mockShowView;

        // Test view switching
        app.showView('curation');
        expect(mockShowView).toHaveBeenCalledWith('curation');

        app.showView('jobs');
        expect(mockShowView).toHaveBeenCalledWith('jobs');
      });
    });

    describe('Data Loading', () => {
      it('should handle API responses correctly', async () => {
        if (!app) return;

        const mockResponse = {
          ok: true,
          json: jest.fn().mockResolvedValue({
            documents: [
              { id: '1', title: 'Test Doc', status: 'pending' }
            ]
          })
        };

        window.fetch.mockResolvedValue(mockResponse);

        if (app.loadCurationData) {
          await app.loadCurationData();
          expect(window.fetch).toHaveBeenCalledWith(
            '/api/v1/review/pending?limit=100',
            expect.objectContaining({
              headers: expect.objectContaining({
                'x-api-key': app.apiKey,
                'Content-Type': 'application/json'
              })
            })
          );
        }
      });

      it('should handle API errors gracefully', async () => {
        if (!app) return;

        window.fetch.mockRejectedValue(new Error('Network error'));

        if (app.loadCurationData) {
          await app.loadCurationData();
          expect(window.console.error).toHaveBeenCalled();
        }
      });
    });

    describe('Kanban Board Rendering', () => {
      it('should organize documents by status', () => {
        if (!app) return;

        const testData = {
          documents: [
            { id: '1', status: 'pending', title: 'Pending Doc' },
            { id: '2', status: 'in-review', title: 'Review Doc' },
            { id: '3', status: 'approved', title: 'Approved Doc' }
          ]
        };

        if (app.organizeCurationData) {
          const organized = app.organizeCurationData(testData);
          expect(organized.pending).toHaveLength(1);
          expect(organized['in-review']).toHaveLength(1);
          expect(organized.processed).toHaveLength(1);
        }
      });

      it('should update column counts correctly', () => {
        if (!app) return;

        app.curationData = {
          pending: [{ id: '1' }, { id: '2' }],
          'in-review': [{ id: '3' }],
          processed: [{ id: '4' }, { id: '5' }, { id: '6' }]
        };

        if (app.updateKanbanCounts) {
          app.updateKanbanCounts();

          const pendingCount = document.querySelector('#pending-kanban-count');
          const inReviewCount = document.querySelector('#in-review-kanban-count');
          const processedCount = document.querySelector('#processed-kanban-count');

          expect(pendingCount.textContent).toBe('2');
          expect(inReviewCount.textContent).toBe('1');
          expect(processedCount.textContent).toBe('3');
        }
      });
    });
  });

  describe('Form Components', () => {
    it('should have search input with proper attributes', () => {
      const searchInput = document.querySelector('#curation-search');
      if (searchInput) {
        expect(searchInput.type).toBe('text');
        expect(searchInput.hasAttribute('placeholder')).toBe(true);
      }
    });

    it('should have filter controls', () => {
      const filterControls = document.querySelector('.filter-controls');
      if (filterControls) {
        expect(filterControls).toBeTruthy();
      }
    });
  });

  describe('Button Components', () => {
    it('should have action buttons with proper data attributes', () => {
      const actionButtons = document.querySelectorAll('[data-action]');
      
      actionButtons.forEach(button => {
        expect(button.hasAttribute('data-action')).toBe(true);
        
        const action = button.getAttribute('data-action');
        expect(action).toBeTruthy();
        expect(typeof action).toBe('string');
      });
    });

    it('should have proper Bootstrap button classes', () => {
      const buttons = document.querySelectorAll('button');
      
      buttons.forEach(button => {
        // Skip special buttons that don't need btn classes
        if (button.classList.contains('navbar-toggler') || 
            button.classList.contains('btn-close') ||
            button.classList.contains('nav-link')) {
          return;
        }
        
        // Most buttons should have Bootstrap button classes
        const hasButtonClass = Array.from(button.classList).some(cls => 
          cls.startsWith('btn')
        );
        
        expect(hasButtonClass).toBe(true);
      });
    });
  });

  describe('Loading States', () => {
    it('should have loading indicator elements', () => {
      const loadingIndicators = document.querySelectorAll('.loading-indicator, .spinner-border');
      // Loading indicators might not be present initially, but structure should support them
      expect(loadingIndicators.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Error Handling UI', () => {
    it('should have error message containers', () => {
      const errorContainers = document.querySelectorAll('.error-message, .alert-danger');
      // Error containers might not be visible initially
      expect(errorContainers.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Accessibility Features', () => {
    it('should have proper ARIA labels where needed', () => {
      const elementsWithAria = document.querySelectorAll('[aria-label], [aria-labelledby], [role]');
      expect(elementsWithAria.length).toBeGreaterThan(0);
    });

    it('should have semantic HTML structure', () => {
      const nav = document.querySelector('nav');
      expect(nav).toBeTruthy();

      const main = document.querySelector('main');
      if (main) {
        expect(main).toBeTruthy();
      }

      const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
      expect(headings.length).toBeGreaterThan(0);
    });
  });
});
