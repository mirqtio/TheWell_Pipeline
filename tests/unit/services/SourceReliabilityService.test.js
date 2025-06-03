/**
 * Unit Tests for SourceReliabilityService
 */

const SourceReliabilityService = require('../../../src/services/SourceReliabilityService');

describe('SourceReliabilityService', () => {
  let service;
  let mockDatabaseManager;
  let mockAuditService;

  beforeEach(() => {
    // Create mocks
    mockDatabaseManager = {
      query: jest.fn(),
      transaction: jest.fn()
    };

    mockAuditService = {
      logEvent: jest.fn()
    };

    // Create service instance with mocked dependencies
    service = new SourceReliabilityService({
      databaseManager: mockDatabaseManager,
      auditService: mockAuditService
    });

    // Initialize the service
    service.isInitialized = true;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with required dependencies', () => {
      expect(service.databaseManager).toBe(mockDatabaseManager);
      expect(service.auditService).toBe(mockAuditService);
      expect(service.weights).toBeDefined();
      expect(service.thresholds).toBeDefined();
    });

    it('should throw error if databaseManager is missing', () => {
      expect(() => new SourceReliabilityService({
        auditService: mockAuditService
      }))
        .toThrow('Database manager is required');
    });

    it('should throw error if auditService is missing', () => {
      expect(() => new SourceReliabilityService({
        databaseManager: mockDatabaseManager
      }))
        .toThrow('Audit service is required');
    });
  });

  describe('getDocumentQualityMetrics', () => {
    it('should fetch document quality metrics successfully', async () => {
      const mockResult = {
        rows: [{
          total_documents: 100,
          avg_believability: 0.75,
          avg_quality: 0.80,
          high_believability_count: 60,
          low_believability_count: 10,
          high_quality_count: 65,
          low_quality_count: 8
        }]
      };

      mockDatabaseManager.query.mockResolvedValue(mockResult);

      const result = await service.getDocumentQualityMetrics('source-1', '30 days');

      expect(mockDatabaseManager.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
        ['source-1']
      );
      expect(result).toEqual({
        totalDocuments: 100,
        avgBelievability: 0.75,
        avgQuality: 0.80,
        highQualityRatio: 0.65,
        lowQualityRatio: 0.08
      });
    });

    it('should handle no documents case', async () => {
      const mockResult = {
        rows: [{
          total_documents: 0,
          avg_believability: null,
          avg_quality: null,
          high_believability_count: 0,
          low_believability_count: 0,
          high_quality_count: 0,
          low_quality_count: 0
        }]
      };

      mockDatabaseManager.query.mockResolvedValue(mockResult);

      const result = await service.getDocumentQualityMetrics('source-1', '30 days');

      expect(result).toEqual({
        totalDocuments: 0,
        avgBelievability: 0,
        avgQuality: 0,
        highQualityRatio: 0,
        lowQualityRatio: 0
      });
    });

    it('should handle database errors', async () => {
      mockDatabaseManager.query.mockRejectedValue(new Error('Database error'));

      await expect(service.getDocumentQualityMetrics('source-1', '30 days'))
        .rejects.toThrow('Database error');
    });
  });

  describe('getUserFeedbackMetrics', () => {
    it('should fetch user feedback metrics successfully', async () => {
      const mockResult = {
        rows: [{
          total_feedback: 50,
          avg_rating: 4.2,
          positive_feedback: 35,
          negative_feedback: 5,
          unique_users: 25
        }]
      };

      mockDatabaseManager.query.mockResolvedValue(mockResult);

      const result = await service.getUserFeedbackMetrics('source-1', '30 days');

      expect(result).toEqual({
        totalFeedback: 50,
        avgRating: 4.2,
        positiveRatio: 0.7,
        negativeRatio: 0.1,
        uniqueUsers: 25
      });
    });

    it('should handle no feedback case', async () => {
      const mockResult = {
        rows: [{
          total_feedback: 0,
          avg_rating: null,
          positive_feedback: 0,
          negative_feedback: 0,
          unique_users: 0
        }]
      };

      mockDatabaseManager.query.mockResolvedValue(mockResult);

      const result = await service.getUserFeedbackMetrics('source-1', '30 days');

      expect(result).toEqual({
        totalFeedback: 0,
        avgRating: 0,
        positiveRatio: 0,
        negativeRatio: 0,
        uniqueUsers: 0
      });
    });
  });

  describe('getContentConsistencyMetrics', () => {
    it('should fetch content consistency metrics successfully', async () => {
      const mockResult = {
        rows: [{
          total_documents: 100,
          content_type_variety: 3,
          avg_word_count: 500,
          word_count_stddev: 150,
          documents_with_metadata: 85
        }]
      };

      mockDatabaseManager.query.mockResolvedValue(mockResult);

      const result = await service.getContentConsistencyMetrics('source-1', '30 days');

      expect(result).toEqual({
        totalDocuments: 100,
        contentTypeVariety: 3,
        avgWordCount: 500,
        wordCountVariability: 0.3,
        metadataCompleteness: 0.85
      });
    });
  });

  describe('getErrorRateMetrics', () => {
    it('should fetch error rate metrics successfully', async () => {
      const mockResult = {
        rows: [{
          total_jobs: 200,
          failed_jobs: 10,
          completed_jobs: 180,
          avg_processing_time: 120
        }]
      };

      mockDatabaseManager.query.mockResolvedValue(mockResult);

      const result = await service.getErrorRateMetrics('source-1', '30 days');

      expect(result).toEqual({
        totalJobs: 200,
        failureRate: 0.05,
        successRate: 0.9,
        avgProcessingTime: 120
      });
    });
  });

  describe('getHistoricalPerformanceMetrics', () => {
    it('should fetch historical performance metrics successfully', async () => {
      const mockResult = {
        rows: [
          { week: '2024-01-01', document_count: 20, avg_score: 0.8 },
          { week: '2024-01-08', document_count: 25, avg_score: 0.75 },
          { week: '2024-01-15', document_count: 30, avg_score: 0.85 }
        ]
      };

      mockDatabaseManager.query.mockResolvedValue(mockResult);

      const result = await service.getHistoricalPerformanceMetrics('source-1');

      expect(result.weeklyData).toHaveLength(3);
      expect(result.weeklyTrend).toBeDefined();
      expect(result.trendScore).toBeDefined();
    });

    it('should handle insufficient data for trend calculation', async () => {
      const mockResult = {
        rows: [
          { week: '2024-01-01', document_count: 20, avg_score: 0.8 }
        ]
      };

      mockDatabaseManager.query.mockResolvedValue(mockResult);

      const result = await service.getHistoricalPerformanceMetrics('source-1');

      expect(result.weeklyTrend).toBe('stable');
      expect(result.trendScore).toBe(0.5);
    });
  });

  describe('calculateLinearRegression', () => {
    it('should calculate trend correctly for increasing data', () => {
      const data = [
        { x: 1, y: 0.5 },
        { x: 2, y: 0.6 },
        { x: 3, y: 0.7 },
        { x: 4, y: 0.8 }
      ];

      const result = service.calculateLinearRegression(data);

      expect(result.slope).toBeGreaterThan(0);
      expect(result.trend).toBe('improving');
    });

    it('should calculate trend correctly for decreasing data', () => {
      const data = [
        { x: 1, y: 0.8 },
        { x: 2, y: 0.7 },
        { x: 3, y: 0.6 },
        { x: 4, y: 0.5 }
      ];

      const result = service.calculateLinearRegression(data);

      expect(result.slope).toBeLessThan(0);
      expect(result.trend).toBe('declining');
    });

    it('should handle stable data', () => {
      const data = [
        { x: 1, y: 0.7 },
        { x: 2, y: 0.71 },
        { x: 3, y: 0.69 },
        { x: 4, y: 0.7 }
      ];

      const result = service.calculateLinearRegression(data);

      expect(result.trend).toBe('stable');
    });

    it('should handle insufficient data', () => {
      const data = [{ x: 1, y: 0.7 }];

      const result = service.calculateLinearRegression(data);

      expect(result.slope).toBe(0);
      expect(result.trend).toBe('stable');
    });
  });

  describe('calculateReliabilityScore', () => {
    beforeEach(() => {
      // Mock all metric methods
      service.getDocumentQualityMetrics = jest.fn().mockResolvedValue({
        totalDocuments: 100,
        avgBelievability: 0.75,
        avgQuality: 0.80,
        highQualityRatio: 0.6,
        lowQualityRatio: 0.1
      });

      service.getUserFeedbackMetrics = jest.fn().mockResolvedValue({
        totalFeedback: 50,
        avgRating: 4.2,
        positiveRatio: 0.7,
        negativeRatio: 0.1,
        uniqueUsers: 25
      });

      service.getContentConsistencyMetrics = jest.fn().mockResolvedValue({
        totalDocuments: 100,
        contentTypeVariety: 3,
        avgWordCount: 500,
        wordCountVariability: 0.3,
        metadataCompleteness: 0.85
      });

      service.getErrorRateMetrics = jest.fn().mockResolvedValue({
        totalJobs: 200,
        failureRate: 0.05,
        successRate: 0.9,
        avgProcessingTime: 120
      });

      service.getHistoricalPerformanceMetrics = jest.fn().mockResolvedValue({
        weeklyData: [
          { week: '2024-01-01', documentCount: 20, avgScore: 0.8 },
          { week: '2024-01-08', documentCount: 25, avgScore: 0.85 }
        ],
        weeklyTrend: 'improving',
        trendScore: 0.1
      });

      // Mock database operations
      mockDatabaseManager.query.mockResolvedValue({ rows: [] });
    });

    it('should calculate reliability score successfully', async () => {
      const result = await service.calculateReliabilityScore('source-1');

      expect(result).toHaveProperty('sourceId', 'source-1');
      expect(result).toHaveProperty('overallScore');
      expect(result).toHaveProperty('reliabilityLevel');
      expect(result).toHaveProperty('breakdown');
      expect(result).toHaveProperty('metrics');
      expect(result.overallScore).toBeGreaterThanOrEqual(0);
      expect(result.overallScore).toBeLessThanOrEqual(1);
      expect(['high', 'medium', 'low']).toContain(result.reliabilityLevel);
    });

    it('should determine reliability level correctly', async () => {
      // Mock high score
      service.getDocumentQualityMetrics.mockResolvedValue({
        totalDocuments: 100,
        avgBelievability: 0.95,
        avgQuality: 0.95,
        highQualityRatio: 0.9,
        lowQualityRatio: 0.05
      });

      const result = await service.calculateReliabilityScore('source-1');

      expect(result.reliabilityLevel).toBe('high');
    });

    it('should handle sources with no data', async () => {
      service.getDocumentQualityMetrics.mockResolvedValue({
        totalDocuments: 0,
        avgBelievability: 0,
        avgQuality: 0,
        highQualityRatio: 0,
        lowQualityRatio: 0
      });

      service.getUserFeedbackMetrics.mockResolvedValue({
        totalFeedback: 0,
        avgRating: 0,
        positiveRatio: 0,
        negativeRatio: 0,
        uniqueUsers: 0
      });

      service.getContentConsistencyMetrics.mockResolvedValue({
        totalDocuments: 0,
        contentTypeVariety: 0,
        avgWordCount: 0,
        wordCountVariability: 0,
        metadataCompleteness: 0
      });

      service.getErrorRateMetrics.mockResolvedValue({
        totalJobs: 0,
        failureRate: 0,
        successRate: 0,
        avgProcessingTime: 0
      });

      service.getHistoricalPerformanceMetrics.mockResolvedValue({
        weeklyTrend: 'stable',
        trendScore: 0.5,
        dataPoints: 0
      });

      const result = await service.calculateReliabilityScore('source-1');

      expect(result.overallScore).toBe(0.5);
      expect(result.reliabilityLevel).toBe('medium');
    });

    it('should store calculated score in database', async () => {
      await service.calculateReliabilityScore('source-1');

      expect(mockDatabaseManager.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO source_reliability_scores'),
        expect.arrayContaining(['source-1'])
      );
    });

    it('should log audit event', async () => {
      await service.calculateReliabilityScore('source-1');

      expect(mockAuditService.logEvent).toHaveBeenCalledWith(
        'source_reliability_calculated',
        expect.objectContaining({
          sourceId: 'source-1'
        })
      );
    });
  });

  describe('getReliabilityScore', () => {
    it('should retrieve stored reliability score', async () => {
      const mockResult = {
        rows: [{
          source_id: 'source-1',
          overall_score: 0.75,
          reliability_level: 'medium',
          score_breakdown: JSON.stringify({ quality: 0.8, feedback: 0.7 }),
          metrics_data: JSON.stringify({ totalDocuments: 100 }),
          calculated_at: '2024-01-01T00:00:00Z',
          timeframe: '30 days',
          updated_at: '2024-01-01T00:00:00Z'
        }]
      };

      mockDatabaseManager.query.mockResolvedValue(mockResult);

      const result = await service.getReliabilityScore('source-1');

      expect(result).toEqual({
        sourceId: 'source-1',
        overallScore: 0.75,
        reliabilityLevel: 'medium',
        breakdown: { quality: 0.8, feedback: 0.7 },
        metrics: { totalDocuments: 100 },
        calculatedAt: '2024-01-01T00:00:00Z',
        timeframe: '30 days',
        updatedAt: '2024-01-01T00:00:00Z'
      });
    });

    it('should return null if no score found', async () => {
      mockDatabaseManager.query.mockResolvedValue({ rows: [] });

      const result = await service.getReliabilityScore('source-1');

      expect(result).toBeNull();
    });
  });

  describe('getAllReliabilityScores', () => {
    it('should retrieve all reliability scores with pagination', async () => {
      const mockResult = {
        rows: [
          {
            id: 'source-1',
            name: 'Test Source',
            type: 'news',
            status: 'active',
            overall_score: 0.75,
            reliability_level: 'medium',
            calculated_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:00:00Z'
          }
        ]
      };

      mockDatabaseManager.query.mockResolvedValue(mockResult);

      const result = await service.getAllReliabilityScores({
        limit: 10,
        offset: 0,
        orderBy: 'overall_score DESC'
      });

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        sourceId: 'source-1',
        sourceName: 'Test Source',
        sourceType: 'news',
        sourceStatus: 'active',
        overallScore: 0.75,
        reliabilityLevel: 'medium',
        calculatedAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z'
      });
    });
  });

  describe('updateAllReliabilityScores', () => {
    it('should update scores for all active sources', async () => {
      // Mock active sources query
      const mockSourcesResult = {
        rows: [
          { id: 'source-1' },
          { id: 'source-2' }
        ]
      };

      mockDatabaseManager.query
        .mockResolvedValueOnce(mockSourcesResult) // First call for sources
        .mockResolvedValue({ rows: [] }); // Subsequent calls for score calculations

      // Mock the calculateReliabilityScore method
      service.calculateReliabilityScore = jest.fn()
        .mockResolvedValueOnce({ sourceId: 'source-1', overallScore: 0.8 })
        .mockResolvedValueOnce({ sourceId: 'source-2', overallScore: 0.6 });

      const result = await service.updateAllReliabilityScores({ batchSize: 2 });

      expect(result.totalSources).toBe(2);
      expect(result.successful).toBe(2);
      expect(result.failed).toBe(0);
      expect(service.calculateReliabilityScore).toHaveBeenCalledTimes(2);
    });

    it('should handle batch processing', async () => {
      const mockSourcesResult = {
        rows: [
          { id: 'source-1' },
          { id: 'source-2' },
          { id: 'source-3' }
        ]
      };

      mockDatabaseManager.query.mockResolvedValueOnce(mockSourcesResult);
      service.calculateReliabilityScore = jest.fn()
        .mockResolvedValue({ sourceId: 'test', overallScore: 0.8 });

      const result = await service.updateAllReliabilityScores({ batchSize: 2 });

      expect(result.totalSources).toBe(3);
      expect(service.calculateReliabilityScore).toHaveBeenCalledTimes(3);
    });

    it('should handle individual calculation failures', async () => {
      const mockSourcesResult = {
        rows: [
          { id: 'source-1' },
          { id: 'source-2' }
        ]
      };

      mockDatabaseManager.query.mockResolvedValueOnce(mockSourcesResult);
      service.calculateReliabilityScore = jest.fn()
        .mockResolvedValueOnce({ sourceId: 'source-1', overallScore: 0.8 })
        .mockRejectedValueOnce(new Error('Calculation failed'));

      const result = await service.updateAllReliabilityScores({ batchSize: 2 });

      expect(result.totalSources).toBe(2);
      expect(result.successful).toBe(1);
      expect(result.failed).toBe(1);
    });
  });

  describe('determineReliabilityLevel', () => {
    it('should classify high reliability correctly', () => {
      const level = service.determineReliabilityLevel(0.8);
      expect(level).toBe('high');
    });

    it('should classify medium reliability correctly', () => {
      const level = service.determineReliabilityLevel(0.6);
      expect(level).toBe('medium');
    });

    it('should classify low reliability correctly', () => {
      const level = service.determineReliabilityLevel(0.3);
      expect(level).toBe('low');
    });

    it('should handle edge cases', () => {
      expect(service.determineReliabilityLevel(0.7)).toBe('medium');
      expect(service.determineReliabilityLevel(0.75)).toBe('high');
      expect(service.determineReliabilityLevel(0.5)).toBe('medium');
      expect(service.determineReliabilityLevel(0.49)).toBe('low');
      expect(service.determineReliabilityLevel(0)).toBe('low');
      expect(service.determineReliabilityLevel(1)).toBe('high');
    });
  });

  describe('normalizeScore', () => {
    it('should normalize scores correctly', () => {
      expect(service.normalizeScore(50, 0, 100)).toBe(0.5);
      expect(service.normalizeScore(0, 0, 100)).toBe(0);
      expect(service.normalizeScore(100, 0, 100)).toBe(1);
    });

    it('should handle edge cases', () => {
      expect(service.normalizeScore(150, 0, 100)).toBe(1); // Clamp to 1
      expect(service.normalizeScore(-10, 0, 100)).toBe(0); // Clamp to 0
      expect(service.normalizeScore(50, 50, 50)).toBe(0); // Same min/max
    });
  });
});
