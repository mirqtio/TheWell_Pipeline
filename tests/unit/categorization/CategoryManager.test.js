const CategoryManager = require('../../../src/categorization/CategoryManager');
const { EventEmitter } = require('events');

describe('CategoryManager', () => {
  let categoryManager;
  let mockDb;

  beforeEach(() => {
    mockDb = {
      query: jest.fn(),
      getClient: jest.fn()
    };

    categoryManager = new CategoryManager(mockDb);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('initialize', () => {
    it('should initialize successfully', async () => {
      mockDb.query.mockResolvedValue({ rows: [] });

      await categoryManager.initialize();

      expect(mockDb.query).toHaveBeenCalled();
      expect(categoryManager.categoryCache.size).toBe(0);
    });

    it('should handle initialization errors', async () => {
      mockDb.query.mockRejectedValue(new Error('DB error'));

      await expect(categoryManager.initialize()).rejects.toThrow('DB error');
    });
  });

  describe('createCategory', () => {
    let mockClient;

    beforeEach(() => {
      mockClient = {
        query: jest.fn(),
        release: jest.fn()
      };
      mockDb.getClient.mockResolvedValue(mockClient);
    });

    it('should create a root category', async () => {
      const categoryData = {
        name: 'Technology',
        description: 'Tech topics',
        metadata: { icon: 'tech' }
      };

      mockClient.query
        .mockResolvedValueOnce() // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // Check existing
        .mockResolvedValueOnce({ // INSERT
          rows: [{
            id: 1,
            name: 'Technology',
            path: 'Technology',
            depth: 0
          }]
        })
        .mockResolvedValueOnce(); // COMMIT

      mockDb.query.mockResolvedValue({ rows: [] }); // loadCategories

      const result = await categoryManager.createCategory(categoryData);

      expect(result).toEqual(expect.objectContaining({
        id: 1,
        name: 'Technology',
        path: 'Technology',
        depth: 0
      }));

      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should create a child category', async () => {
      categoryManager.categoryCache.set(1, {
        id: 1,
        name: 'Technology',
        path: 'Technology',
        depth: 0
      });

      const categoryData = {
        name: 'AI',
        description: 'Artificial Intelligence',
        parentId: 1
      };

      mockClient.query
        .mockResolvedValueOnce() // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // Check existing
        .mockResolvedValueOnce({ // INSERT
          rows: [{
            id: 2,
            name: 'AI',
            path: 'Technology/AI',
            depth: 1,
            parent_id: 1
          }]
        })
        .mockResolvedValueOnce(); // COMMIT

      mockDb.query.mockResolvedValue({ rows: [] }); // loadCategories

      const result = await categoryManager.createCategory(categoryData);

      expect(result.path).toBe('Technology/AI');
      expect(result.depth).toBe(1);
    });

    it('should handle duplicate categories', async () => {
      mockClient.query
        .mockResolvedValueOnce() // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // Existing found
        .mockResolvedValueOnce(); // ROLLBACK

      await expect(categoryManager.createCategory({
        name: 'Existing',
        description: 'Already exists'
      })).rejects.toThrow('Category with this path already exists');

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    });

    it('should create category with rules', async () => {
      const categoryData = {
        name: 'Programming',
        description: 'Programming topics',
        rules: [
          { type: 'contains', pattern: 'javascript,python,java', confidence: 0.8 },
          { type: 'regex', pattern: '\\b(code|coding|program)\\b', confidence: 0.7 }
        ]
      };

      mockClient.query
        .mockResolvedValueOnce() // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // Check existing
        .mockResolvedValueOnce({ // INSERT category
          rows: [{ id: 3, name: 'Programming' }]
        })
        .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // INSERT rule 1
        .mockResolvedValueOnce({ rows: [{ id: 2 }] }) // INSERT rule 2
        .mockResolvedValueOnce(); // COMMIT

      mockDb.query.mockResolvedValue({ rows: [] }); // loadCategories

      const result = await categoryManager.createCategory(categoryData);

      expect(result.id).toBe(3);
      expect(mockClient.query).toHaveBeenCalledTimes(6);
    });
  });

  describe('updateCategory', () => {
    let mockClient;

    beforeEach(() => {
      mockClient = {
        query: jest.fn(),
        release: jest.fn()
      };
      mockDb.getClient.mockResolvedValue(mockClient);

      categoryManager.categoryCache.set(1, {
        id: 1,
        name: 'OldName',
        path: 'OldName',
        description: 'Old description',
        parent_id: null,
        depth: 0
      });
    });

    it('should update category name and path', async () => {
      mockClient.query
        .mockResolvedValueOnce() // BEGIN
        .mockResolvedValueOnce() // Update child paths (none)
        .mockResolvedValueOnce({ // UPDATE
          rows: [{
            id: 1,
            name: 'NewName',
            path: 'NewName'
          }]
        })
        .mockResolvedValueOnce(); // COMMIT

      mockDb.query.mockResolvedValue({ rows: [] }); // loadCategories

      const result = await categoryManager.updateCategory(1, {
        name: 'NewName'
      });

      expect(result.name).toBe('NewName');
      expect(result.path).toBe('NewName');
    });

    it('should update category metadata', async () => {
      const newMetadata = { icon: 'new-icon', color: 'blue' };

      mockClient.query
        .mockResolvedValueOnce() // BEGIN
        .mockResolvedValueOnce({ // UPDATE
          rows: [{
            id: 1,
            metadata: newMetadata
          }]
        })
        .mockResolvedValueOnce(); // COMMIT

      mockDb.query.mockResolvedValue({ rows: [] }); // loadCategories

      const result = await categoryManager.updateCategory(1, {
        metadata: newMetadata
      });

      expect(result.metadata).toEqual(newMetadata);
    });

    it('should handle non-existent category', async () => {
      mockClient.query.mockResolvedValueOnce(); // BEGIN

      await expect(categoryManager.updateCategory(999, {
        name: 'NewName'
      })).rejects.toThrow('Category not found');
    });
  });

  describe('deleteCategory', () => {
    let mockClient;

    beforeEach(() => {
      mockClient = {
        query: jest.fn(),
        release: jest.fn()
      };
      mockDb.getClient.mockResolvedValue(mockClient);

      categoryManager.categoryCache.set(1, {
        id: 1,
        name: 'ToDelete'
      });
    });

    it('should delete category without children', async () => {
      mockClient.query
        .mockResolvedValueOnce() // BEGIN
        .mockResolvedValueOnce({ rows: [{ count: '0' }] }) // No children
        .mockResolvedValueOnce() // Delete document associations
        .mockResolvedValueOnce() // Delete rules
        .mockResolvedValueOnce() // Delete category
        .mockResolvedValueOnce(); // COMMIT

      mockDb.query.mockResolvedValue({ rows: [] }); // loadCategories

      const result = await categoryManager.deleteCategory(1);

      expect(result).toBe(true);
      expect(mockClient.query).toHaveBeenCalledWith(
        'DELETE FROM categories WHERE id = $1',
        [1]
      );
    });

    it('should reassign documents when deleting', async () => {
      mockClient.query
        .mockResolvedValueOnce() // BEGIN
        .mockResolvedValueOnce({ rows: [{ count: '0' }] }) // No children
        .mockResolvedValueOnce() // Reassign documents
        .mockResolvedValueOnce() // Delete rules
        .mockResolvedValueOnce() // Delete category
        .mockResolvedValueOnce(); // COMMIT

      mockDb.query.mockResolvedValue({ rows: [] }); // loadCategories

      await categoryManager.deleteCategory(1, 2);

      expect(mockClient.query).toHaveBeenCalledWith(
        'UPDATE document_categories SET category_id = $1 WHERE category_id = $2',
        [2, 1]
      );
    });

    it('should prevent deletion of category with children', async () => {
      mockClient.query
        .mockResolvedValueOnce() // BEGIN
        .mockResolvedValueOnce({ rows: [{ count: '5' }] }) // Has children
        .mockResolvedValueOnce(); // ROLLBACK

      await expect(categoryManager.deleteCategory(1)).rejects.toThrow(
        'Cannot delete category with child categories'
      );
    });
  });

  describe('getCategoryHierarchy', () => {
    beforeEach(() => {
      // Set up a simple hierarchy
      categoryManager.categoryCache.set(1, {
        id: 1,
        name: 'Root1',
        parent_id: null
      });
      categoryManager.categoryCache.set(2, {
        id: 2,
        name: 'Root2',
        parent_id: null
      });
      categoryManager.categoryCache.set(3, {
        id: 3,
        name: 'Child1',
        parent_id: 1
      });
      categoryManager.categoryCache.set(4, {
        id: 4,
        name: 'Grandchild1',
        parent_id: 3
      });

      categoryManager.hierarchyCache.set('root', [1, 2]);
      categoryManager.hierarchyCache.set(1, [3]);
      categoryManager.hierarchyCache.set(3, [4]);
    });

    it('should return full hierarchy', async () => {
      const hierarchy = await categoryManager.getCategoryHierarchy();

      expect(hierarchy).toHaveLength(2);
      expect(hierarchy[0].name).toBe('Root1');
      expect(hierarchy[0].children).toHaveLength(1);
      expect(hierarchy[0].children[0].name).toBe('Child1');
      expect(hierarchy[0].children[0].children).toHaveLength(1);
      expect(hierarchy[0].children[0].children[0].name).toBe('Grandchild1');
    });

    it('should return subtree hierarchy', async () => {
      const hierarchy = await categoryManager.getCategoryHierarchy(3);

      expect(hierarchy.name).toBe('Child1');
      expect(hierarchy.children).toHaveLength(1);
      expect(hierarchy.children[0].name).toBe('Grandchild1');
    });
  });

  describe('searchCategories', () => {
    it('should search categories by name', async () => {
      mockDb.query.mockResolvedValue({
        rows: [
          { id: 1, name: 'Machine Learning', path: 'Tech/AI/Machine Learning' },
          { id: 2, name: 'Deep Learning', path: 'Tech/AI/Deep Learning' }
        ]
      });

      const results = await categoryManager.searchCategories('learning');

      expect(results).toHaveLength(2);
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('ILIKE'),
        expect.arrayContaining(['%learning%', 'learning%', 20])
      );
    });
  });

  describe('getCategoryStats', () => {
    it('should get stats for specific category', async () => {
      mockDb.query.mockResolvedValue({
        rows: [{
          id: 1,
          document_count: '25',
          child_count: '3',
          avg_confidence: '0.85',
          rule_count: '5'
        }]
      });

      const stats = await categoryManager.getCategoryStats(1);

      expect(stats.document_count).toBe('25');
      expect(stats.avg_confidence).toBe('0.85');
    });

    it('should get global stats', async () => {
      mockDb.query.mockResolvedValue({
        rows: [{
          total_categories: '50',
          root_categories: '5',
          max_depth: '4',
          categorized_documents: '1000',
          avg_confidence: '0.78'
        }]
      });

      const stats = await categoryManager.getCategoryStats();

      expect(stats.total_categories).toBe('50');
      expect(stats.categorized_documents).toBe('1000');
    });
  });

  describe('importCategories', () => {
    let mockClient;

    beforeEach(() => {
      mockClient = {
        query: jest.fn(),
        release: jest.fn()
      };
      mockDb.getClient.mockResolvedValue(mockClient);
    });

    it('should import new categories', async () => {
      const importData = {
        version: '1.0',
        categories: [
          {
            name: 'Imported',
            path: 'Imported',
            depth: 0,
            metadata: {},
            children: []
          }
        ],
        rules: []
      };

      mockClient.query
        .mockResolvedValueOnce() // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // Check existing
        .mockResolvedValueOnce({ rows: [{ id: 10 }] }) // INSERT
        .mockResolvedValueOnce(); // COMMIT

      mockDb.query.mockResolvedValue({ rows: [] }); // loadCategories

      const result = await categoryManager.importCategories(importData);

      expect(result.success).toBe(true);
      expect(result.imported).toBe(1);
    });

    it('should skip existing categories with skip strategy', async () => {
      const importData = {
        version: '1.0',
        categories: [{
          name: 'Existing',
          path: 'Existing',
          depth: 0
        }]
      };

      mockClient.query
        .mockResolvedValueOnce() // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // Existing found
        .mockResolvedValueOnce(); // COMMIT

      mockDb.query.mockResolvedValue({ rows: [] }); // loadCategories

      const result = await categoryManager.importCategories(importData, 'skip');

      expect(result.success).toBe(true);
    });
  });
});