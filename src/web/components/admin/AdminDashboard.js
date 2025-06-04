/**
 * Admin Dashboard Component
 * Comprehensive admin interface for system monitoring and management
 */

import React, { useState, useEffect } from 'react'; // eslint-disable-line no-unused-vars
import './AdminDashboard.css';

const AdminDashboard = ({ user }) => {
  const [activeTab, setActiveTab] = useState('overview');
  const [systemMetrics, setSystemMetrics] = useState(null);
  const [feedbackAnalytics, setFeedbackAnalytics] = useState(null);
  const [curationStats, setCurationStats] = useState(null);
  const [costMetrics, setCostMetrics] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshInterval, setRefreshInterval] = useState(30000); // 30 seconds

  useEffect(() => {
    loadDashboardData();
    const interval = setInterval(loadDashboardData, refreshInterval);
    return () => clearInterval(interval);
  }, [refreshInterval]);

  const loadDashboardData = async () => {
    try {
      setLoading(true);
      
      // Load all dashboard data in parallel
      const [
        metricsResponse,
        feedbackResponse,
        curationResponse,
        costResponse,
        alertsResponse
      ] = await Promise.all([
        fetch('/api/v1/admin/metrics', {
          headers: { 'Authorization': `Bearer ${user.token}` }
        }),
        fetch('/api/v1/feedback/analytics/dashboard', {
          headers: { 'Authorization': `Bearer ${user.token}` }
        }),
        fetch('/api/v1/curation/stats', {
          headers: { 'Authorization': `Bearer ${user.token}` }
        }),
        fetch('/api/v1/monitoring/cost/dashboard', {
          headers: { 'Authorization': `Bearer ${user.token}` }
        }),
        fetch('/api/v1/monitoring/alerts', {
          headers: { 'Authorization': `Bearer ${user.token}` }
        })
      ]);

      const [metrics, feedback, curation, costs, alertsData] = await Promise.all([
        metricsResponse.json(),
        feedbackResponse.json(),
        curationResponse.json(),
        costResponse.json(),
        alertsResponse.json()
      ]);

      setSystemMetrics(metrics.data);
      setFeedbackAnalytics(feedback.data);
      setCurationStats(curation.data);
      setCostMetrics(costs.data);
      setAlerts(alertsData.data || []);
      setError(null);
    } catch (err) {
      console.error('Error loading dashboard data:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRefreshIntervalChange = (interval) => {
    setRefreshInterval(interval);
  };

  const handleAlertAction = async (alertId, action) => { // eslint-disable-line no-unused-vars
    try {
      await fetch(`/api/v1/monitoring/alerts/${alertId}/${action}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${user.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          userId: user.id,
          timestamp: new Date()
        })
      });
      
      // Reload alerts
      loadDashboardData();
    } catch (err) {
      console.error(`Error ${action} alert:`, err);
    }
  };

  const renderOverviewTab = () => (
    <div className="admin-overview">
      <div className="overview-grid">
        {/* System Health */}
        <div className="overview-section">
          <h3>System Health</h3>
          <div className="health-metrics">
            <div className="health-metric">
              <div className="metric-icon status-healthy"></div>
              <div className="metric-info">
                <div className="metric-label">API Status</div>
                <div className="metric-value">Healthy</div>
              </div>
            </div>
            <div className="health-metric">
              <div className="metric-icon status-healthy"></div>
              <div className="metric-info">
                <div className="metric-label">Database</div>
                <div className="metric-value">Connected</div>
              </div>
            </div>
            <div className="health-metric">
              <div className="metric-icon status-warning"></div>
              <div className="metric-info">
                <div className="metric-label">Queue Size</div>
                <div className="metric-value">
                  {systemMetrics?.queueSize || 0}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Recent Activity */}
        <div className="overview-section">
          <h3>Recent Activity</h3>
          <div className="activity-timeline">
            <div className="activity-item">
              <div className="activity-time">2 minutes ago</div>
              <div className="activity-description">
                Document approved by curator John Doe
              </div>
            </div>
            <div className="activity-item">
              <div className="activity-time">5 minutes ago</div>
              <div className="activity-description">
                High-priority feedback received for query #12345
              </div>
            </div>
            <div className="activity-item">
              <div className="activity-time">8 minutes ago</div>
              <div className="activity-description">
                Cost threshold warning: 85% of monthly budget used
              </div>
            </div>
          </div>
        </div>

        {/* Quick Stats */}
        <div className="overview-section">
          <h3>Quick Stats</h3>
          <div className="quick-stats">
            <div className="stat-item">
              <div className="stat-value">
                {curationStats?.totalPending || 0}
              </div>
              <div className="stat-label">Pending Review</div>
            </div>
            <div className="stat-item">
              <div className="stat-value">
                {feedbackAnalytics?.overview?.processed || 0}
              </div>
              <div className="stat-label">Feedback Processed</div>
            </div>
            <div className="stat-item">
              <div className="stat-value">
                ${costMetrics?.totalSpend?.toFixed(2) || '0.00'}
              </div>
              <div className="stat-label">Monthly Spend</div>
            </div>
          </div>
        </div>

        {/* Active Alerts */}
        <div className="overview-section">
          <h3>Active Alerts</h3>
          <div className="alerts-summary">
            {alerts.length === 0 ? (
              <div className="no-alerts">No active alerts</div>
            ) : (
              alerts.slice(0, 5).map(alert => (
                <div key={alert.id} className={`alert-item severity-${alert.severity}`}>
                  <div className="alert-title">{alert.title}</div>
                  <div className="alert-time">
                    {new Date(alert.createdAt).toLocaleTimeString()}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );

  const renderMonitoringTab = () => (
    <div className="admin-monitoring">
      <div className="monitoring-grid">
        {/* Performance Metrics */}
        <div className="monitoring-section">
          <h3>Performance Metrics</h3>
          <div className="metrics-grid">
            <div className="metric-card">
              <div className="metric-title">API Response Time</div>
              <div className="metric-value">
                {systemMetrics?.avgResponseTime || 0}ms
              </div>
              <div className="metric-trend positive">
                ↓ 12% from last hour
              </div>
            </div>
            <div className="metric-card">
              <div className="metric-title">Throughput</div>
              <div className="metric-value">
                {systemMetrics?.requestsPerSecond || 0}/s
              </div>
              <div className="metric-trend positive">
                ↑ 8% from last hour
              </div>
            </div>
            <div className="metric-card">
              <div className="metric-title">Error Rate</div>
              <div className="metric-value">
                {systemMetrics?.errorRate || 0}%
              </div>
              <div className="metric-trend neutral">
                No change
              </div>
            </div>
          </div>
        </div>

        {/* System Resources */}
        <div className="monitoring-section">
          <h3>System Resources</h3>
          <div className="resource-meters">
            <div className="resource-meter">
              <div className="meter-label">CPU Usage</div>
              <div className="meter-bar">
                <div 
                  className="meter-fill" 
                  style={{ width: `${systemMetrics?.cpuUsage || 0}%` }}
                ></div>
              </div>
              <div className="meter-value">{systemMetrics?.cpuUsage || 0}%</div>
            </div>
            <div className="resource-meter">
              <div className="meter-label">Memory Usage</div>
              <div className="meter-bar">
                <div 
                  className="meter-fill" 
                  style={{ width: `${systemMetrics?.memoryUsage || 0}%` }}
                ></div>
              </div>
              <div className="meter-value">{systemMetrics?.memoryUsage || 0}%</div>
            </div>
            <div className="resource-meter">
              <div className="meter-label">Disk Usage</div>
              <div className="meter-bar">
                <div 
                  className="meter-fill" 
                  style={{ width: `${systemMetrics?.diskUsage || 0}%` }}
                ></div>
              </div>
              <div className="meter-value">{systemMetrics?.diskUsage || 0}%</div>
            </div>
          </div>
        </div>

        {/* Cost Monitoring */}
        <div className="monitoring-section">
          <h3>Cost Monitoring</h3>
          <div className="cost-overview">
            <div className="cost-metric">
              <div className="cost-label">Monthly Budget</div>
              <div className="cost-value">
                ${costMetrics?.monthlyBudget || 0}
              </div>
            </div>
            <div className="cost-metric">
              <div className="cost-label">Current Spend</div>
              <div className="cost-value">
                ${costMetrics?.totalSpend || 0}
              </div>
            </div>
            <div className="cost-metric">
              <div className="cost-label">Utilization</div>
              <div className="cost-value">
                {costMetrics?.utilizationPercentage || 0}%
              </div>
            </div>
          </div>
          <div className="cost-chart">
            {/* Cost trend chart would go here */}
            <div className="chart-placeholder">
              Cost trend chart (implementation pending)
            </div>
          </div>
        </div>

        {/* Quality Metrics */}
        <div className="monitoring-section">
          <h3>Quality Metrics</h3>
          <div className="quality-metrics">
            <div className="quality-metric">
              <div className="quality-label">SLO Compliance</div>
              <div className="quality-value">
                {systemMetrics?.sloCompliance || 0}%
              </div>
              <div className="quality-target">Target: 99.5%</div>
            </div>
            <div className="quality-metric">
              <div className="quality-label">Feedback Sentiment</div>
              <div className="quality-value">
                {feedbackAnalytics?.sentiment?.average?.toFixed(2) || 0}
              </div>
              <div className="quality-target">Range: -1 to 1</div>
            </div>
            <div className="quality-metric">
              <div className="quality-label">Curation Accuracy</div>
              <div className="quality-value">
                {curationStats?.approvalRate?.toFixed(1) || 0}%
              </div>
              <div className="quality-target">Target: 90%</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const renderUsersTab = () => (
    <div className="admin-users">
      <div className="users-header">
        <h3>User Management</h3>
        <button className="btn btn-primary">Add User</button>
      </div>
      
      <div className="users-filters">
        <select className="form-select">
          <option value="">All Roles</option>
          <option value="admin">Admin</option>
          <option value="curator">Curator</option>
          <option value="viewer">Viewer</option>
        </select>
        <input 
          type="text" 
          className="form-input" 
          placeholder="Search users..."
        />
      </div>

      <div className="users-table">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Last Active</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>John Doe</td>
              <td>john.doe@company.com</td>
              <td><span className="badge badge-primary">Admin</span></td>
              <td>2 minutes ago</td>
              <td><span className="status-indicator status-approved">Active</span></td>
              <td>
                <button className="btn btn-sm btn-outline">Edit</button>
                <button className="btn btn-sm btn-error">Disable</button>
              </td>
            </tr>
            <tr>
              <td>Jane Smith</td>
              <td>jane.smith@company.com</td>
              <td><span className="badge badge-success">Curator</span></td>
              <td>15 minutes ago</td>
              <td><span className="status-indicator status-approved">Active</span></td>
              <td>
                <button className="btn btn-sm btn-outline">Edit</button>
                <button className="btn btn-sm btn-error">Disable</button>
              </td>
            </tr>
            <tr>
              <td>Mike Johnson</td>
              <td>mike.johnson@company.com</td>
              <td><span className="badge badge-gray">Viewer</span></td>
              <td>2 hours ago</td>
              <td><span className="status-indicator status-pending">Inactive</span></td>
              <td>
                <button className="btn btn-sm btn-outline">Edit</button>
                <button className="btn btn-sm btn-success">Enable</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderSystemTab = () => (
    <div className="admin-system">
      <div className="system-sections">
        {/* Configuration */}
        <div className="system-section">
          <h3>System Configuration</h3>
          <div className="config-options">
            <div className="config-item">
              <label>Auto-refresh Interval</label>
              <select 
                className="form-select"
                value={refreshInterval}
                onChange={(e) => handleRefreshIntervalChange(parseInt(e.target.value))}
              >
                <option value={10000}>10 seconds</option>
                <option value={30000}>30 seconds</option>
                <option value={60000}>1 minute</option>
                <option value={300000}>5 minutes</option>
              </select>
            </div>
            <div className="config-item">
              <label>Default Page Size</label>
              <input type="number" className="form-input" defaultValue="50" />
            </div>
            <div className="config-item">
              <label>Enable Notifications</label>
              <input type="checkbox" defaultChecked />
            </div>
          </div>
        </div>

        {/* Maintenance */}
        <div className="system-section">
          <h3>Maintenance</h3>
          <div className="maintenance-actions">
            <button className="btn btn-warning">
              Clear Cache
            </button>
            <button className="btn btn-info">
              Rebuild Search Index
            </button>
            <button className="btn btn-secondary">
              Export Logs
            </button>
            <button className="btn btn-error">
              Emergency Stop
            </button>
          </div>
        </div>

        {/* Database */}
        <div className="system-section">
          <h3>Database Status</h3>
          <div className="db-status">
            <div className="db-metric">
              <div className="db-label">Connection Pool</div>
              <div className="db-value">8/20 active</div>
            </div>
            <div className="db-metric">
              <div className="db-label">Slow Queries</div>
              <div className="db-value">2 in last hour</div>
            </div>
            <div className="db-metric">
              <div className="db-label">Index Usage</div>
              <div className="db-value">94.2%</div>
            </div>
          </div>
        </div>

        {/* Logs */}
        <div className="system-section">
          <h3>Recent Logs</h3>
          <div className="log-viewer">
            <div className="log-entry log-info">
              <span className="log-time">12:34:56</span>
              <span className="log-level">INFO</span>
              <span className="log-message">
                User authentication successful for user@company.com
              </span>
            </div>
            <div className="log-entry log-warning">
              <span className="log-time">12:33:42</span>
              <span className="log-level">WARN</span>
              <span className="log-message">
                High memory usage detected: 87%
              </span>
            </div>
            <div className="log-entry log-error">
              <span className="log-time">12:32:15</span>
              <span className="log-level">ERROR</span>
              <span className="log-message">
                Failed to process document: timeout after 30s
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  if (loading && !systemMetrics) {
    return (
      <div className="admin-dashboard loading">
        <div className="loading-spinner"></div>
        <div>Loading dashboard...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="admin-dashboard error">
        <div className="error-message">
          <h3>Error Loading Dashboard</h3>
          <p>{error}</p>
          <button className="btn btn-primary" onClick={loadDashboardData}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-dashboard">
      <div className="dashboard-header">
        <h1>Admin Dashboard</h1>
        <div className="header-actions">
          <button 
            className="btn btn-outline btn-sm"
            onClick={loadDashboardData}
            disabled={loading}
          >
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
          <div className="refresh-indicator">
            Last updated: {new Date().toLocaleTimeString()}
          </div>
        </div>
      </div>

      {/* Active Alerts Bar */}
      {alerts.length > 0 && (
        <div className="alerts-bar">
          <div className="alerts-count">
            {alerts.length} active alert{alerts.length !== 1 ? 's' : ''}
          </div>
          <div className="critical-alerts">
            {alerts.filter(a => a.severity === 'critical').length} critical
          </div>
          <button 
            className="btn btn-sm btn-outline"
            onClick={() => setActiveTab('monitoring')}
          >
            View All
          </button>
        </div>
      )}

      <div className="dashboard-tabs">
        <div className="tab-buttons">
          <button 
            className={`tab-button ${activeTab === 'overview' ? 'active' : ''}`}
            onClick={() => setActiveTab('overview')}
          >
            Overview
          </button>
          <button 
            className={`tab-button ${activeTab === 'monitoring' ? 'active' : ''}`}
            onClick={() => setActiveTab('monitoring')}
          >
            Monitoring
          </button>
          <button 
            className={`tab-button ${activeTab === 'users' ? 'active' : ''}`}
            onClick={() => setActiveTab('users')}
          >
            Users
          </button>
          <button 
            className={`tab-button ${activeTab === 'system' ? 'active' : ''}`}
            onClick={() => setActiveTab('system')}
          >
            System
          </button>
        </div>

        <div className="tab-content">
          {activeTab === 'overview' && renderOverviewTab()}
          {activeTab === 'monitoring' && renderMonitoringTab()}
          {activeTab === 'users' && renderUsersTab()}
          {activeTab === 'system' && renderSystemTab()}
        </div>
      </div>
    </div>
  );
};

export default AdminDashboard;