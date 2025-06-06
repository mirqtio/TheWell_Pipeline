const EventEmitter = require('events');
const logger = require('../utils/logger');

/**
 * VisualizationEngine - Core engine for managing multiple visualization libraries
 * Provides a unified interface for D3.js, Chart.js, and Plotly.js
 */
class VisualizationEngine extends EventEmitter {
  constructor() {
    super();
    this.visualizations = new Map();
    this.renderers = new Map();
    this.activeAnimations = new Set();
    this.initialized = false;
    
    // Configuration for different visualization types
    this.config = {
      animation: {
        duration: 750,
        easing: 'easeInOutCubic'
      },
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        hover: true,
        click: true,
        zoom: true,
        pan: true
      }
    };
  }

  /**
   * Initialize the visualization engine
   */
  async initialize() {
    try {
      // Register built-in renderers
      this.registerRenderer('chart', require('./renderers/ChartRenderer'));
      this.registerRenderer('network', require('./renderers/NetworkRenderer'));
      this.registerRenderer('heatmap', require('./renderers/HeatMapRenderer'));
      this.registerRenderer('treemap', require('./renderers/TreeMapRenderer'));
      this.registerRenderer('sankey', require('./renderers/SankeyRenderer'));
      this.registerRenderer('wordcloud', require('./renderers/WordCloudRenderer'));
      this.registerRenderer('timeline', require('./renderers/TimelineRenderer'));
      this.registerRenderer('geomap', require('./renderers/GeoMapRenderer'));
      
      this.initialized = true;
      this.emit('initialized');
      logger.info('VisualizationEngine initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize VisualizationEngine:', error);
      throw error;
    }
  }

  /**
   * Register a new visualization renderer
   */
  registerRenderer(type, RendererClass) {
    if (this.renderers.has(type)) {
      logger.warn(`Overwriting existing renderer for type: ${type}`);
    }
    this.renderers.set(type, RendererClass);
    logger.info(`Registered renderer for type: ${type}`);
  }

  /**
   * Create a new visualization
   */
  async createVisualization(id, type, container, data, options = {}) {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.renderers.has(type)) {
      throw new Error(`Unknown visualization type: ${type}`);
    }

    try {
      const RendererClass = this.renderers.get(type);
      const renderer = new RendererClass(container, {
        ...this.config,
        ...options
      });

      const visualization = {
        id,
        type,
        renderer,
        container,
        data,
        options,
        created: new Date(),
        interactions: new Map()
      };

      // Initialize the visualization
      await renderer.render(data);
      
      // Setup interaction handlers
      this.setupInteractions(visualization);
      
      // Store the visualization
      this.visualizations.set(id, visualization);
      
      this.emit('visualization:created', { id, type });
      logger.info(`Created visualization: ${id} of type: ${type}`);
      
      return visualization;
    } catch (error) {
      logger.error(`Failed to create visualization ${id}:`, error);
      throw error;
    }
  }

  /**
   * Update visualization data
   */
  async updateVisualization(id, data, options = {}) {
    const viz = this.visualizations.get(id);
    if (!viz) {
      throw new Error(`Visualization not found: ${id}`);
    }

    try {
      // Apply transitions if supported
      if (options.animate !== false) {
        await this.animateTransition(viz, data, options);
      } else {
        await viz.renderer.update(data, options);
      }
      
      viz.data = data;
      viz.updated = new Date();
      
      this.emit('visualization:updated', { id, type: viz.type });
      logger.info(`Updated visualization: ${id}`);
    } catch (error) {
      logger.error(`Failed to update visualization ${id}:`, error);
      throw error;
    }
  }

  /**
   * Destroy a visualization
   */
  destroyVisualization(id) {
    const viz = this.visualizations.get(id);
    if (!viz) {
      return;
    }

    try {
      // Clean up interactions
      viz.interactions.forEach((handler, event) => {
        viz.renderer.off(event, handler);
      });
      
      // Destroy the renderer
      viz.renderer.destroy();
      
      // Remove from storage
      this.visualizations.delete(id);
      
      this.emit('visualization:destroyed', { id, type: viz.type });
      logger.info(`Destroyed visualization: ${id}`);
    } catch (error) {
      logger.error(`Failed to destroy visualization ${id}:`, error);
    }
  }

  /**
   * Setup interaction handlers for a visualization
   */
  setupInteractions(visualization) {
    const { renderer, interactions, options } = visualization;
    
    if (options.interaction?.hover) {
      const hoverHandler = (event) => {
        this.emit('visualization:hover', {
          id: visualization.id,
          data: event.data,
          position: event.position
        });
      };
      renderer.on('hover', hoverHandler);
      interactions.set('hover', hoverHandler);
    }
    
    if (options.interaction?.click) {
      const clickHandler = (event) => {
        this.emit('visualization:click', {
          id: visualization.id,
          data: event.data,
          position: event.position
        });
      };
      renderer.on('click', clickHandler);
      interactions.set('click', clickHandler);
    }
    
    if (options.interaction?.zoom) {
      const zoomHandler = (event) => {
        this.emit('visualization:zoom', {
          id: visualization.id,
          scale: event.scale,
          center: event.center
        });
      };
      renderer.on('zoom', zoomHandler);
      interactions.set('zoom', zoomHandler);
    }
  }

  /**
   * Animate transition between data states
   */
  async animateTransition(visualization, newData, options) {
    const animationId = `${visualization.id}-${Date.now()}`;
    this.activeAnimations.add(animationId);
    
    try {
      await visualization.renderer.animateTransition(newData, {
        duration: options.duration || this.config.animation.duration,
        easing: options.easing || this.config.animation.easing
      });
    } finally {
      this.activeAnimations.delete(animationId);
    }
  }

  /**
   * Export visualization to different formats
   */
  async exportVisualization(id, format = 'png', options = {}) {
    const viz = this.visualizations.get(id);
    if (!viz) {
      throw new Error(`Visualization not found: ${id}`);
    }

    try {
      let result;
      
      switch (format.toLowerCase()) {
        case 'png':
          result = await viz.renderer.toPNG(options);
          break;
        case 'svg':
          result = await viz.renderer.toSVG(options);
          break;
        case 'pdf':
          result = await viz.renderer.toPDF(options);
          break;
        case 'json':
          result = await viz.renderer.toJSON(options);
          break;
        default:
          throw new Error(`Unsupported export format: ${format}`);
      }
      
      this.emit('visualization:exported', { id, format });
      return result;
    } catch (error) {
      logger.error(`Failed to export visualization ${id} as ${format}:`, error);
      throw error;
    }
  }

  /**
   * Resize a visualization
   */
  async resizeVisualization(id, width, height) {
    const viz = this.visualizations.get(id);
    if (!viz) {
      throw new Error(`Visualization not found: ${id}`);
    }

    try {
      await viz.renderer.resize(width, height);
      this.emit('visualization:resized', { id, width, height });
    } catch (error) {
      logger.error(`Failed to resize visualization ${id}:`, error);
      throw error;
    }
  }

  /**
   * Get visualization by ID
   */
  getVisualization(id) {
    return this.visualizations.get(id);
  }

  /**
   * Get all visualizations
   */
  getAllVisualizations() {
    return Array.from(this.visualizations.values());
  }

  /**
   * Apply theme to visualization
   */
  async applyTheme(id, theme) {
    const viz = this.visualizations.get(id);
    if (!viz) {
      throw new Error(`Visualization not found: ${id}`);
    }

    try {
      await viz.renderer.applyTheme(theme);
      this.emit('visualization:theme-changed', { id, theme });
    } catch (error) {
      logger.error(`Failed to apply theme to visualization ${id}:`, error);
      throw error;
    }
  }

  /**
   * Enable cross-filtering between visualizations
   */
  enableCrossFiltering(visualizationIds) {
    const visualizations = visualizationIds.map(id => {
      const viz = this.visualizations.get(id);
      if (!viz) {
        throw new Error(`Visualization not found: ${id}`);
      }
      return viz;
    });

    // Setup cross-filtering logic
    visualizations.forEach((sourceViz) => {
      sourceViz.renderer.on('filter', (filterEvent) => {
        visualizations.forEach((targetViz) => {
          if (targetViz.id !== sourceViz.id) {
            targetViz.renderer.applyFilter(filterEvent.filter);
          }
        });
        
        this.emit('visualization:cross-filter', {
          source: sourceViz.id,
          filter: filterEvent.filter
        });
      });
    });

    logger.info(`Enabled cross-filtering for visualizations: ${visualizationIds.join(', ')}`);
  }

  /**
   * Get supported visualization types
   */
  getSupportedTypes() {
    return Array.from(this.renderers.keys());
  }

  /**
   * Cleanup all visualizations
   */
  cleanup() {
    this.visualizations.forEach((viz, id) => {
      this.destroyVisualization(id);
    });
    
    this.activeAnimations.clear();
    this.emit('cleanup');
    logger.info('VisualizationEngine cleaned up');
  }
}

module.exports = VisualizationEngine;