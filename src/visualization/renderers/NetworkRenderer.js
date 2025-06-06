const BaseRenderer = require('./BaseRenderer');
const logger = require('../../utils/logger');

/**
 * NetworkRenderer - Renderer for network/graph visualizations
 * Creates force-directed graphs for entity relationships
 */
class NetworkRenderer extends BaseRenderer {
  constructor(container, options = {}) {
    super(container, options);
    
    this.networkOptions = {
      nodeRadius: options.nodeRadius || 8,
      linkDistance: options.linkDistance || 50,
      linkStrength: options.linkStrength || 1,
      chargeStrength: options.chargeStrength || -300,
      centerStrength: options.centerStrength || 0.1,
      collisionRadius: options.collisionRadius || 10,
      ...options.networkOptions
    };
    
    this.simulation = null;
    this.nodes = [];
    this.links = [];
    this.selectedNode = null;
  }

  async initialize() {
    if (this.initialized) return;
    
    // Create SVG structure
    const { svg, g } = this.createSVG();
    this.svg = svg;
    this.mainGroup = g;
    
    // Add zoom behavior
    this.setupZoom();
    
    // Create groups for rendering order
    this.linkGroup = this.createGroup('links');
    this.nodeGroup = this.createGroup('nodes');
    this.labelGroup = this.createGroup('labels');
    
    this.initialized = true;
    logger.info('NetworkRenderer initialized');
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
      throw new Error('Data must contain nodes and links arrays');
    }
    
    this.data = data;
    this.nodes = data.nodes.map(d => ({ ...d }));
    this.links = data.links.map(d => ({ ...d }));
    
    // Create force simulation
    this.createSimulation();
    
    // Render elements
    this.renderLinks();
    this.renderNodes();
    this.renderLabels();
    
    // Setup interactions
    this.setupInteractions();
    
    this.emit('rendered', { nodes: this.nodes.length, links: this.links.length });
  }

  createSimulation() {
    const { width, height } = this.getInnerDimensions();
    
    // Stop existing simulation
    if (this.simulation) {
      this.simulation.stop();
    }
    
    // Create new simulation
    this.simulation = {
      nodes: this.nodes,
      links: this.links,
      alpha: 1,
      alphaDecay: 0.0228,
      alphaMin: 0.001,
      running: false
    };
    
    // Initialize node positions
    this.nodes.forEach((node, i) => {
      if (!node.x) node.x = width / 2 + (Math.random() - 0.5) * 100;
      if (!node.y) node.y = height / 2 + (Math.random() - 0.5) * 100;
      node.vx = 0;
      node.vy = 0;
    });
    
    // Start simulation
    this.startSimulation();
  }

  startSimulation() {
    const { width, height } = this.getInnerDimensions();
    this.simulation.running = true;
    
    const tick = () => {
      if (!this.simulation.running || this.simulation.alpha < this.simulation.alphaMin) {
        this.simulation.running = false;
        return;
      }
      
      // Apply forces
      this.applyLinkForce();
      this.applyChargeForce();
      this.applyCenterForce(width / 2, height / 2);
      this.applyCollisionForce();
      
      // Update positions
      this.nodes.forEach(node => {
        node.vx *= 0.6; // velocity decay
        node.vy *= 0.6;
        
        node.x += node.vx;
        node.y += node.vy;
        
        // Keep nodes within bounds
        node.x = Math.max(this.networkOptions.nodeRadius, 
                Math.min(width - this.networkOptions.nodeRadius, node.x));
        node.y = Math.max(this.networkOptions.nodeRadius, 
                Math.min(height - this.networkOptions.nodeRadius, node.y));
      });
      
      // Update visual elements
      this.updatePositions();
      
      // Decay alpha
      this.simulation.alpha *= (1 - this.simulation.alphaDecay);
      
      requestAnimationFrame(tick);
    };
    
    requestAnimationFrame(tick);
  }

  applyLinkForce() {
    this.links.forEach(link => {
      const source = this.nodes.find(n => n.id === link.source || n.id === link.source.id);
      const target = this.nodes.find(n => n.id === link.target || n.id === link.target.id);
      
      if (!source || !target) return;
      
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      if (distance > 0) {
        const force = (distance - this.networkOptions.linkDistance) * 
                     this.networkOptions.linkStrength * this.simulation.alpha;
        const fx = (dx / distance) * force;
        const fy = (dy / distance) * force;
        
        source.vx += fx;
        source.vy += fy;
        target.vx -= fx;
        target.vy -= fy;
      }
    });
  }

  applyChargeForce() {
    for (let i = 0; i < this.nodes.length; i++) {
      for (let j = i + 1; j < this.nodes.length; j++) {
        const nodeA = this.nodes[i];
        const nodeB = this.nodes[j];
        
        const dx = nodeB.x - nodeA.x;
        const dy = nodeB.y - nodeA.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance > 0 && distance < 500) {
          const force = this.networkOptions.chargeStrength * this.simulation.alpha / (distance * distance);
          const fx = (dx / distance) * force;
          const fy = (dy / distance) * force;
          
          nodeA.vx -= fx;
          nodeA.vy -= fy;
          nodeB.vx += fx;
          nodeB.vy += fy;
        }
      }
    }
  }

  applyCenterForce(centerX, centerY) {
    const strength = this.networkOptions.centerStrength * this.simulation.alpha;
    
    this.nodes.forEach(node => {
      const dx = centerX - node.x;
      const dy = centerY - node.y;
      
      node.vx += dx * strength;
      node.vy += dy * strength;
    });
  }

  applyCollisionForce() {
    for (let i = 0; i < this.nodes.length; i++) {
      for (let j = i + 1; j < this.nodes.length; j++) {
        const nodeA = this.nodes[i];
        const nodeB = this.nodes[j];
        
        const dx = nodeB.x - nodeA.x;
        const dy = nodeB.y - nodeA.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const minDistance = this.networkOptions.collisionRadius * 2;
        
        if (distance < minDistance && distance > 0) {
          const force = (minDistance - distance) * 0.5 * this.simulation.alpha;
          const fx = (dx / distance) * force;
          const fy = (dy / distance) * force;
          
          nodeA.vx -= fx;
          nodeA.vy -= fy;
          nodeB.vx += fx;
          nodeB.vy += fy;
        }
      }
    }
  }

  renderLinks() {
    // Clear existing links
    this.linkGroup.innerHTML = '';
    
    const colors = this.getThemeColors();
    
    this.links.forEach((link, i) => {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('class', 'link');
      line.setAttribute('stroke', colors.grid);
      line.setAttribute('stroke-width', link.weight || 1);
      line.setAttribute('stroke-opacity', 0.6);
      line.setAttribute('data-index', i);
      
      this.linkGroup.appendChild(line);
    });
  }

  renderNodes() {
    // Clear existing nodes
    this.nodeGroup.innerHTML = '';
    
    const colors = this.getThemeColors();
    
    this.nodes.forEach((node, i) => {
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('class', 'node');
      circle.setAttribute('r', node.radius || this.networkOptions.nodeRadius);
      circle.setAttribute('fill', node.color || colors.palette[node.group % colors.palette.length]);
      circle.setAttribute('stroke', colors.background);
      circle.setAttribute('stroke-width', 2);
      circle.setAttribute('data-index', i);
      circle.style.cursor = 'pointer';
      
      this.nodeGroup.appendChild(circle);
    });
  }

  renderLabels() {
    // Clear existing labels
    this.labelGroup.innerHTML = '';
    
    const colors = this.getThemeColors();
    
    this.nodes.forEach((node, i) => {
      if (node.label) {
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('class', 'label');
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('dy', '.35em');
        text.setAttribute('font-size', '12px');
        text.setAttribute('fill', colors.text);
        text.setAttribute('pointer-events', 'none');
        text.setAttribute('data-index', i);
        text.textContent = node.label;
        
        this.labelGroup.appendChild(text);
      }
    });
  }

  updatePositions() {
    // Update link positions
    const links = this.linkGroup.querySelectorAll('line');
    links.forEach((line, i) => {
      const link = this.links[i];
      const source = this.nodes.find(n => n.id === link.source || n.id === link.source.id);
      const target = this.nodes.find(n => n.id === link.target || n.id === link.target.id);
      
      if (source && target) {
        line.setAttribute('x1', source.x);
        line.setAttribute('y1', source.y);
        line.setAttribute('x2', target.x);
        line.setAttribute('y2', target.y);
      }
    });
    
    // Update node positions
    const nodes = this.nodeGroup.querySelectorAll('circle');
    nodes.forEach((circle, i) => {
      const node = this.nodes[i];
      circle.setAttribute('cx', node.x);
      circle.setAttribute('cy', node.y);
    });
    
    // Update label positions
    const labels = this.labelGroup.querySelectorAll('text');
    labels.forEach((text, i) => {
      const node = this.nodes[i];
      if (node.label) {
        text.setAttribute('x', node.x);
        text.setAttribute('y', node.y);
      }
    });
  }

  setupInteractions() {
    // Node interactions
    const nodes = this.nodeGroup.querySelectorAll('circle');
    nodes.forEach((circle, i) => {
      // Drag behavior
      let isDragging = false;
      let dragStartX, dragStartY;
      
      circle.addEventListener('mousedown', (e) => {
        isDragging = true;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        this.selectedNode = this.nodes[i];
        e.preventDefault();
      });
      
      // Click behavior
      circle.addEventListener('click', (e) => {
        if (!isDragging) {
          this.emitInteraction('click', e, this.nodes[i]);
        }
      });
      
      // Hover behavior
      circle.addEventListener('mouseenter', (e) => {
        circle.setAttribute('r', (this.nodes[i].radius || this.networkOptions.nodeRadius) * 1.2);
        this.emitInteraction('hover', e, this.nodes[i]);
      });
      
      circle.addEventListener('mouseleave', (e) => {
        circle.setAttribute('r', this.nodes[i].radius || this.networkOptions.nodeRadius);
      });
    });
    
    // Global mouse events for dragging
    document.addEventListener('mousemove', (e) => {
      if (this.selectedNode && isDragging) {
        const dx = e.clientX - dragStartX;
        const dy = e.clientY - dragStartY;
        
        this.selectedNode.x += dx / this.currentZoom;
        this.selectedNode.y += dy / this.currentZoom;
        
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        
        this.updatePositions();
      }
    });
    
    document.addEventListener('mouseup', () => {
      this.selectedNode = null;
      isDragging = false;
    });
  }

  setupZoom() {
    this.currentZoom = 1;
    let currentX = 0;
    let currentY = 0;
    
    this.svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      
      const scaleFactor = e.deltaY > 0 ? 0.9 : 1.1;
      const newZoom = this.currentZoom * scaleFactor;
      
      // Limit zoom
      if (newZoom < 0.1 || newZoom > 10) return;
      
      // Get mouse position relative to SVG
      const rect = this.svg.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      // Calculate new translation to zoom around mouse position
      currentX = x - (x - currentX) * scaleFactor;
      currentY = y - (y - currentY) * scaleFactor;
      
      this.currentZoom = newZoom;
      this.mainGroup.setAttribute('transform', 
        `translate(${currentX},${currentY}) scale(${this.currentZoom})`);
      
      this.emit('zoom', { scale: this.currentZoom, center: { x, y } });
    });
  }

  async update(data, options = {}) {
    if (!data || !data.nodes || !data.links) {
      throw new Error('Data must contain nodes and links arrays');
    }
    
    this.data = data;
    
    // Update with new data
    if (options.animate !== false) {
      // Animated update - merge new data with existing positions
      const nodeMap = new Map(this.nodes.map(n => [n.id, n]));
      
      this.nodes = data.nodes.map(node => {
        const existing = nodeMap.get(node.id);
        return {
          ...node,
          x: existing ? existing.x : this.getInnerDimensions().width / 2,
          y: existing ? existing.y : this.getInnerDimensions().height / 2,
          vx: existing ? existing.vx : 0,
          vy: existing ? existing.vy : 0
        };
      });
      
      this.links = data.links.map(d => ({ ...d }));
      
      // Restart simulation with lower alpha for smooth transition
      this.simulation.alpha = 0.3;
      this.startSimulation();
    } else {
      // Immediate update
      this.nodes = data.nodes.map(d => ({ ...d }));
      this.links = data.links.map(d => ({ ...d }));
      this.createSimulation();
    }
    
    // Re-render elements
    this.renderLinks();
    this.renderNodes();
    this.renderLabels();
    this.setupInteractions();
    
    this.emit('updated');
  }

  destroy() {
    if (this.simulation) {
      this.simulation.running = false;
      this.simulation = null;
    }
    
    super.destroy();
  }

  async applyFilter(filter) {
    if (!filter) return;
    
    const colors = this.getThemeColors();
    
    // Filter by node properties
    if (filter.nodes) {
      const nodeElements = this.nodeGroup.querySelectorAll('circle');
      nodeElements.forEach((circle, i) => {
        const node = this.nodes[i];
        const visible = filter.nodes(node);
        circle.style.opacity = visible ? 1 : 0.2;
        circle.style.pointerEvents = visible ? 'auto' : 'none';
      });
      
      // Also dim connected links
      const linkElements = this.linkGroup.querySelectorAll('line');
      linkElements.forEach((line, i) => {
        const link = this.links[i];
        const sourceVisible = filter.nodes(this.nodes.find(n => n.id === link.source || n.id === link.source.id));
        const targetVisible = filter.nodes(this.nodes.find(n => n.id === link.target || n.id === link.target.id));
        line.style.opacity = sourceVisible && targetVisible ? 0.6 : 0.1;
      });
    }
    
    await super.applyFilter(filter);
  }

  /**
   * Highlight connected nodes
   */
  highlightConnections(nodeId) {
    const connectedNodes = new Set([nodeId]);
    const connectedLinks = new Set();
    
    // Find all connected nodes
    this.links.forEach((link, i) => {
      if (link.source === nodeId || link.source.id === nodeId) {
        connectedNodes.add(link.target.id || link.target);
        connectedLinks.add(i);
      } else if (link.target === nodeId || link.target.id === nodeId) {
        connectedNodes.add(link.source.id || link.source);
        connectedLinks.add(i);
      }
    });
    
    // Update visual appearance
    const nodeElements = this.nodeGroup.querySelectorAll('circle');
    nodeElements.forEach((circle, i) => {
      const node = this.nodes[i];
      circle.style.opacity = connectedNodes.has(node.id) ? 1 : 0.2;
    });
    
    const linkElements = this.linkGroup.querySelectorAll('line');
    linkElements.forEach((line, i) => {
      line.style.opacity = connectedLinks.has(i) ? 1 : 0.1;
    });
  }

  /**
   * Reset highlighting
   */
  resetHighlight() {
    const nodeElements = this.nodeGroup.querySelectorAll('circle');
    nodeElements.forEach(circle => {
      circle.style.opacity = 1;
    });
    
    const linkElements = this.linkGroup.querySelectorAll('line');
    linkElements.forEach(line => {
      line.style.opacity = 0.6;
    });
  }
}

module.exports = NetworkRenderer;