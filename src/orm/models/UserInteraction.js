module.exports = (sequelize, DataTypes) => {
  const UserInteraction = sequelize.define('UserInteraction', {
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
  action: {
    type: DataTypes.STRING(50),
    allowNull: false
  },
  rating: {
    type: DataTypes.INTEGER,
    validate: {
      min: 1,
      max: 5
    }
  },
  duration: {
    type: DataTypes.INTEGER,
    comment: 'Time spent in seconds'
  },
  metadata: {
    type: DataTypes.JSONB,
    defaultValue: {}
  },
  timestamp: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  createdAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    field: 'created_at'
  }
}, {
  tableName: 'user_interactions',
  timestamps: false,
  indexes: [
    {
      unique: true,
      fields: ['user_id', 'document_id', 'action', 'timestamp']
    }
  ]
});

  return UserInteraction;
};