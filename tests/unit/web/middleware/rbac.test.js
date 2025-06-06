const rbacMiddleware = require('../../../../src/web/middleware/rbac');
const ApiKeyService = require('../../../../src/services/ApiKeyService');
const PermissionService = require('../../../../src/services/PermissionService');

describe('RBAC Middleware', () => {
  let req, res, next;
  let mockApiKeyService;
  let mockPermissionService;
  
  beforeEach(() => {
    req = {
      headers: {},
      user: null,
      path: '/api/v1/documents',
      method: 'GET'
    };
    
    const EventEmitter = require('events');

jest.mock('../../../src/database/DatabaseManager', () => ({
  getInstance: jest.fn(() => ({
    query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    connect: jest.fn().mockResolvedValue({
      query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: jest.fn()
    }),
    transaction: jest.fn((callback) => {
      const mockTrx = {
        query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
        commit: jest.fn(),
        rollback: jest.fn()
      };
      return callback(mockTrx);
    })
  }))
}));
    res = Object.assign(new EventEmitter(), {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      statusCode: 200
    });
    
    next = jest.fn();
    
    // Mock services
    mockApiKeyService = {
      validateApiKey: jest.fn(),
      getUserFromApiKey: jest.fn(),
      recordApiKeyUsage: jest.fn()
    };
    
    mockPermissionService = {
      checkPermission: jest.fn(),
      getUserPermissions: jest.fn(),
      getRolePermissions: jest.fn()
    };
    
    // Replace service instances
    ApiKeyService.getInstance = jest.fn().mockReturnValue(mockApiKeyService);
    PermissionService.getInstance = jest.fn().mockReturnValue(mockPermissionService);
  });
  
  describe('requireAuth', () => {
    it('should allow access with valid API key', async () => {
      req.headers['x-api-key'] = 'valid-key';
      mockApiKeyService.validateApiKey.mockResolvedValue(true);
      mockApiKeyService.getUserFromApiKey.mockResolvedValue({
        id: 1,
        email: 'test@example.com',
        role: 'analyst'
      });
      
      const middleware = rbacMiddleware.requireAuth();
      await middleware(req, res, next);
      
      expect(mockApiKeyService.validateApiKey).toHaveBeenCalledWith('valid-key');
      expect(req.user).toBeDefined();
      expect(req.user.id).toBe(1);
      expect(next).toHaveBeenCalled();
    });
    
    it('should reject invalid API key', async () => {
      req.headers['x-api-key'] = 'invalid-key';
      mockApiKeyService.validateApiKey.mockResolvedValue(false);
      
      const middleware = rbacMiddleware.requireAuth();
      await middleware(req, res, next);
      
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Invalid or expired API key'
      });
      expect(next).not.toHaveBeenCalled();
    });
    
    it('should reject missing API key', async () => {
      const middleware = rbacMiddleware.requireAuth();
      await middleware(req, res, next);
      
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'API key required'
      });
      expect(next).not.toHaveBeenCalled();
    });
  });
  
  describe('requirePermission', () => {
    beforeEach(() => {
      req.user = {
        id: 1,
        email: 'test@example.com',
        role_id: 2
      };
    });
    
    it('should allow permitted actions', async () => {
      mockPermissionService.checkPermission.mockResolvedValue(true);
      
      const middleware = rbacMiddleware.requirePermission('documents', 'read');
      await middleware(req, res, next);
      
      expect(mockPermissionService.checkPermission).toHaveBeenCalledWith(1, 'documents', 'read');
      expect(next).toHaveBeenCalled();
    });
    
    it('should deny forbidden actions', async () => {
      mockPermissionService.checkPermission.mockResolvedValue(false);
      
      const middleware = rbacMiddleware.requirePermission('documents', 'delete');
      await middleware(req, res, next);
      
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Insufficient permissions'
      });
      expect(next).not.toHaveBeenCalled();
    });
    
    it('should handle missing user', async () => {
      req.user = null;
      
      const middleware = rbacMiddleware.requirePermission('documents', 'read');
      await middleware(req, res, next);
      
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Authentication required'
      });
      expect(next).not.toHaveBeenCalled();
    });
    
    it('should support multiple permissions (OR logic)', async () => {
      mockPermissionService.checkPermission
        .mockResolvedValueOnce(false) // First permission denied
        .mockResolvedValueOnce(true);  // Second permission allowed
      
      const middleware = rbacMiddleware.requireAnyPermission([
        { resource: 'documents', action: 'delete' },
        { resource: 'documents', action: 'update' }
      ]);
      await middleware(req, res, next);
      
      expect(mockPermissionService.checkPermission).toHaveBeenCalledTimes(2);
      expect(next).toHaveBeenCalled();
    });
    
    it('should support multiple permissions (AND logic)', async () => {
      mockPermissionService.checkPermission.mockResolvedValue(true);
      
      const middleware = rbacMiddleware.requireAllPermissions([
        { resource: 'documents', action: 'read' },
        { resource: 'documents', action: 'update' }
      ]);
      await middleware(req, res, next);
      
      expect(mockPermissionService.checkPermission).toHaveBeenCalledTimes(2);
      expect(next).toHaveBeenCalled();
    });
  });
  
  describe('requireRole', () => {
    it('should allow users with required role', async () => {
      req.user = {
        id: 1,
        role: 'admin'
      };
      
      const middleware = rbacMiddleware.requireRole('admin');
      await middleware(req, res, next);
      
      expect(next).toHaveBeenCalled();
    });
    
    it('should allow users with any of the required roles', async () => {
      req.user = {
        id: 1,
        role: 'analyst'
      };
      
      const middleware = rbacMiddleware.requireRole(['admin', 'analyst']);
      await middleware(req, res, next);
      
      expect(next).toHaveBeenCalled();
    });
    
    it('should deny users without required role', async () => {
      req.user = {
        id: 1,
        role: 'viewer'
      };
      
      const middleware = rbacMiddleware.requireRole('admin');
      await middleware(req, res, next);
      
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Insufficient role privileges'
      });
      expect(next).not.toHaveBeenCalled();
    });
  });
  
  describe('checkOptionalAuth', () => {
    it('should set user if valid API key provided', async () => {
      req.headers['x-api-key'] = 'valid-key';
      mockApiKeyService.validateApiKey.mockResolvedValue(true);
      mockApiKeyService.getUserFromApiKey.mockResolvedValue({
        id: 1,
        email: 'test@example.com'
      });
      
      const middleware = rbacMiddleware.checkOptionalAuth();
      await middleware(req, res, next);
      
      expect(req.user).toBeDefined();
      expect(next).toHaveBeenCalled();
    });
    
    it('should continue without user if no API key', async () => {
      const middleware = rbacMiddleware.checkOptionalAuth();
      await middleware(req, res, next);
      
      expect(req.user).toBeNull();
      expect(next).toHaveBeenCalled();
    });
    
    it('should continue without user if invalid API key', async () => {
      req.headers['x-api-key'] = 'invalid-key';
      mockApiKeyService.validateApiKey.mockResolvedValue(false);
      
      const middleware = rbacMiddleware.checkOptionalAuth();
      await middleware(req, res, next);
      
      expect(req.user).toBeNull();
      expect(next).toHaveBeenCalled();
    });
  });
  
  describe('auditLog', () => {
    beforeEach(() => {
      req.user = {
        id: 1,
        email: 'test@example.com'
      };
      req.body = { data: 'test' };
      req.ip = '127.0.0.1';
      req.get = jest.fn().mockReturnValue('Mozilla/5.0');
    });
    
    it('should log successful requests', async () => {
      const auditLogger = jest.fn();
      const middleware = rbacMiddleware.auditLog(auditLogger);
      
      await middleware(req, res, next);
      
      // Simulate successful response
      res.statusCode = 200;
      res.emit('finish');
      
      expect(auditLogger).toHaveBeenCalledWith({
        user_id: 1,
        method: 'GET',
        path: '/api/v1/documents',
        status_code: 200,
        ip_address: '127.0.0.1',
        user_agent: 'Mozilla/5.0',
        request_body: { data: 'test' },
        timestamp: expect.any(Date)
      });
    });
    
    it('should log failed requests', async () => {
      const auditLogger = jest.fn();
      const middleware = rbacMiddleware.auditLog(auditLogger);
      
      await middleware(req, res, next);
      
      // Simulate error response
      res.statusCode = 403;
      res.emit('finish');
      
      expect(auditLogger).toHaveBeenCalledWith(expect.objectContaining({
        status_code: 403
      }));
    });
  });
});