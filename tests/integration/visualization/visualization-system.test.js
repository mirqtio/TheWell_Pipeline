const request = require('supertest');
const app = require('../../../src/web/app');
const DatabaseManager = require('../../../src/database/DatabaseManager');
const { setupTestDatabase, cleanupTestDatabase } = require('../../helpers/database');

describe('Visualization System Integration Tests', () => {
  let authToken;
  let testUserId;
  let db;

  beforeAll(async () => {
    await setupTestDatabase();
    db = new DatabaseManager();
    await db.initialize();

    // Create test user and get auth token
    const userResult = await db.query('users', {
      create: {
        username: 'testuser',
        email: 'test@example.com',
        password_hash: 'hashed_password',
        role: 'admin'
      }
    });
    testUserId = userResult.id;

    // Mock auth token
    authToken = 'test-auth-token';
  });

  afterAll(async () => {
    await cleanupTestDatabase();
    if (db) {
      await db.close();
    }
  });

  beforeEach(async () => {
    // Clear visualization-related tables
    await db.query('DELETE FROM dashboard_views');
    await db.query('DELETE FROM dashboard_shares');
    await db.query('DELETE FROM visualization_dashboards');
    await db.query('DELETE FROM saved_visualizations');
  });

  describe('Visualization Types API', () => {
    it('should return supported visualization types', async () => {
      const response = await request(app)
        .get('/api/visualizations/types')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.types).toBeInstanceOf(Array);
      
      const types = response.body.types.map(t => t.type);
      expect(types).toContain('chart');
      expect(types).toContain('network');
      expect(types).toContain('heatmap');
      expect(types).toContain('treemap');
      expect(types).toContain('wordcloud');
      expect(types).toContain('timeline');
      expect(types).toContain('geomap');
    });
  });

  describe('Visualization Data API', () => {
    beforeEach(async () => {
      // Insert test documents
      await db.query('documents', {
        create: [
          {
            id: 'doc1',
            source_id: 'source1',
            title: 'Test Document 1',
            content: 'This is a test document',
            status: 'processed',
            metadata: {
              entities: [
                { id: 'e1', name: 'Entity 1', type: 'person' },
                { id: 'e2', name: 'Entity 2', type: 'organization' }
              ],
              category: 'Tech'
            },
            created_at: new Date('2024-01-01')
          },
          {
            id: 'doc2',
            source_id: 'source1',
            title: 'Test Document 2',
            content: 'Another test document',
            status: 'processed',
            metadata: {
              entities: [
                { id: 'e1', name: 'Entity 1', type: 'person' },
                { id: 'e3', name: 'Entity 3', type: 'location' }
              ],
              category: 'Business'
            },
            created_at: new Date('2024-01-02')
          }
        ]
      });
    });

    it('should fetch network visualization data', async () => {
      const response = await request(app)
        .get('/api/visualizations/data/network')
        .query({
          source: 'documents',
          filters: JSON.stringify({}),
          limit: 10
        })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.type).toBe('network');
      expect(response.body.data).toHaveProperty('nodes');
      expect(response.body.data).toHaveProperty('links');
      expect(response.body.data.nodes.length).toBeGreaterThan(0);
    });

    it('should fetch chart visualization data', async () => {
      const response = await request(app)
        .get('/api/visualizations/data/chart')
        .query({
          source: 'documents',
          options: JSON.stringify({
            xField: 'created_at',
            yField: 'value',
            chartType: 'line'
          })
        })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.type).toBe('chart');
      expect(response.body.data).toHaveProperty('labels');
      expect(response.body.data).toHaveProperty('datasets');
    });

    it('should apply filters to data', async () => {
      const response = await request(app)
        .get('/api/visualizations/data/chart')
        .query({
          source: 'documents',
          filters: JSON.stringify({
            dateRange: {
              start: '2024-01-01',
              end: '2024-01-01'
            }
          })
        })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.labels).toHaveLength(1);
    });
  });

  describe('Aggregation Pipelines', () => {
    it('should execute document stats aggregation', async () => {
      const response = await request(app)
        .get('/api/visualizations/aggregations/documentStats')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.pipeline).toBe('documentStats');
      expect(response.body.data).toHaveProperty('total');
      expect(response.body.data).toHaveProperty('byStatus');
      expect(response.body.data).toHaveProperty('bySource');
      expect(response.body.data).toHaveProperty('timeline');
    });

    it('should execute temporal distribution aggregation', async () => {
      const response = await request(app)
        .get('/api/visualizations/aggregations/temporalDistribution')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('hourly');
      expect(response.body.data).toHaveProperty('daily');
      expect(response.body.data).toHaveProperty('monthly');
      expect(response.body.data.hourly).toHaveLength(24);
      expect(response.body.data.daily).toHaveLength(7);
      expect(response.body.data.monthly).toHaveLength(12);
    });

    it('should execute category breakdown aggregation', async () => {
      const response = await request(app)
        .get('/api/visualizations/aggregations/categoryBreakdown')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('flat');
      expect(response.body.data).toHaveProperty('hierarchical');
      expect(response.body.data.flat).toHaveProperty('Tech');
      expect(response.body.data.flat).toHaveProperty('Business');
    });
  });

  describe('Dashboard Management', () => {
    it('should create a new dashboard', async () => {
      const dashboardData = {
        name: 'Test Dashboard',
        description: 'A test visualization dashboard',
        layout: { columns: 12, rowHeight: 200 },
        widgets: [
          {
            id: 'widget1',
            type: 'chart',
            title: 'Test Chart',
            dataSource: 'documents',
            position: { x: 0, y: 0, w: 4, h: 2 }
          }
        ]
      };

      const response = await request(app)
        .post('/api/visualizations/dashboards')
        .set('Authorization', `Bearer ${authToken}`)
        .send(dashboardData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.dashboard).toHaveProperty('id');
      expect(response.body.dashboard.name).toBe('Test Dashboard');
    });

    it('should fetch user dashboards', async () => {
      // Create a dashboard first
      await db.query('visualization_dashboards', {
        create: {
          user_id: testUserId,
          name: 'My Dashboard',
          description: 'Test dashboard',
          layout: JSON.stringify({ columns: 12 }),
          widgets: JSON.stringify([])
        }
      });

      const response = await request(app)
        .get('/api/visualizations/dashboards')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.dashboards).toHaveLength(1);
      expect(response.body.dashboards[0].name).toBe('My Dashboard');
    });

    it('should update an existing dashboard', async () => {
      // Create a dashboard
      const dashboard = await db.query('visualization_dashboards', {
        create: {
          user_id: testUserId,
          name: 'Original Name',
          description: 'Original description',
          layout: JSON.stringify({ columns: 12 }),
          widgets: JSON.stringify([])
        }
      });

      const response = await request(app)
        .put(`/api/visualizations/dashboards/${dashboard.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'Updated Name',
          description: 'Updated description',
          layout: { columns: 16 },
          widgets: []
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('updated successfully');

      // Verify update
      const updated = await db.query('visualization_dashboards', {
        where: { id: dashboard.id }
      });
      expect(updated[0].name).toBe('Updated Name');
    });

    it('should delete a dashboard', async () => {
      // Create a dashboard
      const dashboard = await db.query('visualization_dashboards', {
        create: {
          user_id: testUserId,
          name: 'To Delete',
          description: 'Will be deleted',
          layout: JSON.stringify({ columns: 12 }),
          widgets: JSON.stringify([])
        }
      });

      const response = await request(app)
        .delete(`/api/visualizations/dashboards/${dashboard.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);

      // Verify deletion
      const deleted = await db.query('visualization_dashboards', {
        where: { id: dashboard.id }
      });
      expect(deleted).toHaveLength(0);
    });
  });

  describe('Dashboard Sharing', () => {
    it('should share a dashboard with another user', async () => {
      // Create another user
      const otherUser = await db.query('users', {
        create: {
          username: 'otheruser',
          email: 'other@example.com',
          password_hash: 'hashed_password',
          role: 'user'
        }
      });

      // Create a dashboard
      const dashboard = await db.query('visualization_dashboards', {
        create: {
          user_id: testUserId,
          name: 'Shared Dashboard',
          description: 'To be shared',
          layout: JSON.stringify({ columns: 12 }),
          widgets: JSON.stringify([])
        }
      });

      const response = await request(app)
        .post(`/api/visualizations/share/${dashboard.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          shareWith: otherUser.id,
          permission: 'view'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.share).toHaveProperty('id');

      // Verify share record
      const shares = await db.query('dashboard_shares', {
        where: { dashboard_id: dashboard.id }
      });
      expect(shares).toHaveLength(1);
      expect(shares[0].shared_with).toBe(otherUser.id);
    });
  });

  describe('Export Functionality', () => {
    it('should export visualization data as JSON', async () => {
      const data = {
        labels: ['A', 'B', 'C'],
        datasets: [{ data: [1, 2, 3] }]
      };

      const response = await request(app)
        .post('/api/visualizations/export')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          type: 'chart',
          data,
          format: 'json'
        })
        .expect(200);

      expect(response.headers['content-type']).toContain('application/json');
      expect(response.headers['content-disposition']).toContain('.json');
      expect(JSON.parse(response.text)).toEqual(data);
    });

    it('should export visualization data as CSV', async () => {
      const data = [
        { name: 'Item1', value: 10 },
        { name: 'Item2', value: 20 }
      ];

      const response = await request(app)
        .post('/api/visualizations/export')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          type: 'chart',
          data,
          format: 'csv'
        })
        .expect(200);

      expect(response.headers['content-type']).toContain('text/csv');
      expect(response.headers['content-disposition']).toContain('.csv');
      expect(response.text).toContain('name,value');
      expect(response.text).toContain('Item1,10');
    });
  });

  describe('Cache Management', () => {
    it('should clear visualization cache', async () => {
      const response = await request(app)
        .delete('/api/visualizations/cache')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('Cache cleared');
    });

    it('should clear cache with pattern', async () => {
      const response = await request(app)
        .delete('/api/visualizations/cache')
        .query({ pattern: 'network' })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('pattern: network');
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid visualization type', async () => {
      const response = await request(app)
        .get('/api/visualizations/data/invalid')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(500);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Failed to fetch visualization data');
    });

    it('should handle invalid aggregation pipeline', async () => {
      const response = await request(app)
        .get('/api/visualizations/aggregations/invalid')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(500);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Failed to execute aggregation pipeline');
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .get('/api/visualizations/types')
        .expect(401);

      expect(response.body.success).toBe(false);
    });
  });

  describe('Performance', () => {
    it('should handle large datasets efficiently', async () => {
      // Create many documents
      const documents = [];
      for (let i = 0; i < 1000; i++) {
        documents.push({
          id: `doc${i}`,
          source_id: 'source1',
          title: `Document ${i}`,
          content: `Content ${i}`,
          status: 'processed',
          metadata: {
            entities: [
              { id: `e${i % 10}`, name: `Entity ${i % 10}`, type: 'person' }
            ]
          },
          created_at: new Date(2024, 0, (i % 30) + 1)
        });
      }

      await db.query('documents', { create: documents });

      const startTime = Date.now();
      const response = await request(app)
        .get('/api/visualizations/data/network')
        .query({
          source: 'documents',
          limit: 1000
        })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      const duration = Date.now() - startTime;

      expect(response.body.success).toBe(true);
      expect(response.body.data.nodes.length).toBeLessThanOrEqual(10); // Unique entities
      expect(duration).toBeLessThan(5000); // Should complete within 5 seconds
    });

    it('should utilize caching for repeated requests', async () => {
      // First request - no cache
      const response1 = await request(app)
        .get('/api/visualizations/data/chart')
        .query({
          source: 'documents',
          filters: JSON.stringify({ status: 'processed' })
        })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response1.body.cached).toBe(false);

      // Second request - should be cached
      const startTime = Date.now();
      const response2 = await request(app)
        .get('/api/visualizations/data/chart')
        .query({
          source: 'documents',
          filters: JSON.stringify({ status: 'processed' })
        })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      const duration = Date.now() - startTime;

      expect(response2.body.data).toEqual(response1.body.data);
      expect(duration).toBeLessThan(100); // Cached response should be very fast
    });
  });
});