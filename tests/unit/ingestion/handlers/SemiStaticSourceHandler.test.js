const SemiStaticSourceHandler = require('../../../../src/ingestion/handlers/SemiStaticSourceHandler');
const { SOURCE_TYPES, VISIBILITY_LEVELS } = require('../../../../src/ingestion/types');
const axios = require('axios');
// Mock axios
jest.mock('axios');
const mockedAxios = axios;

describe('SemiStaticSourceHandler', () => {
  let handler;
  let mockConfig;
  let mockLogger;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup axios mock
    mockedAxios.create = jest.fn(() => ({
      get: jest.fn(),
      head: jest.fn(),
      defaults: {
        headers: {
          'User-Agent': 'TheWell-Pipeline/1.0'
        }
      }
    }));
    mockedAxios.get = jest.fn();
    mockedAxios.head = jest.fn();
    
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    };

    mockConfig = {
      id: 'semi-static-test',
      name: 'Semi-Static Test Source',
      type: SOURCE_TYPES.SEMI_STATIC,
      enabled: true,
      visibility: VISIBILITY_LEVELS.EXTERNAL,
      config: {
        baseUrl: 'https://api.example.com',
        endpoints: [
          { url: 'https://api.example.com/policies', name: 'policies' },
          { url: 'https://api.example.com/terms', name: 'terms' }
        ],
        authentication: {
          type: 'bearer',
          token: 'test-token'
        },
        pollingInterval: 604800000, // 1 week
        changeDetection: {
          method: 'etag',
          fallback: 'lastModified'
        }
      }
    };

    handler = new SemiStaticSourceHandler(mockConfig);
    handler.logger = mockLogger;
  });

  describe('Configuration Validation', () => {
    test('should validate valid configuration', async () => {
      const result = await handler.validateConfig(mockConfig);
      expect(result).toBe(true);
    });

    test('should reject configuration without baseUrl', async () => {
      const invalidConfig = { ...mockConfig };
      delete invalidConfig.config.baseUrl;

      await expect(handler.validateConfig(invalidConfig))
        .rejects.toThrow('Missing required config fields: baseUrl');
    });

    test('should reject configuration without endpoints', async () => {
      const invalidConfig = { ...mockConfig };
      delete invalidConfig.config.endpoints;

      await expect(handler.validateConfig(invalidConfig))
        .rejects.toThrow('Missing required config fields: endpoints');
    });

    test('should validate authentication configuration', async () => {
      const invalidConfig = { ...mockConfig };
      invalidConfig.config.authentication = { type: 'invalid' };

      await expect(handler.validateConfig(invalidConfig))
        .rejects.toThrow('Invalid authentication type: invalid');
    });

    test('should validate endpoint accessibility', async () => {
      await handler.initialize();
      handler.httpClient.head.mockRejectedValue(new Error('Network error'));

      await expect(handler.validateConfig(mockConfig))
        .rejects.toThrow('Endpoint validation failed');
    });
  });

  describe('Initialization', () => {
    test('should initialize successfully with valid configuration', async () => {
      mockedAxios.head.mockResolvedValue({ status: 200 });

      await handler.initialize();

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Initializing SemiStaticSourceHandler',
        { sourceId: 'semi-static-test' }
      );
    });

    test('should fail initialization with invalid endpoints', async () => {
      // Mock axios.create to return a mock httpClient that will fail
      const mockHttpClient = {
        head: jest.fn().mockRejectedValue(new Error('404 Not Found')),
        defaults: { headers: { 'User-Agent': 'TheWell-Pipeline/1.0' } }
      };
      mockedAxios.create.mockReturnValue(mockHttpClient);

      await expect(handler.initialize()).rejects.toThrow();
    });
  });

  describe('Discovery', () => {
    beforeEach(async () => {
      await handler.initialize();
    });

    test('should discover documents from all endpoints', async () => {
      // Mock the _checkLastModified method
      handler._checkLastModified = jest.fn()
        .mockResolvedValueOnce(new Date('2015-10-21T07:28:00Z'))
        .mockResolvedValueOnce(new Date('2015-10-22T08:30:00Z'));

      const documents = await handler.discover();

      expect(documents).toHaveLength(2);
      expect(documents[0]).toMatchObject({
        metadata: {
          sourceId: 'semi-static-test',
          sourceType: SOURCE_TYPES.SEMI_STATIC,
          endpointName: 'policies',
        }
      });
      expect(documents[0].lastModified).toBeDefined();
    });

    test('should handle endpoints with no ETag', async () => {
      // Mock the _checkLastModified method
      handler._checkLastModified = jest.fn()
        .mockResolvedValueOnce(new Date('2015-10-21T07:28:00Z'))
        .mockResolvedValueOnce(new Date('2015-10-22T08:30:00Z'));

      const documents = await handler.discover();

      expect(documents).toHaveLength(2);
      expect(documents[0].lastModified).toBeDefined();
      expect(documents[0].lastModified).toBeInstanceOf(Date);
    });

    test('should skip inaccessible endpoints', async () => {
      // Mock the _checkLastModified method
      handler._checkLastModified = jest.fn()
        .mockResolvedValueOnce(new Date('2015-10-21T07:28:00Z'))
        .mockRejectedValueOnce(new Error('404 Not Found'));

      const documents = await handler.discover();

      expect(documents).toHaveLength(1);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Error discovering endpoint',
        expect.objectContaining({ endpoint: 'terms' })
      );
    });
  });

  describe('Content Extraction', () => {
    test('should extract content from endpoint', async () => {
      await handler.initialize();
      
      const mockDocument = {
        id: 'test-doc',
        url: 'https://api.example.com/policies',
        metadata: {
          endpoint: '/policies',
          contentType: 'application/json'
        }
      };

      const mockContent = { policies: ['policy1', 'policy2'] };
      handler.httpClient.get.mockResolvedValue({
        status: 200,
        data: mockContent,
        headers: {
          'content-type': 'application/json',
          'etag': '"new-etag"'
        }
      });

      const result = await handler.extract(mockDocument);

      expect(result).toMatchObject({
        id: 'test-doc',
        content: mockContent,
        extractedAt: expect.any(Date),
        metadata: {
          endpoint: '/policies',
          extractionMethod: 'http-request',
          etag: '"new-etag"'
        }
      });
      expect(result.contentHash).toBeDefined();
    });

    test('should handle text content', async () => {
      await handler.initialize();
      
      const mockDocument = {
        id: 'test-doc',
        url: 'https://api.example.com/terms',
        metadata: {
          endpoint: '/terms',
          contentType: 'text/html'
        }
      };

      const mockContent = 'Terms of service content';
      handler.httpClient.get.mockResolvedValue({
        status: 200,
        data: mockContent,
        headers: {
          'content-type': 'text/plain'
        }
      });

      const result = await handler.extract(mockDocument);

      expect(result).toMatchObject({
        id: 'test-doc',
        content: mockContent,
        extractedAt: expect.any(Date),
        metadata: {
          endpoint: '/terms',
          extractionMethod: 'http-request',
        }
      });
    });

    test('should handle extraction errors', async () => {
      await handler.initialize();
      
      const mockDocument = {
        id: 'test-doc',
        url: 'https://api.example.com/policies',
        metadata: {
          endpoint: '/policies',
          contentType: 'application/json'
        }
      };

      handler.httpClient.get.mockRejectedValue(new Error('Network timeout'));

      await expect(handler.extract(mockDocument)).rejects.toThrow('Network timeout');
    });
  });

  describe('Content Transformation', () => {
    test('should transform JSON content', async () => {
      const extractedContent = {
        id: 'test-doc',
        content: '{\n  "title": "Privacy Policy",\n  "content": "Policy content"\n}',
        contentHash: 'abc123',
        metadata: {
          endpoint: '/policies',
          contentType: 'application/json'
        }
      };

      const result = await handler.transform(extractedContent);

      expect(result).toMatchObject({
        id: 'test-doc',
        title: 'Privacy Policy',
        content: 'Policy content',
        contentHash: 'abc123',
        metadata: {
          endpoint: '/policies',
          transformedAt: expect.any(Date),
          wordCount: 2,
          characterCount: 14
        }
      });
    });

    test('should transform HTML content', async () => {
      const extractedContent = {
        id: 'test-doc',
        content: '<html><head><title>Terms</title></head><body><p>Terms content</p></body></html>',
        contentHash: 'def456',
        metadata: {
          endpoint: '/terms',
          contentType: 'text/html'
        }
      };

      const result = await handler.transform(extractedContent);

      expect(result.title).toBe('Terms');
      expect(result.content).toBe('Terms content');
    });

    test('should handle plain text content', async () => {
      const extractedContent = {
        id: 'test-doc',
        content: 'Plain text content',
        contentHash: 'ghi789',
        metadata: {
          endpoint: '/text',
          contentType: 'text/plain'
        }
      };

      const result = await handler.transform(extractedContent);

      expect(result.content).toBe('Plain text content');
      expect(result.title).toBe('/text');
    });
  });

  describe('Change Detection', () => {
    beforeEach(async () => {
      await handler.initialize();
    });

    test('should detect changes using ETag', async () => {
      const document = {
        id: 'test-doc',
        url: 'https://api.example.com/data',
        metadata: { etag: 'old-etag' }
      };

      // Mock HEAD request to check ETag
      handler.httpClient.head.mockResolvedValueOnce({
        headers: { etag: 'new-etag' }
      });

      const hasChanged = await handler._checkForChanges(document);
      expect(hasChanged).toBe(true);
    });

    test('should detect no changes with same ETag', async () => {
      const document = {
        id: 'test-doc',
        url: 'https://api.example.com/data',
        metadata: { etag: 'same-etag' }
      };

      // Mock HEAD request with same ETag
      handler.httpClient.head.mockResolvedValueOnce({
        headers: { etag: 'same-etag' }
      });

      const hasChanged = await handler._checkForChanges(document);
      expect(hasChanged).toBe(false);
    });

    test('should fallback to last-modified when no ETag', async () => {
      const document = {
        id: 'test-doc',
        url: 'https://api.example.com/data',
        metadata: { lastModified: new Date('2023-01-01') }
      };

      // Mock HEAD request with newer last-modified
      handler.httpClient.head.mockResolvedValueOnce({
        headers: { 'last-modified': new Date('2023-01-02').toUTCString() }
      });

      const hasChanged = await handler._checkForChanges(document);
      expect(hasChanged).toBe(true);
    });
  });

  describe('Helper Methods', () => {
    beforeEach(async () => {
      await handler.initialize();
    });

    test('should setup authentication headers', () => {
      // Test authentication configuration
      expect(handler.httpClient.defaults.headers['User-Agent']).toBe('TheWell-Pipeline/1.0');
    });

    test('should handle basic authentication', () => {
      const basicConfig = {
        id: 'basic-test',
        type: 'semi-static',
        config: {
          endpoints: [{ url: 'https://api.example.com', name: 'test' }]
        },
        authentication: {
          type: 'basic',
          username: 'user',
          password: 'pass'
        }
      };

      const basicHandler = new SemiStaticSourceHandler(basicConfig);
      // Authentication is configured in _configureAuthentication during initialize
      expect(basicHandler.config.authentication.type).toBe('basic');
    });

    test('should handle API key authentication', () => {
      const apiKeyConfig = {
        id: 'api-key-test',
        type: 'semi-static',
        config: {
          endpoints: [{ url: 'https://api.example.com', name: 'test' }]
        },
        authentication: {
          type: 'api-key',
          key: 'secret-key',
          header: 'api-key'
        }
      };

      const apiKeyHandler = new SemiStaticSourceHandler(apiKeyConfig);
      expect(apiKeyHandler.config.authentication.key).toBe('secret-key');
    });

    test('should extract title from JSON content', () => {
      const content = '{"title": "Test Title", "data": "content"}';
      const result = handler._transformJson(content);
      
      expect(result.title).toBe('Test Title');
    });

    test('should extract title from HTML content', () => {
      const content = '<html><head><title>HTML Title</title></head></html>';
      const result = handler._transformHtml(content);
      
      expect(result.title).toBe('HTML Title');
    });

    test('should clean HTML content', () => {
      const htmlContent = '<html><body><p>Clean content</p><script>alert("bad")</script></body></html>';
      const result = handler._transformHtml(htmlContent);
      
      expect(result.content).toBe('Clean content');
      expect(result.content).not.toContain('<script>');
    });

    test('should generate document ID', () => {
      const url = 'https://api.example.com/data';
      const id = handler._generateDocumentId(url);
      
      expect(id).toBeDefined();
      expect(typeof id).toBe('string');
    });

    test('should count words correctly', () => {
      const content = 'This is a test content with multiple words.';
      const count = handler._countWords(content);
      
      expect(count).toBe(8);
    });
  });

  describe('Cleanup', () => {
    test('should cleanup resources', async () => {
      await handler.cleanup();
      
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Cleaning up SemiStaticSourceHandler',
        { sourceId: 'semi-static-test' }
      );
    });
  });
});
