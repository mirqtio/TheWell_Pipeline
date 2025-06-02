/**
 * JobDependency Model - ORM representation of job_dependencies table
 */
module.exports = (sequelize, DataTypes) => {
  const JobDependency = sequelize.define('JobDependency', {
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
    dependsOnJobId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'depends_on_job_id',
      references: {
        model: 'jobs',
        key: 'id'
      }
    },
    createdAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
      field: 'created_at'
    }
  }, {
    tableName: 'job_dependencies',
    timestamps: false,
    indexes: [
      {
        fields: ['job_id']
      },
      {
        fields: ['depends_on_job_id']
      },
      {
        unique: true,
        fields: ['job_id', 'depends_on_job_id']
      }
    ],
    validate: {
      noCyclicDependency() {
        if (this.jobId === this.dependsOnJobId) {
          throw new Error('Job cannot depend on itself');
        }
      }
    }
  });

  // Class methods
  JobDependency.findByJob = function(jobId) {
    return this.findAll({
      where: { jobId }
    });
  };

  JobDependency.findDependentsOf = function(jobId) {
    return this.findAll({
      where: { dependsOnJobId: jobId }
    });
  };

  JobDependency.createDependency = async function(jobId, dependsOnJobId) {
    // Check for circular dependency
    const existingReverse = await this.findOne({
      where: {
        jobId: dependsOnJobId,
        dependsOnJobId: jobId
      }
    });

    if (existingReverse) {
      throw new Error('Creating this dependency would create a circular dependency');
    }

    return this.create({
      jobId,
      dependsOnJobId
    });
  };

  return JobDependency;
};
