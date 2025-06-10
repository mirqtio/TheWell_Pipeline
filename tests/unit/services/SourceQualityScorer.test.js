/**
 * Unit Tests for SourceQualityScorer
 * Tests believability weighting and source reliability calculation algorithms
 */

const SourceQualityScorer = require('../../../src/services/SourceQualityScorer');

describe('SourceQualityScorer', () => {
  let scorer;

  beforeEach(() => {
    scorer = new SourceQualityScorer({
      baselineWeight: 0.5,
      decayRate: 0.1,
      minWeight: 0.1,
      maxWeight: 1.0,
      historicalPeriodDays: 30
    });
  });

  describe('initialization', () => {
    test('should initialize with default config', () => {
      const defaultScorer = new SourceQualityScorer();
      expect(defaultScorer.config.baselineWeight).toBe(0.5);
      expect(defaultScorer.config.decayRate).toBe(0.1);
      expect(defaultScorer.config.minWeight).toBe(0.1);
      expect(defaultScorer.config.maxWeight).toBe(1.0);
    });

    test('should override default config with provided options', () => {
      const customScorer = new SourceQualityScorer({
        baselineWeight: 0.7,
        decayRate: 0.05
      });
      expect(customScorer.config.baselineWeight).toBe(0.7);
      expect(customScorer.config.decayRate).toBe(0.05);
    });
  });

  describe('calculateBelievabilityWeight', () => {
    test('should calculate believability for a new source', () => {
      const sourceMetrics = {
        sourceId: 'source-1',
        totalFeedbacks: 0,
        positiveFeedbacks: 0,
        negativeFeedbacks: 0,
        avgResponseTime: 1000,
        uptime: 99.5,
        lastFailureTime: null
      };

      const weight = scorer.calculateBelievabilityWeight(sourceMetrics);
      expect(weight).toBe(0.5); // baseline weight for new source
    });

    test('should increase weight for source with positive feedback', () => {
      const sourceMetrics = {
        sourceId: 'source-2',
        totalFeedbacks: 100,
        positiveFeedbacks: 80,
        negativeFeedbacks: 20,
        avgResponseTime: 500,
        uptime: 99.9,
        lastFailureTime: null
      };

      const weight = scorer.calculateBelievabilityWeight(sourceMetrics);
      expect(weight).toBeGreaterThan(0.5);
      expect(weight).toBeLessThanOrEqual(1.0);
    });

    test('should decrease weight for source with negative feedback', () => {
      const sourceMetrics = {
        sourceId: 'source-3',
        totalFeedbacks: 50,
        positiveFeedbacks: 10,
        negativeFeedbacks: 40,
        avgResponseTime: 3000,
        uptime: 95.0,
        lastFailureTime: new Date(Date.now() - 60000) // 1 minute ago
      };

      const weight = scorer.calculateBelievabilityWeight(sourceMetrics);
      expect(weight).toBeLessThan(0.5);
      expect(weight).toBeGreaterThanOrEqual(0.1);
    });

    test('should respect minimum weight threshold', () => {
      const sourceMetrics = {
        sourceId: 'source-4',
        totalFeedbacks: 1000,
        positiveFeedbacks: 0,
        negativeFeedbacks: 1000,
        avgResponseTime: 10000,
        uptime: 50.0,
        lastFailureTime: new Date()
      };

      const weight = scorer.calculateBelievabilityWeight(sourceMetrics);
      expect(weight).toBe(0.1); // minimum weight
    });

    test('should respect maximum weight threshold', () => {
      const sourceMetrics = {
        sourceId: 'source-5',
        totalFeedbacks: 1000,
        positiveFeedbacks: 1000,
        negativeFeedbacks: 0,
        avgResponseTime: 100,
        uptime: 100.0,
        lastFailureTime: null
      };

      const weight = scorer.calculateBelievabilityWeight(sourceMetrics);
      expect(weight).toBeCloseTo(0.9, 1); // near maximum weight
    });
  });

  describe('calculateReliabilityScore', () => {
    test('should calculate reliability for stable source', () => {
      const metrics = {
        uptime: 99.9,
        avgResponseTime: 500,
        errorRate: 0.1,
        lastFailureTime: new Date(Date.now() - 24 * 60 * 60 * 1000), // 1 day ago
        consecutiveSuccesses: 100,
        mtbf: 720 // 720 hours mean time between failures
      };

      const score = scorer.calculateReliabilityScore(metrics);
      expect(score).toBeGreaterThan(0.4);
      expect(score).toBeLessThanOrEqual(1.0);
    });

    test('should penalize unreliable source', () => {
      const metrics = {
        uptime: 85.0,
        avgResponseTime: 5000,
        errorRate: 15.0,
        lastFailureTime: new Date(Date.now() - 60000), // 1 minute ago
        consecutiveSuccesses: 2,
        mtbf: 2 // 2 hours mean time between failures
      };

      const score = scorer.calculateReliabilityScore(metrics);
      expect(score).toBeLessThan(0.5);
      expect(score).toBeGreaterThanOrEqual(0);
    });

    test('should handle edge cases gracefully', () => {
      const metrics = {
        uptime: 0,
        avgResponseTime: 0,
        errorRate: 100,
        lastFailureTime: new Date(),
        consecutiveSuccesses: 0,
        mtbf: 0
      };

      const score = scorer.calculateReliabilityScore(metrics);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    });
  });

  describe('scoreSourceContent', () => {
    test('should score content based on multiple factors', async () => {
      const content = {
        sourceId: 'source-1',
        text: 'This is a well-structured document with clear information.',
        metadata: {
          wordCount: 500,
          readabilityScore: 85,
          hasReferences: true,
          publicationDate: new Date('2024-01-01'),
          authorCredibility: 0.8
        }
      };

      const sourceMetrics = {
        sourceId: 'source-1',
        totalFeedbacks: 50,
        positiveFeedbacks: 40,
        negativeFeedbacks: 10,
        avgResponseTime: 800,
        uptime: 98.5,
        lastFailureTime: null
      };

      const score = await scorer.scoreSourceContent(content, sourceMetrics);
      expect(score).toHaveProperty('believabilityWeight');
      expect(score).toHaveProperty('reliabilityScore');
      expect(score).toHaveProperty('contentQuality');
      expect(score).toHaveProperty('overallScore');
      expect(score.overallScore).toBeGreaterThan(0);
      expect(score.overallScore).toBeLessThanOrEqual(1);
    });

    test('should handle missing metadata gracefully', async () => {
      const content = {
        sourceId: 'source-2',
        text: 'Basic content without metadata.'
      };

      const sourceMetrics = {
        sourceId: 'source-2',
        totalFeedbacks: 0,
        positiveFeedbacks: 0,
        negativeFeedbacks: 0,
        avgResponseTime: 1000,
        uptime: 95.0
      };

      const score = await scorer.scoreSourceContent(content, sourceMetrics);
      expect(score.overallScore).toBeGreaterThan(0);
      expect(score.contentQuality).toBeDefined();
    });
  });

  describe('analyzeContentQuality', () => {
    test('should analyze content quality factors', () => {
      const content = {
        text: 'This is a comprehensive document that provides detailed analysis with supporting evidence.',
        metadata: {
          wordCount: 1000,
          readabilityScore: 75,
          hasReferences: true,
          publicationDate: new Date('2024-06-01'),
          authorCredibility: 0.9
        }
      };

      const quality = scorer.analyzeContentQuality(content);
      expect(quality).toHaveProperty('lengthScore');
      expect(quality).toHaveProperty('readabilityScore');
      expect(quality).toHaveProperty('freshnessScore');
      expect(quality).toHaveProperty('credibilityScore');
      expect(quality).toHaveProperty('overallQuality');
      expect(quality.overallQuality).toBeGreaterThan(0);
      expect(quality.overallQuality).toBeLessThanOrEqual(1);
    });

    test('should handle short content appropriately', () => {
      const content = {
        text: 'Short text.',
        metadata: {
          wordCount: 2,
          readabilityScore: 100
        }
      };

      const quality = scorer.analyzeContentQuality(content);
      expect(quality.lengthScore).toBeLessThan(0.5);
      expect(quality.overallQuality).toBeGreaterThan(0);
    });

    test('should penalize outdated content', () => {
      const content = {
        text: 'This is old content that may not be relevant anymore.',
        metadata: {
          wordCount: 500,
          readabilityScore: 80,
          publicationDate: new Date('2020-01-01') // Old date
        }
      };

      const quality = scorer.analyzeContentQuality(content);
      expect(quality.freshnessScore).toBeLessThan(0.5);
    });
  });

  describe('updateSourceMetrics', () => {
    test('should update metrics with new feedback', () => {
      const currentMetrics = {
        sourceId: 'source-1',
        totalFeedbacks: 10,
        positiveFeedbacks: 8,
        negativeFeedbacks: 2,
        avgResponseTime: 1000,
        uptime: 99.0
      };

      const feedback = {
        type: 'positive',
        responseTime: 800,
        timestamp: new Date()
      };

      const updatedMetrics = scorer.updateSourceMetrics(currentMetrics, feedback);
      expect(updatedMetrics.totalFeedbacks).toBe(11);
      expect(updatedMetrics.positiveFeedbacks).toBe(9);
      expect(updatedMetrics.avgResponseTime).toBeLessThan(1000);
    });

    test('should handle negative feedback correctly', () => {
      const currentMetrics = {
        sourceId: 'source-2',
        totalFeedbacks: 5,
        positiveFeedbacks: 3,
        negativeFeedbacks: 2,
        errorCount: 2,
        consecutiveSuccesses: 3
      };

      const feedback = {
        type: 'negative',
        errorType: 'timeout',
        timestamp: new Date()
      };

      const updatedMetrics = scorer.updateSourceMetrics(currentMetrics, feedback);
      expect(updatedMetrics.negativeFeedbacks).toBe(3);
      expect(updatedMetrics.errorCount).toBe(3);
      expect(updatedMetrics.consecutiveSuccesses).toBe(0);
    });
  });

  describe('getSourceRanking', () => {
    test('should rank sources by overall quality', async () => {
      const sources = [
        {
          sourceId: 'source-1',
          metrics: {
            totalFeedbacks: 100,
            positiveFeedbacks: 90,
            negativeFeedbacks: 10,
            uptime: 99.5,
            avgResponseTime: 500
          }
        },
        {
          sourceId: 'source-2',
          metrics: {
            totalFeedbacks: 50,
            positiveFeedbacks: 25,
            negativeFeedbacks: 25,
            uptime: 95.0,
            avgResponseTime: 2000
          }
        },
        {
          sourceId: 'source-3',
          metrics: {
            totalFeedbacks: 200,
            positiveFeedbacks: 180,
            negativeFeedbacks: 20,
            uptime: 99.9,
            avgResponseTime: 300
          }
        }
      ];

      const ranking = await scorer.getSourceRanking(sources);
      expect(ranking).toHaveLength(3);
      expect(ranking[0].sourceId).toBe('source-3'); // Best source
      expect(ranking[2].sourceId).toBe('source-2'); // Worst source
      expect(ranking[0].score).toBeGreaterThan(ranking[1].score);
      expect(ranking[1].score).toBeGreaterThan(ranking[2].score);
    });

    test('should handle empty source list', async () => {
      const ranking = await scorer.getSourceRanking([]);
      expect(ranking).toEqual([]);
    });
  });

  describe('calculateHistoricalTrend', () => {
    test('should calculate trend for improving source', () => {
      const historicalData = [
        { timestamp: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), score: 0.6 },
        { timestamp: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), score: 0.7 },
        { timestamp: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), score: 0.8 },
        { timestamp: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), score: 0.9 }
      ];

      const trend = scorer.calculateHistoricalTrend(historicalData);
      expect(trend.direction).toBe('improving');
      expect(trend.slope).toBeGreaterThan(0);
      expect(trend.confidence).toBeGreaterThan(0);
    });

    test('should calculate trend for declining source', () => {
      const historicalData = [
        { timestamp: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), score: 0.9 },
        { timestamp: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), score: 0.7 },
        { timestamp: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), score: 0.5 },
        { timestamp: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), score: 0.3 }
      ];

      const trend = scorer.calculateHistoricalTrend(historicalData);
      expect(trend.direction).toBe('declining');
      expect(trend.slope).toBeLessThan(0);
    });

    test('should handle stable trend', () => {
      const historicalData = [
        { timestamp: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), score: 0.8 },
        { timestamp: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), score: 0.81 },
        { timestamp: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), score: 0.79 },
        { timestamp: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), score: 0.8 }
      ];

      const trend = scorer.calculateHistoricalTrend(historicalData);
      expect(trend.direction).toBe('stable');
      expect(Math.abs(trend.slope)).toBeLessThan(0.01);
    });
  });
});