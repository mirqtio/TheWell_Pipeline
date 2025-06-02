/**
 * CostBudget Model - ORM representation of cost_budgets table
 */
module.exports = (sequelize, DataTypes) => {
  const CostBudget = sequelize.define('CostBudget', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    name: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: true
    },
    description: {
      type: DataTypes.TEXT
    },
    budgetAmount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      field: 'budget_amount',
      validate: {
        min: 0
      }
    },
    currency: {
      type: DataTypes.STRING(3),
      defaultValue: 'USD'
    },
    period: {
      type: DataTypes.STRING(20),
      allowNull: false,
      validate: {
        isIn: [['daily', 'weekly', 'monthly', 'quarterly', 'yearly']]
      }
    },
    startDate: {
      type: DataTypes.DATE,
      allowNull: false,
      field: 'start_date'
    },
    endDate: {
      type: DataTypes.DATE,
      field: 'end_date'
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      field: 'is_active'
    },
    alertThresholds: {
      type: DataTypes.ARRAY(DataTypes.INTEGER),
      field: 'alert_thresholds',
      defaultValue: [50, 80, 100],
      validate: {
        isValidThresholds(value) {
          if (!Array.isArray(value)) {
            throw new Error('Alert thresholds must be an array');
          }
          if (value.some(t => t < 0 || t > 100)) {
            throw new Error('Alert thresholds must be between 0 and 100');
          }
        }
      }
    },
    createdAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
      field: 'created_at'
    },
    updatedAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
      field: 'updated_at'
    }
  }, {
    tableName: 'cost_budgets',
    timestamps: false,
    indexes: [
      {
        fields: ['name']
      },
      {
        fields: ['is_active']
      },
      {
        fields: ['period']
      },
      {
        fields: ['start_date']
      },
      {
        fields: ['end_date']
      }
    ],
    hooks: {
      beforeUpdate: (budget) => {
        budget.updatedAt = new Date();
      }
    }
  });

  // Instance methods
  CostBudget.prototype.isCurrentlyActive = function() {
    const now = new Date();
    return this.isActive && 
           this.startDate <= now && 
           (!this.endDate || this.endDate >= now);
  };

  CostBudget.prototype.getCurrentSpend = async function() {
    const CostEvent = sequelize.models.CostEvent;
    const now = new Date();
    
    let startDate = this.startDate;
    let endDate = this.endDate || now;
    
    // Adjust date range based on period
    if (this.period === 'monthly') {
      const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      startDate = currentMonth > this.startDate ? currentMonth : this.startDate;
      endDate = now;
    }
    
    return await CostEvent.getTotalCost(startDate, endDate);
  };

  CostBudget.prototype.getSpendPercentage = async function() {
    const currentSpend = await this.getCurrentSpend();
    return (currentSpend / parseFloat(this.budgetAmount)) * 100;
  };

  CostBudget.prototype.checkThresholds = async function() {
    const percentage = await this.getSpendPercentage();
    const triggeredThresholds = this.alertThresholds.filter(threshold => percentage >= threshold);
    return triggeredThresholds;
  };

  // Class methods
  CostBudget.findActive = function() {
    const now = new Date();
    return this.findAll({
      where: {
        isActive: true,
        startDate: { [sequelize.Sequelize.Op.lte]: now },
        [sequelize.Sequelize.Op.or]: [
          { endDate: null },
          { endDate: { [sequelize.Sequelize.Op.gte]: now } }
        ]
      }
    });
  };

  return CostBudget;
};
