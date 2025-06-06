const PermissionService = require('../../../src/services/PermissionService');

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

describe('PermissionService', () => {
  let service;
  let mockDb;
  
  beforeEach(() => {
    mockDb = {
      query: jest.fn()
    };
    
    service = new PermissionService(mockDb);
  });
  
  describe('checkPermission', () => {
    it('should allow admin users all permissions', async () => {
      mockDb.query.mockResolvedValue({
        rows: [{
          check_permission: true
        }]
      });
      
      const hasPermission = await service.checkPermission(1, 'documents', 'delete');
      
      expect(hasPermission).toBe(true);
      expect(mockDb.query).toHaveBeenCalledWith(
        'SELECT check_permission($1, $2, $3)',
        [1, 'documents', 'delete']
      );
    });
    
    it('should check specific permissions for non-admin users', async () => {
      mockDb.query.mockResolvedValue({
        rows: [{
          check_permission: false
        }]
      });
      
      const hasPermission = await service.checkPermission(2, 'users', 'delete');
      
      expect(hasPermission).toBe(false);
    });
    
    it('should handle database errors gracefully', async () => {
      mockDb.query.mockRejectedValue(new Error('DB error'));
      
      const hasPermission = await service.checkPermission(1, 'documents', 'read');
      
      expect(hasPermission).toBe(false);
    });
    
    it('should cache permission checks', async () => {
      mockDb.query.mockResolvedValue({
        rows: [{ check_permission: true }]
      });
      
      // First call
      await service.checkPermission(1, 'documents', 'read');
      
      // Second call (should use cache)
      await service.checkPermission(1, 'documents', 'read');
      
      // Should only query once
      expect(mockDb.query).toHaveBeenCalledTimes(1);
    });
    
    it('should invalidate cache after TTL', async () => {
      jest.useFakeTimers();
      
      mockDb.query.mockResolvedValue({
        rows: [{ check_permission: true }]
      });
      
      // First call
      await service.checkPermission(1, 'documents', 'read');
      
      // Advance time past cache TTL (5 minutes)
      jest.advanceTimersByTime(6 * 60 * 1000);
      
      // Second call (should query again)
      await service.checkPermission(1, 'documents', 'read');
      
      expect(mockDb.query).toHaveBeenCalledTimes(2);
      
      jest.useRealTimers();
    });
  });
  
  describe('getUserPermissions', () => {
    it('should return all permissions for a user', async () => {
      mockDb.query.mockResolvedValue({
        rows: [{
          permissions: ['documents:read', 'documents:update', 'reports:create']
        }]
      });
      
      const permissions = await service.getUserPermissions(1);
      
      expect(permissions).toEqual([
        'documents:read',
        'documents:update',
        'reports:create'
      ]);
    });
    
    it('should return empty array for user without permissions', async () => {
      mockDb.query.mockResolvedValue({
        rows: []
      });
      
      const permissions = await service.getUserPermissions(999);
      
      expect(permissions).toEqual([]);
    });
    
    it('should handle wildcard permissions', async () => {
      mockDb.query.mockResolvedValue({
        rows: [{
          permissions: ['*']
        }]
      });
      
      const permissions = await service.getUserPermissions(1);
      
      expect(permissions).toContain('*');
    });
  });
  
  describe('getRolePermissions', () => {
    it('should return permissions for a role', async () => {
      mockDb.query.mockResolvedValue({
        rows: [{
          permissions: ['documents:read', 'documents:search']
        }]
      });
      
      const permissions = await service.getRolePermissions('analyst');
      
      expect(permissions).toEqual([
        'documents:read',
        'documents:search'
      ]);
    });
    
    it('should handle role ID', async () => {
      mockDb.query.mockResolvedValue({
        rows: [{
          permissions: ['documents:*']
        }]
      });
      
      const permissions = await service.getRolePermissions(2);
      
      expect(permissions).toContain('documents:*');
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id = $1'),
        [2]
      );
    });
  });
  
  describe('assignRoleToUser', () => {
    it('should assign role to user', async () => {
      mockDb.query.mockResolvedValue({
        rows: [{
          id: 1,
          role_id: 2
        }]
      });
      
      const result = await service.assignRoleToUser(1, 'analyst');
      
      expect(result).toBe(true);
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE users SET role_id'),
        expect.any(Array)
      );
    });
    
    it('should handle invalid role', async () => {
      mockDb.query
        .mockResolvedValueOnce({ rows: [] }) // Role lookup fails
        .mockResolvedValueOnce({ rows: [] });
      
      const result = await service.assignRoleToUser(1, 'invalid-role');
      
      expect(result).toBe(false);
    });
  });
  
  describe('createRole', () => {
    it('should create new role with permissions', async () => {
      const roleData = {
        name: 'custom-role',
        description: 'Custom role for testing',
        permissions: ['documents:read', 'reports:create']
      };
      
      mockDb.query.mockResolvedValue({
        rows: [{
          id: 10,
          name: roleData.name,
          permissions: roleData.permissions
        }]
      });
      
      const role = await service.createRole(roleData);
      
      expect(role).toMatchObject({
        id: 10,
        name: 'custom-role',
        permissions: roleData.permissions
      });
    });
    
    it('should prevent creating system roles', async () => {
      const roleData = {
        name: 'admin',
        permissions: ['*']
      };
      
      await expect(service.createRole(roleData))
        .rejects.toThrow('Cannot create system role');
    });
    
    it('should validate permissions', async () => {
      const roleData = {
        name: 'invalid-role',
        permissions: ['invalid:permission']
      };
      
      mockDb.query.mockResolvedValue({ rows: [] });
      
      await expect(service.createRole(roleData))
        .rejects.toThrow('Invalid permission');
    });
  });
  
  describe('updateRolePermissions', () => {
    it('should update role permissions', async () => {
      mockDb.query.mockResolvedValue({
        rows: [{
          id: 5,
          permissions: ['documents:read', 'documents:update']
        }]
      });
      
      const result = await service.updateRolePermissions(5, [
        'documents:read',
        'documents:update'
      ]);
      
      expect(result).toBe(true);
    });
    
    it('should prevent updating system roles', async () => {
      mockDb.query.mockResolvedValue({
        rows: [{
          id: 1,
          is_system: true
        }]
      });
      
      await expect(service.updateRolePermissions(1, ['*']))
        .rejects.toThrow('Cannot modify system role');
    });
  });
  
  describe('hasPermission helper', () => {
    it('should check exact permission match', () => {
      const permissions = ['documents:read', 'documents:update'];
      
      expect(service._hasPermission(permissions, 'documents', 'read')).toBe(true);
      expect(service._hasPermission(permissions, 'documents', 'delete')).toBe(false);
    });
    
    it('should handle wildcard permissions', () => {
      const permissions = ['documents:*', 'reports:read'];
      
      expect(service._hasPermission(permissions, 'documents', 'delete')).toBe(true);
      expect(service._hasPermission(permissions, 'reports', 'delete')).toBe(false);
    });
    
    it('should handle global wildcard', () => {
      const permissions = ['*'];
      
      expect(service._hasPermission(permissions, 'anything', 'anything')).toBe(true);
    });
  });
  
  describe('audit logging', () => {
    it('should log permission checks when enabled', async () => {
      service = new PermissionService(mockDb, { enableAuditLog: true });
      
      mockDb.query
        .mockResolvedValueOnce({ rows: [{ check_permission: true }] })
        .mockResolvedValueOnce({ rows: [] }); // Audit log insert
      
      await service.checkPermission(1, 'documents', 'delete');
      
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO rbac_audit_log'),
        expect.arrayContaining([1, 'permission_check'])
      );
    });
  });
});