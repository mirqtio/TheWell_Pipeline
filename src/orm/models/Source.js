/**
 * Source Model - ORM representation of sources table
 */
module.exports = (sequelize, DataTypes) => {
  const Source = sequelize.define('Source', {
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
    type: {
      type: DataTypes.STRING(50),
      allowNull: false,
      validate: {
        isIn: [['rss', 'api', 'file', 'webhook', 'static', 'semi-static', 'dynamic']]
      }
    },
    config: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: {},
      validate: {
        isValidConfig(value) {
          if (typeof value !== 'object' || value === null) {
            throw new Error('Config must be a valid JSON object');
          }
        }
      }
    },
    status: {
      type: DataTypes.STRING(20),
      defaultValue: 'active',
      validate: {
        isIn: [['active', 'inactive', 'error', 'paused']]
      }
    },
    lastSyncAt: {
      type: DataTypes.DATE,
      field: 'last_sync_at'
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
    tableName: 'sources',
    timestamps: false, // We handle timestamps manually
    indexes: [
      {
        fields: ['name']
      },
      {
        fields: ['type']
      },
      {
        fields: ['status']
      },
      {
        fields: ['last_sync_at']
      }
    ],
    hooks: {
      beforeUpdate: (source) => {
        source.updatedAt = new Date();
      }
    }
  });

  // Instance methods
  Source.prototype.isActive = function() {
    return this.status === 'active';
  };

  Source.prototype.updateLastSync = async function() {
    this.lastSyncAt = new Date();
    this.updatedAt = new Date();
    return this.save();
  };

  Source.prototype.setStatus = async function(status) {
    this.status = status;
    this.updatedAt = new Date();
    return this.save();
  };

  // Class methods
  Source.findByType = function(type) {
    return this.findAll({
      where: { type }
    });
  };

  Source.findActive = function() {
    return this.findAll({
      where: { status: 'active' }
    });
  };

  Source.findByTypeAndStatus = function(type, status) {
    return this.findAll({
      where: { type, status }
    });
  };

  return Source;
};
