const fs = require('fs').promises;
const path = require('path');
const { Pool } = require('pg');
const logger = require('../utils/logger');

/**
 * DatabaseManager - Handles database connections, migrations, and operations
 */
class DatabaseManager {
  constructor(config = {}) {
    // Support DATABASE_URL for CI/production environments
    if (process.env.DATABASE_URL && !config.connectionString) {
      this.config = {
        connectionString: process.env.DATABASE_URL,
        max: config.max || 20,
        idleTimeoutMillis: config.idleTimeoutMillis || 30000,
        connectionTimeoutMillis: config.connectionTimeoutMillis || 2000,
        ...config
      };
    } else {
      this.config = {
        host: config.host || process.env.DB_HOST || 'localhost',
        port: parseInt(config.port || process.env.DB_PORT || 5432),
        database: config.database || process.env.DB_NAME || 'thewell_pipeline',
        user: config.user || process.env.DB_USER || 'postgres',
        password: config.password || process.env.DB_PASSWORD || '',
        max: config.max || 20,
        idleTimeoutMillis: config.idleTimeoutMillis || 30000,
        connectionTimeoutMillis: config.connectionTimeoutMillis || 2000,
        ...config
      };
    }
        
    this.pool = null;
    this.isConnected = false;
  }

  /**
     * Initialize database connection
     */
  async initialize() {
    try {
      this.pool = new Pool(this.config);
            
      // Test connection
      const client = await this.pool.connect();
      await client.query('SELECT NOW()');
      client.release();
            
      this.isConnected = true;
      logger.info('Database connection established successfully', {
        host: this.config.host,
        port: this.config.port,
        database: this.config.database
      });
            
      return this;
    } catch (error) {
      logger.error('Failed to initialize database connection', { error: error.message });
      throw error;
    }
  }

  /**
     * Execute a query with parameters
     */
  async query(text, params = []) {
    if (!this.isConnected) {
      throw new Error('Database not connected. Call initialize() first.');
    }

    const start = Date.now();
    try {
      const result = await this.pool.query(text, params);
      const duration = Date.now() - start;
            
      logger.debug('Database query executed', {
        query: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
        duration,
        rows: result.rowCount
      });
            
      return result;
    } catch (error) {
      const duration = Date.now() - start;
      logger.error('Database query failed', {
        query: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
        duration,
        error: error.message
      });
      throw error;
    }
  }

  /**
     * Execute a transaction
     */
  async transaction(callback) {
    const client = await this.pool.connect();
        
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
     * Apply database schema
     */
  async applySchema() {
    try {
      const schemaPath = path.join(__dirname, 'schema.sql');
      const schemaSQL = await fs.readFile(schemaPath, 'utf8');
            
      logger.info('Applying database schema...');
      await this.query(schemaSQL);
      logger.info('Database schema applied successfully');
            
      return true;
    } catch (error) {
      // Ignore "already exists" errors for idempotent schema application
      if (error.message.includes('already exists')) {
        logger.info('Database schema already exists, skipping application');
        return true;
      }
      logger.error('Failed to apply database schema', { error: error.message });
      throw error;
    }
  }

  /**
     * Run database migrations
     */
  async runMigrations() {
    try {
      // Create migrations table if it doesn't exist
      await this.query(`
                CREATE TABLE IF NOT EXISTS schema_migrations (
                    id SERIAL PRIMARY KEY,
                    filename VARCHAR(255) NOT NULL UNIQUE,
                    applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                )
            `);

      const migrationsDir = path.join(__dirname, 'migrations');
            
      try {
        const files = await fs.readdir(migrationsDir);
        const migrationFiles = files
          .filter(file => file.endsWith('.sql'))
          .sort();

        for (const file of migrationFiles) {
          const { rows } = await this.query(
            'SELECT id FROM schema_migrations WHERE filename = $1',
            [file]
          );

          if (rows.length === 0) {
            logger.info(`Running migration: ${file}`);
                        
            const migrationPath = path.join(migrationsDir, file);
            const migrationSQL = await fs.readFile(migrationPath, 'utf8');
                        
            await this.transaction(async (client) => {
              await client.query(migrationSQL);
              await client.query(
                'INSERT INTO schema_migrations (filename) VALUES ($1)',
                [file]
              );
            });
                        
            logger.info(`Migration completed: ${file}`);
          }
        }
                
        logger.info('All migrations completed successfully');
      } catch (dirError) {
        if (dirError.code === 'ENOENT') {
          logger.info('No migrations directory found, skipping migrations');
        } else {
          throw dirError;
        }
      }
            
      return true;
    } catch (error) {
      logger.error('Failed to run migrations', { error: error.message });
      throw error;
    }
  }

  /**
     * Check database health
     */
  async healthCheck() {
    try {
      const result = await this.query('SELECT NOW() as current_time, version() as version');
      return {
        status: 'healthy',
        timestamp: result.rows[0].current_time,
        version: result.rows[0].version,
        connected: this.isConnected
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        connected: false
      };
    }
  }

  /**
     * Get database statistics
     */
  async getStats() {
    try {
      const tables = [
        'sources', 'documents', 'jobs', 'document_visibility',
        'review_sessions', 'document_reviews', 'document_enrichments'
      ];
            
      const stats = {};
            
      for (const table of tables) {
        const result = await this.query(`SELECT COUNT(*) as count FROM ${table}`);
        stats[table] = parseInt(result.rows[0].count);
      }
            
      // Get active jobs
      const activeJobsResult = await this.query(
        'SELECT COUNT(*) as count FROM jobs WHERE status IN (\'pending\', \'running\')'
      );
      stats.active_jobs = parseInt(activeJobsResult.rows[0].count);
            
      // Get recent documents (last 24 hours)
      const recentDocsResult = await this.query(
        'SELECT COUNT(*) as count FROM documents WHERE created_at > NOW() - INTERVAL \'24 hours\''
      );
      stats.recent_documents = parseInt(recentDocsResult.rows[0].count);
            
      return stats;
    } catch (error) {
      logger.error('Failed to get database stats', { error: error.message });
      throw error;
    }
  }

  /**
     * Clean up old data
     */
  async cleanup(options = {}) {
    const {
      jobLogRetentionDays = 30,
      completedJobRetentionDays = 7,
      auditLogRetentionDays = 90
    } = options;

    try {
      const cleanupQueries = [
        // Clean old job logs
        {
          query: 'DELETE FROM job_logs WHERE created_at < NOW() - INTERVAL $1',
          params: [`${jobLogRetentionDays} days`],
          description: 'job logs'
        },
        // Clean completed jobs
        {
          query: 'DELETE FROM jobs WHERE status = \'completed\' AND completed_at < NOW() - INTERVAL $1',
          params: [`${completedJobRetentionDays} days`],
          description: 'completed jobs'
        },
        // Clean old audit logs
        {
          query: 'DELETE FROM visibility_audit_log WHERE created_at < NOW() - INTERVAL $1',
          params: [`${auditLogRetentionDays} days`],
          description: 'audit logs'
        }
      ];

      const results = {};
            
      for (const { query, params, description } of cleanupQueries) {
        const result = await this.query(query, params);
        results[description] = result.rowCount;
        logger.info(`Cleaned up ${result.rowCount} old ${description}`);
      }
            
      return results;
    } catch (error) {
      logger.error('Failed to cleanup database', { error: error.message });
      throw error;
    }
  }

  /**
     * Close database connection
     */
  async close() {
    if (this.pool) {
      await this.pool.end();
      this.isConnected = false;
      logger.info('Database connection closed');
    }
  }

  /**
     * Get a client for manual transaction management
     */
  async getClient() {
    return await this.pool.connect();
  }
}

module.exports = DatabaseManager;
