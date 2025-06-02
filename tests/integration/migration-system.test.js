const MigrationManager = require('../../src/database/MigrationManager');
const DatabaseManager = require('../../src/database/DatabaseManager');
const fs = require('fs').promises;
const path = require('path');

// Unmock pg for integration tests - we need real database connections
jest.unmock('pg');

describe('Migration System Integration Tests', () => {
  let db;
  let migrationManager;
  let testMigrationsPath;

  beforeAll(async () => {
    // Setup test database connection
    db = new DatabaseManager();
        
    try {
      await db.initialize();
    } catch (error) {
      console.log('Database not available, skipping integration tests');
      return;
    }
        
    // Create temporary migrations directory for testing
    const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
    testMigrationsPath = path.join(__dirname, '../temp/migrations', timestamp);
    await fs.mkdir(testMigrationsPath, { recursive: true });
        
    // Initialize migration manager with test path
    migrationManager = new MigrationManager(db, testMigrationsPath);
        
    // Clean up any existing migration table
    try {
      await db.query('DROP TABLE IF EXISTS schema_migrations');
    } catch (error) {
      // Ignore if table doesn't exist
    }
  });

  afterAll(async () => {
    if (!db || !db.isConnected) {
      return;
    }
        
    // Clean up test migrations
    try {
      await fs.rm(testMigrationsPath, { recursive: true });
    } catch (error) {
      // Ignore if directory doesn't exist
    }
        
    // Clean up migration table and all test tables
    try {
      await db.query('DROP TABLE IF EXISTS posts CASCADE');
      await db.query('DROP TABLE IF EXISTS migration_test_users CASCADE');
      await db.query('DROP TABLE IF EXISTS integrity_test CASCADE');
      await db.query('DROP TABLE IF EXISTS status_test_1 CASCADE');
      await db.query('DROP TABLE IF EXISTS status_test_2 CASCADE');
      await db.query('DROP TABLE IF EXISTS schema_migrations CASCADE');
      await db.query('DROP TABLE IF EXISTS test_migration_table CASCADE');
    } catch (error) {
      // Ignore if tables don't exist
    }
        
    await db.close();
  });

  beforeEach(async () => {
    if (!db || !db.isConnected) {
      return;
    }
        
    // Clean up only migration-specific test tables, not system tables
    // Drop in correct order to handle foreign key constraints
    try {
      console.log('Cleaning up migration test tables...');
      // Only clean up tables that are specifically created by migration tests
      await db.query('DROP TABLE IF EXISTS posts CASCADE');
      await db.query('DROP TABLE IF EXISTS migration_test_users CASCADE');
      await db.query('DROP TABLE IF EXISTS integrity_test CASCADE');
      await db.query('DROP TABLE IF EXISTS status_test_1 CASCADE');
      await db.query('DROP TABLE IF EXISTS status_test_2 CASCADE');
      await db.query('DROP TABLE IF EXISTS schema_migrations CASCADE');
      await db.query('DROP TABLE IF EXISTS test_migration_table CASCADE');
      console.log('Migration test table cleanup completed');
    } catch (error) {
      console.log('Migration test table cleanup error (ignored):', error.message);
    }

    // Clean up any existing test migration files
    try {
      const files = await fs.readdir(testMigrationsPath);
      for (const file of files) {
        if (file.endsWith('.sql')) {
          await fs.unlink(path.join(testMigrationsPath, file));
        }
      }
    } catch (error) {
      // Ignore if directory doesn't exist
    }
        
    // Initialize migration system for each test
    await migrationManager.initializeMigrationTable();
  });

  describe('Full Migration Workflow', () => {
    it('should handle complete migration lifecycle', async () => {
      if (!db || !db.isConnected) {
        console.log('Skipping test - database not available');
        return;
      }
            
      // 1. Verify migration table was created
      const tableExists = await db.query(`
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_schema = 'public' 
                    AND table_name = 'schema_migrations'
                )
            `);
      expect(tableExists.rows[0].exists).toBe(true);

      // 2. Create test migration file
      const migrationContent = `-- Test Migration
CREATE TABLE test_migration_table (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- ROLLBACK
DROP TABLE IF EXISTS test_migration_table;`;

      const migrationFile = path.join(testMigrationsPath, '0001_create_test_table.sql');
      await fs.writeFile(migrationFile, migrationContent);

      // 3. Discover and apply migration
      const availableMigrations = await migrationManager.getAvailableMigrations();
      expect(availableMigrations).toHaveLength(1);
      expect(availableMigrations[0].version).toBe('0001');

      await migrationManager.applyMigration(availableMigrations[0]);

      // 4. Verify migration was applied
      const appliedMigrations = await migrationManager.getAppliedMigrations();
      expect(appliedMigrations).toHaveLength(1);
      expect(appliedMigrations[0].version).toBe('0001');

      // 5. Verify table was created
      const testTableExists = await db.query(`
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_schema = 'public' 
                    AND table_name = 'test_migration_table'
                )
            `);
      expect(testTableExists.rows[0].exists).toBe(true);

      // 6. Test rollback
      await migrationManager.rollbackMigration('0001');

      // 7. Verify table was dropped
      const testTableExistsAfterRollback = await db.query(`
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_schema = 'public' 
                    AND table_name = 'test_migration_table'
                )
            `);
      expect(testTableExistsAfterRollback.rows[0].exists).toBe(false);

      // 8. Verify migration was removed from tracking
      const appliedMigrationsAfterRollback = await migrationManager.getAppliedMigrations();
      expect(appliedMigrationsAfterRollback).toHaveLength(0);
    });

    it('should handle multiple migrations in sequence', async () => {
      if (!db || !db.isConnected) {
        console.log('Skipping test - database not available');
        return;
      }
            
      // Create multiple migration files
      const migrations = [
        {
          filename: '0001_create_migration_test_users_table.sql',
          content: `-- Create Users Table
CREATE TABLE migration_test_users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(255) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- ROLLBACK
DROP TABLE IF EXISTS migration_test_users;`
        },
        {
          filename: '0002_create_posts.sql',
          content: `-- Create Posts Table
CREATE TABLE posts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES migration_test_users(id),
    title VARCHAR(255) NOT NULL,
    content TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- ROLLBACK
DROP TABLE IF EXISTS posts;`
        },
        {
          filename: '0003_add_indexes.sql',
          content: `-- Add Performance Indexes
CREATE INDEX idx_migration_test_users_username ON migration_test_users(username);
CREATE INDEX idx_migration_test_users_email ON migration_test_users(email);
CREATE INDEX idx_posts_user_id ON posts(user_id);
CREATE INDEX idx_posts_created_at ON posts(created_at);

-- ROLLBACK
DROP INDEX IF EXISTS idx_migration_test_users_username;
DROP INDEX IF EXISTS idx_migration_test_users_email;
DROP INDEX IF EXISTS idx_posts_user_id;
DROP INDEX IF EXISTS idx_posts_created_at;`
        }
      ];

      // Write migration files
      for (const migration of migrations) {
        await fs.writeFile(
          path.join(testMigrationsPath, migration.filename),
          migration.content
        );
      }

      // Apply all migrations
      const availableMigrations = await migrationManager.getAvailableMigrations();
      expect(availableMigrations).toHaveLength(3);

      for (const migration of availableMigrations) {
        await migrationManager.applyMigration(migration);
      }

      // Verify all migrations were applied
      const appliedMigrations = await migrationManager.getAppliedMigrations();
      expect(appliedMigrations).toHaveLength(3);

      // Verify table structure
      const columns = await db.query(`
                SELECT column_name, data_type 
                FROM information_schema.columns 
                WHERE table_name = 'migration_test_users' 
                ORDER BY ordinal_position
            `);
      expect(columns.rows).toHaveLength(4); // id, username, email, created_at

      // Verify foreign key relationship
      const foreignKeys = await db.query(`
                SELECT constraint_name 
                FROM information_schema.table_constraints 
                WHERE table_name = 'posts' 
                AND constraint_type = 'FOREIGN KEY'
            `);
      expect(foreignKeys.rows.length).toBeGreaterThan(0);

      // Verify indexes were created
      const indexes = await db.query(`
                SELECT indexname 
                FROM pg_indexes 
                WHERE tablename IN ('migration_test_users', 'posts')
                AND indexname LIKE 'idx_%'
            `);
      expect(indexes.rows).toHaveLength(4);
    });

    it('should validate migration integrity', async () => {
      if (!db || !db.isConnected) {
        console.log('Skipping test - database not available');
        return;
      }
            
      // Create and apply a migration
      const migrationContent = `-- Test Migration
CREATE TABLE integrity_test (
    id SERIAL PRIMARY KEY,
    data VARCHAR(255)
);

-- ROLLBACK
DROP TABLE IF EXISTS integrity_test;`;

      const migrationFile = path.join(testMigrationsPath, '0001_integrity_test.sql');
      await fs.writeFile(migrationFile, migrationContent);

      const availableMigrations = await migrationManager.getAvailableMigrations();
      await migrationManager.applyMigration(availableMigrations[0]);

      // Validate migrations (should pass)
      let issues = await migrationManager.validateMigrations();
      expect(issues).toHaveLength(0);

      // Modify the migration file to simulate corruption
      const corruptedContent = migrationContent.replace('data VARCHAR(255)', 'data TEXT');
      await fs.writeFile(migrationFile, corruptedContent);

      // Validate migrations (should detect checksum mismatch)
      issues = await migrationManager.validateMigrations();
      expect(issues).toHaveLength(1);
      expect(issues[0].issue).toBe('checksum_mismatch');
      expect(issues[0].migration).toBe('0001');
    });

    it('should handle migration errors gracefully', async () => {
      if (!db || !db.isConnected) {
        console.log('Skipping test - database not available');
        return;
      }
            
      // Create invalid migration
      const invalidMigrationContent = `-- Invalid Migration
CREATE TABLE invalid_table (
    id SERIAL PRIMARY KEY,
    invalid_column INVALID_TYPE
);

-- ROLLBACK
DROP TABLE IF EXISTS invalid_table;`;

      const migrationFile = path.join(testMigrationsPath, '0001_invalid_migration.sql');
      await fs.writeFile(migrationFile, invalidMigrationContent);

      const availableMigrations = await migrationManager.getAvailableMigrations();

      // Attempt to apply invalid migration
      await expect(migrationManager.applyMigration(availableMigrations[0]))
        .rejects.toThrow();

      // Verify no migration was recorded
      const appliedMigrations = await migrationManager.getAppliedMigrations();
      expect(appliedMigrations).toHaveLength(0);

      // Verify no table was created
      const tableExists = await db.query(`
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_schema = 'public' 
                    AND table_name = 'invalid_table'
                )
            `);
      expect(tableExists.rows[0].exists).toBe(false);
    });
  });

  describe('Migration Status and Reporting', () => {
    it('should provide accurate status information', async () => {
      if (!db || !db.isConnected) {
        console.log('Skipping test - database not available');
        return;
      }

      // Create test migrations
      const migration1 = `-- Migration 1
CREATE TABLE status_test_1 (id SERIAL PRIMARY KEY);
-- ROLLBACK
DROP TABLE IF EXISTS status_test_1;`;

      const migration2 = `-- Migration 2  
CREATE TABLE status_test_2 (id SERIAL PRIMARY KEY);
-- ROLLBACK
DROP TABLE IF EXISTS status_test_2;`;

      await fs.writeFile(path.join(testMigrationsPath, '0001_status_test_1.sql'), migration1);
      await fs.writeFile(path.join(testMigrationsPath, '0002_status_test_2.sql'), migration2);

      // Apply first migration only
      const availableMigrations = await migrationManager.getAvailableMigrations();
      
      // Debug: Log what migrations we found
      console.log('Test migrations path:', testMigrationsPath);
      console.log('Available migrations:', availableMigrations);
      console.log('Migration manager path:', migrationManager.migrationsPath);
      
      await migrationManager.applyMigration(availableMigrations[0]);

      // Check status
      const status = await migrationManager.getStatus();
      
      // Debug: Log the actual status
      console.log('Migration status:', status);
      
      expect(status.available).toBe(2);
      expect(status.applied).toBe(1);
      expect(status.pending).toBe(1);
      expect(status.appliedMigrations).toHaveLength(1);
      expect(status.pendingMigrations).toHaveLength(1);
      expect(status.appliedMigrations[0].version).toBe('0001');
      expect(status.pendingMigrations[0].version).toBe('0002');
    });
  });
});
