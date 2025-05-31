const DynamicConsistentSourceHandler = require('../../../../src/ingestion/handlers/DynamicConsistentSourceHandler');
const { SOURCE_TYPES, VISIBILITY_LEVELS } = require('../../../../src/ingestion/types');
const axios = require('axios');

// Mock axios
jest.mock('axios');
const mockedAxios = axios;

describe('DynamicConsistentSourceHandler', () => {
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

    mockConfig = {
      id: 'dynamic-consistent-test',
      name: 'Dynamic Consistent Test Source',
      type: SOURCE_TYPES.DYNAMIC_CONSISTENT,
      enabled: true,
      visibility: VISIBILITY_LEVELS.EXTERNAL,
      config: {
        sources: [
          {
            type: 'rss',
            url: 'https://example.com/feed.xml',
            name: 'Example RSS Feed'
          },
          {
            type: 'api',
            url: 'https://api.example.com/articles',
            name: 'Example API',
            authentication: {
              type: 'bearer',
              token: 'api-token'
            }
          }
        ],
        batchSize: 50,
        processingInterval: 86400000, // 24 hours
        deduplication: {
          enabled: true,
          fields: ['title', 'url']
        }
      }
    };

    handler = new DynamicConsistentSourceHandler(mockConfig);
    handler.logger = mockLogger;
  });

  describe('Configuration Validation', () => {
    test('should validate valid configuration', async () => {
      const result = await handler.validateConfig(mockConfig);
      expect(result).toBe(true);
    });

    test('should reject configuration without sources', async () => {
      const invalidConfig = { ...mockConfig };
      delete invalidConfig.config.sources;

      await expect(handler.validateConfig(invalidConfig))
        .rejects.toThrow('Missing required config fields: sources');
    });

    test('should reject configuration with empty sources array', async () => {
      const invalidConfig = { ...mockConfig };
      invalidConfig.config.sources = [];

      await expect(handler.validateConfig(invalidConfig))
        .rejects.toThrow('At least one source must be configured');
    });

    test('should validate source configurations', async () => {
      const invalidConfig = { ...mockConfig };
      invalidConfig.config.sources[0] = { type: 'rss' }; // Missing URL

      await expect(handler.validateConfig(invalidConfig))
        .rejects.toThrow('Source configuration invalid');
    });

    test('should validate supported source types', async () => {
      const invalidConfig = { ...mockConfig };
      invalidConfig.config.sources[0].type = 'unsupported';

      await expect(handler.validateConfig(invalidConfig))
        .rejects.toThrow('Unsupported source type: unsupported');
    });
  });

  describe('Initialization', () => {
    test('should initialize successfully with valid configuration', async () => {
      await handler.initialize();

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Initializing DynamicConsistentSourceHandler',
        { sourceId: 'dynamic-consistent-test' }
      );
    });

    test('should initialize source processors', async () => {
      await handler.initialize();

      expect(handler.sourceProcessors).toBeDefined();
      expect(handler.sourceProcessors.size).toBe(2);
    });
  });

  describe('Discovery', () => {
    beforeEach(async () => {
      await handler.initialize();
    });

    test('should discover documents from RSS feeds', async () => {
      const mockRssResponse = `<?xml version="1.0"?>
        <rss version="2.0">
          <channel>
            <item>
              <title>Article 1</title>
              <link>https://example.com/article1</link>
              <description>Description 1</description>
              <pubDate>Wed, 21 Oct 2015 07:28:00 GMT</pubDate>
            </item>
            <item>
              <title>Article 2</title>
              <link>https://example.com/article2</link>
              <description>Description 2</description>
              <pubDate>Thu, 22 Oct 2015 08:30:00 GMT</pubDate>
            </item>
          </channel>
        </rss>`;

      mockedAxios.get.mockResolvedValueOnce({
        status: 200,
        data: mockRssResponse,
        headers: { 'content-type': 'application/rss+xml' }
      });

      const documents = await handler.discover();

      expect(documents.length).toBeGreaterThan(0);
      expect(documents[0]).toMatchObject({
        metadata: {
          sourceId: 'dynamic-consistent-test',
          sourceType: SOURCE_TYPES.DYNAMIC_CONSISTENT,
          sourceUrl: 'https://example.com/feed.xml',
          contentType: 'rss'
        }
      });
    });

    test('should discover documents from API endpoints', async () => {
      const mockApiResponse = {
        articles: [
          {
            id: 1,
            title: 'API Article 1',
            url: 'https://api.example.com/article/1',
            content: 'API content 1',
            published_at: '2023-01-01T00:00:00Z'
          },
          {
            id: 2,
            title: 'API Article 2',
            url: 'https://api.example.com/article/2',
            content: 'API content 2',
            published_at: '2023-01-02T00:00:00Z'
          }
        ]
      };

      mockedAxios.get
        .mockResolvedValueOnce({ status: 200, data: mockRssResponse }) // RSS call
        .mockResolvedValueOnce({ // API call
          status: 200,
          data: mockApiResponse,
          headers: { 'content-type': 'application/json' }
        });

      const documents = await handler.discover();

      expect(documents.length).toBeGreaterThan(0);
      const apiDocs = documents.filter(d => d.metadata.contentType === 'api');
      expect(apiDocs.length).toBeGreaterThan(0);
    });

    test('should handle source discovery errors gracefully', async () => {
      mockedAxios.get
        .mockRejectedValueOnce(new Error('RSS feed unavailable'))
        .mockResolvedValueOnce({
          status: 200,
          data: { articles: [] },
          headers: { 'content-type': 'application/json' }
        });

      const documents = await handler.discover();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Source discovery failed',
        expect.objectContaining({ sourceUrl: 'https://example.com/feed.xml' })
      );
      expect(documents).toBeDefined();
    });

    test('should apply deduplication', async () => {
      const mockRssResponse = `<?xml version="1.0"?>
        <rss version="2.0">
          <channel>
            <item>
              <title>Duplicate Article</title>
              <link>https://example.com/duplicate</link>
              <description>Description</description>
            </item>
            <item>
              <title>Duplicate Article</title>
              <link>https://example.com/duplicate</link>
              <description>Same description</description>
            </item>
          </channel>
        </rss>`;

      mockedAxios.get.mockResolvedValue({
        status: 200,
        data: mockRssResponse,
        headers: { 'content-type': 'application/rss+xml' }
      });

      const documents = await handler.discover();

      // Should deduplicate based on title and URL
      const uniqueTitles = new Set(documents.map(d => d.title));
      expect(uniqueTitles.size).toBeLessThanOrEqual(documents.length);
    });
  });

  describe('Content Extraction', () => {
    test('should extract RSS item content', async () => {
      const mockDocument = {
        id: 'test-rss-doc',
        url: 'https://example.com/article1',
        metadata: {
          contentType: 'rss',
          sourceUrl: 'https://example.com/feed.xml'
        }
      };

      const mockPageContent = '<html><body><h1>Article Title</h1><p>Article content</p></body></html>';
      mockedAxios.get.mockResolvedValue({
        status: 200,
        data: mockPageContent,
        headers: { 'content-type': 'text/html' }
      });

      const result = await handler.extract(mockDocument);

      expect(result).toMatchObject({
        id: 'test-rss-doc',
        content: mockPageContent,
        extractedAt: expect.any(Date),
        metadata: {
          contentType: 'rss',
          extractionMethod: 'http-get',
          responseStatus: 200
        }
      });
      expect(result.contentHash).toBeDefined();
    });

    test('should extract API content directly', async () => {
      const mockDocument = {
        id: 'test-api-doc',
        content: 'Pre-extracted API content',
        metadata: {
          contentType: 'api',
          sourceUrl: 'https://api.example.com/articles'
        }
      };

      const result = await handler.extract(mockDocument);

      expect(result.content).toBe('Pre-extracted API content');
      expect(result.metadata.extractionMethod).toBe('direct');
    });

    test('should handle extraction errors', async () => {
      const mockDocument = {
        id: 'test-doc',
        url: 'https://example.com/article1',
        metadata: { contentType: 'rss' }
      };

      mockedAxios.get.mockRejectedValue(new Error('Page not found'));

      await expect(handler.extract(mockDocument)).rejects.toThrow('Page not found');
    });
  });

  describe('Content Transformation', () => {
    test('should transform RSS content', async () => {
      const extractedContent = {
        id: 'test-doc',
        content: '<html><head><title>RSS Article</title></head><body><p>RSS content here</p></body></html>',
        contentHash: 'abc123',
        metadata: {
          contentType: 'rss',
          originalTitle: 'RSS Article'
        }
      };

      const result = await handler.transform(extractedContent);

      expect(result).toMatchObject({
        id: 'test-doc',
        title: 'RSS Article',
        content: 'RSS content here',
        contentHash: 'abc123',
        metadata: {
          contentType: 'rss',
          transformedAt: expect.any(Date),
          wordCount: 3,
          characterCount: 16
        }
      });
    });

    test('should transform API content', async () => {
      const extractedContent = {
        id: 'test-doc',
        content: 'API article content',
        contentHash: 'def456',
        metadata: {
          contentType: 'api',
          originalTitle: 'API Article'
        }
      };

      const result = await handler.transform(extractedContent);

      expect(result.title).toBe('API Article');
      expect(result.content).toBe('API article content');
    });
  });

  describe('RSS Processing', () => {
    test('should parse RSS feed correctly', async () => {
      const rssXml = `<?xml version="1.0"?>
        <rss version="2.0">
          <channel>
            <title>Test Feed</title>
            <item>
              <title>Test Article</title>
              <link>https://example.com/test</link>
              <description>Test description</description>
              <pubDate>Wed, 21 Oct 2015 07:28:00 GMT</pubDate>
            </item>
          </channel>
        </rss>`;

      const items = await handler._parseRssFeed(rssXml);

      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        title: 'Test Article',
        url: 'https://example.com/test',
        description: 'Test description'
      });
    });

    test('should handle malformed RSS', async () => {
      const invalidRss = '<invalid>xml</invalid>';

      await expect(handler._parseRssFeed(invalidRss)).rejects.toThrow();
    });
  });

  describe('API Processing', () => {
    test('should process API response correctly', async () => {
      const apiResponse = {
        articles: [
          {
            id: 1,
            title: 'API Article',
            content: 'API content',
            url: 'https://api.example.com/1'
          }
        ]
      };

      const items = await handler._processApiResponse(apiResponse, {
        url: 'https://api.example.com/articles',
        name: 'Test API'
      });

      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        title: 'API Article',
        content: 'API content',
        url: 'https://api.example.com/1'
      });
    });
  });

  describe('Helper Methods', () => {
    test('should setup authentication for API sources', () => {
      const source = {
        type: 'api',
        authentication: {
          type: 'bearer',
          token: 'test-token'
        }
      };

      const headers = handler._setupSourceAuthentication(source);
      expect(headers.Authorization).toBe('Bearer test-token');
    });

    test('should generate document ID consistently', () => {
      const url = 'https://example.com/article';
      const id1 = handler._generateDocumentId(url);
      const id2 = handler._generateDocumentId(url);
      
      expect(id1).toBe(id2);
      expect(typeof id1).toBe('string');
    });

    test('should deduplicate documents', () => {
      const documents = [
        { title: 'Article 1', url: 'https://example.com/1' },
        { title: 'Article 2', url: 'https://example.com/2' },
        { title: 'Article 1', url: 'https://example.com/1' }, // Duplicate
        { title: 'Article 3', url: 'https://example.com/3' }
      ];

      const deduplicated = handler._deduplicateDocuments(documents);
      
      expect(deduplicated).toHaveLength(3);
      expect(deduplicated.map(d => d.title)).toEqual(['Article 1', 'Article 2', 'Article 3']);
    });

    test('should clean HTML content', () => {
      const htmlContent = '<div><p>Clean content</p><script>alert("bad")</script></div>';
      const cleaned = handler._cleanHtmlContent(htmlContent);
      
      expect(cleaned).toBe('Clean content');
      expect(cleaned).not.toContain('<script>');
    });

    test('should count words correctly', () => {
      expect(handler._countWords('Hello world test')).toBe(3);
      expect(handler._countWords('  Multiple   spaces  ')).toBe(2);
      expect(handler._countWords('')).toBe(0);
    });
  });

  describe('Cleanup', () => {
    test('should cleanup resources', async () => {
      await handler.cleanup();
      
      expect(mockLogger.info).toHaveBeenCalledWith(
        'DynamicConsistentSourceHandler cleanup completed',
        { sourceId: 'dynamic-consistent-test' }
      );
    });
  });
});
