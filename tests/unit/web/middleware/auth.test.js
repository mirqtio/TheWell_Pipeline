/**
 * Unit tests for authentication middleware
 */

const request = require('supertest');
const express = require('express');
const authMiddleware = require('../../../../src/web/middleware/auth');

describe('Authentication Middleware', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
  });

  describe('authenticateRequest', () => {
    it('should allow requests with valid API key', async () => {
      app.use(authMiddleware.authenticateRequest);
      app.get('/test', (req, res) => res.json({ success: true }));

      const response = await request(app)
        .get('/test')
        .set('X-API-Key', 'dev-review-key')
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should reject requests without API key', async () => {
      app.use(authMiddleware.authenticateRequest);
      app.get('/test', (req, res) => res.json({ success: true }));

      await request(app)
        .get('/test')
        .expect(401);
    });

    it('should reject requests with invalid API key', async () => {
      app.use(authMiddleware.authenticateRequest);
      app.get('/test', (req, res) => res.json({ success: true }));

      await request(app)
        .get('/test')
        .set('X-API-Key', 'invalid-key')
        .expect(401);
    });

    it('should bypass authentication in development mode', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      app.use(authMiddleware.authenticateRequest);
      app.get('/test', (req, res) => res.json({ success: true }));

      const response = await request(app)
        .get('/test')
        .expect(200);

      expect(response.body.success).toBe(true);
      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('requirePermission', () => {
    it('should allow access with correct permission', async () => {
      app.use((req, res, next) => {
        req.user = { permissions: ['review:read', 'review:write'] };
        next();
      });
      app.use(authMiddleware.requirePermission('review:read'));
      app.get('/test', (req, res) => res.json({ success: true }));

      const response = await request(app)
        .get('/test')
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should deny access without required permission', async () => {
      app.use((req, res, next) => {
        req.user = { permissions: ['review:read'] };
        next();
      });
      app.use(authMiddleware.requirePermission('admin:write'));
      app.get('/test', (req, res) => res.json({ success: true }));

      await request(app)
        .get('/test')
        .expect(403);
    });

    it('should deny access when user has no permissions', async () => {
      app.use((req, res, next) => {
        req.user = {};
        next();
      });
      app.use(authMiddleware.requirePermission('review:read'));
      app.get('/test', (req, res) => res.json({ success: true }));

      await request(app)
        .get('/test')
        .expect(403);
    });
  });

  describe('requireRole', () => {
    it('should allow access with correct role', async () => {
      app.use((req, res, next) => {
        req.user = { role: 'reviewer' };
        next();
      });
      app.use(authMiddleware.requireRole('reviewer'));
      app.get('/test', (req, res) => res.json({ success: true }));

      const response = await request(app)
        .get('/test')
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should deny access with incorrect role', async () => {
      app.use((req, res, next) => {
        req.user = { role: 'viewer' };
        next();
      });
      app.use(authMiddleware.requireRole('admin'));
      app.get('/test', (req, res) => res.json({ success: true }));

      await request(app)
        .get('/test')
        .expect(403);
    });

    it('should deny access when user has no role', async () => {
      app.use((req, res, next) => {
        req.user = {};
        next();
      });
      app.use(authMiddleware.requireRole('reviewer'));
      app.get('/test', (req, res) => res.json({ success: true }));

      await request(app)
        .get('/test')
        .expect(403);
    });
  });

  describe('utility functions', () => {
    describe('hasPermission', () => {
      it('should return true for valid permission', async () => {
        const user = { permissions: ['review:read', 'review:write'] };
        expect(await authMiddleware.hasPermission(user, 'review:read')).toBe(true);
      });

      it('should return false for invalid permission', async () => {
        const user = { permissions: ['review:read'] };
        expect(await authMiddleware.hasPermission(user, 'admin:write')).toBe(false);
      });

      it('should return false when user has no permissions', async () => {
        const user = {};
        expect(await authMiddleware.hasPermission(user, 'review:read')).toBe(false);
      });
    });

    describe('hasRole', () => {
      it('should return true for correct role', () => {
        const user = { role: 'reviewer' };
        expect(authMiddleware.hasRole(user, 'reviewer')).toBe(true);
      });

      it('should return false for incorrect role', () => {
        const user = { role: 'viewer' };
        expect(authMiddleware.hasRole(user, 'admin')).toBe(false);
      });

      it('should return false when user has no role', () => {
        const user = {};
        expect(authMiddleware.hasRole(user, 'reviewer')).toBe(false);
      });
    });
  });
});
