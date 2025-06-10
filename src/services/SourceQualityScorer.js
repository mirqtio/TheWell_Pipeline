/**
 * Source Quality Scorer
 * Implements believability weighting and source reliability calculation algorithms
 */

const logger = require('../utils/logger');

class SourceQualityScorer {
  constructor(config = {}) {
    this.config = {
      baselineWeight: 0.5,
      decayRate: 0.1,
      minWeight: 0.1,
      maxWeight: 1.0,
      historicalPeriodDays: 30,
      uptimeWeight: 0.3,
      responseTimeWeight: 0.2,
      feedbackWeight: 0.4,
      freshnessWeight: 0.1,
      lengthOptimal: 800, // Optimal word count
      responseTimeOptimal: 1000, // Optimal response time in ms
      ...config
    };

    logger.info('SourceQualityScorer initialized', { config: this.config });
  }

  /**
   * Calculate believability weight for a source based on historical performance
   * @param {Object} sourceMetrics - Source performance metrics
   * @returns {number} Believability weight between minWeight and maxWeight
   */
  calculateBelievabilityWeight(sourceMetrics) {
    const {
      totalFeedbacks = 0,
      positiveFeedbacks = 0,
      negativeFeedbacks = 0,
      avgResponseTime = 1000,
      uptime = 100,
      lastFailureTime = null
    } = sourceMetrics;

    // Start with baseline weight for new sources
    if (totalFeedbacks === 0) {
      return this.config.baselineWeight;
    }

    // Calculate feedback ratio
    const positiveRatio = totalFeedbacks > 0 ? positiveFeedbacks / totalFeedbacks : 0;
    const feedbackScore = positiveRatio;

    // Calculate uptime score (normalized to 0-1)
    const uptimeScore = Math.max(0, Math.min(1, uptime / 100));

    // Calculate response time score (inverse relationship, normalized)
    const responseTimeScore = Math.max(0, Math.min(1, 
      this.config.responseTimeOptimal / Math.max(avgResponseTime, 100)
    ));

    // Calculate recency penalty if there was a recent failure
    let recencyPenalty = 0;
    if (lastFailureTime) {
      const timeSinceFailure = Date.now() - new Date(lastFailureTime).getTime();
      const hoursSinceFailure = timeSinceFailure / (1000 * 60 * 60);
      // Penalty decreases exponentially over 24 hours
      recencyPenalty = Math.exp(-hoursSinceFailure / 24) * 0.2;
    }

    // Weighted combination of factors
    const combinedScore = (
      feedbackScore * this.config.feedbackWeight +
      uptimeScore * this.config.uptimeWeight +
      responseTimeScore * this.config.responseTimeWeight
    ) - recencyPenalty;

    // Apply decay factor for very negative sources
    const decayFactor = negativeFeedbacks > positiveFeedbacks ? 
      Math.exp(-this.config.decayRate * (negativeFeedbacks - positiveFeedbacks)) : 1;

    const finalWeight = combinedScore * decayFactor;

    // Clamp to configured bounds
    return Math.max(this.config.minWeight, 
      Math.min(this.config.maxWeight, finalWeight));
  }

  /**
   * Calculate reliability score based on operational metrics
   * @param {Object} metrics - Operational metrics
   * @returns {number} Reliability score between 0 and 1
   */
  calculateReliabilityScore(metrics) {
    const {
      uptime = 100,
      avgResponseTime = 1000,
      errorRate = 0,
      lastFailureTime = null,
      consecutiveSuccesses = 0,
      mtbf = null // Mean Time Between Failures in hours
    } = metrics;

    // Uptime score (direct mapping)
    const uptimeScore = Math.max(0, Math.min(1, uptime / 100));

    // Response time score (inverse relationship)
    const responseTimeScore = Math.max(0, Math.min(1,
      this.config.responseTimeOptimal / Math.max(avgResponseTime, 100)
    ));

    // Error rate score (inverse relationship)
    const errorRateScore = Math.max(0, Math.min(1, 1 - (errorRate / 100)));

    // Consecutive successes score (logarithmic scale)
    const successScore = Math.min(1, Math.log10(consecutiveSuccesses + 1) / 2);

    // MTBF score (if available)
    let mtbfScore = 0.5; // Default neutral score
    if (mtbf !== null && mtbf > 0) {
      // Higher MTBF is better, normalize to reasonable scale
      mtbfScore = Math.min(1, Math.log10(mtbf + 1) / 3);
    }

    // Recency factor for last failure
    let recencyFactor = 1;
    if (lastFailureTime) {
      const timeSinceFailure = Date.now() - new Date(lastFailureTime).getTime();
      const hoursSinceFailure = timeSinceFailure / (1000 * 60 * 60);
      // Recent failures impact reliability more
      recencyFactor = Math.min(1, hoursSinceFailure / 48); // Full recovery after 48 hours
    }

    // Weighted combination
    const reliabilityScore = (
      uptimeScore * 0.3 +
      responseTimeScore * 0.25 +
      errorRateScore * 0.25 +
      successScore * 0.1 +
      mtbfScore * 0.1
    ) * recencyFactor;

    return Math.max(0, Math.min(1, reliabilityScore));
  }

  /**
   * Analyze content quality factors
   * @param {Object} content - Content to analyze
   * @returns {Object} Quality analysis results
   */
  analyzeContentQuality(content) {
    const { text = '', metadata = {} } = content;
    
    // Length score (optimal around 800 words)
    const wordCount = metadata.wordCount || text.split(/\s+/).length;
    const lengthScore = this._calculateLengthScore(wordCount);

    // Readability score (if available)
    const readabilityScore = metadata.readabilityScore ? 
      Math.max(0, Math.min(1, metadata.readabilityScore / 100)) : 0.5;

    // Freshness score based on publication date
    const freshnessScore = this._calculateFreshnessScore(metadata.publicationDate);

    // Credibility score based on author and references
    const credibilityScore = this._calculateCredibilityScore(metadata);

    // Structure score based on content organization
    const structureScore = this._calculateStructureScore(text);

    // Overall quality (weighted combination)
    const overallQuality = (
      lengthScore * 0.2 +
      readabilityScore * 0.2 +
      freshnessScore * 0.15 +
      credibilityScore * 0.25 +
      structureScore * 0.2
    );

    return {
      lengthScore,
      readabilityScore,
      freshnessScore,
      credibilityScore,
      structureScore,
      overallQuality
    };
  }

  /**
   * Score content from a specific source
   * @param {Object} content - Content to score
   * @param {Object} sourceMetrics - Source metrics
   * @returns {Promise<Object>} Complete scoring result
   */
  async scoreSourceContent(content, sourceMetrics) {
    try {
      const believabilityWeight = this.calculateBelievabilityWeight(sourceMetrics);
      const reliabilityScore = this.calculateReliabilityScore(sourceMetrics);
      const contentQuality = this.analyzeContentQuality(content);

      // Calculate overall score weighted by source reliability
      const overallScore = (
        contentQuality.overallQuality * 0.6 +
        reliabilityScore * 0.25 +
        believabilityWeight * 0.15
      );

      const result = {
        sourceId: content.sourceId || sourceMetrics.sourceId,
        believabilityWeight,
        reliabilityScore,
        contentQuality,
        overallScore,
        timestamp: new Date().toISOString(),
        factors: {
          sourceReliability: reliabilityScore,
          contentAnalysis: contentQuality.overallQuality,
          historicalPerformance: believabilityWeight
        }
      };

      logger.debug('Content scored', {
        sourceId: result.sourceId,
        overallScore: result.overallScore,
        believabilityWeight,
        reliabilityScore
      });

      return result;
    } catch (error) {
      logger.error('Error scoring source content', {
        sourceId: content.sourceId || sourceMetrics.sourceId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Update source metrics with new feedback
   * @param {Object} currentMetrics - Current source metrics
   * @param {Object} feedback - New feedback data
   * @returns {Object} Updated metrics
   */
  updateSourceMetrics(currentMetrics, feedback) {
    const updated = { ...currentMetrics };
    
    updated.totalFeedbacks = (updated.totalFeedbacks || 0) + 1;
    
    if (feedback.type === 'positive') {
      updated.positiveFeedbacks = (updated.positiveFeedbacks || 0) + 1;
      updated.consecutiveSuccesses = (updated.consecutiveSuccesses || 0) + 1;
    } else if (feedback.type === 'negative') {
      updated.negativeFeedbacks = (updated.negativeFeedbacks || 0) + 1;
      updated.errorCount = (updated.errorCount || 0) + 1;
      updated.consecutiveSuccesses = 0;
      updated.lastFailureTime = feedback.timestamp || new Date();
    }

    // Update average response time if provided
    if (feedback.responseTime && !isNaN(feedback.responseTime)) {
      const currentTotal = (updated.avgResponseTime || 1000) * Math.max(1, updated.totalFeedbacks - 1);
      updated.avgResponseTime = (currentTotal + feedback.responseTime) / updated.totalFeedbacks;
    }

    // Update error rate
    const totalAttempts = updated.totalFeedbacks;
    updated.errorRate = totalAttempts > 0 ? (updated.errorCount || 0) / totalAttempts * 100 : 0;

    return updated;
  }

  /**
   * Get ranking of sources by quality score
   * @param {Array} sources - Array of sources with metrics
   * @returns {Promise<Array>} Ranked sources
   */
  async getSourceRanking(sources) {
    if (!sources || sources.length === 0) {
      return [];
    }

    const scoredSources = [];
    
    for (const source of sources) {
      try {
        const believabilityWeight = this.calculateBelievabilityWeight(source.metrics);
        const reliabilityScore = this.calculateReliabilityScore(source.metrics);
        
        // Combined score for ranking
        const score = reliabilityScore * 0.6 + believabilityWeight * 0.4;
        
        scoredSources.push({
          sourceId: source.sourceId,
          score,
          believabilityWeight,
          reliabilityScore
        });
      } catch (error) {
        logger.warn('Error scoring source for ranking', {
          sourceId: source.sourceId,
          error: error.message
        });
        
        // Add with minimum score to avoid exclusion
        scoredSources.push({
          sourceId: source.sourceId,
          score: 0,
          believabilityWeight: this.config.minWeight,
          reliabilityScore: 0
        });
      }
    }

    // Sort by score (highest first)
    return scoredSources.sort((a, b) => b.score - a.score);
  }

  /**
   * Calculate historical trend for a source
   * @param {Array} historicalData - Array of {timestamp, score} objects
   * @returns {Object} Trend analysis
   */
  calculateHistoricalTrend(historicalData) {
    if (!historicalData || historicalData.length < 2) {
      return {
        direction: 'insufficient_data',
        slope: 0,
        confidence: 0,
        dataPoints: historicalData ? historicalData.length : 0
      };
    }

    // Sort by timestamp
    const sortedData = historicalData.sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    // Calculate linear regression
    const n = sortedData.length;
    const x = sortedData.map((_, i) => i); // Time index
    const y = sortedData.map(d => d.score);

    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
    const sumXX = x.reduce((sum, xi) => sum + xi * xi, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    // Calculate R-squared for confidence
    const yMean = sumY / n;
    const ssTotal = y.reduce((sum, yi) => sum + Math.pow(yi - yMean, 2), 0);
    const ssResidual = y.reduce((sum, yi, i) => {
      const predicted = slope * x[i] + intercept;
      return sum + Math.pow(yi - predicted, 2);
    }, 0);
    
    const rSquared = 1 - (ssResidual / ssTotal);
    
    // Determine direction
    let direction;
    if (Math.abs(slope) < 0.005) {
      direction = 'stable';
    } else if (slope > 0) {
      direction = 'improving';
    } else {
      direction = 'declining';
    }

    return {
      direction,
      slope,
      confidence: Math.max(0, Math.min(1, rSquared)),
      dataPoints: n,
      timespan: {
        start: sortedData[0].timestamp,
        end: sortedData[n - 1].timestamp
      }
    };
  }

  // Private helper methods

  _calculateLengthScore(wordCount) {
    const optimal = this.config.lengthOptimal;
    if (wordCount <= 0) return 0;
    
    if (wordCount <= optimal) {
      // Linear increase up to optimal
      return wordCount / optimal;
    } else {
      // Gradual decrease after optimal, but don't penalize too heavily
      const excess = wordCount - optimal;
      return Math.max(0.1, 1 - (excess / (optimal * 3)));
    }
  }

  _calculateFreshnessScore(publicationDate) {
    if (!publicationDate) return 0.5; // Neutral score for unknown date
    
    const now = Date.now();
    const pubTime = new Date(publicationDate).getTime();
    const ageMs = now - pubTime;
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    
    if (ageDays < 0) return 0.9; // Future date (likely error, but don't penalize heavily)
    if (ageDays <= 1) return 1.0; // Very fresh
    if (ageDays <= 7) return 0.9; // Recent
    if (ageDays <= 30) return 0.8; // Fairly recent
    if (ageDays <= 90) return 0.6; // Somewhat dated
    if (ageDays <= 365) return 0.4; // Old
    
    return Math.max(0.1, 0.4 * Math.exp(-(ageDays - 365) / 365)); // Very old
  }

  _calculateCredibilityScore(metadata) {
    let score = 0.5; // Base score
    
    // Author credibility
    if (metadata.authorCredibility) {
      score = metadata.authorCredibility;
    }
    
    // References boost credibility
    if (metadata.hasReferences) {
      score = Math.min(1.0, score + 0.2);
    }
    
    // Publication type influences credibility
    if (metadata.contentType) {
      switch (metadata.contentType.toLowerCase()) {
      case 'academic':
      case 'research':
        score = Math.min(1.0, score + 0.1);
        break;
      case 'news':
      case 'journalism':
        score = Math.min(1.0, score + 0.05);
        break;
      case 'blog':
      case 'opinion':
        score = Math.max(0.1, score - 0.1);
        break;
      }
    }
    
    return Math.max(0.1, Math.min(1.0, score));
  }

  _calculateStructureScore(text) {
    if (!text || text.length === 0) return 0;
    
    let score = 0.5; // Base score
    
    // Check for paragraph structure
    const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
    if (paragraphs.length > 1) {
      score += 0.1;
    }
    
    // Check for sentence variety
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const avgSentenceLength = text.length / sentences.length;
    if (avgSentenceLength > 10 && avgSentenceLength < 150) {
      score += 0.1;
    }
    
    // Check for structural indicators (headers, lists, etc.)
    if (/^\s*[-*+]\s+/m.test(text) || /^\s*\d+\.\s+/m.test(text)) {
      score += 0.1; // Has lists
    }
    
    if (/^#+\s+/m.test(text)) {
      score += 0.1; // Has headers (markdown style)
    }
    
    return Math.max(0.1, Math.min(1.0, score));
  }
}

module.exports = SourceQualityScorer;