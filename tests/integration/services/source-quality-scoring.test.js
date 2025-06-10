/**
 * Integration Tests for Source Quality Scoring System
 * Tests end-to-end workflows for believability weighting and source reliability
 */

const path = require('path');
const SourceQualityScorer = require('../../../src/services/SourceQualityScorer');
const SourceReliabilityService = require('../../../src/services/SourceReliabilityService');

describe('Source Quality Scoring Integration', () => {
  let scorer;
  let reliabilityService;

  beforeAll(async () => {
    scorer = new SourceQualityScorer({
      baselineWeight: 0.5,
      decayRate: 0.1,
      minWeight: 0.1,
      maxWeight: 1.0,
      historicalPeriodDays: 30
    });

    reliabilityService = new SourceReliabilityService();
  });

  describe('end-to-end source evaluation', () => {
    test('should evaluate complete source lifecycle', async () => {
      // 1. Initialize new source
      const sourceId = 'integration-test-source-1';
      const initialMetrics = {
        sourceId,
        totalFeedbacks: 0,
        positiveFeedbacks: 0,
        negativeFeedbacks: 0,
        avgResponseTime: 1000,
        uptime: 100.0,
        lastFailureTime: null,
        errorCount: 0,
        consecutiveSuccesses: 0
      };

      // 2. Score initial content
      const content = {
        sourceId,
        text: 'This is initial content from a new source that provides accurate information.',
        metadata: {
          wordCount: 250,
          readabilityScore: 80,
          hasReferences: true,
          publicationDate: new Date(),
          authorCredibility: 0.7
        }
      };

      const initialScore = await scorer.scoreSourceContent(content, initialMetrics);
      expect(initialScore.believabilityWeight).toBe(0.5); // baseline
      expect(initialScore.overallScore).toBeGreaterThan(0);

      // 3. Simulate positive feedback
      let currentMetrics = initialMetrics;
      for (let i = 0; i < 10; i++) {
        const feedback = {
          type: 'positive',
          responseTime: Math.random() * 500 + 300, // 300-800ms
          timestamp: new Date(Date.now() - (10 - i) * 60000) // Spread over 10 minutes
        };
        currentMetrics = scorer.updateSourceMetrics(currentMetrics, feedback);
      }

      // 4. Re-score after positive feedback
      const improvedScore = await scorer.scoreSourceContent(content, currentMetrics);
      expect(improvedScore.believabilityWeight).toBeGreaterThan(initialScore.believabilityWeight);
      expect(improvedScore.overallScore).toBeGreaterThan(initialScore.overallScore);

      // 5. Simulate some negative feedback
      for (let i = 0; i < 3; i++) {
        const feedback = {
          type: 'negative',
          errorType: 'content_accuracy',
          timestamp: new Date()
        };
        currentMetrics = scorer.updateSourceMetrics(currentMetrics, feedback);
      }

      // 6. Re-score after mixed feedback
      const finalScore = await scorer.scoreSourceContent(content, currentMetrics);
      expect(finalScore.believabilityWeight).toBeLessThan(improvedScore.believabilityWeight);
      expect(finalScore.believabilityWeight).toBeGreaterThan(initialScore.believabilityWeight);
    });

    test('should handle multiple sources with different quality levels', async () => {
      const sources = [
        {
          sourceId: 'high-quality-source',
          content: {
            text: 'High-quality, well-researched content with comprehensive coverage of the topic.',
            metadata: {
              wordCount: 1500,
              readabilityScore: 85,
              hasReferences: true,
              publicationDate: new Date(),
              authorCredibility: 0.95
            }
          },
          metrics: {
            sourceId: 'high-quality-source',
            totalFeedbacks: 200,
            positiveFeedbacks: 190,
            negativeFeedbacks: 10,
            avgResponseTime: 400,
            uptime: 99.8,
            lastFailureTime: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
            errorCount: 5,
            consecutiveSuccesses: 50
          }
        },
        {
          sourceId: 'medium-quality-source',
          content: {
            text: 'Decent content with some useful information but lacks depth.',
            metadata: {
              wordCount: 300,
              readabilityScore: 70,
              hasReferences: false,
              publicationDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
              authorCredibility: 0.6
            }
          },
          metrics: {
            sourceId: 'medium-quality-source',
            totalFeedbacks: 100,
            positiveFeedbacks: 60,
            negativeFeedbacks: 40,
            avgResponseTime: 1200,
            uptime: 95.0,
            lastFailureTime: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
            errorCount: 20,
            consecutiveSuccesses: 10
          }
        },
        {
          sourceId: 'low-quality-source',
          content: {
            text: 'Poor quality content with questionable accuracy.',
            metadata: {
              wordCount: 100,
              readabilityScore: 40,
              hasReferences: false,
              publicationDate: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
              authorCredibility: 0.2
            }
          },
          metrics: {
            sourceId: 'low-quality-source',
            totalFeedbacks: 80,
            positiveFeedbacks: 15,
            negativeFeedbacks: 65,
            avgResponseTime: 3000,
            uptime: 80.0,
            lastFailureTime: new Date(Date.now() - 60000),
            errorCount: 50,
            consecutiveSuccesses: 1
          }
        }
      ];

      // Score all sources
      const scores = [];
      for (const source of sources) {
        const score = await scorer.scoreSourceContent(source.content, source.metrics);
        scores.push({
          sourceId: source.sourceId,
          ...score
        });
      }

      // Verify ranking order
      const ranking = await scorer.getSourceRanking(sources.map(s => ({ 
        sourceId: s.sourceId, 
        metrics: s.metrics 
      })));

      expect(ranking[0].sourceId).toBe('high-quality-source');
      expect(ranking[1].sourceId).toBe('medium-quality-source');
      expect(ranking[2].sourceId).toBe('low-quality-source');

      // Verify score progression
      const highQualityScore = scores.find(s => s.sourceId === 'high-quality-source');
      const mediumQualityScore = scores.find(s => s.sourceId === 'medium-quality-source');
      const lowQualityScore = scores.find(s => s.sourceId === 'low-quality-source');

      expect(highQualityScore.overallScore).toBeGreaterThan(mediumQualityScore.overallScore);
      expect(mediumQualityScore.overallScore).toBeGreaterThan(lowQualityScore.overallScore);
    });
  });

  describe('reliability service integration', () => {
    test('should integrate with source reliability tracking', async () => {
      const sourceId = 'reliability-test-source';
      
      // Track reliability metrics through the service
      await reliabilityService.recordSourceEvent(sourceId, {
        type: 'success',
        responseTime: 500,
        timestamp: new Date()
      });

      await reliabilityService.recordSourceEvent(sourceId, {
        type: 'success',
        responseTime: 600,
        timestamp: new Date()
      });

      await reliabilityService.recordSourceEvent(sourceId, {
        type: 'error',
        errorType: 'timeout',
        timestamp: new Date()
      });

      // Get reliability metrics
      const reliabilityMetrics = await reliabilityService.getSourceMetrics(sourceId);
      expect(reliabilityMetrics).toBeDefined();
      expect(reliabilityMetrics.sourceId).toBe(sourceId);

      // Calculate reliability score using scorer
      const reliabilityScore = scorer.calculateReliabilityScore(reliabilityMetrics);
      expect(reliabilityScore).toBeGreaterThan(0);
      expect(reliabilityScore).toBeLessThanOrEqual(1);
    });
  });

  describe('historical trend analysis', () => {
    test('should analyze source quality trends over time', async () => {
      const sourceId = 'trend-analysis-source';
      const historicalData = [];

      // Generate historical data points
      const now = Date.now();
      for (let i = 30; i >= 0; i--) {
        const timestamp = new Date(now - i * 24 * 60 * 60 * 1000);
        
        // Simulate improving quality over time
        const baseScore = 0.4;
        const improvement = (30 - i) * 0.01; // Gradual improvement
        const noise = (Math.random() - 0.5) * 0.1; // Add some randomness
        const score = Math.max(0.1, Math.min(1.0, baseScore + improvement + noise));

        historicalData.push({ timestamp, score });
      }

      const trend = scorer.calculateHistoricalTrend(historicalData);
      expect(trend.direction).toBe('improving');
      expect(trend.slope).toBeGreaterThan(0);
      expect(trend.confidence).toBeGreaterThan(0.5);
    });

    test('should detect declining source quality', async () => {
      const historicalData = [];
      const now = Date.now();

      // Generate declining quality data
      for (let i = 30; i >= 0; i--) {
        const timestamp = new Date(now - i * 24 * 60 * 60 * 1000);
        const baseScore = 0.9;
        const decline = (30 - i) * 0.015; // Gradual decline
        const noise = (Math.random() - 0.5) * 0.05;
        const score = Math.max(0.1, Math.min(1.0, baseScore - decline + noise));

        historicalData.push({ timestamp, score });
      }

      const trend = scorer.calculateHistoricalTrend(historicalData);
      expect(trend.direction).toBe('declining');
      expect(trend.slope).toBeLessThan(0);
    });
  });

  describe('content quality analysis', () => {
    test('should analyze different content types appropriately', async () => {
      const contentTypes = [
        {
          name: 'academic_paper',
          content: {
            text: 'This comprehensive academic research paper provides extensive analysis with peer-reviewed methodology and substantial empirical evidence.',
            metadata: {
              wordCount: 5000,
              readabilityScore: 45, // Academic complexity
              hasReferences: true,
              publicationDate: new Date('2024-05-01'),
              authorCredibility: 0.95,
              contentType: 'academic'
            }
          }
        },
        {
          name: 'news_article',
          content: {
            text: 'Breaking news: Recent developments in the field show significant progress with industry experts providing commentary.',
            metadata: {
              wordCount: 800,
              readabilityScore: 75, // More accessible
              hasReferences: true,
              publicationDate: new Date(),
              authorCredibility: 0.8,
              contentType: 'news'
            }
          }
        },
        {
          name: 'blog_post',
          content: {
            text: 'Personal insights and experiences shared in an informal but informative manner.',
            metadata: {
              wordCount: 400,
              readabilityScore: 85, // Very accessible
              hasReferences: false,
              publicationDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
              authorCredibility: 0.5,
              contentType: 'blog'
            }
          }
        }
      ];

      const qualityScores = [];
      for (const item of contentTypes) {
        const quality = scorer.analyzeContentQuality(item.content);
        qualityScores.push({
          name: item.name,
          quality
        });
      }

      // Verify academic content gets high credibility score despite low readability
      const academicScore = qualityScores.find(s => s.name === 'academic_paper');
      expect(academicScore.quality.credibilityScore).toBeGreaterThan(0.8);

      // Verify news article balances credibility and accessibility
      const newsScore = qualityScores.find(s => s.name === 'news_article');
      expect(newsScore.quality.readabilityScore).toBeGreaterThan(0.7);
      expect(newsScore.quality.credibilityScore).toBeGreaterThan(0.7);

      // Verify blog post reflects lower credibility but high accessibility
      const blogScore = qualityScores.find(s => s.name === 'blog_post');
      expect(blogScore.quality.readabilityScore).toBeGreaterThan(0.8);
      expect(blogScore.quality.credibilityScore).toBeLessThan(0.7);
    });
  });

  describe('weighted scoring integration', () => {
    test('should properly weight content based on source reliability', async () => {
      const highReliabilityMetrics = {
        sourceId: 'high-reliability',
        totalFeedbacks: 500,
        positiveFeedbacks: 475,
        negativeFeedbacks: 25,
        avgResponseTime: 300,
        uptime: 99.9,
        lastFailureTime: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        errorCount: 2,
        consecutiveSuccesses: 100
      };

      const lowReliabilityMetrics = {
        sourceId: 'low-reliability',
        totalFeedbacks: 100,
        positiveFeedbacks: 30,
        negativeFeedbacks: 70,
        avgResponseTime: 2500,
        uptime: 85.0,
        lastFailureTime: new Date(Date.now() - 60000),
        errorCount: 35,
        consecutiveSuccesses: 2
      };

      const sameContent = {
        text: 'This is identical content from two different sources.',
        metadata: {
          wordCount: 150,
          readabilityScore: 75,
          hasReferences: false,
          publicationDate: new Date(),
          authorCredibility: 0.7
        }
      };

      const highReliabilityScore = await scorer.scoreSourceContent(
        { ...sameContent, sourceId: 'high-reliability' },
        highReliabilityMetrics
      );

      const lowReliabilityScore = await scorer.scoreSourceContent(
        { ...sameContent, sourceId: 'low-reliability' },
        lowReliabilityMetrics
      );

      // Same content should score higher from more reliable source
      expect(highReliabilityScore.overallScore).toBeGreaterThan(lowReliabilityScore.overallScore);
      expect(highReliabilityScore.believabilityWeight).toBeGreaterThan(lowReliabilityScore.believabilityWeight);
      expect(highReliabilityScore.reliabilityScore).toBeGreaterThan(lowReliabilityScore.reliabilityScore);
    });
  });
});