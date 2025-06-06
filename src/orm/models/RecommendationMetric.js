module.exports = (sequelize, DataTypes) => {
  const RecommendationMetric = sequelize.define('RecommendationMetric', {
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
  algorithm: {
    type: DataTypes.STRING(50),
    allowNull: false
  },
  recommendationCount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'recommendation_count'
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
  tableName: 'recommendation_metrics',
  timestamps: false
});

  return RecommendationMetric;
};