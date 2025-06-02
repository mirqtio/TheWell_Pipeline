/**
 * CostEvent Model - ORM representation of cost_events table
 */
module.exports = (sequelize, DataTypes) => {
  const CostEvent = sequelize.define('CostEvent', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    eventType: {
      type: DataTypes.STRING(50),
      allowNull: false,
      field: 'event_type',
      validate: {
        isIn: [['api_call', 'storage', 'compute', 'embedding', 'enrichment', 'processing']]
      }
    },
    service: {
      type: DataTypes.STRING(100),
      allowNull: false
    },
    operation: {
      type: DataTypes.STRING(100),
      allowNull: false
    },
    cost: {
      type: DataTypes.DECIMAL(10, 6),
      allowNull: false,
      validate: {
        min: 0
      }
    },
    currency: {
      type: DataTypes.STRING(3),
      defaultValue: 'USD'
    },
    units: {
      type: DataTypes.INTEGER,
      defaultValue: 1,
      validate: {
        min: 0
      }
    },
    unitType: {
      type: DataTypes.STRING(50),
      field: 'unit_type',
      validate: {
        isIn: [['tokens', 'requests', 'bytes', 'minutes', 'documents', 'embeddings']]
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
    tableName: 'cost_events',
    timestamps: false,
    indexes: [
      {
        fields: ['event_type']
      },
      {
        fields: ['service']
      },
      {
        fields: ['operation']
      },
      {
        fields: ['created_at']
      },
      {
        fields: ['service', 'created_at']
      }
    ]
  });

  // Class methods
  CostEvent.findByService = function(service, startDate = null, endDate = null) {
    const where = { service };
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt[sequelize.Sequelize.Op.gte] = startDate;
      if (endDate) where.createdAt[sequelize.Sequelize.Op.lte] = endDate;
    }
    return this.findAll({ where, order: [['createdAt', 'DESC']] });
  };

  CostEvent.getTotalCost = async function(startDate = null, endDate = null, service = null) {
    const where = {};
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt[sequelize.Sequelize.Op.gte] = startDate;
      if (endDate) where.createdAt[sequelize.Sequelize.Op.lte] = endDate;
    }
    if (service) where.service = service;

    const result = await this.findOne({
      attributes: [[sequelize.fn('SUM', sequelize.col('cost')), 'totalCost']],
      where,
      raw: true
    });
    return parseFloat(result.totalCost) || 0;
  };

  CostEvent.recordCost = function(eventType, service, operation, cost, options = {}) {
    return this.create({
      eventType,
      service,
      operation,
      cost,
      currency: options.currency || 'USD',
      units: options.units || 1,
      unitType: options.unitType,
      metadata: options.metadata || {}
    });
  };

  return CostEvent;
};
