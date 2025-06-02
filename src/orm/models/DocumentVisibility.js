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
      type: DataTypes.UUID,
      allowNull: false,
      field: 'document_id',
      references: {
        model: 'documents',
        key: 'id'
      }
    },
    visibilityLevel: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'internal',
      field: 'visibility_level',
      validate: {
        isIn: [['public', 'internal', 'private', 'restricted', 'draft', 'archived']]
      }
    },
    accessGroups: {
      type: DataTypes.ARRAY(DataTypes.TEXT),
      field: 'access_groups',
      defaultValue: [],
      validate: {
        isValidGroups(value) {
          if (!Array.isArray(value)) {
            throw new Error('Access groups must be an array');
          }
        }
      }
    },
    accessLevel: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'read',
      field: 'access_level',
      validate: {
        isIn: [['read', 'write', 'admin', 'approve']]
      }
    },
    approvalRequired: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      field: 'approval_required'
    },
    approvedBy: {
      type: DataTypes.STRING(255),
      field: 'approved_by'
    },
    approvedAt: {
      type: DataTypes.DATE,
      field: 'approved_at'
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
        fields: ['visibility_level']
      },
      {
        fields: ['access_level']
      },
      {
        fields: ['approval_required']
      },
      {
        fields: ['approved_by']
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
    return this.visibilityLevel === 'public';
  };

  DocumentVisibility.prototype.isPrivate = function() {
    return this.visibilityLevel === 'private';
  };

  DocumentVisibility.prototype.isRestricted = function() {
    return this.visibilityLevel === 'restricted';
  };

  DocumentVisibility.prototype.requiresApproval = function() {
    return this.approvalRequired;
  };

  DocumentVisibility.prototype.isApproved = function() {
    return this.approvedBy !== null && this.approvedAt !== null;
  };

  DocumentVisibility.prototype.approve = async function(approvedBy) {
    this.approvedBy = approvedBy;
    this.approvedAt = new Date();
    this.updatedAt = new Date();
    return this.save();
  };

  DocumentVisibility.prototype.hasAccess = function(userGroups = [], requiredLevel = 'read') {
    // Public documents are accessible to everyone
    if (this.visibilityLevel === 'public') {
      return true;
    }

    // Private documents require specific access
    if (this.visibilityLevel === 'private') {
      return false;
    }

    // Check if user has required access level
    const accessLevels = ['read', 'write', 'admin', 'approve'];
    const userLevelIndex = accessLevels.indexOf(this.accessLevel);
    const requiredLevelIndex = accessLevels.indexOf(requiredLevel);
    
    if (userLevelIndex < requiredLevelIndex) {
      return false;
    }

    // Check group access for restricted documents
    if (this.visibilityLevel === 'restricted' && this.accessGroups.length > 0) {
      return userGroups.some(group => this.accessGroups.includes(group));
    }

    return true;
  };

  DocumentVisibility.prototype.addAccessGroup = async function(group) {
    if (!this.accessGroups.includes(group)) {
      this.accessGroups = [...this.accessGroups, group];
      this.updatedAt = new Date();
      return this.save();
    }
    return this;
  };

  DocumentVisibility.prototype.removeAccessGroup = async function(group) {
    this.accessGroups = this.accessGroups.filter(g => g !== group);
    this.updatedAt = new Date();
    return this.save();
  };

  // Class methods
  DocumentVisibility.findByDocument = function(documentId) {
    return this.findAll({
      where: { documentId }
    });
  };

  DocumentVisibility.findByVisibilityLevel = function(visibilityLevel) {
    return this.findAll({
      where: { visibilityLevel }
    });
  };

  DocumentVisibility.findPendingApproval = function() {
    return this.findAll({
      where: {
        approvalRequired: true,
        approvedBy: null
      },
      order: [['createdAt', 'ASC']]
    });
  };

  DocumentVisibility.findByAccessGroup = function(group) {
    return this.findAll({
      where: {
        accessGroups: {
          [sequelize.Sequelize.Op.contains]: [group]
        }
      }
    });
  };

  DocumentVisibility.findAccessibleDocuments = function(userGroups = [], accessLevel = 'read') {
    const whereClause = {
      [sequelize.Sequelize.Op.or]: [
        { visibilityLevel: 'public' },
        { visibilityLevel: 'internal' }
      ]
    };

    // Add restricted documents that user has access to
    if (userGroups.length > 0) {
      whereClause[sequelize.Sequelize.Op.or].push({
        visibilityLevel: 'restricted',
        accessGroups: {
          [sequelize.Sequelize.Op.overlap]: userGroups
        }
      });
    }

    return this.findAll({
      where: whereClause
    });
  };

  return DocumentVisibility;
};
