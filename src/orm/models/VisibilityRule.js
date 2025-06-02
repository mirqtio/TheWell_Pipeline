/**
 * VisibilityRule Model - ORM representation of visibility_rules table
 */
module.exports = (sequelize, DataTypes) => {
  const VisibilityRule = sequelize.define('VisibilityRule', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    name: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: true,
      validate: {
        notEmpty: true,
        len: [1, 255]
      }
    },
    description: {
      type: DataTypes.TEXT
    },
    conditions: {
      type: DataTypes.JSONB,
      allowNull: false,
      validate: {
        isValidConditions(value) {
          if (typeof value !== 'object' || value === null) {
            throw new Error('Conditions must be a valid JSON object');
          }
        }
      }
    },
    actions: {
      type: DataTypes.JSONB,
      allowNull: false,
      validate: {
        isValidActions(value) {
          if (typeof value !== 'object' || value === null) {
            throw new Error('Actions must be a valid JSON object');
          }
        }
      }
    },
    priority: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      validate: {
        min: -100,
        max: 100
      }
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      field: 'is_active'
    },
    createdBy: {
      type: DataTypes.STRING(255),
      field: 'created_by'
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
    tableName: 'visibility_rules',
    timestamps: false,
    indexes: [
      {
        fields: ['name']
      },
      {
        fields: ['is_active']
      },
      {
        fields: ['priority']
      },
      {
        fields: ['created_by']
      }
    ],
    hooks: {
      beforeUpdate: (rule) => {
        rule.updatedAt = new Date();
      }
    }
  });

  // Instance methods
  VisibilityRule.prototype.activate = async function() {
    this.isActive = true;
    this.updatedAt = new Date();
    return this.save();
  };

  VisibilityRule.prototype.deactivate = async function() {
    this.isActive = false;
    this.updatedAt = new Date();
    return this.save();
  };

  VisibilityRule.prototype.evaluateConditions = function(document) {
    // Basic condition evaluation logic
    // This would be expanded based on specific business rules
    try {
      const conditions = this.conditions;
      
      // Example condition checks
      if (conditions.sourceType && document.source?.type !== conditions.sourceType) {
        return false;
      }
      
      if (conditions.contentType && document.contentType !== conditions.contentType) {
        return false;
      }
      
      if (conditions.minWordCount && document.wordCount < conditions.minWordCount) {
        return false;
      }
      
      if (conditions.maxWordCount && document.wordCount > conditions.maxWordCount) {
        return false;
      }
      
      return true;
    } catch (error) {
      return false;
    }
  };

  VisibilityRule.prototype.applyActions = function() {
    return this.actions;
  };

  // Class methods
  VisibilityRule.findActive = function() {
    return this.findAll({
      where: { isActive: true },
      order: [['priority', 'DESC'], ['createdAt', 'ASC']]
    });
  };

  VisibilityRule.findByCreator = function(createdBy) {
    return this.findAll({
      where: { createdBy },
      order: [['createdAt', 'DESC']]
    });
  };

  VisibilityRule.evaluateDocument = async function(document) {
    const activeRules = await this.findActive();
    const applicableActions = [];

    for (const rule of activeRules) {
      if (rule.evaluateConditions(document)) {
        applicableActions.push({
          rule: rule.name,
          actions: rule.applyActions()
        });
      }
    }

    return applicableActions;
  };

  return VisibilityRule;
};
