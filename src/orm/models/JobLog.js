/**
 * JobLog Model - ORM representation of job_logs table
 */
module.exports = (sequelize, DataTypes) => {
  const JobLog = sequelize.define('JobLog', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    jobId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'job_id',
      references: {
        model: 'jobs',
        key: 'id'
      }
    },
    level: {
      type: DataTypes.STRING(10),
      allowNull: false,
      validate: {
        isIn: [['debug', 'info', 'warn', 'error', 'fatal']]
      }
    },
    message: {
      type: DataTypes.TEXT,
      allowNull: false,
      validate: {
        notEmpty: true
      }
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
    }
  }, {
    tableName: 'job_logs',
    timestamps: false,
    indexes: [
      {
        fields: ['job_id']
      },
      {
        fields: ['level']
      },
      {
        fields: ['created_at']
      },
      {
        fields: ['job_id', 'created_at'] // Composite index for job log retrieval
      }
    ]
  });

  // Instance methods
  JobLog.prototype.isError = function() {
    return this.level === 'error' || this.level === 'fatal';
  };

  JobLog.prototype.isWarning = function() {
    return this.level === 'warn';
  };

  JobLog.prototype.isInfo = function() {
    return this.level === 'info';
  };

  // Class methods
  JobLog.findByJob = function(jobId, options = {}) {
    const whereClause = { jobId };
    const queryOptions = {
      where: whereClause,
      order: [['createdAt', options.order || 'DESC']]
    };

    if (options.level) {
      whereClause.level = options.level;
    }

    if (options.limit) {
      queryOptions.limit = options.limit;
    }

    if (options.offset) {
      queryOptions.offset = options.offset;
    }

    return this.findAll(queryOptions);
  };

  JobLog.findByLevel = function(level, limit = 100) {
    return this.findAll({
      where: { level },
      order: [['createdAt', 'DESC']],
      limit
    });
  };

  JobLog.findErrors = function(jobId = null, limit = 100) {
    const whereClause = {
      level: {
        [sequelize.Sequelize.Op.in]: ['error', 'fatal']
      }
    };

    if (jobId) {
      whereClause.jobId = jobId;
    }

    return this.findAll({
      where: whereClause,
      order: [['createdAt', 'DESC']],
      limit
    });
  };

  JobLog.createLog = function(jobId, level, message, metadata = {}) {
    return this.create({
      jobId,
      level,
      message,
      metadata
    });
  };

  JobLog.logInfo = function(jobId, message, metadata = {}) {
    return this.createLog(jobId, 'info', message, metadata);
  };

  JobLog.logWarning = function(jobId, message, metadata = {}) {
    return this.createLog(jobId, 'warn', message, metadata);
  };

  JobLog.logError = function(jobId, message, metadata = {}) {
    return this.createLog(jobId, 'error', message, metadata);
  };

  JobLog.logDebug = function(jobId, message, metadata = {}) {
    return this.createLog(jobId, 'debug', message, metadata);
  };

  JobLog.getLogStats = async function(jobId) {
    const stats = await this.findAll({
      where: { jobId },
      attributes: [
        'level',
        [sequelize.fn('COUNT', sequelize.col('id')), 'count']
      ],
      group: ['level'],
      raw: true
    });

    const result = {
      debug: 0,
      info: 0,
      warn: 0,
      error: 0,
      fatal: 0,
      total: 0
    };

    stats.forEach(stat => {
      result[stat.level] = parseInt(stat.count);
      result.total += parseInt(stat.count);
    });

    return result;
  };

  return JobLog;
};
