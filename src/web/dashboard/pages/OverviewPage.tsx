import React, { useEffect, useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import {
  Grid,
  Box,
  Typography,
  Paper,
} from '@mui/material';
import { RootState, AppDispatch } from '../store';
import { fetchDashboardData, setTimeRange } from '../store/dashboardSlice';
import MetricsCard from '../components/MetricsCard';
import ChartWidget from '../components/ChartWidget';
import ActivityFeed from '../components/ActivityFeed';
import FilterPanel from '../components/FilterPanel';
import { TimeRange, ActivityItem } from '../types/dashboard';

const OverviewPage: React.FC = () => {
  const dispatch = useDispatch<AppDispatch>();
  const { overview, loading, error, timeRange } = useSelector(
    (state: RootState) => state.dashboard
  );
  
  const [activities, setActivities] = useState<ActivityItem[]>([
    {
      id: '1',
      timestamp: new Date().toISOString(),
      type: 'success',
      title: 'Document Processing Complete',
      message: 'Successfully processed 125 documents from Knowledge Base API',
      source: 'Ingestion Engine',
    },
    {
      id: '2',
      timestamp: new Date(Date.now() - 30 * 60000).toISOString(),
      type: 'warning',
      title: 'High Response Time Detected',
      message: 'API response time exceeded 5 seconds for OpenAI provider',
      source: 'Quality Monitor',
    },
    {
      id: '3',
      timestamp: new Date(Date.now() - 60 * 60000).toISOString(),
      type: 'info',
      title: 'Scheduled Report Generated',
      message: 'Monthly cost analysis report has been generated and sent',
      source: 'Reports',
    },
  ]);

  const [chartData] = useState({
    cost: [
      { name: '00:00', value: 12.5 },
      { name: '04:00', value: 18.3 },
      { name: '08:00', value: 22.1 },
      { name: '12:00', value: 28.7 },
      { name: '16:00', value: 35.2 },
      { name: '20:00', value: 41.8 },
      { name: '24:00', value: 48.5 },
    ],
    quality: [
      { name: 'Mon', value: 99.2 },
      { name: 'Tue', value: 98.8 },
      { name: 'Wed', value: 99.5 },
      { name: 'Thu', value: 98.9 },
      { name: 'Fri', value: 99.1 },
      { name: 'Sat', value: 99.7 },
      { name: 'Sun', value: 99.3 },
    ],
    providerUsage: [
      { name: 'OpenAI', value: 65 },
      { name: 'Anthropic', value: 25 },
      { name: 'Local LLM', value: 10 },
    ],
  });

  useEffect(() => {
    dispatch(fetchDashboardData(timeRange));
  }, [dispatch, timeRange]);

  const handleFilterChange = (filters: any) => {
    if (filters.timeRange && filters.timeRange !== timeRange) {
      dispatch(setTimeRange(filters.timeRange as TimeRange));
    }
  };

  const handleRefreshActivities = () => {
    // Simulate refreshing activities
    const newActivity: ActivityItem = {
      id: Date.now().toString(),
      timestamp: new Date().toISOString(),
      type: 'info',
      title: 'Manual Refresh',
      message: 'Dashboard data refreshed manually',
      source: 'User',
    };
    setActivities([newActivity, ...activities]);
  };

  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography color="error">Error loading dashboard: {error}</Typography>
      </Box>
    );
  }

  return (
    <Box>
      <Typography variant="h4" sx={{ mb: 3 }}>
        System Overview
      </Typography>

      <FilterPanel
        onFilterChange={handleFilterChange}
        showTimeRange
        showSearch={false}
        defaultExpanded={false}
      />

      {/* Key Metrics */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <MetricsCard
            title="Daily Cost"
            value={overview?.summary.cost.dailySpending || 0}
            unit="USD"
            trend={overview?.summary.cost.trend}
            trendValue={12.5}
            status="healthy"
            loading={loading}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <MetricsCard
            title="System Health"
            value={`${overview?.summary.quality.overallHealth || 0}%`}
            trend={overview?.summary.quality.trend}
            trendValue={0.5}
            status={overview?.summary.operational.systemHealth}
            loading={loading}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <MetricsCard
            title="Error Rate"
            value={`${overview?.summary.quality.errorRate || 0}%`}
            trend="decreasing"
            trendValue={-2.3}
            status={overview?.summary.quality.errorRate > 5 ? 'error' : 'healthy'}
            loading={loading}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <MetricsCard
            title="Active Connections"
            value={overview?.summary.operational.activeConnections || 0}
            trend="stable"
            status="healthy"
            loading={loading}
          />
        </Grid>
      </Grid>

      {/* Charts Row */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} md={8}>
          <ChartWidget
            title="Cost Trend"
            subtitle="Daily spending over time"
            type="area"
            data={chartData.cost}
            dataKey="value"
            xAxisKey="name"
            height={300}
            loading={loading}
          />
        </Grid>
        <Grid item xs={12} md={4}>
          <ChartWidget
            title="Provider Usage"
            subtitle="Distribution by provider"
            type="pie"
            data={chartData.providerUsage}
            dataKey="value"
            height={300}
            loading={loading}
          />
        </Grid>
      </Grid>

      {/* Quality and Activity Row */}
      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <ChartWidget
            title="Quality Metrics"
            subtitle="System reliability over time"
            type="line"
            data={chartData.quality}
            dataKey="value"
            xAxisKey="name"
            height={350}
            loading={loading}
          />
        </Grid>
        <Grid item xs={12} md={6}>
          <ActivityFeed
            activities={activities}
            loading={loading}
            onRefresh={handleRefreshActivities}
            maxItems={5}
          />
        </Grid>
      </Grid>

      {/* System Status Summary */}
      <Paper sx={{ mt: 3, p: 3 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          System Status Summary
        </Typography>
        <Grid container spacing={2}>
          <Grid item xs={12} sm={6} md={3}>
            <Box sx={{ textAlign: 'center' }}>
              <Typography variant="h3" color="primary">
                {overview?.summary.operational.uptime || 0}%
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Uptime
              </Typography>
            </Box>
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <Box sx={{ textAlign: 'center' }}>
              <Typography variant="h3" color="success.main">
                {overview?.summary.operational.throughput || 0}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Requests/min
              </Typography>
            </Box>
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <Box sx={{ textAlign: 'center' }}>
              <Typography variant="h3" color="warning.main">
                {overview?.summary.quality.avgResponseTime || 0}ms
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Avg Response Time
              </Typography>
            </Box>
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <Box sx={{ textAlign: 'center' }}>
              <Typography variant="h3" color="info.main">
                {overview?.summary.cost.budgetUtilization * 100 || 0}%
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Budget Used
              </Typography>
            </Box>
          </Grid>
        </Grid>
      </Paper>
    </Box>
  );
};

export default OverviewPage;