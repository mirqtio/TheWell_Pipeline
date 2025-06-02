/**
 * FeedbackAggregate Model - ORM representation of feedback_aggregates table
 */
module.exports = (sequelize, DataTypes) => {
  const FeedbackAggregate = sequelize.define('FeedbackAggregate', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    documentId: {
      type: DataTypes.UUID,
      allowNull: false,
      unique: true,
      field: 'document_id',
      references: {
        model: 'documents',
        key: 'id'
      }
    },
    totalFeedback: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      field: 'total_feedback',
      validate: {
        min: 0
      }
    },
    averageRating: {
      type: DataTypes.DECIMAL(3, 2),
      field: 'average_rating',
      validate: {
        min: 1.0,
        max: 5.0
      }
    },
    ratingDistribution: {
      type: DataTypes.JSONB,
      field: 'rating_distribution',
      defaultValue: { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 },
      validate: {
        isValidDistribution(value) {
          if (typeof value !== 'object' || value === null) {
            throw new Error('Rating distribution must be a valid JSON object');
          }
        }
      }
    },
    feedbackByType: {
      type: DataTypes.JSONB,
      field: 'feedback_by_type',
      defaultValue: {},
      validate: {
        isValidFeedbackByType(value) {
          if (typeof value !== 'object' || value === null) {
            throw new Error('Feedback by type must be a valid JSON object');
          }
        }
      }
    },
    positiveCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      field: 'positive_count',
      validate: {
        min: 0
      }
    },
    negativeCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      field: 'negative_count',
      validate: {
        min: 0
      }
    },
    neutralCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      field: 'neutral_count',
      validate: {
        min: 0
      }
    },
    lastUpdated: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
      field: 'last_updated'
    },
    createdAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
      field: 'created_at'
    }
  }, {
    tableName: 'feedback_aggregates',
    timestamps: false,
    indexes: [
      {
        fields: ['document_id']
      },
      {
        fields: ['average_rating']
      },
      {
        fields: ['total_feedback']
      },
      {
        fields: ['last_updated']
      }
    ]
  });

  // Instance methods
  FeedbackAggregate.prototype.updateAggregates = async function() {
    const DocumentFeedback = sequelize.models.DocumentFeedback;
    
    // Get all feedback for this document
    const feedback = await DocumentFeedback.findByDocument(this.documentId);
    
    // Reset counters
    this.totalFeedback = feedback.length;
    this.positiveCount = 0;
    this.negativeCount = 0;
    this.neutralCount = 0;
    
    const ratingDistribution = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
    const feedbackByType = {};
    
    let totalRating = 0;
    let ratingCount = 0;
    
    feedback.forEach(fb => {
      // Count by rating
      if (fb.rating) {
        ratingDistribution[fb.rating.toString()]++;
        totalRating += fb.rating;
        ratingCount++;
        
        if (fb.rating >= 4) this.positiveCount++;
        else if (fb.rating <= 2) this.negativeCount++;
        else this.neutralCount++;
      }
      
      // Count by type
      if (!feedbackByType[fb.feedbackType]) {
        feedbackByType[fb.feedbackType] = { count: 0, avgRating: null };
      }
      feedbackByType[fb.feedbackType].count++;
    });
    
    // Calculate averages by type
    for (const type of Object.keys(feedbackByType)) {
      const typeFeedback = feedback.filter(fb => fb.feedbackType === type && fb.rating);
      if (typeFeedback.length > 0) {
        const typeTotal = typeFeedback.reduce((sum, fb) => sum + fb.rating, 0);
        feedbackByType[type].avgRating = typeTotal / typeFeedback.length;
      }
    }
    
    this.averageRating = ratingCount > 0 ? totalRating / ratingCount : null;
    this.ratingDistribution = ratingDistribution;
    this.feedbackByType = feedbackByType;
    this.lastUpdated = new Date();
    
    return this.save();
  };

  FeedbackAggregate.prototype.getPositivePercentage = function() {
    if (this.totalFeedback === 0) return 0;
    return (this.positiveCount / this.totalFeedback) * 100;
  };

  FeedbackAggregate.prototype.getNegativePercentage = function() {
    if (this.totalFeedback === 0) return 0;
    return (this.negativeCount / this.totalFeedback) * 100;
  };

  FeedbackAggregate.prototype.getSentimentScore = function() {
    if (this.totalFeedback === 0) return 0;
    return (this.positiveCount - this.negativeCount) / this.totalFeedback;
  };

  // Class methods
  FeedbackAggregate.findByDocument = function(documentId) {
    return this.findOne({
      where: { documentId }
    });
  };

  FeedbackAggregate.findTopRated = function(limit = 10) {
    return this.findAll({
      where: {
        averageRating: { [sequelize.Sequelize.Op.not]: null },
        totalFeedback: { [sequelize.Sequelize.Op.gte]: 3 } // Minimum feedback threshold
      },
      order: [['averageRating', 'DESC'], ['totalFeedback', 'DESC']],
      limit
    });
  };

  FeedbackAggregate.findMostFeedback = function(limit = 10) {
    return this.findAll({
      where: {
        totalFeedback: { [sequelize.Sequelize.Op.gt]: 0 }
      },
      order: [['totalFeedback', 'DESC']],
      limit
    });
  };

  FeedbackAggregate.updateOrCreateForDocument = async function(documentId) {
    let aggregate = await this.findByDocument(documentId);
    
    if (!aggregate) {
      aggregate = await this.create({ documentId });
    }
    
    await aggregate.updateAggregates();
    return aggregate;
  };

  return FeedbackAggregate;
};
