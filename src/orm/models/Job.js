/**
 * Job Model - ORM representation of jobs table
 */
module.exports = (sequelize, DataTypes) => {
  const Job = sequelize.define('Job', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    type: {
      type: DataTypes.STRING(50),
      allowNull: false,
      validate: {
        isIn: [['ingestion', 'enrichment', 'processing', 'cleanup', 'validation', 'export']]
      }
    },
    status: {
      type: DataTypes.STRING(20),
      defaultValue: 'pending',
      validate: {
        isIn: [['pending', 'running', 'completed', 'failed', 'cancelled', 'retrying']]
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
    sourceId: {
      type: DataTypes.UUID,
      allowNull: true,
      field: 'source_id',
      references: {
        model: 'sources',
        key: 'id'
      }
    },
    documentId: {
      type: DataTypes.UUID,
      allowNull: true,
      field: 'document_id',
      references: {
        model: 'documents',
        key: 'id'
      }
    },
    config: {
      type: DataTypes.JSONB,
      defaultValue: {},
      validate: {
        isValidConfig(value) {
          if (typeof value !== 'object' || value === null) {
            throw new Error('Config must be a valid JSON object');
          }
        }
      }
    },
    progress: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      validate: {
        min: 0,
        max: 100
      }
    },
    result: {
      type: DataTypes.JSONB,
      allowNull: true,
      validate: {
        isValidResult(value) {
          if (value !== null && (typeof value !== 'object' || Array.isArray(value))) {
            throw new Error('Result must be a valid JSON object or null');
          }
        }
      }
    },
    errorMessage: {
      type: DataTypes.TEXT,
      field: 'error_message'
    },
    startedAt: {
      type: DataTypes.DATE,
      field: 'started_at'
    },
    completedAt: {
      type: DataTypes.DATE,
      field: 'completed_at'
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
    tableName: 'jobs',
    timestamps: false,
    indexes: [
      {
        fields: ['type']
      },
      {
        fields: ['status']
      },
      {
        fields: ['priority']
      },
      {
        fields: ['source_id']
      },
      {
        fields: ['document_id']
      },
      {
        fields: ['created_at']
      },
      {
        fields: ['started_at']
      },
      {
        fields: ['completed_at']
      },
      {
        fields: ['status', 'priority'] // Composite index for queue processing
      }
    ],
    hooks: {
      beforeUpdate: (job) => {
        job.updatedAt = new Date();
      }
    }
  });

  // Instance methods
  Job.prototype.isRunning = function() {
    return this.status === 'running';
  };

  Job.prototype.isCompleted = function() {
    return this.status === 'completed';
  };

  Job.prototype.isFailed = function() {
    return this.status === 'failed';
  };

  Job.prototype.isPending = function() {
    return this.status === 'pending';
  };

  Job.prototype.start = async function() {
    this.status = 'running';
    this.startedAt = new Date();
    this.updatedAt = new Date();
    return this.save();
  };

  Job.prototype.complete = async function(result = null) {
    this.status = 'completed';
    this.progress = 100;
    this.completedAt = new Date();
    this.updatedAt = new Date();
    if (result) {
      this.result = result;
    }
    return this.save();
  };

  Job.prototype.fail = async function(errorMessage) {
    this.status = 'failed';
    this.errorMessage = errorMessage;
    this.completedAt = new Date();
    this.updatedAt = new Date();
    return this.save();
  };

  Job.prototype.cancel = async function() {
    this.status = 'cancelled';
    this.completedAt = new Date();
    this.updatedAt = new Date();
    return this.save();
  };

  Job.prototype.retry = async function() {
    this.status = 'pending';
    this.progress = 0;
    this.errorMessage = null;
    this.startedAt = null;
    this.completedAt = null;
    this.updatedAt = new Date();
    return this.save();
  };

  Job.prototype.updateProgress = async function(progress) {
    this.progress = Math.max(0, Math.min(100, progress));
    this.updatedAt = new Date();
    return this.save();
  };

  Job.prototype.getDuration = function() {
    if (!this.startedAt) return null;
    const endTime = this.completedAt || new Date();
    return endTime.getTime() - this.startedAt.getTime();
  };

  // Class methods
  Job.findByType = function(type) {
    return this.findAll({
      where: { type }
    });
  };

  Job.findByStatus = function(status) {
    return this.findAll({
      where: { status }
    });
  };

  Job.findPending = function() {
    return this.findAll({
      where: { status: 'pending' },
      order: [['priority', 'DESC'], ['createdAt', 'ASC']]
    });
  };

  Job.findRunning = function() {
    return this.findAll({
      where: { status: 'running' },
      order: [['startedAt', 'ASC']]
    });
  };

  Job.findBySource = function(sourceId) {
    return this.findAll({
      where: { sourceId }
    });
  };

  Job.findByDocument = function(documentId) {
    return this.findAll({
      where: { documentId }
    });
  };

  Job.findStale = function(hours = 24) {
    const staleTime = new Date();
    staleTime.setHours(staleTime.getHours() - hours);
    
    return this.findAll({
      where: {
        status: 'running',
        startedAt: {
          [sequelize.Sequelize.Op.lt]: staleTime
        }
      }
    });
  };

  Job.getQueueStats = async function() {
    const stats = await this.findAll({
      attributes: [
        'status',
        [sequelize.fn('COUNT', sequelize.col('id')), 'count']
      ],
      group: ['status'],
      raw: true
    });

    const result = {
      pending: 0,
      running: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
      total: 0
    };

    stats.forEach(stat => {
      result[stat.status] = parseInt(stat.count);
      result.total += parseInt(stat.count);
    });

    return result;
  };

  return Job;
};
