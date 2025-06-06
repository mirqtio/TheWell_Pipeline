module.exports = (sequelize, DataTypes) => {
  const RecommendationFeedback = sequelize.define('RecommendationFeedback', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    userId: {
      type: DataTypes.STRING(255),
      allowNull: false,
      field: 'user_id'
    },
    documentId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'document_id',
      references: {
        model: 'documents',
        key: 'id'
      }
    },
    feedback: {
      type: DataTypes.STRING(50),
      allowNull: false,
      comment: 'positive, negative, click, dismiss'
    },
    algorithm: {
      type: DataTypes.STRING(50)
    },
    position: {
      type: DataTypes.INTEGER,
      comment: 'Position in recommendation list'
    },
    metadata: {
      type: DataTypes.JSONB,
      defaultValue: {}
    },
    timestamp: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    }
  }, {
    tableName: 'recommendation_feedback',
    timestamps: false
  });

  return RecommendationFeedback;
};