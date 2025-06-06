const VisualizationEngine = require('../../../src/visualization/VisualizationEngine');
const BaseRenderer = require('../../../src/visualization/renderers/BaseRenderer');
const EventEmitter = require('events');

// Mock all renderer modules before they're required
const createMockRenderer = () => {
  return jest.fn().mockImplementation(() => ({
    render: jest.fn().mockResolvedValue(true),
    update: jest.fn().mockResolvedValue(true),
    destroy: jest.fn(),
    on: jest.fn(),
    off: jest.fn(),
    resize: jest.fn().mockResolvedValue(true),
    applyTheme: jest.fn().mockResolvedValue(true),
    applyFilter: jest.fn().mockResolvedValue(true),
    animateTransition: jest.fn().mockResolvedValue(true),
    toPNG: jest.fn().mockResolvedValue('data:image/png;base64,test'),
    toSVG: jest.fn().mockResolvedValue('data:image/svg+xml;base64,test'),
    toPDF: jest.fn().mockResolvedValue('data:application/pdf;base64,test'),
    toJSON: jest.fn().mockResolvedValue({ type: 'chart', data: [] })
  }));
};

jest.mock('../../../src/visualization/renderers/ChartRenderer', () => createMockRenderer());
jest.mock('../../../src/visualization/renderers/NetworkRenderer', () => createMockRenderer());
jest.mock('../../../src/visualization/renderers/HeatMapRenderer', () => createMockRenderer());
jest.mock('../../../src/visualization/renderers/TreeMapRenderer', () => createMockRenderer());
jest.mock('../../../src/visualization/renderers/SankeyRenderer', () => createMockRenderer());
jest.mock('../../../src/visualization/renderers/WordCloudRenderer', () => createMockRenderer());
jest.mock('../../../src/visualization/renderers/TimelineRenderer', () => createMockRenderer());
jest.mock('../../../src/visualization/renderers/GeoMapRenderer', () => createMockRenderer());

jest.mock('../../../src/database/DatabaseManager', () => ({
  getInstance: jest.fn(() => ({
    query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    connect: jest.fn().mockResolvedValue({
      query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: jest.fn()
    }),
    transaction: jest.fn((callback) => {
      const mockTrx = {
        query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
        commit: jest.fn(),
        rollback: jest.fn()
      };
      return callback(mockTrx);
    })
  }))
}));

describe('VisualizationEngine', () => {
  let engine;
  let mockContainer;

  beforeEach(() => {
    engine = new VisualizationEngine();
    
    // Mock DOM container
    mockContainer = {
      clientWidth: 800,
      clientHeight: 600,
      innerHTML: '',
      querySelector: jest.fn(() => null),
      appendChild: jest.fn(),
      removeChild: jest.fn(),
      getBoundingClientRect: jest.fn(() => ({
        left: 0,
        top: 0,
        width: 800,
        height: 600
      }))
    };

  });

  afterEach(() => {
    if (engine) {
      engine.cleanup();
    }
    jest.clearAllMocks();
  });

  describe('initialization', () => {
    it('should initialize successfully', async () => {
      await engine.initialize();
      
      expect(engine.initialized).toBe(true);
      expect(engine.renderers.size).toBeGreaterThan(0);
      expect(engine.renderers.has('chart')).toBe(true);
      expect(engine.renderers.has('network')).toBe(true);
      expect(engine.renderers.has('heatmap')).toBe(true);
    });

    it('should emit initialized event', async () => {
      const initializedSpy = jest.fn();
      engine.on('initialized', initializedSpy);
      
      await engine.initialize();
      
      expect(initializedSpy).toHaveBeenCalled();
    });

    it('should not reinitialize if already initialized', async () => {
      await engine.initialize();
      const rendererCount = engine.renderers.size;
      
      await engine.initialize();
      
      expect(engine.renderers.size).toBe(rendererCount);
    });
  });

  describe('renderer registration', () => {
    it('should register a new renderer', () => {
      class CustomRenderer extends BaseRenderer {}
      
      engine.registerRenderer('custom', CustomRenderer);
      
      expect(engine.renderers.has('custom')).toBe(true);
      expect(engine.renderers.get('custom')).toBe(CustomRenderer);
    });

    it('should overwrite existing renderer with warning', async () => {
      // First initialize to register built-in renderers
      await engine.initialize();
      
      const logger = require('../../../src/utils/logger');
      const logSpy = jest.spyOn(logger, 'warn').mockImplementation();
      
      class CustomRenderer extends BaseRenderer {}
      
      engine.registerRenderer('chart', CustomRenderer);
      
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Overwriting existing renderer'));
      logSpy.mockRestore();
    });
  });

  describe('visualization creation', () => {
    beforeEach(async () => {
      await engine.initialize();
    });

    it('should create a visualization', async () => {
      const data = { labels: ['A', 'B'], datasets: [{ data: [1, 2] }] };
      const viz = await engine.createVisualization(
        'test-viz',
        'chart',
        mockContainer,
        data
      );
      
      expect(viz).toBeDefined();
      expect(viz.id).toBe('test-viz');
      expect(viz.type).toBe('chart');
      expect(viz.data).toEqual(data);
      expect(engine.visualizations.has('test-viz')).toBe(true);
    });

    it('should emit visualization:created event', async () => {
      const createdSpy = jest.fn();
      engine.on('visualization:created', createdSpy);
      
      await engine.createVisualization(
        'test-viz',
        'chart',
        mockContainer,
        { labels: ['A'], datasets: [{ data: [1] }] }
      );
      
      expect(createdSpy).toHaveBeenCalledWith({
        id: 'test-viz',
        type: 'chart'
      });
    });

    it('should throw error for unknown visualization type', async () => {
      await expect(
        engine.createVisualization('test-viz', 'unknown', mockContainer, {})
      ).rejects.toThrow('Unknown visualization type: unknown');
    });

    it('should setup interaction handlers', async () => {
      const viz = await engine.createVisualization(
        'test-viz',
        'chart',
        mockContainer,
        { labels: ['A'], datasets: [{ data: [1] }] },
        { interaction: { hover: true, click: true, zoom: true } }
      );
      
      expect(viz.interactions.size).toBe(3);
      expect(viz.interactions.has('hover')).toBe(true);
      expect(viz.interactions.has('click')).toBe(true);
      expect(viz.interactions.has('zoom')).toBe(true);
    });
  });

  describe('visualization updates', () => {
    let viz;

    beforeEach(async () => {
      await engine.initialize();
      viz = await engine.createVisualization(
        'test-viz',
        'chart',
        mockContainer,
        { labels: ['A'], datasets: [{ data: [1] }] }
      );
    });

    it('should update visualization data', async () => {
      const newData = { labels: ['A', 'B'], datasets: [{ data: [2, 3] }] };
      
      await engine.updateVisualization('test-viz', newData);
      
      const updated = engine.getVisualization('test-viz');
      expect(updated.data).toEqual(newData);
      expect(updated.updated).toBeDefined();
    });

    it('should emit visualization:updated event', async () => {
      const updatedSpy = jest.fn();
      engine.on('visualization:updated', updatedSpy);
      
      await engine.updateVisualization('test-viz', { labels: ['C'] });
      
      expect(updatedSpy).toHaveBeenCalledWith({
        id: 'test-viz',
        type: 'chart'
      });
    });

    it('should animate transitions by default', async () => {
      const animateSpy = jest.spyOn(engine, 'animateTransition');
      
      await engine.updateVisualization('test-viz', { labels: ['C'] });
      
      expect(animateSpy).toHaveBeenCalled();
      animateSpy.mockRestore();
    });

    it('should skip animation when animate is false', async () => {
      const animateSpy = jest.spyOn(engine, 'animateTransition');
      
      await engine.updateVisualization('test-viz', { labels: ['C'] }, { animate: false });
      
      expect(animateSpy).not.toHaveBeenCalled();
      animateSpy.mockRestore();
    });

    it('should throw error for non-existent visualization', async () => {
      await expect(
        engine.updateVisualization('non-existent', {})
      ).rejects.toThrow('Visualization not found: non-existent');
    });
  });

  describe('visualization destruction', () => {
    beforeEach(async () => {
      await engine.initialize();
    });

    it('should destroy a visualization', async () => {
      await engine.createVisualization(
        'test-viz',
        'chart',
        mockContainer,
        { labels: ['A'] }
      );
      
      engine.destroyVisualization('test-viz');
      
      expect(engine.visualizations.has('test-viz')).toBe(false);
    });

    it('should clean up interactions', async () => {
      const viz = await engine.createVisualization(
        'test-viz',
        'chart',
        mockContainer,
        { labels: ['A'] },
        { interaction: { hover: true, click: true } }
      );
      
      const offSpy = jest.spyOn(viz.renderer, 'off');
      
      engine.destroyVisualization('test-viz');
      
      expect(offSpy).toHaveBeenCalledTimes(2);
    });

    it('should emit visualization:destroyed event', async () => {
      await engine.createVisualization(
        'test-viz',
        'chart',
        mockContainer,
        { labels: ['A'] }
      );
      
      const destroyedSpy = jest.fn();
      engine.on('visualization:destroyed', destroyedSpy);
      
      engine.destroyVisualization('test-viz');
      
      expect(destroyedSpy).toHaveBeenCalledWith({
        id: 'test-viz',
        type: 'chart'
      });
    });

    it('should handle non-existent visualization gracefully', () => {
      expect(() => {
        engine.destroyVisualization('non-existent');
      }).not.toThrow();
    });
  });

  describe('export functionality', () => {
    beforeEach(async () => {
      await engine.initialize();
      await engine.createVisualization(
        'test-viz',
        'chart',
        mockContainer,
        { labels: ['A'] }
      );
    });

    it('should export to PNG', async () => {
      const result = await engine.exportVisualization('test-viz', 'png');
      
      expect(result).toBe('data:image/png;base64,test');
    });

    it('should export to SVG', async () => {
      const result = await engine.exportVisualization('test-viz', 'svg');
      
      expect(result).toBe('data:image/svg+xml;base64,test');
    });

    it('should export to PDF', async () => {
      const result = await engine.exportVisualization('test-viz', 'pdf');
      
      expect(result).toBe('data:application/pdf;base64,test');
    });

    it('should export to JSON', async () => {
      const result = await engine.exportVisualization('test-viz', 'json');
      
      expect(result).toEqual({ type: 'chart', data: [] });
    });

    it('should throw error for unsupported format', async () => {
      await expect(
        engine.exportVisualization('test-viz', 'unsupported')
      ).rejects.toThrow('Unsupported export format: unsupported');
    });

    it('should emit visualization:exported event', async () => {
      const exportedSpy = jest.fn();
      engine.on('visualization:exported', exportedSpy);
      
      await engine.exportVisualization('test-viz', 'png');
      
      expect(exportedSpy).toHaveBeenCalledWith({
        id: 'test-viz',
        format: 'png'
      });
    });
  });

  describe('resize functionality', () => {
    beforeEach(async () => {
      await engine.initialize();
      await engine.createVisualization(
        'test-viz',
        'chart',
        mockContainer,
        { labels: ['A'] }
      );
    });

    it('should resize visualization', async () => {
      await engine.resizeVisualization('test-viz', 1000, 800);
      
      const viz = engine.getVisualization('test-viz');
      expect(viz.renderer.resize).toHaveBeenCalledWith(1000, 800);
    });

    it('should emit visualization:resized event', async () => {
      const resizedSpy = jest.fn();
      engine.on('visualization:resized', resizedSpy);
      
      await engine.resizeVisualization('test-viz', 1000, 800);
      
      expect(resizedSpy).toHaveBeenCalledWith({
        id: 'test-viz',
        width: 1000,
        height: 800
      });
    });
  });

  describe('theme functionality', () => {
    beforeEach(async () => {
      await engine.initialize();
      await engine.createVisualization(
        'test-viz',
        'chart',
        mockContainer,
        { labels: ['A'] }
      );
    });

    it('should apply theme to visualization', async () => {
      await engine.applyTheme('test-viz', 'dark');
      
      const viz = engine.getVisualization('test-viz');
      expect(viz.renderer.applyTheme).toHaveBeenCalledWith('dark');
    });

    it('should emit visualization:theme-changed event', async () => {
      const themeSpy = jest.fn();
      engine.on('visualization:theme-changed', themeSpy);
      
      await engine.applyTheme('test-viz', 'dark');
      
      expect(themeSpy).toHaveBeenCalledWith({
        id: 'test-viz',
        theme: 'dark'
      });
    });
  });

  describe('cross-filtering', () => {
    beforeEach(async () => {
      await engine.initialize();
    });

    it('should enable cross-filtering between visualizations', async () => {
      await engine.createVisualization('viz1', 'chart', mockContainer, {});
      await engine.createVisualization('viz2', 'chart', mockContainer, {});
      await engine.createVisualization('viz3', 'chart', mockContainer, {});
      
      engine.enableCrossFiltering(['viz1', 'viz2', 'viz3']);
      
      // Verify event listeners are set up
      const viz1 = engine.getVisualization('viz1');
      expect(viz1.renderer.on).toHaveBeenCalledWith('filter', expect.any(Function));
    });

    it('should emit cross-filter event', async () => {
      await engine.createVisualization('viz1', 'chart', mockContainer, {});
      await engine.createVisualization('viz2', 'chart', mockContainer, {});
      
      const crossFilterSpy = jest.fn();
      engine.on('visualization:cross-filter', crossFilterSpy);
      
      engine.enableCrossFiltering(['viz1', 'viz2']);
      
      // Simulate filter event
      const viz1 = engine.getVisualization('viz1');
      const filterHandler = viz1.renderer.on.mock.calls.find(
        call => call[0] === 'filter'
      )[1];
      
      filterHandler({ filter: { category: 'A' } });
      
      expect(crossFilterSpy).toHaveBeenCalledWith({
        source: 'viz1',
        filter: { category: 'A' }
      });
    });

    it('should throw error for non-existent visualization', () => {
      expect(() => {
        engine.enableCrossFiltering(['non-existent']);
      }).toThrow('Visualization not found: non-existent');
    });
  });

  describe('utility methods', () => {
    beforeEach(async () => {
      await engine.initialize();
    });

    it('should get supported types', () => {
      const types = engine.getSupportedTypes();
      
      expect(Array.isArray(types)).toBe(true);
      expect(types).toContain('chart');
      expect(types).toContain('network');
      expect(types).toContain('heatmap');
      expect(types).toContain('treemap');
      expect(types).toContain('sankey');
      expect(types).toContain('wordcloud');
      expect(types).toContain('timeline');
      expect(types).toContain('geomap');
    });

    it('should get all visualizations', async () => {
      await engine.createVisualization('viz1', 'chart', mockContainer, {});
      await engine.createVisualization('viz2', 'network', mockContainer, {});
      
      const all = engine.getAllVisualizations();
      
      expect(all).toHaveLength(2);
      expect(all.map(v => v.id)).toEqual(['viz1', 'viz2']);
    });

    it('should clean up all visualizations', async () => {
      await engine.createVisualization('viz1', 'chart', mockContainer, {});
      await engine.createVisualization('viz2', 'network', mockContainer, {});
      
      const cleanupSpy = jest.fn();
      engine.on('cleanup', cleanupSpy);
      
      engine.cleanup();
      
      expect(engine.visualizations.size).toBe(0);
      expect(cleanupSpy).toHaveBeenCalled();
    });
  });

  describe('animation', () => {
    beforeEach(async () => {
      await engine.initialize();
      await engine.createVisualization(
        'test-viz',
        'chart',
        mockContainer,
        { labels: ['A'] }
      );
    });

    it('should handle animation transitions', async () => {
      const newData = { labels: ['B'] };
      const options = { duration: 500, easing: 'linear' };
      
      await engine.animateTransition(
        engine.getVisualization('test-viz'),
        newData,
        options
      );
      
      const viz = engine.getVisualization('test-viz');
      expect(viz.renderer.animateTransition).toHaveBeenCalledWith(newData, options);
    });

    it('should track active animations', async () => {
      const viz = engine.getVisualization('test-viz');
      const promise = engine.animateTransition(viz, {}, { duration: 100 });
      
      expect(engine.activeAnimations.size).toBe(1);
      
      await promise;
      
      expect(engine.activeAnimations.size).toBe(0);
    });
  });

  describe('interaction events', () => {
    beforeEach(async () => {
      await engine.initialize();
    });

    it('should emit hover events', async () => {
      const hoverSpy = jest.fn();
      engine.on('visualization:hover', hoverSpy);
      
      const viz = await engine.createVisualization(
        'test-viz',
        'chart',
        mockContainer,
        { labels: ['A'] },
        { interaction: { hover: true } }
      );
      
      // Simulate hover event
      const hoverHandler = viz.renderer.on.mock.calls.find(
        call => call[0] === 'hover'
      )[1];
      
      hoverHandler({ data: { value: 10 }, position: { x: 100, y: 50 } });
      
      expect(hoverSpy).toHaveBeenCalledWith({
        id: 'test-viz',
        data: { value: 10 },
        position: { x: 100, y: 50 }
      });
    });

    it('should emit click events', async () => {
      const clickSpy = jest.fn();
      engine.on('visualization:click', clickSpy);
      
      const viz = await engine.createVisualization(
        'test-viz',
        'chart',
        mockContainer,
        { labels: ['A'] },
        { interaction: { click: true } }
      );
      
      // Simulate click event
      const clickHandler = viz.renderer.on.mock.calls.find(
        call => call[0] === 'click'
      )[1];
      
      clickHandler({ data: { value: 10 }, position: { x: 100, y: 50 } });
      
      expect(clickSpy).toHaveBeenCalledWith({
        id: 'test-viz',
        data: { value: 10 },
        position: { x: 100, y: 50 }
      });
    });

    it('should emit zoom events', async () => {
      const zoomSpy = jest.fn();
      engine.on('visualization:zoom', zoomSpy);
      
      const viz = await engine.createVisualization(
        'test-viz',
        'chart',
        mockContainer,
        { labels: ['A'] },
        { interaction: { zoom: true } }
      );
      
      // Simulate zoom event
      const zoomHandler = viz.renderer.on.mock.calls.find(
        call => call[0] === 'zoom'
      )[1];
      
      zoomHandler({ scale: 2, center: { x: 400, y: 300 } });
      
      expect(zoomSpy).toHaveBeenCalledWith({
        id: 'test-viz',
        scale: 2,
        center: { x: 400, y: 300 }
      });
    });
  });
});