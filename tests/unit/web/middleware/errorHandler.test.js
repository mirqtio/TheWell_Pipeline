/**
 * Unit tests for error handler middleware
 */

const request = require('supertest');
const express = require('express');
const errorHandler = require('../../../../src/web/middleware/errorHandler');

describe('Error Handler Middleware', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
  });

  describe('asyncHandler', () => {
    it('should handle successful async operations', async () => {
      const asyncRoute = errorHandler.asyncHandler(async (req, res) => {
        res.json({ success: true });
      });

      app.get('/test', asyncRoute);

      const response = await request(app)
        .get('/test')
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should catch async errors and pass to error handler', async () => {
      const asyncRoute = errorHandler.asyncHandler(async (req, res) => {
        throw new Error('Async error');
      });

      app.get('/test', asyncRoute);
      app.use(errorHandler.errorHandler);

      const response = await request(app)
        .get('/test')
        .expect(500);

      expect(response.body.error).toBe('Internal Server Error');
    });

    it('should handle rejected promises', async () => {
      const asyncRoute = errorHandler.asyncHandler(async (req, res) => {
        return Promise.reject(new Error('Promise rejection'));
      });

      app.get('/test', asyncRoute);
      app.use(errorHandler.errorHandler);

      const response = await request(app)
        .get('/test')
        .expect(500);

      expect(response.body.error).toBe('Internal Server Error');
    });
  });

  describe('errorHandler', () => {
    beforeEach(() => {
      app.use(errorHandler.errorHandler);
    });

    it('should handle ValidationError with 400 status', async () => {
      app.get('/test', (req, res, next) => {
        const error = new errorHandler.ValidationError('Invalid input');
        next(error);
      });

      const response = await request(app)
        .get('/test')
        .expect(400);

      expect(response.body.error).toBe('Invalid input');
      expect(response.body.type).toBe('ValidationError');
    });

    it('should handle AuthenticationError with 401 status', async () => {
      app.get('/test', (req, res, next) => {
        const error = new errorHandler.AuthenticationError('Invalid credentials');
        next(error);
      });

      const response = await request(app)
        .get('/test')
        .expect(401);

      expect(response.body.error).toBe('Invalid credentials');
      expect(response.body.type).toBe('AuthenticationError');
    });

    it('should handle AuthorizationError with 403 status', async () => {
      app.get('/test', (req, res, next) => {
        const error = new errorHandler.AuthorizationError('Access denied');
        next(error);
      });

      const response = await request(app)
        .get('/test')
        .expect(403);

      expect(response.body.error).toBe('Access denied');
      expect(response.body.type).toBe('AuthorizationError');
    });

    it('should handle NotFoundError with 404 status', async () => {
      app.get('/test', (req, res, next) => {
        const error = new errorHandler.NotFoundError('Resource not found');
        next(error);
      });

      const response = await request(app)
        .get('/test')
        .expect(404);

      expect(response.body.error).toBe('Resource not found');
      expect(response.body.type).toBe('NotFoundError');
    });

    it('should handle generic errors with 500 status', async () => {
      app.get('/test', (req, res, next) => {
        next(new Error('Generic error'));
      });

      const response = await request(app)
        .get('/test')
        .expect(500);

      expect(response.body.error).toBe('Internal Server Error');
    });

    it('should include error details in development mode', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      app.get('/test', (req, res, next) => {
        next(new Error('Development error'));
      });

      const response = await request(app)
        .get('/test')
        .expect(500);

      expect(response.body.message).toBe('Development error');
      expect(response.body.stack).toBeDefined();

      process.env.NODE_ENV = originalEnv;
    });

    it('should hide error details in production mode', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      app.get('/test', (req, res, next) => {
        next(new Error('Production error'));
      });

      const response = await request(app)
        .get('/test')
        .expect(500);

      expect(response.body.error).toBe('Internal Server Error');
      expect(response.body.message).toBeUndefined();
      expect(response.body.stack).toBeUndefined();

      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('Custom Error Classes', () => {
    it('should create ValidationError with correct properties', () => {
      const error = new errorHandler.ValidationError('Validation failed');
      expect(error.name).toBe('ValidationError');
      expect(error.message).toBe('Validation failed');
      expect(error.statusCode).toBe(400);
    });

    it('should create AuthenticationError with correct properties', () => {
      const error = new errorHandler.AuthenticationError('Auth failed');
      expect(error.name).toBe('AuthenticationError');
      expect(error.message).toBe('Auth failed');
      expect(error.statusCode).toBe(401);
    });

    it('should create AuthorizationError with correct properties', () => {
      const error = new errorHandler.AuthorizationError('Access denied');
      expect(error.name).toBe('AuthorizationError');
      expect(error.message).toBe('Access denied');
      expect(error.statusCode).toBe(403);
    });

    it('should create NotFoundError with correct properties', () => {
      const error = new errorHandler.NotFoundError('Not found');
      expect(error.name).toBe('NotFoundError');
      expect(error.message).toBe('Not found');
      expect(error.statusCode).toBe(404);
    });
  });
});
