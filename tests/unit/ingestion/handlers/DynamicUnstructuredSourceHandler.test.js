const DynamicUnstructuredSourceHandler = require('../../../../src/ingestion/handlers/DynamicUnstructuredSourceHandler');
const { SOURCE_TYPES, VISIBILITY_LEVELS } = require('../../../../src/ingestion/types');
const puppeteer = require('puppeteer');

// Mock puppeteer
jest.mock('puppeteer');
const mockedPuppeteer = puppeteer;

describe('DynamicUnstructuredSourceHandler', () => {
  let handler;
  let mockConfig;
  let mockLogger;
  let mockBrowser;
  let mockPage;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    };

    mockPage = {
      goto: jest.fn(),
      content: jest.fn(),
      evaluate: jest.fn(),
      waitForSelector: jest.fn(),
      screenshot: jest.fn(),
      close: jest.fn(),
      setUserAgent: jest.fn(),
      setViewport: jest.fn()
    };

    mockBrowser = {
      newPage: jest.fn().mockResolvedValue(mockPage),
      close: jest.fn()
    };

    mockedPuppeteer.launch.mockResolvedValue(mockBrowser);

    mockConfig = {
      id: 'dynamic-unstructured-test',
      name: 'Dynamic Unstructured Test Source',
      type: SOURCE_TYPES.DYNAMIC_UNSTRUCTURED,
      enabled: true,
      visibility: VISIBILITY_LEVELS.EXTERNAL,
      config: {
        targets: [
          {
            name: 'News Site',
            baseUrl: 'https://news.example.com',
            selectors: {
              articleLinks: 'a.article-link',
              title: 'h1.article-title',
              content: '.article-content',
              author: '.author-name',
              publishDate: '.publish-date'
            },
            pagination: {
              enabled: true,
              nextSelector: '.next-page',
              maxPages: 5
            }
          }
        ],
        browser: {
          headless: true,
          timeout: 30000,
          userAgent: 'Mozilla/5.0 (compatible; TheWell Bot)'
        },
        crawling: {
          respectRobots: true,
          delayBetweenRequests: 1000,
          maxConcurrentPages: 3
        },
        contentFilters: {
          minWordCount: 50,
          excludePatterns: ['advertisement', 'sponsored']
        }
      }
    };

    handler = new DynamicUnstructuredSourceHandler(mockConfig);
    handler.logger = mockLogger;
  });

  describe('Configuration Validation', () => {
    test('should validate valid configuration', async () => {
      const result = await handler.validateConfig(mockConfig);
      expect(result).toBe(true);
    });

    test('should reject configuration without targets', async () => {
      const invalidConfig = { ...mockConfig };
      delete invalidConfig.config.targets;

      await expect(handler.validateConfig(invalidConfig))
        .rejects.toThrow('Missing required config fields: targets');
    });

    test('should reject configuration with empty targets array', async () => {
      const invalidConfig = { ...mockConfig };
      invalidConfig.config.targets = [];

      await expect(handler.validateConfig(invalidConfig))
        .rejects.toThrow('At least one target must be configured');
    });

    test('should validate target configurations', async () => {
      const invalidConfig = { ...mockConfig };
      invalidConfig.config.targets[0] = { name: 'Invalid' }; // Missing required fields

      await expect(handler.validateConfig(invalidConfig))
        .rejects.toThrow('Target configuration invalid');
    });

    test('should validate selector configurations', async () => {
      const invalidConfig = { ...mockConfig };
      delete invalidConfig.config.targets[0].selectors.articleLinks;

      await expect(handler.validateConfig(invalidConfig))
        .rejects.toThrow('Missing required selectors');
    });
  });

  describe('Initialization', () => {
    test('should initialize successfully with valid configuration', async () => {
      await handler.initialize();

      expect(mockedPuppeteer.launch).toHaveBeenCalledWith({
        headless: true,
        args: expect.arrayContaining(['--no-sandbox'])
      });
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Initializing DynamicUnstructuredSourceHandler',
        { sourceId: 'dynamic-unstructured-test' }
      );
    });

    test('should handle browser initialization failure', async () => {
      mockedPuppeteer.launch.mockRejectedValue(new Error('Browser launch failed'));

      await expect(handler.initialize()).rejects.toThrow('Browser launch failed');
    });
  });

  describe('Discovery', () => {
    beforeEach(async () => {
      await handler.initialize();
    });

    test('should discover articles from target sites', async () => {
      mockPage.goto.mockResolvedValue(undefined);
      mockPage.evaluate.mockResolvedValue([
        { href: 'https://news.example.com/article1', text: 'Article 1' },
        { href: 'https://news.example.com/article2', text: 'Article 2' },
        { href: 'https://news.example.com/article3', text: 'Article 3' }
      ]);

      const documents = await handler.discover();

      expect(documents).toHaveLength(3);
      expect(documents[0]).toMatchObject({
        url: 'https://news.example.com/article1',
        metadata: {
          sourceId: 'dynamic-unstructured-test',
          sourceType: SOURCE_TYPES.DYNAMIC_UNSTRUCTURED,
          targetName: 'News Site',
          discoveredAt: expect.any(Date)
        }
      });
    });

    test('should handle pagination', async () => {
      mockPage.goto.mockResolvedValue(undefined);
      mockPage.evaluate
        .mockResolvedValueOnce([
          { href: 'https://news.example.com/article1', text: 'Article 1' }
        ])
        .mockResolvedValueOnce([
          { href: 'https://news.example.com/article2', text: 'Article 2' }
        ])
        .mockResolvedValueOnce([]); // No more articles

      mockPage.waitForSelector
        .mockResolvedValueOnce(true) // Next button exists
        .mockResolvedValueOnce(false); // No more next button

      const documents = await handler.discover();

      expect(documents.length).toBeGreaterThanOrEqual(2);
      expect(mockPage.goto).toHaveBeenCalledTimes(3); // Initial + 2 pagination pages
    });

    test('should respect robots.txt when enabled', async () => {
      const robotsHandler = new DynamicUnstructuredSourceHandler({
        ...mockConfig,
        config: {
          ...mockConfig.config,
          crawling: { ...mockConfig.config.crawling, respectRobots: true }
        }
      });

      // Mock robots.txt check
      robotsHandler._checkRobotsTxt = jest.fn().mockResolvedValue(true);

      await robotsHandler.initialize();
      await robotsHandler.discover();

      expect(robotsHandler._checkRobotsTxt).toHaveBeenCalled();
    });

    test('should handle discovery errors gracefully', async () => {
      mockPage.goto.mockRejectedValue(new Error('Page load failed'));

      const documents = await handler.discover();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Target discovery failed',
        expect.objectContaining({ targetName: 'News Site' })
      );
      expect(documents).toEqual([]);
    });
  });

  describe('Content Extraction', () => {
    beforeEach(async () => {
      await handler.initialize();
    });

    test('should extract article content using selectors', async () => {
      const mockDocument = {
        id: 'test-doc',
        url: 'https://news.example.com/article1',
        metadata: {
          targetName: 'News Site'
        }
      };

      mockPage.goto.mockResolvedValue(undefined);
      mockPage.evaluate.mockResolvedValue({
        title: 'Test Article Title',
        content: 'This is the article content with multiple paragraphs.',
        author: 'John Doe',
        publishDate: '2023-01-01'
      });

      const result = await handler.extract(mockDocument);

      expect(result).toMatchObject({
        id: 'test-doc',
        content: 'This is the article content with multiple paragraphs.',
        extractedAt: expect.any(Date),
        metadata: {
          targetName: 'News Site',
          extractionMethod: 'puppeteer-scrape',
          title: 'Test Article Title',
          author: 'John Doe',
          publishDate: '2023-01-01'
        }
      });
      expect(result.contentHash).toBeDefined();
    });

    test('should handle missing content elements', async () => {
      const mockDocument = {
        id: 'test-doc',
        url: 'https://news.example.com/article1',
        metadata: { targetName: 'News Site' }
      };

      mockPage.goto.mockResolvedValue(undefined);
      mockPage.evaluate.mockResolvedValue({
        title: 'Test Article',
        content: null, // Missing content
        author: 'John Doe'
      });

      const result = await handler.extract(mockDocument);

      expect(result.content).toBe('');
      expect(result.metadata.title).toBe('Test Article');
    });

    test('should handle extraction errors', async () => {
      const mockDocument = {
        id: 'test-doc',
        url: 'https://news.example.com/article1',
        metadata: { targetName: 'News Site' }
      };

      mockPage.goto.mockRejectedValue(new Error('Page not accessible'));

      await expect(handler.extract(mockDocument)).rejects.toThrow('Page not accessible');
    });

    test('should apply content filters', async () => {
      const mockDocument = {
        id: 'test-doc',
        url: 'https://news.example.com/article1',
        metadata: { targetName: 'News Site' }
      };

      mockPage.goto.mockResolvedValue(undefined);
      mockPage.evaluate.mockResolvedValue({
        title: 'Short Article',
        content: 'Too short', // Below minWordCount
        author: 'John Doe'
      });

      const result = await handler.extract(mockDocument);

      expect(result.metadata.filtered).toBe(true);
      expect(result.metadata.filterReason).toContain('word count');
    });
  });

  describe('Content Transformation', () => {
    test('should transform extracted content', async () => {
      const extractedContent = {
        id: 'test-doc',
        content: '  This is article content with extra whitespace.  \n\n\n',
        contentHash: 'abc123',
        metadata: {
          targetName: 'News Site',
          title: 'Article Title',
          author: 'John Doe',
          publishDate: '2023-01-01'
        }
      };

      const result = await handler.transform(extractedContent);

      expect(result).toMatchObject({
        id: 'test-doc',
        title: 'Article Title',
        content: 'This is article content with extra whitespace.',
        contentHash: 'abc123',
        metadata: {
          targetName: 'News Site',
          author: 'John Doe',
          publishDate: '2023-01-01',
          transformedAt: expect.any(Date),
          wordCount: 7,
          characterCount: 42
        }
      });
    });

    test('should handle missing title in metadata', async () => {
      const extractedContent = {
        id: 'test-doc',
        content: 'Article content without title',
        contentHash: 'def456',
        metadata: {
          targetName: 'News Site'
        }
      };

      const result = await handler.transform(extractedContent);

      expect(result.title).toBe('Untitled');
    });
  });

  describe('Selector Evaluation', () => {
    test('should evaluate selectors correctly', async () => {
      const selectors = {
        title: 'h1.title',
        content: '.content',
        author: '.author'
      };

      const mockResult = {
        title: 'Test Title',
        content: 'Test Content',
        author: 'Test Author'
      };

      mockPage.evaluate.mockResolvedValue(mockResult);

      const result = await handler._evaluateSelectors(mockPage, selectors);

      expect(result).toEqual(mockResult);
      expect(mockPage.evaluate).toHaveBeenCalledWith(expect.any(Function), selectors);
    });
  });

  describe('Pagination Handling', () => {
    test('should handle pagination correctly', async () => {
      const target = {
        baseUrl: 'https://news.example.com',
        pagination: {
          enabled: true,
          nextSelector: '.next',
          maxPages: 3
        }
      };

      mockPage.waitForSelector
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);

      const urls = [];
      const collectUrls = (url) => urls.push(url);

      await handler._handlePagination(mockPage, target, collectUrls);

      expect(urls).toHaveLength(3); // Initial + 2 paginated pages
    });

    test('should respect maxPages limit', async () => {
      const target = {
        baseUrl: 'https://news.example.com',
        pagination: {
          enabled: true,
          nextSelector: '.next',
          maxPages: 2
        }
      };

      mockPage.waitForSelector.mockResolvedValue(true); // Always has next

      const urls = [];
      const collectUrls = (url) => urls.push(url);

      await handler._handlePagination(mockPage, target, collectUrls);

      expect(urls).toHaveLength(2); // Respects maxPages
    });
  });

  describe('Helper Methods', () => {
    test('should generate document ID from URL', () => {
      const url = 'https://news.example.com/article1';
      const id = handler._generateDocumentId(url);
      
      expect(id).toBeDefined();
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    });

    test('should clean extracted content', () => {
      const dirtyContent = '  Content with   extra   spaces  \n\n\n';
      const cleaned = handler._cleanContent(dirtyContent);
      
      expect(cleaned).toBe('Content with extra spaces');
    });

    test('should validate content against filters', () => {
      const filters = {
        minWordCount: 5,
        excludePatterns: ['advertisement', 'sponsored']
      };

      expect(handler._validateContent('Short', filters)).toBe(false);
      expect(handler._validateContent('This is a sponsored content piece', filters)).toBe(false);
      expect(handler._validateContent('This is valid content with enough words', filters)).toBe(true);
    });

    test('should check robots.txt compliance', async () => {
      const url = 'https://news.example.com/article1';
      
      // Mock successful robots.txt check
      handler._fetchRobotsTxt = jest.fn().mockResolvedValue('User-agent: *\nAllow: /');
      
      const allowed = await handler._checkRobotsTxt(url);
      expect(allowed).toBe(true);
    });

    test('should count words correctly', () => {
      expect(handler._countWords('Hello world test')).toBe(3);
      expect(handler._countWords('  Multiple   spaces  ')).toBe(2);
      expect(handler._countWords('')).toBe(0);
    });

    test('should apply delay between requests', async () => {
      const startTime = Date.now();
      await handler._applyDelay(100);
      const endTime = Date.now();
      
      expect(endTime - startTime).toBeGreaterThanOrEqual(100);
    });
  });

  describe('Cleanup', () => {
    test('should cleanup browser resources', async () => {
      await handler.initialize();
      await handler.cleanup();
      
      expect(mockBrowser.close).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        'DynamicUnstructuredSourceHandler cleanup completed',
        { sourceId: 'dynamic-unstructured-test' }
      );
    });

    test('should handle cleanup when browser not initialized', async () => {
      await handler.cleanup();
      
      expect(mockLogger.info).toHaveBeenCalledWith(
        'DynamicUnstructuredSourceHandler cleanup completed',
        { sourceId: 'dynamic-unstructured-test' }
      );
    });
  });
});
