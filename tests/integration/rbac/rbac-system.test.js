const request = require('supertest');
const DatabaseManager = require('../../../src/database/DatabaseManager');
const app = require('../../../src/web/app');
const ApiKeyService = require('../../../src/services/ApiKeyService');
const PermissionService = require('../../../src/services/PermissionService');

describe('RBAC System Integration', () => {
  let db;
  let apiKeyService;
  let permissionService;
  let adminApiKey;
  let analystApiKey;
  let viewerApiKey;
  
  beforeAll(async () => {
    // Initialize database
    const dbManager = DatabaseManager.getInstance();
    db = await dbManager.getDatabase();
    
    // Initialize services
    apiKeyService = new ApiKeyService(db);
    permissionService = new PermissionService(db);
    
    // Run RBAC migration
    try {
      const migrationSQL = require('fs').readFileSync(
        require('path').join(__dirname, '../../../src/database/migrations/0006_add_rbac_system.sql'),
        'utf8'
      );
      
      // Execute migration in transaction
      await db.query('BEGIN');
      
      const statements = migrationSQL
        .split(';')
        .map(s => s.trim())
        .filter(s => s && !s.match(/^(BEGIN|COMMIT)/i));
      
      for (const statement of statements) {
        try {
          await db.query(statement);
        } catch (error) {
          if (!error.message.includes('already exists')) {
            throw error;
          }
        }
      }
      
      await db.query('COMMIT');
    } catch (error) {
      await db.query('ROLLBACK');
      console.error('Migration error:', error);
    }
    
    // Create test users with different roles
    const adminUser = await createTestUser('admin@test.com', 'Admin User', 'admin');
    const analystUser = await createTestUser('analyst@test.com', 'Analyst User', 'analyst');
    const viewerUser = await createTestUser('viewer@test.com', 'Viewer User', 'viewer');
    
    // Generate API keys for test users
    adminApiKey = await apiKeyService.generateApiKey(adminUser.id, 'Test Admin Key');
    analystApiKey = await apiKeyService.generateApiKey(analystUser.id, 'Test Analyst Key');
    viewerApiKey = await apiKeyService.generateApiKey(viewerUser.id, 'Test Viewer Key');
  });
  
  afterAll(async () => {
    // Cleanup test data
    await db.query('DELETE FROM api_keys WHERE name LIKE $1', ['Test%']);
    await db.query('DELETE FROM users WHERE email LIKE $1', ['%@test.com']);
    
    // Close database
    const dbManager = DatabaseManager.getInstance();
    await dbManager.close();
  });
  
  async function createTestUser(email, name, roleName) {
    // Get role ID
    const roleResult = await db.query('SELECT id FROM roles WHERE name = $1', [roleName]);
    const roleId = roleResult.rows[0].id;
    
    // Create user
    const userResult = await db.query(`
      INSERT INTO users (email, name, role_id)
      VALUES ($1, $2, $3)
      ON CONFLICT (email) DO UPDATE
      SET name = $2, role_id = $3
      RETURNING id
    `, [email, name, roleId]);
    
    return {
      id: userResult.rows[0].id,
      email,
      name,
      role: roleName
    };
  }
  
  describe('Authentication', () => {
    it('should reject requests without API key', async () => {
      const response = await request(app)
        .get('/api/v1/users/me')
        .expect(401);
      
      expect(response.body).toMatchObject({
        success: false,
        error: 'API key required'
      });
    });
    
    it('should reject invalid API key', async () => {
      const response = await request(app)
        .get('/api/v1/users/me')
        .set('x-api-key', 'invalid-key')
        .expect(401);
      
      expect(response.body).toMatchObject({
        success: false,
        error: 'Invalid or expired API key'
      });
    });
    
    it('should accept valid API key', async () => {
      const response = await request(app)
        .get('/api/v1/users/me')
        .set('x-api-key', adminApiKey.key)
        .expect(200);
      
      expect(response.body.success).toBe(true);
      expect(response.body.data).toMatchObject({
        email: 'admin@test.com',
        role: 'admin'
      });
    });
  });
  
  describe('Permission Enforcement', () => {
    it('should allow admin all permissions', async () => {
      // Admin can manage roles
      const response = await request(app)
        .get('/api/v1/roles')
        .set('x-api-key', adminApiKey.key)
        .expect(200);
      
      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeInstanceOf(Array);
    });
    
    it('should deny analyst role management', async () => {
      const response = await request(app)
        .get('/api/v1/roles')
        .set('x-api-key', analystApiKey.key)
        .expect(403);
      
      expect(response.body).toMatchObject({
        success: false,
        error: 'Insufficient permissions'
      });
    });
    
    it('should allow viewer document read', async () => {
      // Viewers can read documents
      const response = await request(app)
        .get('/api/v1/documents')
        .set('x-api-key', viewerApiKey.key);
      
      // Should not be 403 (might be 404 if no documents)
      expect(response.status).not.toBe(403);
    });
  });
  
  describe('API Key Management', () => {
    let newApiKey;
    
    it('should allow users to create API keys', async () => {
      const response = await request(app)
        .post('/api/v1/users/me/api-keys')
        .set('x-api-key', analystApiKey.key)
        .send({
          name: 'New Test Key',
          expiresIn: 3600
        })
        .expect(201);
      
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('key');
      expect(response.body.data).toHaveProperty('expires_at');
      
      newApiKey = response.body.data;
    });
    
    it('should list user API keys', async () => {
      const response = await request(app)
        .get('/api/v1/users/me/api-keys')
        .set('x-api-key', analystApiKey.key)
        .expect(200);
      
      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeInstanceOf(Array);
      expect(response.body.data.length).toBeGreaterThan(0);
    });
    
    it('should rotate API keys', async () => {
      const response = await request(app)
        .post(`/api/v1/users/me/api-keys/${newApiKey.id}/rotate`)
        .set('x-api-key', analystApiKey.key)
        .send({
          gracePeriodMinutes: 30
        })
        .expect(200);
      
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('key');
      expect(response.body.data.key).not.toBe(newApiKey.key);
    });
    
    it('should revoke API keys', async () => {
      const response = await request(app)
        .delete(`/api/v1/users/me/api-keys/${newApiKey.id}`)
        .set('x-api-key', analystApiKey.key)
        .expect(200);
      
      expect(response.body.success).toBe(true);
      
      // Verify key is revoked
      const validateResult = await apiKeyService.validateApiKey(newApiKey.key);
      expect(validateResult).toBe(false);
    });
  });
  
  describe('Role Management', () => {
    let customRoleId;
    
    it('should create custom role (admin only)', async () => {
      const response = await request(app)
        .post('/api/v1/roles')
        .set('x-api-key', adminApiKey.key)
        .send({
          name: 'custom-test-role',
          description: 'Test custom role',
          permissions: ['documents:read', 'reports:create']
        })
        .expect(201);
      
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('id');
      
      customRoleId = response.body.data.id;
    });
    
    it('should update role permissions', async () => {
      const response = await request(app)
        .put(`/api/v1/roles/${customRoleId}/permissions`)
        .set('x-api-key', adminApiKey.key)
        .send({
          permissions: ['documents:read', 'documents:update', 'reports:create']
        })
        .expect(200);
      
      expect(response.body.success).toBe(true);
    });
    
    it('should assign role to user', async () => {
      // Get viewer user ID
      const userResult = await db.query('SELECT id FROM users WHERE email = $1', ['viewer@test.com']);
      const userId = userResult.rows[0].id;
      
      const response = await request(app)
        .put(`/api/v1/users/${userId}/role`)
        .set('x-api-key', adminApiKey.key)
        .send({
          role: 'analyst'
        })
        .expect(200);
      
      expect(response.body.success).toBe(true);
    });
    
    it('should prevent deleting system roles', async () => {
      // Get admin role ID
      const roleResult = await db.query('SELECT id FROM roles WHERE name = $1', ['admin']);
      const adminRoleId = roleResult.rows[0].id;
      
      const response = await request(app)
        .delete(`/api/v1/roles/${adminRoleId}`)
        .set('x-api-key', adminApiKey.key)
        .expect(400);
      
      expect(response.body.error).toContain('Cannot delete system role');
    });
    
    it('should delete custom role', async () => {
      const response = await request(app)
        .delete(`/api/v1/roles/${customRoleId}`)
        .set('x-api-key', adminApiKey.key)
        .expect(200);
      
      expect(response.body.success).toBe(true);
    });
  });
  
  describe('Rate Limiting', () => {
    it('should rate limit API requests per key', async () => {
      // Create a rate limited endpoint
      const rateLimitedApp = require('express')();
      rateLimitedApp.use(require('body-parser').json());
      
      // Mock auth
      rateLimitedApp.use((req, res, next) => {
        req.apiKey = req.headers['x-api-key'];
        next();
      });
      
      // Apply rate limit
      const { rateLimit } = require('../../../src/web/middleware/rbac');
      rateLimitedApp.use(rateLimit({ max: 3, windowMs: 1000 }));
      
      rateLimitedApp.get('/test', (req, res) => {
        res.json({ success: true });
      });
      
      // Make requests
      for (let i = 0; i < 3; i++) {
        await request(rateLimitedApp)
          .get('/test')
          .set('x-api-key', 'test-key')
          .expect(200);
      }
      
      // Fourth request should be rate limited
      const response = await request(rateLimitedApp)
        .get('/test')
        .set('x-api-key', 'test-key')
        .expect(429);
      
      expect(response.body.error).toContain('Too many requests');
    });
  });
  
  describe('Permission Scenarios', () => {
    it('should handle resource wildcards', async () => {
      // Create role with document:* permission
      const roleResult = await db.query(`
        INSERT INTO roles (name, description, permissions)
        VALUES ($1, $2, $3)
        RETURNING id
      `, ['doc-manager', 'Document Manager', JSON.stringify(['documents:*'])]);
      
      const roleId = roleResult.rows[0].id;
      
      // Create user with this role
      const userResult = await db.query(`
        INSERT INTO users (email, name, role_id)
        VALUES ($1, $2, $3)
        RETURNING id
      `, ['docmanager@test.com', 'Doc Manager', roleId]);
      
      const userId = userResult.rows[0].id;
      
      // Check various document permissions
      const canCreate = await permissionService.checkPermission(userId, 'documents', 'create');
      const canDelete = await permissionService.checkPermission(userId, 'documents', 'delete');
      const cannotManageUsers = await permissionService.checkPermission(userId, 'users', 'create');
      
      expect(canCreate).toBe(true);
      expect(canDelete).toBe(true);
      expect(cannotManageUsers).toBe(false);
      
      // Cleanup
      await db.query('DELETE FROM users WHERE id = $1', [userId]);
      await db.query('DELETE FROM roles WHERE id = $1', [roleId]);
    });
  });
});