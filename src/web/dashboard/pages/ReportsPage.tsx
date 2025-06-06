import React, { useEffect, useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import {
  Box,
  Typography,
  Grid,
  Paper,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  IconButton,
  Tooltip,
} from '@mui/material';
import {
  Add as AddIcon,
  Download as DownloadIcon,
  Schedule as ScheduleIcon,
  PictureAsPdf as PdfIcon,
  TableChart as ExcelIcon,
  InsertDriveFile as CsvIcon,
  CalendarToday as CalendarIcon,
} from '@mui/icons-material';
import { GridColDef } from '@mui/x-data-grid';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { RootState, AppDispatch } from '../store';
import {
  fetchReports,
  generateReport,
  scheduleReport,
  downloadReport,
  setFilters,
} from '../store/reportsSlice';
import DataTable, { createDateColumn } from '../components/DataTable';
import MetricsCard from '../components/MetricsCard';
import FilterPanel from '../components/FilterPanel';
import ChartWidget from '../components/ChartWidget';

const ReportsPage: React.FC = () => {
  const dispatch = useDispatch<AppDispatch>();
  const { reports, loading, error, generating, filters } = useSelector(
    (state: RootState) => state.reports
  );

  const [generateDialogOpen, setGenerateDialogOpen] = useState(false);
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const [newReport, setNewReport] = useState({
    name: '',
    type: 'cost',
    format: 'pdf',
    dateRange: {
      start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      end: new Date(),
    },
  });
  const [newSchedule, setNewSchedule] = useState({
    reportType: 'cost',
    frequency: 'weekly',
    format: 'pdf',
    recipients: '',
  });

  useEffect(() => {
    dispatch(fetchReports(filters));
  }, [dispatch, filters]);

  const handleFilterChange = (newFilters: any) => {
    dispatch(setFilters(newFilters));
  };

  const handleGenerateReport = async () => {
    await dispatch(generateReport(newReport));
    setGenerateDialogOpen(false);
    setNewReport({
      name: '',
      type: 'cost',
      format: 'pdf',
      dateRange: {
        start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        end: new Date(),
      },
    });
    // Refresh reports list
    dispatch(fetchReports(filters));
  };

  const handleScheduleReport = async () => {
    await dispatch(scheduleReport(newSchedule));
    setScheduleDialogOpen(false);
    setNewSchedule({
      reportType: 'cost',
      frequency: 'weekly',
      format: 'pdf',
      recipients: '',
    });
  };

  const handleDownload = (id: string, format: string) => {
    dispatch(downloadReport({ id, format }));
  };

  const getFormatIcon = (format: string) => {
    switch (format) {
      case 'pdf': return <PdfIcon />;
      case 'excel': return <ExcelIcon />;
      case 'csv': return <CsvIcon />;
      default: return <InsertDriveFile />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'success';
      case 'generating': return 'warning';
      case 'failed': return 'error';
      case 'pending': return 'default';
      default: return 'default';
    }
  };

  const columns: GridColDef[] = [
    {
      field: 'name',
      headerName: 'Report Name',
      flex: 1,
      minWidth: 200,
    },
    {
      field: 'type',
      headerName: 'Type',
      width: 120,
      renderCell: (params) => (
        <Chip label={params.value} size="small" variant="outlined" />
      ),
    },
    {
      field: 'format',
      headerName: 'Format',
      width: 100,
      renderCell: (params) => (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {getFormatIcon(params.value)}
          <span>{params.value.toUpperCase()}</span>
        </Box>
      ),
    },
    {
      field: 'status',
      headerName: 'Status',
      width: 120,
      renderCell: (params) => (
        <Chip
          label={params.value}
          color={getStatusColor(params.value)}
          size="small"
          variant="filled"
        />
      ),
    },
    createDateColumn('createdAt', 'Created', 180),
    {
      field: 'fileSize',
      headerName: 'Size',
      width: 100,
      valueGetter: (params) => {
        if (!params.value) return '-';
        const size = params.value;
        if (size < 1024) return `${size} B`;
        if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
        return `${(size / (1024 * 1024)).toFixed(1)} MB`;
      },
    },
    {
      field: 'actions',
      headerName: 'Actions',
      width: 150,
      renderCell: (params) => (
        <Box>
          {params.row.status === 'completed' && (
            <Tooltip title="Download">
              <IconButton
                size="small"
                onClick={() => handleDownload(params.row.id, params.row.format)}
              >
                <DownloadIcon />
              </IconButton>
            </Tooltip>
          )}
          {params.row.schedule && (
            <Tooltip title="Scheduled Report">
              <IconButton size="small" color="primary">
                <ScheduleIcon />
              </IconButton>
            </Tooltip>
          )}
        </Box>
      ),
    },
  ];

  const reportGenerationData = [
    { name: 'Mon', reports: 12 },
    { name: 'Tue', reports: 18 },
    { name: 'Wed', reports: 15 },
    { name: 'Thu', reports: 22 },
    { name: 'Fri', reports: 28 },
    { name: 'Sat', reports: 8 },
    { name: 'Sun', reports: 6 },
  ];

  const reportTypeDistribution = [
    { name: 'Cost Reports', value: 45 },
    { name: 'Performance Reports', value: 30 },
    { name: 'Usage Reports', value: 20 },
    { name: 'Custom Reports', value: 5 },
  ];

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4">Reports & Analytics</Typography>
        <Box sx={{ display: 'flex', gap: 2 }}>
          <Button
            variant="outlined"
            startIcon={<ScheduleIcon />}
            onClick={() => setScheduleDialogOpen(true)}
          >
            Schedule Report
          </Button>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setGenerateDialogOpen(true)}
          >
            Generate Report
          </Button>
        </Box>
      </Box>

      {/* Report Statistics */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <MetricsCard
            title="Reports Generated"
            value={reports.length}
            trend="increasing"
            trendValue={15.2}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <MetricsCard
            title="Scheduled Reports"
            value={12}
            status="healthy"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <MetricsCard
            title="Avg Generation Time"
            value="2.3s"
            trend="improving"
            trendValue={-12.5}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <MetricsCard
            title="Success Rate"
            value="98.5%"
            status="healthy"
            trend="stable"
          />
        </Grid>
      </Grid>

      {/* Charts Row */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} md={8}>
          <ChartWidget
            title="Report Generation Trend"
            subtitle="Number of reports generated per day"
            type="bar"
            data={reportGenerationData}
            dataKey="reports"
            height={300}
          />
        </Grid>
        <Grid item xs={12} md={4}>
          <ChartWidget
            title="Report Types"
            subtitle="Distribution by type"
            type="pie"
            data={reportTypeDistribution}
            dataKey="value"
            height={300}
          />
        </Grid>
      </Grid>

      {/* Filters */}
      <FilterPanel
        onFilterChange={handleFilterChange}
        showSearch
        showDateRange
        customFilters={[
          {
            name: 'type',
            label: 'Report Type',
            type: 'select',
            options: [
              { label: 'Cost', value: 'cost' },
              { label: 'Performance', value: 'performance' },
              { label: 'Usage', value: 'usage' },
              { label: 'Custom', value: 'custom' },
            ],
          },
          {
            name: 'status',
            label: 'Status',
            type: 'select',
            options: [
              { label: 'Pending', value: 'pending' },
              { label: 'Generating', value: 'generating' },
              { label: 'Completed', value: 'completed' },
              { label: 'Failed', value: 'failed' },
            ],
          },
        ]}
      />

      {/* Reports Table */}
      <DataTable
        title="Generated Reports"
        data={reports}
        columns={columns}
        loading={loading}
        height={500}
      />

      {/* Generate Report Dialog */}
      <Dialog open={generateDialogOpen} onClose={() => setGenerateDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Generate New Report</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
            <TextField
              label="Report Name"
              value={newReport.name}
              onChange={(e) => setNewReport({ ...newReport, name: e.target.value })}
              fullWidth
            />
            <FormControl fullWidth>
              <InputLabel>Report Type</InputLabel>
              <Select
                value={newReport.type}
                label="Report Type"
                onChange={(e) => setNewReport({ ...newReport, type: e.target.value })}
              >
                <MenuItem value="cost">Cost Analysis</MenuItem>
                <MenuItem value="performance">Performance Report</MenuItem>
                <MenuItem value="usage">Usage Statistics</MenuItem>
                <MenuItem value="custom">Custom Report</MenuItem>
              </Select>
            </FormControl>
            <FormControl fullWidth>
              <InputLabel>Format</InputLabel>
              <Select
                value={newReport.format}
                label="Format"
                onChange={(e) => setNewReport({ ...newReport, format: e.target.value })}
              >
                <MenuItem value="pdf">PDF</MenuItem>
                <MenuItem value="excel">Excel</MenuItem>
                <MenuItem value="csv">CSV</MenuItem>
              </Select>
            </FormControl>
            <DatePicker
              label="Start Date"
              value={newReport.dateRange.start}
              onChange={(value) => setNewReport({
                ...newReport,
                dateRange: { ...newReport.dateRange, start: value || new Date() }
              })}
              slotProps={{ textField: { fullWidth: true } }}
            />
            <DatePicker
              label="End Date"
              value={newReport.dateRange.end}
              onChange={(value) => setNewReport({
                ...newReport,
                dateRange: { ...newReport.dateRange, end: value || new Date() }
              })}
              slotProps={{ textField: { fullWidth: true } }}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setGenerateDialogOpen(false)}>Cancel</Button>
          <Button
            onClick={handleGenerateReport}
            variant="contained"
            disabled={!newReport.name || generating}
          >
            {generating ? 'Generating...' : 'Generate'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Schedule Report Dialog */}
      <Dialog open={scheduleDialogOpen} onClose={() => setScheduleDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Schedule Report</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
            <FormControl fullWidth>
              <InputLabel>Report Type</InputLabel>
              <Select
                value={newSchedule.reportType}
                label="Report Type"
                onChange={(e) => setNewSchedule({ ...newSchedule, reportType: e.target.value })}
              >
                <MenuItem value="cost">Cost Analysis</MenuItem>
                <MenuItem value="performance">Performance Report</MenuItem>
                <MenuItem value="usage">Usage Statistics</MenuItem>
              </Select>
            </FormControl>
            <FormControl fullWidth>
              <InputLabel>Frequency</InputLabel>
              <Select
                value={newSchedule.frequency}
                label="Frequency"
                onChange={(e) => setNewSchedule({ ...newSchedule, frequency: e.target.value })}
              >
                <MenuItem value="daily">Daily</MenuItem>
                <MenuItem value="weekly">Weekly</MenuItem>
                <MenuItem value="monthly">Monthly</MenuItem>
              </Select>
            </FormControl>
            <FormControl fullWidth>
              <InputLabel>Format</InputLabel>
              <Select
                value={newSchedule.format}
                label="Format"
                onChange={(e) => setNewSchedule({ ...newSchedule, format: e.target.value })}
              >
                <MenuItem value="pdf">PDF</MenuItem>
                <MenuItem value="excel">Excel</MenuItem>
                <MenuItem value="csv">CSV</MenuItem>
              </Select>
            </FormControl>
            <TextField
              label="Email Recipients"
              placeholder="Enter email addresses separated by commas"
              value={newSchedule.recipients}
              onChange={(e) => setNewSchedule({ ...newSchedule, recipients: e.target.value })}
              fullWidth
              multiline
              rows={2}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setScheduleDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleScheduleReport} variant="contained">
            Schedule
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

export default ReportsPage;