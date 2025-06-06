const express = require('express');
const router = express.Router();
const VisualizationService = require('../../services/VisualizationService');
const VisualizationEngine = require('../../visualization/VisualizationEngine');
const auth = require('../middleware/auth');
const logger = require('../../utils/logger');

// Initialize services
const visualizationService = new VisualizationService();
const visualizationEngine = new VisualizationEngine();

// Initialize on startup
(async () => {
  try {
    await visualizationService.initialize();
    await visualizationEngine.initialize();
    logger.info('Visualization routes initialized');
  } catch (error) {
    logger.error('Failed to initialize visualization services:', error);
  }
})();

/**
 * GET /api/visualizations/types
 * Get supported visualization types
 */
router.get('/types', auth, async (req, res) => {
  try {
    const types = visualizationEngine.getSupportedTypes();
    const typeDetails = types.map(type => ({
      type,
      name: type.charAt(0).toUpperCase() + type.slice(1),
      description: getTypeDescription(type),
      supportedDataSources: getSupportedDataSources(type)
    }));

    res.json({
      success: true,
      types: typeDetails
    });
  } catch (error) {
    logger.error('Error fetching visualization types:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch visualization types'
    });
  }
});

/**
 * GET /api/visualizations/data/:type
 * Get visualization data
 */
router.get('/data/:type', auth, async (req, res) => {
  try {
    const { type } = req.params;
    const { source, filters, options } = req.query;

    const query = {
      source: source || 'documents',
      filters: filters ? JSON.parse(filters) : {},
      limit: parseInt(req.query.limit) || 1000,
      offset: parseInt(req.query.offset) || 0
    };

    const vizOptions = options ? JSON.parse(options) : {};

    const data = await visualizationService.getVisualizationData(
      type,
      query,
      vizOptions
    );

    res.json({
      success: true,
      type,
      data,
      cached: !!vizOptions.noCache
    });
  } catch (error) {
    logger.error('Error fetching visualization data:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch visualization data'
    });
  }
});

/**
 * POST /api/visualizations/render
 * Render a visualization (server-side)
 */
router.post('/render', auth, async (req, res) => {
  try {
    const { type, data, options, format = 'svg' } = req.body;

    // Create temporary container for server-side rendering
    const container = createVirtualContainer();
    
    const viz = await visualizationEngine.createVisualization(
      `temp-${Date.now()}`,
      type,
      container,
      data,
      options
    );

    // Export to requested format
    const result = await visualizationEngine.exportVisualization(
      viz.id,
      format,
      { includeData: false }
    );

    // Clean up
    visualizationEngine.destroyVisualization(viz.id);

    res.json({
      success: true,
      format,
      data: result
    });
  } catch (error) {
    logger.error('Error rendering visualization:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to render visualization'
    });
  }
});

/**
 * GET /api/visualizations/aggregations/:pipeline
 * Get aggregated data
 */
router.get('/aggregations/:pipeline', auth, async (req, res) => {
  try {
    const { pipeline } = req.params;
    const filters = req.query.filters ? JSON.parse(req.query.filters) : {};

    let result;
    switch (pipeline) {
      case 'documentStats':
        result = await visualizationService.aggregateDocumentStats(filters);
        break;
      case 'entityRelations':
        result = await visualizationService.aggregateEntityRelations(filters);
        break;
      case 'temporalDistribution':
        result = await visualizationService.aggregateTemporalDistribution(filters);
        break;
      case 'categoryBreakdown':
        result = await visualizationService.aggregateCategoryBreakdown(filters);
        break;
      default:
        throw new Error(`Unknown aggregation pipeline: ${pipeline}`);
    }

    res.json({
      success: true,
      pipeline,
      data: result
    });
  } catch (error) {
    logger.error('Error executing aggregation pipeline:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to execute aggregation pipeline'
    });
  }
});

/**
 * POST /api/visualizations/export
 * Export visualization data
 */
router.post('/export', auth, async (req, res) => {
  try {
    const { type, data, format = 'json' } = req.body;

    const exported = await visualizationService.exportData(type, data, format);

    // Set appropriate headers
    const contentType = {
      json: 'application/json',
      csv: 'text/csv',
      excel: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    }[format] || 'application/octet-stream';

    const filename = `visualization-${type}-${Date.now()}.${format}`;

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    
    if (format === 'json' || format === 'csv') {
      res.send(exported);
    } else {
      res.send(Buffer.from(exported, 'base64'));
    }
  } catch (error) {
    logger.error('Error exporting visualization:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to export visualization'
    });
  }
});

/**
 * GET /api/visualizations/dashboards
 * Get user dashboards
 */
router.get('/dashboards', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Fetch user dashboards from database
    const dashboards = await visualizationService.db.query('visualization_dashboards', {
      where: { user_id: userId },
      order: [['updated_at', 'DESC']]
    });

    res.json({
      success: true,
      dashboards
    });
  } catch (error) {
    logger.error('Error fetching dashboards:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch dashboards'
    });
  }
});

/**
 * POST /api/visualizations/dashboards
 * Create new dashboard
 */
router.post('/dashboards', auth, async (req, res) => {
  try {
    const { name, description, layout, widgets } = req.body;
    const userId = req.user.id;

    const dashboard = await visualizationService.db.create('visualization_dashboards', {
      user_id: userId,
      name,
      description,
      layout: JSON.stringify(layout),
      widgets: JSON.stringify(widgets),
      created_at: new Date(),
      updated_at: new Date()
    });

    res.json({
      success: true,
      dashboard
    });
  } catch (error) {
    logger.error('Error creating dashboard:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create dashboard'
    });
  }
});

/**
 * PUT /api/visualizations/dashboards/:id
 * Update dashboard
 */
router.put('/dashboards/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, layout, widgets } = req.body;
    const userId = req.user.id;

    const updated = await visualizationService.db.update('visualization_dashboards', {
      name,
      description,
      layout: JSON.stringify(layout),
      widgets: JSON.stringify(widgets),
      updated_at: new Date()
    }, {
      where: { id, user_id: userId }
    });

    if (!updated) {
      return res.status(404).json({
        success: false,
        error: 'Dashboard not found'
      });
    }

    res.json({
      success: true,
      message: 'Dashboard updated successfully'
    });
  } catch (error) {
    logger.error('Error updating dashboard:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update dashboard'
    });
  }
});

/**
 * DELETE /api/visualizations/dashboards/:id
 * Delete dashboard
 */
router.delete('/dashboards/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const deleted = await visualizationService.db.delete('visualization_dashboards', {
      where: { id, user_id: userId }
    });

    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: 'Dashboard not found'
      });
    }

    res.json({
      success: true,
      message: 'Dashboard deleted successfully'
    });
  } catch (error) {
    logger.error('Error deleting dashboard:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete dashboard'
    });
  }
});

/**
 * POST /api/visualizations/share/:id
 * Share dashboard
 */
router.post('/share/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const { shareWith, permission = 'view' } = req.body;
    const userId = req.user.id;

    // Verify dashboard ownership
    const dashboard = await visualizationService.db.findOne('visualization_dashboards', {
      where: { id, user_id: userId }
    });

    if (!dashboard) {
      return res.status(404).json({
        success: false,
        error: 'Dashboard not found'
      });
    }

    // Create share record
    const share = await visualizationService.db.create('dashboard_shares', {
      dashboard_id: id,
      shared_by: userId,
      shared_with: shareWith,
      permission,
      created_at: new Date()
    });

    res.json({
      success: true,
      share
    });
  } catch (error) {
    logger.error('Error sharing dashboard:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to share dashboard'
    });
  }
});

/**
 * DELETE /api/visualizations/cache
 * Clear visualization cache
 */
router.delete('/cache', auth, async (req, res) => {
  try {
    const { pattern } = req.query;
    
    await visualizationService.clearCache(pattern);

    res.json({
      success: true,
      message: `Cache cleared${pattern ? ` for pattern: ${pattern}` : ''}`
    });
  } catch (error) {
    logger.error('Error clearing cache:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to clear cache'
    });
  }
});

/**
 * Helper functions
 */
function getTypeDescription(type) {
  const descriptions = {
    chart: 'Line, bar, pie, and other standard charts',
    network: 'Entity relationship and network graphs',
    heatmap: 'Document similarity and activity patterns',
    treemap: 'Hierarchical data representation',
    sankey: 'Flow and relationship diagrams',
    wordcloud: 'Keyword frequency visualization',
    timeline: 'Event and document timeline',
    geomap: 'Location-based data on maps'
  };
  return descriptions[type] || 'Custom visualization';
}

function getSupportedDataSources(type) {
  const sources = {
    chart: ['documents', 'feedback', 'jobs'],
    network: ['entities', 'documents'],
    heatmap: ['documents', 'feedback'],
    treemap: ['documents', 'categories'],
    sankey: ['documents', 'jobs'],
    wordcloud: ['documents'],
    timeline: ['documents', 'jobs'],
    geomap: ['documents', 'entities']
  };
  return sources[type] || ['documents'];
}

function createVirtualContainer() {
  // Create a virtual DOM container for server-side rendering
  // This would require a DOM implementation like jsdom
  return {
    clientWidth: 800,
    clientHeight: 600,
    querySelector: () => null,
    innerHTML: '',
    appendChild: () => {},
    removeChild: () => {},
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      width: 800,
      height: 600
    })
  };
}

module.exports = router;