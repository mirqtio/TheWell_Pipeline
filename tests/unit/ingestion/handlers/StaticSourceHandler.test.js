const StaticSourceHandler = require('../../../../src/ingestion/handlers/StaticSourceHandler');
const { SOURCE_TYPES, VISIBILITY_LEVELS } = require('../../../../src/ingestion/types');
const fs = require('fs').promises;
const path = require('path');

// Mock fs module
jest.mock('fs', () => ({
  promises: {
    access: jest.fn(),
    readdir: jest.fn(),
    stat: jest.fn(),
    readFile: jest.fn()
  }
}));

describe('StaticSourceHandler', () => {
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
      id: 'static-test',
      name: 'Static Test Source',
      type: SOURCE_TYPES.STATIC,
      enabled: true,
      visibility: VISIBILITY_LEVELS.INTERNAL,
      config: {
        basePath: '/test/documents',
        fileTypes: ['.txt', '.md', '.pdf'],
        recursive: true,
        excludePatterns: ['*.tmp', 'node_modules/**']
      }
    };

    handler = new StaticSourceHandler(mockConfig);
    handler.logger = mockLogger;
  });

  describe('Configuration Validation', () => {
    test('should validate valid configuration', async () => {
      fs.access.mockResolvedValue();
      
      const result = await handler.validateConfig(mockConfig);
      expect(result).toBe(true);
      expect(fs.access).toHaveBeenCalledWith('/test/documents');
    });

    test('should reject configuration without basePath', async () => {
      const invalidConfig = { ...mockConfig };
      delete invalidConfig.config.basePath;

      await expect(handler.validateConfig(invalidConfig))
        .rejects.toThrow('Missing required config fields: basePath');
    });

    test('should reject configuration with non-existent path', async () => {
      fs.access.mockRejectedValue(new Error('ENOENT'));

      await expect(handler.validateConfig(mockConfig))
        .rejects.toThrow('Invalid basePath: /test/documents');
    });
  });

  describe('Initialization', () => {
    test('should initialize successfully with valid configuration', async () => {
      fs.access.mockResolvedValue();

      await handler.initialize();

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Initializing StaticSourceHandler',
        { sourceId: 'static-test' }
      );
    });

    test('should fail initialization with invalid path', async () => {
      fs.access.mockRejectedValue(new Error('ENOENT'));

      await expect(handler.initialize()).rejects.toThrow();
    });
  });

  describe('Discovery', () => {
    beforeEach(() => {
      fs.access.mockResolvedValue();
    });

    test('should discover files in directory', async () => {
      const mockFiles = [
        { name: 'doc1.txt', isDirectory: () => false, isFile: () => true },
        { name: 'doc2.md', isDirectory: () => false, isFile: () => true }
      ];

      fs.readdir.mockResolvedValue(mockFiles);
      fs.stat.mockImplementation(() => Promise.resolve({
        isDirectory: () => false,
        isFile: () => true,
        size: 1000,
        mtime: new Date('2023-01-01')
      }));

      const documents = await handler.discover();

      expect(documents).toHaveLength(2);
      expect(documents[0]).toMatchObject({
        metadata: {
          sourceId: 'static-test',
          sourceType: SOURCE_TYPES.STATIC
        }
      });
    });

    test('should filter files by extension', async () => {
      const mockFiles = [
        { name: 'doc.txt', isDirectory: () => false, isFile: () => true },
        { name: 'doc.pdf', isDirectory: () => false, isFile: () => true },
        { name: 'doc.jpg', isDirectory: () => false, isFile: () => true }
      ];

      fs.readdir.mockResolvedValue(mockFiles);
      fs.stat.mockImplementation(() => Promise.resolve({
        isDirectory: () => false,
        isFile: () => true,
        size: 1000,
        mtime: new Date('2023-01-01')
      }));

      const documents = await handler.discover();

      expect(documents).toHaveLength(2); // Only .txt and .pdf
      expect(documents.every(d => d.metadata && d.metadata.fileExtension && ['.txt', '.pdf'].includes(d.metadata.fileExtension))).toBe(true);
    });
  });

  describe('Content Extraction', () => {
    test('should extract text file content', async () => {
      const mockDocument = {
        id: 'test-doc',
        filePath: '/test/documents/test.txt',
        metadata: { fileExtension: '.txt' }
      };

      const mockContent = 'This is test content';
      fs.readFile.mockResolvedValue(mockContent);

      const result = await handler.extract(mockDocument);

      expect(result).toMatchObject({
        id: 'test-doc',
        content: mockContent,
        extractedAt: expect.any(Date),
        metadata: {
          fileExtension: '.txt',
          extractionMethod: 'file-system-read'
        }
      });
      expect(result.contentHash).toBeDefined();
    });

    test('should handle binary files', async () => {
      const mockDocument = {
        id: 'test-pdf',
        filePath: '/test/documents/test.pdf',
        metadata: { fileExtension: '.pdf' }
      };

      fs.readFile.mockResolvedValue(Buffer.from('PDF binary content'));

      const result = await handler.extract(mockDocument);

      expect(result.metadata.extractionMethod).toBe('file-system-read');
      expect(result.content).toBe('[Binary file: test.pdf]');
    });
  });

  describe('Content Transformation', () => {
    test('should transform extracted content', async () => {
      const extractedContent = {
        id: 'test-doc',
        content: '  This is test content with extra whitespace  \n\n\n',
        contentHash: 'abc123',
        metadata: {
          fileExtension: '.txt',
          originalPath: '/test/documents/test.txt',
          originalLength: 100
        }
      };

      const result = await handler.transform(extractedContent);

      expect(result).toMatchObject({
        id: 'test-doc',
        content: 'This is test content with extra whitespace',
        contentHash: 'abc123',
        metadata: {
          fileExtension: '.txt',
          transformedAt: expect.any(Date),
          wordCount: 7,
          characterCount: 49
        }
      });
    });

    test('should extract title from file path', async () => {
      const extractedContent = {
        id: 'test-doc',
        content: 'Some content without a clear title\nMore content here',
        contentHash: 'abc123',
        metadata: {
          originalPath: '/test/documents/My Document.txt'
        }
      };

      const result = await handler.transform(extractedContent);

      expect(result.title).toBe('My Document');
    });
  });

  describe('Helper Methods', () => {
    test('should check if file is allowed', () => {
      expect(handler._isAllowedFileType('document.txt')).toBe(true);
      expect(handler._isAllowedFileType('document.md')).toBe(true);
      expect(handler._isAllowedFileType('document.pdf')).toBe(true);
      expect(handler._isAllowedFileType('document.jpg')).toBe(false);
    });

    test('should determine if file is binary', () => {
      expect(handler._isBinaryExtension('.txt')).toBe(false);
      expect(handler._isBinaryExtension('.md')).toBe(false);
      expect(handler._isBinaryExtension('.pdf')).toBe(true);
      expect(handler._isBinaryExtension('.jpg')).toBe(true);
    });

    test('should clean content properly', () => {
      const dirtyContent = '  Line 1  \r\n\r\n\r\nLine 2\n\n\nLine 3  ';
      const cleaned = handler._cleanContent(dirtyContent);
      
      expect(cleaned).toBe('Line 1\n\nLine 2\n\nLine 3');
    });

    test('should count words correctly', () => {
      expect(handler._countWords('Hello world')).toBe(2);
      expect(handler._countWords('  Multiple   spaces  ')).toBe(2);
      expect(handler._countWords('')).toBe(0);
      expect(handler._countWords('Single')).toBe(1);
    });
  });
});
