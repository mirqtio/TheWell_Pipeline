const ApiKeyService = require('../../../src/services/ApiKeyService');
const crypto = require('crypto');

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

describe('ApiKeyService', () => {
  let service;
  let mockDb;
  
  beforeEach(() => {
    mockDb = {
      query: jest.fn(),
      transaction: jest.fn()
    };
    
    service = new ApiKeyService(mockDb);
  });
  
  describe('generateApiKey', () => {
    it('should generate a secure API key', async () => {
      const userId = 1;
      const keyName = 'Test API Key';
      
      mockDb.query.mockResolvedValue({
        rows: [{
          id: 1,
          user_id: userId,
          key_prefix: 'sk_test_',
          created_at: new Date()
        }]
      });
      
      const result = await service.generateApiKey(userId, keyName);
      
      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('key');
      expect(result).toHaveProperty('key_prefix');
      expect(result.key).toMatch(/^sk_[a-zA-Z0-9_-]+$/);
      expect(result.key.length).toBeGreaterThan(32);
      
      // Check that key was hashed before storage
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO api_keys'),
        expect.arrayContaining([
          userId,
          expect.any(String), // key_hash
          expect.stringMatching(/^sk_[a-zA-Z0-9_]+$/), // key_prefix
          keyName
        ])
      );
    });
    
    it('should set expiration if provided', async () => {
      const userId = 1;
      const expiresIn = 3600; // 1 hour
      
      mockDb.query.mockResolvedValue({
        rows: [{ id: 1 }]
      });
      
      await service.generateApiKey(userId, 'Test', { expiresIn });
      
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('expires_at'),
        expect.any(Array)
      );
    });
    
    it('should store metadata if provided', async () => {
      const userId = 1;
      const metadata = { scope: 'read-only', project: 'test' };
      
      mockDb.query.mockResolvedValue({
        rows: [{ id: 1 }]
      });
      
      await service.generateApiKey(userId, 'Test', { metadata });
      
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([
          expect.any(Number),
          expect.any(String),
          expect.any(String),
          expect.any(String),
          expect.any(Object), // expires_at
          JSON.stringify(metadata)
        ])
      );
    });
  });
  
  describe('validateApiKey', () => {
    it('should validate correct API key', async () => {
      const apiKey = 'sk_test_1234567890abcdef';
      const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
      
      mockDb.query.mockResolvedValue({
        rows: [{
          id: 1,
          user_id: 1,
          key_hash: keyHash,
          expires_at: null,
          is_active: true
        }]
      });
      
      const isValid = await service.validateApiKey(apiKey);
      
      expect(isValid).toBe(true);
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
        [keyHash]
      );
    });
    
    it('should reject expired API key', async () => {
      const apiKey = 'sk_test_1234567890abcdef';
      const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
      
      mockDb.query.mockResolvedValue({
        rows: [{
          id: 1,
          expires_at: new Date(Date.now() - 3600000), // 1 hour ago
          is_active: true
        }]
      });
      
      const isValid = await service.validateApiKey(apiKey);
      
      expect(isValid).toBe(false);
    });
    
    it('should reject inactive API key', async () => {
      const apiKey = 'sk_test_1234567890abcdef';
      const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
      
      mockDb.query.mockResolvedValue({
        rows: [{
          id: 1,
          expires_at: null,
          is_active: false
        }]
      });
      
      const isValid = await service.validateApiKey(apiKey);
      
      expect(isValid).toBe(false);
    });
    
    it('should reject non-existent API key', async () => {
      mockDb.query.mockResolvedValue({
        rows: []
      });
      
      const isValid = await service.validateApiKey('sk_test_invalid');
      
      expect(isValid).toBe(false);
    });
    
    it('should update last_used_at on successful validation', async () => {
      const apiKey = 'sk_test_1234567890abcdef';
      
      mockDb.query
        .mockResolvedValueOnce({
          rows: [{
            id: 1,
            expires_at: null,
            is_active: true
          }]
        })
        .mockResolvedValueOnce({ rows: [] }); // Update query
      
      await service.validateApiKey(apiKey);
      
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE api_keys SET last_used_at'),
        [1]
      );
    });
  });
  
  describe('rotateApiKey', () => {
    it('should rotate API key with grace period', async () => {
      const oldKeyId = 1;
      const gracePeriodMinutes = 60;
      
      // Mock transaction
      const mockTrx = {
        query: jest.fn(),
        commit: jest.fn(),
        rollback: jest.fn()
      };
      
      mockDb.transaction.mockImplementation(async (callback) => {
        return callback(mockTrx);
      });
      
      // Mock queries
      mockTrx.query
        .mockResolvedValueOnce({ // Get old key
          rows: [{
            id: oldKeyId,
            user_id: 1,
            name: 'Old Key'
          }]
        })
        .mockResolvedValueOnce({ // Insert new key
          rows: [{
            id: 2,
            key_prefix: 'sk_new_'
          }]
        })
        .mockResolvedValueOnce({ // Update old key
          rows: []
        });
      
      const result = await service.rotateApiKey(oldKeyId, gracePeriodMinutes);
      
      expect(result).toHaveProperty('id', 2);
      expect(result).toHaveProperty('key');
      expect(result).toHaveProperty('oldKeyExpiresAt');
      
      // Check that old key was set to expire
      expect(mockTrx.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE api_keys SET expires_at'),
        expect.arrayContaining([oldKeyId])
      );
      
      expect(mockTrx.commit).toHaveBeenCalled();
    });
    
    it('should rollback on error', async () => {
      const mockTrx = {
        query: jest.fn().mockRejectedValue(new Error('DB error')),
        rollback: jest.fn()
      };
      
      mockDb.transaction.mockImplementation(async (callback) => {
        return callback(mockTrx);
      });
      
      await expect(service.rotateApiKey(1))
        .rejects.toThrow('DB error');
      
      expect(mockTrx.rollback).toHaveBeenCalled();
    });
    
    it('should handle invalid old key', async () => {
      mockDb.transaction.mockImplementation(async (callback) => {
        const mockTrx = {
          query: jest.fn().mockResolvedValue({ rows: [] })
        };
        return callback(mockTrx);
      });
      
      await expect(service.rotateApiKey(999))
        .rejects.toThrow('Invalid or inactive API key');
    });
  });
  
  describe('getUserFromApiKey', () => {
    it('should return user details for valid API key', async () => {
      const apiKey = 'sk_test_1234567890abcdef';
      const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
      
      mockDb.query.mockResolvedValue({
        rows: [{
          user_id: 1,
          user_email: 'test@example.com',
          user_name: 'Test User',
          role_id: 2,
          role_name: 'analyst'
        }]
      });
      
      const user = await service.getUserFromApiKey(apiKey);
      
      expect(user).toEqual({
        id: 1,
        email: 'test@example.com',
        name: 'Test User',
        role_id: 2,
        role: 'analyst'
      });
    });
    
    it('should return null for invalid API key', async () => {
      mockDb.query.mockResolvedValue({ rows: [] });
      
      const user = await service.getUserFromApiKey('invalid-key');
      
      expect(user).toBeNull();
    });
  });
  
  describe('revokeApiKey', () => {
    it('should revoke API key', async () => {
      mockDb.query.mockResolvedValue({
        rows: [{ id: 1 }]
      });
      
      const result = await service.revokeApiKey(1, 2);
      
      expect(result).toBe(true);
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE api_keys SET is_active = FALSE'),
        [1, 2]
      );
    });
    
    it('should return false if key not found', async () => {
      mockDb.query.mockResolvedValue({ rows: [] });
      
      const result = await service.revokeApiKey(999, 1);
      
      expect(result).toBe(false);
    });
  });
  
  describe('listUserApiKeys', () => {
    it('should list all active API keys for user', async () => {
      mockDb.query.mockResolvedValue({
        rows: [
          {
            id: 1,
            name: 'Production Key',
            key_prefix: 'sk_prod_',
            created_at: new Date(),
            last_used_at: new Date(),
            expires_at: null
          },
          {
            id: 2,
            name: 'Test Key',
            key_prefix: 'sk_test_',
            created_at: new Date(),
            last_used_at: null,
            expires_at: new Date()
          }
        ]
      });
      
      const keys = await service.listUserApiKeys(1);
      
      expect(keys).toHaveLength(2);
      expect(keys[0]).not.toHaveProperty('key_hash');
      expect(keys[0]).toHaveProperty('key_prefix');
      expect(keys[0]).toHaveProperty('name');
    });
    
    it('should include inactive keys if requested', async () => {
      mockDb.query.mockResolvedValue({ rows: [] });
      
      await service.listUserApiKeys(1, { includeInactive: true });
      
      expect(mockDb.query).not.toHaveBeenCalledWith(
        expect.stringContaining('WHERE user_id = $1 AND is_active = TRUE'),
        expect.any(Array)
      );
    });
  });
});