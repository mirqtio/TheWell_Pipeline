/**
 * Document Model - ORM representation of documents table
 * Supports vector embeddings for semantic search
 */
module.exports = (sequelize, DataTypes) => {
  const Document = sequelize.define('Document', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
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
    externalId: {
      type: DataTypes.STRING(500),
      field: 'external_id',
      validate: {
        len: [0, 500]
      }
    },
    title: {
      type: DataTypes.TEXT,
      allowNull: false,
      validate: {
        notEmpty: true
      }
    },
    content: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    contentType: {
      type: DataTypes.STRING(100),
      field: 'content_type',
      defaultValue: 'text/plain',
      validate: {
        isIn: [['text/plain', 'text/html', 'application/pdf', 'application/json', 'text/markdown']]
      }
    },
    url: {
      type: DataTypes.TEXT,
      validate: {
        isUrl: {
          args: true,
          msg: 'Must be a valid URL'
        }
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
    hash: {
      type: DataTypes.STRING(64),
      unique: true,
      validate: {
        len: [0, 64]
      }
    },
    wordCount: {
      type: DataTypes.INTEGER,
      field: 'word_count',
      validate: {
        min: 0
      }
    },
    language: {
      type: DataTypes.STRING(10),
      validate: {
        len: [0, 10]
      }
    },
    // Vector embedding field - using TEXT for now as Sequelize doesn't natively support vector type
    embedding: {
      type: DataTypes.TEXT,
      allowNull: true,
      get() {
        const rawValue = this.getDataValue('embedding');
        if (!rawValue) return null;
        try {
          // Parse vector string back to array if it's a string
          if (typeof rawValue === 'string') {
            return JSON.parse(rawValue);
          }
          return rawValue;
        } catch (error) {
          return null;
        }
      },
      set(value) {
        if (value === null || value === undefined) {
          this.setDataValue('embedding', null);
          return;
        }
        // Store as JSON string for now
        if (Array.isArray(value)) {
          this.setDataValue('embedding', JSON.stringify(value));
        } else {
          this.setDataValue('embedding', value);
        }
      }
    },
    embeddingModel: {
      type: DataTypes.STRING(100),
      field: 'embedding_model',
      defaultValue: 'text-embedding-3-small'
    },
    visibility: {
      type: DataTypes.STRING(20),
      defaultValue: 'internal',
      validate: {
        isIn: [['internal', 'external', 'private', 'public', 'restricted', 'draft', 'archived']]
      }
    },
    believabilityScore: {
      type: DataTypes.DECIMAL(3, 2),
      field: 'believability_score',
      defaultValue: 0.5,
      validate: {
        min: 0.0,
        max: 1.0
      }
    },
    qualityScore: {
      type: DataTypes.DECIMAL(3, 2),
      field: 'quality_score',
      validate: {
        min: 0.0,
        max: 1.0
      }
    },
    enrichments: {
      type: DataTypes.JSONB,
      defaultValue: {},
      validate: {
        isValidEnrichments(value) {
          if (typeof value !== 'object' || value === null) {
            throw new Error('Enrichments must be a valid JSON object');
          }
        }
      }
    },
    enrichmentStatus: {
      type: DataTypes.STRING(20),
      field: 'enrichment_status',
      defaultValue: 'pending',
      validate: {
        isIn: [['pending', 'processing', 'completed', 'failed', 'skipped']]
      }
    },
    enrichedAt: {
      type: DataTypes.DATE,
      field: 'enriched_at'
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
    },
    ingestedAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
      field: 'ingested_at'
    },
    // Full-text search vector - using TEXT for now
    searchVector: {
      type: DataTypes.TEXT,
      field: 'search_vector'
    }
  }, {
    tableName: 'documents',
    timestamps: false,
    indexes: [
      {
        fields: ['source_id']
      },
      {
        fields: ['external_id']
      },
      {
        fields: ['hash']
      },
      {
        fields: ['visibility']
      },
      {
        fields: ['enrichment_status']
      },
      {
        fields: ['created_at']
      },
      {
        fields: ['ingested_at']
      },
      {
        fields: ['content_type']
      },
      {
        fields: ['language']
      }
    ],
    hooks: {
      beforeUpdate: (document) => {
        document.updatedAt = new Date();
      },
      beforeCreate: (document) => {
        if (!document.ingestedAt) {
          document.ingestedAt = new Date();
        }
      }
    }
  });

  // Instance methods
  Document.prototype.isEnriched = function() {
    return this.enrichmentStatus === 'completed';
  };

  Document.prototype.hasEmbedding = function() {
    return this.embedding !== null && this.embedding !== undefined;
  };

  Document.prototype.setEnrichmentStatus = async function(status, enrichments = null) {
    this.enrichmentStatus = status;
    if (status === 'completed') {
      this.enrichedAt = new Date();
    }
    if (enrichments) {
      this.enrichments = { ...this.enrichments, ...enrichments };
    }
    this.updatedAt = new Date();
    return this.save();
  };

  Document.prototype.updateEmbedding = async function(embedding, model = null) {
    this.embedding = embedding;
    if (model) {
      this.embeddingModel = model;
    }
    this.updatedAt = new Date();
    return this.save();
  };

  Document.prototype.setVisibility = async function(visibility) {
    this.visibility = visibility;
    this.updatedAt = new Date();
    return this.save();
  };

  Document.prototype.calculateWordCount = function() {
    if (!this.content) return 0;
    return this.content.trim().split(/\s+/).length;
  };

  Document.prototype.updateWordCount = async function() {
    this.wordCount = this.calculateWordCount();
    this.updatedAt = new Date();
    return this.save();
  };

  // Class methods
  Document.findBySource = function(sourceId) {
    return this.findAll({
      where: { sourceId }
    });
  };

  Document.findByVisibility = function(visibility) {
    return this.findAll({
      where: { visibility }
    });
  };

  Document.findByEnrichmentStatus = function(status) {
    return this.findAll({
      where: { enrichmentStatus: status }
    });
  };

  Document.findByHash = function(hash) {
    return this.findOne({
      where: { hash }
    });
  };

  Document.findPendingEnrichment = function() {
    return this.findAll({
      where: { enrichmentStatus: 'pending' },
      order: [['createdAt', 'ASC']]
    });
  };

  Document.findWithEmbeddings = function() {
    return this.findAll({
      where: {
        embedding: {
          [sequelize.Sequelize.Op.not]: null
        }
      }
    });
  };

  Document.searchByContent = function(searchTerm, limit = 10) {
    return this.findAll({
      where: {
        [sequelize.Sequelize.Op.or]: [
          {
            title: {
              [sequelize.Sequelize.Op.iLike]: `%${searchTerm}%`
            }
          },
          {
            content: {
              [sequelize.Sequelize.Op.iLike]: `%${searchTerm}%`
            }
          }
        ]
      },
      limit,
      order: [['createdAt', 'DESC']]
    });
  };

  return Document;
};
