const express = require('express');
const router = express.Router();
const { authenticateUser, authorizeRole } = require('../middleware/auth');
const logger = require('../../utils/logger');

/**
 * @swagger
 * tags:
 *   name: Categorization
 *   description: Document categorization and taxonomy management
 */

/**
 * @swagger
 * /api/categories:
 *   get:
 *     summary: Get all categories
 *     tags: [Categorization]
 *     parameters:
 *       - in: query
 *         name: parentId
 *         schema:
 *           type: string
 *         description: Filter by parent category ID (use 'root' for top-level)
 *       - in: query
 *         name: depth
 *         schema:
 *           type: integer
 *         description: Filter by depth level
 *       - in: query
 *         name: isActive
 *         schema:
 *           type: boolean
 *         description: Filter by active status
 *     responses:
 *       200:
 *         description: List of categories
 */
router.get('/categories', authenticateUser, async (req, res, next) => {
  try {
    const { parentId, depth, isActive } = req.query;
    
    const categories = await req.app.locals.categorizationService.categoryManager.getCategories({
      parentId: parentId === 'root' ? null : parentId,
      depth: depth ? parseInt(depth) : null,
      isActive: isActive !== undefined ? isActive === 'true' : null
    });

    res.json({ categories });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/categories/hierarchy:
 *   get:
 *     summary: Get category hierarchy
 *     tags: [Categorization]
 *     parameters:
 *       - in: query
 *         name: rootId
 *         schema:
 *           type: integer
 *         description: Root category ID for subtree
 *     responses:
 *       200:
 *         description: Hierarchical category structure
 */
router.get('/categories/hierarchy', authenticateUser, async (req, res, next) => {
  try {
    const { rootId } = req.query;
    
    const hierarchy = await req.app.locals.categorizationService.categoryManager.getCategoryHierarchy(
      rootId ? parseInt(rootId) : null
    );

    res.json({ hierarchy });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/categories/search:
 *   get:
 *     summary: Search categories
 *     tags: [Categorization]
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *         description: Search term
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: Search results
 */
router.get('/categories/search', authenticateUser, async (req, res, next) => {
  try {
    const { q, limit = 20 } = req.query;
    
    if (!q) {
      return res.status(400).json({ error: 'Search term required' });
    }

    const results = await req.app.locals.categorizationService.categoryManager.searchCategories(
      q,
      parseInt(limit)
    );

    res.json({ results });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/categories/{id}:
 *   get:
 *     summary: Get category details
 *     tags: [Categorization]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Category details
 */
router.get('/categories/:id', authenticateUser, async (req, res, next) => {
  try {
    const { id } = req.params;
    
    const [category, stats, rules, path] = await Promise.all([
      req.app.locals.categorizationService.categoryManager.getCategory(parseInt(id)),
      req.app.locals.categorizationService.categoryManager.getCategoryStats(parseInt(id)),
      req.app.locals.categorizationService.categoryManager.getCategoryRules(parseInt(id)),
      req.app.locals.categorizationService.categoryManager.getCategoryPath(parseInt(id))
    ]);

    if (!category) {
      return res.status(404).json({ error: 'Category not found' });
    }

    res.json({
      category,
      stats,
      rules,
      path
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/categories:
 *   post:
 *     summary: Create a new category
 *     tags: [Categorization]
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
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               parentId:
 *                 type: integer
 *               metadata:
 *                 type: object
 *               rules:
 *                 type: array
 *     responses:
 *       201:
 *         description: Created category
 */
router.post('/categories', authenticateUser, authorizeRole(['admin', 'curator']), async (req, res, next) => {
  try {
    const { name, description, parentId, metadata, rules } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Category name is required' });
    }

    const category = await req.app.locals.categorizationService.categoryManager.createCategory({
      name,
      description,
      parentId,
      metadata,
      rules
    });

    res.status(201).json({ category });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/categories/{id}:
 *   put:
 *     summary: Update a category
 *     tags: [Categorization]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Updated category
 */
router.put('/categories/:id', authenticateUser, authorizeRole(['admin', 'curator']), async (req, res, next) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const category = await req.app.locals.categorizationService.categoryManager.updateCategory(
      parseInt(id),
      updates
    );

    res.json({ category });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/categories/{id}:
 *   delete:
 *     summary: Delete a category
 *     tags: [Categorization]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *       - in: query
 *         name: reassignTo
 *         schema:
 *           type: integer
 *         description: Category ID to reassign documents to
 *     responses:
 *       200:
 *         description: Category deleted
 */
router.delete('/categories/:id', authenticateUser, authorizeRole(['admin']), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { reassignTo } = req.query;

    await req.app.locals.categorizationService.categoryManager.deleteCategory(
      parseInt(id),
      reassignTo ? parseInt(reassignTo) : null
    );

    res.json({ message: 'Category deleted successfully' });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/categories/{id}/rules:
 *   post:
 *     summary: Add a categorization rule
 *     tags: [Categorization]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
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
 *               - type
 *               - pattern
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [regex, contains, entity, metadata]
 *               pattern:
 *                 type: string
 *               confidence:
 *                 type: number
 *               metadata:
 *                 type: object
 *     responses:
 *       201:
 *         description: Created rule
 */
router.post('/categories/:id/rules', authenticateUser, authorizeRole(['admin', 'curator']), async (req, res, next) => {
  try {
    const { id } = req.params;
    const rule = req.body;

    if (!rule.type || !rule.pattern) {
      return res.status(400).json({ error: 'Rule type and pattern are required' });
    }

    const createdRule = await req.app.locals.categorizationService.categoryManager.addCategoryRule(
      parseInt(id),
      rule
    );

    res.status(201).json({ rule: createdRule });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/categorize/document/{id}:
 *   post:
 *     summary: Categorize a single document
 *     tags: [Categorization]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *       - in: query
 *         name: threshold
 *         schema:
 *           type: number
 *           default: 0.6
 *       - in: query
 *         name: maxCategories
 *         schema:
 *           type: integer
 *           default: 5
 *     responses:
 *       200:
 *         description: Categorization results
 */
router.post('/categorize/document/:id', authenticateUser, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { threshold, maxCategories, strategies } = req.query;

    const categories = await req.app.locals.categorizationService.categorizeDocument(
      parseInt(id),
      {
        threshold: threshold ? parseFloat(threshold) : undefined,
        maxCategories: maxCategories ? parseInt(maxCategories) : undefined,
        strategies: strategies ? strategies.split(',') : undefined
      }
    );

    res.json({ 
      documentId: id,
      categories 
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/categorize/batch:
 *   post:
 *     summary: Batch categorize documents
 *     tags: [Categorization]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - documentIds
 *             properties:
 *               documentIds:
 *                 type: array
 *                 items:
 *                   type: integer
 *               options:
 *                 type: object
 *     responses:
 *       200:
 *         description: Batch categorization results
 */
router.post('/categorize/batch', authenticateUser, async (req, res, next) => {
  try {
    const { documentIds, options = {} } = req.body;

    if (!Array.isArray(documentIds) || documentIds.length === 0) {
      return res.status(400).json({ error: 'Document IDs array is required' });
    }

    // Start batch processing
    const batchId = Date.now().toString();
    
    // Return immediately with batch ID
    res.json({ 
      batchId,
      message: 'Batch categorization started',
      documentCount: documentIds.length
    });

    // Process in background
    req.app.locals.categorizationService.batchCategorize(documentIds, options)
      .then(results => {
        logger.info(`Batch ${batchId} completed:`, {
          success: results.results.length,
          errors: results.errors.length
        });
      })
      .catch(error => {
        logger.error(`Batch ${batchId} failed:`, error);
      });

  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/categorize/realtime:
 *   post:
 *     summary: Categorize content in real-time
 *     tags: [Categorization]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - content
 *             properties:
 *               content:
 *                 type: object
 *                 properties:
 *                   text:
 *                     type: string
 *                   title:
 *                     type: string
 *                   metadata:
 *                     type: object
 *     responses:
 *       200:
 *         description: Categorization results
 */
router.post('/categorize/realtime', authenticateUser, async (req, res, next) => {
  try {
    const { content, options = {} } = req.body;

    if (!content || (!content.text && !content.title)) {
      return res.status(400).json({ error: 'Content text or title is required' });
    }

    const categories = await req.app.locals.categorizationService.categorizeRealtime(
      content,
      options
    );

    res.json({ categories });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/categorize/suggest/{documentId}:
 *   get:
 *     summary: Get category suggestions for a document
 *     tags: [Categorization]
 *     parameters:
 *       - in: path
 *         name: documentId
 *         required: true
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *     responses:
 *       200:
 *         description: Category suggestions
 */
router.get('/categorize/suggest/:documentId', authenticateUser, async (req, res, next) => {
  try {
    const { documentId } = req.params;
    const { limit } = req.query;

    const suggestions = await req.app.locals.categorizationService.suggestCategories(
      parseInt(documentId),
      limit ? parseInt(limit) : undefined
    );

    res.json({ 
      documentId,
      suggestions 
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/categorize/feedback:
 *   post:
 *     summary: Submit categorization feedback
 *     tags: [Categorization]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - documentId
 *               - categoryId
 *               - feedback
 *             properties:
 *               documentId:
 *                 type: integer
 *               categoryId:
 *                 type: integer
 *               feedback:
 *                 type: object
 *                 properties:
 *                   type:
 *                     type: string
 *                     enum: [accept, reject, adjust]
 *                   isCorrect:
 *                     type: boolean
 *                   newConfidence:
 *                     type: number
 *     responses:
 *       200:
 *         description: Feedback recorded
 */
router.post('/categorize/feedback', authenticateUser, async (req, res, next) => {
  try {
    const { documentId, categoryId, feedback } = req.body;

    if (!documentId || !categoryId || !feedback || !feedback.type) {
      return res.status(400).json({ 
        error: 'Document ID, category ID, and feedback type are required' 
      });
    }

    // Add user ID to feedback
    feedback.userId = req.user.id;

    const result = await req.app.locals.categorizationService.submitFeedback(
      documentId,
      categoryId,
      feedback
    );

    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/categorize/history/{documentId}:
 *   get:
 *     summary: Get categorization history for a document
 *     tags: [Categorization]
 *     parameters:
 *       - in: path
 *         name: documentId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Categorization history
 */
router.get('/categorize/history/:documentId', authenticateUser, async (req, res, next) => {
  try {
    const { documentId } = req.params;

    const history = await req.app.locals.categorizationService.getCategorizationHistory(
      parseInt(documentId)
    );

    res.json({ 
      documentId,
      history 
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/categorize/analytics:
 *   get:
 *     summary: Get categorization analytics
 *     tags: [Categorization]
 *     parameters:
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: categoryId
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Analytics data
 */
router.get('/categorize/analytics', authenticateUser, authorizeRole(['admin', 'analyst']), async (req, res, next) => {
  try {
    const { startDate, endDate, categoryId } = req.query;

    const analytics = await req.app.locals.categorizationService.getAnalytics({
      startDate: startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      endDate: endDate || new Date(),
      categoryId: categoryId ? parseInt(categoryId) : null
    });

    res.json(analytics);
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/categories/export:
 *   get:
 *     summary: Export category structure
 *     tags: [Categorization]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Exported category structure
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 */
router.get('/categories/export', authenticateUser, authorizeRole(['admin']), async (req, res, next) => {
  try {
    const exportData = await req.app.locals.categorizationService.categoryManager.exportCategories();

    res.json(exportData);
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/categories/import:
 *   post:
 *     summary: Import category structure
 *     tags: [Categorization]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     parameters:
 *       - in: query
 *         name: mergeStrategy
 *         schema:
 *           type: string
 *           enum: [skip, update]
 *           default: skip
 *     responses:
 *       200:
 *         description: Import results
 */
router.post('/categories/import', authenticateUser, authorizeRole(['admin']), async (req, res, next) => {
  try {
    const data = req.body;
    const { mergeStrategy = 'skip' } = req.query;

    if (!data || !data.categories) {
      return res.status(400).json({ error: 'Invalid import data' });
    }

    const result = await req.app.locals.categorizationService.categoryManager.importCategories(
      data,
      mergeStrategy
    );

    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/categories/stats:
 *   get:
 *     summary: Get global category statistics
 *     tags: [Categorization]
 *     responses:
 *       200:
 *         description: Category statistics
 */
router.get('/categories/stats', authenticateUser, async (req, res, next) => {
  try {
    const stats = await req.app.locals.categorizationService.categoryManager.getCategoryStats();

    res.json(stats);
  } catch (error) {
    next(error);
  }
});

module.exports = router;