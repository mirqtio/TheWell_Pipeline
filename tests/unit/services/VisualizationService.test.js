const VisualizationService = require('../../../src/services/VisualizationService');
const CacheManager = require('../../../src/cache/CacheManager');
const DatabaseManager = require('../../../src/database/DatabaseManager');

jest.mock('../../../src/cache/CacheManager');
jest.mock('../../../src/database/DatabaseManager');

describe('VisualizationService', () => {
  let service;
  let mockCache;
  let mockDb;

  beforeEach(() => {
    // Reset mocks
    CacheManager.mockClear();
    DatabaseManager.mockClear();

    // Create mock instances
    mockCache = {
      get: jest.fn(),
      set: jest.fn(),
      deletePattern: jest.fn()
    };
    CacheManager.mockImplementation(() => mockCache);

    mockDb = {
      initialize: jest.fn().mockResolvedValue(true),
      query: jest.fn()
    };
    DatabaseManager.mockImplementation(() => mockDb);

    service = new VisualizationService();
  });

  describe('initialization', () => {
    it('should initialize successfully', async () => {
      await service.initialize();

      expect(service.initialized).toBe(true);
      expect(mockDb.initialize).toHaveBeenCalled();
      expect(service.transformers.size).toBeGreaterThan(0);
      expect(service.aggregationPipelines.size).toBeGreaterThan(0);
    });

    it('should register all built-in transformers', async () => {
      await service.initialize();

      const expectedTransformers = [
        'network', 'heatmap', 'treemap', 'sankey',
        'wordcloud', 'timeline', 'geomap', 'chart'
      ];

      expectedTransformers.forEach(type => {
        expect(service.transformers.has(type)).toBe(true);
      });
    });

    it('should register all aggregation pipelines', async () => {
      await service.initialize();

      const expectedPipelines = [
        'documentStats', 'entityRelations',
        'temporalDistribution', 'categoryBreakdown'
      ];

      expectedPipelines.forEach(pipeline => {
        expect(service.aggregationPipelines.has(pipeline)).toBe(true);
      });
    });

    it('should handle initialization errors', async () => {
      mockDb.initialize.mockRejectedValue(new Error('DB Error'));

      await expect(service.initialize()).rejects.toThrow('DB Error');
    });
  });

  describe('getVisualizationData', () => {
    beforeEach(async () => {
      await service.initialize();
    });

    it('should return cached data if available', async () => {
      const cachedData = { nodes: [], links: [] };
      mockCache.get.mockResolvedValue(cachedData);

      const result = await service.getVisualizationData('network', {
        source: 'documents'
      });

      expect(result).toEqual(cachedData);
      expect(mockCache.get).toHaveBeenCalled();
      expect(mockDb.query).not.toHaveBeenCalled();
    });

    it('should fetch and transform data if not cached', async () => {
      mockCache.get.mockResolvedValue(null);
      mockDb.query.mockResolvedValue([
        { id: 1, metadata: { entities: [{ id: 'e1', name: 'Entity 1' }] } }
      ]);

      const result = await service.getVisualizationData('network', {
        source: 'documents'
      });

      expect(mockDb.query).toHaveBeenCalled();
      expect(mockCache.set).toHaveBeenCalled();
      expect(result).toHaveProperty('nodes');
      expect(result).toHaveProperty('links');
    });

    it('should skip cache when noCache option is true', async () => {
      mockDb.query.mockResolvedValue([]);

      await service.getVisualizationData('chart', {
        source: 'documents'
      }, { noCache: true });

      expect(mockCache.get).not.toHaveBeenCalled();
      expect(mockDb.query).toHaveBeenCalled();
    });

    it('should handle unknown visualization type', async () => {
      mockCache.get.mockResolvedValue(null);
      mockDb.query.mockResolvedValue([]);

      await expect(
        service.getVisualizationData('unknown', {})
      ).rejects.toThrow('No transformer registered for type: unknown');
    });
  });

  describe('data fetching', () => {
    beforeEach(async () => {
      await service.initialize();
    });

    it('should fetch documents with filters', async () => {
      const filters = {
        dateRange: {
          start: '2024-01-01',
          end: '2024-01-31'
        },
        sourceId: 'source-123',
        status: 'processed'
      };

      await service.fetchDocuments(filters, 100, 0);

      expect(mockDb.query).toHaveBeenCalledWith('documents', {
        where: {
          created_at: {
            $gte: filters.dateRange.start,
            $lte: filters.dateRange.end
          },
          source_id: 'source-123',
          status: 'processed'
        },
        limit: 100,
        offset: 0,
        include: ['source', 'feedback']
      });
    });

    it('should fetch feedback data', async () => {
      const filters = { rating: 5 };

      await service.fetchFeedback(filters, 50, 0);

      expect(mockDb.query).toHaveBeenCalledWith('document_feedback', {
        where: { rating: 5 },
        limit: 50,
        offset: 0,
        include: ['document', 'user']
      });
    });

    it('should fetch jobs data', async () => {
      const filters = { status: 'completed', type: 'enrichment' };

      await service.fetchJobs(filters, 200, 0);

      expect(mockDb.query).toHaveBeenCalledWith('jobs', {
        where: { status: 'completed', type: 'enrichment' },
        limit: 200,
        offset: 0,
        include: ['logs']
      });
    });

    it('should handle unknown data source', async () => {
      mockCache.get.mockResolvedValue(null);

      await expect(
        service.getVisualizationData('chart', {
          source: 'unknown'
        })
      ).rejects.toThrow('Unknown data source: unknown');
    });
  });

  describe('data transformers', () => {
    beforeEach(async () => {
      await service.initialize();
    });

    describe('transformToNetwork', () => {
      it('should transform documents to network format', async () => {
        const data = [
          {
            id: 1,
            metadata: {
              entities: [
                { id: 'e1', name: 'Entity 1', type: 'person' },
                { id: 'e2', name: 'Entity 2', type: 'org' }
              ]
            }
          },
          {
            id: 2,
            metadata: {
              entities: [
                { id: 'e1', name: 'Entity 1', type: 'person' },
                { id: 'e3', name: 'Entity 3', type: 'location' }
              ]
            }
          }
        ];

        const result = await service.transformToNetwork(data, {});

        expect(result.nodes).toHaveLength(3);
        expect(result.nodes[0]).toEqual({
          id: 'e1',
          label: 'Entity 1',
          type: 'person',
          value: 2
        });
        expect(result.links).toHaveLength(2);
      });

      it('should handle documents without entities', async () => {
        const data = [
          { id: 1, metadata: {} },
          { id: 2 }
        ];

        const result = await service.transformToNetwork(data, {});

        expect(result.nodes).toHaveLength(0);
        expect(result.links).toHaveLength(0);
      });
    });

    describe('transformToHeatmap', () => {
      it('should transform data to heatmap format', async () => {
        const data = [
          { hour: 10, day: 'Monday', count: 5 },
          { hour: 10, day: 'Tuesday', count: 3 },
          { hour: 11, day: 'Monday', count: 7 }
        ];

        const result = await service.transformToHeatmap(data, {
          xField: 'hour',
          yField: 'day',
          valueField: 'count'
        });

        expect(result.rows).toEqual(['Monday', 'Tuesday']);
        expect(result.columns).toEqual([10, 11]);
        expect(result.values).toEqual([
          [5, 7],
          [3, 0]
        ]);
      });
    });

    describe('transformToTreemap', () => {
      it('should transform data to treemap format', async () => {
        const data = [
          { category: 'A', title: 'Doc1', size: 100 },
          { category: 'A', title: 'Doc2', size: 50 },
          { category: 'B', title: 'Doc3', size: 75 }
        ];

        const result = await service.transformToTreemap(data, {
          groupBy: 'category',
          valueField: 'size'
        });

        expect(result.name).toBe('root');
        expect(result.children).toHaveLength(2);
        expect(result.children[0].name).toBe('A');
        expect(result.children[0].children).toHaveLength(2);
      });
    });

    describe('transformToSankey', () => {
      it('should transform data to sankey format', async () => {
        const data = [
          { source: 'A', target: 'B', value: 10 },
          { source: 'A', target: 'C', value: 5 },
          { source: 'B', target: 'C', value: 3 }
        ];

        const result = await service.transformToSankey(data, {
          sourceField: 'source',
          targetField: 'target',
          valueField: 'value'
        });

        expect(result.nodes).toHaveLength(3);
        expect(result.links).toHaveLength(3);
        expect(result.links[0]).toEqual({
          source: 'A',
          target: 'B',
          value: 10
        });
      });
    });

    describe('transformToWordCloud', () => {
      it('should extract word frequencies', async () => {
        const data = [
          { content: 'This is a test document with some words' },
          { content: 'This test has more words and some repeated words' }
        ];

        const result = await service.transformToWordCloud(data, {
          textField: 'content',
          minCount: 2
        });

        const wordMap = {};
        result.forEach(item => {
          wordMap[item.text] = item.count;
        });

        expect(wordMap['test']).toBe(2);
        expect(wordMap['words']).toBe(3);
        expect(wordMap['some']).toBe(2);
      });
    });

    describe('transformToTimeline', () => {
      it('should transform data to timeline format', async () => {
        const data = [
          { created_at: '2024-01-01', title: 'Event 1' },
          { created_at: '2024-01-02', end_date: '2024-01-03', title: 'Event 2' }
        ];

        const result = await service.transformToTimeline(data, {
          dateField: 'created_at',
          titleField: 'title'
        });

        expect(result).toHaveLength(2);
        expect(result[0].start).toBe('2024-01-01');
        expect(result[0].end).toBeNull();
        expect(result[1].start).toBe('2024-01-02');
        expect(result[1].end).toBe('2024-01-03');
      });
    });

    describe('transformToGeomap', () => {
      it('should transform data to geomap format', async () => {
        const data = [
          { latitude: 40.7128, longitude: -74.0060, value: 10, name: 'New York' },
          { latitude: 51.5074, longitude: -0.1278, value: 5, name: 'London' }
        ];

        const result = await service.transformToGeomap(data, {
          latField: 'latitude',
          lonField: 'longitude',
          valueField: 'value'
        });

        expect(result.type).toBe('points');
        expect(result.features).toHaveLength(2);
        expect(result.features[0].coordinates).toEqual([-74.0060, 40.7128]);
      });
    });

    describe('transformToChart', () => {
      it('should transform data to chart format', async () => {
        const data = [
          { date: '2024-01-01', value: 10 },
          { date: '2024-01-02', value: 15 },
          { date: '2024-01-03', value: 12 }
        ];

        const result = await service.transformToChart(data, {
          xField: 'date',
          yField: 'value'
        });

        expect(result.labels).toEqual(['2024-01-01', '2024-01-02', '2024-01-03']);
        expect(result.datasets[0].data).toEqual([10, 15, 12]);
      });

      it('should handle grouped data', async () => {
        const data = [
          { date: '2024-01-01', category: 'A', value: 10 },
          { date: '2024-01-01', category: 'B', value: 5 },
          { date: '2024-01-02', category: 'A', value: 15 },
          { date: '2024-01-02', category: 'B', value: 8 }
        ];

        const result = await service.transformToChart(data, {
          xField: 'date',
          yField: 'value',
          groupBy: 'category'
        });

        expect(result.datasets).toHaveLength(2);
        expect(result.datasets[0].label).toBe('A');
        expect(result.datasets[1].label).toBe('B');
      });
    });
  });

  describe('aggregation pipelines', () => {
    beforeEach(async () => {
      await service.initialize();
    });

    it('should aggregate document statistics', async () => {
      mockDb.query.mockResolvedValue([
        { status: 'processed', source: { name: 'Source1' }, created_at: '2024-01-01' },
        { status: 'processed', source: { name: 'Source1' }, created_at: '2024-01-01' },
        { status: 'pending', source: { name: 'Source2' }, created_at: '2024-01-02' }
      ]);

      const result = await service.aggregateDocumentStats();

      expect(result.total).toBe(3);
      expect(result.byStatus.processed).toBe(2);
      expect(result.byStatus.pending).toBe(1);
      expect(result.bySource.Source1).toBe(2);
      expect(result.bySource.Source2).toBe(1);
      expect(result.timeline).toHaveLength(2);
    });

    it('should aggregate temporal distribution', async () => {
      mockDb.query.mockResolvedValue([
        { created_at: new Date('2024-01-01T10:00:00') },
        { created_at: new Date('2024-01-01T10:30:00') },
        { created_at: new Date('2024-01-02T15:00:00') }
      ]);

      const result = await service.aggregateTemporalDistribution();

      expect(result.hourly[10]).toBe(2);
      expect(result.hourly[15]).toBe(1);
      expect(result.daily[1]).toBe(2); // Monday
      expect(result.daily[2]).toBe(1); // Tuesday
      expect(result.monthly[0]).toBe(3); // January
    });

    it('should aggregate category breakdown', async () => {
      mockDb.query.mockResolvedValue([
        { metadata: { category: 'Tech', subcategory: 'AI' } },
        { metadata: { category: 'Tech', subcategory: 'Web' } },
        { metadata: { category: 'Business' } }
      ]);

      const result = await service.aggregateCategoryBreakdown();

      expect(result.flat.Tech.count).toBe(2);
      expect(result.flat.Tech.subcategories.AI).toBe(1);
      expect(result.flat.Tech.subcategories.Web).toBe(1);
      expect(result.flat.Business.count).toBe(1);
      expect(result.hierarchical.children).toHaveLength(2);
    });
  });

  describe('export functionality', () => {
    beforeEach(async () => {
      await service.initialize();
    });

    it('should export data as JSON', async () => {
      const data = { nodes: [], links: [] };
      const result = await service.exportData('network', data, 'json');

      expect(result).toBe(JSON.stringify(data, null, 2));
    });

    it('should export data as CSV', async () => {
      const data = [
        { name: 'Item1', value: 10 },
        { name: 'Item2', value: 20 }
      ];

      const result = await service.exportData('chart', data, 'csv');

      expect(result).toContain('name,value');
      expect(result).toContain('Item1,10');
      expect(result).toContain('Item2,20');
    });

    it('should handle CSV with commas in values', async () => {
      const data = [{ name: 'Item, with comma', value: 10 }];

      const result = await service.exportData('chart', data, 'csv');

      expect(result).toContain('"Item, with comma"');
    });

    it('should throw error for unsupported format', async () => {
      await expect(
        service.exportData('chart', {}, 'unsupported')
      ).rejects.toThrow('Unsupported export format: unsupported');
    });
  });

  describe('cache management', () => {
    beforeEach(async () => {
      await service.initialize();
    });

    it('should clear all visualization cache', async () => {
      await service.clearCache();

      expect(mockCache.deletePattern).toHaveBeenCalledWith('viz:*');
    });

    it('should clear cache with pattern', async () => {
      await service.clearCache('network');

      expect(mockCache.deletePattern).toHaveBeenCalledWith('viz:network*');
    });
  });

  describe('field extraction', () => {
    it('should extract simple fields', () => {
      const obj = { name: 'Test', value: 10 };

      expect(service.extractField(obj, 'name')).toBe('Test');
      expect(service.extractField(obj, 'value')).toBe(10);
    });

    it('should extract nested fields', () => {
      const obj = {
        user: {
          profile: {
            name: 'Test User'
          }
        }
      };

      expect(service.extractField(obj, 'user.profile.name')).toBe('Test User');
    });

    it('should return undefined for non-existent fields', () => {
      const obj = { name: 'Test' };

      expect(service.extractField(obj, 'missing')).toBeUndefined();
      expect(service.extractField(obj, 'user.name')).toBeUndefined();
    });
  });
});