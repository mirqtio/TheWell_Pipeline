const EventEmitter = require('events');
const logger = require('../../utils/logger');

/**
 * BaseRenderer - Abstract base class for all visualization renderers
 */
class BaseRenderer extends EventEmitter {
  constructor(container, options = {}) {
    super();
    
    if (!container) {
      throw new Error('Container element is required');
    }
    
    this.container = typeof container === 'string' 
      ? document.querySelector(container) 
      : container;
      
    if (!this.container) {
      throw new Error('Container element not found');
    }
    
    this.options = {
      width: options.width || this.container.clientWidth || 800,
      height: options.height || this.container.clientHeight || 600,
      margin: options.margin || { top: 20, right: 20, bottom: 40, left: 40 },
      responsive: options.responsive !== false,
      animation: {
        duration: options.animation?.duration || 750,
        easing: options.animation?.easing || 'easeInOutCubic'
      },
      theme: options.theme || 'default',
      ...options
    };
    
    this.data = null;
    this.chart = null;
    this.initialized = false;
    
    // Setup resize observer for responsive behavior
    if (this.options.responsive && typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        this.handleResize();
      });
      this.resizeObserver.observe(this.container);
    }
  }

  /**
   * Initialize the renderer - to be implemented by subclasses
   */
  async initialize() {
    throw new Error('initialize() must be implemented by subclass');
  }

  /**
   * Render the visualization - to be implemented by subclasses
   */
  async render(data) {
    throw new Error('render() must be implemented by subclass');
  }

  /**
   * Update the visualization - to be implemented by subclasses
   */
  async update(data, options = {}) {
    throw new Error('update() must be implemented by subclass');
  }

  /**
   * Destroy the visualization
   */
  destroy() {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    
    if (this.chart) {
      // Subclasses should implement specific cleanup
      this.chart = null;
    }
    
    // Clear container
    if (this.container) {
      this.container.innerHTML = '';
    }
    
    this.removeAllListeners();
    this.initialized = false;
    logger.info(`${this.constructor.name} destroyed`);
  }

  /**
   * Resize the visualization
   */
  async resize(width, height) {
    this.options.width = width || this.container.clientWidth;
    this.options.height = height || this.container.clientHeight;
    
    if (this.chart && this.initialized) {
      await this.handleResize();
    }
  }

  /**
   * Handle resize events
   */
  async handleResize() {
    // To be implemented by subclasses if needed
    this.emit('resize', {
      width: this.options.width,
      height: this.options.height
    });
  }

  /**
   * Apply a theme to the visualization
   */
  async applyTheme(theme) {
    this.options.theme = theme;
    if (this.initialized && this.data) {
      await this.update(this.data, { themeOnly: true });
    }
  }

  /**
   * Apply a filter to the visualization
   */
  async applyFilter(filter) {
    // To be implemented by subclasses
    this.emit('filter:applied', filter);
  }

  /**
   * Animate transition between states
   */
  async animateTransition(newData, options = {}) {
    // Default implementation - subclasses can override
    return this.update(newData, {
      ...options,
      animate: true
    });
  }

  /**
   * Export to PNG
   */
  async toPNG(options = {}) {
    if (!this.container) {
      throw new Error('No container available for export');
    }
    
    // Using html2canvas if available, otherwise return canvas data
    if (typeof html2canvas !== 'undefined') {
      const canvas = await html2canvas(this.container, {
        backgroundColor: options.backgroundColor || '#ffffff',
        scale: options.scale || 2
      });
      return canvas.toDataURL('image/png');
    }
    
    // Fallback for canvas-based renderers
    const canvas = this.container.querySelector('canvas');
    if (canvas) {
      return canvas.toDataURL('image/png');
    }
    
    throw new Error('PNG export not supported for this visualization type');
  }

  /**
   * Export to SVG
   */
  async toSVG(options = {}) {
    const svg = this.container.querySelector('svg');
    if (!svg) {
      throw new Error('SVG export not supported for this visualization type');
    }
    
    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(svg);
    
    return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgString)))}`;
  }

  /**
   * Export to PDF
   */
  async toPDF(options = {}) {
    // Requires jsPDF library
    if (typeof jsPDF === 'undefined') {
      throw new Error('PDF export requires jsPDF library');
    }
    
    const imgData = await this.toPNG(options);
    const pdf = new jsPDF({
      orientation: options.orientation || 'landscape',
      unit: 'px',
      format: [this.options.width, this.options.height]
    });
    
    pdf.addImage(imgData, 'PNG', 0, 0, this.options.width, this.options.height);
    return pdf.output('dataurlstring');
  }

  /**
   * Export to JSON
   */
  async toJSON(options = {}) {
    return {
      type: this.constructor.name,
      data: this.data,
      options: this.options,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Get inner dimensions accounting for margins
   */
  getInnerDimensions() {
    const { width, height, margin } = this.options;
    return {
      width: width - margin.left - margin.right,
      height: height - margin.top - margin.bottom
    };
  }

  /**
   * Create SVG element with proper dimensions
   */
  createSVG() {
    // Clear existing content
    this.container.innerHTML = '';
    
    // Create SVG using native DOM APIs
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', this.options.width);
    svg.setAttribute('height', this.options.height);
    svg.setAttribute('viewBox', `0 0 ${this.options.width} ${this.options.height}`);
    
    // Create main group for transforms
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('transform', `translate(${this.options.margin.left},${this.options.margin.top})`);
    
    svg.appendChild(g);
    this.container.appendChild(svg);
    
    return { svg, g };
  }

  /**
   * Create Canvas element
   */
  createCanvas() {
    // Clear existing content
    this.container.innerHTML = '';
    
    const canvas = document.createElement('canvas');
    canvas.width = this.options.width;
    canvas.height = this.options.height;
    
    this.container.appendChild(canvas);
    
    const ctx = canvas.getContext('2d');
    return { canvas, ctx };
  }

  /**
   * Emit interaction events with normalized data
   */
  emitInteraction(type, event, data) {
    const rect = this.container.getBoundingClientRect();
    const position = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
    
    this.emit(type, {
      originalEvent: event,
      position,
      data,
      timestamp: Date.now()
    });
  }

  /**
   * Get theme colors
   */
  getThemeColors() {
    const themes = {
      default: {
        primary: '#1976d2',
        secondary: '#dc004e',
        background: '#ffffff',
        text: '#333333',
        grid: '#e0e0e0',
        palette: ['#1976d2', '#dc004e', '#7cb342', '#fb8c00', '#8e24aa', '#00acc1']
      },
      dark: {
        primary: '#90caf9',
        secondary: '#f48fb1',
        background: '#121212',
        text: '#ffffff',
        grid: '#333333',
        palette: ['#90caf9', '#f48fb1', '#a5d6a7', '#ffcc80', '#ce93d8', '#80deea']
      }
    };
    
    return themes[this.options.theme] || themes.default;
  }

  /**
   * Format value for display
   */
  formatValue(value, type = 'number') {
    if (value == null) return 'N/A';
    
    switch (type) {
      case 'number':
        return typeof value === 'number' 
          ? value.toLocaleString() 
          : value;
      case 'percent':
        return typeof value === 'number' 
          ? `${(value * 100).toFixed(1)}%` 
          : value;
      case 'currency':
        return typeof value === 'number' 
          ? `$${value.toLocaleString()}` 
          : value;
      default:
        return value.toString();
    }
  }
}

module.exports = BaseRenderer;