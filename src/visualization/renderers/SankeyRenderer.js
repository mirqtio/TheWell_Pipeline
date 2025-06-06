const BaseRenderer = require('./BaseRenderer');
const logger = require('../../utils/logger');

/**
 * SankeyRenderer - Renderer for Sankey diagram visualizations
 * Shows flow relationships between nodes
 */
class SankeyRenderer extends BaseRenderer {
  constructor(container, options = {}) {
    super(container, options);
    
    this.sankeyOptions = {
      nodeWidth: options.nodeWidth || 20,
      nodePadding: options.nodePadding || 10,
      linkOpacity: options.linkOpacity || 0.5,
      ...options.sankeyOptions
    };
  }

  async initialize() {
    if (this.initialized) return;
    
    const { svg, g } = this.createSVG();
    this.svg = svg;
    this.mainGroup = g;
    
    this.linkGroup = this.createGroup('links');
    this.nodeGroup = this.createGroup('nodes');
    this.labelGroup = this.createGroup('labels');
    
    this.initialized = true;
    logger.info('SankeyRenderer initialized');
  }

  createGroup(className) {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', className);
    this.mainGroup.appendChild(g);
    return g;
  }

  async render(data) {
    await this.initialize();
    
    if (!data || !data.nodes || !data.links) {
      throw new Error('Data must contain nodes and links');
    }
    
    this.data = data;
    const layout = this.computeSankeyLayout(data);
    
    this.renderLinks(layout.links);
    this.renderNodes(layout.nodes);
    this.renderLabels(layout.nodes);
    this.setupInteractions();
    
    this.emit('rendered');
  }

  computeSankeyLayout(data) {
    const { width, height } = this.getInnerDimensions();
    
    // Simple layout algorithm (placeholder for full implementation)
    const nodes = data.nodes.map((node, i) => ({
      ...node,
      x: (i % 3) * (width / 3),
      y: Math.floor(i / 3) * 50,
      width: this.sankeyOptions.nodeWidth,
      height: 40
    }));
    
    const links = data.links.map(link => ({
      ...link,
      source: nodes.find(n => n.id === link.source),
      target: nodes.find(n => n.id === link.target)
    }));
    
    return { nodes, links };
  }

  renderLinks(links) {
    this.linkGroup.innerHTML = '';
    const colors = this.getThemeColors();
    
    links.forEach(link => {
      if (!link.source || !link.target) return;
      
      const path = this.createLinkPath(link);
      const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      pathEl.setAttribute('class', 'link');
      pathEl.setAttribute('d', path);
      pathEl.setAttribute('fill', 'none');
      pathEl.setAttribute('stroke', colors.primary);
      pathEl.setAttribute('stroke-width', link.value || 2);
      pathEl.setAttribute('stroke-opacity', this.sankeyOptions.linkOpacity);
      pathEl._link = link;
      
      this.linkGroup.appendChild(pathEl);
    });
  }

  createLinkPath(link) {
    const x0 = link.source.x + link.source.width;
    const y0 = link.source.y + link.source.height / 2;
    const x1 = link.target.x;
    const y1 = link.target.y + link.target.height / 2;
    const xi = (x0 + x1) / 2;
    
    return `M${x0},${y0}C${xi},${y0} ${xi},${y1} ${x1},${y1}`;
  }

  renderNodes(nodes) {
    this.nodeGroup.innerHTML = '';
    const colors = this.getThemeColors();
    
    nodes.forEach((node, i) => {
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('class', 'node');
      rect.setAttribute('x', node.x);
      rect.setAttribute('y', node.y);
      rect.setAttribute('width', node.width);
      rect.setAttribute('height', node.height);
      rect.setAttribute('fill', node.color || colors.palette[i % colors.palette.length]);
      rect.setAttribute('stroke', colors.background);
      rect._node = node;
      
      this.nodeGroup.appendChild(rect);
    });
  }

  renderLabels(nodes) {
    this.labelGroup.innerHTML = '';
    const colors = this.getThemeColors();
    
    nodes.forEach(node => {
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', node.x + node.width + 5);
      text.setAttribute('y', node.y + node.height / 2);
      text.setAttribute('dy', '.35em');
      text.setAttribute('font-size', '12px');
      text.setAttribute('fill', colors.text);
      text.textContent = node.name || node.label || '';
      
      this.labelGroup.appendChild(text);
    });
  }

  setupInteractions() {
    // Node interactions
    const nodes = this.nodeGroup.querySelectorAll('rect');
    nodes.forEach(rect => {
      rect.addEventListener('mouseenter', (e) => {
        this.highlightNode(rect._node);
        this.emitInteraction('hover', e, rect._node);
      });
      
      rect.addEventListener('mouseleave', () => {
        this.clearHighlight();
      });
      
      rect.addEventListener('click', (e) => {
        this.emitInteraction('click', e, rect._node);
      });
    });
    
    // Link interactions
    const links = this.linkGroup.querySelectorAll('path');
    links.forEach(path => {
      path.addEventListener('mouseenter', (e) => {
        path.setAttribute('stroke-opacity', '0.8');
        this.emitInteraction('hover', e, path._link);
      });
      
      path.addEventListener('mouseleave', () => {
        path.setAttribute('stroke-opacity', this.sankeyOptions.linkOpacity);
      });
    });
  }

  highlightNode(node) {
    const nodes = this.nodeGroup.querySelectorAll('rect');
    const links = this.linkGroup.querySelectorAll('path');
    
    nodes.forEach(rect => {
      rect.style.opacity = rect._node === node ? '1' : '0.3';
    });
    
    links.forEach(path => {
      const link = path._link;
      const connected = link.source === node || link.target === node;
      path.style.opacity = connected ? '1' : '0.1';
    });
  }

  clearHighlight() {
    const nodes = this.nodeGroup.querySelectorAll('rect');
    const links = this.linkGroup.querySelectorAll('path');
    
    nodes.forEach(rect => {
      rect.style.opacity = '1';
    });
    
    links.forEach(path => {
      path.style.opacity = '1';
    });
  }

  async update(data, options = {}) {
    this.data = data;
    const layout = this.computeSankeyLayout(data);
    
    this.renderLinks(layout.links);
    this.renderNodes(layout.nodes);
    this.renderLabels(layout.nodes);
    this.setupInteractions();
    
    this.emit('updated');
  }
}

module.exports = SankeyRenderer;