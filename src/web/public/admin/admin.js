/**
 * Admin Dashboard JavaScript
 * Handles navigation, data loading, and interactive components
 */

class AdminDashboard {
    constructor() {
        this.currentView = 'overview';
        this.timeRange = '24h';
        this.refreshInterval = null;
        this.charts = {};
        
        this.init();
    }
    
    init() {
        this.setupEventListeners();
        this.setupCharts();
        this.loadData();
        this.startAutoRefresh();
    }
    
    setupEventListeners() {
        // Sidebar toggle
        document.getElementById('sidebarToggle').addEventListener('click', () => {
            this.toggleSidebar();
        });
        
        // Navigation links
        document.querySelectorAll('[data-view]').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const view = e.currentTarget.dataset.view;
                this.switchView(view);
            });
        });
        
        // Time range selector
        document.querySelectorAll('[data-timerange]').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                this.timeRange = e.currentTarget.dataset.timerange;
                this.updateTimeRangeDisplay();
                this.loadData();
            });
        });
        
        // Refresh button
        document.getElementById('refreshData').addEventListener('click', () => {
            this.loadData();
        });
        
        // Mobile responsive handling
        window.addEventListener('resize', () => {
            this.handleResize();
        });
    }
    
    toggleSidebar() {
        const sidebar = document.getElementById('adminSidebar');
        const main = document.getElementById('adminMain');
        
        if (window.innerWidth <= 768) {
            sidebar.classList.toggle('mobile-open');
        } else {
            sidebar.classList.toggle('collapsed');
            main.classList.toggle('expanded');
        }
    }
    
    switchView(view) {
        // Update active navigation
        document.querySelectorAll('.nav-link').forEach(link => {
            link.classList.remove('active');
        });
        document.querySelector(`[data-view="${view}"]`).classList.add('active');
        
        // Update page title
        this.updatePageTitle(view);
        
        // Load view content
        this.loadViewContent(view);
        
        this.currentView = view;
    }
    
    updatePageTitle(view) {
        const titles = {
            overview: { title: 'Dashboard Overview', subtitle: 'System status and key metrics' },
            monitoring: { title: 'System Health', subtitle: 'Real-time monitoring and alerts' },
            ingestion: { title: 'Source Monitoring', subtitle: 'Ingestion pipeline status' },
            'ingestion-config': { title: 'Ingestion Configuration', subtitle: 'Source configuration management' },
            enrichment: { title: 'Pipeline Status', subtitle: 'Enrichment pipeline monitoring' },
            providers: { title: 'LLM Providers', subtitle: 'Provider status and configuration' },
            prompts: { title: 'Prompt Management', subtitle: 'Version control and optimization' },
            knowledge: { title: 'Knowledge Explorer', subtitle: 'Interactive knowledge graph' },
            search: { title: 'Search Analytics', subtitle: 'Query patterns and performance' },
            costs: { title: 'Cost Analysis', subtitle: 'Spending breakdown and trends' },
            quality: { title: 'Quality Metrics', subtitle: 'System quality and reliability' },
            performance: { title: 'Performance', subtitle: 'System performance metrics' },
            users: { title: 'User Management', subtitle: 'User accounts and permissions' },
            audit: { title: 'Audit Logs', subtitle: 'System activity and changes' },
            settings: { title: 'System Settings', subtitle: 'Configuration and preferences' }
        };
        
        const config = titles[view] || { title: 'Dashboard', subtitle: '' };
        document.getElementById('pageTitle').textContent = config.title;
        document.getElementById('pageSubtitle').textContent = config.subtitle;
    }
    
    async loadViewContent(view) {
        const overviewView = document.getElementById('overview-view');
        const dynamicContent = document.getElementById('dynamic-content');
        
        if (view === 'overview') {
            overviewView.style.display = 'block';
            dynamicContent.style.display = 'none';
            this.loadOverviewData();
        } else {
            overviewView.style.display = 'none';
            dynamicContent.style.display = 'block';
            await this.loadDynamicContent(view);
        }
    }
    
    async loadDynamicContent(view) {
        const content = document.getElementById('dynamic-content');
        
        // Show loading state
        content.innerHTML = `
            <div class="d-flex justify-content-center align-items-center" style="height: 400px;">
                <div class="text-center">
                    <div class="spinner-border text-primary" role="status">
                        <span class="visually-hidden">Loading...</span>
                    </div>
                    <div class="mt-2">Loading ${view} data...</div>
                </div>
            </div>
        `;
        
        try {
            // Simulate API call delay
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Load view-specific content
            switch (view) {
                case 'ingestion':
                    content.innerHTML = await this.getIngestionContent();
                    break;
                case 'enrichment':
                    content.innerHTML = await this.getEnrichmentContent();
                    break;
                case 'providers':
                    content.innerHTML = this.getProvidersContent();
                    break;
                case 'knowledge':
                    content.innerHTML = this.getKnowledgeContent();
                    break;
                case 'costs':
                    content.innerHTML = this.getCostsContent();
                    break;
                case 'users':
                    content.innerHTML = this.getUsersContent();
                    break;
                default:
                    content.innerHTML = `
                        <div class="chart-container">
                            <h5>${view.charAt(0).toUpperCase() + view.slice(1)} View</h5>
                            <p>This view is under development. Content will be available soon.</p>
                        </div>
                    `;
            }
        } catch (error) {
            content.innerHTML = `
                <div class="alert alert-danger">
                    <h6>Error Loading Content</h6>
                    <p>Failed to load ${view} data. Please try again.</p>
                </div>
            `;
        }
    }
    
    async getIngestionContent() {
        try {
            const response = await fetch('/api/dashboard/admin/data/ingestion');
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            const data = await response.json();
            
            return `
                <div class="row mb-4">
                    <div class="col-lg-12">
                        <div class="chart-container">
                            <h5>Ingestion Metrics</h5>
                            <div class="row">
                                <div class="col-md-2">
                                    <div class="metric-card">
                                        <div class="metric-value">${data.metrics.totalDocumentsToday}</div>
                                        <div class="metric-label">Documents Today</div>
                                    </div>
                                </div>
                                <div class="col-md-2">
                                    <div class="metric-card">
                                        <div class="metric-value">${data.metrics.activeSources}</div>
                                        <div class="metric-label">Active Sources</div>
                                    </div>
                                </div>
                                <div class="col-md-2">
                                    <div class="metric-card">
                                        <div class="metric-value">${data.metrics.overallSuccessRate.toFixed(1)}%</div>
                                        <div class="metric-label">Success Rate</div>
                                    </div>
                                </div>
                                <div class="col-md-2">
                                    <div class="metric-card">
                                        <div class="metric-value">${data.metrics.avgProcessingTime.toFixed(1)}s</div>
                                        <div class="metric-label">Avg Processing</div>
                                    </div>
                                </div>
                                <div class="col-md-2">
                                    <div class="metric-card">
                                        <div class="metric-value">${data.metrics.totalErrorsToday}</div>
                                        <div class="metric-label">Errors Today</div>
                                    </div>
                                </div>
                                <div class="col-md-2">
                                    <div class="metric-card">
                                        <div class="metric-value">${data.metrics.queuedDocuments}</div>
                                        <div class="metric-label">Queued</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="row">
                    <div class="col-lg-8">
                        <div class="chart-container">
                            <h5>Source Status Overview</h5>
                            <div class="table-responsive">
                                <table class="table table-hover">
                                    <thead>
                                        <tr>
                                            <th>Source</th>
                                            <th>Type</th>
                                            <th>Status</th>
                                            <th>Documents Today</th>
                                            <th>Success Rate</th>
                                            <th>Last Sync</th>
                                            <th>Queue</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${data.sources.map(source => {
                                            const statusClass = source.status === 'active' ? 'success' : 
                                                              source.status === 'processing' ? 'warning' : 'danger';
                                            const lastSyncTime = this.formatTimeAgo(source.lastSync);
                                            return `
                                                <tr>
                                                    <td>
                                                        <strong>${source.name}</strong>
                                                        <br><small class="text-muted">${source.id}</small>
                                                    </td>
                                                    <td><span class="badge bg-secondary">${source.type}</span></td>
                                                    <td><span class="badge bg-${statusClass}">${source.status}</span></td>
                                                    <td>${source.documentsToday}</td>
                                                    <td>${source.successRate.toFixed(1)}%</td>
                                                    <td>${lastSyncTime}</td>
                                                    <td>${source.queueSize || 0}</td>
                                                </tr>
                                            `;
                                        }).join('')}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                    <div class="col-lg-4">
                        <div class="chart-container">
                            <h5>Recent Activity</h5>
                            <div class="list-group list-group-flush" style="max-height: 400px; overflow-y: auto;">
                                ${data.recentActivity.map(event => {
                                    const iconMap = {
                                        success: '✓',
                                        info: '📄',
                                        warning: '⚠',
                                        error: '✗'
                                    };
                                    const icon = iconMap[event.type] || '•';
                                    const timeAgo = this.formatTimeAgo(event.timestamp);
                                    const textClass = event.type === 'success' ? 'success' : 
                                                    event.type === 'warning' ? 'warning' : 
                                                    event.type === 'error' ? 'danger' : 'info';
                                    return `
                                        <div class="list-group-item">
                                            <div class="d-flex justify-content-between">
                                                <small class="text-${textClass}">${icon} ${event.message}</small>
                                                <small class="text-muted">${timeAgo}</small>
                                            </div>
                                            ${event.documentsProcessed ? `<small class="text-muted">Documents: ${event.documentsProcessed}</small>` : ''}
                                        </div>
                                    `;
                                }).join('')}
                                ${data.recentActivity.length === 0 ? '<div class="list-group-item text-muted">No recent activity</div>' : ''}
                            </div>
                        </div>
                    </div>
                </div>
            `;
        } catch (error) {
            console.error('Failed to fetch ingestion data:', error);
            return `
                <div class="alert alert-danger">
                    <h6>Error Loading Ingestion Data</h6>
                    <p>Failed to load ingestion data. Please try again.</p>
                </div>
            `;
        }
    }
    
    async getEnrichmentContent() {
        try {
            const response = await fetch('/api/dashboard/admin/data/enrichment');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();
            
            return `
                <div class="row mb-4">
                    <!-- Pipeline Metrics Overview -->
                    <div class="col-12">
                        <div class="row">
                            <div class="col-md-2">
                                <div class="metric-card">
                                    <div class="metric-value">${data.pipeline.metrics.totalProcessed}</div>
                                    <div class="metric-label">Total Processed</div>
                                    <div class="metric-trend text-success">↗ ${data.pipeline.metrics.successRate}%</div>
                                </div>
                            </div>
                            <div class="col-md-2">
                                <div class="metric-card">
                                    <div class="metric-value">${data.pipeline.metrics.totalQueued}</div>
                                    <div class="metric-label">In Queue</div>
                                    <div class="metric-trend text-info">⏳ Processing</div>
                                </div>
                            </div>
                            <div class="col-md-2">
                                <div class="metric-card">
                                    <div class="metric-value">${data.pipeline.metrics.overallThroughput}/min</div>
                                    <div class="metric-label">Throughput</div>
                                    <div class="metric-trend text-primary">📊 Live</div>
                                </div>
                            </div>
                            <div class="col-md-2">
                                <div class="metric-card">
                                    <div class="metric-value">${data.pipeline.metrics.avgEndToEndTime}s</div>
                                    <div class="metric-label">Avg Time</div>
                                    <div class="metric-trend text-warning">⏱ E2E</div>
                                </div>
                            </div>
                            <div class="col-md-2">
                                <div class="metric-card">
                                    <div class="metric-value">${data.pipeline.metrics.totalErrors}</div>
                                    <div class="metric-label">Errors Today</div>
                                    <div class="metric-trend ${data.pipeline.metrics.totalErrors > 5 ? 'text-danger' : 'text-success'}">
                                        ${data.pipeline.metrics.totalErrors > 5 ? '⚠ High' : '✓ Low'}
                                    </div>
                                </div>
                            </div>
                            <div class="col-md-2">
                                <div class="metric-card">
                                    <div class="metric-value">${data.pipeline.metrics.successRate}%</div>
                                    <div class="metric-label">Success Rate</div>
                                    <div class="metric-trend text-success">✓ Healthy</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="row">
                    <!-- Interactive Pipeline Flow -->
                    <div class="col-lg-8">
                        <div class="card">
                            <div class="card-header d-flex justify-content-between align-items-center">
                                <h5 class="mb-0">Enrichment Pipeline Flow</h5>
                                <div class="btn-group btn-group-sm" role="group">
                                    <button type="button" class="btn btn-outline-primary active" onclick="adminDashboard.togglePipelineView('flow')">Flow View</button>
                                    <button type="button" class="btn btn-outline-primary" onclick="adminDashboard.togglePipelineView('metrics')">Metrics View</button>
                                </div>
                            </div>
                            <div class="card-body">
                                <div id="pipeline-flow-view">
                                    <div class="pipeline-container">
                                        ${data.pipeline.stages.map((stage, index) => {
                                            const statusColors = {
                                                'active': 'success',
                                                'processing': 'warning', 
                                                'error': 'danger',
                                                'idle': 'secondary'
                                            };
                                            const statusColor = statusColors[stage.status] || 'secondary';
                                            const hasQueue = stage.queued > 0;
                                            const hasErrors = stage.errors > 0;
                                            
                                            return `
                                                <div class="pipeline-stage" data-stage="${stage.id}" onclick="adminDashboard.expandStageDetails('${stage.id}')">
                                                    <div class="stage-header">
                                                        <div class="stage-icon bg-${statusColor}">
                                                            <span class="stage-number">${index + 1}</span>
                                                        </div>
                                                        <div class="stage-info">
                                                            <h6 class="stage-title">${stage.name}</h6>
                                                            <div class="stage-status">
                                                                <span class="badge badge-${statusColor}">${stage.status}</span>
                                                                ${hasQueue ? `<span class="badge badge-info ml-1">${stage.queued} queued</span>` : ''}
                                                                ${hasErrors ? `<span class="badge badge-danger ml-1">${stage.errors} errors</span>` : ''}
                                                            </div>
                                                        </div>
                                                        <div class="stage-metrics">
                                                            <div class="metric-small">
                                                                <span class="metric-value">${stage.processed}</span>
                                                                <span class="metric-label">processed</span>
                                                            </div>
                                                            <div class="metric-small">
                                                                <span class="metric-value">${stage.throughput}/min</span>
                                                                <span class="metric-label">throughput</span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div class="stage-details" id="stage-details-${stage.id}" style="display: none;">
                                                        <div class="row">
                                                            <div class="col-md-6">
                                                                <small class="text-muted">Processing Time: ${stage.avgProcessingTime}s avg</small>
                                                            </div>
                                                            <div class="col-md-6">
                                                                <small class="text-muted">Queue Size: ${stage.queued} documents</small>
                                                            </div>
                                                        </div>
                                                        <div class="progress mt-2" style="height: 6px;">
                                                            <div class="progress-bar bg-${statusColor}" style="width: ${Math.min(100, (stage.processed / (stage.processed + stage.queued)) * 100)}%"></div>
                                                        </div>
                                                    </div>
                                                </div>
                                                ${index < data.pipeline.stages.length - 1 ? '<div class="pipeline-arrow">→</div>' : ''}
                                            `;
                                        }).join('')}
                                    </div>
                                </div>
                                <div id="pipeline-metrics-view" style="display: none;">
                                    <div class="table-responsive">
                                        <table class="table table-sm">
                                            <thead>
                                                <tr>
                                                    <th>Stage</th>
                                                    <th>Status</th>
                                                    <th>Processed</th>
                                                    <th>Queued</th>
                                                    <th>Errors</th>
                                                    <th>Avg Time</th>
                                                    <th>Throughput</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                ${data.pipeline.stages.map(stage => `
                                                    <tr>
                                                        <td><strong>${stage.name}</strong></td>
                                                        <td><span class="badge badge-${stage.status === 'active' ? 'success' : stage.status === 'processing' ? 'warning' : 'secondary'}">${stage.status}</span></td>
                                                        <td>${stage.processed}</td>
                                                        <td>${stage.queued}</td>
                                                        <td class="${stage.errors > 0 ? 'text-danger' : ''}">${stage.errors}</td>
                                                        <td>${stage.avgProcessingTime}s</td>
                                                        <td>${stage.throughput}/min</td>
                                                    </tr>
                                                `).join('')}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Provider Performance & Strategy Distribution -->
                    <div class="col-lg-4">
                        <div class="card mb-3">
                            <div class="card-header">
                                <h6 class="mb-0">Provider Performance</h6>
                            </div>
                            <div class="card-body">
                                ${data.providers.map(provider => {
                                    const statusColor = provider.status === 'healthy' ? 'success' : 
                                                      provider.status === 'warning' ? 'warning' : 'danger';
                                    return `
                                        <div class="provider-item mb-3" onclick="adminDashboard.expandProviderDetails('${provider.id}')">
                                            <div class="d-flex justify-content-between align-items-center">
                                                <div>
                                                    <strong>${provider.name}</strong>
                                                    <span class="badge badge-${statusColor} ml-2">${provider.status}</span>
                                                </div>
                                                <div class="text-right">
                                                    <div class="text-muted small">${provider.responseTime}ms</div>
                                                    <div class="text-success small">${provider.successRate}%</div>
                                                </div>
                                            </div>
                                            <div class="provider-details mt-2" id="provider-details-${provider.id}" style="display: none;">
                                                <div class="row">
                                                    <div class="col-6">
                                                        <small class="text-muted">Requests: ${provider.requestsToday}</small>
                                                    </div>
                                                    <div class="col-6">
                                                        <small class="text-muted">Cost: $${provider.costToday}</small>
                                                    </div>
                                                </div>
                                                <div class="row">
                                                    <div class="col-12">
                                                        <small class="text-muted">Models: ${provider.modelsUsed.join(', ')}</small>
                                                    </div>
                                                </div>
                                                <div class="progress mt-2" style="height: 4px;">
                                                    <div class="progress-bar" style="width: ${provider.currentLoad * 100}%"></div>
                                                </div>
                                                <small class="text-muted">Load: ${Math.round(provider.currentLoad * 100)}%</small>
                                            </div>
                                        </div>
                                    `;
                                }).join('')}
                            </div>
                        </div>

                        <div class="card">
                            <div class="card-header">
                                <h6 class="mb-0">Processing Strategies</h6>
                            </div>
                            <div class="card-body">
                                <div class="strategy-distribution">
                                    ${Object.entries(data.strategies.current).map(([strategy, percentage]) => `
                                        <div class="strategy-item mb-2">
                                            <div class="d-flex justify-content-between">
                                                <span class="text-capitalize">${strategy}</span>
                                                <span>${percentage}%</span>
                                            </div>
                                            <div class="progress" style="height: 6px;">
                                                <div class="progress-bar" style="width: ${percentage}%"></div>
                                            </div>
                                        </div>
                                    `).join('')}
                                </div>
                                <div class="mt-3">
                                    <h6 class="small">Strategy Performance</h6>
                                    ${Object.entries(data.strategies.performance).map(([strategy, perf]) => `
                                        <div class="d-flex justify-content-between text-sm">
                                            <span class="text-capitalize">${strategy}:</span>
                                            <span>${perf.avgTime}s, ${perf.successRate}%, $${perf.cost}</span>
                                        </div>
                                    `).join('')}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="row mt-4">
                    <div class="col-12">
                        <div class="card">
                            <div class="card-header">
                                <h6 class="mb-0">Recent Pipeline Activity</h6>
                            </div>
                            <div class="card-body">
                                <div class="activity-feed" style="max-height: 300px; overflow-y: auto;">
                                    ${data.recentActivity.map(event => {
                                        const iconMap = {
                                            success: '✅',
                                            info: 'ℹ️',
                                            warning: '⚠️',
                                            error: '❌'
                                        };
                                        const icon = iconMap[event.type] || '•';
                                        const timeAgo = this.formatTimeAgo(event.timestamp);
                                        const textClass = event.type === 'success' ? 'success' : 
                                                        event.type === 'warning' ? 'warning' : 
                                                        event.type === 'error' ? 'danger' : 'info';
                                        
                                        return `
                                            <div class="activity-item d-flex justify-content-between align-items-start mb-2">
                                                <div class="activity-content">
                                                    <span class="activity-icon">${icon}</span>
                                                    <span class="activity-message text-${textClass}">${event.message}</span>
                                                    ${event.stage ? `<span class="badge badge-light ml-2">${event.stage}</span>` : ''}
                                                    ${event.provider ? `<span class="badge badge-outline-secondary ml-1">${event.provider}</span>` : ''}
                                                    ${event.documentsProcessed ? `<small class="text-muted ml-2">(${event.documentsProcessed} docs)</small>` : ''}
                                                </div>
                                                <small class="text-muted">${timeAgo}</small>
                                            </div>
                                        `;
                                    }).join('')}
                                    ${data.recentActivity.length === 0 ? '<div class="text-muted text-center">No recent activity</div>' : ''}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        } catch (error) {
            console.error('Failed to fetch enrichment data:', error);
            return `
                <div class="alert alert-danger">
                    <h6>Error Loading Enrichment Pipeline Data</h6>
                    <p>Failed to load enrichment pipeline data. Please try again.</p>
                    <button class="btn btn-sm btn-outline-danger" onclick="adminDashboard.loadViewContent('enrichment')">Retry</button>
                </div>
            `;
        }
    }

    togglePipelineView(view) {
        const flowView = document.getElementById('pipeline-flow-view');
        const metricsView = document.getElementById('pipeline-metrics-view');
        const buttons = document.querySelectorAll('.btn-group button');
        
        buttons.forEach(btn => btn.classList.remove('active'));
        
        if (view === 'flow') {
            flowView.style.display = 'block';
            metricsView.style.display = 'none';
            buttons[0].classList.add('active');
        } else {
            flowView.style.display = 'none';
            metricsView.style.display = 'block';
            buttons[1].classList.add('active');
        }
    }

    expandStageDetails(stageId) {
        const details = document.getElementById(`stage-details-${stageId}`);
        if (details) {
            details.style.display = details.style.display === 'none' ? 'block' : 'none';
        }
    }

    expandProviderDetails(providerId) {
        const details = document.getElementById(`provider-details-${providerId}`);
        if (details) {
            details.style.display = details.style.display === 'none' ? 'block' : 'none';
        }
    }
    
    getProvidersContent() {
        return `
            <div class="dashboard-grid">
                <div class="provider-card">
                    <div class="provider-status">
                        <h5>OpenAI</h5>
                        <span class="status-indicator status-healthy">Healthy</span>
                    </div>
                    <div class="mt-3">
                        <div class="d-flex justify-content-between">
                            <span>Response Time</span>
                            <span class="text-success">245ms</span>
                        </div>
                        <div class="d-flex justify-content-between">
                            <span>Success Rate</span>
                            <span class="text-success">99.2%</span>
                        </div>
                        <div class="d-flex justify-content-between">
                            <span>Requests Today</span>
                            <span>1,247</span>
                        </div>
                        <div class="d-flex justify-content-between">
                            <span>Cost Today</span>
                            <span class="text-primary">$18.45</span>
                        </div>
                    </div>
                </div>
                
                <div class="provider-card">
                    <div class="provider-status">
                        <h5>Anthropic</h5>
                        <span class="status-indicator status-healthy">Healthy</span>
                    </div>
                    <div class="mt-3">
                        <div class="d-flex justify-content-between">
                            <span>Response Time</span>
                            <span class="text-success">198ms</span>
                        </div>
                        <div class="d-flex justify-content-between">
                            <span>Success Rate</span>
                            <span class="text-success">98.8%</span>
                        </div>
                        <div class="d-flex justify-content-between">
                            <span>Requests Today</span>
                            <span>342</span>
                        </div>
                        <div class="d-flex justify-content-between">
                            <span>Cost Today</span>
                            <span class="text-primary">$6.22</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }
    
    getKnowledgeContent() {
        return `
            <div class="row">
                <div class="col-lg-8">
                    <div class="chart-container">
                        <h5>Knowledge Graph Visualization</h5>
                        <div id="knowledgeGraph" style="height: 400px; background: #f8f9fa; border-radius: 0.375rem; display: flex; align-items: center; justify-content: center;">
                            <div class="text-center text-muted">
                                <i class="bi bi-diagram-2" style="font-size: 3rem;"></i>
                                <div class="mt-2">Interactive knowledge graph will be rendered here</div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="col-lg-4">
                    <div class="chart-container">
                        <h5>Graph Statistics</h5>
                        <div class="metric-card">
                            <div class="metric-label">Total Entities</div>
                            <div class="metric-value">2,847</div>
                        </div>
                        <div class="metric-card mt-3">
                            <div class="metric-label">Relationships</div>
                            <div class="metric-value">8,932</div>
                        </div>
                        <div class="metric-card mt-3">
                            <div class="metric-label">Connected Components</div>
                            <div class="metric-value">156</div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }
    
    getCostsContent() {
        return `
            <div class="row">
                <div class="col-lg-8">
                    <div class="chart-container">
                        <h5>Cost Trends</h5>
                        <canvas id="costTrendChart" height="300"></canvas>
                    </div>
                </div>
                <div class="col-lg-4">
                    <div class="chart-container">
                        <h5>Cost Breakdown</h5>
                        <canvas id="costBreakdownChart" height="300"></canvas>
                    </div>
                </div>
            </div>
            <div class="row mt-4">
                <div class="col-12">
                    <div class="chart-container">
                        <h5>Budget Status</h5>
                        <div class="dashboard-grid">
                            <div class="metric-card">
                                <div class="metric-label">Monthly Budget</div>
                                <div class="metric-value">$500.00</div>
                                <div class="metric-change positive">75% remaining</div>
                            </div>
                            <div class="metric-card">
                                <div class="metric-label">Daily Average</div>
                                <div class="metric-value">$24.67</div>
                                <div class="metric-change negative">+15% vs target</div>
                            </div>
                            <div class="metric-card">
                                <div class="metric-label">Projected Monthly</div>
                                <div class="metric-value">$740.10</div>
                                <div class="metric-change negative">48% over budget</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }
    
    getUsersContent() {
        return `
            <div class="chart-container">
                <div class="d-flex justify-content-between align-items-center mb-3">
                    <h5>User Management</h5>
                    <button class="btn btn-primary">
                        <i class="bi bi-person-plus"></i> Add User
                    </button>
                </div>
                <div class="table-responsive">
                    <table class="table table-hover">
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th>Email</th>
                                <th>Role</th>
                                <th>Last Login</th>
                                <th>Status</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td>John Doe</td>
                                <td>john@example.com</td>
                                <td><span class="badge bg-primary">Admin</span></td>
                                <td>2 hours ago</td>
                                <td><span class="status-indicator status-healthy">Active</span></td>
                                <td>
                                    <button class="btn btn-sm btn-outline-primary">Edit</button>
                                    <button class="btn btn-sm btn-outline-danger">Disable</button>
                                </td>
                            </tr>
                            <tr>
                                <td>Jane Smith</td>
                                <td>jane@example.com</td>
                                <td><span class="badge bg-secondary">Curator</span></td>
                                <td>1 day ago</td>
                                <td><span class="status-indicator status-healthy">Active</span></td>
                                <td>
                                    <button class="btn btn-sm btn-outline-primary">Edit</button>
                                    <button class="btn btn-sm btn-outline-danger">Disable</button>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }
    
    setupCharts() {
        // Activity Chart
        const activityCtx = document.getElementById('activityChart');
        if (activityCtx) {
            this.charts.activity = new Chart(activityCtx, {
                type: 'line',
                data: {
                    labels: ['00:00', '04:00', '08:00', '12:00', '16:00', '20:00'],
                    datasets: [{
                        label: 'Documents Processed',
                        data: [12, 19, 25, 32, 28, 35],
                        borderColor: 'rgb(75, 192, 192)',
                        backgroundColor: 'rgba(75, 192, 192, 0.1)',
                        tension: 0.1
                    }, {
                        label: 'API Requests',
                        data: [45, 67, 89, 123, 98, 145],
                        borderColor: 'rgb(255, 99, 132)',
                        backgroundColor: 'rgba(255, 99, 132, 0.1)',
                        tension: 0.1
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        y: {
                            beginAtZero: true
                        }
                    }
                }
            });
        }
        
        // Provider Chart
        const providerCtx = document.getElementById('providerChart');
        if (providerCtx) {
            this.charts.provider = new Chart(providerCtx, {
                type: 'doughnut',
                data: {
                    labels: ['OpenAI', 'Anthropic', 'Local'],
                    datasets: [{
                        data: [65, 30, 5],
                        backgroundColor: [
                            'rgb(54, 162, 235)',
                            'rgb(255, 205, 86)',
                            'rgb(75, 192, 192)'
                        ]
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false
                }
            });
        }
    }
    
    async loadData() {
        try {
            // Simulate API calls
            const [overview, costs] = await Promise.all([
                this.fetchOverviewData(),
                this.fetchCostData()
            ]);
            
            this.updateOverviewMetrics(overview);
            this.updateCostTicker(costs);
            this.updateRecentEvents();
            
        } catch (error) {
            console.error('Error loading data:', error);
            this.showError('Failed to load dashboard data');
        }
    }
    
    async fetchOverviewData() {
        // Use real API endpoint
        try {
            const response = await fetch('/api/dashboard/admin/data/overview');
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            return await response.json();
        } catch (error) {
            console.warn('Failed to fetch real overview data, using mock data:', error);
            // Fallback to mock data
            await new Promise(resolve => setTimeout(resolve, 500));
            return {
                activeSources: 12,
                documentsProcessed: 1247,
                apiRequests: 8932,
                systemStatus: 'healthy',
                realTimeCost: 24.67
            };
        }
    }
    
    async fetchCostData() {
        // Use real API endpoint when available
        try {
            const response = await fetch('/api/dashboard/cost');
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            const data = await response.json();
            return {
                realTimeSpending: data.realTime?.dailySpending || 24.67,
                dailyBudget: 50.00,
                monthlySpending: data.realTime?.monthlySpending || 375.45
            };
        } catch (error) {
            console.warn('Failed to fetch real cost data, using mock data:', error);
            // Fallback to mock data
            await new Promise(resolve => setTimeout(resolve, 300));
            return {
                realTimeSpending: 24.67,
                dailyBudget: 50.00,
                monthlySpending: 375.45
            };
        }
    }

    async fetchProviderData() {
        try {
            const response = await fetch('/api/dashboard/admin/data/providers');
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            return await response.json();
        } catch (error) {
            console.warn('Failed to fetch real provider data, using mock data:', error);
            return [
                {
                    name: 'OpenAI',
                    status: 'healthy',
                    responseTime: 245,
                    successRate: 99.2,
                    requestsToday: 1247,
                    costToday: 18.45
                },
                {
                    name: 'Anthropic',
                    status: 'healthy',
                    responseTime: 198,
                    successRate: 98.8,
                    requestsToday: 342,
                    costToday: 6.22
                }
            ];
        }
    }
    
    updateOverviewMetrics(data) {
        document.getElementById('activeSources').textContent = data.activeSources;
        document.getElementById('documentsProcessed').textContent = data.documentsProcessed.toLocaleString();
        document.getElementById('apiRequests').textContent = data.apiRequests.toLocaleString();
        
        // Update real-time cost if available
        if (data.realTimeCost !== undefined) {
            document.getElementById('realTimeCost').textContent = `$${data.realTimeCost.toFixed(2)}`;
        }
    }
    
    updateCostTicker(data) {
        document.getElementById('realTimeCost').textContent = `$${data.realTimeSpending.toFixed(2)}`;
    }
    
    updateRecentEvents() {
        const events = [
            { time: '2 min ago', event: 'Document enrichment completed', source: 'OpenAI', status: 'success', details: 'Entity extraction successful' },
            { time: '5 min ago', event: 'New source configured', source: 'Web Scraper', status: 'info', details: 'RSS feed added' },
            { time: '8 min ago', event: 'Rate limit warning', source: 'Anthropic', status: 'warning', details: 'Approaching daily limit' },
            { time: '12 min ago', event: 'Backup completed', source: 'System', status: 'success', details: 'Database backup successful' },
            { time: '15 min ago', event: 'User login', source: 'Auth', status: 'info', details: 'Admin user authenticated' }
        ];
        
        const tbody = document.getElementById('recentEvents');
        tbody.innerHTML = events.map(event => `
            <tr>
                <td><small class="text-muted">${event.time}</small></td>
                <td>${event.event}</td>
                <td><span class="badge bg-light text-dark">${event.source}</span></td>
                <td>
                    <span class="status-indicator status-${event.status}">
                        ${event.status === 'success' ? '✓' : event.status === 'warning' ? '⚠' : 'ℹ'}
                    </span>
                </td>
                <td><small class="text-muted">${event.details}</small></td>
            </tr>
        `).join('');
    }
    
    loadOverviewData() {
        // Refresh overview-specific data
        this.loadData();
    }
    
    updateTimeRangeDisplay() {
        const button = document.querySelector('.dropdown-toggle');
        const ranges = {
            '1h': 'Last Hour',
            '24h': 'Last 24h',
            '7d': 'Last 7 Days',
            '30d': 'Last 30 Days'
        };
        button.innerHTML = `<i class="bi bi-clock"></i> ${ranges[this.timeRange]}`;
    }
    
    startAutoRefresh() {
        // Refresh data every 30 seconds
        this.refreshInterval = setInterval(() => {
            if (this.currentView === 'overview') {
                this.loadData();
            }
        }, 30000);
    }
    
    handleResize() {
        // Handle responsive behavior
        if (window.innerWidth <= 768) {
            const sidebar = document.getElementById('adminSidebar');
            if (!sidebar.classList.contains('mobile-open')) {
                sidebar.classList.remove('collapsed');
            }
        }
    }
    
    showError(message) {
        // Show error notification
        const alert = document.createElement('div');
        alert.className = 'alert alert-danger alert-dismissible fade show position-fixed';
        alert.style.top = '20px';
        alert.style.right = '20px';
        alert.style.zIndex = '9999';
        alert.innerHTML = `
            ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        `;
        document.body.appendChild(alert);
        
        // Auto-remove after 5 seconds
        setTimeout(() => {
            if (alert.parentNode) {
                alert.parentNode.removeChild(alert);
            }
        }, 5000);
    }
    
    formatTimeAgo(timestamp) {
        const now = new Date();
        const time = new Date(timestamp);
        const diffMs = now - time;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);
        
        if (diffMins < 1) {
            return 'just now';
        } else if (diffMins < 60) {
            return `${diffMins}m ago`;
        } else if (diffHours < 24) {
            return `${diffHours}h ago`;
        } else {
            return `${diffDays}d ago`;
        }
    }
}

// Initialize dashboard when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new AdminDashboard();
});
