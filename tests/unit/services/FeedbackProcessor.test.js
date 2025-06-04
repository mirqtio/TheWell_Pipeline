/**
 * FeedbackProcessor Unit Tests
 */

const FeedbackProcessor = require('../../../src/services/FeedbackProcessor');

describe('FeedbackProcessor', () => {
  let processor;

  beforeEach(async () => {
    processor = new FeedbackProcessor({
      enableRealTimeProcessing: false,
      batchSize: 10,
      processingInterval: 1000,
      trendingThreshold: 1 // Lower threshold for testing
    });
    
    await processor.initialize();
  });

  afterEach(async () => {
    if (processor) {
      await processor.shutdown();
    }
  });

  describe('Initialization', () => {
    it('should initialize successfully', () => {
      expect(processor.isInitialized).toBe(true);
      expect(processor.sentimentAnalyzer).toBeDefined();
      expect(processor.semanticAnalyzer).toBeDefined();
      expect(processor.trendDetector).toBeDefined();
    });

    it('should have correct default configuration', () => {
      expect(processor.config.batchSize).toBe(10);
      expect(processor.config.processingInterval).toBe(1000);
      expect(processor.config.trendingThreshold).toBe(1); // As set in beforeEach
    });
  });

  describe('Feedback Processing', () => {
    it('should validate feedback data', () => {
      const invalidFeedback = { content: 'test' };
      
      expect(() => processor.validateFeedback(invalidFeedback))
        .toThrow('Missing required field: type');
    });

    it('should process valid feedback', async () => {
      const feedbackData = {
        type: 'quality',
        content: 'This response was very helpful and accurate',
        sessionId: 'test-session-123',
        userId: 'user-456',
        queryId: 'query-789'
      };

      const result = await processor.processFeedback(feedbackData);

      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      expect(result.sentiment).toBeDefined();
      expect(result.topics).toBeDefined();
      expect(result.enrichedAt).toBeDefined();
    });

    it('should analyze sentiment correctly', async () => {
      const positiveFeedback = {
        type: 'quality',
        content: 'Excellent response, very helpful and accurate',
        sessionId: 'test-session',
        userId: 'user-1'
      };

      const negativeFeedback = {
        type: 'quality', 
        content: 'Poor response, wrong and irrelevant information',
        sessionId: 'test-session',
        userId: 'user-2'
      };

      const positiveResult = await processor.processFeedback(positiveFeedback);
      const negativeResult = await processor.processFeedback(negativeFeedback);

      expect(positiveResult.sentiment.classification).toBe('positive');
      expect(negativeResult.sentiment.classification).toBe('negative');
    });

    it('should extract topics correctly', async () => {
      const feedbackData = {
        type: 'quality',
        content: 'The search results were accurate but the response was slow',
        sessionId: 'test-session',
        userId: 'user-1'
      };

      const result = await processor.processFeedback(feedbackData);

      expect(result.topics).toBeDefined();
      expect(result.topics.length).toBeGreaterThan(0);
      
      const topicNames = result.topics.map(t => t.topic);
      expect(topicNames).toContain('accuracy');
      expect(topicNames).toContain('speed');
    });
  });

  describe('Pattern Detection', () => {
    it('should detect similar feedback patterns', async () => {
      const similarFeedback = [
        {
          type: 'quality',
          content: 'Response was too slow',
          sessionId: 'session-1',
          userId: 'user-1'
        },
        {
          type: 'quality',
          content: 'Very slow response time',
          sessionId: 'session-2', 
          userId: 'user-2'
        }
      ];

      // Process feedback items
      for (const feedback of similarFeedback) {
        await processor.processFeedback(feedback);
      }

      const similarity = processor.semanticAnalyzer.calculateSimilarity(
        similarFeedback[0].content,
        similarFeedback[1].content
      );

      expect(similarity).toBeGreaterThan(0.2); // More realistic threshold for Jaccard similarity
    });

    it('should update trending patterns', async () => {
      const feedbackItems = [
        {
          type: 'quality',
          content: 'Search results are not relevant',
          sessionId: 'session-1',
          userId: 'user-1'
        },
        {
          type: 'quality',
          content: 'Results not relevant to my query',
          sessionId: 'session-2',
          userId: 'user-2'
        },
        {
          type: 'quality',
          content: 'Irrelevant search results provided',
          sessionId: 'session-3',
          userId: 'user-3'
        }
      ];

      for (const feedback of feedbackItems) {
        await processor.processFeedback(feedback);
      }

      const trendingIssues = processor.getTrendingIssues();
      expect(trendingIssues.length).toBeGreaterThan(0);
    });
  });

  describe('Real-time Processing', () => {
    beforeEach(async () => {
      await processor.shutdown();
      processor = new FeedbackProcessor({
        enableRealTimeProcessing: true,
        batchSize: 5,
        processingInterval: 500,
        trendingThreshold: 2
      });
      await processor.initialize();
    });

    it('should detect immediate issues', async () => {
      const criticalFeedback = {
        type: 'quality',
        content: 'This is absolutely terrible, completely wrong and useless',
        sessionId: 'test-session',
        userId: 'user-1'
      };

      let immediateIssue = null;
      processor.on('immediate_issue_detected', (issue) => {
        immediateIssue = issue;
      });

      await processor.processFeedback(criticalFeedback);

      expect(immediateIssue).toBeDefined();
      expect(immediateIssue.type).toBe('high_negative_sentiment');
      expect(immediateIssue.severity).toBe('high');
    });

    it('should generate real-time insights', async () => {
      const slowResponseFeedback = {
        type: 'performance',
        content: 'Response is too slow',
        sessionId: 'test-session',
        userId: 'user-1',
        queryId: 'query-123', // Required for response context analysis
        metadata: {
          responseTime: 5000 // 5 seconds
        }
      };

      let insight = null;
      processor.on('insight_generated', (generatedInsight) => {
        insight = generatedInsight;
      });

      await processor.processFeedback(slowResponseFeedback);

      expect(insight).toBeDefined();
      expect(insight.type).toBe('performance');
    });
  });

  describe('Batch Processing', () => {
    it('should process feedback in batches', async () => {
      // Add feedback to queue
      const feedbackItems = Array.from({ length: 15 }, (_, i) => ({
        type: 'quality',
        content: `Test feedback ${i}`,
        sessionId: `session-${i}`,
        userId: `user-${i}`
      }));

      for (const feedback of feedbackItems) {
        await processor.processFeedback(feedback);
      }

      expect(processor.feedbackQueue.length).toBe(15);

      // Process batch
      await processor.processBatch();

      expect(processor.feedbackQueue.length).toBe(5); // 15 - 10 (batch size)
    });

    it('should detect trends in batch processing', async () => {
      let batchProcessed = false;
      processor.on('batch_processed', (event) => {
        batchProcessed = true;
      });

      // Test event emission directly first
      processor.emit('batch_processed', { test: true });
      expect(batchProcessed).toBe(true);

      // Reset for actual test
      batchProcessed = false;

      // Add simple feedback items to queue
      const feedback1 = {
        id: 'test1',
        type: 'accuracy',
        content: 'test content 1',
        sessionId: 'session-1',
        userId: 'user-1',
        sentiment: { score: -0.5, classification: 'negative' },
        topics: [{ topic: 'accuracy', confidence: 0.8 }],
        responseContext: null,
        enrichedAt: new Date()
      };

      processor.feedbackQueue.push(feedback1);
      
      // Directly call processBatch and check
      const queueLengthBefore = processor.feedbackQueue.length;
      await processor.processBatch();
      const queueLengthAfter = processor.feedbackQueue.length;
      
      // Queue should be processed (length should decrease)
      expect(queueLengthBefore).toBeGreaterThan(queueLengthAfter);
      expect(batchProcessed).toBe(true);
      expect(processor.getFeedbackPatterns().length).toBeGreaterThan(0);
    });
  });

  describe('Trend Analysis', () => {
    it('should calculate trend severity correctly', () => {
      const positiveFeedback = [
        { sentiment: { score: 0.8 } },
        { sentiment: { score: 0.6 } }
      ];

      const negativeFeedback = [
        { sentiment: { score: -0.8 } },
        { sentiment: { score: -0.7 } },
        { sentiment: { score: -0.6 } }
      ];

      const positiveSeverity = processor.calculateTrendSeverity(
        positiveFeedback[0], 
        positiveFeedback.slice(1)
      );
      
      const negativeSeverity = processor.calculateTrendSeverity(
        negativeFeedback[0], 
        negativeFeedback.slice(1)
      );

      expect(positiveSeverity).toBe('low');
      expect(negativeSeverity).toBe('medium');
    });

    it('should generate action recommendations', async () => {
      const criticalTrend = {
        pattern: { 
          avgSentiment: -0.8,
          commonTopics: ['accuracy'],
          frequency: 5
        },
        similarity: 0.9,
        items: Array.from({ length: 5 }, () => ({ sentiment: { score: -0.8 } }))
      };

      const actions = await processor.generateActionRecommendations(criticalTrend);

      expect(actions.length).toBeGreaterThan(0);
      expect(actions.some(a => a.type === 'urgent_review')).toBe(true);
      expect(actions.some(a => a.type === 'content_review')).toBe(true);
    });
  });

  describe('Performance Metrics', () => {
    it('should track processing metrics', async () => {
      const feedback = {
        type: 'quality',
        content: 'Test feedback',
        sessionId: 'test-session',
        userId: 'user-1'
      };

      await processor.processFeedback(feedback);

      const metrics = processor.getPerformanceMetrics();

      expect(metrics.totalProcessed).toBe(1);
      expect(metrics.averageResponseTime).toBeGreaterThanOrEqual(0);
      expect(metrics.queueLength).toBe(1); // One item in queue
    });

    it('should provide status information', () => {
      const status = processor.getStatus();

      expect(status.initialized).toBe(true);
      expect(status.processingEnabled).toBe(false); // As set in beforeEach
      expect(status.metrics).toBeDefined();
      expect(status.config).toBeDefined();
    });
  });

  describe('Query Methods', () => {
    beforeEach(async () => {
      // Add some test data
      const testFeedback = [
        {
          type: 'quality',
          content: 'Good response, very helpful',
          sessionId: 'session-1',
          userId: 'user-1'
        },
        {
          type: 'speed',
          content: 'Response was too slow',
          sessionId: 'session-2',
          userId: 'user-2'
        }
      ];

      for (const feedback of testFeedback) {
        await processor.processFeedback(feedback);
      }
    });

    it('should return feedback patterns', () => {
      const patterns = processor.getFeedbackPatterns();
      expect(Array.isArray(patterns)).toBe(true);
    });

    it('should return trending issues', () => {
      const trending = processor.getTrendingIssues();
      expect(Array.isArray(trending)).toBe(true);
    });

    it('should return performance metrics', () => {
      const metrics = processor.getPerformanceMetrics();
      
      expect(metrics).toHaveProperty('totalProcessed');
      expect(metrics).toHaveProperty('averageResponseTime');
      expect(metrics).toHaveProperty('queueLength');
      expect(metrics).toHaveProperty('patternsDetected');
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid feedback gracefully', async () => {
      const invalidFeedback = {
        // Missing required fields
        content: 'Test content'
      };

      await expect(processor.processFeedback(invalidFeedback))
        .rejects.toThrow('Missing required field');
    });

    it('should handle analysis errors gracefully', async () => {
      const feedback = {
        type: 'quality',
        content: '',
        sessionId: 'test-session',
        userId: 'user-1'
      };

      const result = await processor.processFeedback(feedback);
      expect(result).toBeDefined();
      expect(result.sentiment).toBeDefined();
    });
  });

  describe('Shutdown', () => {
    it('should shutdown gracefully', async () => {
      expect(processor.isInitialized).toBe(true);
      
      await processor.shutdown();
      
      expect(processor.isInitialized).toBe(false);
    });

    it('should process remaining queue on shutdown', async () => {
      const feedback = {
        type: 'quality',
        content: 'Test feedback',
        sessionId: 'test-session',
        userId: 'user-1'
      };

      await processor.processFeedback(feedback);
      expect(processor.feedbackQueue.length).toBe(1);

      await processor.shutdown();
      
      // Queue should be processed during shutdown
      expect(processor.feedbackQueue.length).toBe(0);
    });
  });
});