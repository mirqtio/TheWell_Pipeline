/**
 * Real-time Dashboard Component
 * Handles real-time updates for dashboard metrics and visualizations
 */

class RealtimeDashboard {
  constructor(containerId, options = {}) {
    this.container = document.getElementById(containerId);
    this.charts = new Map();
    this.metrics = new Map();
    this.refreshInterval = options.refreshInterval || 5000;
    this.maxDataPoints = options.maxDataPoints || 100;
    
    // Chart.js configuration
    this.chartDefaults = {
      responsive: true,
      maintainAspectRatio: false,
      animation: {
        duration: 0
      },
      scales: {
        x: {
          type: 'time',
          time: {
            displayFormats: {
              minute: 'HH:mm',
              hour: 'HH:mm'
            }
          }
        },
        y: {
          beginAtZero: true
        }
      }
    };
    
    this.initialize();
  }

  initialize() {
    // Set up real-time client listeners
    this.setupRealtimeListeners();
    
    // Create dashboard layout
    this.createDashboardLayout();
    
    // Initialize charts
    this.initializeCharts();
    
    // Subscribe to metrics
    this.subscribeToMetrics();
    
    // Load initial data
    this.loadInitialData();
  }

  setupRealtimeListeners() {
    if (!window.realtimeClient) {
      console.error('Realtime client not initialized');
      return;
    }

    // Analytics metrics
    window.realtimeClient.on('analytics:metric', (data) => {
      this.updateMetric(data);
    });

    // Performance updates
    window.realtimeClient.on('performance:update', (data) => {
      this.updatePerformanceMetrics(data);
    });

    // Alert notifications
    window.realtimeClient.on('alert:received', (alert) => {
      this.addAlert(alert);
    });

    // Activity updates
    window.realtimeClient.on('activity:update', (activity) => {
      this.addActivity(activity);
    });

    // Connection status
    window.realtimeClient.on('connection:established', () => {
      this.updateConnectionStatus('connected');
    });

    window.realtimeClient.on('connection:lost', () => {
      this.updateConnectionStatus('disconnected');
    });
  }

  createDashboardLayout() {
    this.container.innerHTML = `
      <div class="dashboard-header">
        <h1>Real-time Analytics Dashboard</h1>
        <div class="connection-status" id="connection-status">
          <span class="status-indicator"></span>
          <span class="status-text">Connecting...</span>
        </div>
      </div>
      
      <div class="dashboard-grid">
        <!-- Key Metrics -->
        <div class="dashboard-section metrics-section">
          <h2>Key Metrics</h2>
          <div class="metrics-grid" id="key-metrics">
            <div class="metric-card" data-metric="document.processing.count">
              <div class="metric-label">Documents Processed</div>
              <div class="metric-value">-</div>
              <div class="metric-trend"></div>
            </div>
            <div class="metric-card" data-metric="search.query.count">
              <div class="metric-label">Search Queries</div>
              <div class="metric-value">-</div>
              <div class="metric-trend"></div>
            </div>
            <div class="metric-card" data-metric="api.request.count">
              <div class="metric-label">API Requests</div>
              <div class="metric-value">-</div>
              <div class="metric-trend"></div>
            </div>
            <div class="metric-card" data-metric="system.error.count">
              <div class="metric-label">Errors</div>
              <div class="metric-value">-</div>
              <div class="metric-trend"></div>
            </div>
          </div>
        </div>
        
        <!-- Charts -->
        <div class="dashboard-section chart-section">
          <h2>Processing Performance</h2>
          <canvas id="processing-chart" height="200"></canvas>
        </div>
        
        <div class="dashboard-section chart-section">
          <h2>Search Latency</h2>
          <canvas id="latency-chart" height="200"></canvas>
        </div>
        
        <div class="dashboard-section chart-section">
          <h2>System Resources</h2>
          <canvas id="resources-chart" height="200"></canvas>
        </div>
        
        <!-- Alerts -->
        <div class="dashboard-section alerts-section">
          <h2>Recent Alerts</h2>
          <div class="alerts-list" id="alerts-list">
            <div class="empty-state">No alerts</div>
          </div>
        </div>
        
        <!-- Activity Feed -->
        <div class="dashboard-section activity-section">
          <h2>Recent Activity</h2>
          <div class="activity-feed" id="activity-feed">
            <div class="empty-state">No recent activity</div>
          </div>
        </div>
      </div>
    `;
  }

  initializeCharts() {
    // Processing performance chart
    this.charts.set('processing', new Chart(
      document.getElementById('processing-chart').getContext('2d'),
      {
        type: 'line',
        data: {
          datasets: [{
            label: 'Processing Time (ms)',
            data: [],
            borderColor: 'rgb(75, 192, 192)',
            backgroundColor: 'rgba(75, 192, 192, 0.1)',
            tension: 0.1
          }, {
            label: 'Documents/min',
            data: [],
            borderColor: 'rgb(255, 159, 64)',
            backgroundColor: 'rgba(255, 159, 64, 0.1)',
            tension: 0.1,
            yAxisID: 'y1'
          }]
        },
        options: {
          ...this.chartDefaults,
          scales: {
            ...this.chartDefaults.scales,
            y1: {
              type: 'linear',
              display: true,
              position: 'right',
              grid: {
                drawOnChartArea: false
              }
            }
          }
        }
      }
    ));

    // Search latency chart
    this.charts.set('latency', new Chart(
      document.getElementById('latency-chart').getContext('2d'),
      {
        type: 'line',
        data: {
          datasets: [{
            label: 'Average Latency (ms)',
            data: [],
            borderColor: 'rgb(153, 102, 255)',
            backgroundColor: 'rgba(153, 102, 255, 0.1)',
            tension: 0.1
          }, {
            label: 'P95 Latency (ms)',
            data: [],
            borderColor: 'rgb(255, 99, 132)',
            backgroundColor: 'rgba(255, 99, 132, 0.1)',
            tension: 0.1
          }]
        },
        options: this.chartDefaults
      }
    ));

    // System resources chart
    this.charts.set('resources', new Chart(
      document.getElementById('resources-chart').getContext('2d'),
      {
        type: 'line',
        data: {
          datasets: [{
            label: 'CPU Usage (%)',
            data: [],
            borderColor: 'rgb(54, 162, 235)',
            backgroundColor: 'rgba(54, 162, 235, 0.1)',
            tension: 0.1
          }, {
            label: 'Memory Usage (%)',
            data: [],
            borderColor: 'rgb(255, 206, 86)',
            backgroundColor: 'rgba(255, 206, 86, 0.1)',
            tension: 0.1
          }]
        },
        options: {
          ...this.chartDefaults,
          scales: {
            ...this.chartDefaults.scales,
            y: {
              beginAtZero: true,
              max: 100
            }
          }
        }
      }
    ));
  }

  subscribeToMetrics() {
    const metrics = [
      'document.processing.time',
      'document.processing.count',
      'search.query.latency',
      'search.query.count',
      'api.request.count',
      'api.request.latency',
      'system.cpu.usage',
      'system.memory.usage',
      'system.error.count'
    ];

    window.realtimeClient.subscribeToMetrics(metrics);
    window.realtimeClient.subscribeToPerformance();
    window.realtimeClient.subscribeToAlerts(['anomaly', 'threshold', 'system']);
    window.realtimeClient.subscribeToActivity('all');
  }

  async loadInitialData() {
    try {
      const response = await fetch('/api/dashboard/metrics?timeRange=1h');
      const data = await response.json();
      
      // Update initial metric values
      this.updateInitialMetrics(data);
    } catch (error) {
      console.error('Failed to load initial data:', error);
    }
  }

  updateMetric(data) {
    const { metric, value, aggregation, timeWindow, timestamp } = data;
    
    // Update metric cards
    const metricCard = document.querySelector(`[data-metric="${metric}"]`);
    if (metricCard) {
      const valueEl = metricCard.querySelector('.metric-value');
      const trendEl = metricCard.querySelector('.metric-trend');
      
      if (valueEl) {
        const formattedValue = this.formatMetricValue(metric, value);
        valueEl.textContent = formattedValue;
      }
      
      // Update trend if available
      if (trendEl && aggregation) {
        this.updateTrend(trendEl, metric, value);
      }
    }
    
    // Update charts
    this.updateCharts(metric, value, timestamp);
    
    // Store metric for trend calculation
    if (!this.metrics.has(metric)) {
      this.metrics.set(metric, []);
    }
    this.metrics.get(metric).push({ value, timestamp });
    
    // Keep only recent data points
    const metricData = this.metrics.get(metric);
    if (metricData.length > this.maxDataPoints) {
      metricData.shift();
    }
  }

  updateCharts(metric, value, timestamp) {
    const chartData = { x: new Date(timestamp), y: value };
    
    switch (metric) {
    case 'document.processing.time':
      this.addChartData('processing', 0, chartData);
      break;
    case 'document.processing.count':
      this.addChartData('processing', 1, chartData);
      break;
    case 'search.query.latency':
      this.addChartData('latency', 0, chartData);
      break;
    case 'system.cpu.usage':
      this.addChartData('resources', 0, chartData);
      break;
    case 'system.memory.usage':
      this.addChartData('resources', 1, chartData);
      break;
    }
  }

  addChartData(chartName, datasetIndex, data) {
    const chart = this.charts.get(chartName);
    if (!chart) return;
    
    const dataset = chart.data.datasets[datasetIndex];
    dataset.data.push(data);
    
    // Remove old data points
    if (dataset.data.length > this.maxDataPoints) {
      dataset.data.shift();
    }
    
    chart.update('none'); // Update without animation
  }

  updatePerformanceMetrics(data) {
    // Update system resource metrics
    if (data.cpu !== undefined) {
      this.updateMetric({
        metric: 'system.cpu.usage',
        value: data.cpu,
        timestamp: data.timestamp || Date.now()
      });
    }
    
    if (data.memory !== undefined) {
      this.updateMetric({
        metric: 'system.memory.usage',
        value: data.memory,
        timestamp: data.timestamp || Date.now()
      });
    }
  }

  addAlert(alert) {
    const alertsList = document.getElementById('alerts-list');
    
    // Remove empty state
    const emptyState = alertsList.querySelector('.empty-state');
    if (emptyState) {
      emptyState.remove();
    }
    
    // Create alert element
    const alertEl = document.createElement('div');
    alertEl.className = `alert-item alert-${alert.severity}`;
    alertEl.innerHTML = `
      <div class="alert-header">
        <span class="alert-type">${alert.type}</span>
        <span class="alert-time">${this.formatTime(alert.timestamp)}</span>
      </div>
      <div class="alert-message">${alert.message}</div>
      <button class="alert-acknowledge" data-alert-id="${alert.alertId}">
        Acknowledge
      </button>
    `;
    
    // Add click handler
    alertEl.querySelector('.alert-acknowledge').addEventListener('click', (e) => {
      this.acknowledgeAlert(alert.alertId, alertEl);
    });
    
    // Add to list (newest first)
    alertsList.insertBefore(alertEl, alertsList.firstChild);
    
    // Limit number of alerts shown
    while (alertsList.children.length > 10) {
      alertsList.removeChild(alertsList.lastChild);
    }
  }

  acknowledgeAlert(alertId, alertEl) {
    window.realtimeClient.acknowledgeAlert(alertId, (response) => {
      if (response.status === 'acknowledged') {
        alertEl.classList.add('acknowledged');
        alertEl.querySelector('.alert-acknowledge').disabled = true;
      }
    });
  }

  addActivity(activity) {
    const activityFeed = document.getElementById('activity-feed');
    
    // Remove empty state
    const emptyState = activityFeed.querySelector('.empty-state');
    if (emptyState) {
      emptyState.remove();
    }
    
    // Create activity element
    const activityEl = document.createElement('div');
    activityEl.className = 'activity-item';
    activityEl.innerHTML = `
      <div class="activity-icon">${this.getActivityIcon(activity.action)}</div>
      <div class="activity-content">
        <div class="activity-description">
          <span class="activity-user">User ${activity.userId}</span>
          ${activity.action} ${activity.resource.type}
        </div>
        <div class="activity-time">${this.formatTime(activity.timestamp)}</div>
      </div>
    `;
    
    // Add to feed (newest first)
    activityFeed.insertBefore(activityEl, activityFeed.firstChild);
    
    // Limit number of activities shown
    while (activityFeed.children.length > 20) {
      activityFeed.removeChild(activityFeed.lastChild);
    }
  }

  updateConnectionStatus(status) {
    const statusEl = document.getElementById('connection-status');
    const indicatorEl = statusEl.querySelector('.status-indicator');
    const textEl = statusEl.querySelector('.status-text');
    
    statusEl.className = `connection-status status-${status}`;
    
    switch (status) {
    case 'connected':
      textEl.textContent = 'Connected';
      break;
    case 'disconnected':
      textEl.textContent = 'Disconnected';
      break;
    case 'connecting':
      textEl.textContent = 'Connecting...';
      break;
    case 'error':
      textEl.textContent = 'Connection Error';
      break;
    }
  }

  // Utility methods
  formatMetricValue(metric, value) {
    if (metric.includes('count')) {
      return this.formatNumber(value);
    } else if (metric.includes('time') || metric.includes('latency')) {
      return `${Math.round(value)}ms`;
    } else if (metric.includes('usage') || metric.includes('rate')) {
      return `${value.toFixed(1)}%`;
    }
    return value.toFixed(2);
  }

  formatNumber(num) {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + 'M';
    } else if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
  }

  formatTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    
    if (diff < 60000) {
      return 'Just now';
    } else if (diff < 3600000) {
      return `${Math.floor(diff / 60000)}m ago`;
    } else if (diff < 86400000) {
      return `${Math.floor(diff / 3600000)}h ago`;
    }
    return date.toLocaleString();
  }

  updateTrend(element, metric, currentValue) {
    const metricData = this.metrics.get(metric);
    if (!metricData || metricData.length < 2) return;
    
    const previousValue = metricData[metricData.length - 2].value;
    const change = ((currentValue - previousValue) / previousValue) * 100;
    
    if (change > 0) {
      element.innerHTML = `<span class="trend-up">↑ ${change.toFixed(1)}%</span>`;
    } else if (change < 0) {
      element.innerHTML = `<span class="trend-down">↓ ${Math.abs(change).toFixed(1)}%</span>`;
    } else {
      element.innerHTML = '<span class="trend-stable">→ 0%</span>';
    }
  }

  getActivityIcon(action) {
    const icons = {
      'create': '➕',
      'update': '✏️',
      'delete': '🗑️',
      'view': '👁️',
      'search': '🔍',
      'process': '⚙️',
      'approve': '✅',
      'reject': '❌'
    };
    return icons[action] || '📌';
  }

  // Public methods
  refresh() {
    this.loadInitialData();
  }

  destroy() {
    // Clean up charts
    this.charts.forEach(chart => chart.destroy());
    this.charts.clear();
    
    // Clear metrics
    this.metrics.clear();
    
    // Remove event listeners
    // (Real-time client listeners are managed by the client itself)
  }
}

// Initialize dashboard when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('realtime-dashboard')) {
    window.realtimeDashboard = new RealtimeDashboard('realtime-dashboard');
  }
});