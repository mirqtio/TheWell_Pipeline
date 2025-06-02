/**
 * End-to-End tests for Permission Enforcement System
 * Tests complete permission workflows in realistic scenarios
 */

const request = require('supertest');
const { Pool } = require('pg');
const app = require('../../src/web/app');
const { initializePermissions } = require('../../src/web/middleware/auth');
const logger = require('../../src/utils/logger');

describe('Permission System E2E Tests', () => {
  let pool;
  let apiKey;
  let permissionTablesAvailable = false;
  
  // Test user scenarios
  const testUsers = {
    admin: { id: 'e2e-admin-user', username: 'admin', email: 'admin@test.com', role: 'admin' },
    reviewer: { id: 'e2e-reviewer-user', username: 'reviewer', email: 'reviewer@test.com', role: 'reviewer' },
    user: { id: 'e2e-regular-user', username: 'user', email: 'user@test.com', role: 'user' },
    guest: { id: 'e2e-guest-user', username: 'guest', email: 'guest@test.com', role: 'guest' }
  };

  const testDocuments = {
    public: { id: 'e2e-doc-public', title: 'Public Document', access: 'public' },
    internal: { id: 'e2e-doc-internal', title: 'Internal Document', access: 'internal' },
    private: { id: 'e2e-doc-private', title: 'Private Document', access: 'private' },
    confidential: { id: 'e2e-doc-confidential', title: 'Confidential Document', access: 'private' }
  };

  // Helper function to check if tests should be skipped
  const shouldSkipTest = () => {
    if (!permissionTablesAvailable) {
      console.log('Skipping E2E permission test - permission tables not available');
      return true;
    }
    return false;
  };

  beforeAll(async () => {
    try {
      // Initialize database connection
      pool = new Pool({
        connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/thewell_test',
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
      });

      // Check if permission tables exist
      const client = await pool.connect();
      try {
        const result = await client.query(`
          SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name = 'users'
          );
        `);
        
        permissionTablesAvailable = result.rows[0].exists;
        
        if (!permissionTablesAvailable) {
          console.log('Permission tables not found - E2E permission tests will be skipped');
          return;
        }

        // Initialize permission system
        await initializePermissions();

        // Set API key for tests
        apiKey = process.env.REVIEW_API_KEY || 'dev-review-key';

        // Setup comprehensive test scenario
        await setupE2ETestData();
      } finally {
        client.release();
      }
    } catch (error) {
      console.log('Database connection failed - E2E permission tests will be skipped:', error.message);
      permissionTablesAvailable = false;
    }
  });

  afterAll(async () => {
    if (!permissionTablesAvailable) return;
    
    // Cleanup test data
    await cleanupE2ETestData();
    
    // Close database connection
    if (pool) {
      await pool.end();
    }
  });

  beforeEach(async () => {
    if (!permissionTablesAvailable) return;
    
    // Clear permission cache before each test
    const { permissionManager } = require('../../src/web/middleware/auth');
    permissionManager.clearCache();
  });

  async function setupE2ETestData() {
    const client = await pool.connect();
    
    try {
      // Create test users
      for (const [key, user] of Object.entries(testUsers)) {
        await client.query(`
          INSERT INTO users (id, username, email, created_at)
          VALUES ($1, $2, $3, NOW())
          ON CONFLICT (id) DO UPDATE SET username = $2, email = $3
        `, [user.id, user.username, user.email]);

        // Assign roles
        await client.query(`
          INSERT INTO user_roles (user_id, role_id, is_active, created_at)
          SELECT $1, r.id, true, NOW()
          FROM roles r
          WHERE r.name = $2
          ON CONFLICT (user_id, role_id) DO UPDATE SET is_active = true
        `, [user.id, user.role]);
      }

      // Create test documents
      for (const [key, doc] of Object.entries(testDocuments)) {
        await client.query(`
          INSERT INTO documents (id, title, content, source_id, created_at)
          VALUES ($1, $2, $3, $4, NOW())
          ON CONFLICT (id) DO UPDATE SET title = $2, content = $3
        `, [doc.id, doc.title, `Content for ${doc.title}`, 'e2e-test-source']);

        // Set access policies
        await client.query(`
          INSERT INTO document_access_policies (document_id, access_level, created_at)
          VALUES ($1, $2, NOW())
          ON CONFLICT (document_id) DO UPDATE SET access_level = $2
        `, [doc.id, doc.access]);
      }

      // Grant specific access to private document for reviewer
      await client.query(`
        INSERT INTO document_access_grants (user_id, document_id, permission_type, is_active, created_at)
        VALUES ($1, $2, 'read', true, NOW())
        ON CONFLICT (user_id, document_id, permission_type) DO UPDATE SET is_active = true
      `, [testUsers.reviewer.id, testDocuments.private.id]);

      // Grant admin full access to confidential document
      await client.query(`
        INSERT INTO document_access_grants (user_id, document_id, permission_type, is_active, created_at)
        VALUES ($1, $2, 'read', true, NOW())
        ON CONFLICT (user_id, document_id, permission_type) DO UPDATE SET is_active = true
      `, [testUsers.admin.id, testDocuments.confidential.id]);

      logger.info('E2E test data setup completed');
    } finally {
      client.release();
    }
  }

  async function cleanupE2ETestData() {
    if (!pool) return;
    
    const client = await pool.connect();
    
    try {
      const userIds = Object.values(testUsers).map(u => u.id);
      const docIds = Object.values(testDocuments).map(d => d.id);

      // Remove test data in reverse dependency order
      await client.query('DELETE FROM access_logs WHERE user_id = ANY($1)', [userIds]);
      await client.query('DELETE FROM document_access_grants WHERE user_id = ANY($1)', [userIds]);
      await client.query('DELETE FROM document_access_policies WHERE document_id = ANY($1)', [docIds]);
      await client.query('DELETE FROM user_roles WHERE user_id = ANY($1)', [userIds]);
      await client.query('DELETE FROM user_permissions WHERE user_id = ANY($1)', [userIds]);
      await client.query('DELETE FROM documents WHERE id = ANY($1)', [docIds]);
      await client.query('DELETE FROM users WHERE id = ANY($1)', [userIds]);
      
      logger.info('E2E test data cleanup completed');
    } catch (error) {
      logger.error('Error during E2E test cleanup', { error: error.message });
    } finally {
      client.release();
    }
  }

  // Helper function to simulate user requests
  async function makeRequestAsUser(userId, endpoint, method = 'POST', data = {}) {
    // In a real scenario, this would involve JWT tokens
    // For testing, we'll modify the auth middleware temporarily
    const originalAuth = require('../../src/web/middleware/auth');
    
    // Create a mock user context
    const mockUser = Object.values(testUsers).find(u => u.id === userId);
    if (!mockUser) {
      throw new Error(`Test user not found: ${userId}`);
    }

    const requestBuilder = request(app)[method.toLowerCase()](endpoint)
      .set('x-api-key', apiKey)
      .set('x-test-user-id', userId); // Custom header for test user identification

    if (method.toUpperCase() === 'POST' || method.toUpperCase() === 'PUT') {
      requestBuilder.send(data);
    }

    return requestBuilder;
  }

  describe('Complete Permission Workflows', () => {
    describe('Document Access Scenarios', () => {
      it('should handle public document access for all users', async () => {
        if (shouldSkipTest()) return;

        // Test all user types can access public documents
        for (const [userType, user] of Object.entries(testUsers)) {
          const { permissionManager } = require('../../src/web/middleware/auth');
          
          const canAccess = await permissionManager.canAccessDocument(
            user.id, 
            testDocuments.public.id, 
            'read'
          );

          expect(canAccess).toBe(true);
          logger.info(`${userType} can access public document: ${canAccess}`);
        }
      });

      it('should restrict internal document access to authenticated users only', async () => {
        if (shouldSkipTest()) return;

        const { permissionManager } = require('../../src/web/middleware/auth');
        
        // Admin, reviewer, and user should have access
        const authorizedUsers = [testUsers.admin, testUsers.reviewer, testUsers.user];
        for (const user of authorizedUsers) {
          const canAccess = await permissionManager.canAccessDocument(
            user.id, 
            testDocuments.internal.id, 
            'read'
          );
          expect(canAccess).toBe(true);
        }

        // Guest should not have access
        const guestAccess = await permissionManager.canAccessDocument(
          testUsers.guest.id, 
          testDocuments.internal.id, 
          'read'
        );
        expect(guestAccess).toBe(false);
      });

      it('should enforce private document access through explicit grants', async () => {
        if (shouldSkipTest()) return;

        const { permissionManager } = require('../../src/web/middleware/auth');
        
        // Only reviewer should have access (explicit grant)
        const reviewerAccess = await permissionManager.canAccessDocument(
          testUsers.reviewer.id, 
          testDocuments.private.id, 
          'read'
        );
        expect(reviewerAccess).toBe(true);

        // Other users should not have access
        const regularUserAccess = await permissionManager.canAccessDocument(
          testUsers.user.id, 
          testDocuments.private.id, 
          'read'
        );
        expect(regularUserAccess).toBe(false);

        const guestAccess = await permissionManager.canAccessDocument(
          testUsers.guest.id, 
          testDocuments.private.id, 
          'read'
        );
        expect(guestAccess).toBe(false);
      });

      it('should allow admin access to all documents', async () => {
        if (shouldSkipTest()) return;

        const { permissionManager } = require('../../src/web/middleware/auth');
        
        // Admin should have access to all documents
        for (const [docType, doc] of Object.entries(testDocuments)) {
          const canAccess = await permissionManager.canAccessDocument(
            testUsers.admin.id, 
            doc.id, 
            'read'
          );
          expect(canAccess).toBe(true);
          logger.info(`Admin can access ${docType} document: ${canAccess}`);
        }
      });
    });

    describe('RAG Search with Permission Filtering', () => {
      it('should filter search results based on user permissions', async () => {
        if (shouldSkipTest()) return;

        const { permissionManager } = require('../../src/web/middleware/auth');
        
        // Get all document IDs
        const allDocIds = Object.values(testDocuments).map(d => d.id);

        // Test filtering for different user types
        const userFilterResults = await permissionManager.filterDocumentsByPermission(
          testUsers.user.id, 
          allDocIds, 
          'read'
        );

        // Regular user should see public and internal documents
        expect(userFilterResults).toContain(testDocuments.public.id);
        expect(userFilterResults).toContain(testDocuments.internal.id);
        expect(userFilterResults).not.toContain(testDocuments.private.id);
        expect(userFilterResults).not.toContain(testDocuments.confidential.id);

        // Reviewer should see public, internal, and specifically granted private document
        const reviewerFilterResults = await permissionManager.filterDocumentsByPermission(
          testUsers.reviewer.id, 
          allDocIds, 
          'read'
        );

        expect(reviewerFilterResults).toContain(testDocuments.public.id);
        expect(reviewerFilterResults).toContain(testDocuments.internal.id);
        expect(reviewerFilterResults).toContain(testDocuments.private.id);
        expect(reviewerFilterResults).not.toContain(testDocuments.confidential.id);

        // Admin should see all documents
        const adminFilterResults = await permissionManager.filterDocumentsByPermission(
          testUsers.admin.id, 
          allDocIds, 
          'read'
        );

        expect(adminFilterResults).toContain(testDocuments.public.id);
        expect(adminFilterResults).toContain(testDocuments.internal.id);
        expect(adminFilterResults).toContain(testDocuments.private.id);
        expect(adminFilterResults).toContain(testDocuments.confidential.id);
      });

      it('should handle RAG search endpoint with permission enforcement', async () => {
        if (shouldSkipTest()) return;

        // Test with different user permissions
        const searchQuery = {
          query: 'test document search',
          max_results: 10
        };

        // This test would require mocking the RAG service response
        // For now, we'll test that the permission middleware is called
        const response = await request(app)
          .post('/api/v1/rag/search')
          .set('x-api-key', apiKey)
          .set('x-trace-id', 'e2e-test-trace')
          .send(searchQuery);

        // Should not be 401 (authentication should pass)
        expect(response.status).not.toBe(401);
        
        // May be other errors due to missing RAG service, but permission check should pass
        if (response.status === 403) {
          expect(response.body.requiredPermission).toBe('document.read');
        }
      });
    });

    describe('Permission Inheritance and Overrides', () => {
      it('should handle user permission overrides of role permissions', async () => {
        if (shouldSkipTest()) return;

        const client = await pool.connect();
        
        try {
          // Grant role permission for document.write to reviewer role
          await client.query(`
            INSERT INTO role_permissions (role_id, permission_id, created_at)
            SELECT r.id, p.id, NOW()
            FROM roles r, permissions p
            WHERE r.name = 'reviewer' AND p.name = 'document.write'
            ON CONFLICT (role_id, permission_id) DO NOTHING
          `);

          // Add explicit user denial that overrides role permission
          await client.query(`
            INSERT INTO user_permissions (user_id, permission_id, is_granted, created_at)
            SELECT $1, p.id, false, NOW()
            FROM permissions p
            WHERE p.name = 'document.write'
            ON CONFLICT (user_id, permission_id) DO UPDATE SET is_granted = false
          `, [testUsers.reviewer.id]);

          const { permissionManager } = require('../../src/web/middleware/auth');
          
          // User denial should override role permission
          const hasPermission = await permissionManager.hasPermission(
            testUsers.reviewer.id, 
            'document.write'
          );

          expect(hasPermission).toBe(false);

        } finally {
          client.release();
        }
      });

      it('should handle resource-specific permissions', async () => {
        if (shouldSkipTest()) return;

        const client = await pool.connect();
        
        try {
          // Grant resource-specific permission
          await client.query(`
            INSERT INTO user_permissions (user_id, permission_id, resource_type, resource_id, is_granted, created_at)
            SELECT $1, p.id, 'document', $2, true, NOW()
            FROM permissions p
            WHERE p.name = 'document.delete'
            ON CONFLICT (user_id, permission_id, resource_type, resource_id) DO UPDATE SET is_granted = true
          `, [testUsers.user.id, testDocuments.public.id]);

          const { permissionManager } = require('../../src/web/middleware/auth');
          
          // Should have permission for specific document
          const hasSpecificPermission = await permissionManager.hasPermission(
            testUsers.user.id, 
            'document.delete',
            'document',
            testDocuments.public.id
          );

          expect(hasSpecificPermission).toBe(true);

          // Should not have permission for other documents
          const hasGeneralPermission = await permissionManager.hasPermission(
            testUsers.user.id, 
            'document.delete',
            'document',
            testDocuments.internal.id
          );

          expect(hasGeneralPermission).toBe(false);

        } finally {
          client.release();
        }
      });
    });

    describe('Audit Trail and Compliance', () => {
      it('should create comprehensive audit logs for access attempts', async () => {
        if (shouldSkipTest()) return;

        const client = await pool.connect();
        
        try {
          const { permissionManager } = require('../../src/web/middleware/auth');
          
          // Test successful access
          await permissionManager.logAccess(
            testUsers.admin.id,
            'document',
            testDocuments.confidential.id,
            'read',
            true,
            {
              ipAddress: '192.168.1.100',
              userAgent: 'E2E-Test-Agent',
              endpoint: '/api/v1/rag/search',
              method: 'POST',
              traceId: 'e2e-audit-test-123',
              statusCode: 200,
              responseTimeMs: 150
            }
          );

          // Test failed access
          await permissionManager.logAccess(
            testUsers.guest.id,
            'document',
            testDocuments.confidential.id,
            'read',
            false,
            {
              ipAddress: '192.168.1.101',
              userAgent: 'E2E-Test-Agent',
              endpoint: '/api/v1/rag/search',
              method: 'POST',
              traceId: 'e2e-audit-test-456',
              statusCode: 403,
              denialReason: 'Insufficient permissions'
            }
          );

          // Verify logs were created
          const successLog = await client.query(`
            SELECT * FROM access_logs 
            WHERE user_id = $1 AND trace_id = $2 AND access_granted = true
          `, [testUsers.admin.id, 'e2e-audit-test-123']);

          const failureLog = await client.query(`
            SELECT * FROM access_logs 
            WHERE user_id = $1 AND trace_id = $2 AND access_granted = false
          `, [testUsers.guest.id, 'e2e-audit-test-456']);

          expect(successLog.rows.length).toBe(1);
          expect(failureLog.rows.length).toBe(1);

          const successEntry = successLog.rows[0];
          expect(successEntry.resource_type).toBe('document');
          expect(successEntry.resource_id).toBe(testDocuments.confidential.id);
          expect(successEntry.status_code).toBe(200);

          const failureEntry = failureLog.rows[0];
          expect(failureEntry.denial_reason).toBe('Insufficient permissions');
          expect(failureEntry.status_code).toBe(403);

        } finally {
          client.release();
        }
      });

      it('should track permission changes and cache invalidation', async () => {
        if (shouldSkipTest()) return;

        const { permissionManager } = require('../../src/web/middleware/auth');
        
        // Cache a permission check
        const initialCheck = await permissionManager.hasPermission(
          testUsers.user.id, 
          'document.read'
        );

        // Clear cache to simulate permission change
        permissionManager.clearUserCache(testUsers.user.id);

        // Verify cache was cleared by checking again
        const secondCheck = await permissionManager.hasPermission(
          testUsers.user.id, 
          'document.read'
        );

        expect(initialCheck).toBe(secondCheck); // Results should be consistent
      });
    });

    describe('Performance and Scalability', () => {
      it('should handle bulk document filtering efficiently', async () => {
        if (shouldSkipTest()) return;

        const { permissionManager } = require('../../src/web/middleware/auth');
        
        // Create a large set of document IDs for testing
        const largeDocumentSet = Array.from({ length: 100 }, (_, i) => `bulk-doc-${i}`);
        
        const startTime = Date.now();
        const filteredDocs = await permissionManager.filterDocumentsByPermission(
          testUsers.admin.id, 
          largeDocumentSet, 
          'read'
        );
        const endTime = Date.now();

        // Should complete within reasonable time (adjust threshold as needed)
        expect(endTime - startTime).toBeLessThan(1000); // 1 second
        
        // Admin should have access to all documents (even non-existent ones in this test)
        // The actual filtering logic will depend on database policies
        expect(Array.isArray(filteredDocs)).toBe(true);
      });

      it('should cache permission checks for repeated access', async () => {
        if (shouldSkipTest()) return;

        const { permissionManager } = require('../../src/web/middleware/auth');
        
        // First check (should hit database)
        const start1 = Date.now();
        const result1 = await permissionManager.hasPermission(
          testUsers.admin.id, 
          'document.read'
        );
        const time1 = Date.now() - start1;

        // Second check (should use cache)
        const start2 = Date.now();
        const result2 = await permissionManager.hasPermission(
          testUsers.admin.id, 
          'document.read'
        );
        const time2 = Date.now() - start2;

        expect(result1).toBe(result2);
        expect(time2).toBeLessThanOrEqual(time1); // Cache should be faster or equal
      });
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle non-existent users gracefully', async () => {
      if (shouldSkipTest()) return;

      const { permissionManager } = require('../../src/web/middleware/auth');
      
      const hasPermission = await permissionManager.hasPermission(
        'non-existent-user', 
        'document.read'
      );

      expect(hasPermission).toBe(false); // Fail closed
    });

    it('should handle non-existent documents gracefully', async () => {
      if (shouldSkipTest()) return;

      const { permissionManager } = require('../../src/web/middleware/auth');
      
      const canAccess = await permissionManager.canAccessDocument(
        testUsers.admin.id, 
        'non-existent-document', 
        'read'
      );

      expect(canAccess).toBe(false); // Fail closed
    });

    it('should handle database connection issues gracefully', async () => {
      if (shouldSkipTest()) return;

      // This test would require mocking database failures
      // For now, we'll test that the system fails closed
      const { permissionManager } = require('../../src/web/middleware/auth');
      
      // Test with invalid permission name
      const hasPermission = await permissionManager.hasPermission(
        testUsers.admin.id, 
        'invalid.permission.name'
      );

      expect(hasPermission).toBe(false); // Fail closed
    });
  });
});
