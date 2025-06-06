const BaseRenderer = require('./BaseRenderer');
const logger = require('../../utils/logger');

/**
 * TreeMapRenderer - Renderer for hierarchical treemap visualizations
 */
class TreeMapRenderer extends BaseRenderer {
  constructor(container, options = {}) {
    super(container, options);
    
    this.treemapOptions = {
      padding: options.padding || 2,
      labelThreshold: options.labelThreshold || 0.02,
      colorBy: options.colorBy || 'depth', // 'depth', 'value', 'category'
      ...options.treemapOptions
    };
  }

  async initialize() {
    if (this.initialized) return;
    
    const { svg, g } = this.createSVG();
    this.svg = svg;
    this.mainGroup = g;
    
    this.treemapGroup = this.createGroup('treemap');
    this.tooltipGroup = this.createGroup('tooltip');
    
    this.initialized = true;
    logger.info('TreeMapRenderer initialized');
  }

  createGroup(className) {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', className);
    this.mainGroup.appendChild(g);
    return g;
  }

  async render(data) {
    await this.initialize();
    
    if (!data) {
      throw new Error('Data is required for rendering');
    }
    
    this.data = data;
    const hierarchy = this.createHierarchy(data);
    const layout = this.createLayout(hierarchy);
    
    this.renderRectangles(layout);
    this.setupInteractions();
    
    this.emit('rendered', { nodes: layout.descendants().length });
  }

  createHierarchy(data) {
    // Convert flat data to hierarchy if needed
    if (Array.isArray(data)) {
      return {
        name: 'root',
        children: data
      };
    }
    return data;
  }

  createLayout(data) {
    const { width, height } = this.getInnerDimensions();
    
    // Create treemap layout
    const root = this.hierarchySum(data);
    
    // Squarified treemap algorithm
    this.squarify(root, 0, 0, width, height);
    
    return root;
  }

  hierarchySum(data) {
    const node = {
      data: data,
      value: 0,
      depth: 0,
      height: 0,
      children: null,
      parent: null
    };
    
    if (data.children) {
      node.children = data.children.map(child => {
        const childNode = this.hierarchySum(child);
        childNode.parent = node;
        childNode.depth = node.depth + 1;
        return childNode;
      });
      
      node.value = node.children.reduce((sum, child) => sum + child.value, 0);
      node.height = 1 + Math.max(...node.children.map(d => d.height));
    } else {
      node.value = data.value || 1;
      node.height = 0;
    }
    
    return node;
  }

  squarify(node, x0, y0, x1, y1) {
    node.x0 = x0;
    node.y0 = y0;
    node.x1 = x1;
    node.y1 = y1;
    
    if (!node.children) return;
    
    const padding = this.treemapOptions.padding;
    x0 += padding;
    y0 += padding;
    x1 -= padding;
    y1 -= padding;
    
    const dx = x1 - x0;
    const dy = y1 - y0;
    
    if (dx <= 0 || dy <= 0) return;
    
    // Sort children by value
    const children = node.children.slice().sort((a, b) => b.value - a.value);
    const totalValue = node.value;
    
    // Squarified algorithm
    let row = [];
    let rowValue = 0;
    let x = x0;
    let y = y0;
    let vertical = dx < dy;
    
    children.forEach(child => {
      row.push(child);
      rowValue += child.value;
      
      const rowRatio = this.worstRatio(row, rowValue, vertical ? dy : dx);
      const newRowRatio = this.worstRatio([...row, child], rowValue + child.value, vertical ? dy : dx);
      
      if (row.length > 1 && newRowRatio > rowRatio) {
        // Layout current row
        row.pop();
        rowValue -= child.value;
        
        if (vertical) {
          const rowHeight = rowValue / totalValue * dx;
          this.layoutRow(row, x, y, x + rowHeight, y1);
          x += rowHeight;
        } else {
          const rowWidth = rowValue / totalValue * dy;
          this.layoutRow(row, x, y, x1, y + rowWidth);
          y += rowWidth;
        }
        
        row = [child];
        rowValue = child.value;
      }
    });
    
    // Layout final row
    if (row.length > 0) {
      if (vertical) {
        this.layoutRow(row, x, y, x1, y1);
      } else {
        this.layoutRow(row, x, y, x1, y1);
      }
    }
  }

  worstRatio(row, rowValue, length) {
    const area = rowValue * rowValue;
    const minRatio = Math.min(...row.map(d => {
      const nodeArea = d.value / rowValue * area;
      const ratio = Math.max(length * length * d.value / nodeArea, nodeArea / (length * length * d.value));
      return ratio;
    }));
    return minRatio;
  }

  layoutRow(row, x0, y0, x1, y1) {
    const totalValue = row.reduce((sum, d) => sum + d.value, 0);
    const vertical = (x1 - x0) < (y1 - y0);
    
    let offset = 0;
    row.forEach(node => {
      const ratio = node.value / totalValue;
      
      if (vertical) {
        const height = (y1 - y0) * ratio;
        this.squarify(node, x0, y0 + offset, x1, y0 + offset + height);
        offset += height;
      } else {
        const width = (x1 - x0) * ratio;
        this.squarify(node, x0 + offset, y0, x0 + offset + width, y1);
        offset += width;
      }
    });
  }

  renderRectangles(root) {
    this.treemapGroup.innerHTML = '';
    
    const colors = this.getThemeColors();
    const nodes = this.getDescendants(root);
    const maxDepth = Math.max(...nodes.map(d => d.depth));
    
    nodes.forEach(node => {
      if (node === root) return;
      
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('class', 'node');
      rect.setAttribute('x', node.x0);
      rect.setAttribute('y', node.y0);
      rect.setAttribute('width', Math.max(0, node.x1 - node.x0));
      rect.setAttribute('height', Math.max(0, node.y1 - node.y0));
      rect.setAttribute('fill', this.getNodeColor(node, colors, maxDepth));
      rect.setAttribute('stroke', colors.background);
      rect.setAttribute('stroke-width', 1);
      rect.style.cursor = 'pointer';
      
      // Store node reference
      rect._node = node;
      
      this.treemapGroup.appendChild(rect);
      
      // Add label if large enough
      const area = (node.x1 - node.x0) * (node.y1 - node.y0);
      const totalArea = (root.x1 - root.x0) * (root.y1 - root.y0);
      
      if (area / totalArea > this.treemapOptions.labelThreshold) {
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('class', 'label');
        text.setAttribute('x', (node.x0 + node.x1) / 2);
        text.setAttribute('y', (node.y0 + node.y1) / 2);
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('dy', '.35em');
        text.setAttribute('font-size', Math.min(12, Math.sqrt(area) * 0.2));
        text.setAttribute('fill', this.getContrastColor(this.getNodeColor(node, colors, maxDepth)));
        text.setAttribute('pointer-events', 'none');
        text.textContent = node.data.name || node.data.label || '';
        
        this.treemapGroup.appendChild(text);
      }
    });
  }

  getNodeColor(node, colors, maxDepth) {
    switch (this.treemapOptions.colorBy) {
      case 'depth':
        const depthRatio = node.depth / maxDepth;
        return colors.palette[Math.floor(depthRatio * (colors.palette.length - 1))];
      
      case 'value':
        const parent = node.parent;
        if (!parent) return colors.primary;
        const siblings = parent.children || [];
        const maxValue = Math.max(...siblings.map(d => d.value));
        const valueRatio = node.value / maxValue;
        const opacity = 0.3 + valueRatio * 0.7;
        return this.adjustOpacity(colors.primary, opacity);
      
      case 'category':
        const category = node.data.category || node.data.type || 0;
        return colors.palette[category % colors.palette.length];
      
      default:
        return colors.primary;
    }
  }

  adjustOpacity(color, opacity) {
    // Convert hex to rgba
    const rgb = color.match(/^#([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
    if (rgb) {
      return `rgba(${parseInt(rgb[1], 16)}, ${parseInt(rgb[2], 16)}, ${parseInt(rgb[3], 16)}, ${opacity})`;
    }
    return color;
  }

  getContrastColor(backgroundColor) {
    const rgb = backgroundColor.match(/\d+/g);
    if (!rgb) return '#000000';
    
    const luminance = (0.299 * parseInt(rgb[0]) + 
                      0.587 * parseInt(rgb[1]) + 
                      0.114 * parseInt(rgb[2])) / 255;
    
    return luminance > 0.5 ? '#000000' : '#ffffff';
  }

  getDescendants(node) {
    const descendants = [node];
    if (node.children) {
      node.children.forEach(child => {
        descendants.push(...this.getDescendants(child));
      });
    }
    return descendants;
  }

  setupInteractions() {
    const rects = this.treemapGroup.querySelectorAll('rect.node');
    
    rects.forEach(rect => {
      rect.addEventListener('mouseenter', (e) => {
        rect.style.opacity = '0.8';
        const node = rect._node;
        this.showPath(node);
        this.emitInteraction('hover', e, {
          name: node.data.name,
          value: node.value,
          depth: node.depth,
          path: this.getPath(node)
        });
      });
      
      rect.addEventListener('mouseleave', (e) => {
        rect.style.opacity = '1';
        this.hidePath();
      });
      
      rect.addEventListener('click', (e) => {
        const node = rect._node;
        this.emitInteraction('click', e, {
          name: node.data.name,
          value: node.value,
          depth: node.depth,
          path: this.getPath(node),
          hasChildren: !!node.children
        });
      });
    });
  }

  showPath(targetNode) {
    const path = [];
    let node = targetNode;
    while (node) {
      path.push(node);
      node = node.parent;
    }
    
    const rects = this.treemapGroup.querySelectorAll('rect.node');
    rects.forEach(rect => {
      if (!path.includes(rect._node)) {
        rect.style.opacity = '0.3';
      }
    });
  }

  hidePath() {
    const rects = this.treemapGroup.querySelectorAll('rect.node');
    rects.forEach(rect => {
      rect.style.opacity = '1';
    });
  }

  getPath(node) {
    const path = [];
    while (node && node.data.name !== 'root') {
      path.unshift(node.data.name);
      node = node.parent;
    }
    return path;
  }

  async update(data, options = {}) {
    this.data = data;
    const hierarchy = this.createHierarchy(data);
    const layout = this.createLayout(hierarchy);
    
    if (options.animate !== false) {
      await this.animateTransition(layout);
    } else {
      this.renderRectangles(layout);
      this.setupInteractions();
    }
    
    this.emit('updated');
  }

  async animateTransition(newLayout) {
    const duration = this.options.animation.duration;
    const oldRects = Array.from(this.treemapGroup.querySelectorAll('rect.node'));
    const oldPositions = new Map();
    
    oldRects.forEach(rect => {
      const node = rect._node;
      oldPositions.set(node.data.name, {
        x0: parseFloat(rect.getAttribute('x')),
        y0: parseFloat(rect.getAttribute('y')),
        x1: parseFloat(rect.getAttribute('x')) + parseFloat(rect.getAttribute('width')),
        y1: parseFloat(rect.getAttribute('y')) + parseFloat(rect.getAttribute('height'))
      });
    });
    
    this.renderRectangles(newLayout);
    const newRects = Array.from(this.treemapGroup.querySelectorAll('rect.node'));
    
    const startTime = Date.now();
    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = this.easeInOutCubic(progress);
      
      newRects.forEach(rect => {
        const node = rect._node;
        const oldPos = oldPositions.get(node.data.name);
        
        if (oldPos) {
          const x = oldPos.x0 + (node.x0 - oldPos.x0) * eased;
          const y = oldPos.y0 + (node.y0 - oldPos.y0) * eased;
          const width = (oldPos.x1 - oldPos.x0) + ((node.x1 - node.x0) - (oldPos.x1 - oldPos.x0)) * eased;
          const height = (oldPos.y1 - oldPos.y0) + ((node.y1 - node.y0) - (oldPos.y1 - oldPos.y0)) * eased;
          
          rect.setAttribute('x', x);
          rect.setAttribute('y', y);
          rect.setAttribute('width', Math.max(0, width));
          rect.setAttribute('height', Math.max(0, height));
        }
      });
      
      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        this.setupInteractions();
      }
    };
    
    requestAnimationFrame(animate);
  }

  easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  async applyFilter(filter) {
    if (!filter) return;
    
    const rects = this.treemapGroup.querySelectorAll('rect.node');
    
    rects.forEach(rect => {
      const node = rect._node;
      let visible = true;
      
      if (filter.minValue !== undefined && node.value < filter.minValue) {
        visible = false;
      }
      if (filter.maxValue !== undefined && node.value > filter.maxValue) {
        visible = false;
      }
      if (filter.depth !== undefined && node.depth !== filter.depth) {
        visible = false;
      }
      if (filter.path && !this.getPath(node).some(p => filter.path.includes(p))) {
        visible = false;
      }
      
      rect.style.opacity = visible ? 1 : 0.1;
      rect.style.pointerEvents = visible ? 'auto' : 'none';
    });
    
    await super.applyFilter(filter);
  }

  /**
   * Zoom to a specific node
   */
  zoomToNode(nodeName) {
    const rect = Array.from(this.treemapGroup.querySelectorAll('rect.node'))
      .find(r => r._node.data.name === nodeName);
    
    if (!rect) return;
    
    const node = rect._node;
    const { width, height } = this.getInnerDimensions();
    
    // Calculate zoom transform
    const dx = width / (node.x1 - node.x0);
    const dy = height / (node.y1 - node.y0);
    const scale = Math.min(dx, dy) * 0.9;
    
    const translateX = width / 2 - scale * (node.x0 + node.x1) / 2;
    const translateY = height / 2 - scale * (node.y0 + node.y1) / 2;
    
    // Apply transform with animation
    this.mainGroup.style.transition = `transform ${this.options.animation.duration}ms ease-in-out`;
    this.mainGroup.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
    
    this.emit('zoom', { node: nodeName, scale });
  }
}

module.exports = TreeMapRenderer;