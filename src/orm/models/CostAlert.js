/**
 * CostAlert Model - ORM representation of cost_alerts table
 */
module.exports = (sequelize, DataTypes) => {
  const CostAlert = sequelize.define('CostAlert', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    budgetId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'budget_id',
      references: {
        model: 'cost_budgets',
        key: 'id'
      }
    },
    alertType: {
      type: DataTypes.STRING(50),
      allowNull: false,
      field: 'alert_type',
      validate: {
        isIn: [['threshold', 'overspend', 'projection', 'anomaly']]
      }
    },
    threshold: {
      type: DataTypes.INTEGER,
      validate: {
        min: 0,
        max: 100
      }
    },
    currentSpend: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      field: 'current_spend'
    },
    budgetAmount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      field: 'budget_amount'
    },
    percentage: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: false
    },
    message: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    severity: {
      type: DataTypes.STRING(20),
      defaultValue: 'medium',
      validate: {
        isIn: [['low', 'medium', 'high', 'critical']]
      }
    },
    isRead: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      field: 'is_read'
    },
    readAt: {
      type: DataTypes.DATE,
      field: 'read_at'
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
    tableName: 'cost_alerts',
    timestamps: false,
    indexes: [
      {
        fields: ['budget_id']
      },
      {
        fields: ['alert_type']
      },
      {
        fields: ['severity']
      },
      {
        fields: ['is_read']
      },
      {
        fields: ['created_at']
      }
    ]
  });

  // Instance methods
  CostAlert.prototype.markAsRead = async function() {
    this.isRead = true;
    this.readAt = new Date();
    return this.save();
  };

  CostAlert.prototype.isCritical = function() {
    return this.severity === 'critical';
  };

  CostAlert.prototype.isHigh = function() {
    return this.severity === 'high';
  };

  // Class methods
  CostAlert.findUnread = function() {
    return this.findAll({
      where: { isRead: false },
      order: [['severity', 'DESC'], ['createdAt', 'DESC']]
    });
  };

  CostAlert.findByBudget = function(budgetId) {
    return this.findAll({
      where: { budgetId },
      order: [['createdAt', 'DESC']]
    });
  };

  CostAlert.findBySeverity = function(severity) {
    return this.findAll({
      where: { severity },
      order: [['createdAt', 'DESC']]
    });
  };

  CostAlert.createThresholdAlert = function(budgetId, threshold, currentSpend, budgetAmount) {
    const percentage = (currentSpend / budgetAmount) * 100;
    let severity = 'medium';
    
    if (percentage >= 100) severity = 'critical';
    else if (percentage >= 80) severity = 'high';
    else if (percentage >= 50) severity = 'medium';
    else severity = 'low';

    const message = `Budget threshold of ${threshold}% exceeded. Current spend: $${currentSpend} (${percentage.toFixed(1)}% of $${budgetAmount})`;

    return this.create({
      budgetId,
      alertType: 'threshold',
      threshold,
      currentSpend,
      budgetAmount,
      percentage,
      message,
      severity
    });
  };

  return CostAlert;
};
