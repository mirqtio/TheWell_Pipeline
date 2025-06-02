/**
 * Express App Configuration
 * Exports configured Express app for testing and server use
 */

const express = require('express');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');
const logger = require('../utils/logger');

// Import routes
const reviewRoutes = require('./routes/review');
const jobRoutes = require('./routes/jobs');
const apiRoutes = require('./routes/api');
const visibilityRoutes = require('./routes/visibility');
const feedbackRoutes = require('./routes/feedback');
const ragRoutes = require('./routes/rag');

// Import middleware
const authMiddleware = require('./middleware/auth');
const errorHandler = require('./middleware/errorHandler');

// Create Express app
const app = express();

// Setup middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true
}));

app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// Static files
app.use('/static', express.static(path.join(__dirname, 'public')));

// Health check endpoint (no auth required)
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'manual-review-server'
  });
});

// Apply authentication middleware to all routes except health
app.use(authMiddleware);

// Setup routes
app.use('/api/v1/review', reviewRoutes);
app.use('/api/v1/jobs', jobRoutes);
app.use('/api/v1', apiRoutes);
app.use('/api/v1/visibility', visibilityRoutes);
app.use('/api/v1/feedback', feedbackRoutes);

// RAG routes with dependencies injection
app.use('/api/v1/rag', ragRoutes({
  ragManager: global.testRagManager || null,
  cacheManager: global.testCacheManager || null
}));

// Serve the main review interface
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Not Found',
    message: `Route ${req.method} ${req.path} not found`,
    timestamp: new Date().toISOString()
  });
});

// Error handling middleware
app.use(errorHandler.errorHandler);

module.exports = app;
