const { EventEmitter } = require('events');
const logger = require('../utils/logger');

/**
 * Manages hierarchical category structures and operations
 */
class CategoryManager extends EventEmitter {
  constructor(database) {
    super();
    this.db = database;
    this.categoryCache = new Map();
    this.hierarchyCache = new Map();
  }

  /**
   * Initialize the category manager
   */
  async initialize() {
    try {
      await this.loadCategories();
      logger.info('CategoryManager initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize CategoryManager:', error);
      throw error;
    }
  }

  /**
   * Load all categories into cache
   */
  async loadCategories() {
    const query = `
      SELECT c.*, 
             pc.name as parent_name,
             COUNT(DISTINCT cc.id) as child_count,
             COUNT(DISTINCT dc.document_id) as document_count
      FROM categories c
      LEFT JOIN categories pc ON c.parent_id = pc.id
      LEFT JOIN categories cc ON cc.parent_id = c.id
      LEFT JOIN document_categories dc ON dc.category_id = c.id
      GROUP BY c.id, pc.name
      ORDER BY c.path
    `;

    const results = await this.db.query(query);
    
    this.categoryCache.clear();
    this.hierarchyCache.clear();

    for (const category of results.rows) {
      this.categoryCache.set(category.id, category);
      
      // Build hierarchy cache
      if (!category.parent_id) {
        if (!this.hierarchyCache.has('root')) {
          this.hierarchyCache.set('root', []);
        }
        this.hierarchyCache.get('root').push(category.id);
      } else {
        if (!this.hierarchyCache.has(category.parent_id)) {
          this.hierarchyCache.set(category.parent_id, []);
        }
        this.hierarchyCache.get(category.parent_id).push(category.id);
      }
    }
  }

  /**
   * Create a new category
   */
  async createCategory({ name, description, parentId = null, metadata = {}, rules = [] }) {
    const client = await this.db.getClient();
    
    try {
      await client.query('BEGIN');

      // Validate parent if provided
      let path = name;
      let depth = 0;
      
      if (parentId) {
        const parent = await this.getCategory(parentId);
        if (!parent) {
          throw new Error('Parent category not found');
        }
        path = `${parent.path}/${name}`;
        depth = parent.depth + 1;
      }

      // Check for duplicate paths
      const existing = await client.query(
        'SELECT id FROM categories WHERE path = $1',
        [path]
      );

      if (existing.rows.length > 0) {
        throw new Error('Category with this path already exists');
      }

      // Insert category
      const insertQuery = `
        INSERT INTO categories (name, description, parent_id, path, depth, metadata, is_active)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
      `;

      const result = await client.query(insertQuery, [
        name,
        description,
        parentId,
        path,
        depth,
        JSON.stringify(metadata),
        true
      ]);

      const category = result.rows[0];

      // Insert rules if provided
      if (rules.length > 0) {
        for (const rule of rules) {
          await this.addCategoryRule(category.id, rule, client);
        }
      }

      await client.query('COMMIT');

      // Update cache
      await this.loadCategories();

      this.emit('categoryCreated', category);
      return category;

    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Failed to create category:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Update an existing category
   */
  async updateCategory(categoryId, updates) {
    const client = await this.db.getClient();

    try {
      await client.query('BEGIN');

      const category = await this.getCategory(categoryId);
      if (!category) {
        throw new Error('Category not found');
      }

      // Build update query dynamically
      const updateFields = [];
      const values = [];
      let paramCount = 1;

      if (updates.name !== undefined) {
        updateFields.push(`name = $${paramCount++}`);
        values.push(updates.name);
        
        // Update path if name changed
        if (updates.name !== category.name) {
          const newPath = category.parent_id 
            ? `${category.path.replace(/\/[^/]+$/, '')}/${updates.name}`
            : updates.name;
          updateFields.push(`path = $${paramCount++}`);
          values.push(newPath);
          
          // Update all child paths
          await this.updateChildPaths(categoryId, category.path, newPath, client);
        }
      }

      if (updates.description !== undefined) {
        updateFields.push(`description = $${paramCount++}`);
        values.push(updates.description);
      }

      if (updates.metadata !== undefined) {
        updateFields.push(`metadata = $${paramCount++}`);
        values.push(JSON.stringify(updates.metadata));
      }

      if (updates.is_active !== undefined) {
        updateFields.push(`is_active = $${paramCount++}`);
        values.push(updates.is_active);
      }

      values.push(categoryId);

      const updateQuery = `
        UPDATE categories 
        SET ${updateFields.join(', ')}, updated_at = CURRENT_TIMESTAMP
        WHERE id = $${paramCount}
        RETURNING *
      `;

      const result = await client.query(updateQuery, values);
      
      await client.query('COMMIT');

      // Update cache
      await this.loadCategories();

      this.emit('categoryUpdated', result.rows[0]);
      return result.rows[0];

    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Failed to update category:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Delete a category and optionally reassign documents
   */
  async deleteCategory(categoryId, reassignTo = null) {
    const client = await this.db.getClient();

    try {
      await client.query('BEGIN');

      const category = await this.getCategory(categoryId);
      if (!category) {
        throw new Error('Category not found');
      }

      // Check for child categories
      const children = await client.query(
        'SELECT COUNT(*) FROM categories WHERE parent_id = $1',
        [categoryId]
      );

      if (parseInt(children.rows[0].count) > 0) {
        throw new Error('Cannot delete category with child categories');
      }

      // Reassign or remove document associations
      if (reassignTo) {
        await client.query(
          'UPDATE document_categories SET category_id = $1 WHERE category_id = $2',
          [reassignTo, categoryId]
        );
      } else {
        await client.query(
          'DELETE FROM document_categories WHERE category_id = $1',
          [categoryId]
        );
      }

      // Delete category rules
      await client.query(
        'DELETE FROM category_rules WHERE category_id = $1',
        [categoryId]
      );

      // Delete category
      await client.query(
        'DELETE FROM categories WHERE id = $1',
        [categoryId]
      );

      await client.query('COMMIT');

      // Update cache
      await this.loadCategories();

      this.emit('categoryDeleted', categoryId);
      return true;

    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Failed to delete category:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get a single category by ID
   */
  async getCategory(categoryId) {
    if (this.categoryCache.has(categoryId)) {
      return this.categoryCache.get(categoryId);
    }

    const result = await this.db.query(
      'SELECT * FROM categories WHERE id = $1',
      [categoryId]
    );

    return result.rows[0];
  }

  /**
   * Get all categories with optional filtering
   */
  async getCategories({ parentId = null, isActive = null, depth = null } = {}) {
    let query = 'SELECT * FROM categories WHERE 1=1';
    const params = [];

    if (parentId !== null) {
      params.push(parentId);
      query += ` AND parent_id ${parentId === 'root' ? 'IS NULL' : `= $${params.length}`}`;
    }

    if (isActive !== null) {
      params.push(isActive);
      query += ` AND is_active = $${params.length}`;
    }

    if (depth !== null) {
      params.push(depth);
      query += ` AND depth = $${params.length}`;
    }

    query += ' ORDER BY path';

    const result = await this.db.query(query, params);
    return result.rows;
  }

  /**
   * Get category hierarchy
   */
  async getCategoryHierarchy(rootId = null) {
    const buildHierarchy = (parentId) => {
      const children = this.hierarchyCache.get(parentId || 'root') || [];
      
      return children.map(childId => {
        const category = this.categoryCache.get(childId);
        return {
          ...category,
          children: buildHierarchy(childId)
        };
      });
    };

    if (rootId) {
      const root = this.categoryCache.get(rootId);
      if (!root) return null;
      
      return {
        ...root,
        children: buildHierarchy(rootId)
      };
    }

    return buildHierarchy(null);
  }

  /**
   * Get category path (ancestry)
   */
  async getCategoryPath(categoryId) {
    const path = [];
    let current = this.categoryCache.get(categoryId);

    while (current) {
      path.unshift(current);
      current = current.parent_id ? this.categoryCache.get(current.parent_id) : null;
    }

    return path;
  }

  /**
   * Add a categorization rule
   */
  async addCategoryRule(categoryId, rule, client = null) {
    const shouldRelease = !client;
    if (!client) {
      client = await this.db.getClient();
    }

    try {
      const insertQuery = `
        INSERT INTO category_rules (category_id, rule_type, pattern, confidence, metadata)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      `;

      const result = await client.query(insertQuery, [
        categoryId,
        rule.type,
        rule.pattern,
        rule.confidence || 0.8,
        JSON.stringify(rule.metadata || {})
      ]);

      return result.rows[0];

    } finally {
      if (shouldRelease) {
        client.release();
      }
    }
  }

  /**
   * Get rules for a category
   */
  async getCategoryRules(categoryId) {
    const result = await this.db.query(
      'SELECT * FROM category_rules WHERE category_id = $1 AND is_active = true ORDER BY confidence DESC',
      [categoryId]
    );

    return result.rows;
  }

  /**
   * Search categories by name or description
   */
  async searchCategories(searchTerm, limit = 20) {
    const result = await this.db.query(
      `SELECT * FROM categories 
       WHERE (name ILIKE $1 OR description ILIKE $1)
       AND is_active = true
       ORDER BY 
         CASE 
           WHEN name ILIKE $2 THEN 0
           ELSE 1
         END,
         depth,
         name
       LIMIT $3`,
      [`%${searchTerm}%`, `${searchTerm}%`, limit]
    );

    return result.rows;
  }

  /**
   * Get category statistics
   */
  async getCategoryStats(categoryId = null) {
    if (categoryId) {
      const query = `
        SELECT 
          c.*,
          COUNT(DISTINCT dc.document_id) as document_count,
          COUNT(DISTINCT cc.id) as child_count,
          AVG(dc.confidence) as avg_confidence,
          COUNT(DISTINCT cr.id) as rule_count
        FROM categories c
        LEFT JOIN document_categories dc ON dc.category_id = c.id
        LEFT JOIN categories cc ON cc.parent_id = c.id
        LEFT JOIN category_rules cr ON cr.category_id = c.id
        WHERE c.id = $1
        GROUP BY c.id
      `;

      const result = await this.db.query(query, [categoryId]);
      return result.rows[0];
    }

    // Global statistics
    const query = `
      SELECT 
        COUNT(DISTINCT c.id) as total_categories,
        COUNT(DISTINCT CASE WHEN c.parent_id IS NULL THEN c.id END) as root_categories,
        MAX(c.depth) as max_depth,
        COUNT(DISTINCT dc.document_id) as categorized_documents,
        AVG(dc.confidence) as avg_confidence
      FROM categories c
      LEFT JOIN document_categories dc ON dc.category_id = c.id
      WHERE c.is_active = true
    `;

    const result = await this.db.query(query);
    return result.rows[0];
  }

  /**
   * Update child paths recursively
   */
  async updateChildPaths(parentId, oldPath, newPath, client) {
    const children = await client.query(
      'SELECT id, path FROM categories WHERE parent_id = $1',
      [parentId]
    );

    for (const child of children.rows) {
      const newChildPath = child.path.replace(oldPath, newPath);
      
      await client.query(
        'UPDATE categories SET path = $1 WHERE id = $2',
        [newChildPath, child.id]
      );

      // Recursively update grandchildren
      await this.updateChildPaths(child.id, child.path, newChildPath, client);
    }
  }

  /**
   * Export category structure
   */
  async exportCategories() {
    const hierarchy = await this.getCategoryHierarchy();
    const rules = await this.db.query(
      'SELECT cr.*, c.path FROM category_rules cr JOIN categories c ON cr.category_id = c.id'
    );

    return {
      version: '1.0',
      exported_at: new Date().toISOString(),
      categories: hierarchy,
      rules: rules.rows
    };
  }

  /**
   * Import category structure
   */
  async importCategories(data, mergeStrategy = 'skip') {
    const client = await this.db.getClient();

    try {
      await client.query('BEGIN');

      const importCategory = async (category, parentId = null) => {
        // Check if category exists
        const existing = await client.query(
          'SELECT id FROM categories WHERE path = $1',
          [category.path]
        );

        let categoryId;

        if (existing.rows.length > 0) {
          if (mergeStrategy === 'skip') {
            categoryId = existing.rows[0].id;
          } else if (mergeStrategy === 'update') {
            const result = await client.query(
              `UPDATE categories 
               SET name = $1, description = $2, metadata = $3, updated_at = CURRENT_TIMESTAMP
               WHERE id = $4
               RETURNING id`,
              [category.name, category.description, JSON.stringify(category.metadata), existing.rows[0].id]
            );
            categoryId = result.rows[0].id;
          }
        } else {
          const result = await client.query(
            `INSERT INTO categories (name, description, parent_id, path, depth, metadata, is_active)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING id`,
            [category.name, category.description, parentId, category.path, category.depth, JSON.stringify(category.metadata), true]
          );
          categoryId = result.rows[0].id;
        }

        // Import children recursively
        if (category.children && category.children.length > 0) {
          for (const child of category.children) {
            await importCategory(child, categoryId);
          }
        }

        return categoryId;
      };

      // Import categories
      for (const category of data.categories) {
        await importCategory(category);
      }

      // Import rules if provided
      if (data.rules && data.rules.length > 0) {
        for (const rule of data.rules) {
          const categoryResult = await client.query(
            'SELECT id FROM categories WHERE path = $1',
            [rule.path]
          );

          if (categoryResult.rows.length > 0) {
            await this.addCategoryRule(categoryResult.rows[0].id, rule, client);
          }
        }
      }

      await client.query('COMMIT');
      await this.loadCategories();

      return { success: true, imported: data.categories.length };

    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Failed to import categories:', error);
      throw error;
    } finally {
      client.release();
    }
  }
}

module.exports = CategoryManager;