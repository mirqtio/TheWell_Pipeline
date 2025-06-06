const crypto = require('crypto');
const DatabaseManager = require('../database/DatabaseManager');
const logger = require('../utils/logger');

/**
 * Service for managing API keys with rotation support
 */
class ApiKeyService {
  constructor(database = null) {
    this.db = database;
    this.keyPrefix = process.env.API_KEY_PREFIX || 'sk_';
    this.keyLength = 32; // 256 bits
    
    // Lazy load database if not provided
    if (!this.db) {
      this._getDb = () => {
        if (!this.db) {
          this.db = DatabaseManager.getInstance().getDatabase();
        }
        return this.db;
      };
    } else {
      this._getDb = () => this.db;
    }
  }
  
  /**
   * Get singleton instance
   */
  static getInstance() {
    if (!ApiKeyService.instance) {
      ApiKeyService.instance = new ApiKeyService();
    }
    return ApiKeyService.instance;
  }
  
  /**
   * Generate a new API key
   */
  async generateApiKey(userId, name, options = {}) {
    try {
      // Generate secure random key
      const keyBytes = crypto.randomBytes(this.keyLength);
      const keyValue = keyBytes.toString('base64url');
      
      // Determine key prefix based on environment
      const envPrefix = process.env.NODE_ENV === 'production' ? 'prod' : 'test';
      const fullKey = `${this.keyPrefix}${envPrefix}_${keyValue}`;
      
      // Extract key prefix for identification
      const keyPrefixPart = fullKey.substring(0, this.keyPrefix.length + envPrefix.length + 1 + 8);
      
      // Hash the key for storage
      const keyHash = this.hashKey(fullKey);
      
      // Calculate expiration if provided
      const expiresAt = options.expiresIn 
        ? new Date(Date.now() + options.expiresIn * 1000)
        : null;
      
      // Store in database
      const result = await this._getDb().query(`
        INSERT INTO api_keys (user_id, key_hash, key_prefix, name, expires_at, metadata)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, key_prefix, created_at
      `, [
        userId,
        keyHash,
        keyPrefixPart,
        name,
        expiresAt,
        JSON.stringify(options.metadata || {})
      ]);
      
      const apiKey = result.rows[0];
      
      logger.info('API key generated', {
        userId,
        keyId: apiKey.id,
        name,
        expiresAt
      });
      
      return {
        id: apiKey.id,
        key: fullKey, // Return full key only on creation
        key_prefix: apiKey.key_prefix,
        created_at: apiKey.created_at,
        expires_at: expiresAt
      };
      
    } catch (error) {
      logger.error('Failed to generate API key:', error);
      throw error;
    }
  }
  
  /**
   * Validate an API key
   */
  async validateApiKey(apiKey) {
    try {
      if (!apiKey || typeof apiKey !== 'string') {
        return false;
      }
      
      const keyHash = this.hashKey(apiKey);
      
      const result = await this._getDb().query(`
        SELECT id, expires_at, is_active
        FROM api_keys
        WHERE key_hash = $1
      `, [keyHash]);
      
      if (result.rows.length === 0) {
        return false;
      }
      
      const key = result.rows[0];
      
      // Check if active
      if (!key.is_active) {
        return false;
      }
      
      // Check expiration
      if (key.expires_at && new Date(key.expires_at) < new Date()) {
        return false;
      }
      
      // Update last used timestamp
      this._getDb().query(`
        UPDATE api_keys 
        SET last_used_at = NOW() 
        WHERE id = $1
      `, [key.id]).catch(err => {
        logger.warn('Failed to update last_used_at:', err);
      });
      
      return true;
      
    } catch (error) {
      logger.error('API key validation error:', error);
      return false;
    }
  }
  
  /**
   * Get user from API key
   */
  async getUserFromApiKey(apiKey) {
    try {
      const keyHash = this.hashKey(apiKey);
      
      const result = await this._getDb().query(`
        SELECT 
          u.id AS user_id,
          u.email AS user_email,
          u.name AS user_name,
          u.role_id,
          r.name AS role_name
        FROM api_keys ak
        JOIN users u ON ak.user_id = u.id
        LEFT JOIN roles r ON u.role_id = r.id
        WHERE ak.key_hash = $1
          AND ak.is_active = TRUE
          AND u.is_active = TRUE
          AND (ak.expires_at IS NULL OR ak.expires_at > NOW())
      `, [keyHash]);
      
      if (result.rows.length === 0) {
        return null;
      }
      
      const row = result.rows[0];
      
      return {
        id: row.user_id,
        email: row.user_email,
        name: row.user_name,
        role_id: row.role_id,
        role: row.role_name
      };
      
    } catch (error) {
      logger.error('Failed to get user from API key:', error);
      return null;
    }
  }
  
  /**
   * Rotate an API key
   */
  async rotateApiKey(oldKeyId, gracePeriodMinutes = 60) {
    const trx = await this.db.transaction();
    
    try {
      // Get old key details
      const oldKeyResult = await trx.query(`
        SELECT id, user_id, name
        FROM api_keys
        WHERE id = $1 AND is_active = TRUE
        FOR UPDATE
      `, [oldKeyId]);
      
      if (oldKeyResult.rows.length === 0) {
        throw new Error('Invalid or inactive API key');
      }
      
      const oldKey = oldKeyResult.rows[0];
      
      // Generate new key
      const keyBytes = crypto.randomBytes(this.keyLength);
      const keyValue = keyBytes.toString('base64url');
      const envPrefix = process.env.NODE_ENV === 'production' ? 'prod' : 'test';
      const fullKey = `${this.keyPrefix}${envPrefix}_${keyValue}`;
      const keyPrefixPart = fullKey.substring(0, this.keyPrefix.length + envPrefix.length + 1 + 8);
      const keyHash = this.hashKey(fullKey);
      
      // Create new key
      const newKeyResult = await trx.query(`
        INSERT INTO api_keys (user_id, key_hash, key_prefix, name, rotated_from)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, key_prefix, created_at
      `, [
        oldKey.user_id,
        keyHash,
        keyPrefixPart,
        `${oldKey.name} (rotated)`,
        oldKeyId
      ]);
      
      const newKey = newKeyResult.rows[0];
      
      // Set expiration on old key
      const expiresAt = new Date(Date.now() + gracePeriodMinutes * 60 * 1000);
      await trx.query(`
        UPDATE api_keys
        SET expires_at = $2, rotated_at = NOW()
        WHERE id = $1
      `, [oldKeyId, expiresAt]);
      
      await trx.commit();
      
      logger.info('API key rotated', {
        oldKeyId,
        newKeyId: newKey.id,
        gracePeriodMinutes
      });
      
      return {
        id: newKey.id,
        key: fullKey,
        key_prefix: newKey.key_prefix,
        created_at: newKey.created_at,
        oldKeyExpiresAt: expiresAt
      };
      
    } catch (error) {
      await trx.rollback();
      logger.error('Failed to rotate API key:', error);
      throw error;
    }
  }
  
  /**
   * Revoke an API key
   */
  async revokeApiKey(keyId, revokedByUserId) {
    try {
      const result = await this._getDb().query(`
        UPDATE api_keys
        SET is_active = FALSE, 
            updated_at = NOW(),
            metadata = metadata || jsonb_build_object(
              'revoked_by', $2,
              'revoked_at', NOW()
            )
        WHERE id = $1 AND user_id = $2
        RETURNING id
      `, [keyId, revokedByUserId]);
      
      if (result.rows.length === 0) {
        return false;
      }
      
      logger.info('API key revoked', {
        keyId,
        revokedBy: revokedByUserId
      });
      
      return true;
      
    } catch (error) {
      logger.error('Failed to revoke API key:', error);
      throw error;
    }
  }
  
  /**
   * List user's API keys
   */
  async listUserApiKeys(userId, options = {}) {
    try {
      const query = options.includeInactive
        ? `SELECT id, name, key_prefix, created_at, expires_at, last_used_at, is_active, rotated_from
           FROM api_keys
           WHERE user_id = $1
           ORDER BY created_at DESC`
        : `SELECT id, name, key_prefix, created_at, expires_at, last_used_at, rotated_from
           FROM api_keys
           WHERE user_id = $1 AND is_active = TRUE
           ORDER BY created_at DESC`;
      
      const result = await this.db.query(query, [userId]);
      
      return result.rows.map(key => ({
        id: key.id,
        name: key.name,
        key_prefix: key.key_prefix,
        created_at: key.created_at,
        expires_at: key.expires_at,
        last_used_at: key.last_used_at,
        is_active: key.is_active !== false,
        is_rotated: !!key.rotated_from,
        is_expired: key.expires_at && new Date(key.expires_at) < new Date()
      }));
      
    } catch (error) {
      logger.error('Failed to list API keys:', error);
      throw error;
    }
  }
  
  /**
   * Record API key usage (for analytics)
   */
  async recordApiKeyUsage(apiKey) {
    try {
      const keyHash = this.hashKey(apiKey);
      
      await this._getDb().query(`
        UPDATE api_keys
        SET last_used_at = NOW()
        WHERE key_hash = $1
      `, [keyHash]);
      
    } catch (error) {
      // Don't throw, just log
      logger.warn('Failed to record API key usage:', error);
    }
  }
  
  /**
   * Clean up expired keys
   */
  async cleanupExpiredKeys() {
    try {
      const result = await this._getDb().query(`
        UPDATE api_keys
        SET is_active = FALSE
        WHERE expires_at < NOW() AND is_active = TRUE
        RETURNING id
      `);
      
      if (result.rows.length > 0) {
        logger.info('Cleaned up expired API keys', {
          count: result.rows.length,
          keyIds: result.rows.map(r => r.id)
        });
      }
      
      return result.rows.length;
      
    } catch (error) {
      logger.error('Failed to cleanup expired keys:', error);
      throw error;
    }
  }
  
  /**
   * Hash a key for storage
   */
  hashKey(key) {
    return crypto.createHash('sha256').update(key).digest('hex');
  }
}

module.exports = ApiKeyService;