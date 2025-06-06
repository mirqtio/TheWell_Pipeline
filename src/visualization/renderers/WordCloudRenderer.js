const BaseRenderer = require('./BaseRenderer');
const logger = require('../../utils/logger');

/**
 * WordCloudRenderer - Renderer for word cloud visualizations
 */
class WordCloudRenderer extends BaseRenderer {
  constructor(container, options = {}) {
    super(container, options);
    
    this.wordCloudOptions = {
      fontFamily: options.fontFamily || 'Arial, sans-serif',
      minFontSize: options.minFontSize || 10,
      maxFontSize: options.maxFontSize || 60,
      padding: options.padding || 5,
      rotations: options.rotations || [0, 90],
      spiral: options.spiral || 'archimedean',
      ...options.wordCloudOptions
    };
  }

  async initialize() {
    if (this.initialized) return;
    
    const { svg, g } = this.createSVG();
    this.svg = svg;
    this.mainGroup = g;
    
    this.wordsGroup = this.createGroup('words');
    
    this.initialized = true;
    logger.info('WordCloudRenderer initialized');
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
      throw new Error('Data must be an array of word objects');
    }
    
    this.data = data;
    const layout = this.computeLayout(data);
    
    this.renderWords(layout);
    this.setupInteractions();
    
    this.emit('rendered', { words: layout.length });
  }

  computeLayout(words) {
    const { width, height } = this.getInnerDimensions();
    
    // Normalize word sizes
    const maxCount = Math.max(...words.map(w => w.count || w.value || 1));
    const minCount = Math.min(...words.map(w => w.count || w.value || 1));
    const sizeScale = this.createSizeScale(minCount, maxCount);
    
    // Simple spiral layout
    const layout = [];
    const placed = [];
    const centerX = width / 2;
    const centerY = height / 2;
    
    words.forEach((word, i) => {
      const fontSize = sizeScale(word.count || word.value || 1);
      const text = word.text || word.word || word.name || '';
      const rotation = this.wordCloudOptions.rotations[
        Math.floor(Math.random() * this.wordCloudOptions.rotations.length)
      ];
      
      // Estimate text dimensions
      const textWidth = text.length * fontSize * 0.6;
      const textHeight = fontSize;
      
      // Find position using spiral
      let position = null;
      let t = 0;
      const dt = 0.1;
      
      while (!position && t < 100) {
        const angle = t * 2 * Math.PI;
        const radius = t * 5;
        const x = centerX + radius * Math.cos(angle);
        const y = centerY + radius * Math.sin(angle);
        
        // Check collision
        const bounds = {
          x: x - textWidth / 2,
          y: y - textHeight / 2,
          width: textWidth,
          height: textHeight
        };
        
        if (!this.hasCollision(bounds, placed)) {
          position = { x, y };
          placed.push(bounds);
        }
        
        t += dt;
      }
      
      if (position) {
        layout.push({
          ...word,
          x: position.x,
          y: position.y,
          fontSize,
          rotation,
          text
        });
      }
    });
    
    return layout;
  }

  createSizeScale(min, max) {
    const range = max - min || 1;
    return (value) => {
      const normalized = (value - min) / range;
      return this.wordCloudOptions.minFontSize + 
             normalized * (this.wordCloudOptions.maxFontSize - this.wordCloudOptions.minFontSize);
    };
  }

  hasCollision(bounds, placed) {
    return placed.some(p => 
      bounds.x < p.x + p.width &&
      bounds.x + bounds.width > p.x &&
      bounds.y < p.y + p.height &&
      bounds.y + bounds.height > p.y
    );
  }

  renderWords(words) {
    this.wordsGroup.innerHTML = '';
    const colors = this.getThemeColors();
    
    words.forEach((word, i) => {
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('class', 'word');
      text.setAttribute('x', word.x);
      text.setAttribute('y', word.y);
      text.setAttribute('font-size', word.fontSize);
      text.setAttribute('font-family', this.wordCloudOptions.fontFamily);
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('fill', word.color || colors.palette[i % colors.palette.length]);
      text.setAttribute('transform', `rotate(${word.rotation} ${word.x} ${word.y})`);
      text.style.cursor = 'pointer';
      text.textContent = word.text;
      text._word = word;
      
      this.wordsGroup.appendChild(text);
    });
  }

  setupInteractions() {
    const words = this.wordsGroup.querySelectorAll('text');
    
    words.forEach(text => {
      text.addEventListener('mouseenter', (e) => {
        text.style.opacity = '0.7';
        text.style.fontWeight = 'bold';
        this.emitInteraction('hover', e, text._word);
      });
      
      text.addEventListener('mouseleave', () => {
        text.style.opacity = '1';
        text.style.fontWeight = 'normal';
      });
      
      text.addEventListener('click', (e) => {
        this.emitInteraction('click', e, text._word);
      });
    });
  }

  async update(data, options = {}) {
    this.data = data;
    const layout = this.computeLayout(data);
    
    if (options.animate !== false) {
      await this.animateTransition(layout);
    } else {
      this.renderWords(layout);
      this.setupInteractions();
    }
    
    this.emit('updated');
  }

  async animateTransition(newLayout) {
    const duration = this.options.animation.duration;
    const oldWords = Array.from(this.wordsGroup.querySelectorAll('text'));
    const oldPositions = new Map();
    
    oldWords.forEach(text => {
      const word = text._word;
      oldPositions.set(word.text, {
        x: parseFloat(text.getAttribute('x')),
        y: parseFloat(text.getAttribute('y')),
        fontSize: parseFloat(text.getAttribute('font-size'))
      });
    });
    
    this.renderWords(newLayout);
    const newWords = Array.from(this.wordsGroup.querySelectorAll('text'));
    
    const startTime = Date.now();
    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      newWords.forEach(text => {
        const word = text._word;
        const oldPos = oldPositions.get(word.text);
        
        if (oldPos) {
          const x = oldPos.x + (word.x - oldPos.x) * progress;
          const y = oldPos.y + (word.y - oldPos.y) * progress;
          const fontSize = oldPos.fontSize + (word.fontSize - oldPos.fontSize) * progress;
          
          text.setAttribute('x', x);
          text.setAttribute('y', y);
          text.setAttribute('font-size', fontSize);
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

  async applyFilter(filter) {
    if (!filter) return;
    
    const words = this.wordsGroup.querySelectorAll('text');
    
    words.forEach(text => {
      const word = text._word;
      let visible = true;
      
      if (filter.minCount !== undefined && (word.count || word.value) < filter.minCount) {
        visible = false;
      }
      if (filter.categories && word.category && !filter.categories.includes(word.category)) {
        visible = false;
      }
      if (filter.search && !word.text.toLowerCase().includes(filter.search.toLowerCase())) {
        visible = false;
      }
      
      text.style.opacity = visible ? 1 : 0.1;
      text.style.pointerEvents = visible ? 'auto' : 'none';
    });
    
    await super.applyFilter(filter);
  }
}

module.exports = WordCloudRenderer;