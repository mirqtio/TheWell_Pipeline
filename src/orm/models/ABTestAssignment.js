module.exports = (sequelize, DataTypes) => {
  const ABTestAssignment = sequelize.define('ABTestAssignment', {
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
  testId: {
    type: DataTypes.STRING(100),
    allowNull: false,
    field: 'test_id'
  },
  groupId: {
    type: DataTypes.STRING(50),
    allowNull: false,
    field: 'group_id'
  },
  algorithm: {
    type: DataTypes.STRING(50),
    allowNull: false
  },
  timestamp: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'ab_test_assignments',
  timestamps: false,
  indexes: [
    {
      unique: true,
      fields: ['user_id', 'test_id']
    }
  ]
});

  return ABTestAssignment;
};