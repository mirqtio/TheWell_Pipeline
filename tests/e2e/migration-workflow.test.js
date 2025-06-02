const MigrationManager = require('../../src/database/MigrationManager');
const DatabaseManager = require('../../src/database/DatabaseManager');
const { PerformanceTestRunner } = require('../performance/PerformanceTestRunner');
const { SecurityAuditor } = require('../security/SecurityAuditor');
const fs = require('fs').promises;
const path = require('path');

// Unmock pg for E2E tests - we need real database connections
jest.unmock('pg');

describe('End-to-End Migration Workflow Tests', () => {
  let migrationManager;
  let db;
  let performanceRunner;
  let securityAuditor;
  let testMigrationsPath;

  beforeAll(async () => {
    // Setup database connection
    db = new DatabaseManager();
        
    try {
      await db.initialize();
    } catch (error) {
      console.log('Database not available, skipping E2E tests');
      return;
    }
        
    // Create test migrations directory
    testMigrationsPath = path.join(__dirname, '../temp/e2e-migrations');
    await fs.mkdir(testMigrationsPath, { recursive: true });
        
    // Initialize components
    migrationManager = new MigrationManager(db, testMigrationsPath);
    performanceRunner = new PerformanceTestRunner();
    securityAuditor = new SecurityAuditor();
        
    // Clean up any existing test data
    try {
      await db.query('DROP TABLE IF EXISTS schema_migrations');
      await db.query('DROP TABLE IF EXISTS e2e_test_documents');
      await db.query('DROP TABLE IF EXISTS e2e_test_sources');
      await db.query('DROP TABLE IF EXISTS audit_log');
    } catch (error) {
      // Ignore if tables don't exist
    }
  });

  afterAll(async () => {
    if (!db || !db.isConnected) {
      return;
    }
        
    // Clean up test migrations directory
    try {
      await fs.rm(testMigrationsPath, { recursive: true });
    } catch (error) {
      // Ignore if directory doesn't exist
    }
        
    // Clean up test tables
    try {
      await db.query('DROP TABLE IF EXISTS schema_migrations');
      await db.query('DROP TABLE IF EXISTS e2e_test_documents');
      await db.query('DROP TABLE IF EXISTS e2e_test_sources');
      await db.query('DROP TABLE IF EXISTS audit_log');
    } catch (error) {
      // Ignore if tables don't exist
    }
        
    await db.close();
  });

  beforeEach(async () => {
    if (!db || !db.isConnected) {
      return;
    }
    
    // Clean up any existing test data and migration state
    try {
      await db.query('DROP TABLE IF EXISTS schema_migrations');
      await db.query('DROP TABLE IF EXISTS e2e_test_documents');
      await db.query('DROP TABLE IF EXISTS e2e_test_sources');
      await db.query('DROP TABLE IF EXISTS audit_log');
      await db.query('DROP TABLE IF EXISTS integrity_test');
    } catch (error) {
      // Ignore if tables don't exist
    }
    
    // Clean up migration files
    try {
      const files = await fs.readdir(testMigrationsPath);
      for (const file of files) {
        if (file.endsWith('.sql')) {
          await fs.unlink(path.join(testMigrationsPath, file));
        }
      }
    } catch (error) {
      // Ignore if directory doesn't exist or is empty
    }
  });

  describe('Complete System Migration and Testing Workflow', () => {
    it('should execute full migration lifecycle with performance and security validation', async () => {
      if (!db || !db.isConnected) {
        console.log('Skipping test - database not available');
        return;
      }
            
      console.log('Starting E2E migration workflow test...');
            
      // Step 1: Initialize migration system
      console.log('Step 1: Initializing migration system...');
      await migrationManager.initializeMigrationTable();
            
      // Step 2: Create comprehensive migration files
      console.log('Step 2: Creating migration files...');
            
      // Migration 1: Create base tables
      const migration1 = `-- E2E Test Migration 1: Create Base Tables
CREATE TABLE e2e_test_sources (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL,
    config JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE e2e_test_documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_id UUID REFERENCES e2e_test_sources(id),
    title VARCHAR(500) NOT NULL,
    content TEXT,
    url VARCHAR(1000),
    hash VARCHAR(64),
    metadata JSONB DEFAULT '{}',
    visibility VARCHAR(20) DEFAULT 'private',
    quality_score DECIMAL(3,2),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ROLLBACK
DROP TABLE IF EXISTS e2e_test_documents;
DROP TABLE IF EXISTS e2e_test_sources;`;

      // Migration 2: Add performance indexes
      const migration2 = `-- E2E Test Migration 2: Add Performance Indexes
CREATE INDEX idx_e2e_documents_source_id ON e2e_test_documents(source_id);
CREATE INDEX idx_e2e_documents_visibility ON e2e_test_documents(visibility);
CREATE INDEX idx_e2e_documents_hash ON e2e_test_documents(hash) WHERE hash IS NOT NULL;
CREATE INDEX idx_e2e_documents_created_at ON e2e_test_documents(created_at);
CREATE INDEX idx_e2e_documents_metadata_gin ON e2e_test_documents USING gin(metadata);

-- ROLLBACK
DROP INDEX IF EXISTS idx_e2e_documents_source_id;
DROP INDEX IF EXISTS idx_e2e_documents_visibility;
DROP INDEX IF EXISTS idx_e2e_documents_hash;
DROP INDEX IF EXISTS idx_e2e_documents_created_at;
DROP INDEX IF EXISTS idx_e2e_documents_metadata_gin;`;

      // Migration 3: Add audit logging
      const migration3 = `-- E2E Test Migration 3: Add Audit Logging
CREATE TABLE audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    table_name VARCHAR(100) NOT NULL,
    operation VARCHAR(10) NOT NULL,
    record_id UUID,
    old_values JSONB,
    new_values JSONB,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_audit_log_table_operation ON audit_log(table_name, operation);
CREATE INDEX idx_audit_log_timestamp ON audit_log(timestamp);

-- ROLLBACK
DROP TABLE IF EXISTS audit_log;`;

      await fs.writeFile(path.join(testMigrationsPath, '0001_create_base_tables.sql'), migration1);
      await fs.writeFile(path.join(testMigrationsPath, '0002_add_performance_indexes.sql'), migration2);
      await fs.writeFile(path.join(testMigrationsPath, '0003_add_audit_logging.sql'), migration3);

      // Step 3: Verify migrations are detected
      console.log('Step 3: Verifying migration detection...');
      const availableMigrations = await migrationManager.getAvailableMigrations();
      expect(availableMigrations).toHaveLength(3);
            
      const pendingMigrations = await migrationManager.getPendingMigrations();
      expect(pendingMigrations).toHaveLength(3);

      // Step 4: Apply all migrations
      console.log('Step 4: Applying migrations...');
      await migrationManager.migrate();
            
      // Verify all migrations were applied
      const appliedMigrations = await migrationManager.getAppliedMigrations();
      expect(appliedMigrations).toHaveLength(3);
            
      const remainingPending = await migrationManager.getPendingMigrations();
      expect(remainingPending).toHaveLength(0);

      // Step 5: Validate database structure
      console.log('Step 5: Validating database structure...');
            
      // Check tables exist
      const tablesResult = await db.query(`
                SELECT table_name 
                FROM information_schema.tables 
                WHERE table_name IN ('e2e_test_sources', 'e2e_test_documents', 'audit_log')
                ORDER BY table_name
            `);
      expect(tablesResult.rows).toHaveLength(3);
            
      // Check indexes exist
      const indexesResult = await db.query(`
                SELECT indexname 
                FROM pg_indexes 
                WHERE tablename IN ('e2e_test_documents', 'audit_log')
                AND indexname LIKE 'idx_%'
                ORDER BY indexname
            `);
      expect(indexesResult.rows.length).toBeGreaterThan(5);

      // Step 6: Populate test data
      console.log('Step 6: Populating test data...');
            
      // Insert test source
      const sourceResult = await db.query(`
                INSERT INTO e2e_test_sources (name, type, config) 
                VALUES ('Test Source', 'web', '{"url": "https://example.com"}')
                RETURNING id
            `);
      const sourceId = sourceResult.rows[0].id;
            
      // Insert test documents
      const testDocuments = [];
      for (let i = 0; i < 100; i++) {
        const isPublic = i % 2 === 0;
        // Ensure public documents have quality_score > 3.0 for predictable test results
        const qualityScore = isPublic ? (3.5 + Math.random() * 1.5).toFixed(2) : (Math.random() * 5).toFixed(2);
        
        testDocuments.push([
          sourceId,
          `Test Document ${i}`,
          `This is test content for document ${i}`,
          `https://example.com/doc${i}`,
          `hash${i}`,
          JSON.stringify({ test: true, index: i }),
          isPublic ? 'public' : 'private',
          qualityScore
        ]);
      }
            
      for (const doc of testDocuments) {
        await db.query(`
                    INSERT INTO e2e_test_documents 
                    (source_id, title, content, url, hash, metadata, visibility, quality_score)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                `, doc);
      }

      // Step 7: Run performance tests
      console.log('Step 7: Running performance tests...');
            
      // Test query performance with indexes
      const queryStart = process.hrtime.bigint();
      const queryResult = await db.query(`
                SELECT COUNT(*) 
                FROM e2e_test_documents 
                WHERE visibility = 'public' 
                AND quality_score > 3.0
            `);
      const queryEnd = process.hrtime.bigint();
      const queryTime = Number(queryEnd - queryStart) / 1000000; // Convert to milliseconds
            
      expect(queryResult.rows[0].count).toBe('50'); // 50 public documents
      expect(queryTime).toBeLessThan(100); // Should be fast with indexes
            
      // Test metadata JSONB query performance
      const jsonbStart = process.hrtime.bigint();
      const jsonbResult = await db.query(`
                SELECT COUNT(*) 
                FROM e2e_test_documents 
                WHERE metadata->>'test' = 'true'
            `);
      const jsonbEnd = process.hrtime.bigint();
      const jsonbTime = Number(jsonbEnd - jsonbStart) / 1000000;
            
      expect(jsonbResult.rows[0].count).toBe('100'); // All documents have test: true
      expect(jsonbTime).toBeLessThan(200); // Should be reasonably fast with GIN index

      // Step 8: Run security validation
      console.log('Step 8: Running security validation...');
            
      // Test SQL injection protection (should not affect results)
      const maliciousInput = '\'; DROP TABLE e2e_test_documents; --';
      const securityResult = await db.query(`
                SELECT COUNT(*) 
                FROM e2e_test_documents 
                WHERE title ILIKE $1
            `, [`%${maliciousInput}%`]);
            
      expect(securityResult.rows[0].count).toBe('0'); // No matches for malicious input
            
      // Verify table still exists (wasn't dropped)
      const tableStillExists = await db.query(`
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_name = 'e2e_test_documents'
                )
            `);
      expect(tableStillExists.rows[0].exists).toBe(true);

      // Step 9: Test migration validation
      console.log('Step 9: Testing migration validation...');
      const validationIssues = await migrationManager.validateMigrations();
      expect(validationIssues).toHaveLength(0); // No integrity issues

      // Step 10: Test rollback functionality
      console.log('Step 10: Testing rollback functionality...');
            
      // Rollback last migration (audit logging)
      await migrationManager.rollbackMigration('0003');
            
      // Verify audit_log table was removed
      const auditTableExists = await db.query(`
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_name = 'audit_log'
                )
            `);
      expect(auditTableExists.rows[0].exists).toBe(false);
            
      // Verify other tables still exist
      const otherTablesExist = await db.query(`
                SELECT COUNT(*) 
                FROM information_schema.tables 
                WHERE table_name IN ('e2e_test_sources', 'e2e_test_documents')
            `);
      expect(otherTablesExist.rows[0].count).toBe('2');

      // Step 11: Test migration status reporting
      console.log('Step 11: Testing migration status reporting...');
      const finalStatus = await migrationManager.getStatus();
      expect(finalStatus.available).toBe(3);
      expect(finalStatus.applied).toBe(2); // Only 2 applied after rollback
      expect(finalStatus.pending).toBe(1); // 1 pending after rollback

      // Step 12: Clean up test data
      console.log('Step 12: Cleaning up test data...');
            
      // Rollback remaining migrations
      await migrationManager.rollbackMigration('0002');
      await migrationManager.rollbackMigration('0001');
            
      // Verify all test tables were removed
      const finalTableCheck = await db.query(`
                SELECT COUNT(*) 
                FROM information_schema.tables 
                WHERE table_name IN ('e2e_test_sources', 'e2e_test_documents', 'audit_log')
            `);
      expect(finalTableCheck.rows[0].count).toBe('0');
            
      console.log('E2E migration workflow test completed successfully!');
    });

    it('should handle migration failures and recovery', async () => {
      if (!db || !db.isConnected) {
        console.log('Skipping test - database not available');
        return;
      }
            
      console.log('Testing migration failure and recovery...');
            
      await migrationManager.initializeMigrationTable();
            
      // Create a migration that will fail
      const failingMigration = `-- Failing Migration
CREATE TABLE test_table (id SERIAL PRIMARY KEY);
-- This will fail because the table already exists
CREATE TABLE test_table (id SERIAL PRIMARY KEY);

-- ROLLBACK
DROP TABLE IF EXISTS test_table;`;
            
      await fs.writeFile(path.join(testMigrationsPath, '0001_failing_migration.sql'), failingMigration);
            
      const availableMigrations = await migrationManager.getAvailableMigrations();
            
      // Attempt to apply failing migration
      await expect(migrationManager.applyMigration(availableMigrations[0]))
        .rejects.toThrow();
            
      // Verify no migration was recorded
      const appliedMigrations = await migrationManager.getAppliedMigrations();
      expect(appliedMigrations).toHaveLength(0);
            
      // Verify no partial changes were made
      const tableExists = await db.query(`
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_name = 'test_table'
                )
            `);
      expect(tableExists.rows[0].exists).toBe(false);
            
      // Clean up
      await fs.unlink(path.join(testMigrationsPath, '0001_failing_migration.sql'));
            
      console.log('Migration failure and recovery test completed successfully!');
    });

    it('should maintain data integrity during complex migrations', async () => {
      if (!db || !db.isConnected) {
        console.log('Skipping test - database not available');
        return;
      }
            
      console.log('Testing data integrity during complex migrations...');
            
      await migrationManager.initializeMigrationTable();
            
      // Create initial schema
      const initialMigration = `-- Initial Schema
CREATE TABLE integrity_test (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(255) UNIQUE,
    data JSONB DEFAULT '{}'
);

INSERT INTO integrity_test (name, email, data) VALUES
    ('User 1', 'user1@example.com', '{"role": "admin"}'),
    ('User 2', 'user2@example.com', '{"role": "user"}'),
    ('User 3', 'user3@example.com', '{"role": "user"}');

-- ROLLBACK
DROP TABLE IF EXISTS integrity_test;`;

      // Schema modification migration
      const modificationMigration = `-- Schema Modification
ALTER TABLE integrity_test ADD COLUMN created_at TIMESTAMP DEFAULT NOW();
ALTER TABLE integrity_test ADD COLUMN active BOOLEAN DEFAULT true;

UPDATE integrity_test SET created_at = NOW() - INTERVAL '1 day' WHERE id = 1;
UPDATE integrity_test SET created_at = NOW() - INTERVAL '2 days' WHERE id = 2;
UPDATE integrity_test SET created_at = NOW() - INTERVAL '3 days' WHERE id = 3;

-- ROLLBACK
ALTER TABLE integrity_test DROP COLUMN IF EXISTS created_at;
ALTER TABLE integrity_test DROP COLUMN IF EXISTS active;`;

      await fs.writeFile(path.join(testMigrationsPath, '0001_initial_schema.sql'), initialMigration);
      await fs.writeFile(path.join(testMigrationsPath, '0002_modify_schema.sql'), modificationMigration);
            
      // Apply migrations
      await migrationManager.migrate();
            
      // Verify data integrity
      const dataCheck = await db.query(`
                SELECT id, name, email, data, created_at, active 
                FROM integrity_test 
                ORDER BY id
            `);
            
      expect(dataCheck.rows).toHaveLength(3);
      expect(dataCheck.rows[0].name).toBe('User 1');
      expect(dataCheck.rows[0].email).toBe('user1@example.com');
      expect(dataCheck.rows[0].data.role).toBe('admin');
      expect(dataCheck.rows[0].active).toBe(true);
      expect(dataCheck.rows[0].created_at).toBeTruthy();
            
      // Test rollback preserves original data
      await migrationManager.rollbackMigration('0002');
            
      const rollbackCheck = await db.query(`
                SELECT id, name, email, data 
                FROM integrity_test 
                ORDER BY id
            `);
            
      expect(rollbackCheck.rows).toHaveLength(3);
      expect(rollbackCheck.rows[0].name).toBe('User 1');
      expect(rollbackCheck.rows[0].data.role).toBe('admin');
            
      // Clean up
      await migrationManager.rollbackMigration('0001');
      await fs.unlink(path.join(testMigrationsPath, '0001_initial_schema.sql'));
      await fs.unlink(path.join(testMigrationsPath, '0002_modify_schema.sql'));
            
      console.log('Data integrity test completed successfully!');
    });
  });
});
