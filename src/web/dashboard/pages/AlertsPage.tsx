import React, { useEffect, useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import {
  Box,
  Typography,
  Grid,
  Paper,
  Button,
  IconButton,
  Chip,
  Menu,
  MenuItem,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControl,
  InputLabel,
  Select,
  Alert as MuiAlert,
  Tabs,
  Tab,
} from '@mui/material';
import {
  CheckCircle as AcknowledgeIcon,
  Cancel as DismissIcon,
  MoreVert as MoreIcon,
  Add as AddIcon,
  NotificationsActive as AlertIcon,
} from '@mui/icons-material';
import { GridColDef } from '@mui/x-data-grid';
import { RootState, AppDispatch } from '../store';
import {
  fetchAlerts,
  acknowledgeAlert,
  dismissAlert,
  setFilters,
  createAlertRule,
} from '../store/alertsSlice';
import DataTable, { createDateColumn } from '../components/DataTable';
import MetricsCard from '../components/MetricsCard';
import FilterPanel from '../components/FilterPanel';

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

const TabPanel: React.FC<TabPanelProps> = ({ children, value, index }) => {
  return (
    <div hidden={value !== index}>
      {value === index && <Box sx={{ pt: 3 }}>{children}</Box>}
    </div>
  );
};

const AlertsPage: React.FC = () => {
  const dispatch = useDispatch<AppDispatch>();
  const { alerts, activeCount, loading, error, filters } = useSelector(
    (state: RootState) => state.alerts
  );

  const [tabValue, setTabValue] = useState(0);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [selectedAlertId, setSelectedAlertId] = useState<string | null>(null);
  const [ruleDialogOpen, setRuleDialogOpen] = useState(false);
  const [newRule, setNewRule] = useState({
    name: '',
    type: 'cost',
    condition: 'greater_than',
    threshold: 0,
  });

  useEffect(() => {
    dispatch(fetchAlerts(filters));
  }, [dispatch, filters]);

  const handleFilterChange = (newFilters: any) => {
    dispatch(setFilters(newFilters));
  };

  const handleAcknowledge = async (id: string) => {
    await dispatch(acknowledgeAlert(id));
    handleCloseMenu();
  };

  const handleDismiss = async (id: string) => {
    await dispatch(dismissAlert(id));
    handleCloseMenu();
  };

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>, id: string) => {
    setAnchorEl(event.currentTarget);
    setSelectedAlertId(id);
  };

  const handleCloseMenu = () => {
    setAnchorEl(null);
    setSelectedAlertId(null);
  };

  const handleCreateRule = async () => {
    await dispatch(createAlertRule(newRule));
    setRuleDialogOpen(false);
    setNewRule({ name: '', type: 'cost', condition: 'greater_than', threshold: 0 });
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'error';
      case 'high': return 'error';
      case 'medium': return 'warning';
      case 'low': return 'info';
      default: return 'default';
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'cost': return '💰';
      case 'performance': return '⚡';
      case 'security': return '🔒';
      case 'system': return '🖥️';
      default: return '📢';
    }
  };

  const columns: GridColDef[] = [
    {
      field: 'severity',
      headerName: 'Severity',
      width: 100,
      renderCell: (params) => (
        <Chip
          label={params.value}
          color={getSeverityColor(params.value)}
          size="small"
          variant="filled"
        />
      ),
    },
    {
      field: 'type',
      headerName: 'Type',
      width: 100,
      renderCell: (params) => (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <span>{getTypeIcon(params.value)}</span>
          <span>{params.value}</span>
        </Box>
      ),
    },
    {
      field: 'title',
      headerName: 'Alert',
      flex: 1,
      minWidth: 200,
    },
    {
      field: 'source',
      headerName: 'Source',
      width: 150,
    },
    {
      field: 'status',
      headerName: 'Status',
      width: 120,
      renderCell: (params) => (
        <Chip
          label={params.value}
          color={params.value === 'active' ? 'error' : 'default'}
          size="small"
          variant="outlined"
        />
      ),
    },
    createDateColumn('createdAt', 'Created', 180),
    {
      field: 'actions',
      headerName: 'Actions',
      width: 100,
      renderCell: (params) => (
        <IconButton
          size="small"
          onClick={(e) => handleMenuOpen(e, params.row.id)}
        >
          <MoreIcon />
        </IconButton>
      ),
    },
  ];

  const activeAlerts = alerts.filter(a => a.status === 'active');
  const acknowledgedAlerts = alerts.filter(a => a.status === 'acknowledged');
  const resolvedAlerts = alerts.filter(a => a.status === 'resolved');

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4">Alerts & Notifications</Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setRuleDialogOpen(true)}
        >
          Create Alert Rule
        </Button>
      </Box>

      {/* Alert Statistics */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <MetricsCard
            title="Active Alerts"
            value={activeCount}
            status={activeCount > 0 ? 'error' : 'healthy'}
            trend={activeCount > 5 ? 'increasing' : 'stable'}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <MetricsCard
            title="Critical Alerts"
            value={alerts.filter(a => a.severity === 'critical' && a.status === 'active').length}
            status="error"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <MetricsCard
            title="Acknowledged"
            value={acknowledgedAlerts.length}
            status="warning"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <MetricsCard
            title="Resolved Today"
            value={12}
            status="healthy"
            trend="improving"
            trendValue={-25}
          />
        </Grid>
      </Grid>

      {/* Active Alert Banner */}
      {activeCount > 0 && (
        <MuiAlert severity="error" sx={{ mb: 3 }}>
          <strong>{activeCount} active alerts</strong> require your attention. 
          {alerts.find(a => a.severity === 'critical' && a.status === 'active') && 
            ' Including critical alerts that need immediate action.'}
        </MuiAlert>
      )}

      {/* Filters */}
      <FilterPanel
        onFilterChange={handleFilterChange}
        showSearch
        showTimeRange
        customFilters={[
          {
            name: 'severity',
            label: 'Severity',
            type: 'select',
            options: [
              { label: 'Critical', value: 'critical' },
              { label: 'High', value: 'high' },
              { label: 'Medium', value: 'medium' },
              { label: 'Low', value: 'low' },
            ],
          },
          {
            name: 'type',
            label: 'Alert Type',
            type: 'multiselect',
            options: [
              { label: 'Cost', value: 'cost' },
              { label: 'Performance', value: 'performance' },
              { label: 'Security', value: 'security' },
              { label: 'System', value: 'system' },
            ],
          },
          {
            name: 'status',
            label: 'Status',
            type: 'select',
            options: [
              { label: 'Active', value: 'active' },
              { label: 'Acknowledged', value: 'acknowledged' },
              { label: 'Resolved', value: 'resolved' },
            ],
          },
        ]}
      />

      {/* Alert Tabs */}
      <Paper sx={{ mb: 3 }}>
        <Tabs value={tabValue} onChange={(_, newValue) => setTabValue(newValue)}>
          <Tab 
            label={`Active (${activeAlerts.length})`}
            icon={<AlertIcon />}
            iconPosition="start"
          />
          <Tab 
            label={`Acknowledged (${acknowledgedAlerts.length})`}
            icon={<AcknowledgeIcon />}
            iconPosition="start"
          />
          <Tab 
            label={`Resolved (${resolvedAlerts.length})`}
            icon={<DismissIcon />}
            iconPosition="start"
          />
        </Tabs>
      </Paper>

      {/* Alert Tables */}
      <TabPanel value={tabValue} index={0}>
        <DataTable
          title="Active Alerts"
          data={activeAlerts}
          columns={columns}
          loading={loading}
          height={500}
        />
      </TabPanel>

      <TabPanel value={tabValue} index={1}>
        <DataTable
          title="Acknowledged Alerts"
          data={acknowledgedAlerts}
          columns={columns}
          loading={loading}
          height={500}
        />
      </TabPanel>

      <TabPanel value={tabValue} index={2}>
        <DataTable
          title="Resolved Alerts"
          data={resolvedAlerts}
          columns={columns}
          loading={loading}
          height={500}
        />
      </TabPanel>

      {/* Actions Menu */}
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleCloseMenu}
      >
        <MenuItem onClick={() => selectedAlertId && handleAcknowledge(selectedAlertId)}>
          <AcknowledgeIcon sx={{ mr: 1 }} /> Acknowledge
        </MenuItem>
        <MenuItem onClick={() => selectedAlertId && handleDismiss(selectedAlertId)}>
          <DismissIcon sx={{ mr: 1 }} /> Dismiss
        </MenuItem>
      </Menu>

      {/* Create Alert Rule Dialog */}
      <Dialog open={ruleDialogOpen} onClose={() => setRuleDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Create Alert Rule</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
            <TextField
              label="Rule Name"
              value={newRule.name}
              onChange={(e) => setNewRule({ ...newRule, name: e.target.value })}
              fullWidth
            />
            <FormControl fullWidth>
              <InputLabel>Alert Type</InputLabel>
              <Select
                value={newRule.type}
                label="Alert Type"
                onChange={(e) => setNewRule({ ...newRule, type: e.target.value })}
              >
                <MenuItem value="cost">Cost</MenuItem>
                <MenuItem value="performance">Performance</MenuItem>
                <MenuItem value="security">Security</MenuItem>
                <MenuItem value="system">System</MenuItem>
              </Select>
            </FormControl>
            <FormControl fullWidth>
              <InputLabel>Condition</InputLabel>
              <Select
                value={newRule.condition}
                label="Condition"
                onChange={(e) => setNewRule({ ...newRule, condition: e.target.value })}
              >
                <MenuItem value="greater_than">Greater Than</MenuItem>
                <MenuItem value="less_than">Less Than</MenuItem>
                <MenuItem value="equals">Equals</MenuItem>
              </Select>
            </FormControl>
            <TextField
              label="Threshold"
              type="number"
              value={newRule.threshold}
              onChange={(e) => setNewRule({ ...newRule, threshold: Number(e.target.value) })}
              fullWidth
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRuleDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleCreateRule} variant="contained">
            Create Rule
          </Button>
        </DialogActions>
      </Dialog>

      {error && (
        <Typography color="error" sx={{ mt: 2 }}>
          Error: {error}
        </Typography>
      )}
    </Box>
  );
};

export default AlertsPage;