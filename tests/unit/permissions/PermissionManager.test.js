/**
 * Unit tests for PermissionManager
 * Tests comprehensive permission enforcement system
 */

const PermissionManager = require('../../../src/permissions/PermissionManager');
const DatabaseManager = require('../../../src/database/DatabaseManager');
const logger = require('../../../src/utils/logger');

// Mock dependencies
jest.mock('../../../src/database/DatabaseManager');
jest.mock('../../../src/utils/logger');

describe('PermissionManager', () => {
  let permissionManager;
  let mockDb;
  let mockClient;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Mock database client
    mockClient = {
      query: jest.fn(),
      release: jest.fn()
    };

    // Mock database manager
    mockDb = {
      initialize: jest.fn().mockResolvedValue(),
      pool: {
        connect: jest.fn().mockResolvedValue(mockClient)
      }
    };

    DatabaseManager.mockImplementation(() => mockDb);

    // Create permission manager instance
    permissionManager = new PermissionManager({
      db: mockDb,
      cacheEnabled: true,
      cacheTTL: 3600
    });
  });

  afterEach(() => {
    // Clear cache after each test
    permissionManager.clearCache();
  });

  describe('initialization', () => {
    it('should initialize successfully', async () => {
      await permissionManager.initialize();
      
      expect(mockDb.initialize).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith('PermissionManager initialized successfully');
    });

    it('should handle initialization errors', async () => {
      const error = new Error('Database connection failed');
      mockDb.initialize.mockRejectedValue(error);

      await expect(permissionManager.initialize()).rejects.toThrow('Database connection failed');
      expect(logger.error).toHaveBeenCalledWith('Failed to initialize PermissionManager', { error: error.message });
    });
  });

  describe('hasPermission', () => {
    const userId = 'user-123';
    const permissionName = 'document.read';

    it('should return true when user has direct permission', async () => {
      // Mock user permission query result
      mockClient.query
        .mockResolvedValueOnce({ rows: [{ is_granted: true }] }) // User permission
        .mockResolvedValueOnce({ rows: [] }); // Role permission (not needed)

      const result = await permissionManager.hasPermission(userId, permissionName);

      expect(result).toBe(true);
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('user_permissions'),
        [userId, permissionName, null, null]
      );
    });

    it('should return false when user has explicit denial', async () => {
      // Mock user permission query result with denial
      mockClient.query
        .mockResolvedValueOnce({ rows: [{ is_granted: false }] });

      const result = await permissionManager.hasPermission(userId, permissionName);

      expect(result).toBe(false);
    });

    it('should check role permissions when no direct permission exists', async () => {
      // Mock user permission query (no results) and role permission query (has permission)
      mockClient.query
        .mockResolvedValueOnce({ rows: [] }) // No user permission
        .mockResolvedValueOnce({ rows: [{ id: 1 }] }); // Has role permission

      const result = await permissionManager.hasPermission(userId, permissionName);

      expect(result).toBe(true);
      expect(mockClient.query).toHaveBeenCalledTimes(2);
    });

    it('should return false when no permissions found', async () => {
      // Mock no permissions found
      mockClient.query
        .mockResolvedValueOnce({ rows: [] }) // No user permission
        .mockResolvedValueOnce({ rows: [] }); // No role permission

      const result = await permissionManager.hasPermission(userId, permissionName);

      expect(result).toBe(false);
    });

    it('should use cache for repeated permission checks', async () => {
      // Mock successful permission check
      mockClient.query
        .mockResolvedValueOnce({ rows: [{ is_granted: true }] });

      // First call
      const result1 = await permissionManager.hasPermission(userId, permissionName);
      expect(result1).toBe(true);

      // Second call should use cache
      const result2 = await permissionManager.hasPermission(userId, permissionName);
      expect(result2).toBe(true);

      // Database should only be called once
      expect(mockClient.query).toHaveBeenCalledTimes(1);
      expect(logger.debug).toHaveBeenCalledWith('Permission check cache hit', expect.any(Object));
    });

    it('should handle database errors gracefully', async () => {
      const error = new Error('Database error');
      mockClient.query.mockRejectedValue(error);

      const result = await permissionManager.hasPermission(userId, permissionName);

      expect(result).toBe(false); // Fail closed
      expect(logger.error).toHaveBeenCalledWith('Permission check failed', expect.any(Object));
    });

    it('should handle resource-specific permissions', async () => {
      const resourceType = 'document';
      const resourceId = 'doc-456';

      mockClient.query
        .mockResolvedValueOnce({ rows: [{ is_granted: true }] });

      const result = await permissionManager.hasPermission(userId, permissionName, resourceType, resourceId);

      expect(result).toBe(true);
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('user_permissions'),
        [userId, permissionName, resourceType, resourceId]
      );
    });
  });

  describe('filterDocumentsByPermission', () => {
    const userId = 'user-123';
    const documentIds = ['doc-1', 'doc-2', 'doc-3'];
    const action = 'read';

    it('should return accessible documents', async () => {
      const mockResult = {
        rows: [
          { document_id: 'doc-1' },
          { document_id: 'doc-3' }
        ]
      };

      mockClient.query.mockResolvedValue(mockResult);

      const result = await permissionManager.filterDocumentsByPermission(userId, documentIds, action);

      expect(result).toEqual(['doc-1', 'doc-3']);
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('user_document_access'),
        [userId, action, documentIds]
      );
    });

    it('should return empty array for empty input', async () => {
      const result = await permissionManager.filterDocumentsByPermission(userId, [], action);

      expect(result).toEqual([]);
      expect(mockClient.query).not.toHaveBeenCalled();
    });

    it('should return empty array for null input', async () => {
      const result = await permissionManager.filterDocumentsByPermission(userId, null, action);

      expect(result).toEqual([]);
      expect(mockClient.query).not.toHaveBeenCalled();
    });

    it('should handle database errors gracefully', async () => {
      const error = new Error('Database error');
      mockClient.query.mockRejectedValue(error);

      const result = await permissionManager.filterDocumentsByPermission(userId, documentIds, action);

      expect(result).toEqual([]); // Fail closed
      expect(logger.error).toHaveBeenCalledWith('Failed to filter documents by permission', expect.any(Object));
    });
  });

  describe('canAccessDocument', () => {
    const userId = 'user-123';
    const documentId = 'doc-456';
    const action = 'read';

    it('should return true when user can access document', async () => {
      const mockResult = {
        rows: [{ document_id: documentId }]
      };

      mockClient.query.mockResolvedValue(mockResult);

      const result = await permissionManager.canAccessDocument(userId, documentId, action);

      expect(result).toBe(true);
    });

    it('should return false when user cannot access document', async () => {
      const mockResult = { rows: [] };

      mockClient.query.mockResolvedValue(mockResult);

      const result = await permissionManager.canAccessDocument(userId, documentId, action);

      expect(result).toBe(false);
    });

    it('should handle errors gracefully', async () => {
      const error = new Error('Database error');
      mockClient.query.mockRejectedValue(error);

      const result = await permissionManager.canAccessDocument(userId, documentId, action);

      expect(result).toBe(false);
      expect(logger.error).toHaveBeenCalledWith('Failed to filter documents by permission', expect.any(Object));
    });
  });

  describe('logAccess', () => {
    const userId = 'user-123';
    const resourceType = 'document';
    const resourceId = 'doc-456';
    const action = 'read';
    const granted = true;
    const metadata = {
      ipAddress: '192.168.1.1',
      userAgent: 'Mozilla/5.0',
      endpoint: '/api/v1/rag/search',
      method: 'POST',
      traceId: 'trace-123'
    };

    it('should log access successfully', async () => {
      mockClient.query.mockResolvedValue();

      await permissionManager.logAccess(userId, resourceType, resourceId, action, granted, metadata);

      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO access_logs'),
        [
          userId,
          resourceType,
          resourceId,
          action,
          granted,
          metadata.ipAddress,
          metadata.userAgent,
          metadata.endpoint,
          metadata.method,
          metadata.traceId,
          null, // statusCode
          null, // responseTimeMs
          null  // denialReason
        ]
      );
    });

    it('should handle logging errors gracefully', async () => {
      const error = new Error('Database error');
      mockClient.query.mockRejectedValue(error);

      // Should not throw
      await expect(permissionManager.logAccess(userId, resourceType, resourceId, action, granted, metadata))
        .resolves.toBeUndefined();

      expect(logger.error).toHaveBeenCalledWith('Failed to log access', expect.any(Object));
    });

    it('should handle missing metadata gracefully', async () => {
      mockClient.query.mockResolvedValue();

      await permissionManager.logAccess(userId, resourceType, resourceId, action, granted);

      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO access_logs'),
        [
          userId,
          resourceType,
          resourceId,
          action,
          granted,
          null, // ipAddress
          null, // userAgent
          null, // endpoint
          null, // method
          null, // traceId
          null, // statusCode
          null, // responseTimeMs
          null  // denialReason
        ]
      );
    });
  });

  describe('cache management', () => {
    const userId = 'user-123';
    const permissionName = 'document.read';

    it('should clear user cache', async () => {
      // Add some cached permissions
      mockClient.query.mockResolvedValue({ rows: [{ is_granted: true }] });
      
      await permissionManager.hasPermission(userId, permissionName);
      await permissionManager.hasPermission(userId, 'document.write');
      await permissionManager.hasPermission('other-user', permissionName);

      // Clear cache for specific user
      permissionManager.clearUserCache(userId);

      // Next call for this user should hit database again
      await permissionManager.hasPermission(userId, permissionName);

      // Should have been called 4 times total (3 initial + 1 after cache clear)
      expect(mockClient.query).toHaveBeenCalledTimes(4);
    });

    it('should clear all cache', async () => {
      // Add some cached permissions
      mockClient.query.mockResolvedValue({ rows: [{ is_granted: true }] });
      
      await permissionManager.hasPermission(userId, permissionName);
      await permissionManager.hasPermission('other-user', permissionName);

      // Clear all cache
      permissionManager.clearCache();

      // Next calls should hit database again
      await permissionManager.hasPermission(userId, permissionName);
      await permissionManager.hasPermission('other-user', permissionName);

      // Should have been called 4 times total (2 initial + 2 after cache clear)
      expect(mockClient.query).toHaveBeenCalledTimes(4);
    });

    it('should handle cache disabled', async () => {
      // Create permission manager with cache disabled
      const noCacheManager = new PermissionManager({
        db: mockDb,
        cacheEnabled: false
      });

      mockClient.query.mockResolvedValue({ rows: [{ is_granted: true }] });

      // Multiple calls should always hit database
      await noCacheManager.hasPermission(userId, permissionName);
      await noCacheManager.hasPermission(userId, permissionName);

      expect(mockClient.query).toHaveBeenCalledTimes(2);
    });
  });

  describe('_getCacheKey', () => {
    it('should generate consistent cache keys', () => {
      const key1 = permissionManager._getCacheKey('user-123', 'document.read', 'document', 'doc-456');
      const key2 = permissionManager._getCacheKey('user-123', 'document.read', 'document', 'doc-456');

      expect(key1).toBe(key2);
      expect(key1).toBe('user-123:document.read:document:doc-456');
    });

    it('should handle null values in cache key', () => {
      const key = permissionManager._getCacheKey('user-123', 'document.read', null, null);

      expect(key).toBe('user-123:document.read::');
    });
  });

  describe('error handling', () => {
    it('should always release database connections', async () => {
      const error = new Error('Query failed');
      mockClient.query.mockRejectedValue(error);

      await permissionManager.hasPermission('user-123', 'document.read');

      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should handle connection errors', async () => {
      const connectionError = new Error('Connection failed');
      mockDb.pool.connect.mockRejectedValue(connectionError);

      const result = await permissionManager.hasPermission('user-123', 'document.read');

      expect(result).toBe(false);
      expect(logger.error).toHaveBeenCalledWith('Permission check failed', expect.any(Object));
    });
  });
});
