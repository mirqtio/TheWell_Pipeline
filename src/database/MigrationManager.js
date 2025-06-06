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
     * Apply a single migration
     */
  async applyMigration(version, name, forwardScript, rollbackScript = '') {
    const checksum = this.calculateChecksum(forwardScript || '');
    const usesConcurrently = forwardScript && forwardScript.toUpperCase().includes('CREATE INDEX CONCURRENTLY');

    let client = await this.db.getClient();

    try {
      if (usesConcurrently) {
        // For scripts with CREATE INDEX CONCURRENTLY:
        // 1. Ensure the client is not in a transaction.
        try {
          await client.query('ROLLBACK'); // End any existing transaction
        } catch (e) { /* Ignore if no transaction active */ }
        try {
          await client.query('COMMIT');
          console.error(`[Migration ${version} (${name})] COMMIT Non-Concurrent Transaction`);
          console.log(`[Migration ${version} (${name})] COMMIT transaction`); // Attempt to clear any aborted transaction state
        } catch (e) { /* Ignore if no transaction or already committed */ }

        // 2. Run the main script (index creation) outside an explicit transaction, statement by statement.
        if (forwardScript) {
          const statements = forwardScript.split(';')
            .map(stmt => stmt.trim())
            .filter(stmt => stmt.length > 0);
          
          for (const stmt of statements) {
            // Add back the semicolon if it's a complete statement, though pg might not need it for single statements.
            // However, CREATE INDEX CONCURRENTLY must be the only statement in its batch.
            console.log(`[Migration ${version} (${name})] Executing statement ${statements.indexOf(stmt) + 1}/${statements.length}: ${stmt.substring(0, 100)}...`);
            try {
              console.error(`[Migration ${version} (${name})] Executing NC Stmt ${statements.indexOf(stmt) + 1}/${statements.length}: ${stmt.substring(0, 150).replace(/\n/g, ' ')}...`);
              try {
                await client.query(stmt);
                console.error(`[Migration ${version} (${name})] NC Stmt ${statements.indexOf(stmt) + 1} executed successfully.`);
              } catch (stmtError) {
                console.error(`[Migration ${version} (${name})] ERROR executing NC Stmt ${statements.indexOf(stmt) + 1}: ${stmtError.message}`);
                console.error(`[Migration ${version} (${name})] Failing NC Stmt: ${stmt}`);
                throw stmtError;
              }
              console.log(`[Migration ${version} (${name})] Statement ${statements.indexOf(stmt) + 1} executed successfully.`);
            } catch (stmtError) {
              console.error(`[Migration ${version} (${name})] ERROR executing statement ${statements.indexOf(stmt) + 1}: ${stmtError.message}`);
              console.error(`[Migration ${version} (${name})] Failing statement: ${stmt}`);
              throw stmtError; // Re-throw to be caught by the outer try/catch
            } 
          }
        }
        client.release(); // Release this client

        // 3. Record the migration in its own, new transaction with a fresh client.
        client = await this.db.getClient(); // Acquire a fresh client
        await client.query('BEGIN');
        console.error(`[Migration ${version} (${name})] BEGIN Non-Concurrent Transaction`);
        console.log(`[Migration ${version} (${name})] BEGIN transaction`);
        await client.query(
          `INSERT INTO ${this.migrationTableName} (version, name, rollback_script, checksum) 
                   VALUES ($1, $2, $3, $4)`,
          [version, name, rollbackScript, checksum]
        );
        await client.query('COMMIT');
      } else {
        // Original behavior: wrap DDL and recording in a single transaction.
        await client.query('BEGIN');
        console.error(`[Migration ${version} (${name})] BEGIN Non-Concurrent Transaction`);
        if (forwardScript) {
          console.error(`[Migration ${version} (${name})] Executing Non-Concurrent Script (first 300 chars): ${forwardScript.substring(0, 300).replace(/\n/g, ' ')}...`);
          try {
            await client.query(forwardScript);
            console.error(`[Migration ${version} (${name})] Non-Concurrent Script executed successfully.`);
          } catch (scriptError) {
            console.error(`[Migration ${version} (${name})] ERROR executing Non-Concurrent Script: ${scriptError.message}`);
            const scriptToLog = forwardScript.length > 1000 ? forwardScript.substring(0, 1000) + '... (truncated)' : forwardScript;
            console.error(`[Migration ${version} (${name})] Failing Non-Concurrent Script: ${scriptToLog}`);
            throw scriptError;
          }
        }
        await client.query(
          `INSERT INTO ${this.migrationTableName} (version, name, rollback_script, checksum) 
                   VALUES ($1, $2, $3, $4)`,
          [version, name, rollbackScript, checksum]
        );
        await client.query('COMMIT');
        console.error(`[Migration ${version} (${name})] COMMIT Non-Concurrent Transaction`);

        // **** BEGIN NEW DIAGNOSTIC ****
        try {
          if (forwardScript && forwardScript.includes('CREATE TABLE e2e_test_documents')) {
            const checkResult = await client.query('SELECT to_regclass(\'public.e2e_test_documents\');');
            console.error(`[Migration ${version} (${name})] POST-COMMIT CHECK for e2e_test_documents: ${JSON.stringify(checkResult.rows[0])}`);
          }
          if (forwardScript && forwardScript.includes('CREATE TABLE integrity_test')) {
            const checkResult = await client.query('SELECT to_regclass(\'public.integrity_test\');');
            console.error(`[Migration ${version} (${name})] POST-COMMIT CHECK for integrity_test: ${JSON.stringify(checkResult.rows[0])}`);
          }
        } catch (diagError) {
          console.error(`[Migration ${version} (${name})] POST-COMMIT DIAGNOSTIC QUERY FAILED: ${diagError.message}`);
        }
        // **** END NEW DIAGNOSTIC ****

        try {
          await client.query('DISCARD ALL;');
          console.error(`[Migration ${version} (${name})] Session state discarded after non-concurrent commit.`);
        } catch (discardError) {
          console.error(`[Migration ${version} (${name})] FAILED to DISCARD ALL: ${discardError.message}`);
          // Decide if this should be a fatal error for the migration
        }
      }
      console.error(`[Migration ${version} (${name})] Successfully applied and recorded.`);
    } catch (error) {
      // Attempt to rollback only if we explicitly started a transaction for non-concurrent or recording part.
      if (client && client.activeQuery === null) { // Check if client is not busy and can issue rollback
        try {
          // For concurrent, the recording part is in its own transaction.
          // For non-concurrent, the whole thing is in one transaction.
          await client.query('ROLLBACK');
        } catch (rbError) {
          console.error(`Rollback attempt failed for ${version} (${name}): ${rbError.message}`);
        }
      }
      console.error(`[Migration ${version} (${name})] Overall failure: ${error.message}`);
      throw new Error(`Failed to apply migration ${version} (${name}): ${error.message}`);
    } finally {
      if (client) {
        client.release();
      }
    }
  }

  /**
     * Rollback a single migration
     */
  async rollbackMigration(version, name, rollbackScriptContent) {
    if (!rollbackScriptContent || rollbackScriptContent.trim() === '') {
      throw new Error(`Empty rollback script provided for migration ${version} (${name})`);
    }

    const client = await this.db.getClient();
    try {
      await client.query('BEGIN');
      
      // Apply rollback script
      await client.query(rollbackScriptContent);
      
      // Remove migration record
      await client.query(
        `DELETE FROM ${this.migrationTableName} WHERE version = $1`,
        [version]
      );
      
      await client.query('COMMIT');
      console.log(`Rolled back migration ${version}: ${name}`);
            
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
      const scriptContent = await fs.readFile(path.join(this.migrationsPath, migration.filename), 'utf-8');
      await this.applyMigration(migration.version, migration.name, scriptContent);
      // DIAGNOSTIC DELAY
      console.error(`[MigrationManager.migrate] DIAGNOSTIC: Pausing for 200ms after applying ${migration.version}`);
      await new Promise(resolve => setTimeout(resolve, 200));
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
