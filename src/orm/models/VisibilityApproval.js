/**
 * VisibilityApproval Model - ORM representation of visibility_approvals table
 */
module.exports = (sequelize, DataTypes) => {
  const VisibilityApproval = sequelize.define('VisibilityApproval', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    approvalId: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: true,
      field: 'approval_id',
      defaultValue: DataTypes.UUIDV4
    },
    documentId: {
      type: DataTypes.STRING(255),
      allowNull: false,
      field: 'document_id',
      references: {
        model: 'documents',
        key: 'id'
      }
    },
    requestedVisibility: {
      type: DataTypes.STRING(50),
      allowNull: false,
      field: 'requested_visibility',
      validate: {
        isIn: [['public', 'internal', 'external', 'private', 'restricted', 'draft', 'archived']]
      }
    },
    currentVisibility: {
      type: DataTypes.STRING(50),
      field: 'current_visibility'
    },
    requestedBy: {
      type: DataTypes.STRING(255),
      allowNull: false,
      field: 'requested_by'
    },
    requestedAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
      field: 'requested_at'
    },
    reason: {
      type: DataTypes.TEXT
    },
    status: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'pending',
      validate: {
        isIn: [['pending', 'approved', 'rejected']]
      }
    },
    reviewedBy: {
      type: DataTypes.STRING(255),
      field: 'reviewed_by'
    },
    reviewedAt: {
      type: DataTypes.DATE,
      field: 'reviewed_at'
    },
    reviewNotes: {
      type: DataTypes.TEXT,
      field: 'review_notes'
    },
    metadata: {
      type: DataTypes.JSONB,
      defaultValue: {}
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
    tableName: 'visibility_approvals',
    timestamps: false,
    indexes: [
      {
        fields: ['approval_id']
      },
      {
        fields: ['document_id']
      },
      {
        fields: ['status']
      },
      {
        fields: ['requested_by']
      },
      {
        fields: ['requested_at']
      }
    ],
    hooks: {
      beforeUpdate: (approval) => {
        approval.updatedAt = new Date();
      }
    }
  });

  // Instance methods
  VisibilityApproval.prototype.isPending = function() {
    return this.status === 'pending';
  };

  VisibilityApproval.prototype.isApproved = function() {
    return this.status === 'approved';
  };

  VisibilityApproval.prototype.isRejected = function() {
    return this.status === 'rejected';
  };

  VisibilityApproval.prototype.approve = async function(reviewedBy, reviewNotes) {
    this.status = 'approved';
    this.reviewedBy = reviewedBy;
    this.reviewedAt = new Date();
    this.reviewNotes = reviewNotes;
    this.updatedAt = new Date();
    return this.save();
  };

  VisibilityApproval.prototype.reject = async function(reviewedBy, reviewNotes) {
    this.status = 'rejected';
    this.reviewedBy = reviewedBy;
    this.reviewedAt = new Date();
    this.reviewNotes = reviewNotes;
    this.updatedAt = new Date();
    return this.save();
  };

  // Class methods
  VisibilityApproval.findPending = function() {
    return this.findAll({
      where: { status: 'pending' },
      order: [['requestedAt', 'ASC']]
    });
  };

  VisibilityApproval.findByDocument = function(documentId) {
    return this.findAll({
      where: { documentId },
      order: [['requestedAt', 'DESC']]
    });
  };

  VisibilityApproval.findByRequester = function(requestedBy) {
    return this.findAll({
      where: { requestedBy },
      order: [['requestedAt', 'DESC']]
    });
  };

  VisibilityApproval.findByStatus = function(status) {
    return this.findAll({
      where: { status },
      order: [['requestedAt', 'DESC']]
    });
  };

  VisibilityApproval.getRecentActivity = function(days = 7) {
    const since = new Date();
    since.setDate(since.getDate() - days);
    
    return this.findAll({
      where: {
        [sequelize.Sequelize.Op.or]: [
          {
            requestedAt: {
              [sequelize.Sequelize.Op.gte]: since
            }
          },
          {
            reviewedAt: {
              [sequelize.Sequelize.Op.gte]: since
            }
          }
        ]
      },
      order: [['updatedAt', 'DESC']]
    });
  };

  return VisibilityApproval;
};