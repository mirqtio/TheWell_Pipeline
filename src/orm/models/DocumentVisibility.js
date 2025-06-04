/**
 * DocumentVisibility Model - ORM representation of document_visibility table
 */
module.exports = (sequelize, DataTypes) => {
  const DocumentVisibility = sequelize.define('DocumentVisibility', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    documentId: {
      type: DataTypes.STRING(255),
      allowNull: false,
      field: 'document_id',
      unique: true,
      references: {
        model: 'documents',
        key: 'id'
      }
    },
    visibility: {
      type: DataTypes.STRING(50),
      allowNull: false,
      defaultValue: 'internal',
      field: 'visibility',
      validate: {
        isIn: [['public', 'internal', 'external', 'private', 'restricted', 'draft', 'archived']]
      }
    },
    previousVisibility: {
      type: DataTypes.STRING(50),
      field: 'previous_visibility'
    },
    setBy: {
      type: DataTypes.STRING(255),
      allowNull: false,
      field: 'set_by'
    },
    setAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
      field: 'set_at'
    },
    reason: {
      type: DataTypes.TEXT
    },
    metadata: {
      type: DataTypes.JSONB,
      defaultValue: {},
      validate: {
        isValidMetadata(value) {
          if (typeof value !== 'object' || value === null) {
            throw new Error('Metadata must be a valid JSON object');
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
    tableName: 'document_visibility',
    timestamps: false,
    indexes: [
      {
        fields: ['document_id']
      },
      {
        fields: ['visibility']
      },
      {
        fields: ['set_by']
      },
      {
        fields: ['set_at']
      },
      {
        fields: ['created_at']
      }
    ],
    hooks: {
      beforeUpdate: (visibility) => {
        visibility.updatedAt = new Date();
      }
    }
  });

  // Instance methods
  DocumentVisibility.prototype.isPublic = function() {
    return this.visibility === 'public';
  };

  DocumentVisibility.prototype.isPrivate = function() {
    return this.visibility === 'private';
  };

  DocumentVisibility.prototype.isRestricted = function() {
    return this.visibility === 'restricted';
  };
  
  DocumentVisibility.prototype.isExternal = function() {
    return this.visibility === 'external';
  };


  DocumentVisibility.prototype.requiresApproval = function(newVisibility) {
    // External and public visibility changes require approval
    const requiresApprovalLevels = ['external', 'public'];
    return requiresApprovalLevels.includes(newVisibility);
  };

  DocumentVisibility.prototype.updateVisibility = async function(newVisibility, setBy, reason) {
    this.previousVisibility = this.visibility;
    this.visibility = newVisibility;
    this.setBy = setBy;
    this.setAt = new Date();
    this.reason = reason;
    this.updatedAt = new Date();
    return this.save();
  };

  // Class methods
  DocumentVisibility.findByDocument = function(documentId) {
    return this.findAll({
      where: { documentId }
    });
  };

  DocumentVisibility.findByVisibility = function(visibility) {
    return this.findAll({
      where: { visibility }
    });
  };


  DocumentVisibility.findBySetBy = function(setBy) {
    return this.findAll({
      where: { setBy }
    });
  };

  DocumentVisibility.findRecentChanges = function(since) {
    return this.findAll({
      where: {
        setAt: {
          [sequelize.Sequelize.Op.gte]: since
        }
      },
      order: [['setAt', 'DESC']]
    });
  };

  return DocumentVisibility;
};
