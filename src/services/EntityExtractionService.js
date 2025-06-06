const EntityExtractor = require('../enrichment/EntityExtractor');
const DatabaseManager = require('../database/DatabaseManager');
const logger = require('../utils/logger');

/**
 * Service for managing entity extraction from documents
 */
class EntityExtractionService {
  constructor(options = {}) {
    this.db = null;
    this.extractor = new EntityExtractor(options.extractorOptions);
    this.batchSize = options.batchSize || 10;
    
    // Lazy load database
    this._getDb = () => {
      if (!this.db) {
        this.db = new DatabaseManager();
      }
      return this.db;
    };
    
    // Load custom patterns on initialization (delayed)
    setTimeout(() => {
      this._loadCustomPatterns().catch(err => {
        logger.error('Failed to load custom patterns:', err);
      });
    }, 100);
  }
  
  /**
   * Process a single document for entity extraction
   */
  async processDocument(document) {
    const startTime = Date.now();
    let jobId;
    
    try {
      // Create extraction job
      const jobResult = await this._getDb().query(`
        INSERT INTO entity_extraction_jobs (document_id, status, started_at)
        VALUES ($1, 'processing', NOW())
        RETURNING id
      `, [document.id]);
      
      jobId = jobResult.rows[0].id;
      
      // Extract entities
      const extractionResult = await this.extractor.extractFromDocument(document);
      const { entities } = extractionResult;
      
      // Count entities by type
      const entityCounts = {};
      
      // Insert entities into database
      const insertPromises = [];
      
      for (const entityType in entities) {
        const entityList = entities[entityType];
        
        for (const entity of entityList) {
          const entityText = entity.name || entity.text || entity.address || entity.url || entity.number;
          const entityValue = this._extractEntityValue(entity, entityType);
          
          if (!entityText) continue;
          
          // Count entities
          const dbType = this._mapEntityType(entityType);
          entityCounts[dbType] = (entityCounts[dbType] || 0) + 1;
          
          insertPromises.push(
            this._getDb().query(`
              INSERT INTO extracted_entities 
              (document_id, entity_type, entity_text, entity_value, confidence, metadata)
              VALUES ($1, $2, $3, $4, $5, $6)
              ON CONFLICT DO NOTHING
            `, [
              document.id,
              dbType,
              entityText,
              entityValue,
              entity.confidence || 1.0,
              JSON.stringify(entity.metadata || {})
            ])
          );
        }
      }
      
      // Execute all inserts
      await Promise.all(insertPromises);
      
      const processingTime = Date.now() - startTime;
      
      // Update job status
      await this._getDb().query(`
        UPDATE entity_extraction_jobs
        SET status = 'completed',
            completed_at = NOW(),
            entity_counts = $1,
            processing_time_ms = $2
        WHERE id = $3
      `, [JSON.stringify(entityCounts), processingTime, jobId]);
      
      logger.info('Entity extraction completed', {
        documentId: document.id,
        jobId,
        entityCounts,
        processingTime
      });
      
      return {
        success: true,
        jobId,
        entityCounts,
        processingTime
      };
      
    } catch (error) {
      logger.error('Entity extraction failed:', error);
      
      // Update job status to failed
      if (jobId) {
        await this._getDb().query(`
          UPDATE entity_extraction_jobs
          SET status = 'failed',
              completed_at = NOW(),
              error_message = $1
          WHERE id = $2
        `, [error.message, jobId]);
      }
      
      return {
        success: false,
        error: error.message,
        jobId
      };
    }
  }
  
  /**
   * Get entities for a document
   */
  async getDocumentEntities(documentId, options = {}) {
    const {
      types = null,
      minConfidence = 0.7,
      limit = null,
      offset = 0
    } = options;
    
    let query = `
      SELECT * FROM extracted_entities
      WHERE document_id = $1
        AND confidence >= $2
    `;
    
    const params = [documentId, minConfidence];
    
    if (types && types.length > 0) {
      query += ` AND entity_type = ANY($${params.length + 1})`;
      params.push(types);
    }
    
    query += ' ORDER BY confidence DESC, created_at DESC';
    
    if (limit) {
      query += ` LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
      params.push(limit, offset);
    }
    
    const result = await this._getDb().query(query, params);
    
    return result.rows.map(row => ({
      id: row.id,
      type: row.entity_type,
      text: row.entity_text,
      value: row.entity_value,
      confidence: parseFloat(row.confidence),
      metadata: row.metadata,
      createdAt: row.created_at
    }));
  }
  
  /**
   * Search entities across all documents
   */
  async searchEntities(searchText, options = {}) {
    const {
      types = null,
      minConfidence = 0.7,
      limit = 20
    } = options;
    
    let query = `
      SELECT 
        entity_text,
        entity_type,
        COUNT(*) as occurrence_count,
        COUNT(DISTINCT document_id) as document_count,
        AVG(confidence) as avg_confidence
      FROM extracted_entities
      WHERE LOWER(entity_text) LIKE LOWER($1)
        AND confidence >= $2
    `;
    
    const params = [`%${searchText}%`, minConfidence];
    
    if (types && types.length > 0) {
      query += ` AND entity_type = ANY($${params.length + 1})`;
      params.push(types);
    }
    
    query += `
      GROUP BY entity_text, entity_type
      ORDER BY occurrence_count DESC
      LIMIT $${params.length + 1}
    `;
    params.push(limit);
    
    const result = await this._getDb().query(query, params);
    
    return result.rows.map(row => ({
      text: row.entity_text,
      type: row.entity_type,
      occurrences: parseInt(row.occurrence_count),
      documents: parseInt(row.document_count),
      avgConfidence: parseFloat(row.avg_confidence)
    }));
  }
  
  /**
   * Get entity statistics
   */
  async getEntityStatistics(options = {}) {
    const { documentId = null } = options;
    
    let query = `
      SELECT 
        entity_type,
        COUNT(*) as total_count,
        COUNT(DISTINCT entity_text) as unique_count,
        AVG(confidence) as avg_confidence
      FROM extracted_entities
    `;
    
    const params = [];
    
    if (documentId) {
      query += ' WHERE document_id = $1';
      params.push(documentId);
    }
    
    query += ' GROUP BY entity_type ORDER BY total_count DESC';
    
    const result = await this._getDb().query(query, params);
    
    return result.rows.map(row => ({
      type: row.entity_type,
      totalCount: parseInt(row.total_count),
      uniqueCount: parseInt(row.unique_count),
      avgConfidence: parseFloat(row.avg_confidence)
    }));
  }
  
  /**
   * Add custom extraction pattern
   */
  async addCustomPattern(patternData) {
    const { name, pattern, entityType, description } = patternData;
    
    const result = await this._getDb().query(`
      INSERT INTO custom_entity_patterns (name, pattern, entity_type, description)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (name) DO UPDATE
      SET pattern = $2, entity_type = $3, description = $4, updated_at = NOW()
      RETURNING *
    `, [name, pattern, entityType, description]);
    
    const customPattern = result.rows[0];
    
    // Add to extractor
    this.extractor.addCustomPattern(entityType, pattern);
    
    return customPattern;
  }
  
  /**
   * Get custom patterns
   */
  async getCustomPatterns(activeOnly = true) {
    const query = activeOnly
      ? 'SELECT * FROM custom_entity_patterns WHERE is_active = true'
      : 'SELECT * FROM custom_entity_patterns';
    
    const result = await this._getDb().query(query);
    return result.rows;
  }
  
  /**
   * Create entity relationship
   */
  async createEntityRelationship(sourceId, targetId, relationshipType, confidence = 0.8, metadata = {}) {
    const result = await this._getDb().query(`
      INSERT INTO entity_relationships 
      (source_entity_id, target_entity_id, relationship_type, confidence, metadata)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (source_entity_id, target_entity_id, relationship_type) 
      DO UPDATE SET confidence = $4, metadata = $5
      RETURNING *
    `, [sourceId, targetId, relationshipType, confidence, JSON.stringify(metadata)]);
    
    return result.rows[0];
  }
  
  /**
   * Get entity relationships
   */
  async getEntityRelationships(entityId) {
    const result = await this._getDb().query(`
      SELECT 
        er.*,
        se.entity_text as source_text,
        se.entity_type as source_type,
        te.entity_text as target_text,
        te.entity_type as target_type
      FROM entity_relationships er
      JOIN extracted_entities se ON er.source_entity_id = se.id
      JOIN extracted_entities te ON er.target_entity_id = te.id
      WHERE er.source_entity_id = $1 OR er.target_entity_id = $1
      ORDER BY er.confidence DESC
    `, [entityId]);
    
    return result.rows;
  }
  
  /**
   * Process multiple documents in batch
   */
  async processBatch(documents, options = {}) {
    const results = [];
    
    // Process in chunks
    for (let i = 0; i < documents.length; i += this.batchSize) {
      const batch = documents.slice(i, i + this.batchSize);
      
      const batchResults = await Promise.all(
        batch.map(doc => this.processDocument(doc))
      );
      
      results.push(...batchResults);
    }
    
    return results;
  }
  
  /**
   * Get pending extraction jobs
   */
  async getPendingJobs(limit = 10) {
    const result = await this._getDb().query(`
      SELECT j.*, d.title, d.content
      FROM entity_extraction_jobs j
      JOIN documents d ON j.document_id = d.id
      WHERE j.status = 'pending'
      ORDER BY j.created_at ASC
      LIMIT $1
    `, [limit]);
    
    return result.rows;
  }
  
  /**
   * Process pending jobs
   */
  async processPendingJobs() {
    const jobs = await this.getPendingJobs();
    
    const results = await Promise.all(
      jobs.map(job => this.processDocument({
        id: job.document_id,
        title: job.title,
        content: job.content
      }))
    );
    
    return results;
  }
  
  /**
   * Load custom patterns from database
   */
  async _loadCustomPatterns() {
    const patterns = await this.getCustomPatterns(true);
    
    for (const pattern of patterns) {
      this.extractor.addCustomPattern(pattern.entity_type, pattern.pattern);
    }
    
    logger.info(`Loaded ${patterns.length} custom entity patterns`);
  }
  
  /**
   * Map entity types from extractor to database enum
   */
  _mapEntityType(extractorType) {
    const typeMap = {
      'persons': 'PERSON',
      'organizations': 'ORGANIZATION',
      'locations': 'LOCATION',
      'dates': 'DATE',
      'times': 'TIME',
      'emails': 'EMAIL',
      'urls': 'URL',
      'money': 'MONEY',
      'phones': 'PHONE',
      'custom': 'CUSTOM'
    };
    
    return typeMap[extractorType] || 'CUSTOM';
  }
  
  /**
   * Extract structured value from entity
   */
  _extractEntityValue(entity, entityType) {
    const value = {};
    
    switch (entityType) {
    case 'dates':
      if (entity.parsed) value.parsed = entity.parsed;
      if (entity.relative) value.relative = entity.relative;
      break;
        
    case 'money':
      if (entity.amount) value.amount = entity.amount;
      if (entity.currency) value.currency = entity.currency;
      break;
        
    case 'emails':
      if (entity.address) value.address = entity.address;
      break;
        
    case 'urls':
      if (entity.url) value.url = entity.url;
      break;
        
    case 'phones':
      if (entity.number) value.number = entity.number;
      break;
    }
    
    return Object.keys(value).length > 0 ? JSON.stringify(value) : null;
  }
}

module.exports = EntityExtractionService;