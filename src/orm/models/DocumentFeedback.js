/**
 * DocumentFeedback Model - ORM representation of document_feedback table
 */
module.exports = (sequelize, DataTypes) => {
  const DocumentFeedback = sequelize.define('DocumentFeedback', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    documentId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'document_id',
      references: {
        model: 'documents',
        key: 'id'
      }
    },
    feedbackType: {
      type: DataTypes.STRING(50),
      allowNull: false,
      field: 'feedback_type',
      validate: {
        isIn: [['rating', 'relevance', 'accuracy', 'quality', 'usefulness', 'comment']]
      }
    },
    rating: {
      type: DataTypes.INTEGER,
      validate: {
        min: 1,
        max: 5
      }
    },
    comment: {
      type: DataTypes.TEXT
    },
    userId: {
      type: DataTypes.STRING(255),
      field: 'user_id'
    },
    sessionId: {
      type: DataTypes.STRING(255),
      field: 'session_id'
    },
    context: {
      type: DataTypes.JSONB,
      defaultValue: {},
      validate: {
        isValidContext(value) {
          if (typeof value !== 'object' || value === null) {
            throw new Error('Context must be a valid JSON object');
          }
        }
      }
    },
    metadata: {
      type: DataTypes.JSONB,
      defaultValue: {}
    },
    createdAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
      field: 'created_at'
    }
  }, {
    tableName: 'document_feedback',
    timestamps: false,
    indexes: [
      {
        fields: ['document_id']
      },
      {
        fields: ['feedback_type']
      },
      {
        fields: ['rating']
      },
      {
        fields: ['user_id']
      },
      {
        fields: ['session_id']
      },
      {
        fields: ['created_at']
      }
    ]
  });

  // Instance methods
  DocumentFeedback.prototype.isPositive = function() {
    return this.rating && this.rating >= 4;
  };

  DocumentFeedback.prototype.isNegative = function() {
    return this.rating && this.rating <= 2;
  };

  DocumentFeedback.prototype.hasComment = function() {
    return this.comment && this.comment.trim().length > 0;
  };

  // Class methods
  DocumentFeedback.findByDocument = function(documentId) {
    return this.findAll({
      where: { documentId },
      order: [['createdAt', 'DESC']]
    });
  };

  DocumentFeedback.findByUser = function(userId) {
    return this.findAll({
      where: { userId },
      order: [['createdAt', 'DESC']]
    });
  };

  DocumentFeedback.findByType = function(feedbackType) {
    return this.findAll({
      where: { feedbackType },
      order: [['createdAt', 'DESC']]
    });
  };

  DocumentFeedback.getAverageRating = async function(documentId, feedbackType = null) {
    const where = { 
      documentId,
      rating: { [sequelize.Sequelize.Op.not]: null }
    };
    
    if (feedbackType) {
      where.feedbackType = feedbackType;
    }

    const result = await this.findOne({
      attributes: [[sequelize.fn('AVG', sequelize.col('rating')), 'avgRating']],
      where,
      raw: true
    });
    
    return result.avgRating ? parseFloat(result.avgRating) : null;
  };

  DocumentFeedback.getFeedbackStats = async function(documentId) {
    const stats = await this.findAll({
      where: { documentId },
      attributes: [
        'feedback_type',
        [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
        [sequelize.fn('AVG', sequelize.col('rating')), 'avgRating']
      ],
      group: ['feedback_type'],
      raw: true
    });

    const result = {};
    stats.forEach(stat => {
      result[stat.feedback_type] = {
        count: parseInt(stat.count),
        avgRating: stat.avgRating ? parseFloat(stat.avgRating) : null
      };
    });

    return result;
  };

  DocumentFeedback.recordFeedback = function(documentId, feedbackType, options = {}) {
    return this.create({
      documentId,
      feedbackType,
      rating: options.rating,
      comment: options.comment,
      userId: options.userId,
      sessionId: options.sessionId,
      context: options.context || {},
      metadata: options.metadata || {}
    });
  };

  return DocumentFeedback;
};
