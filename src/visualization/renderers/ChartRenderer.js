const BaseRenderer = require('./BaseRenderer');
const logger = require('../../utils/logger');

/**
 * ChartRenderer - Renderer for Chart.js based visualizations
 * Supports line, bar, pie, doughnut, radar, and other Chart.js chart types
 */
class ChartRenderer extends BaseRenderer {
  constructor(container, options = {}) {
    super(container, options);
    
    // Chart.js specific options
    this.chartOptions = {
      type: options.chartType || 'line',
      responsive: this.options.responsive,
      maintainAspectRatio: false,
      animation: {
        duration: this.options.animation.duration
      },
      plugins: {
        legend: {
          display: options.showLegend !== false,
          position: options.legendPosition || 'top'
        },
        tooltip: {
          enabled: options.showTooltip !== false,
          mode: 'index',
          intersect: false
        }
      },
      ...options.chartOptions
    };
  }

  async initialize() {
    if (this.initialized) return;
    
    // Check if Chart.js is available
    if (typeof Chart === 'undefined') {
      // Try to use the module if available
      try {
        const ChartModule = require('chart.js/auto');
        window.Chart = ChartModule;
      } catch (error) {
        throw new Error('Chart.js is not available. Please include it in your project.');
      }
    }
    
    this.initialized = true;
    logger.info('ChartRenderer initialized');
  }

  async render(data) {
    await this.initialize();
    
    if (!data) {
      throw new Error('Data is required for rendering');
    }
    
    this.data = data;
    
    // Create canvas if not exists
    let canvas = this.container.querySelector('canvas');
    if (!canvas) {
      const result = this.createCanvas();
      canvas = result.canvas;
    }
    
    // Destroy existing chart
    if (this.chart) {
      this.chart.destroy();
    }
    
    // Create new chart
    const ctx = canvas.getContext('2d');
    const colors = this.getThemeColors();
    
    this.chart = new Chart(ctx, {
      type: this.chartOptions.type,
      data: this.processData(data, colors),
      options: this.createChartOptions(colors)
    });
    
    // Setup event handlers
    this.setupEventHandlers();
    
    this.emit('rendered', { type: this.chartOptions.type });
    return this.chart;
  }

  async update(data, options = {}) {
    if (!this.chart) {
      return this.render(data);
    }
    
    this.data = data;
    const colors = this.getThemeColors();
    
    if (options.themeOnly) {
      // Update only theme-related properties
      this.chart.options = this.createChartOptions(colors);
      this.chart.update('none');
    } else {
      // Update data and options
      this.chart.data = this.processData(data, colors);
      if (options.chartOptions) {
        Object.assign(this.chart.options, options.chartOptions);
      }
      
      const mode = options.animate !== false ? 'default' : 'none';
      this.chart.update(mode);
    }
    
    this.emit('updated');
  }

  processData(data, colors) {
    // Handle different data formats
    if (data.datasets) {
      // Already in Chart.js format
      return {
        ...data,
        datasets: data.datasets.map((dataset, index) => ({
          ...dataset,
          backgroundColor: dataset.backgroundColor || colors.palette[index % colors.palette.length],
          borderColor: dataset.borderColor || colors.palette[index % colors.palette.length]
        }))
      };
    }
    
    // Convert simple data format
    if (Array.isArray(data)) {
      return {
        labels: data.map((d, i) => d.label || `Item ${i + 1}`),
        datasets: [{
          label: 'Value',
          data: data.map(d => d.value || d),
          backgroundColor: colors.palette,
          borderColor: colors.palette
        }]
      };
    }
    
    // Handle object with x,y format
    if (data.x && data.y) {
      return {
        labels: data.x,
        datasets: [{
          label: data.label || 'Dataset',
          data: data.y,
          backgroundColor: colors.primary,
          borderColor: colors.primary
        }]
      };
    }
    
    throw new Error('Unsupported data format');
  }

  createChartOptions(colors) {
    const options = {
      ...this.chartOptions,
      plugins: {
        ...this.chartOptions.plugins,
        legend: {
          ...this.chartOptions.plugins.legend,
          labels: {
            color: colors.text
          }
        },
        tooltip: {
          ...this.chartOptions.plugins.tooltip,
          backgroundColor: colors.background,
          titleColor: colors.text,
          bodyColor: colors.text,
          borderColor: colors.grid,
          borderWidth: 1
        }
      },
      scales: this.createScales(colors)
    };
    
    // Add specific options based on chart type
    switch (this.chartOptions.type) {
      case 'pie':
      case 'doughnut':
        delete options.scales;
        break;
      case 'radar':
        options.scales = {
          r: {
            grid: { color: colors.grid },
            pointLabels: { color: colors.text },
            ticks: { color: colors.text }
          }
        };
        break;
    }
    
    return options;
  }

  createScales(colors) {
    const scaleConfig = {
      grid: { color: colors.grid },
      ticks: { color: colors.text },
      title: { color: colors.text }
    };
    
    return {
      x: { ...scaleConfig },
      y: { ...scaleConfig }
    };
  }

  setupEventHandlers() {
    if (!this.chart) return;
    
    // Click handler
    this.chart.options.onClick = (event, elements) => {
      if (elements.length > 0) {
        const element = elements[0];
        const datasetIndex = element.datasetIndex;
        const index = element.index;
        const dataset = this.chart.data.datasets[datasetIndex];
        const value = dataset.data[index];
        const label = this.chart.data.labels[index];
        
        this.emitInteraction('click', event, {
          datasetIndex,
          index,
          value,
          label,
          dataset: dataset.label
        });
      }
    };
    
    // Hover handler
    this.chart.options.onHover = (event, elements) => {
      this.container.style.cursor = elements.length > 0 ? 'pointer' : 'default';
      
      if (elements.length > 0) {
        const element = elements[0];
        const datasetIndex = element.datasetIndex;
        const index = element.index;
        const dataset = this.chart.data.datasets[datasetIndex];
        const value = dataset.data[index];
        const label = this.chart.data.labels[index];
        
        this.emitInteraction('hover', event, {
          datasetIndex,
          index,
          value,
          label,
          dataset: dataset.label
        });
      }
    };
  }

  async handleResize() {
    if (this.chart) {
      this.chart.resize();
    }
  }

  destroy() {
    if (this.chart) {
      this.chart.destroy();
      this.chart = null;
    }
    super.destroy();
  }

  async toPNG(options = {}) {
    if (!this.chart) {
      throw new Error('No chart available for export');
    }
    
    return this.chart.toBase64Image();
  }

  async applyFilter(filter) {
    if (!this.chart || !filter) return;
    
    // Apply filter by hiding/showing datasets or data points
    if (filter.datasets) {
      this.chart.data.datasets.forEach((dataset, index) => {
        dataset.hidden = !filter.datasets.includes(index);
      });
    }
    
    if (filter.labels) {
      // Filter data points - more complex, requires data restructuring
      const filteredIndices = this.chart.data.labels
        .map((label, index) => filter.labels.includes(label) ? index : null)
        .filter(index => index !== null);
      
      // Store original data if not already stored
      if (!this.originalData) {
        this.originalData = JSON.parse(JSON.stringify(this.chart.data));
      }
      
      // Update chart with filtered data
      this.chart.data.labels = filteredIndices.map(i => this.originalData.labels[i]);
      this.chart.data.datasets.forEach((dataset, datasetIndex) => {
        dataset.data = filteredIndices.map(i => this.originalData.datasets[datasetIndex].data[i]);
      });
    }
    
    this.chart.update('none');
    await super.applyFilter(filter);
  }

  /**
   * Change chart type dynamically
   */
  async changeType(newType) {
    if (!this.chart) return;
    
    this.chartOptions.type = newType;
    this.chart.config.type = newType;
    
    // Recreate chart with new type
    await this.render(this.data);
  }

  /**
   * Toggle dataset visibility
   */
  toggleDataset(datasetIndex) {
    if (!this.chart) return;
    
    const dataset = this.chart.data.datasets[datasetIndex];
    if (dataset) {
      dataset.hidden = !dataset.hidden;
      this.chart.update('none');
    }
  }

  /**
   * Update specific dataset
   */
  updateDataset(datasetIndex, newData) {
    if (!this.chart) return;
    
    const dataset = this.chart.data.datasets[datasetIndex];
    if (dataset) {
      dataset.data = newData;
      this.chart.update();
    }
  }
}

module.exports = ChartRenderer;