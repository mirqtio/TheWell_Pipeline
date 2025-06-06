const BaseRenderer = require('./BaseRenderer');
const logger = require('../../utils/logger');

/**
 * TimelineRenderer - Renderer for timeline visualizations
 */
class TimelineRenderer extends BaseRenderer {
  constructor(container, options = {}) {
    super(container, options);
    
    this.timelineOptions = {
      barHeight: options.barHeight || 20,
      barPadding: options.barPadding || 5,
      showAxis: options.showAxis !== false,
      dateFormat: options.dateFormat || '%Y-%m-%d',
      ...options.timelineOptions
    };
  }

  async initialize() {
    if (this.initialized) return;
    
    const { svg, g } = this.createSVG();
    this.svg = svg;
    this.mainGroup = g;
    
    this.axisGroup = this.createGroup('axis');
    this.eventsGroup = this.createGroup('events');
    this.labelsGroup = this.createGroup('labels');
    
    this.initialized = true;
    logger.info('TimelineRenderer initialized');
  }

  createGroup(className) {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', className);
    this.mainGroup.appendChild(g);
    return g;
  }

  async render(data) {
    await this.initialize();
    
    if (!data || !Array.isArray(data)) {
      throw new Error('Data must be an array of events');
    }
    
    this.data = data.map(d => ({
      ...d,
      start: new Date(d.start || d.date),
      end: d.end ? new Date(d.end) : null
    }));
    
    this.setupScales();
    this.renderAxis();
    this.renderEvents();
    this.setupInteractions();
    
    this.emit('rendered', { events: this.data.length });
  }

  setupScales() {
    const { width, height } = this.getInnerDimensions();
    
    // Time scale
    const allDates = [];
    this.data.forEach(d => {
      allDates.push(d.start);
      if (d.end) allDates.push(d.end);
    });
    
    const minDate = new Date(Math.min(...allDates));
    const maxDate = new Date(Math.max(...allDates));
    
    // Add padding to dates
    const padding = (maxDate - minDate) * 0.1;
    minDate.setTime(minDate.getTime() - padding);
    maxDate.setTime(maxDate.getTime() + padding);
    
    this.xScale = this.createTimeScale(minDate, maxDate, 0, width);
    
    // Y scale for swim lanes
    const categories = [...new Set(this.data.map(d => d.category || 'default'))];
    this.yScale = this.createBandScale(categories, 0, height - 40);
  }

  createTimeScale(minDate, maxDate, rangeStart, rangeEnd) {
    const scale = (date) => {
      const ratio = (date - minDate) / (maxDate - minDate);
      return rangeStart + ratio * (rangeEnd - rangeStart);
    };
    scale.domain = () => [minDate, maxDate];
    scale.invert = (x) => {
      const ratio = (x - rangeStart) / (rangeEnd - rangeStart);
      return new Date(minDate.getTime() + ratio * (maxDate - minDate));
    };
    return scale;
  }

  createBandScale(domain, rangeStart, rangeEnd) {
    const step = (rangeEnd - rangeStart) / domain.length;
    const scale = (value) => {
      const index = domain.indexOf(value);
      return index >= 0 ? rangeStart + index * step : rangeStart;
    };
    scale.bandwidth = () => step;
    scale.domain = domain;
    return scale;
  }

  renderAxis() {
    if (!this.timelineOptions.showAxis) return;
    
    const { width, height } = this.getInnerDimensions();
    const colors = this.getThemeColors();
    
    // Clear existing axis
    this.axisGroup.innerHTML = '';
    
    // Draw axis line
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', 0);
    line.setAttribute('y1', height - 20);
    line.setAttribute('x2', width);
    line.setAttribute('y2', height - 20);
    line.setAttribute('stroke', colors.grid);
    this.axisGroup.appendChild(line);
    
    // Add ticks
    const [minDate, maxDate] = this.xScale.domain();
    const tickCount = Math.min(10, Math.floor(width / 100));
    
    for (let i = 0; i <= tickCount; i++) {
      const ratio = i / tickCount;
      const date = new Date(minDate.getTime() + ratio * (maxDate - minDate));
      const x = this.xScale(date);
      
      // Tick mark
      const tick = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      tick.setAttribute('x1', x);
      tick.setAttribute('y1', height - 20);
      tick.setAttribute('x2', x);
      tick.setAttribute('y2', height - 15);
      tick.setAttribute('stroke', colors.grid);
      this.axisGroup.appendChild(tick);
      
      // Tick label
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', x);
      label.setAttribute('y', height - 5);
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('font-size', '10px');
      label.setAttribute('fill', colors.text);
      label.textContent = this.formatDate(date);
      this.axisGroup.appendChild(label);
    }
  }

  formatDate(date) {
    return date.toLocaleDateString();
  }

  renderEvents() {
    this.eventsGroup.innerHTML = '';
    this.labelsGroup.innerHTML = '';
    
    const colors = this.getThemeColors();
    
    this.data.forEach((event, i) => {
      const category = event.category || 'default';
      const y = this.yScale(category) + this.yScale.bandwidth() / 2 - this.timelineOptions.barHeight / 2;
      const x1 = this.xScale(event.start);
      const x2 = event.end ? this.xScale(event.end) : x1 + 5;
      
      if (event.end) {
        // Duration event
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('class', 'event duration');
        rect.setAttribute('x', Math.min(x1, x2));
        rect.setAttribute('y', y);
        rect.setAttribute('width', Math.abs(x2 - x1));
        rect.setAttribute('height', this.timelineOptions.barHeight);
        rect.setAttribute('fill', event.color || colors.palette[i % colors.palette.length]);
        rect.setAttribute('rx', 3);
        rect.style.cursor = 'pointer';
        rect._event = event;
        
        this.eventsGroup.appendChild(rect);
      } else {
        // Point event
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('class', 'event point');
        circle.setAttribute('cx', x1);
        circle.setAttribute('cy', y + this.timelineOptions.barHeight / 2);
        circle.setAttribute('r', this.timelineOptions.barHeight / 2);
        circle.setAttribute('fill', event.color || colors.palette[i % colors.palette.length]);
        circle.style.cursor = 'pointer';
        circle._event = event;
        
        this.eventsGroup.appendChild(circle);
      }
      
      // Add label if space permits
      if (event.title || event.name) {
        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('x', x1 + 5);
        label.setAttribute('y', y + this.timelineOptions.barHeight / 2);
        label.setAttribute('dy', '.35em');
        label.setAttribute('font-size', '12px');
        label.setAttribute('fill', colors.text);
        label.textContent = event.title || event.name;
        label._event = event;
        
        this.labelsGroup.appendChild(label);
      }
    });
  }

  setupInteractions() {
    const events = this.eventsGroup.querySelectorAll('.event');
    
    events.forEach(element => {
      element.addEventListener('mouseenter', (e) => {
        element.style.opacity = '0.8';
        this.showTooltip(element._event, e);
        this.emitInteraction('hover', e, element._event);
      });
      
      element.addEventListener('mouseleave', () => {
        element.style.opacity = '1';
        this.hideTooltip();
      });
      
      element.addEventListener('click', (e) => {
        this.emitInteraction('click', e, element._event);
      });
    });
  }

  showTooltip(event, mouseEvent) {
    // Create tooltip element if not exists
    let tooltip = this.container.querySelector('.timeline-tooltip');
    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.className = 'timeline-tooltip';
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
      <strong>${event.title || event.name || 'Event'}</strong><br>
      Start: ${event.start.toLocaleDateString()}<br>
      ${event.end ? `End: ${event.end.toLocaleDateString()}<br>` : ''}
      ${event.description ? `${event.description}` : ''}
    `;
    
    tooltip.innerHTML = content;
    tooltip.style.display = 'block';
    
    const rect = this.container.getBoundingClientRect();
    tooltip.style.left = `${mouseEvent.clientX - rect.left + 10}px`;
    tooltip.style.top = `${mouseEvent.clientY - rect.top - 10}px`;
  }

  hideTooltip() {
    const tooltip = this.container.querySelector('.timeline-tooltip');
    if (tooltip) {
      tooltip.style.display = 'none';
    }
  }

  async update(data, options = {}) {
    this.data = data.map(d => ({
      ...d,
      start: new Date(d.start || d.date),
      end: d.end ? new Date(d.end) : null
    }));
    
    this.setupScales();
    this.renderAxis();
    this.renderEvents();
    this.setupInteractions();
    
    this.emit('updated');
  }

  async applyFilter(filter) {
    if (!filter) return;
    
    const events = this.eventsGroup.querySelectorAll('.event');
    
    events.forEach(element => {
      const event = element._event;
      let visible = true;
      
      if (filter.startDate && event.start < new Date(filter.startDate)) {
        visible = false;
      }
      if (filter.endDate && event.start > new Date(filter.endDate)) {
        visible = false;
      }
      if (filter.categories && !filter.categories.includes(event.category)) {
        visible = false;
      }
      
      element.style.opacity = visible ? 1 : 0.1;
      element.style.pointerEvents = visible ? 'auto' : 'none';
    });
    
    await super.applyFilter(filter);
  }

  /**
   * Zoom to date range
   */
  zoomToRange(startDate, endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    this.xScale = this.createTimeScale(start, end, 0, this.getInnerDimensions().width);
    this.renderAxis();
    this.renderEvents();
    this.setupInteractions();
    
    this.emit('zoom', { startDate: start, endDate: end });
  }
}

module.exports = TimelineRenderer;