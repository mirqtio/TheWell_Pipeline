/**
 * VisibilityAuditLog Model - ORM representation of visibility_audit_log table
 */
module.exports = (sequelize, DataTypes) => {
  const VisibilityAuditLog = sequelize.define('VisibilityAuditLog', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    documentId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'document_id',
      references: {
        model: 'documents',
        key: 'id'
      }
    },
    action: {
      type: DataTypes.STRING(50),
      allowNull: false,
      validate: {
        isIn: [['created', 'updated', 'approved', 'rejected', 'deleted']]
      }
    },
    previousVisibility: {
      type: DataTypes.STRING(20),
      field: 'previous_visibility'
    },
    newVisibility: {
      type: DataTypes.STRING(20),
      field: 'new_visibility'
    },
    changedBy: {
      type: DataTypes.STRING(255),
      allowNull: false,
      field: 'changed_by'
    },
    reason: {
      type: DataTypes.TEXT
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
    tableName: 'visibility_audit_log',
    timestamps: false,
    indexes: [
      {
        fields: ['document_id']
      },
      {
        fields: ['action']
      },
      {
        fields: ['changed_by']
      },
      {
        fields: ['created_at']
      }
    ]
  });

  // Class methods
  VisibilityAuditLog.findByDocument = function(documentId) {
    return this.findAll({
      where: { documentId },
      order: [['createdAt', 'DESC']]
    });
  };

  VisibilityAuditLog.findByUser = function(changedBy) {
    return this.findAll({
      where: { changedBy },
      order: [['createdAt', 'DESC']]
    });
  };

  VisibilityAuditLog.logChange = function(documentId, action, changedBy, options = {}) {
    return this.create({
      documentId,
      action,
      changedBy,
      previousVisibility: options.previousVisibility,
      newVisibility: options.newVisibility,
      reason: options.reason,
      metadata: options.metadata || {}
    });
  };

  return VisibilityAuditLog;
};
