/**
 * OutputFormatter Unit Tests
 */

const OutputFormatter = require('../../../../src/rag/components/OutputFormatter');

// Mock dependencies
jest.mock('../../../../src/utils/logger');

describe('OutputFormatter', () => {
  let outputFormatter;

  beforeEach(() => {
    outputFormatter = new OutputFormatter();
  });

  describe('constructor', () => {
    it('should initialize with default options', () => {
      expect(outputFormatter.includeMetadata).toBe(true);
      expect(outputFormatter.includeSources).toBe(true);
      expect(outputFormatter.isInitialized).toBe(false);
    });

    it('should initialize with custom options', () => {
      const formatter = new OutputFormatter({
        includeMetadata: false,
        includeSources: false
      });

      expect(formatter.includeMetadata).toBe(false);
      expect(formatter.includeSources).toBe(false);
    });
  });

  describe('initialize', () => {
    it('should initialize successfully', async () => {
      await outputFormatter.initialize();
      expect(outputFormatter.isInitialized).toBe(true);
    });
  });

  describe('format', () => {
    beforeEach(async () => {
      await outputFormatter.initialize();
    });

    const mockResponse = {
      content: 'This is a generated response about machine learning.',
      metadata: {
        confidence_score: 0.85,
        model_used: 'gpt-4',
        tokens_used: 150
      },
      sources: [
        {
          document_id: 'doc1',
          title: 'Machine Learning Basics',
          source_url: 'https://example.com/ml-basics',
          relevance_score: 0.9
        }
      ]
    };

    const mockDocuments = [
      {
        id: 'doc1',
        title: 'Machine Learning Basics',
        source_url: 'https://example.com/ml-basics',
        search_metadata: { combined_score: 0.9 }
      },
      {
        id: 'doc2',
        title: 'AI Fundamentals',
        source_url: 'https://example.com/ai-fundamentals',
        search_metadata: { combined_score: 0.7 }
      }
    ];

    const mockMetadata = {
      traceId: 'trace123',
      processingTime: 1500,
      timestamp: '2023-01-01T00:00:00.000Z'
    };

    it('should format response as JSON by default', async () => {
      const result = await outputFormatter.format(mockResponse, mockDocuments, mockMetadata);

      expect(result).toEqual({
        success: true,
        data: {
          answer: 'This is a generated response about machine learning.',
          confidence: 0.85,
          timestamp: expect.any(String),
          trace_id: 'trace123',
          sources: expect.any(Array),
          metadata: expect.any(Object)
        },
        format: 'json'
      });
    });

    it('should format response as text', async () => {
      const metadata = { ...mockMetadata, responseFormat: 'text' };
      const result = await outputFormatter.format(mockResponse, mockDocuments, metadata);

      expect(result.success).toBe(true);
      expect(result.data.format).toBe('text');
      expect(result.data.content).toContain('This is a generated response about machine learning.');
      expect(result.data.content).toContain('Sources:');
      expect(result.data.content).toContain('Machine Learning Basics');
      expect(result.data.content).toContain('Confidence: 85%');
    });

    it('should format response as markdown', async () => {
      const metadata = { ...mockMetadata, responseFormat: 'markdown' };
      const result = await outputFormatter.format(mockResponse, mockDocuments, metadata);

      expect(result.success).toBe(true);
      expect(result.data.format).toBe('markdown');
      expect(result.data.content).toContain('This is a generated response about machine learning.');
      expect(result.data.content).toContain('## Sources');
      expect(result.data.content).toContain('[Machine Learning Basics](https://example.com/ml-basics)');
      expect(result.data.content).toContain('**Confidence:** 85%');
    });

    it('should exclude sources when includeSources is false', async () => {
      const formatter = new OutputFormatter({ includeSources: false });
      await formatter.initialize();

      const result = await formatter.format(mockResponse, mockDocuments, mockMetadata);

      expect(result.data.sources).toBeUndefined();
    });

    it('should exclude metadata when includeMetadata is false', async () => {
      const formatter = new OutputFormatter({ includeMetadata: false });
      await formatter.initialize();

      const result = await formatter.format(mockResponse, mockDocuments, mockMetadata);

      expect(result.data.metadata).toBeUndefined();
    });

    it('should handle missing response sources', async () => {
      const responseWithoutSources = {
        ...mockResponse,
        sources: undefined
      };

      const result = await outputFormatter.format(responseWithoutSources, mockDocuments, mockMetadata);

      expect(result.data.sources).toEqual(expect.any(Array));
      expect(result.data.sources.length).toBeGreaterThan(0);
    });

    it('should handle empty documents array', async () => {
      const result = await outputFormatter.format(mockResponse, [], mockMetadata);

      expect(result.data.sources).toEqual([
        {
          title: 'Machine Learning Basics',
          source_url: 'https://example.com/ml-basics',
          relevance_score: 0.9,
          mentioned_in_response: true
        }
      ]);
    });

    it('should handle missing confidence score', async () => {
      const responseWithoutConfidence = {
        ...mockResponse,
        metadata: { ...mockResponse.metadata, confidence_score: undefined }
      };

      const result = await outputFormatter.format(responseWithoutConfidence, mockDocuments, mockMetadata);

      expect(result.data.confidence).toBe(0);
    });
  });

  describe('formatSources', () => {
    beforeEach(async () => {
      await outputFormatter.initialize();
    });

    it('should format sources correctly', () => {
      const responseSources = [
        {
          document_id: 'doc1',
          title: 'Source 1',
          source_url: 'https://example.com/1',
          relevance_score: 0.9
        }
      ];

      const allDocuments = [
        {
          id: 'doc1',
          title: 'Source 1',
          source_url: 'https://example.com/1',
          search_metadata: { combined_score: 0.9 }
        },
        {
          id: 'doc2',
          title: 'Source 2',
          source_url: 'https://example.com/2',
          search_metadata: { combined_score: 0.7 }
        }
      ];

      const result = outputFormatter.formatSources(responseSources, allDocuments);

      expect(result).toEqual([
        {
          title: 'Source 1',
          source_url: 'https://example.com/1',
          relevance_score: 0.9,
          mentioned_in_response: true
        },
        {
          title: 'Source 2',
          source_url: 'https://example.com/2',
          relevance_score: 0.7,
          mentioned_in_response: false
        }
      ]);
    });

    it('should limit sources to top 10', () => {
      const responseSources = [];
      const allDocuments = Array.from({ length: 15 }, (_, i) => ({
        id: `doc${i}`,
        title: `Document ${i}`,
        source_url: `https://example.com/${i}`,
        search_metadata: { combined_score: 1 - (i * 0.05) }
      }));

      const result = outputFormatter.formatSources(responseSources, allDocuments);

      expect(result).toHaveLength(10);
      expect(result[0].relevance_score).toBeGreaterThan(result[9].relevance_score);
    });

    it('should handle missing titles and URLs', () => {
      const responseSources = [];
      const allDocuments = [
        {
          id: 'doc1',
          search_metadata: { combined_score: 0.8 }
        }
      ];

      const result = outputFormatter.formatSources(responseSources, allDocuments);

      expect(result[0]).toEqual({
        title: 'Untitled Document',
        source_url: '',
        relevance_score: 0.8,
        mentioned_in_response: false
      });
    });
  });

  describe('formatMetadata', () => {
    beforeEach(async () => {
      await outputFormatter.initialize();
    });

    it('should format metadata correctly', () => {
      const responseMetadata = {
        confidence_score: 0.85,
        model_used: 'gpt-4',
        tokens_used: 150,
        documents_used: 3,
        sources: [{ id: 'doc1' }, { id: 'doc2' }],
        response_length: 250
      };

      const requestMetadata = {
        processingTime: 1500,
        traceId: 'trace123',
        timestamp: '2023-01-01T00:00:00.000Z'
      };

      const documents = [
        { search_metadata: { combined_score: 0.9 } },
        { search_metadata: { combined_score: 0.7 } },
        { search_metadata: { combined_score: 0.5 } }
      ];

      const result = outputFormatter.formatMetadata(responseMetadata, requestMetadata, documents);

      expect(result).toEqual({
        processing: {
          total_time_ms: 1500,
          trace_id: 'trace123',
          timestamp: '2023-01-01T00:00:00.000Z'
        },
        retrieval: {
          documents_found: 3,
          documents_used: 3,
          search_strategy: 'hybrid_vector_keyword'
        },
        generation: {
          model_used: 'gpt-4',
          tokens_used: 150,
          confidence_score: 0.85,
          fallback_used: false
        },
        quality: {
          response_length: 250,
          sources_cited: 2,
          avg_document_relevance: 0.7
        }
      });
    });

    it('should handle missing metadata fields', () => {
      const result = outputFormatter.formatMetadata({}, {}, []);

      expect(result.generation.model_used).toBe('unknown');
      expect(result.generation.tokens_used).toBe(0);
      expect(result.generation.confidence_score).toBe(0);
      expect(result.quality.sources_cited).toBe(0);
    });
  });

  describe('calculateAverageRelevance', () => {
    beforeEach(async () => {
      await outputFormatter.initialize();
    });

    it('should calculate average relevance correctly', () => {
      const documents = [
        { search_metadata: { combined_score: 0.9 } },
        { search_metadata: { combined_score: 0.7 } },
        { search_metadata: { combined_score: 0.5 } }
      ];

      const result = outputFormatter.calculateAverageRelevance(documents);

      expect(result).toBe(0.7);
    });

    it('should handle empty documents array', () => {
      const result = outputFormatter.calculateAverageRelevance([]);

      expect(result).toBe(0);
    });

    it('should handle documents without search metadata', () => {
      const documents = [
        {},
        { search_metadata: { combined_score: 0.8 } }
      ];

      const result = outputFormatter.calculateAverageRelevance(documents);

      expect(result).toBe(0.4);
    });
  });

  describe('formatError', () => {
    it('should format error response correctly', () => {
      const error = new Error('Test error');
      error.name = 'TestError';
      const traceId = 'trace123';

      const result = outputFormatter.formatError(error, traceId);

      expect(result).toEqual({
        success: false,
        error: {
          message: 'Test error',
          type: 'TestError',
          trace_id: 'trace123',
          timestamp: expect.any(String)
        }
      });
    });

    it('should handle error without name', () => {
      const error = new Error('Test error');
      const result = outputFormatter.formatError(error, 'trace123');

      expect(result.error.type).toBe('Error');
    });

    it('should handle error without message', () => {
      const error = {};
      const result = outputFormatter.formatError(error, 'trace123');

      expect(result.error.message).toBe('An unexpected error occurred');
      expect(result.error.type).toBe('UnknownError');
    });
  });

  describe('getStatus', () => {
    it('should return status when not initialized', async () => {
      const status = await outputFormatter.getStatus();

      expect(status).toEqual({
        initialized: false,
        includeMetadata: true,
        includeSources: true,
        supportedFormats: ['json', 'text', 'markdown'],
        timestamp: expect.any(String)
      });
    });

    it('should return status when initialized', async () => {
      await outputFormatter.initialize();
      const status = await outputFormatter.getStatus();

      expect(status.initialized).toBe(true);
    });
  });

  describe('shutdown', () => {
    it('should shutdown successfully', async () => {
      await outputFormatter.initialize();
      await outputFormatter.shutdown();

      expect(outputFormatter.isInitialized).toBe(false);
    });

    it('should handle shutdown when not initialized', async () => {
      await expect(outputFormatter.shutdown()).resolves.not.toThrow();
    });
  });
});
