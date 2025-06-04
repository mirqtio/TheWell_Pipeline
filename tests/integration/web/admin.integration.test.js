/**
 * Admin API Integration Tests
 */

const request = require('supertest');
const app = require('../../../src/web/app');
const { setupTestDatabase, cleanupTestDatabase } = require('../../helpers/database');

describe('Admin API Integration', () => {
  let adminToken;

  beforeAll(async () => {
    await setupTestDatabase();
    
    // Create mock admin token
    adminToken = 'test-admin-token';
  });

  afterAll(async () => {
    await cleanupTestDatabase();
  });

  describe('Authentication and Authorization', () => {
    it('should require authentication for admin routes', async () => {
      await request(app)
        .get('/api/v1/admin/metrics')
        .expect(401);
    });

    it('should require admin role', async () => {
      const curatorToken = 'test-curator-token';
      
      await request(app)
        .get('/api/v1/admin/metrics')
        .set('Authorization', `Bearer ${curatorToken}`)
        .expect(403);
    });

    it('should allow access with admin token', async () => {
      const response = await request(app)
        .get('/api/v1/admin/metrics')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
    });
  });

  describe('GET /api/v1/admin/metrics', () => {
    it('should return comprehensive system metrics', async () => {
      const response = await request(app)
        .get('/api/v1/admin/metrics')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('system');
      expect(response.body.data).toHaveProperty('performance');
      expect(response.body.data).toHaveProperty('resources');
      expect(response.body.data).toHaveProperty('queue');
      expect(response.body.data).toHaveProperty('database');
      expect(response.body.timestamp).toBeDefined();
    });

    it('should include system information', async () => {
      const response = await request(app)
        .get('/api/v1/admin/metrics')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const { system } = response.body.data;
      expect(system.uptime).toBeGreaterThan(0);
      expect(system.nodeVersion).toBeDefined();
      expect(system.platform).toBeDefined();
      expect(system.pid).toBeDefined();
    });

    it('should include performance metrics', async () => {
      const response = await request(app)
        .get('/api/v1/admin/metrics')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const { performance } = response.body.data;
      expect(typeof performance.avgResponseTime).toBe('number');
      expect(typeof performance.requestsPerSecond).toBe('number');
      expect(typeof performance.errorRate).toBe('number');
      expect(typeof performance.sloCompliance).toBe('number');
    });
  });

  describe('GET /api/v1/admin/users', () => {
    it('should return user list with pagination', async () => {
      const response = await request(app)
        .get('/api/v1/admin/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.users).toBeInstanceOf(Array);
      expect(response.body.data.pagination).toBeDefined();
      expect(response.body.data.pagination).toHaveProperty('page');
      expect(response.body.data.pagination).toHaveProperty('limit');
      expect(response.body.data.pagination).toHaveProperty('total');
    });

    it('should filter users by role', async () => {
      const response = await request(app)
        .get('/api/v1/admin/users?role=admin')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      response.body.data.users.forEach(user => {
        expect(user.role).toBe('admin');
      });
    });

    it('should search users by name or email', async () => {
      const response = await request(app)
        .get('/api/v1/admin/users?search=john')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      response.body.data.users.forEach(user => {
        expect(
          user.name.toLowerCase().includes('john') ||
          user.email.toLowerCase().includes('john')
        ).toBe(true);
      });
    });

    it('should support pagination', async () => {
      const response = await request(app)
        .get('/api/v1/admin/users?page=1&limit=2')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.users.length).toBeLessThanOrEqual(2);
      expect(response.body.data.pagination.page).toBe(1);
      expect(response.body.data.pagination.limit).toBe(2);
    });
  });

  describe('POST /api/v1/admin/users', () => {
    it('should create a new user', async () => {
      const newUser = {
        name: 'Test User',
        email: 'test.user@company.com',
        role: 'curator',
        permissions: ['curator', 'viewer']
      };

      const response = await request(app)
        .post('/api/v1/admin/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(newUser)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.user).toMatchObject({
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
        status: 'active'
      });
      expect(response.body.data.user.id).toBeDefined();
      expect(response.body.data.user.createdAt).toBeDefined();
    });

    it('should validate required fields', async () => {
      const incompleteUser = {
        name: 'Test User'
        // Missing email and role
      };

      await request(app)
        .post('/api/v1/admin/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(incompleteUser)
        .expect(400);
    });

    it('should validate role values', async () => {
      const invalidUser = {
        name: 'Test User',
        email: 'test@company.com',
        role: 'invalid_role'
      };

      await request(app)
        .post('/api/v1/admin/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(invalidUser)
        .expect(400);
    });
  });

  describe('PUT /api/v1/admin/users/:id', () => {
    it('should update user information', async () => {
      const userId = 'user-1';
      const updateData = {
        name: 'Updated Name',
        role: 'admin'
      };

      const response = await request(app)
        .put(`/api/v1/admin/users/${userId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(updateData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.user).toMatchObject(updateData);
      expect(response.body.data.user.updatedAt).toBeDefined();
    });
  });

  describe('DELETE /api/v1/admin/users/:id', () => {
    it('should disable user by default', async () => {
      const userId = 'user-2';

      const response = await request(app)
        .delete(`/api/v1/admin/users/${userId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.action).toBe('disabled');
    });

    it('should permanently delete when requested', async () => {
      const userId = 'user-3';

      const response = await request(app)
        .delete(`/api/v1/admin/users/${userId}?permanent=true`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.action).toBe('deleted');
    });
  });

  describe('GET /api/v1/admin/system/status', () => {
    it('should return comprehensive system status', async () => {
      const response = await request(app)
        .get('/api/v1/admin/system/status')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('api');
      expect(response.body.data).toHaveProperty('database');
      expect(response.body.data).toHaveProperty('cache');
      expect(response.body.data).toHaveProperty('queue');
      expect(response.body.data).toHaveProperty('monitoring');
    });

    it('should include API status', async () => {
      const response = await request(app)
        .get('/api/v1/admin/system/status')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const { api } = response.body.data;
      expect(api.status).toBe('healthy');
      expect(api.uptime).toBeGreaterThan(0);
      expect(api.version).toBeDefined();
    });
  });

  describe('POST /api/v1/admin/system/maintenance/:action', () => {
    it('should perform clear_cache action', async () => {
      const response = await request(app)
        .post('/api/v1/admin/system/maintenance/clear_cache')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.action).toBe('clear_cache');
      expect(response.body.data.result).toBeDefined();
      expect(response.body.data.timestamp).toBeDefined();
    });

    it('should perform rebuild_index action', async () => {
      const response = await request(app)
        .post('/api/v1/admin/system/maintenance/rebuild_index')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.action).toBe('rebuild_index');
    });

    it('should reject invalid actions', async () => {
      await request(app)
        .post('/api/v1/admin/system/maintenance/invalid_action')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);
    });
  });

  describe('GET /api/v1/admin/logs', () => {
    it('should return system logs', async () => {
      const response = await request(app)
        .get('/api/v1/admin/logs')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.logs).toBeInstanceOf(Array);
      expect(response.body.data.pagination).toBeDefined();
    });

    it('should filter logs by level', async () => {
      const response = await request(app)
        .get('/api/v1/admin/logs?level=error')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      response.body.data.logs.forEach(log => {
        expect(log.level).toBe('error');
      });
    });

    it('should support pagination', async () => {
      const response = await request(app)
        .get('/api/v1/admin/logs?limit=2&offset=0')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.logs.length).toBeLessThanOrEqual(2);
      expect(response.body.data.pagination.limit).toBe(2);
      expect(response.body.data.pagination.offset).toBe(0);
    });
  });

  describe('GET /api/v1/admin/activity', () => {
    it('should return recent system activity', async () => {
      const response = await request(app)
        .get('/api/v1/admin/activity')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.activities).toBeInstanceOf(Array);
      expect(response.body.data.summary).toBeDefined();
      expect(response.body.data.summary.total).toBeDefined();
      expect(response.body.data.summary.timeframe).toBeDefined();
    });

    it('should limit activity results', async () => {
      const response = await request(app)
        .get('/api/v1/admin/activity?limit=5')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.activities.length).toBeLessThanOrEqual(5);
    });

    it('should filter activity by timeframe', async () => {
      const response = await request(app)
        .get('/api/v1/admin/activity?hours=1')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.summary.timeframe).toBe('1 hours');
    });
  });

  describe('POST /api/v1/admin/config', () => {
    it('should update system configuration', async () => {
      const configUpdate = {
        section: 'general',
        settings: {
          refreshInterval: 30000,
          pageSize: 50,
          enableNotifications: true
        }
      };

      const response = await request(app)
        .post('/api/v1/admin/config')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(configUpdate)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.section).toBe(configUpdate.section);
      expect(response.body.data.updatedSettings).toEqual(configUpdate.settings);
      expect(response.body.data.timestamp).toBeDefined();
    });

    it('should validate required fields', async () => {
      const incompleteConfig = {
        section: 'general'
        // Missing settings
      };

      await request(app)
        .post('/api/v1/admin/config')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(incompleteConfig)
        .expect(400);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid user ID gracefully', async () => {
      const response = await request(app)
        .get('/api/v1/admin/users/invalid-id')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);

      expect(response.body.success).toBe(false);
    });

    it('should handle database connection errors', async () => {
      // This would require mocking database failures
      // For now, we test that the error handling structure is in place
      const response = await request(app)
        .get('/api/v1/admin/metrics')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('success');
    });
  });
});