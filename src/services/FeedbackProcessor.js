/**
 * Feedback Processor
 * Processes user feedback and improves system performance through adaptive learning
 */

const EventEmitter = require('events');
const logger = require('../utils/logger');

class FeedbackProcessor extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      enableRealTimeProcessing: config.enableRealTimeProcessing !== false,
      batchSize: config.batchSize || 50,
      processingInterval: config.processingInterval || 60000, // 1 minute
      trendingThreshold: config.trendingThreshold || 5, // Number of similar feedback items
      confidenceThreshold: config.confidenceThreshold || 0.7,
      responseLatencyThreshold: config.responseLatencyThreshold || 2000, // 2 seconds
      ...config
    };

    // Processing state
    this.feedbackQueue = [];
    this.feedbackPatterns = new Map();
    this.trendingIssues = new Map();
    this.performanceMetrics = {
      totalProcessed: 0,
      averageResponseTime: 0,
      improvementsSuggested: 0,
      patternsDetected: 0
    };

    // Analysis engines
    this.sentimentAnalyzer = null;
    this.semanticAnalyzer = null;
    this.trendDetector = null;

    this.isInitialized = false;
    this.processingTimer = null;
  }

  async initialize() {
    try {
      logger.info('Initializing Feedback Processor...');
      
      // Initialize analysis components
      await this.initializeAnalysisEngines();
      
      // Start processing loop
      if (this.config.enableRealTimeProcessing) {
        this.startProcessingLoop();
      }
      
      this.isInitialized = true;
      logger.info('Feedback Processor initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Feedback Processor:', error);
      throw error;
    }
  }

  async initializeAnalysisEngines() {
    // Initialize sentiment analysis
    this.sentimentAnalyzer = {
      analyze: async (text) => {
        // Simplified sentiment analysis - in production would use ML model
        const positiveWords = ['good', 'great', 'excellent', 'helpful', 'accurate', 'relevant'];
        const negativeWords = ['bad', 'poor', 'wrong', 'irrelevant', 'useless', 'inaccurate'];
        
        const words = text.toLowerCase().split(/\s+/);
        let score = 0;
        
        words.forEach(word => {
          if (positiveWords.includes(word)) score += 1;
          if (negativeWords.includes(word)) score -= 1;
        });
        
        return {
          score: Math.max(-1, Math.min(1, score / words.length)),
          magnitude: Math.abs(score),
          classification: score > 0 ? 'positive' : score < 0 ? 'negative' : 'neutral'
        };
      }
    };

    // Initialize semantic analysis
    this.semanticAnalyzer = {
      extractTopics: async (text) => {
        // Simplified topic extraction
        const topics = [];
        const commonTopics = {
          'search': ['search', 'find', 'query', 'results'],
          'accuracy': ['accurate', 'correct', 'wrong', 'error', 'mistake'],
          'relevance': ['relevant', 'related', 'appropriate', 'suitable'],
          'speed': ['fast', 'slow', 'quick', 'time', 'latency', 'response'],
          'completeness': ['complete', 'missing', 'incomplete', 'comprehensive']
        };
        
        const words = text.toLowerCase().split(/\s+/);
        
        for (const [topic, keywords] of Object.entries(commonTopics)) {
          const matches = keywords.filter(keyword => 
            words.some(word => word.includes(keyword))
          );
          
          if (matches.length > 0) {
            topics.push({
              topic,
              confidence: matches.length / keywords.length,
              keywords: matches
            });
          }
        }
        
        return topics;
      },

      calculateSimilarity: (text1, text2) => {
        // Simplified similarity calculation using Jaccard index
        const words1 = new Set(text1.toLowerCase().split(/\s+/));
        const words2 = new Set(text2.toLowerCase().split(/\s+/));
        
        const intersection = new Set([...words1].filter(x => words2.has(x)));
        const union = new Set([...words1, ...words2]);
        
        return intersection.size / union.size;
      }
    };

    // Initialize trend detection
    const self = this;
    this.trendDetector = {
      detectTrends: (feedbackItems) => {
        const trends = new Map();
        
        // Group feedback by similarity
        for (let i = 0; i < feedbackItems.length; i++) {
          for (let j = i + 1; j < feedbackItems.length; j++) {
            const similarity = self.semanticAnalyzer.calculateSimilarity(
              feedbackItems[i].content,
              feedbackItems[j].content
            );
            
            if (similarity > 0.3) {
              const trendKey = `trend_${i}_${j}`;
              if (!trends.has(trendKey)) {
                trends.set(trendKey, {
                  items: [feedbackItems[i], feedbackItems[j]],
                  similarity,
                  pattern: self.trendDetector.extractPattern([feedbackItems[i], feedbackItems[j]])
                });
              }
            }
          }
        }
        
        return Array.from(trends.values());
      },

      extractPattern: (items) => {
        // Extract common patterns from similar feedback items
        if (items.length < 2) return null;
        
        const commonWords = self.findCommonWords(items.map(item => item.content));
        const commonTopics = self.findCommonTopics(items);
        
        return {
          commonWords,
          commonTopics,
          frequency: items.length,
          avgSentiment: items.reduce((sum, item) => sum + (item.sentiment?.score || 0), 0) / items.length
        };
      }
    };
  }

  // Main feedback processing entry point
  async processFeedback(feedbackData) {
    try {
      const startTime = Date.now();
      
      // Validate feedback data
      const validatedFeedback = this.validateFeedback(feedbackData);
      
      // Enrich feedback with analysis
      const enrichedFeedback = await this.enrichFeedback(validatedFeedback);
      
      // Store for pattern analysis
      this.feedbackQueue.push(enrichedFeedback);
      
      // Always check for trending patterns
      await this.updateTrendingPatterns(enrichedFeedback);
      
      // Real-time processing for immediate issues and insights
      if (this.config.enableRealTimeProcessing) {
        await this.detectImmediateIssues(enrichedFeedback);
        await this.generateRealTimeInsights(enrichedFeedback);
      }
      
      // Track performance
      const processingTime = Date.now() - startTime;
      this.updatePerformanceMetrics(processingTime);
      
      // Emit event
      this.emit('feedback_processed', enrichedFeedback);
      
      return enrichedFeedback;
    } catch (error) {
      logger.error('Error processing feedback:', error);
      throw error;
    }
  }

  validateFeedback(feedbackData) {
    const required = ['type', 'content', 'sessionId'];
    
    for (const field of required) {
      if (feedbackData[field] === undefined || feedbackData[field] === null) {
        throw new Error(`Missing required field: ${field}`);
      }
    }
    
    return {
      id: feedbackData.id || this.generateFeedbackId(),
      type: feedbackData.type,
      content: feedbackData.content,
      sessionId: feedbackData.sessionId,
      queryId: feedbackData.queryId,
      userId: feedbackData.userId,
      rating: feedbackData.rating,
      metadata: feedbackData.metadata || {},
      timestamp: new Date(),
      processed: false
    };
  }

  async enrichFeedback(feedback) {
    try {
      // Sentiment analysis
      const sentiment = await this.sentimentAnalyzer.analyze(feedback.content);
      
      // Topic extraction
      const topics = await this.semanticAnalyzer.extractTopics(feedback.content);
      
      // Response context analysis
      const responseContext = await this.analyzeResponseContext(feedback);
      
      return {
        ...feedback,
        sentiment,
        topics,
        responseContext,
        enrichedAt: new Date()
      };
    } catch (error) {
      logger.error('Error enriching feedback:', error);
      return feedback;
    }
  }

  async analyzeResponseContext(feedback) {
    if (!feedback.queryId) return null;
    
    try {
      // In production, would fetch actual response data
      return {
        responseTime: feedback.metadata.responseTime || 0,
        relevanceScore: feedback.metadata.relevanceScore || 0,
        sourcesUsed: feedback.metadata.sourcesUsed || [],
        queryComplexity: this.calculateQueryComplexity(feedback.metadata.originalQuery || ''),
        contextRelevance: feedback.metadata.contextRelevance || 0
      };
    } catch (error) {
      logger.error('Error analyzing response context:', error);
      return null;
    }
  }

  calculateQueryComplexity(query) {
    const words = query.split(/\s+/).length;
    const hasQuestions = /\?/.test(query);
    const hasFilters = /\b(and|or|not|filter|where)\b/i.test(query);
    
    let complexity = 'simple';
    
    if (words > 10 || hasFilters) complexity = 'moderate';
    if (words > 20 || (hasQuestions && hasFilters)) complexity = 'complex';
    
    return complexity;
  }

  async processRealTime(feedback) {
    try {
      // Check for immediate action items
      await this.detectImmediateIssues(feedback);
      
      // Update trending patterns
      await this.updateTrendingPatterns(feedback);
      
      // Generate real-time insights
      await this.generateRealTimeInsights(feedback);
    } catch (error) {
      logger.error('Error in real-time processing:', error);
    }
  }

  async detectImmediateIssues(feedback) {
    const issues = [];
    
    // Check for negative sentiment with high magnitude
    if (feedback.sentiment && feedback.sentiment.score < -0.2 && feedback.sentiment.magnitude > 1.5) {
      issues.push({
        type: 'high_negative_sentiment',
        severity: 'high',
        description: 'Strong negative feedback detected',
        feedback: feedback
      });
    }
    
    // Check for performance complaints
    const performanceTopics = feedback.topics?.filter(topic => 
      topic.topic === 'speed' && topic.confidence > 0.5
    );
    
    if (performanceTopics?.length > 0 && feedback.sentiment?.score < 0) {
      issues.push({
        type: 'performance_complaint',
        severity: 'medium',
        description: 'Performance-related negative feedback',
        feedback: feedback
      });
    }
    
    // Check for accuracy issues
    const accuracyTopics = feedback.topics?.filter(topic => 
      topic.topic === 'accuracy' && topic.confidence > 0.5
    );
    
    if (accuracyTopics?.length > 0 && feedback.sentiment?.score < 0) {
      issues.push({
        type: 'accuracy_issue',
        severity: 'high',
        description: 'Accuracy concerns in feedback',
        feedback: feedback
      });
    }
    
    // Emit immediate issues
    for (const issue of issues) {
      this.emit('immediate_issue_detected', issue);
    }
    
    return issues;
  }

  async updateTrendingPatterns(feedback) {
    // Find similar existing feedback
    const similarFeedback = this.findSimilarFeedback(feedback);
    
    if (similarFeedback.length >= this.config.trendingThreshold) {
      const trendKey = this.generateTrendKey(feedback);
      
      if (!this.trendingIssues.has(trendKey)) {
        const trend = {
          id: trendKey,
          pattern: feedback.topics?.map(t => t.topic).join(',') || 'general',
          feedbackItems: [feedback, ...similarFeedback],
          severity: this.calculateTrendSeverity(feedback, similarFeedback),
          firstDetected: new Date(),
          lastUpdated: new Date()
        };
        
        this.trendingIssues.set(trendKey, trend);
        this.emit('trending_issue_detected', trend);
      } else {
        // Update existing trend
        const existingTrend = this.trendingIssues.get(trendKey);
        existingTrend.feedbackItems.push(feedback);
        existingTrend.lastUpdated = new Date();
        existingTrend.severity = this.calculateTrendSeverity(feedback, existingTrend.feedbackItems);
      }
    }
  }

  findSimilarFeedback(feedback, threshold = 0.3) {
    return this.feedbackQueue.filter(existingFeedback => {
      if (existingFeedback.id === feedback.id) return false;
      
      const similarity = this.semanticAnalyzer.calculateSimilarity(
        feedback.content,
        existingFeedback.content
      );
      
      return similarity > threshold;
    });
  }

  calculateTrendSeverity(feedback, similarFeedback) {
    const allFeedback = [feedback, ...similarFeedback];
    const avgSentiment = allFeedback.reduce((sum, fb) => sum + (fb.sentiment?.score || 0), 0) / allFeedback.length;
    const frequency = allFeedback.length;
    
    if (avgSentiment < -0.5 && frequency >= 10) return 'critical';
    if (avgSentiment < -0.3 && frequency >= 5) return 'high';
    if (avgSentiment < 0 && frequency >= 3) return 'medium';
    
    return 'low';
  }

  async generateRealTimeInsights(feedback) {
    const insights = [];
    
    // Performance insights
    if (feedback.responseContext?.responseTime > this.config.responseLatencyThreshold) {
      insights.push({
        type: 'performance',
        message: 'Response time exceeded threshold',
        data: {
          responseTime: feedback.responseContext.responseTime,
          threshold: this.config.responseLatencyThreshold
        },
        recommendations: [
          'Consider caching frequently requested content',
          'Optimize search algorithms',
          'Review system resource allocation'
        ]
      });
    }
    
    // Relevance insights
    if (feedback.responseContext?.relevanceScore < 0.5 && feedback.sentiment?.score < 0) {
      insights.push({
        type: 'relevance',
        message: 'Low relevance scores correlated with negative feedback',
        data: {
          relevanceScore: feedback.responseContext.relevanceScore,
          sentimentScore: feedback.sentiment.score
        },
        recommendations: [
          'Review search ranking algorithms',
          'Improve content matching criteria',
          'Enhance query understanding'
        ]
      });
    }
    
    // Content insights
    const contentTopics = feedback.topics?.filter(t => ['completeness', 'accuracy'].includes(t.topic));
    if (contentTopics?.length > 0 && feedback.sentiment?.score < 0) {
      insights.push({
        type: 'content_quality',
        message: 'Content quality issues detected',
        data: {
          topics: contentTopics,
          sentiment: feedback.sentiment
        },
        recommendations: [
          'Review source content quality',
          'Improve content validation processes',
          'Enhance fact-checking mechanisms'
        ]
      });
    }
    
    // Emit insights
    for (const insight of insights) {
      this.emit('insight_generated', insight);
    }
    
    return insights;
  }

  // Batch processing methods
  startProcessingLoop() {
    this.processingTimer = setInterval(() => {
      this.processBatch();
    }, this.config.processingInterval);
  }

  async processBatch() {
    if (this.feedbackQueue.length === 0) {
      return;
    }
    
    try {
      const batch = this.feedbackQueue.splice(0, this.config.batchSize);
      
      // Detect trends in batch
      const trends = this.trendDetector.detectTrends(batch);
      
      // Process each trend
      for (const trend of trends) {
        await this.processTrend(trend);
      }
      
      // Update patterns
      await this.updatePatterns(batch);
      
      this.emit('batch_processed', {
        batchSize: batch.length,
        trendsDetected: trends.length,
        timestamp: new Date()
      });
    } catch (error) {
      logger.error('Error processing feedback batch:', error);
    }
  }

  async updatePatterns(batch) {
    // Update feedback patterns based on batch analysis
    for (const feedback of batch) {
      // Create pattern for individual feedback item
      const pattern = {
        commonWords: feedback.content.toLowerCase().split(/\s+/).slice(0, 5),
        commonTopics: feedback.topics?.map(t => t.topic) || [],
        frequency: 1,
        avgSentiment: feedback.sentiment?.score || 0
      };
      
      const patternKey = this.generatePatternKey(pattern);
      this.feedbackPatterns.set(patternKey, pattern);
    }
  }

  async processTrend(trend) {
    const trendId = this.generateTrendId(trend);
    
    this.feedbackPatterns.set(trendId, {
      id: trendId,
      pattern: trend.pattern,
      items: trend.items,
      confidence: trend.similarity,
      detectedAt: new Date(),
      actionTaken: false
    });
    
    // Generate action recommendations
    const actions = await this.generateActionRecommendations(trend);
    
    this.emit('trend_processed', {
      trend,
      actions,
      timestamp: new Date()
    });
  }

  async generateActionRecommendations(trend) {
    const actions = [];
    
    // Analyze trend pattern
    if (trend.pattern?.avgSentiment < -0.5) {
      actions.push({
        type: 'urgent_review',
        priority: 'high',
        description: 'Multiple negative feedback items with similar patterns',
        recommendation: 'Immediate review and remediation required'
      });
    }
    
    if (trend.pattern?.commonTopics?.includes('speed')) {
      actions.push({
        type: 'performance_optimization',
        priority: 'medium',
        description: 'Performance concerns detected in multiple feedback items',
        recommendation: 'Review and optimize system performance'
      });
    }
    
    if (trend.pattern?.commonTopics?.includes('accuracy')) {
      actions.push({
        type: 'content_review',
        priority: 'high',
        description: 'Accuracy concerns detected across multiple items',
        recommendation: 'Review content sources and validation processes'
      });
    }
    
    return actions;
  }

  // Utility methods
  generateFeedbackId() {
    return `feedback_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  generateTrendKey(feedback) {
    const topics = feedback.topics?.map(t => t.topic).sort().join(',') || 'general';
    const sentiment = feedback.sentiment?.classification || 'neutral';
    return `${topics}_${sentiment}`;
  }

  generateTrendId(_trend) {
    return `trend_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  generatePatternKey(pattern) {
    const typeKey = pattern.commonTopics?.join('_') || 'general';
    return `pattern_${typeKey}_${Date.now()}`;
  }

  updatePerformanceMetrics(processingTime) {
    const currentTotal = this.performanceMetrics.totalProcessed;
    this.performanceMetrics.totalProcessed++;
    
    // Calculate proper running average
    this.performanceMetrics.averageResponseTime = 
      (this.performanceMetrics.averageResponseTime * currentTotal + processingTime) / this.performanceMetrics.totalProcessed;
  }

  findCommonWords(texts) {
    const wordCounts = new Map();
    
    texts.forEach(text => {
      const words = text.toLowerCase().split(/\s+/);
      words.forEach(word => {
        wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
      });
    });
    
    return Array.from(wordCounts.entries())
      .filter(([_word, count]) => count > 1)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([word]) => word);
  }

  findCommonTopics(items) {
    const topicCounts = new Map();
    
    items.forEach(item => {
      if (item.topics) {
        item.topics.forEach(topic => {
          topicCounts.set(topic.topic, (topicCounts.get(topic.topic) || 0) + 1);
        });
      }
    });
    
    return Array.from(topicCounts.entries())
      .filter(([_topic, count]) => count > 1)
      .sort((a, b) => b[1] - a[1])
      .map(([topic]) => topic);
  }

  // Query methods
  getFeedbackPatterns() {
    return Array.from(this.feedbackPatterns.values());
  }

  getTrendingIssues() {
    return Array.from(this.trendingIssues.values());
  }

  getPerformanceMetrics() {
    return {
      ...this.performanceMetrics,
      queueLength: this.feedbackQueue.length,
      patternsDetected: this.feedbackPatterns.size,
      trendingIssues: this.trendingIssues.size
    };
  }

  getStatus() {
    return {
      initialized: this.isInitialized,
      processingEnabled: this.config.enableRealTimeProcessing,
      queueLength: this.feedbackQueue.length,
      metrics: this.getPerformanceMetrics(),
      config: {
        batchSize: this.config.batchSize,
        processingInterval: this.config.processingInterval,
        trendingThreshold: this.config.trendingThreshold
      }
    };
  }

  async shutdown() {
    try {
      logger.info('Shutting down Feedback Processor...');
      
      if (this.processingTimer) {
        clearInterval(this.processingTimer);
      }
      
      // Process remaining queue
      if (this.feedbackQueue.length > 0) {
        await this.processBatch();
      }
      
      this.isInitialized = false;
      logger.info('Feedback Processor shutdown complete');
    } catch (error) {
      logger.error('Error during Feedback Processor shutdown:', error);
      throw error;
    }
  }
}

module.exports = FeedbackProcessor;