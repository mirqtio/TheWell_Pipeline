const { 
  SOURCE_TYPES, 
  VISIBILITY_LEVELS, 
  PROCESSING_STATUS, 
  BaseSourceHandler 
} = require('../../../src/ingestion/types');

describe('Ingestion Types', () => {
  describe('SOURCE_TYPES', () => {
    test('should have all required source types', () => {
      expect(SOURCE_TYPES.STATIC).toBe('static');
      expect(SOURCE_TYPES.SEMI_STATIC).toBe('semi-static');
      expect(SOURCE_TYPES.DYNAMIC_CONSISTENT).toBe('dynamic-consistent');
      expect(SOURCE_TYPES.DYNAMIC_UNSTRUCTURED).toBe('dynamic-unstructured');
    });

    test('should have exactly 4 source types', () => {
      const types = Object.values(SOURCE_TYPES);
      expect(types).toHaveLength(4);
      expect(new Set(types).size).toBe(4); // No duplicates
    });
  });

  describe('VISIBILITY_LEVELS', () => {
    test('should have all required visibility levels', () => {
      expect(VISIBILITY_LEVELS.INTERNAL).toBe('internal');
      expect(VISIBILITY_LEVELS.EXTERNAL).toBe('external');
      expect(VISIBILITY_LEVELS.RESTRICTED).toBe('restricted');
    });

    test('should have exactly 3 visibility levels', () => {
      const levels = Object.values(VISIBILITY_LEVELS);
      expect(levels).toHaveLength(3);
      expect(new Set(levels).size).toBe(3); // No duplicates
    });
  });

  describe('PROCESSING_STATUS', () => {
    test('should have all required processing statuses', () => {
      expect(PROCESSING_STATUS.PENDING).toBe('pending');
      expect(PROCESSING_STATUS.IN_PROGRESS).toBe('in-progress');
      expect(PROCESSING_STATUS.COMPLETED).toBe('completed');
      expect(PROCESSING_STATUS.FAILED).toBe('failed');
      expect(PROCESSING_STATUS.REQUIRES_REVIEW).toBe('requires-review');
      expect(PROCESSING_STATUS.APPROVED).toBe('approved');
      expect(PROCESSING_STATUS.REJECTED).toBe('rejected');
    });

    test('should have exactly 7 processing statuses', () => {
      const statuses = Object.values(PROCESSING_STATUS);
      expect(statuses).toHaveLength(7);
      expect(new Set(statuses).size).toBe(7); // No duplicates
    });
  });

  describe('BaseSourceHandler', () => {
    let handler;
    let mockConfig;
    let mockLogger;

    beforeEach(() => {
      mockLogger = {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn()
      };

      mockConfig = {
        id: 'test-source',
        name: 'Test Source',
        type: SOURCE_TYPES.STATIC,
        enabled: true,
        visibility: VISIBILITY_LEVELS.INTERNAL,
        config: {
          path: '/test/path'
        }
      };

      handler = new BaseSourceHandler(mockConfig);
      handler.logger = mockLogger;
    });

    test('should initialize with correct configuration', () => {
      expect(handler.config).toEqual(mockConfig);
      expect(handler.logger).toEqual(mockLogger);
    });

    test('should throw error when calling abstract methods', async () => {
      await expect(handler.initialize()).rejects.toThrow('initialize() must be implemented by subclass');
      await expect(handler.validateConfig({})).rejects.toThrow('validateConfig() must be implemented by subclass');
      await expect(handler.discover()).rejects.toThrow('discover() must be implemented by subclass');
      await expect(handler.extract({})).rejects.toThrow('extract() must be implemented by subclass');
      await expect(handler.transform({})).rejects.toThrow('transform() must be implemented by subclass');
      // cleanup() has a default implementation, so it won't throw
    });

    test('should accept any configuration without validation', () => {
      // BaseSourceHandler doesn't validate configuration in constructor
      expect(() => new BaseSourceHandler(null)).not.toThrow();
      expect(() => new BaseSourceHandler({})).not.toThrow();
      expect(() => new BaseSourceHandler({ id: 'test' })).not.toThrow();
    });

    test('should store configuration as provided', () => {
      const testConfig = { id: 'test', type: 'custom' };
      const handler = new BaseSourceHandler(testConfig);
      expect(handler.config).toEqual(testConfig);
    });
  });
});
