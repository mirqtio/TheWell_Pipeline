const BaseRenderer = require('./BaseRenderer');
const logger = require('../../utils/logger');

/**
 * GeoMapRenderer - Renderer for geographic map visualizations
 */
class GeoMapRenderer extends BaseRenderer {
  constructor(container, options = {}) {
    super(container, options);
    
    this.geoOptions = {
      projection: options.projection || 'mercator',
      center: options.center || [0, 0],
      scale: options.scale || 150,
      showGraticule: options.showGraticule !== false,
      ...options.geoOptions
    };
    
    this.projection = null;
    this.path = null;
  }

  async initialize() {
    if (this.initialized) return;
    
    const { svg, g } = this.createSVG();
    this.svg = svg;
    this.mainGroup = g;
    
    this.mapGroup = this.createGroup('map');
    this.graticuleGroup = this.createGroup('graticule');
    this.dataGroup = this.createGroup('data');
    
    this.setupProjection();
    
    this.initialized = true;
    logger.info('GeoMapRenderer initialized');
  }

  createGroup(className) {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', className);
    this.mainGroup.appendChild(g);
    return g;
  }

  setupProjection() {
    const { width, height } = this.getInnerDimensions();
    
    // Simple mercator projection implementation
    this.projection = {
      center: this.geoOptions.center,
      scale: this.geoOptions.scale,
      translate: [width / 2, height / 2],
      
      project: function(coordinates) {
        const lambda = coordinates[0] * Math.PI / 180;
        const phi = coordinates[1] * Math.PI / 180;
        
        const x = this.scale * lambda + this.translate[0];
        const y = this.translate[1] - this.scale * Math.log(Math.tan(Math.PI / 4 + phi / 2));
        
        return [x, y];
      }
    };
  }

  async render(data) {
    await this.initialize();
    
    if (!data) {
      throw new Error('Data is required for rendering');
    }
    
    this.data = data;
    
    this.renderBase();
    this.renderData(data);
    this.setupInteractions();
    
    this.emit('rendered');
  }

  renderBase() {
    const colors = this.getThemeColors();
    
    // Render simple world outline
    const { width, height } = this.getInnerDimensions();
    
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', 0);
    rect.setAttribute('y', 0);
    rect.setAttribute('width', width);
    rect.setAttribute('height', height);
    rect.setAttribute('fill', '#e6f2ff');
    rect.setAttribute('stroke', colors.grid);
    
    this.mapGroup.appendChild(rect);
    
    // Render graticule if enabled
    if (this.geoOptions.showGraticule) {
      this.renderGraticule();
    }
  }

  renderGraticule() {
    const colors = this.getThemeColors();
    
    // Simple graticule lines
    for (let lon = -180; lon <= 180; lon += 30) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const d = this.createMeridianPath(lon);
      path.setAttribute('d', d);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', colors.grid);
      path.setAttribute('stroke-width', '0.5');
      path.setAttribute('opacity', '0.3');
      
      this.graticuleGroup.appendChild(path);
    }
    
    for (let lat = -90; lat <= 90; lat += 30) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const d = this.createParallelPath(lat);
      path.setAttribute('d', d);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', colors.grid);
      path.setAttribute('stroke-width', '0.5');
      path.setAttribute('opacity', '0.3');
      
      this.graticuleGroup.appendChild(path);
    }
  }

  createMeridianPath(longitude) {
    const points = [];
    for (let lat = -90; lat <= 90; lat += 5) {
      const projected = this.projection.project([longitude, lat]);
      points.push(`${lat === -90 ? 'M' : 'L'} ${projected[0]} ${projected[1]}`);
    }
    return points.join(' ');
  }

  createParallelPath(latitude) {
    const points = [];
    for (let lon = -180; lon <= 180; lon += 5) {
      const projected = this.projection.project([lon, latitude]);
      points.push(`${lon === -180 ? 'M' : 'L'} ${projected[0]} ${projected[1]}`);
    }
    return points.join(' ');
  }

  renderData(data) {
    this.dataGroup.innerHTML = '';
    const colors = this.getThemeColors();
    
    if (data.type === 'points') {
      this.renderPoints(data.features || data.points);
    } else if (data.type === 'heatmap') {
      this.renderHeatmap(data.features || data.points);
    } else if (data.type === 'choropleth') {
      this.renderChoropleth(data.features || data.regions);
    } else {
      // Default to points
      this.renderPoints(data.features || data);
    }
  }

  renderPoints(points) {
    const colors = this.getThemeColors();
    const sizeScale = this.createSizeScale(points);
    
    points.forEach((point, i) => {
      const coordinates = point.coordinates || [point.longitude || point.lon, point.latitude || point.lat];
      const projected = this.projection.project(coordinates);
      
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('class', 'point');
      circle.setAttribute('cx', projected[0]);
      circle.setAttribute('cy', projected[1]);
      circle.setAttribute('r', sizeScale(point.value || 1));
      circle.setAttribute('fill', point.color || colors.palette[i % colors.palette.length]);
      circle.setAttribute('fill-opacity', '0.7');
      circle.setAttribute('stroke', colors.background);
      circle.setAttribute('stroke-width', '1');
      circle.style.cursor = 'pointer';
      circle._data = point;
      
      this.dataGroup.appendChild(circle);
    });
  }

  renderHeatmap(points) {
    // Simplified heatmap rendering using circles with opacity
    const colors = this.getThemeColors();
    const intensityScale = this.createIntensityScale(points);
    
    points.forEach(point => {
      const coordinates = point.coordinates || [point.longitude || point.lon, point.latitude || point.lat];
      const projected = this.projection.project(coordinates);
      
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', projected[0]);
      circle.setAttribute('cy', projected[1]);
      circle.setAttribute('r', 20);
      circle.setAttribute('fill', colors.secondary);
      circle.setAttribute('fill-opacity', intensityScale(point.value || 1));
      circle._data = point;
      
      this.dataGroup.appendChild(circle);
    });
  }

  renderChoropleth(regions) {
    const colors = this.getThemeColors();
    const colorScale = this.createColorScale(regions);
    
    // Simplified - render as rectangles for regions
    regions.forEach(region => {
      if (!region.bounds) return;
      
      const topLeft = this.projection.project([region.bounds[0], region.bounds[1]]);
      const bottomRight = this.projection.project([region.bounds[2], region.bounds[3]]);
      
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', Math.min(topLeft[0], bottomRight[0]));
      rect.setAttribute('y', Math.min(topLeft[1], bottomRight[1]));
      rect.setAttribute('width', Math.abs(bottomRight[0] - topLeft[0]));
      rect.setAttribute('height', Math.abs(bottomRight[1] - topLeft[1]));
      rect.setAttribute('fill', colorScale(region.value));
      rect.setAttribute('stroke', colors.grid);
      rect.setAttribute('stroke-width', '0.5');
      rect._data = region;
      
      this.dataGroup.appendChild(rect);
    });
  }

  createSizeScale(points) {
    const values = points.map(p => p.value || 1);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    
    return (value) => {
      const normalized = (value - min) / range;
      return 3 + normalized * 12;
    };
  }

  createIntensityScale(points) {
    const values = points.map(p => p.value || 1);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    
    return (value) => {
      const normalized = (value - min) / range;
      return 0.1 + normalized * 0.8;
    };
  }

  createColorScale(regions) {
    const colors = this.getThemeColors();
    const values = regions.map(r => r.value || 0);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    
    return (value) => {
      const normalized = (value - min) / range;
      const index = Math.floor(normalized * (colors.palette.length - 1));
      return colors.palette[index];
    };
  }

  setupInteractions() {
    // Setup zoom and pan
    this.setupZoomPan();
    
    // Setup data interactions
    const elements = this.dataGroup.querySelectorAll('circle, rect');
    
    elements.forEach(element => {
      element.addEventListener('mouseenter', (e) => {
        element.style.opacity = '0.8';
        this.showTooltip(element._data, e);
        this.emitInteraction('hover', e, element._data);
      });
      
      element.addEventListener('mouseleave', () => {
        element.style.opacity = '1';
        this.hideTooltip();
      });
      
      element.addEventListener('click', (e) => {
        this.emitInteraction('click', e, element._data);
      });
    });
  }

  setupZoomPan() {
    let isPanning = false;
    let startX, startY;
    let currentTransform = { x: 0, y: 0, scale: 1 };
    
    this.svg.addEventListener('mousedown', (e) => {
      isPanning = true;
      startX = e.clientX - currentTransform.x;
      startY = e.clientY - currentTransform.y;
      this.svg.style.cursor = 'grabbing';
    });
    
    this.svg.addEventListener('mousemove', (e) => {
      if (!isPanning) return;
      
      currentTransform.x = e.clientX - startX;
      currentTransform.y = e.clientY - startY;
      
      this.updateTransform(currentTransform);
    });
    
    this.svg.addEventListener('mouseup', () => {
      isPanning = false;
      this.svg.style.cursor = 'grab';
    });
    
    this.svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      currentTransform.scale *= delta;
      currentTransform.scale = Math.max(0.5, Math.min(5, currentTransform.scale));
      
      this.updateTransform(currentTransform);
      
      this.emit('zoom', { scale: currentTransform.scale });
    });
    
    this.svg.style.cursor = 'grab';
  }

  updateTransform(transform) {
    this.mainGroup.style.transform = 
      `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`;
  }

  showTooltip(data, mouseEvent) {
    let tooltip = this.container.querySelector('.geo-tooltip');
    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.className = 'geo-tooltip';
      tooltip.style.position = 'absolute';
      tooltip.style.background = 'rgba(0,0,0,0.8)';
      tooltip.style.color = 'white';
      tooltip.style.padding = '8px';
      tooltip.style.borderRadius = '4px';
      tooltip.style.pointerEvents = 'none';
      tooltip.style.fontSize = '12px';
      this.container.appendChild(tooltip);
    }
    
    const content = `
      <strong>${data.name || data.title || 'Location'}</strong><br>
      ${data.value !== undefined ? `Value: ${data.value}<br>` : ''}
      ${data.description || ''}
    `;
    
    tooltip.innerHTML = content;
    tooltip.style.display = 'block';
    
    const rect = this.container.getBoundingClientRect();
    tooltip.style.left = `${mouseEvent.clientX - rect.left + 10}px`;
    tooltip.style.top = `${mouseEvent.clientY - rect.top - 10}px`;
  }

  hideTooltip() {
    const tooltip = this.container.querySelector('.geo-tooltip');
    if (tooltip) {
      tooltip.style.display = 'none';
    }
  }

  async update(data, options = {}) {
    this.data = data;
    this.renderData(data);
    this.setupInteractions();
    this.emit('updated');
  }

  async applyFilter(filter) {
    if (!filter) return;
    
    const elements = this.dataGroup.querySelectorAll('circle, rect');
    
    elements.forEach(element => {
      const data = element._data;
      let visible = true;
      
      if (filter.minValue !== undefined && (data.value || 0) < filter.minValue) {
        visible = false;
      }
      if (filter.maxValue !== undefined && (data.value || 0) > filter.maxValue) {
        visible = false;
      }
      if (filter.categories && data.category && !filter.categories.includes(data.category)) {
        visible = false;
      }
      
      element.style.opacity = visible ? 1 : 0.1;
      element.style.pointerEvents = visible ? 'auto' : 'none';
    });
    
    await super.applyFilter(filter);
  }

  /**
   * Center map on specific coordinates
   */
  centerOn(longitude, latitude, scale) {
    this.geoOptions.center = [longitude, latitude];
    if (scale) {
      this.geoOptions.scale = scale;
    }
    
    this.setupProjection();
    this.renderBase();
    this.renderData(this.data);
    this.setupInteractions();
  }
}

module.exports = GeoMapRenderer;