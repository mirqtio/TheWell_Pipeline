const DynamicUnstructuredSourceHandler = require('../../../../src/ingestion/handlers/DynamicUnstructuredSourceHandler');
const { SOURCE_TYPES, VISIBILITY_LEVELS } = require('../../../../src/ingestion/types');
const axios = require('axios');

// Mock axios
jest.mock('axios');
const mockedAxios = axios;

describe('DynamicUnstructuredSourceHandler', () => {
  let handler;
  let mockConfig;
  let mockLogger;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    };

    // Setup axios mock
    mockedAxios.create = jest.fn().mockReturnValue({
      get: jest.fn().mockResolvedValue({
        data: '<html><head><title>Test Page</title></head><body><p>Test content</p><a href="/link1">Link 1</a><a href="/link2">Link 2</a></body></html>',
        status: 200,
        headers: {}
      }),
      defaults: { headers: { common: {} } }
    });

    mockConfig = {
      id: 'dynamic-unstructured-test',
      type: SOURCE_TYPES.DYNAMIC_UNSTRUCTURED,
      visibility: VISIBILITY_LEVELS.EXTERNAL,
      config: {
        targets: [
          {
            name: 'News Articles',
            type: 'web-crawler',
            baseUrl: 'https://news.example.com',
            config: {
              startUrls: ['https://news.example.com'],
              maxDepth: 2,
              maxPages: 50
            },
            selectors: {
              articleLinks: 'a.article-link',
              title: 'h1.article-title',
              content: '.article-content',
              author: '.author-name',
              publishDate: '.publish-date'
            }
          }
        ],
        crawling: {
          respectRobots: true,
          delayBetweenRequests: 1000
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
  });

  describe('Initialization', () => {
    test('should initialize successfully with valid configuration', async () => {
      await handler.initialize();

      expect(mockedAxios.create).toHaveBeenCalledWith({
        timeout: 45000,
        headers: expect.objectContaining({
          'User-Agent': expect.stringContaining('TheWell-Pipeline')
        })
      });
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Initializing DynamicUnstructuredSourceHandler',
        { sourceId: 'dynamic-unstructured-test' }
      );
    });

    test('should use default timeout when not configured', async () => {
      await handler.initialize();

      expect(mockedAxios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          timeout: 45000
        })
      );
    });
  });

  describe('Document Discovery', () => {
    beforeEach(async () => {
      await handler.initialize();
    });

    test('should discover documents from web crawler target', async () => {
      const mockHttpClient = {
        get: jest.fn().mockResolvedValue({
          data: '<html><body><a href="https://example.com/article1">Article 1</a><a href="https://example.com/article2">Article 2</a></body></html>'
        })
      };
      handler.httpClient = mockHttpClient;

      const documents = await handler.discover();

      expect(documents).toBeInstanceOf(Array);
      expect(documents.length).toBeGreaterThan(0);
      expect(documents[0]).toMatchObject({
        id: expect.any(String),
        url: expect.stringContaining('example.com'),
        metadata: expect.objectContaining({
          sourceId: 'dynamic-unstructured-test',
          sourceType: SOURCE_TYPES.DYNAMIC_UNSTRUCTURED
        })
      });
    });

    test('should handle discovery errors gracefully', async () => {
      const mockHttpClient = {
        get: jest.fn().mockRejectedValue(new Error('Network error'))
      };
      handler.httpClient = mockHttpClient;

      const documents = await handler.discover();

      expect(documents).toBeInstanceOf(Array);
      expect(documents.length).toBe(0);
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('Content Extraction', () => {
    beforeEach(async () => {
      await handler.initialize();
    });

    test('should extract content from document URL', async () => {
      const mockDocument = {
        id: 'test-doc',
        url: 'https://example.com/article',
        title: 'Test Article',
        metadata: {
          sourceId: 'dynamic-unstructured-test'
        }
      };

      const mockHttpClient = {
        get: jest.fn().mockResolvedValue({
          data: '<html><head><title>Test Article</title></head><body><p>This is test content for extraction.</p></body></html>'
        })
      };
      handler.httpClient = mockHttpClient;

      const result = await handler.extract(mockDocument);

      expect(result).toMatchObject({
        id: 'test-doc',
        content: expect.stringContaining('test content'),
        contentHash: expect.any(String),
        extractedAt: expect.any(Date),
        metadata: expect.objectContaining({
          extractionMethod: 'http-scrape',
          contentLength: expect.any(Number)
        })
      });
    });

    test('should handle extraction errors', async () => {
      const mockDocument = {
        id: 'test-doc',
        url: 'https://invalid-url.com/article',
        title: 'Test Article',
        metadata: {}
      };

      const mockHttpClient = {
        get: jest.fn().mockRejectedValue(new Error('Request failed'))
      };
      handler.httpClient = mockHttpClient;

      await expect(handler.extract(mockDocument)).rejects.toThrow('Request failed');
    });
  });

  describe('Content Transformation', () => {
    test('should transform extracted content', async () => {
      const extractedContent = {
        id: 'test-doc',
        content: 'This is test content',
        contentHash: 'abc123',
        metadata: {
          title: 'Test Article',
          extractionMethod: 'http-scrape'
        }
      };

      const result = await handler.transform(extractedContent);

      expect(result).toMatchObject({
        id: 'test-doc',
        title: 'Test Article',
        content: 'This is test content',
        contentHash: 'abc123',
        metadata: expect.objectContaining({
          transformedAt: expect.any(Date),
          wordCount: expect.any(Number),
          characterCount: expect.any(Number)
        })
      });
    });

    test('should handle null input', async () => {
      const result = await handler.transform(null);
      expect(result).toBeNull();
    });
  });

  describe('Utility Methods', () => {
    test('should extract links from HTML', () => {
      const html = '<a href="https://example.com/link1">Link 1</a><a href="/relative">Relative</a>';
      const baseUrl = 'https://example.com';
      
      const links = handler._extractLinksFromHtml(html, baseUrl);
      
      expect(links).toContain('https://example.com/link1');
      expect(links).toContain('https://example.com/relative');
    });

    test('should generate consistent document IDs', () => {
      const url = 'https://example.com/article';
      const id1 = handler._generateDocumentId(url);
      const id2 = handler._generateDocumentId(url);
      
      expect(id1).toBe(id2);
      expect(id1).toMatch(/^[a-f0-9]{32}$/);
    });

    test('should validate content against filters', () => {
      const content = 'This is a test article with sufficient word count.';
      const filters = {
        minWordCount: 5,
        excludePatterns: ['advertisement']
      };
      
      const isValid = handler._validateContent(content, filters);
      expect(isValid).toBe(true);
    });

    test('should reject content below minimum word count', () => {
      const content = 'Short';
      const filters = { minWordCount: 10 };
      
      const isValid = handler._validateContent(content, filters);
      expect(isValid).toBe(false);
    });

    test('should reject content with excluded patterns', () => {
      const content = 'This is an advertisement for products.';
      const filters = { excludePatterns: ['advertisement'] };
      
      const isValid = handler._validateContent(content, filters);
      expect(isValid).toBe(false);
    });
  });

  describe('Cleanup', () => {
    test('should clean up resources', async () => {
      await handler.cleanup();
      
      expect(mockLogger.info).toHaveBeenCalledWith(
        'DynamicUnstructuredSourceHandler cleanup completed',
        { sourceId: 'dynamic-unstructured-test' }
      );
    });
  });
});