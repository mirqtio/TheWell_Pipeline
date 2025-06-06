const BaseRenderer = require('./BaseRenderer');
const logger = require('../../utils/logger');

/**
 * HeatMapRenderer - Renderer for heatmap visualizations
 * Used for document similarity matrices, activity patterns, etc.
 */
class HeatMapRenderer extends BaseRenderer {
  constructor(container, options = {}) {
    super(container, options);
    
    this.heatmapOptions = {
      cellPadding: options.cellPadding || 2,
      colorScheme: options.colorScheme || 'viridis',
      showValues: options.showValues !== false,
      valueFormat: options.valueFormat || '.2f',
      minColor: options.minColor,
      maxColor: options.maxColor,
      ...options.heatmapOptions
    };
    
    this.colorScale = null;
    this.xScale = null;
    this.yScale = null;
  }

  async initialize() {
    if (this.initialized) return;
    
    const { svg, g } = this.createSVG();
    this.svg = svg;
    this.mainGroup = g;
    
    // Create groups
    this.heatmapGroup = this.createGroup('heatmap');
    this.xAxisGroup = this.createGroup('x-axis');
    this.yAxisGroup = this.createGroup('y-axis');
    this.legendGroup = this.createGroup('legend');
    
    this.initialized = true;
    logger.info('HeatMapRenderer initialized');
  }

  createGroup(className) {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', className);
    this.mainGroup.appendChild(g);
    return g;
  }

  async render(data) {
    await this.initialize();
    
    if (!data || !data.values) {
      throw new Error('Data must contain a values matrix');
    }
    
    this.data = data;
    
    // Setup scales
    this.setupScales(data);
    
    // Render components
    this.renderHeatmap(data);
    this.renderAxes(data);
    this.renderLegend();
    
    // Setup interactions
    this.setupInteractions();
    
    this.emit('rendered', { 
      rows: data.rows?.length || data.values.length,
      cols: data.columns?.length || data.values[0]?.length
    });
  }

  setupScales(data) {
    const { width, height } = this.getInnerDimensions();
    
    // Extract dimensions
    const rows = data.rows || data.values.map((_, i) => `Row ${i + 1}`);
    const cols = data.columns || (data.values[0] || []).map((_, i) => `Col ${i + 1}`);
    
    // X scale (columns)
    this.xScale = this.createBandScale(cols, 0, width);
    
    // Y scale (rows)
    this.yScale = this.createBandScale(rows, 0, height);
    
    // Color scale
    const values = data.values.flat();
    const minValue = data.min ?? Math.min(...values);
    const maxValue = data.max ?? Math.max(...values);
    
    this.colorScale = this.createColorScale(minValue, maxValue);
  }

  createBandScale(domain, rangeStart, rangeEnd) {
    const step = (rangeEnd - rangeStart) / domain.length;
    const scale = (value) => {
      const index = domain.indexOf(value);
      return index >= 0 ? rangeStart + index * step : null;
    };
    scale.bandwidth = () => step;
    scale.domain = domain;
    return scale;
  }

  createColorScale(min, max) {
    const colors = this.getColorScheme();
    const range = max - min || 1;
    
    return (value) => {
      const normalized = (value - min) / range;
      const index = Math.floor(normalized * (colors.length - 1));
      const t = (normalized * (colors.length - 1)) - index;
      
      if (index >= colors.length - 1) return colors[colors.length - 1];
      if (index < 0) return colors[0];
      
      // Interpolate between colors
      return this.interpolateColor(colors[index], colors[index + 1], t);
    };
  }

  getColorScheme() {
    const themes = this.getThemeColors();
    
    const schemes = {
      viridis: ['#440154', '#482777', '#3e4989', '#31688e', '#26828e', '#1f9e89', '#35b779', '#6ece58', '#b5de2b', '#fde725'],
      blues: ['#f7fbff', '#deebf7', '#c6dbef', '#9ecae1', '#6baed6', '#4292c6', '#2171b5', '#08519c', '#08306b'],
      reds: ['#fff5f0', '#fee0d2', '#fcbba1', '#fc9272', '#fb6a4a', '#ef3b2c', '#cb181d', '#a50f15', '#67000d'],
      diverging: ['#d53e4f', '#f46d43', '#fdae61', '#fee08b', '#ffffbf', '#e6f598', '#abdda4', '#66c2a5', '#3288bd', '#5e4fa2'],
      custom: this.heatmapOptions.minColor && this.heatmapOptions.maxColor ? 
        [this.heatmapOptions.minColor, this.heatmapOptions.maxColor] : 
        [themes.primary, themes.secondary]
    };
    
    return schemes[this.heatmapOptions.colorScheme] || schemes.viridis;
  }

  interpolateColor(color1, color2, t) {
    // Convert hex to RGB
    const c1 = this.hexToRgb(color1);
    const c2 = this.hexToRgb(color2);
    
    // Interpolate
    const r = Math.round(c1.r + (c2.r - c1.r) * t);
    const g = Math.round(c1.g + (c2.g - c1.g) * t);
    const b = Math.round(c1.b + (c2.b - c1.b) * t);
    
    return `rgb(${r},${g},${b})`;
  }

  hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : { r: 0, g: 0, b: 0 };
  }

  renderHeatmap(data) {
    // Clear existing cells
    this.heatmapGroup.innerHTML = '';
    
    const cellWidth = this.xScale.bandwidth() - this.heatmapOptions.cellPadding;
    const cellHeight = this.yScale.bandwidth() - this.heatmapOptions.cellPadding;
    
    const rows = data.rows || data.values.map((_, i) => `Row ${i + 1}`);
    const cols = data.columns || (data.values[0] || []).map((_, i) => `Col ${i + 1}`);
    
    // Create cells
    data.values.forEach((row, rowIndex) => {
      row.forEach((value, colIndex) => {
        if (value == null) return;
        
        // Create cell rectangle
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('class', 'cell');
        rect.setAttribute('x', this.xScale(cols[colIndex]) + this.heatmapOptions.cellPadding / 2);
        rect.setAttribute('y', this.yScale(rows[rowIndex]) + this.heatmapOptions.cellPadding / 2);
        rect.setAttribute('width', cellWidth);
        rect.setAttribute('height', cellHeight);
        rect.setAttribute('fill', this.colorScale(value));
        rect.setAttribute('data-row', rowIndex);
        rect.setAttribute('data-col', colIndex);
        rect.setAttribute('data-value', value);
        rect.style.cursor = 'pointer';
        
        this.heatmapGroup.appendChild(rect);
        
        // Add value text if enabled
        if (this.heatmapOptions.showValues && cellWidth > 20 && cellHeight > 20) {
          const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          text.setAttribute('class', 'cell-value');
          text.setAttribute('x', this.xScale(cols[colIndex]) + this.xScale.bandwidth() / 2);
          text.setAttribute('y', this.yScale(rows[rowIndex]) + this.yScale.bandwidth() / 2);
          text.setAttribute('text-anchor', 'middle');
          text.setAttribute('dy', '.35em');
          text.setAttribute('font-size', Math.min(cellWidth, cellHeight) * 0.3);
          text.setAttribute('fill', this.getContrastColor(this.colorScale(value)));
          text.setAttribute('pointer-events', 'none');
          text.textContent = this.formatCellValue(value);
          
          this.heatmapGroup.appendChild(text);
        }
      });
    });
  }

  formatCellValue(value) {
    if (typeof value === 'number') {
      if (this.heatmapOptions.valueFormat === '.2f') {
        return value.toFixed(2);
      } else if (this.heatmapOptions.valueFormat === '.0%') {
        return `${(value * 100).toFixed(0)}%`;
      }
      return value.toString();
    }
    return value;
  }

  getContrastColor(backgroundColor) {
    // Parse RGB values from color
    const rgb = backgroundColor.match(/\d+/g);
    if (!rgb) return '#000000';
    
    // Calculate luminance
    const luminance = (0.299 * parseInt(rgb[0]) + 
                      0.587 * parseInt(rgb[1]) + 
                      0.114 * parseInt(rgb[2])) / 255;
    
    return luminance > 0.5 ? '#000000' : '#ffffff';
  }

  renderAxes(data) {
    const colors = this.getThemeColors();
    const rows = data.rows || data.values.map((_, i) => `Row ${i + 1}`);
    const cols = data.columns || (data.values[0] || []).map((_, i) => `Col ${i + 1}`);
    
    // Clear existing axes
    this.xAxisGroup.innerHTML = '';
    this.yAxisGroup.innerHTML = '';
    
    // X-axis labels
    cols.forEach((label, i) => {
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', this.xScale(label) + this.xScale.bandwidth() / 2);
      text.setAttribute('y', -5);
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('font-size', '12px');
      text.setAttribute('fill', colors.text);
      text.textContent = label;
      
      this.xAxisGroup.appendChild(text);
    });
    
    // Y-axis labels
    rows.forEach((label, i) => {
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', -5);
      text.setAttribute('y', this.yScale(label) + this.yScale.bandwidth() / 2);
      text.setAttribute('text-anchor', 'end');
      text.setAttribute('dy', '.35em');
      text.setAttribute('font-size', '12px');
      text.setAttribute('fill', colors.text);
      text.textContent = label;
      
      this.yAxisGroup.appendChild(text);
    });
  }

  renderLegend() {
    const colors = this.getThemeColors();
    const { width } = this.getInnerDimensions();
    
    // Clear existing legend
    this.legendGroup.innerHTML = '';
    
    // Position legend
    this.legendGroup.setAttribute('transform', `translate(${width + 20}, 0)`);
    
    // Create gradient for legend
    const gradientId = `gradient-${Date.now()}`;
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    const gradient = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
    gradient.setAttribute('id', gradientId);
    gradient.setAttribute('x1', '0%');
    gradient.setAttribute('y1', '100%');
    gradient.setAttribute('x2', '0%');
    gradient.setAttribute('y2', '0%');
    
    const colorStops = this.getColorScheme();
    colorStops.forEach((color, i) => {
      const stop = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
      stop.setAttribute('offset', `${(i / (colorStops.length - 1)) * 100}%`);
      stop.setAttribute('stop-color', color);
      gradient.appendChild(stop);
    });
    
    defs.appendChild(gradient);
    this.svg.appendChild(defs);
    
    // Legend rectangle
    const legendHeight = 200;
    const legendWidth = 20;
    
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('width', legendWidth);
    rect.setAttribute('height', legendHeight);
    rect.setAttribute('fill', `url(#${gradientId})`);
    rect.setAttribute('stroke', colors.grid);
    
    this.legendGroup.appendChild(rect);
    
    // Legend labels
    const values = this.data.values.flat();
    const minValue = this.data.min ?? Math.min(...values);
    const maxValue = this.data.max ?? Math.max(...values);
    
    // Min label
    const minText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    minText.setAttribute('x', legendWidth + 5);
    minText.setAttribute('y', legendHeight);
    minText.setAttribute('font-size', '12px');
    minText.setAttribute('fill', colors.text);
    minText.textContent = this.formatCellValue(minValue);
    this.legendGroup.appendChild(minText);
    
    // Max label
    const maxText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    maxText.setAttribute('x', legendWidth + 5);
    maxText.setAttribute('y', 0);
    maxText.setAttribute('dy', '.35em');
    maxText.setAttribute('font-size', '12px');
    maxText.setAttribute('fill', colors.text);
    maxText.textContent = this.formatCellValue(maxValue);
    this.legendGroup.appendChild(maxText);
  }

  setupInteractions() {
    const cells = this.heatmapGroup.querySelectorAll('rect.cell');
    
    cells.forEach(cell => {
      // Hover effect
      cell.addEventListener('mouseenter', (e) => {
        cell.style.strokeWidth = '2px';
        cell.style.stroke = '#000000';
        
        const row = parseInt(cell.getAttribute('data-row'));
        const col = parseInt(cell.getAttribute('data-col'));
        const value = parseFloat(cell.getAttribute('data-value'));
        
        this.highlightRowCol(row, col);
        
        this.emitInteraction('hover', e, {
          row,
          col,
          value,
          rowLabel: this.data.rows?.[row],
          colLabel: this.data.columns?.[col]
        });
      });
      
      cell.addEventListener('mouseleave', (e) => {
        cell.style.strokeWidth = '0';
        this.clearHighlight();
      });
      
      // Click interaction
      cell.addEventListener('click', (e) => {
        const row = parseInt(cell.getAttribute('data-row'));
        const col = parseInt(cell.getAttribute('data-col'));
        const value = parseFloat(cell.getAttribute('data-value'));
        
        this.emitInteraction('click', e, {
          row,
          col,
          value,
          rowLabel: this.data.rows?.[row],
          colLabel: this.data.columns?.[col]
        });
      });
    });
  }

  highlightRowCol(row, col) {
    const cells = this.heatmapGroup.querySelectorAll('rect.cell');
    
    cells.forEach(cell => {
      const cellRow = parseInt(cell.getAttribute('data-row'));
      const cellCol = parseInt(cell.getAttribute('data-col'));
      
      if (cellRow === row || cellCol === col) {
        cell.style.opacity = '1';
      } else {
        cell.style.opacity = '0.3';
      }
    });
  }

  clearHighlight() {
    const cells = this.heatmapGroup.querySelectorAll('rect.cell');
    cells.forEach(cell => {
      cell.style.opacity = '1';
    });
  }

  async update(data, options = {}) {
    if (!data || !data.values) {
      throw new Error('Data must contain a values matrix');
    }
    
    this.data = data;
    
    if (options.animate !== false) {
      // Animated update
      await this.animateUpdate(data);
    } else {
      // Immediate update
      this.setupScales(data);
      this.renderHeatmap(data);
      this.renderAxes(data);
      this.renderLegend();
      this.setupInteractions();
    }
    
    this.emit('updated');
  }

  async animateUpdate(data) {
    // Store current state
    const oldCells = Array.from(this.heatmapGroup.querySelectorAll('rect.cell'));
    const oldData = oldCells.map(cell => ({
      row: parseInt(cell.getAttribute('data-row')),
      col: parseInt(cell.getAttribute('data-col')),
      value: parseFloat(cell.getAttribute('data-value')),
      color: cell.getAttribute('fill')
    }));
    
    // Update scales
    this.setupScales(data);
    
    // Create new cells
    this.renderHeatmap(data);
    const newCells = Array.from(this.heatmapGroup.querySelectorAll('rect.cell'));
    
    // Animate color transitions
    const duration = this.options.animation.duration;
    const startTime = Date.now();
    
    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      newCells.forEach((cell, i) => {
        const row = parseInt(cell.getAttribute('data-row'));
        const col = parseInt(cell.getAttribute('data-col'));
        const newValue = parseFloat(cell.getAttribute('data-value'));
        
        // Find corresponding old cell
        const oldCell = oldData.find(d => d.row === row && d.col === col);
        if (oldCell) {
          // Interpolate value
          const interpolatedValue = oldCell.value + (newValue - oldCell.value) * progress;
          cell.setAttribute('fill', this.colorScale(interpolatedValue));
        }
      });
      
      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        // Final update
        this.renderAxes(data);
        this.renderLegend();
        this.setupInteractions();
      }
    };
    
    requestAnimationFrame(animate);
  }

  async applyFilter(filter) {
    if (!filter) return;
    
    const cells = this.heatmapGroup.querySelectorAll('rect.cell');
    
    cells.forEach(cell => {
      const row = parseInt(cell.getAttribute('data-row'));
      const col = parseInt(cell.getAttribute('data-col'));
      const value = parseFloat(cell.getAttribute('data-value'));
      
      let visible = true;
      
      if (filter.rows && !filter.rows.includes(row)) {
        visible = false;
      }
      if (filter.columns && !filter.columns.includes(col)) {
        visible = false;
      }
      if (filter.minValue !== undefined && value < filter.minValue) {
        visible = false;
      }
      if (filter.maxValue !== undefined && value > filter.maxValue) {
        visible = false;
      }
      
      cell.style.opacity = visible ? 1 : 0.1;
      cell.style.pointerEvents = visible ? 'auto' : 'none';
    });
    
    await super.applyFilter(filter);
  }
}

module.exports = HeatMapRenderer;