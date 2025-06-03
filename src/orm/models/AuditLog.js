/**
 * AuditLog Model - ORM representation of audit_log table
 * Provides comprehensive audit trail for all system operations
 */
module.exports = (sequelize, DataTypes) => {
  const AuditLog = sequelize.define('AuditLog', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    tableName: {
      type: DataTypes.STRING(100),
      allowNull: false,
      field: 'table_name'
    },
    operation: {
      type: DataTypes.STRING(10),
      allowNull: false,
      validate: {
        isIn: [['INSERT', 'UPDATE', 'DELETE', 'SELECT', 'BULK_UPDATE', 'BULK_DELETE']]
      }
    },
    recordId: {
      type: DataTypes.UUID,
      field: 'record_id'
    },
    oldValues: {
      type: DataTypes.JSONB,
      field: 'old_values'
    },
    newValues: {
      type: DataTypes.JSONB,
      field: 'new_values'
    },
    changedFields: {
      type: DataTypes.ARRAY(DataTypes.TEXT),
      field: 'changed_fields'
    },
    userId: {
      type: DataTypes.STRING(255),
      field: 'user_id'
    },
    sessionId: {
      type: DataTypes.STRING(255),
      field: 'session_id'
    },
    ipAddress: {
      type: DataTypes.INET,
      field: 'ip_address'
    },
    userAgent: {
      type: DataTypes.TEXT,
      field: 'user_agent'
    },
    timestamp: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
      allowNull: false
    }
  }, {
    tableName: 'audit_log',
    timestamps: false, // Using custom timestamp field
    indexes: [
      {
        fields: ['table_name', 'operation']
      },
      {
        fields: ['record_id']
      },
      {
        fields: ['user_id']
      },
      {
        fields: ['timestamp']
      },
      {
        fields: ['session_id']
      }
    ]
  });

  // Define associations
  AuditLog.associate = function(models) {
    // No direct associations - audit log is independent for data integrity
    // But we can define virtual relationships for convenience
  };

  // Instance methods
  AuditLog.prototype.getChangedFieldsCount = function() {
    return this.changedFields ? this.changedFields.length : 0;
  };

  AuditLog.prototype.hasFieldChanged = function(fieldName) {
    return this.changedFields && this.changedFields.includes(fieldName);
  };

  AuditLog.prototype.getFieldChange = function(fieldName) {
    if (!this.hasFieldChanged(fieldName)) {
      return null;
    }
    
    return {
      field: fieldName,
      oldValue: this.oldValues ? this.oldValues[fieldName] : null,
      newValue: this.newValues ? this.newValues[fieldName] : null
    };
  };

  // Class methods
  AuditLog.findByTable = function(tableName, options = {}) {
    return this.findAll({
      where: { tableName },
      order: [['timestamp', 'DESC']],
      ...options
    });
  };

  AuditLog.findByRecord = function(tableName, recordId, options = {}) {
    return this.findAll({
      where: { 
        tableName,
        recordId 
      },
      order: [['timestamp', 'DESC']],
      ...options
    });
  };

  AuditLog.findByUser = function(userId, options = {}) {
    return this.findAll({
      where: { userId },
      order: [['timestamp', 'DESC']],
      ...options
    });
  };

  AuditLog.findBySession = function(sessionId, options = {}) {
    return this.findAll({
      where: { sessionId },
      order: [['timestamp', 'DESC']],
      ...options
    });
  };

  AuditLog.findByDateRange = function(startDate, endDate, options = {}) {
    const { Op } = require('sequelize');
    return this.findAll({
      where: {
        timestamp: {
          [Op.between]: [startDate, endDate]
        }
      },
      order: [['timestamp', 'DESC']],
      ...options
    });
  };

  return AuditLog;
};
