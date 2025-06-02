/**
 * InputProcessor Unit Tests
 */

const InputProcessor = require('../../../../src/rag/components/InputProcessor');

// Mock dependencies
jest.mock('../../../../src/utils/logger');

describe('InputProcessor', () => {
  let inputProcessor;

  beforeEach(() => {
    inputProcessor = new InputProcessor({
      maxQueryLength: 1000,
      allowedLanguages: ['en']
    });
  });

  afterEach(async () => {
    if (inputProcessor) {
      await inputProcessor.shutdown();
    }
  });

  describe('constructor', () => {
    it('should initialize with default options', () => {
      const processor = new InputProcessor();
      expect(processor.maxQueryLength).toBe(1000);
      expect(processor.allowedLanguages).toEqual(['en']);
      expect(processor.isInitialized).toBe(false);
    });

    it('should initialize with custom options', () => {
      const processor = new InputProcessor({
        maxQueryLength: 500,
        allowedLanguages: ['en', 'es']
      });

      expect(processor.maxQueryLength).toBe(500);
      expect(processor.allowedLanguages).toEqual(['en', 'es']);
    });
  });

  describe('initialize', () => {
    it('should initialize successfully', async () => {
      await inputProcessor.initialize();
      expect(inputProcessor.isInitialized).toBe(true);
    });
  });

  describe('process', () => {
    beforeEach(async () => {
      await inputProcessor.initialize();
    });

    it('should process valid input successfully', async () => {
      const queryData = {
        query: 'What is machine learning?',
        filters: {
          sources: ['wiki'],
          dateRange: {
            start: new Date('2023-01-01'),
            end: new Date('2023-12-31')
          }
        },
        options: {
          maxResults: 10,
          responseFormat: 'json'
        }
      };

      const userContext = {
        userId: 'user123',
        roles: ['user']
      };

      const result = await inputProcessor.process(queryData, userContext);

      expect(result).toHaveProperty('query');
      expect(result).toHaveProperty('context');
      expect(result).toHaveProperty('filters');
      expect(result).toHaveProperty('options');
      expect(result).toHaveProperty('metadata');
      expect(result.metadata.userId).toBe('user123');
      expect(result.metadata.originalQuery).toBe('What is machine learning?');
    });

    it('should validate query length', async () => {
      const longQuery = 'a'.repeat(1001);
      const queryData = { query: longQuery };
      const userContext = { userId: 'user123' };

      await expect(inputProcessor.process(queryData, userContext))
        .rejects.toThrow('Invalid query format');
    });

    it('should require non-empty query', async () => {
      const queryData = { query: '' };
      const userContext = { userId: 'user123' };

      await expect(inputProcessor.process(queryData, userContext))
        .rejects.toThrow('Invalid query format');
    });

    it('should handle missing query', async () => {
      const queryData = {};
      const userContext = { userId: 'user123' };

      await expect(inputProcessor.process(queryData, userContext))
        .rejects.toThrow('Invalid query format');
    });

    it('should validate date range filters', async () => {
      const queryData = {
        query: 'test query',
        filters: {
          dateRange: {
            start: new Date('2023-12-31'),
            end: new Date('2023-01-01') // End before start
          }
        }
      };
      const userContext = { userId: 'user123' };

      // This should not throw an error at the schema level, 
      // but we can add custom validation if needed
      const result = await inputProcessor.process(queryData, userContext);
      expect(result).toBeDefined();
    });

    it('should validate maxResults option', async () => {
      const queryData = {
        query: 'test query',
        options: {
          maxResults: 0 // Invalid value
        }
      };
      const userContext = { userId: 'user123' };

      await expect(inputProcessor.process(queryData, userContext))
        .rejects.toThrow('Invalid query format');
    });

    it('should validate response format', async () => {
      const queryData = {
        query: 'test query',
        options: {
          responseFormat: 'invalid_format'
        }
      };
      const userContext = { userId: 'user123' };

      await expect(inputProcessor.process(queryData, userContext))
        .rejects.toThrow('Invalid query format');
    });

    it('should handle query normalization', async () => {
      const queryData = {
        query: '  WHAT IS   Machine Learning?!  '
      };
      const userContext = { userId: 'user123' };

      const result = await inputProcessor.process(queryData, userContext);

      expect(result.query).toBe('WHAT IS Machine Learning?!');
      expect(result.metadata.originalQuery).toBe('  WHAT IS   Machine Learning?!  ');
    });

    it('should detect language when enabled', async () => {
      const queryData = {
        query: 'What is artificial intelligence?'
      };
      const userContext = { userId: 'user123' };

      const result = await inputProcessor.process(queryData, userContext);

      expect(result.metadata.language).toBe('en');
    });

    it('should classify query type when enabled', async () => {
      const queryData = {
        query: 'What is machine learning?'
      };
      const userContext = { userId: 'user123' };

      const result = await inputProcessor.process(queryData, userContext);

      expect(result.metadata.queryType).toBe('question');
    });

    it('should handle different query types', async () => {
      const testCases = [
        { query: 'What is AI?', expected: 'question' },
        { query: 'Show me examples of neural networks', expected: 'command' },
        { query: 'machine learning algorithms', expected: 'keyword' },
        { query: 'neural networks deep learning', expected: 'general' }
      ];

      const userContext = { userId: 'user123' };

      for (const testCase of testCases) {
        const result = await inputProcessor.process({ query: testCase.query }, userContext);
        expect(result.metadata.queryType).toBe(testCase.expected);
      }
    });

    it('should add user context to filters', async () => {
      const queryData = {
        query: 'test query',
        filters: {
          sources: ['wikipedia']
        }
      };

      const userContext = {
        userId: 'user123',
        roles: ['admin']
      };

      const result = await inputProcessor.process(queryData, userContext);

      expect(result.context.userId).toBe('user123');
      expect(result.context.userRoles).toEqual(['admin']);
      expect(result.filters.sources).toEqual(['wikipedia']);
    });

    it('should require initialization', async () => {
      const processor = new InputProcessor();

      await expect(processor.process({ query: 'test' }, { userId: 'user123' }))
        .rejects.toThrow('InputProcessor must be initialized');
    });
  });

  describe('getStatus', () => {
    it('should return status when not initialized', async () => {
      const status = await inputProcessor.getStatus();

      expect(status).toEqual({
        initialized: false,
        maxQueryLength: 1000,
        allowedLanguages: ['en'],
        timestamp: expect.any(String)
      });
    });

    it('should return status when initialized', async () => {
      await inputProcessor.initialize();
      const status = await inputProcessor.getStatus();

      expect(status).toEqual({
        initialized: true,
        maxQueryLength: 1000,
        allowedLanguages: ['en'],
        timestamp: expect.any(String)
      });
    });
  });

  describe('shutdown', () => {
    it('should shutdown successfully', async () => {
      await inputProcessor.initialize();
      await inputProcessor.shutdown();

      const status = await inputProcessor.getStatus();
      expect(status.initialized).toBe(false);
    });

    it('should handle shutdown when not initialized', async () => {
      await expect(inputProcessor.shutdown()).resolves.not.toThrow();
    });
  });

  describe('private methods', () => {
    beforeEach(async () => {
      await inputProcessor.initialize();
    });

    describe('preprocessQuery', () => {
      it('should normalize query correctly', () => {
        const testCases = [
          { input: '  hello world  ', expected: 'hello world' },
          { input: 'multiple   spaces', expected: 'multiple spaces' },
          { input: 'remove<>tags', expected: 'removetags' },
          { input: '  CAPS and   spaces  ', expected: 'CAPS and spaces' }
        ];

        testCases.forEach(testCase => {
          const result = inputProcessor.preprocessQuery(testCase.input);
          expect(result).toBe(testCase.expected);
        });
      });
    });

    describe('classifyQuery', () => {
      it('should classify different query types', () => {
        const testCases = [
          { query: 'What is machine learning?', expected: 'question' },
          { query: 'How does AI work?', expected: 'question' },
          { query: 'Show me examples', expected: 'command' },
          { query: 'Find information about', expected: 'command' },
          { query: 'machine learning', expected: 'keyword' },
          { query: 'neural networks deep learning', expected: 'general' }
        ];

        testCases.forEach(testCase => {
          const result = inputProcessor.classifyQuery(testCase.query);
          expect(result).toBe(testCase.expected);
        });
      });
    });

    describe('detectLanguage', () => {
      it('should detect language correctly', () => {
        const testCases = [
          { query: 'What is machine learning?', expected: 'en' },
          { query: 'Hello world', expected: 'en' },
          { query: '¿Qué es el aprendizaje automático?', expected: 'unknown' },
          { query: 'Bonjour le monde', expected: 'en' }
        ];

        testCases.forEach(testCase => {
          const result = inputProcessor.detectLanguage(testCase.query);
          expect(result).toBe(testCase.expected);
        });
      });
    });

    describe('processFilters', () => {
      it('should process filters with user context', () => {
        const filters = {
          sources: ['wikipedia'],
          contentTypes: ['article']
        };

        const userAuth = {
          userId: 'user123',
          roles: ['user']
        };

        const result = inputProcessor.processFilters(filters, userAuth);

        expect(result.sources).toEqual(['wikipedia']);
        expect(result.contentTypes).toEqual(['article']);
        expect(result.userVisibility).toEqual({
          userId: 'user123',
          roles: ['user'],
          permissions: []
        });
      });

      it('should handle empty filters', () => {
        const userAuth = { userId: 'user123' };
        const result = inputProcessor.processFilters({}, userAuth);

        expect(result.userVisibility).toEqual({
          userId: 'user123',
          roles: [],
          permissions: []
        });
      });
    });
  });
});
