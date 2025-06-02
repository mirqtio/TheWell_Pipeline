const fs = require('fs').promises;
const path = require('path');
const DatabaseManager = require('./DatabaseManager');

/**
 * Migration Manager for handling database schema migrations
 * Supports forward migrations, rollbacks, and migration tracking
 */
class MigrationManager {
  constructor(databaseManager = null, migrationsPath = null) {
    this.db = databaseManager || new DatabaseManager();
    this.migrationsPath = migrationsPath || path.join(__dirname, 'migrations');
    this.migrationTableName = 'schema_migrations';
  }

  /**
     * Initialize migration tracking table
     */
  async initializeMigrationTable() {
    const query = `
            CREATE TABLE IF NOT EXISTS ${this.migrationTableName} (
                id SERIAL PRIMARY KEY,
                version VARCHAR(255) UNIQUE NOT NULL,
                name VARCHAR(500) NOT NULL,
                applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                rollback_script TEXT,
                checksum VARCHAR(64) NOT NULL
            );
            
            CREATE INDEX IF NOT EXISTS idx_schema_migrations_version 
            ON ${this.migrationTableName}(version);
        `;
        
    await this.db.query(query);
  }

  /**
     * Get list of available migration files
     */
  async getAvailableMigrations() {
    try {
      const files = await fs.readdir(this.migrationsPath);
      return files
        .filter(file => file.endsWith('.sql') && file.match(/^\d{4}_/))
        .sort()
        .map(file => {
          const version = file.split('_')[0];
          const name = file.replace(/^\d{4}_/, '').replace('.sql', '');
          return { version, name, filename: file };
        });
    } catch (error) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  /**
     * Get list of applied migrations
     */
  async getAppliedMigrations() {
    await this.initializeMigrationTable();
        
    const result = await this.db.query(
      `SELECT version, name, applied_at FROM ${this.migrationTableName} ORDER BY version`
    );
        
    return result.rows;
  }

  /**
     * Get pending migrations
     */
  async getPendingMigrations() {
    const available = await this.getAvailableMigrations();
    const applied = await this.getAppliedMigrations();
    const appliedVersions = new Set(applied.map(m => m.version));
        
    return available.filter(m => !appliedVersions.has(m.version));
  }

  /**
     * Calculate checksum for migration content
     */
  calculateChecksum(content) {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
     * Parse migration file to extract forward and rollback scripts
     */
  parseMigrationFile(content) {
    const lines = content.split('\n');
    let forwardScript = [];
    let rollbackScript = [];
    let currentSection = 'forward';
        
    for (const line of lines) {
      const trimmed = line.trim();
            
      if (trimmed === '-- ROLLBACK') {
        currentSection = 'rollback';
        continue;
      }
            
      if (currentSection === 'forward') {
        forwardScript.push(line);
      } else if (currentSection === 'rollback') {
        rollbackScript.push(line);
      }
    }
        
    return {
      forward: forwardScript.join('\n').trim(),
      rollback: rollbackScript.join('\n').trim()
    };
  }

  /**
     * Apply a single migration
     */
  async applyMigration(migration) {
    const filePath = path.join(this.migrationsPath, migration.filename);
    const content = await fs.readFile(filePath, 'utf8');
    const checksum = this.calculateChecksum(content);
    const { forward, rollback } = this.parseMigrationFile(content);
        
    // Start transaction
    const client = await this.db.getClient();
        
    try {
      await client.query('BEGIN');
            
      // Apply forward migration
      if (forward) {
        await client.query(forward);
      }
            
      // Record migration
      await client.query(
        `INSERT INTO ${this.migrationTableName} (version, name, rollback_script, checksum) 
                 VALUES ($1, $2, $3, $4)`,
        [migration.version, migration.name, rollback, checksum]
      );
            
      await client.query('COMMIT');
            
      console.log(`Applied migration ${migration.version}: ${migration.name}`);
            
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(`Failed to apply migration ${migration.version}: ${error.message}`);
    } finally {
      client.release();
    }
  }

  /**
     * Rollback a single migration
     */
  async rollbackMigration(version) {
    const applied = await this.getAppliedMigrations();
    const migration = applied.find(m => m.version === version);
        
    if (!migration) {
      throw new Error(`Migration ${version} not found in applied migrations`);
    }
        
    const result = await this.db.query(
      `SELECT rollback_script FROM ${this.migrationTableName} WHERE version = $1`,
      [version]
    );
        
    if (result.rows.length === 0) {
      throw new Error(`No rollback script found for migration ${version}`);
    }
        
    const rollbackScript = result.rows[0].rollback_script;
        
    if (!rollbackScript || rollbackScript.trim() === '') {
      throw new Error(`Empty rollback script for migration ${version}`);
    }
        
    // Start transaction
    const client = await this.db.getClient();
        
    try {
      await client.query('BEGIN');
            
      // Apply rollback script
      await client.query(rollbackScript);
            
      // Remove migration record
      await client.query(
        `DELETE FROM ${this.migrationTableName} WHERE version = $1`,
        [version]
      );
            
      await client.query('COMMIT');
            
      console.log(`Rolled back migration ${version}`);
            
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(`Failed to rollback migration ${version}: ${error.message}`);
    } finally {
      client.release();
    }
  }

  /**
     * Apply all pending migrations
     */
  async migrate() {
    const pending = await this.getPendingMigrations();
        
    if (pending.length === 0) {
      console.log('No pending migrations');
      return;
    }
        
    console.log(`Applying ${pending.length} pending migrations...`);
        
    for (const migration of pending) {
      await this.applyMigration(migration);
    }
        
    console.log('All migrations applied successfully');
  }

  /**
     * Rollback to a specific version
     */
  async rollbackTo(targetVersion) {
    const applied = await this.getAppliedMigrations();
    const toRollback = applied
      .filter(m => m.version > targetVersion)
      .sort((a, b) => b.version.localeCompare(a.version)); // Reverse order
        
    if (toRollback.length === 0) {
      console.log(`Already at or before version ${targetVersion}`);
      return;
    }
        
    console.log(`Rolling back ${toRollback.length} migrations to version ${targetVersion}...`);
        
    for (const migration of toRollback) {
      await this.rollbackMigration(migration.version);
    }
        
    console.log(`Rollback to version ${targetVersion} completed`);
  }

  /**
     * Get migration status
     */
  async getStatus() {
    const available = await this.getAvailableMigrations();
    const applied = await this.getAppliedMigrations();
    const pending = await this.getPendingMigrations();
        
    return {
      available: available.length,
      applied: applied.length,
      pending: pending.length,
      appliedMigrations: applied,
      pendingMigrations: pending
    };
  }

  /**
     * Validate migration integrity
     */
  async validateMigrations() {
    const applied = await this.getAppliedMigrations();
    const issues = [];
        
    for (const migration of applied) {
      try {
        const filePath = path.join(this.migrationsPath, `${migration.version}_${migration.name}.sql`);
        const content = await fs.readFile(filePath, 'utf8');
        const currentChecksum = this.calculateChecksum(content);
                
        const result = await this.db.query(
          `SELECT checksum FROM ${this.migrationTableName} WHERE version = $1`,
          [migration.version]
        );
                
        if (result.rows.length > 0) {
          const storedChecksum = result.rows[0].checksum;
          if (currentChecksum !== storedChecksum) {
            issues.push({
              migration: migration.version,
              issue: 'checksum_mismatch',
              message: 'Migration file has been modified after application'
            });
          }
        }
      } catch (error) {
        issues.push({
          migration: migration.version,
          issue: 'file_missing',
          message: 'Migration file not found'
        });
      }
    }
        
    return issues;
  }

  /**
     * Create a new migration file template
     */
  async createMigration(name) {
    const available = await this.getAvailableMigrations();
    const lastVersion = available.length > 0 ? 
      Math.max(...available.map(m => parseInt(m.version))) : 0;
    const newVersion = String(lastVersion + 1).padStart(4, '0');
        
    const filename = `${newVersion}_${name.replace(/[^a-zA-Z0-9]/g, '_')}.sql`;
    const filePath = path.join(this.migrationsPath, filename);
        
    const template = `-- Migration: ${name}
-- Version: ${newVersion}
-- Created: ${new Date().toISOString()}

-- Forward migration
-- Add your forward migration SQL here


-- ROLLBACK
-- Add your rollback SQL here

`;
        
    await fs.writeFile(filePath, template);
    console.log(`Created migration file: ${filename}`);
        
    return { version: newVersion, filename, path: filePath };
  }
}

module.exports = MigrationManager;
