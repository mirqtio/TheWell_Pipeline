const EventEmitter = require('events');
const logger = require('../utils/logger');
const CacheManager = require('../cache/CacheManager');
const DatabaseManager = require('../database/DatabaseManager');

/**
 * VisualizationService - Service for data transformation, aggregation and caching
 * Prepares data for visualization components
 */
class VisualizationService extends EventEmitter {
  constructor() {
    super();
    this.cache = new CacheManager('visualization');
    this.db = null;
    this.aggregationPipelines = new Map();
    this.transformers = new Map();
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;

    try {
      // Initialize database connection
      this.db = DatabaseManager.getInstance();
      await this.db.initialize();

      // Register built-in transformers
      this.registerTransformer('network', this.transformToNetwork.bind(this));
      this.registerTransformer('heatmap', this.transformToHeatmap.bind(this));
      this.registerTransformer('treemap', this.transformToTreemap.bind(this));
      this.registerTransformer('sankey', this.transformToSankey.bind(this));
      this.registerTransformer('wordcloud', this.transformToWordCloud.bind(this));
      this.registerTransformer('timeline', this.transformToTimeline.bind(this));
      this.registerTransformer('geomap', this.transformToGeomap.bind(this));
      this.registerTransformer('chart', this.transformToChart.bind(this));

      // Register aggregation pipelines
      this.registerAggregationPipeline('documentStats', this.aggregateDocumentStats.bind(this));
      this.registerAggregationPipeline('entityRelations', this.aggregateEntityRelations.bind(this));
      this.registerAggregationPipeline('temporalDistribution', this.aggregateTemporalDistribution.bind(this));
      this.registerAggregationPipeline('categoryBreakdown', this.aggregateCategoryBreakdown.bind(this));

      this.initialized = true;
      logger.info('VisualizationService initialized');
    } catch (error) {
      logger.error('Failed to initialize VisualizationService:', error);
      throw error;
    }
  }

  /**
   * Register a data transformer
   */
  registerTransformer(type, transformer) {
    this.transformers.set(type, transformer);
    logger.info(`Registered transformer: ${type}`);
  }

  /**
   * Register an aggregation pipeline
   */
  registerAggregationPipeline(name, pipeline) {
    this.aggregationPipelines.set(name, pipeline);
    logger.info(`Registered aggregation pipeline: ${name}`);
  }

  /**
   * Get visualization data with caching
   */
  async getVisualizationData(type, query = {}, options = {}) {
    const cacheKey = this.generateCacheKey(type, query, options);
    
    // Check cache first
    if (!options.noCache) {
      const cached = await this.cache.get(cacheKey);
      if (cached) {
        logger.info(`Cache hit for visualization data: ${type}`);
        return cached;
      }
    }

    try {
      // Fetch and transform data
      const rawData = await this.fetchRawData(query, options);
      const transformedData = await this.transformData(type, rawData, options);
      
      // Cache the result
      const ttl = options.cacheTTL || 3600; // 1 hour default
      await this.cache.set(cacheKey, transformedData, ttl);
      
      return transformedData;
    } catch (error) {
      logger.error(`Failed to get visualization data for ${type}:`, error);
      throw error;
    }
  }

  /**
   * Generate cache key
   */
  generateCacheKey(type, query, options) {
    const queryStr = JSON.stringify(query);
    const optionsStr = JSON.stringify(options);
    return `viz:${type}:${Buffer.from(queryStr).toString('base64')}:${Buffer.from(optionsStr).toString('base64')}`;
  }

  /**
   * Fetch raw data based on query
   */
  async fetchRawData(query, options) {
    const { source, filters = {}, limit = 1000, offset = 0 } = query;

    switch (source) {
    case 'documents':
      return this.fetchDocuments(filters, limit, offset);
    case 'feedback':
      return this.fetchFeedback(filters, limit, offset);
    case 'jobs':
      return this.fetchJobs(filters, limit, offset);
    case 'entities':
      return this.fetchEntities(filters, limit, offset);
    default:
      throw new Error(`Unknown data source: ${source}`);
    }
  }

  /**
   * Transform data for specific visualization type
   */
  async transformData(type, rawData, options) {
    const transformer = this.transformers.get(type);
    if (!transformer) {
      throw new Error(`No transformer registered for type: ${type}`);
    }

    return transformer(rawData, options);
  }

  /**
   * Fetch documents from database
   */
  async fetchDocuments(filters, limit, offset) {
    const query = {
      where: {},
      limit,
      offset,
      include: ['source', 'feedback']
    };

    if (filters.dateRange) {
      query.where.created_at = {
        $gte: filters.dateRange.start,
        $lte: filters.dateRange.end
      };
    }

    if (filters.sourceId) {
      query.where.source_id = filters.sourceId;
    }

    if (filters.status) {
      query.where.status = filters.status;
    }

    return this.db.query('documents', query);
  }

  /**
   * Fetch feedback data
   */
  async fetchFeedback(filters, limit, offset) {
    const query = {
      where: {},
      limit,
      offset,
      include: ['document', 'user']
    };

    if (filters.rating) {
      query.where.rating = filters.rating;
    }

    if (filters.dateRange) {
      query.where.created_at = {
        $gte: filters.dateRange.start,
        $lte: filters.dateRange.end
      };
    }

    return this.db.query('document_feedback', query);
  }

  /**
   * Fetch jobs data
   */
  async fetchJobs(filters, limit, offset) {
    const query = {
      where: {},
      limit,
      offset,
      include: ['logs']
    };

    if (filters.status) {
      query.where.status = filters.status;
    }

    if (filters.type) {
      query.where.type = filters.type;
    }

    return this.db.query('jobs', query);
  }

  /**
   * Fetch entities from documents
   */
  async fetchEntities(filters, limit, offset) {
    // Simplified entity extraction from document metadata
    const documents = await this.fetchDocuments(filters, limit, offset);
    const entities = [];

    documents.forEach(doc => {
      if (doc.metadata?.entities) {
        entities.push(...doc.metadata.entities);
      }
    });

    return entities;
  }

  /**
   * Transform data to network format
   */
  async transformToNetwork(data, options) {
    const nodes = new Map();
    const links = [];

    // Extract entities and relationships
    data.forEach(item => {
      if (item.metadata?.entities) {
        item.metadata.entities.forEach(entity => {
          if (!nodes.has(entity.id)) {
            nodes.set(entity.id, {
              id: entity.id,
              label: entity.name,
              type: entity.type,
              value: 1
            });
          } else {
            nodes.get(entity.id).value++;
          }
        });

        // Create links between entities in same document
        const entities = item.metadata.entities;
        for (let i = 0; i < entities.length - 1; i++) {
          for (let j = i + 1; j < entities.length; j++) {
            links.push({
              source: entities[i].id,
              target: entities[j].id,
              weight: 1
            });
          }
        }
      }
    });

    return {
      nodes: Array.from(nodes.values()),
      links: this.aggregateLinks(links)
    };
  }

  /**
   * Aggregate duplicate links
   */
  aggregateLinks(links) {
    const linkMap = new Map();

    links.forEach(link => {
      const key = `${link.source}-${link.target}`;
      const reverseKey = `${link.target}-${link.source}`;
      
      if (linkMap.has(key)) {
        linkMap.get(key).weight++;
      } else if (linkMap.has(reverseKey)) {
        linkMap.get(reverseKey).weight++;
      } else {
        linkMap.set(key, { ...link });
      }
    });

    return Array.from(linkMap.values());
  }

  /**
   * Transform data to heatmap format
   */
  async transformToHeatmap(data, options) {
    const { xField = 'hour', yField = 'day', valueField = 'count' } = options;
    
    // Create matrix structure
    const matrix = {};
    const rows = new Set();
    const columns = new Set();

    data.forEach(item => {
      const x = this.extractField(item, xField);
      const y = this.extractField(item, yField);
      const value = this.extractField(item, valueField);

      if (x && y) {
        rows.add(y);
        columns.add(x);
        
        if (!matrix[y]) matrix[y] = {};
        matrix[y][x] = (matrix[y][x] || 0) + (value || 1);
      }
    });

    // Convert to array format
    const rowArray = Array.from(rows).sort();
    const colArray = Array.from(columns).sort();
    const values = rowArray.map(row => 
      colArray.map(col => matrix[row]?.[col] || 0)
    );

    return {
      rows: rowArray,
      columns: colArray,
      values
    };
  }

  /**
   * Transform data to treemap format
   */
  async transformToTreemap(data, options) {
    const { groupBy = 'category', valueField = 'size' } = options;
    
    const groups = {};

    data.forEach(item => {
      const group = this.extractField(item, groupBy) || 'Other';
      const value = this.extractField(item, valueField) || 1;

      if (!groups[group]) {
        groups[group] = {
          name: group,
          children: []
        };
      }

      groups[group].children.push({
        name: item.title || item.name || 'Item',
        value,
        data: item
      });
    });

    return {
      name: 'root',
      children: Object.values(groups)
    };
  }

  /**
   * Transform data to sankey format
   */
  async transformToSankey(data, options) {
    const { sourceField = 'source', targetField = 'target', valueField = 'value' } = options;
    
    const nodes = new Map();
    const links = [];

    data.forEach(item => {
      const source = this.extractField(item, sourceField);
      const target = this.extractField(item, targetField);
      const value = this.extractField(item, valueField) || 1;

      if (source && target) {
        // Add nodes
        if (!nodes.has(source)) {
          nodes.set(source, { id: source, name: source });
        }
        if (!nodes.has(target)) {
          nodes.set(target, { id: target, name: target });
        }

        // Add link
        links.push({ source, target, value });
      }
    });

    return {
      nodes: Array.from(nodes.values()),
      links
    };
  }

  /**
   * Transform data to word cloud format
   */
  async transformToWordCloud(data, options) {
    const { textField = 'content', minCount = 2 } = options;
    
    const wordCounts = {};

    data.forEach(item => {
      const text = this.extractField(item, textField);
      if (text) {
        // Simple word extraction
        const words = text.toLowerCase().match(/\b\w+\b/g) || [];
        words.forEach(word => {
          if (word.length > 3) { // Skip short words
            wordCounts[word] = (wordCounts[word] || 0) + 1;
          }
        });
      }
    });

    // Convert to array and filter by minCount
    return Object.entries(wordCounts)
      .filter(([word, count]) => count >= minCount)
      .map(([word, count]) => ({ text: word, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 100); // Top 100 words
  }

  /**
   * Transform data to timeline format
   */
  async transformToTimeline(data, options) {
    const { dateField = 'created_at', titleField = 'title' } = options;
    
    return data
      .filter(item => this.extractField(item, dateField))
      .map(item => ({
        start: this.extractField(item, dateField),
        end: item.end_date || null,
        title: this.extractField(item, titleField) || 'Event',
        category: item.category || item.type || 'default',
        data: item
      }))
      .sort((a, b) => new Date(a.start) - new Date(b.start));
  }

  /**
   * Transform data to geomap format
   */
  async transformToGeomap(data, options) {
    const { latField = 'latitude', lonField = 'longitude', valueField = 'value' } = options;
    
    return {
      type: options.mapType || 'points',
      features: data
        .filter(item => 
          this.extractField(item, latField) && 
          this.extractField(item, lonField)
        )
        .map(item => ({
          coordinates: [
            this.extractField(item, lonField),
            this.extractField(item, latField)
          ],
          value: this.extractField(item, valueField) || 1,
          name: item.name || item.title,
          data: item
        }))
    };
  }

  /**
   * Transform data to chart format
   */
  async transformToChart(data, options) {
    const { chartType = 'line', xField = 'date', yField = 'value', groupBy } = options;
    
    if (groupBy) {
      // Multiple series
      const groups = {};
      
      data.forEach(item => {
        const group = this.extractField(item, groupBy);
        if (!groups[group]) {
          groups[group] = [];
        }
        
        groups[group].push({
          x: this.extractField(item, xField),
          y: this.extractField(item, yField)
        });
      });
      
      return {
        datasets: Object.entries(groups).map(([label, data]) => ({
          label,
          data: data.map(d => d.y),
          _xValues: data.map(d => d.x)
        })),
        labels: groups[Object.keys(groups)[0]].map(d => d.x)
      };
    } else {
      // Single series
      return {
        labels: data.map(item => this.extractField(item, xField)),
        datasets: [{
          label: yField,
          data: data.map(item => this.extractField(item, yField))
        }]
      };
    }
  }

  /**
   * Extract field value from object (supports nested paths)
   */
  extractField(obj, field) {
    const parts = field.split('.');
    let value = obj;
    
    for (const part of parts) {
      value = value?.[part];
      if (value === undefined) break;
    }
    
    return value;
  }

  /**
   * Aggregate document statistics
   */
  async aggregateDocumentStats(filters = {}) {
    const stats = {
      total: 0,
      byStatus: {},
      bySource: {},
      timeline: []
    };

    const documents = await this.fetchDocuments(filters, 10000, 0);
    
    documents.forEach(doc => {
      stats.total++;
      
      // By status
      stats.byStatus[doc.status] = (stats.byStatus[doc.status] || 0) + 1;
      
      // By source
      const sourceName = doc.source?.name || 'Unknown';
      stats.bySource[sourceName] = (stats.bySource[sourceName] || 0) + 1;
    });

    // Timeline aggregation
    const timelineMap = {};
    documents.forEach(doc => {
      const date = new Date(doc.created_at).toISOString().split('T')[0];
      timelineMap[date] = (timelineMap[date] || 0) + 1;
    });
    
    stats.timeline = Object.entries(timelineMap)
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    return stats;
  }

  /**
   * Aggregate entity relations
   */
  async aggregateEntityRelations(filters = {}) {
    const entities = await this.fetchEntities(filters, 10000, 0);
    
    // Count co-occurrences
    const coOccurrences = {};
    const entityCounts = {};

    entities.forEach(batch => {
      if (Array.isArray(batch)) {
        batch.forEach(entity => {
          entityCounts[entity.id] = (entityCounts[entity.id] || 0) + 1;
        });

        // Count pairs
        for (let i = 0; i < batch.length - 1; i++) {
          for (let j = i + 1; j < batch.length; j++) {
            const key = [batch[i].id, batch[j].id].sort().join('-');
            coOccurrences[key] = (coOccurrences[key] || 0) + 1;
          }
        }
      }
    });

    return {
      entities: entityCounts,
      relations: coOccurrences
    };
  }

  /**
   * Aggregate temporal distribution
   */
  async aggregateTemporalDistribution(filters = {}) {
    const documents = await this.fetchDocuments(filters, 10000, 0);
    
    const distribution = {
      hourly: Array(24).fill(0),
      daily: Array(7).fill(0),
      monthly: Array(12).fill(0)
    };

    documents.forEach(doc => {
      const date = new Date(doc.created_at);
      distribution.hourly[date.getHours()]++;
      distribution.daily[date.getDay()]++;
      distribution.monthly[date.getMonth()]++;
    });

    return distribution;
  }

  /**
   * Aggregate category breakdown
   */
  async aggregateCategoryBreakdown(filters = {}) {
    const documents = await this.fetchDocuments(filters, 10000, 0);
    
    const categories = {};
    const hierarchical = {
      name: 'root',
      children: []
    };

    documents.forEach(doc => {
      const category = doc.metadata?.category || 'Uncategorized';
      const subcategory = doc.metadata?.subcategory || 'General';
      
      if (!categories[category]) {
        categories[category] = {
          count: 0,
          subcategories: {}
        };
      }
      
      categories[category].count++;
      categories[category].subcategories[subcategory] = 
        (categories[category].subcategories[subcategory] || 0) + 1;
    });

    // Convert to hierarchical format
    Object.entries(categories).forEach(([cat, data]) => {
      hierarchical.children.push({
        name: cat,
        value: data.count,
        children: Object.entries(data.subcategories).map(([subcat, count]) => ({
          name: subcat,
          value: count
        }))
      });
    });

    return {
      flat: categories,
      hierarchical
    };
  }

  /**
   * Export visualization data
   */
  async exportData(type, data, format = 'json') {
    switch (format) {
    case 'json':
      return JSON.stringify(data, null, 2);
      
    case 'csv':
      return this.convertToCSV(data);
      
    case 'excel':
      return this.convertToExcel(data);
      
    default:
      throw new Error(`Unsupported export format: ${format}`);
    }
  }

  /**
   * Convert data to CSV format
   */
  convertToCSV(data) {
    if (Array.isArray(data) && data.length > 0) {
      const headers = Object.keys(data[0]);
      const rows = data.map(item => 
        headers.map(header => {
          const value = item[header];
          return typeof value === 'string' && value.includes(',') 
            ? `"${value}"` 
            : value;
        }).join(',')
      );
      
      return [headers.join(','), ...rows].join('\n');
    }
    
    return '';
  }

  /**
   * Convert data to Excel format (placeholder)
   */
  async convertToExcel(data) {
    // This would require a library like exceljs
    // For now, return CSV as fallback
    return this.convertToCSV(data);
  }

  /**
   * Clear visualization cache
   */
  async clearCache(pattern) {
    if (pattern) {
      await this.cache.deletePattern(`viz:${pattern}*`);
    } else {
      await this.cache.deletePattern('viz:*');
    }
    
    logger.info(`Cleared visualization cache${pattern ? ` for pattern: ${pattern}` : ''}`);
  }
}

module.exports = VisualizationService;