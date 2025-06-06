const EventEmitter = require('events');
const logger = require('../utils/logger');

/**
 * DataAggregator - Handles complex data aggregation for visualizations
 * Provides efficient processing of large datasets with streaming support
 */
class DataAggregator extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      batchSize: options.batchSize || 1000,
      streamThreshold: options.streamThreshold || 10000,
      maxMemoryUsage: options.maxMemoryUsage || 100 * 1024 * 1024, // 100MB
      enableCaching: options.enableCaching !== false,
      ...options
    };
    
    this.aggregators = new Map();
    this.activeStreams = new Map();
    
    // Register built-in aggregators
    this.registerBuiltinAggregators();
  }

  /**
   * Register built-in aggregation functions
   */
  registerBuiltinAggregators() {
    // Time-based aggregators
    this.registerAggregator('timeSeriesGroup', this.timeSeriesGroup.bind(this));
    this.registerAggregator('rollingWindow', this.rollingWindow.bind(this));
    this.registerAggregator('temporalBuckets', this.temporalBuckets.bind(this));
    
    // Statistical aggregators
    this.registerAggregator('histogram', this.histogram.bind(this));
    this.registerAggregator('percentiles', this.percentiles.bind(this));
    this.registerAggregator('correlation', this.correlation.bind(this));
    
    // Grouping aggregators
    this.registerAggregator('groupBy', this.groupBy.bind(this));
    this.registerAggregator('pivot', this.pivot.bind(this));
    this.registerAggregator('hierarchy', this.hierarchy.bind(this));
    
    // Network aggregators
    this.registerAggregator('coOccurrence', this.coOccurrence.bind(this));
    this.registerAggregator('graphMetrics', this.graphMetrics.bind(this));
    
    // Text aggregators
    this.registerAggregator('termFrequency', this.termFrequency.bind(this));
    this.registerAggregator('topicModeling', this.topicModeling.bind(this));
  }

  /**
   * Register a custom aggregator
   */
  registerAggregator(name, aggregator) {
    this.aggregators.set(name, aggregator);
    logger.info(`Registered aggregator: ${name}`);
  }

  /**
   * Execute aggregation pipeline
   */
  async aggregate(data, pipeline, options = {}) {
    const startTime = Date.now();
    let result = data;
    
    try {
      // Determine if we should use streaming
      const useStreaming = Array.isArray(data) && 
                          data.length > this.options.streamThreshold;
      
      if (useStreaming) {
        result = await this.streamAggregate(data, pipeline, options);
      } else {
        // Execute pipeline stages sequentially
        for (const stage of pipeline) {
          result = await this.executeStage(result, stage, options);
        }
      }
      
      const duration = Date.now() - startTime;
      logger.info(`Aggregation completed in ${duration}ms`);
      
      this.emit('aggregation:complete', {
        pipeline,
        inputSize: Array.isArray(data) ? data.length : 1,
        outputSize: Array.isArray(result) ? result.length : 1,
        duration
      });
      
      return result;
    } catch (error) {
      logger.error('Aggregation failed:', error);
      this.emit('aggregation:error', { pipeline, error });
      throw error;
    }
  }

  /**
   * Execute a single aggregation stage
   */
  async executeStage(data, stage, options) {
    const { type, params = {} } = stage;
    
    const aggregator = this.aggregators.get(type);
    if (!aggregator) {
      throw new Error(`Unknown aggregator type: ${type}`);
    }
    
    return aggregator(data, params, options);
  }

  /**
   * Stream-based aggregation for large datasets
   */
  async streamAggregate(data, pipeline, options) {
    const streamId = `stream-${Date.now()}`;
    const stream = {
      id: streamId,
      data,
      pipeline,
      position: 0,
      accumulators: {},
      results: []
    };
    
    this.activeStreams.set(streamId, stream);
    
    try {
      // Process data in batches
      while (stream.position < data.length) {
        const batch = data.slice(
          stream.position,
          stream.position + this.options.batchSize
        );
        
        let batchResult = batch;
        for (const stage of pipeline) {
          batchResult = await this.executeStage(batchResult, stage, {
            ...options,
            isStreaming: true,
            streamId,
            accumulators: stream.accumulators
          });
        }
        
        stream.results.push(...(Array.isArray(batchResult) ? batchResult : [batchResult]));
        stream.position += batch.length;
        
        // Emit progress
        this.emit('aggregation:progress', {
          streamId,
          progress: stream.position / data.length,
          processed: stream.position,
          total: data.length
        });
        
        // Yield to prevent blocking
        await new Promise(resolve => setImmediate(resolve));
      }
      
      return stream.results;
    } finally {
      this.activeStreams.delete(streamId);
    }
  }

  /**
   * Time series grouping aggregator
   */
  async timeSeriesGroup(data, params, options) {
    const {
      dateField = 'created_at',
      interval = 'day', // 'hour', 'day', 'week', 'month'
      aggregations = { count: 'count' },
      fillGaps = true
    } = params;
    
    // Group by time interval
    const groups = {};
    
    data.forEach(item => {
      const date = new Date(item[dateField]);
      if (!isNaN(date.getTime())) {
        const key = this.getTimeKey(date, interval);
        if (!groups[key]) {
          groups[key] = [];
        }
        groups[key].push(item);
      }
    });
    
    // Apply aggregations
    const results = [];
    const sortedKeys = Object.keys(groups).sort();
    
    // Fill gaps if requested
    if (fillGaps && sortedKeys.length > 1) {
      const filledKeys = this.fillTimeGaps(sortedKeys, interval);
      filledKeys.forEach(key => {
        const group = groups[key] || [];
        results.push(this.applyAggregations(key, group, aggregations));
      });
    } else {
      sortedKeys.forEach(key => {
        results.push(this.applyAggregations(key, groups[key], aggregations));
      });
    }
    
    return results;
  }

  /**
   * Rolling window aggregator
   */
  async rollingWindow(data, params, options) {
    const {
      windowSize = 7,
      dateField = 'created_at',
      valueField = 'value',
      operation = 'mean' // 'sum', 'mean', 'min', 'max', 'std'
    } = params;
    
    // Sort by date
    const sorted = [...data].sort((a, b) => 
      new Date(a[dateField]) - new Date(b[dateField])
    );
    
    const results = [];
    
    for (let i = 0; i < sorted.length; i++) {
      const windowStart = Math.max(0, i - windowSize + 1);
      const window = sorted.slice(windowStart, i + 1);
      const values = window.map(item => item[valueField] || 0);
      
      results.push({
        ...sorted[i],
        [`${valueField}_${operation}`]: this.calculateStatistic(values, operation),
        window_size: window.length
      });
    }
    
    return results;
  }

  /**
   * Temporal buckets aggregator
   */
  async temporalBuckets(data, params, options) {
    const {
      dateField = 'created_at',
      buckets = [
        { name: 'last_hour', duration: 3600000 },
        { name: 'last_day', duration: 86400000 },
        { name: 'last_week', duration: 604800000 },
        { name: 'last_month', duration: 2592000000 }
      ]
    } = params;
    
    const now = Date.now();
    const results = {};
    
    buckets.forEach(bucket => {
      results[bucket.name] = data.filter(item => {
        const itemTime = new Date(item[dateField]).getTime();
        return now - itemTime <= bucket.duration;
      });
    });
    
    return results;
  }

  /**
   * Histogram aggregator
   */
  async histogram(data, params, options) {
    const {
      valueField = 'value',
      bins = 10,
      range = null
    } = params;
    
    const values = data.map(item => item[valueField]).filter(v => v != null);
    
    if (values.length === 0) {
      return [];
    }
    
    const min = range ? range[0] : Math.min(...values);
    const max = range ? range[1] : Math.max(...values);
    const binWidth = (max - min) / bins;
    
    const histogram = Array(bins).fill(null).map((_, i) => ({
      bin: i,
      range: [min + i * binWidth, min + (i + 1) * binWidth],
      count: 0,
      values: []
    }));
    
    values.forEach(value => {
      const binIndex = Math.min(Math.floor((value - min) / binWidth), bins - 1);
      if (binIndex >= 0 && binIndex < bins) {
        histogram[binIndex].count++;
        histogram[binIndex].values.push(value);
      }
    });
    
    return histogram;
  }

  /**
   * Percentiles aggregator
   */
  async percentiles(data, params, options) {
    const {
      valueField = 'value',
      percentiles = [0, 25, 50, 75, 90, 95, 99, 100]
    } = params;
    
    const values = data
      .map(item => item[valueField])
      .filter(v => v != null)
      .sort((a, b) => a - b);
    
    if (values.length === 0) {
      return {};
    }
    
    const results = {};
    
    percentiles.forEach(p => {
      const index = Math.floor((p / 100) * (values.length - 1));
      results[`p${p}`] = values[index];
    });
    
    return results;
  }

  /**
   * Correlation aggregator
   */
  async correlation(data, params, options) {
    const {
      xField = 'x',
      yField = 'y',
      method = 'pearson' // 'pearson', 'spearman'
    } = params;
    
    const pairs = data
      .filter(item => item[xField] != null && item[yField] != null)
      .map(item => ({ x: item[xField], y: item[yField] }));
    
    if (pairs.length < 2) {
      return { correlation: null, n: pairs.length };
    }
    
    let correlation;
    
    if (method === 'pearson') {
      correlation = this.pearsonCorrelation(
        pairs.map(p => p.x),
        pairs.map(p => p.y)
      );
    } else if (method === 'spearman') {
      correlation = this.spearmanCorrelation(
        pairs.map(p => p.x),
        pairs.map(p => p.y)
      );
    }
    
    return {
      correlation,
      n: pairs.length,
      method
    };
  }

  /**
   * Group by aggregator
   */
  async groupBy(data, params, options) {
    const {
      fields = [],
      aggregations = { count: 'count' }
    } = params;
    
    if (fields.length === 0) {
      return data;
    }
    
    const groups = {};
    
    data.forEach(item => {
      const key = fields.map(field => item[field] || 'null').join('|');
      if (!groups[key]) {
        groups[key] = {
          key,
          items: []
        };
        
        // Store group field values
        fields.forEach(field => {
          groups[key][field] = item[field];
        });
      }
      groups[key].items.push(item);
    });
    
    // Apply aggregations
    return Object.values(groups).map(group => {
      const result = { ...group };
      delete result.items;
      
      Object.entries(aggregations).forEach(([name, config]) => {
        result[name] = this.applyAggregation(group.items, config);
      });
      
      return result;
    });
  }

  /**
   * Pivot aggregator
   */
  async pivot(data, params, options) {
    const {
      rowField,
      columnField,
      valueField,
      aggregation = 'sum'
    } = params;
    
    const pivot = {};
    const columns = new Set();
    
    data.forEach(item => {
      const row = item[rowField] || 'null';
      const col = item[columnField] || 'null';
      const value = item[valueField] || 0;
      
      columns.add(col);
      
      if (!pivot[row]) {
        pivot[row] = {};
      }
      
      if (!pivot[row][col]) {
        pivot[row][col] = [];
      }
      
      pivot[row][col].push(value);
    });
    
    // Calculate aggregated values
    const results = [];
    
    Object.entries(pivot).forEach(([row, cols]) => {
      const result = { [rowField]: row };
      
      Array.from(columns).forEach(col => {
        const values = cols[col] || [];
        result[col] = this.calculateStatistic(values, aggregation);
      });
      
      results.push(result);
    });
    
    return results;
  }

  /**
   * Hierarchy aggregator
   */
  async hierarchy(data, params, options) {
    const {
      fields = [],
      valueField = 'value',
      aggregation = 'sum'
    } = params;
    
    if (fields.length === 0) {
      return { name: 'root', value: data.length, children: [] };
    }
    
    const root = { name: 'root', children: [] };
    
    data.forEach(item => {
      let current = root;
      
      fields.forEach((field, level) => {
        const value = item[field] || 'null';
        
        let child = current.children.find(c => c.name === value);
        if (!child) {
          child = {
            name: value,
            level,
            children: []
          };
          current.children.push(child);
        }
        
        current = child;
      });
      
      // Add value to leaf node
      if (!current.values) {
        current.values = [];
      }
      current.values.push(item[valueField] || 0);
    });
    
    // Calculate aggregated values recursively
    this.aggregateHierarchy(root, aggregation);
    
    return root;
  }

  /**
   * Co-occurrence aggregator for network analysis
   */
  async coOccurrence(data, params, options) {
    const {
      field = 'entities',
      minSupport = 2,
      normalized = false
    } = params;
    
    const coOccurrences = {};
    const frequencies = {};
    
    data.forEach(item => {
      const entities = Array.isArray(item[field]) ? item[field] : [];
      
      // Count individual frequencies
      entities.forEach(entity => {
        frequencies[entity] = (frequencies[entity] || 0) + 1;
      });
      
      // Count co-occurrences
      for (let i = 0; i < entities.length - 1; i++) {
        for (let j = i + 1; j < entities.length; j++) {
          const pair = [entities[i], entities[j]].sort().join('|');
          coOccurrences[pair] = (coOccurrences[pair] || 0) + 1;
        }
      }
    });
    
    // Convert to network format
    const nodes = Object.entries(frequencies)
      .filter(([entity, freq]) => freq >= minSupport)
      .map(([entity, freq]) => ({ id: entity, value: freq }));
    
    const links = Object.entries(coOccurrences)
      .filter(([pair, count]) => count >= minSupport)
      .map(([pair, count]) => {
        const [source, target] = pair.split('|');
        let weight = count;
        
        if (normalized) {
          // Normalize by minimum frequency
          weight = count / Math.min(frequencies[source], frequencies[target]);
        }
        
        return { source, target, weight };
      });
    
    return { nodes, links };
  }

  /**
   * Term frequency aggregator
   */
  async termFrequency(data, params, options) {
    const {
      textField = 'content',
      minLength = 3,
      maxTerms = 100,
      stopWords = this.getDefaultStopWords()
    } = params;
    
    const termCounts = {};
    
    data.forEach(item => {
      const text = item[textField];
      if (!text) return;
      
      // Simple tokenization
      const terms = text.toLowerCase()
        .match(/\b\w+\b/g) || [];
      
      terms.forEach(term => {
        if (term.length >= minLength && !stopWords.includes(term)) {
          termCounts[term] = (termCounts[term] || 0) + 1;
        }
      });
    });
    
    // Sort and limit
    return Object.entries(termCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxTerms)
      .map(([term, count]) => ({ term, count }));
  }

  /**
   * Helper: Get time key for grouping
   */
  getTimeKey(date, interval) {
    switch (interval) {
    case 'hour':
      return date.toISOString().slice(0, 13) + ':00:00.000Z';
    case 'day':
      return date.toISOString().slice(0, 10);
    case 'week': {
      const week = this.getWeekNumber(date);
      return `${date.getFullYear()}-W${week}`;
    }
    case 'month':
      return date.toISOString().slice(0, 7);
    default:
      return date.toISOString();
    }
  }

  /**
   * Helper: Get week number
   */
  getWeekNumber(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  }

  /**
   * Helper: Fill time gaps
   */
  fillTimeGaps(keys, interval) {
    if (keys.length < 2) return keys;
    
    const filled = [];
    const start = new Date(keys[0]);
    const end = new Date(keys[keys.length - 1]);
    
    let current = new Date(start);
    while (current <= end) {
      filled.push(this.getTimeKey(current, interval));
      
      switch (interval) {
      case 'hour':
        current.setHours(current.getHours() + 1);
        break;
      case 'day':
        current.setDate(current.getDate() + 1);
        break;
      case 'week':
        current.setDate(current.getDate() + 7);
        break;
      case 'month':
        current.setMonth(current.getMonth() + 1);
        break;
      }
    }
    
    return filled;
  }

  /**
   * Helper: Apply aggregations to a group
   */
  applyAggregations(key, items, aggregations) {
    const result = { time: key };
    
    Object.entries(aggregations).forEach(([name, config]) => {
      result[name] = this.applyAggregation(items, config);
    });
    
    return result;
  }

  /**
   * Helper: Apply single aggregation
   */
  applyAggregation(items, config) {
    if (config === 'count') {
      return items.length;
    }
    
    if (typeof config === 'string') {
      const values = items.map(item => item[config]).filter(v => v != null);
      return this.calculateStatistic(values, 'sum');
    }
    
    const { field, operation = 'sum' } = config;
    const values = items.map(item => item[field]).filter(v => v != null);
    
    return this.calculateStatistic(values, operation);
  }

  /**
   * Helper: Calculate statistics
   */
  calculateStatistic(values, operation) {
    if (values.length === 0) return null;
    
    switch (operation) {
    case 'sum':
      return values.reduce((a, b) => a + b, 0);
    case 'mean':
    case 'avg':
      return values.reduce((a, b) => a + b, 0) / values.length;
    case 'min':
      return Math.min(...values);
    case 'max':
      return Math.max(...values);
    case 'std': {
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
      return Math.sqrt(variance);
    }
    case 'count':
      return values.length;
    default:
      return null;
    }
  }

  /**
   * Helper: Pearson correlation
   */
  pearsonCorrelation(x, y) {
    const n = x.length;
    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
    const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0);
    const sumY2 = y.reduce((sum, yi) => sum + yi * yi, 0);
    
    const numerator = n * sumXY - sumX * sumY;
    const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
    
    return denominator === 0 ? 0 : numerator / denominator;
  }

  /**
   * Helper: Spearman correlation
   */
  spearmanCorrelation(x, y) {
    const rankX = this.rank(x);
    const rankY = this.rank(y);
    return this.pearsonCorrelation(rankX, rankY);
  }

  /**
   * Helper: Rank values
   */
  rank(values) {
    const sorted = values
      .map((value, index) => ({ value, index }))
      .sort((a, b) => a.value - b.value);
    
    const ranks = new Array(values.length);
    
    for (let i = 0; i < sorted.length; i++) {
      ranks[sorted[i].index] = i + 1;
    }
    
    return ranks;
  }

  /**
   * Helper: Aggregate hierarchy recursively
   */
  aggregateHierarchy(node, operation) {
    if (node.values) {
      node.value = this.calculateStatistic(node.values, operation);
      delete node.values;
    }
    
    if (node.children && node.children.length > 0) {
      node.children.forEach(child => this.aggregateHierarchy(child, operation));
      
      if (!node.value) {
        const childValues = node.children.map(c => c.value).filter(v => v != null);
        node.value = this.calculateStatistic(childValues, operation);
      }
    }
  }

  /**
   * Helper: Get default stop words
   */
  getDefaultStopWords() {
    return [
      'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have',
      'i', 'it', 'for', 'not', 'on', 'with', 'he', 'as', 'you',
      'do', 'at', 'this', 'but', 'his', 'by', 'from', 'they',
      'we', 'say', 'her', 'she', 'or', 'an', 'will', 'my', 'one',
      'all', 'would', 'there', 'their', 'what', 'so', 'up', 'out',
      'if', 'about', 'who', 'get', 'which', 'go', 'me', 'when',
      'make', 'can', 'like', 'time', 'no', 'just', 'him', 'know',
      'take', 'people', 'into', 'year', 'your', 'good', 'some',
      'could', 'them', 'see', 'other', 'than', 'then', 'now',
      'look', 'only', 'come', 'its', 'over', 'think', 'also',
      'back', 'after', 'use', 'two', 'how', 'our', 'work', 'first',
      'well', 'way', 'even', 'new', 'want', 'because', 'any',
      'these', 'give', 'day', 'most', 'us', 'is', 'was', 'are',
      'been', 'has', 'had', 'were', 'said', 'did', 'having', 'may',
      'am', 'being', 'does', 'doing', 'gone', 'got', 'going'
    ];
  }
}

module.exports = DataAggregator;