import React, { useState, useEffect, useRef, useCallback } from 'react';
import logger from '../../../utils/logger';
import {
  Box,
  Paper,
  Grid,
  Typography,
  IconButton,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Tabs,
  Tab,
  Fab,
  Menu,
  ListItemIcon,
  ListItemText,
  Drawer,
  Divider,
  Chip,
  Alert,
  CircularProgress,
  Tooltip
} from '@mui/material';
import {
  Add as AddIcon,
  Save as SaveIcon,
  Share as ShareIcon,
  Fullscreen as FullscreenIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  DragIndicator as DragIcon,
  Settings as SettingsIcon,
  GetApp as ExportIcon,
  Refresh as RefreshIcon,
  Dashboard as DashboardIcon,
  Timeline as TimelineIcon,
  BubbleChart as NetworkIcon,
  GridOn as HeatmapIcon,
  AccountTree as TreemapIcon,
  Cloud as WordCloudIcon,
  Map as MapIcon,
  ShowChart as ChartIcon
} from '@mui/icons-material';
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd';
import axios from 'axios';
import './VisualizationDashboard.css';

// Import visualization engine (will be loaded dynamically in browser)
let VisualizationEngine;

const VISUALIZATION_TYPES = [
  { type: 'chart', name: 'Chart', icon: <ChartIcon /> },
  { type: 'network', name: 'Network Graph', icon: <NetworkIcon /> },
  { type: 'heatmap', name: 'Heat Map', icon: <HeatmapIcon /> },
  { type: 'treemap', name: 'Tree Map', icon: <TreemapIcon /> },
  { type: 'wordcloud', name: 'Word Cloud', icon: <WordCloudIcon /> },
  { type: 'timeline', name: 'Timeline', icon: <TimelineIcon /> },
  { type: 'geomap', name: 'Geographic Map', icon: <MapIcon /> }
];

const VisualizationDashboard = () => {
  const [dashboards, setDashboards] = useState([]);
  const [currentDashboard, setCurrentDashboard] = useState(null);
  const [widgets, setWidgets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [addWidgetOpen, setAddWidgetOpen] = useState(false);
  const [widgetSettingsOpen, setWidgetSettingsOpen] = useState(false);
  const [selectedWidget, setSelectedWidget] = useState(null);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState(null);
  
  const visualizationEngineRef = useRef(null);
  const widgetRefs = useRef({});

  // Initialize visualization engine
  useEffect(() => {
    const initEngine = async () => {
      try {
        // Dynamically import visualization engine
        const module = await import('../../visualization/VisualizationEngine');
        VisualizationEngine = module.default;
        
        visualizationEngineRef.current = new VisualizationEngine();
        await visualizationEngineRef.current.initialize();
        
        logger.info('Visualization engine initialized');
      } catch (error) {
        logger.error('Failed to initialize visualization engine:', error);
        setError('Failed to initialize visualization engine');
      }
    };
    
    initEngine();
    
    return () => {
      if (visualizationEngineRef.current) {
        visualizationEngineRef.current.cleanup();
      }
    };
  }, []);

  // Load dashboards
  useEffect(() => {
    loadDashboards();
  }, []);

  const loadDashboards = async () => {
    try {
      setLoading(true);
      const response = await axios.get('/api/visualizations/dashboards');
      setDashboards(response.data.dashboards);
      
      // Load first dashboard if available
      if (response.data.dashboards.length > 0) {
        selectDashboard(response.data.dashboards[0]);
      }
    } catch (error) {
      logger.error('Failed to load dashboards:', error);
      setError('Failed to load dashboards');
    } finally {
      setLoading(false);
    }
  };

  const selectDashboard = (dashboard) => {
    setCurrentDashboard(dashboard);
    const parsedWidgets = JSON.parse(dashboard.widgets || '[]');
    setWidgets(parsedWidgets);
    
    // Render widgets after DOM update
    setTimeout(() => {
      parsedWidgets.forEach(widget => {
        renderWidget(widget);
      });
    }, 100);
  };

  const renderWidget = async (widget) => {
    if (!visualizationEngineRef.current || !widgetRefs.current[widget.id]) {
      return;
    }

    try {
      // Fetch data for widget
      const response = await axios.get(`/api/visualizations/data/${widget.type}`, {
        params: {
          source: widget.dataSource,
          filters: JSON.stringify(widget.filters || {}),
          options: JSON.stringify(widget.options || {})
        }
      });

      // Create visualization
      await visualizationEngineRef.current.createVisualization(
        widget.id,
        widget.type,
        widgetRefs.current[widget.id],
        response.data.data,
        widget.visualizationOptions || {}
      );

      // Setup cross-filtering if enabled
      if (widget.enableCrossFilter) {
        const filterableWidgets = widgets
          .filter(w => w.enableCrossFilter && w.id !== widget.id)
          .map(w => w.id);
        
        if (filterableWidgets.length > 0) {
          visualizationEngineRef.current.enableCrossFiltering([
            widget.id,
            ...filterableWidgets
          ]);
        }
      }
    } catch (error) {
      logger.error(`Failed to render widget ${widget.id}:`, error);
    }
  };

  const handleDragEnd = (result) => {
    if (!result.destination) return;

    const items = Array.from(widgets);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);

    setWidgets(items);
  };

  const addWidget = async (widgetConfig) => {
    const newWidget = {
      id: `widget-${Date.now()}`,
      ...widgetConfig,
      created: new Date().toISOString()
    };

    const updatedWidgets = [...widgets, newWidget];
    setWidgets(updatedWidgets);
    
    // Render the new widget
    setTimeout(() => {
      renderWidget(newWidget);
    }, 100);
    
    setAddWidgetOpen(false);
  };

  const updateWidget = async (widgetId, updates) => {
    const updatedWidgets = widgets.map(widget =>
      widget.id === widgetId ? { ...widget, ...updates } : widget
    );
    
    setWidgets(updatedWidgets);
    
    // Re-render the widget
    if (visualizationEngineRef.current) {
      visualizationEngineRef.current.destroyVisualization(widgetId);
      setTimeout(() => {
        const widget = updatedWidgets.find(w => w.id === widgetId);
        renderWidget(widget);
      }, 100);
    }
  };

  const removeWidget = (widgetId) => {
    if (visualizationEngineRef.current) {
      visualizationEngineRef.current.destroyVisualization(widgetId);
    }
    
    setWidgets(widgets.filter(widget => widget.id !== widgetId));
  };

  const saveDashboard = async () => {
    try {
      const dashboardData = {
        name: currentDashboard.name,
        description: currentDashboard.description,
        layout: { columns: 12, rowHeight: 200 },
        widgets: JSON.stringify(widgets)
      };

      if (currentDashboard.id) {
        await axios.put(`/api/visualizations/dashboards/${currentDashboard.id}`, dashboardData);
      } else {
        const response = await axios.post('/api/visualizations/dashboards', dashboardData);
        setCurrentDashboard(response.data.dashboard);
      }

      setError(null);
      alert('Dashboard saved successfully!');
    } catch (error) {
      logger.error('Failed to save dashboard:', error);
      setError('Failed to save dashboard');
    }
  };

  const exportWidget = async (widget, format) => {
    try {
      const result = await visualizationEngineRef.current.exportVisualization(
        widget.id,
        format
      );
      
      // Create download link
      const link = document.createElement('a');
      link.href = result;
      link.download = `${widget.title || widget.type}-${Date.now()}.${format}`;
      link.click();
    } catch (error) {
      logger.error('Failed to export widget:', error);
      setError('Failed to export visualization');
    }
  };

  const refreshWidget = (widget) => {
    if (visualizationEngineRef.current) {
      visualizationEngineRef.current.destroyVisualization(widget.id);
      renderWidget(widget);
    }
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" height="100vh">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box className="visualization-dashboard">
      {/* Header */}
      <Box className="dashboard-header" p={2}>
        <Grid container alignItems="center" spacing={2}>
          <Grid item>
            <DashboardIcon fontSize="large" />
          </Grid>
          <Grid item xs>
            <Typography variant="h4">
              {currentDashboard?.name || 'Visualization Dashboard'}
            </Typography>
            {currentDashboard?.description && (
              <Typography variant="body2" color="textSecondary">
                {currentDashboard.description}
              </Typography>
            )}
          </Grid>
          <Grid item>
            <Button
              variant="outlined"
              startIcon={<SaveIcon />}
              onClick={saveDashboard}
              disabled={!currentDashboard}
            >
              Save
            </Button>
          </Grid>
          <Grid item>
            <Button
              variant="outlined"
              startIcon={<ShareIcon />}
              onClick={() => setShareDialogOpen(true)}
              disabled={!currentDashboard}
            >
              Share
            </Button>
          </Grid>
          <Grid item>
            <IconButton onClick={(e) => setMenuAnchor(e.currentTarget)}>
              <SettingsIcon />
            </IconButton>
          </Grid>
        </Grid>
      </Box>

      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Widget Grid */}
      <Box className="widget-grid" p={2}>
        <DragDropContext onDragEnd={handleDragEnd}>
          <Droppable droppableId="widgets">
            {(provided) => (
              <Grid
                container
                spacing={2}
                {...provided.droppableProps}
                ref={provided.innerRef}
              >
                {widgets.map((widget, index) => (
                  <Draggable key={widget.id} draggableId={widget.id} index={index}>
                    {(provided, snapshot) => (
                      <Grid
                        item
                        xs={12}
                        sm={widget.size?.sm || 6}
                        md={widget.size?.md || 4}
                        lg={widget.size?.lg || 3}
                        ref={provided.innerRef}
                        {...provided.draggableProps}
                        style={{
                          ...provided.draggableProps.style,
                          opacity: snapshot.isDragging ? 0.8 : 1
                        }}
                      >
                        <Paper
                          className="widget-container"
                          elevation={snapshot.isDragging ? 8 : 2}
                        >
                          {/* Widget Header */}
                          <Box className="widget-header" p={1}>
                            <Grid container alignItems="center" spacing={1}>
                              <Grid item {...provided.dragHandleProps}>
                                <DragIcon fontSize="small" />
                              </Grid>
                              <Grid item xs>
                                <Typography variant="subtitle2">
                                  {widget.title || widget.type}
                                </Typography>
                              </Grid>
                              <Grid item>
                                <IconButton
                                  size="small"
                                  onClick={() => refreshWidget(widget)}
                                >
                                  <RefreshIcon fontSize="small" />
                                </IconButton>
                              </Grid>
                              <Grid item>
                                <IconButton
                                  size="small"
                                  onClick={() => {
                                    setSelectedWidget(widget);
                                    setWidgetSettingsOpen(true);
                                  }}
                                >
                                  <SettingsIcon fontSize="small" />
                                </IconButton>
                              </Grid>
                              <Grid item>
                                <IconButton
                                  size="small"
                                  onClick={() => removeWidget(widget.id)}
                                >
                                  <DeleteIcon fontSize="small" />
                                </IconButton>
                              </Grid>
                            </Grid>
                          </Box>
                          
                          {/* Widget Content */}
                          <Box
                            className="widget-content"
                            ref={(el) => widgetRefs.current[widget.id] = el}
                            style={{ height: widget.height || 300 }}
                          />
                        </Paper>
                      </Grid>
                    )}
                  </Draggable>
                ))}
                {provided.placeholder}
              </Grid>
            )}
          </Droppable>
        </DragDropContext>
      </Box>

      {/* Floating Action Button */}
      <Fab
        className="add-widget-fab"
        color="primary"
        onClick={() => setAddWidgetOpen(true)}
      >
        <AddIcon />
      </Fab>

      {/* Add Widget Dialog */}
      <AddWidgetDialog
        open={addWidgetOpen}
        onClose={() => setAddWidgetOpen(false)}
        onAdd={addWidget}
      />

      {/* Widget Settings Dialog */}
      {selectedWidget && (
        <WidgetSettingsDialog
          open={widgetSettingsOpen}
          widget={selectedWidget}
          onClose={() => setWidgetSettingsOpen(false)}
          onUpdate={(updates) => updateWidget(selectedWidget.id, updates)}
          onExport={(format) => exportWidget(selectedWidget, format)}
        />
      )}

      {/* Share Dialog */}
      <ShareDashboardDialog
        open={shareDialogOpen}
        dashboard={currentDashboard}
        onClose={() => setShareDialogOpen(false)}
      />

      {/* Settings Menu */}
      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={() => setMenuAnchor(null)}
      >
        <MenuItem onClick={() => {
          setMenuAnchor(null);
          // Create new dashboard
        }}>
          <ListItemIcon><AddIcon /></ListItemIcon>
          <ListItemText>New Dashboard</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => {
          setMenuAnchor(null);
          loadDashboards();
        }}>
          <ListItemIcon><RefreshIcon /></ListItemIcon>
          <ListItemText>Refresh</ListItemText>
        </MenuItem>
        <Divider />
        {dashboards.map(dashboard => (
          <MenuItem
            key={dashboard.id}
            selected={dashboard.id === currentDashboard?.id}
            onClick={() => {
              setMenuAnchor(null);
              selectDashboard(dashboard);
            }}
          >
            <ListItemText>{dashboard.name}</ListItemText>
          </MenuItem>
        ))}
      </Menu>
    </Box>
  );
};

// Add Widget Dialog Component
const AddWidgetDialog = ({ open, onClose, onAdd }) => {
  const [widgetConfig, setWidgetConfig] = useState({
    type: 'chart',
    title: '',
    dataSource: 'documents',
    size: { xs: 12, sm: 6, md: 4, lg: 3 },
    height: 300
  });

  const handleAdd = () => {
    onAdd(widgetConfig);
    setWidgetConfig({
      type: 'chart',
      title: '',
      dataSource: 'documents',
      size: { xs: 12, sm: 6, md: 4, lg: 3 },
      height: 300
    });
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Add Visualization Widget</DialogTitle>
      <DialogContent>
        <Grid container spacing={2} sx={{ mt: 1 }}>
          <Grid item xs={12}>
            <FormControl fullWidth>
              <InputLabel>Visualization Type</InputLabel>
              <Select
                value={widgetConfig.type}
                onChange={(e) => setWidgetConfig({ ...widgetConfig, type: e.target.value })}
              >
                {VISUALIZATION_TYPES.map(type => (
                  <MenuItem key={type.type} value={type.type}>
                    <Box display="flex" alignItems="center" gap={1}>
                      {type.icon}
                      {type.name}
                    </Box>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12}>
            <TextField
              fullWidth
              label="Widget Title"
              value={widgetConfig.title}
              onChange={(e) => setWidgetConfig({ ...widgetConfig, title: e.target.value })}
            />
          </Grid>
          <Grid item xs={12}>
            <FormControl fullWidth>
              <InputLabel>Data Source</InputLabel>
              <Select
                value={widgetConfig.dataSource}
                onChange={(e) => setWidgetConfig({ ...widgetConfig, dataSource: e.target.value })}
              >
                <MenuItem value="documents">Documents</MenuItem>
                <MenuItem value="feedback">Feedback</MenuItem>
                <MenuItem value="jobs">Jobs</MenuItem>
                <MenuItem value="entities">Entities</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12}>
            <TextField
              fullWidth
              type="number"
              label="Height (px)"
              value={widgetConfig.height}
              onChange={(e) => setWidgetConfig({ ...widgetConfig, height: parseInt(e.target.value) })}
            />
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={handleAdd} variant="contained">Add Widget</Button>
      </DialogActions>
    </Dialog>
  );
};

// Widget Settings Dialog Component
const WidgetSettingsDialog = ({ open, widget, onClose, onUpdate, onExport }) => {
  const [settings, setSettings] = useState({
    title: widget.title || '',
    height: widget.height || 300,
    enableCrossFilter: widget.enableCrossFilter || false,
    refreshInterval: widget.refreshInterval || 0
  });

  const handleSave = () => {
    onUpdate(settings);
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Widget Settings</DialogTitle>
      <DialogContent>
        <Grid container spacing={2} sx={{ mt: 1 }}>
          <Grid item xs={12}>
            <TextField
              fullWidth
              label="Title"
              value={settings.title}
              onChange={(e) => setSettings({ ...settings, title: e.target.value })}
            />
          </Grid>
          <Grid item xs={12}>
            <TextField
              fullWidth
              type="number"
              label="Height (px)"
              value={settings.height}
              onChange={(e) => setSettings({ ...settings, height: parseInt(e.target.value) })}
            />
          </Grid>
          <Grid item xs={12}>
            <FormControl fullWidth>
              <InputLabel>Auto Refresh</InputLabel>
              <Select
                value={settings.refreshInterval}
                onChange={(e) => setSettings({ ...settings, refreshInterval: e.target.value })}
              >
                <MenuItem value={0}>Disabled</MenuItem>
                <MenuItem value={30000}>30 seconds</MenuItem>
                <MenuItem value={60000}>1 minute</MenuItem>
                <MenuItem value={300000}>5 minutes</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12}>
            <Typography variant="subtitle2" gutterBottom>
              Export Options
            </Typography>
            <Box display="flex" gap={1}>
              <Button size="small" onClick={() => onExport('png')}>PNG</Button>
              <Button size="small" onClick={() => onExport('svg')}>SVG</Button>
              <Button size="small" onClick={() => onExport('pdf')}>PDF</Button>
              <Button size="small" onClick={() => onExport('json')}>JSON</Button>
            </Box>
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={handleSave} variant="contained">Save</Button>
      </DialogActions>
    </Dialog>
  );
};

// Share Dashboard Dialog Component
const ShareDashboardDialog = ({ open, dashboard, onClose }) => {
  const [shareEmail, setShareEmail] = useState('');
  const [permission, setPermission] = useState('view');

  const handleShare = async () => {
    try {
      await axios.post(`/api/visualizations/share/${dashboard.id}`, {
        shareWith: shareEmail,
        permission
      });
      alert('Dashboard shared successfully!');
      onClose();
    } catch (error) {
      logger.error('Failed to share dashboard:', error);
      alert('Failed to share dashboard');
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Share Dashboard</DialogTitle>
      <DialogContent>
        <Grid container spacing={2} sx={{ mt: 1 }}>
          <Grid item xs={12}>
            <TextField
              fullWidth
              label="Email Address"
              type="email"
              value={shareEmail}
              onChange={(e) => setShareEmail(e.target.value)}
            />
          </Grid>
          <Grid item xs={12}>
            <FormControl fullWidth>
              <InputLabel>Permission</InputLabel>
              <Select
                value={permission}
                onChange={(e) => setPermission(e.target.value)}
              >
                <MenuItem value="view">View Only</MenuItem>
                <MenuItem value="edit">Can Edit</MenuItem>
              </Select>
            </FormControl>
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={handleShare} variant="contained">Share</Button>
      </DialogActions>
    </Dialog>
  );
};

export default VisualizationDashboard;