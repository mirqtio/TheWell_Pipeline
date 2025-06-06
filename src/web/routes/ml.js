const express = require('express');
const router = express.Router();
const MLModelService = require('../../services/MLModelService');
const logger = require('../../utils/logger');
const { auth, checkRole } = require('../middleware/auth');

// Initialize ML Model Service
let mlService;

/**
 * Initialize ML routes
 */
async function initializeMLRoutes() {
  mlService = new MLModelService();
  await mlService.initialize();
  logger.info('ML routes initialized');
}

// Initialize on module load
initializeMLRoutes().catch(error => {
  logger.error('Failed to initialize ML routes:', error);
});

/**
 * @swagger
 * tags:
 *   name: ML
 *   description: Machine Learning model management and predictions
 */

/**
 * @swagger
 * /api/ml/models:
 *   get:
 *     summary: List all ML models
 *     tags: [ML]
 *     parameters:
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [classification, sentiment, topic_modeling, ner, similarity, quality_scoring]
 *         description: Filter by model type
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [draft, training, trained, deployed, archived]
 *         description: Filter by model status
 *     responses:
 *       200:
 *         description: List of ML models
 */
router.get('/models', auth, async (req, res, next) => {
  try {
    const { type, status } = req.query;
    const models = await mlService.listModels({ type, status });
    
    res.json({
      models,
      count: models.length
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/ml/models:
 *   post:
 *     summary: Create a new ML model
 *     tags: [ML]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - type
 *               - name
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [classification, sentiment, topic_modeling, ner, similarity, quality_scoring]
 *               name:
 *                 type: string
 *               config:
 *                 type: object
 *               hyperparameters:
 *                 type: object
 *     responses:
 *       201:
 *         description: Model created successfully
 */
router.post('/models', auth, checkRole('admin'), async (req, res, next) => {
  try {
    const { type, name, config, hyperparameters } = req.body;
    
    if (!type || !name) {
      return res.status(400).json({ error: 'Type and name are required' });
    }
    
    const model = await mlService.createModel(type, {
      name,
      ...config,
      hyperparameters
    });
    
    res.status(201).json({
      message: 'Model created successfully',
      model
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/ml/models/{modelId}:
 *   get:
 *     summary: Get model details
 *     tags: [ML]
 *     parameters:
 *       - in: path
 *         name: modelId
 *         required: true
 *         schema:
 *           type: integer
 *         description: Model ID
 *     responses:
 *       200:
 *         description: Model details
 */
router.get('/models/:modelId', auth, async (req, res, next) => {
  try {
    const { modelId } = req.params;
    const models = await mlService.listModels();
    const model = models.find(m => m.id === parseInt(modelId));
    
    if (!model) {
      return res.status(404).json({ error: 'Model not found' });
    }
    
    // Get additional details
    const metrics = await mlService.getModelMetrics(modelId);
    
    res.json({
      ...model,
      metrics
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/ml/datasets:
 *   post:
 *     summary: Create a training dataset
 *     tags: [ML]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - sourceQuery
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               type:
 *                 type: string
 *               sourceQuery:
 *                 type: string
 *               filters:
 *                 type: object
 *               splitConfig:
 *                 type: object
 *     responses:
 *       201:
 *         description: Dataset created successfully
 */
router.post('/datasets', auth, checkRole('admin'), async (req, res, next) => {
  try {
    const datasetConfig = req.body;
    
    if (!datasetConfig.name || !datasetConfig.sourceQuery) {
      return res.status(400).json({ error: 'Name and sourceQuery are required' });
    }
    
    const dataset = await mlService.prepareTrainingData(datasetConfig);
    
    res.status(201).json({
      message: 'Dataset created successfully',
      dataset
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/ml/models/{modelId}/train:
 *   post:
 *     summary: Train a model
 *     tags: [ML]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: modelId
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - datasetId
 *             properties:
 *               datasetId:
 *                 type: integer
 *               config:
 *                 type: object
 *                 properties:
 *                   epochs:
 *                     type: integer
 *                   batchSize:
 *                     type: integer
 *                   learningRate:
 *                     type: number
 *     responses:
 *       202:
 *         description: Training job started
 */
router.post('/models/:modelId/train', auth, checkRole('admin'), async (req, res, next) => {
  try {
    const { modelId } = req.params;
    const { datasetId, config } = req.body;
    
    if (!datasetId) {
      return res.status(400).json({ error: 'Dataset ID is required' });
    }
    
    const job = await mlService.trainModel(parseInt(modelId), datasetId, config);
    
    res.status(202).json({
      message: 'Training job started',
      job
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/ml/models/{modelId}/deploy:
 *   post:
 *     summary: Deploy a model
 *     tags: [ML]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: modelId
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               version:
 *                 type: string
 *     responses:
 *       200:
 *         description: Model deployed successfully
 */
router.post('/models/:modelId/deploy', auth, checkRole('admin'), async (req, res, next) => {
  try {
    const { modelId } = req.params;
    const { version } = req.body;
    
    const deployment = await mlService.deployModel(parseInt(modelId), version);
    
    res.json({
      message: 'Model deployed successfully',
      deployment
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/ml/models/{modelId}/predict:
 *   post:
 *     summary: Make predictions with a model
 *     tags: [ML]
 *     parameters:
 *       - in: path
 *         name: modelId
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - input
 *             properties:
 *               input:
 *                 oneOf:
 *                   - type: string
 *                   - type: array
 *                   - type: object
 *               options:
 *                 type: object
 *     responses:
 *       200:
 *         description: Prediction result
 */
router.post('/models/:modelId/predict', auth, async (req, res, next) => {
  try {
    const { modelId } = req.params;
    const { input, options } = req.body;
    
    if (!input) {
      return res.status(400).json({ error: 'Input is required' });
    }
    
    const prediction = await mlService.predict(parseInt(modelId), input, options);
    
    res.json({
      prediction,
      modelId: parseInt(modelId),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/ml/batch-predict:
 *   post:
 *     summary: Make batch predictions
 *     tags: [ML]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - modelId
 *               - inputs
 *             properties:
 *               modelId:
 *                 type: integer
 *               inputs:
 *                 type: array
 *               options:
 *                 type: object
 *     responses:
 *       200:
 *         description: Batch prediction results
 */
router.post('/batch-predict', auth, async (req, res, next) => {
  try {
    const { modelId, inputs, options } = req.body;
    
    if (!modelId || !inputs || !Array.isArray(inputs)) {
      return res.status(400).json({ error: 'ModelId and inputs array are required' });
    }
    
    const predictions = await Promise.all(
      inputs.map(input => mlService.predict(modelId, input, options))
    );
    
    res.json({
      predictions,
      count: predictions.length,
      modelId,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/ml/models/{modelId}/metrics:
 *   get:
 *     summary: Get model metrics
 *     tags: [ML]
 *     parameters:
 *       - in: path
 *         name: modelId
 *         required: true
 *         schema:
 *           type: integer
 *       - in: query
 *         name: metricType
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Model metrics
 */
router.get('/models/:modelId/metrics', auth, async (req, res, next) => {
  try {
    const { modelId } = req.params;
    const { metricType } = req.query;
    
    const metrics = await mlService.getModelMetrics(parseInt(modelId), metricType);
    
    res.json({
      modelId: parseInt(modelId),
      metrics,
      count: metrics.length
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/ml/models/{modelId}/archive:
 *   post:
 *     summary: Archive a model
 *     tags: [ML]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: modelId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Model archived successfully
 */
router.post('/models/:modelId/archive', auth, checkRole('admin'), async (req, res, next) => {
  try {
    const { modelId } = req.params;
    
    await mlService.archiveModel(parseInt(modelId));
    
    res.json({
      message: 'Model archived successfully',
      modelId: parseInt(modelId)
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Special endpoints for specific model types
 */

/**
 * @swagger
 * /api/ml/sentiment/analyze:
 *   post:
 *     summary: Analyze sentiment of text
 *     tags: [ML]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - text
 *             properties:
 *               text:
 *                 oneOf:
 *                   - type: string
 *                   - type: array
 *                     items:
 *                       type: string
 *     responses:
 *       200:
 *         description: Sentiment analysis results
 */
router.post('/sentiment/analyze', auth, async (req, res, next) => {
  try {
    const { text } = req.body;
    
    if (!text) {
      return res.status(400).json({ error: 'Text is required' });
    }
    
    // Find deployed sentiment model
    const models = await mlService.listModels({ type: 'sentiment', status: 'deployed' });
    
    if (models.length === 0) {
      return res.status(404).json({ error: 'No deployed sentiment model found' });
    }
    
    const prediction = await mlService.predict(models[0].id, text);
    
    res.json({
      sentiment: prediction,
      modelId: models[0].id,
      modelVersion: models[0].version
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/ml/classify/document:
 *   post:
 *     summary: Classify documents
 *     tags: [ML]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - document
 *             properties:
 *               document:
 *                 type: string
 *               modelId:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Document classification results
 */
router.post('/classify/document', auth, async (req, res, next) => {
  try {
    const { document, modelId } = req.body;
    
    if (!document) {
      return res.status(400).json({ error: 'Document is required' });
    }
    
    let targetModelId = modelId;
    
    if (!targetModelId) {
      // Find deployed classification model
      const models = await mlService.listModels({ type: 'classification', status: 'deployed' });
      
      if (models.length === 0) {
        return res.status(404).json({ error: 'No deployed classification model found' });
      }
      
      targetModelId = models[0].id;
    }
    
    const prediction = await mlService.predict(targetModelId, document);
    
    res.json({
      classification: prediction,
      modelId: targetModelId
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/ml/similarity/find:
 *   post:
 *     summary: Find similar documents
 *     tags: [ML]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - query
 *               - candidates
 *             properties:
 *               query:
 *                 type: string
 *               candidates:
 *                 type: array
 *                 items:
 *                   type: string
 *               topK:
 *                 type: integer
 *                 default: 5
 *     responses:
 *       200:
 *         description: Similar documents
 */
router.post('/similarity/find', auth, async (req, res, next) => {
  try {
    const { query, candidates, topK = 5 } = req.body;
    
    if (!query || !candidates || !Array.isArray(candidates)) {
      return res.status(400).json({ error: 'Query and candidates array are required' });
    }
    
    // Find deployed similarity model
    const models = await mlService.listModels({ type: 'similarity', status: 'deployed' });
    
    if (models.length === 0) {
      return res.status(404).json({ error: 'No deployed similarity model found' });
    }
    
    const prediction = await mlService.predict(models[0].id, {
      query,
      candidates,
      topK
    });
    
    res.json({
      similar: prediction,
      modelId: models[0].id
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/ml/quality/assess:
 *   post:
 *     summary: Assess document quality
 *     tags: [ML]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - document
 *             properties:
 *               document:
 *                 type: string
 *     responses:
 *       200:
 *         description: Quality assessment results
 */
router.post('/quality/assess', auth, async (req, res, next) => {
  try {
    const { document } = req.body;
    
    if (!document) {
      return res.status(400).json({ error: 'Document is required' });
    }
    
    // Find deployed quality scoring model
    const models = await mlService.listModels({ type: 'quality_scoring', status: 'deployed' });
    
    if (models.length === 0) {
      return res.status(404).json({ error: 'No deployed quality scoring model found' });
    }
    
    const prediction = await mlService.predict(models[0].id, document);
    
    res.json({
      quality: prediction,
      modelId: models[0].id
    });
  } catch (error) {
    next(error);
  }
});

// Cleanup on process exit
process.on('SIGTERM', async () => {
  if (mlService) {
    await mlService.cleanup();
  }
});

module.exports = router;