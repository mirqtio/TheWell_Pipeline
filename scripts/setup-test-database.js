#!/usr/bin/env node

/**
 * Setup test database with minimal schema for permissions testing
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

async function setupTestDatabase() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/thewell_pipeline'
  });

  try {
    console.log('Setting up test database...');

    // Create minimal tables needed for permissions testing
    await pool.query(`
      -- Enable UUID extension
      CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

      -- Create minimal sources table
      CREATE TABLE IF NOT EXISTS sources (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name VARCHAR(255) NOT NULL UNIQUE,
        type VARCHAR(50) NOT NULL,
        config JSONB NOT NULL DEFAULT '{}',
        status VARCHAR(20) DEFAULT 'active',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      -- Create minimal documents table
      CREATE TABLE IF NOT EXISTS documents (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        source_id UUID REFERENCES sources(id) ON DELETE CASCADE,
        external_id VARCHAR(500),
        title TEXT NOT NULL,
        content TEXT,
        content_type VARCHAR(100) DEFAULT 'text/plain',
        url TEXT,
        metadata JSONB DEFAULT '{}',
        hash VARCHAR(64) UNIQUE,
        word_count INTEGER,
        language VARCHAR(10),
        visibility VARCHAR(20) DEFAULT 'internal',
        believability_score DECIMAL(3,2) DEFAULT 0.5,
        quality_score DECIMAL(3,2),
        status VARCHAR(20) DEFAULT 'active',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      -- Create minimal jobs table
      CREATE TABLE IF NOT EXISTS jobs (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        source_id UUID REFERENCES sources(id) ON DELETE CASCADE,
        document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
        job_type VARCHAR(100) NOT NULL,
        type VARCHAR(50), -- kept for backward compatibility
        status VARCHAR(20) DEFAULT 'pending',
        priority INTEGER DEFAULT 5,
        payload JSONB DEFAULT '{}',
        result JSONB,
        error_message TEXT,
        attempts INTEGER DEFAULT 0,
        max_attempts INTEGER DEFAULT 3,
        scheduled_for TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        started_at TIMESTAMP WITH TIME ZONE,
        completed_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    console.log('✅ Basic tables created');

    // Drop all tables managed by permissions-schema.sql to ensure a clean slate
    console.log('Dropping permissions-related tables before applying schema...');
    const tablesToDrop = [
      'access_logs',
      'permission_checks',
      'document_access_grants',
      'user_permissions',
      'role_permissions',
      'source_access_policies',
      'document_access_policies',
      'users', // users must be dropped before roles/permissions if not using CASCADE properly elsewhere for them
      'permissions',
      'roles'      
    ];
    // Drop in specific order to handle dependencies if CASCADE isn't fully effective or if we want to be super sure
    // For example, user_permissions references users and permissions.
    // role_permissions references roles and permissions.
    // document_access_grants references users, roles, document_access_policies
    // access_logs references users
    // permission_checks references users

    // Simplified: Drop with CASCADE, order less critical but still good to be mindful.
    // Drop dependent tables first or ensure CASCADE handles it.
    await pool.query('DROP TABLE IF EXISTS access_logs CASCADE;');
    await pool.query('DROP TABLE IF EXISTS permission_checks CASCADE;');
    await pool.query('DROP TABLE IF EXISTS document_access_grants CASCADE;');
    await pool.query('DROP TABLE IF EXISTS user_permissions CASCADE;');
    await pool.query('DROP TABLE IF EXISTS role_permissions CASCADE;');
    await pool.query('DROP TABLE IF EXISTS source_access_policies CASCADE;');
    await pool.query('DROP TABLE IF EXISTS document_access_policies CASCADE;');
    await pool.query('DROP TABLE IF EXISTS users CASCADE;'); 
    await pool.query('DROP TABLE IF EXISTS permissions CASCADE;');
    await pool.query('DROP TABLE IF EXISTS roles CASCADE;');
    console.log('Permissions-related tables dropped.');

    // Apply permissions schema
    const permissionsSchemaPath = path.join(__dirname, '../src/database/permissions-schema.sql');
    const permissionsSchema = fs.readFileSync(permissionsSchemaPath, 'utf8');
    
    await pool.query(permissionsSchema);
    
    console.log('✅ Permissions schema applied');

    // Verify tables
    const result = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `);
    console.log('Created tables:', result.rows.map(r => r.table_name).join(', '));

    // Seed a test admin user and assign admin role
    console.log('Seeding test admin user...');
    const testUserUsername = 'testadmin';
    const testUserEmail = 'testadmin@example.com';
    // IMPORTANT: This is a placeholder hash. Replace with a real bcrypt hash if needed for auth during tests.
    const testUserPasswordHash = '$2b$10$DUMMYBCRYPTHASHFORTESTING123.'; // Example dummy hash 
    const testUserExternalId = 'testadmin-external-id';

    await pool.query(`
      INSERT INTO users (username, email, password_hash, external_id, first_name, last_name, email_verified, status)
      VALUES ($1, $2, $3, $4, 'Test', 'Admin', true, 'active')
      ON CONFLICT (username) DO NOTHING;
    `, [testUserUsername, testUserEmail, testUserPasswordHash, testUserExternalId]);

    await pool.query(`
      INSERT INTO users (username, email, password_hash, external_id, first_name, last_name, email_verified, status)
      VALUES ('testuser', 'testuser@example.com', $1, 'testuser-external-id', 'Test', 'User', true, 'active')
      ON CONFLICT (username) DO NOTHING;
    `, [testUserPasswordHash]); // Re-using hash for simplicity

    console.log('Test users inserted (if not already present).');

    // Retrieve role IDs
    const adminRoleResult = await pool.query("SELECT id FROM roles WHERE name = 'admin';");
    const userRoleResult = await pool.query("SELECT id FROM roles WHERE name = 'user';");
    const adminRoleId = adminRoleResult.rows[0]?.id;
    const userRoleId = userRoleResult.rows[0]?.id;

    // Retrieve user IDs
    const testAdminUserResult = await pool.query("SELECT id FROM users WHERE username = $1;", [testUserUsername]);
    const testUserResult = await pool.query("SELECT id FROM users WHERE username = 'testuser';");
    const testAdminUserId = testAdminUserResult.rows[0]?.id;
    const testUserId = testUserResult.rows[0]?.id;

    if (testAdminUserId && adminRoleId) {
      await pool.query(`
        INSERT INTO user_roles (user_id, role_id)
        VALUES ($1, $2)
        ON CONFLICT (user_id, role_id) DO NOTHING;
      `, [testAdminUserId, adminRoleId]);
      console.log('Test admin user assigned admin role (if not already assigned).');
    } else {
      console.log('Could not find testadmin user or admin role to assign.');
    }

    if (testUserId && userRoleId) {
      await pool.query(`
        INSERT INTO user_roles (user_id, role_id)
        VALUES ($1, $2)
        ON CONFLICT (user_id, role_id) DO NOTHING;
      `, [testUserId, userRoleId]);
      console.log('Test user assigned user role (if not already assigned).');
    } else {
      console.log('Could not find testuser or user role to assign.');
    }

    // Seed sample sources if not present
    await pool.query(`
      INSERT INTO sources (name, type, config)
      SELECT 'Default Source', 'local_folder', '{}'::jsonb
      /* FROM users u WHERE u.username = $1 */ /* We are not linking to a user here anymore */
      ON CONFLICT (name) DO NOTHING;
    ` /*, [testUserUsername] */); // Parameter no longer needed
    console.log('Default Source seeded (if not already present).');

    // Retrieve Default Source ID
    const defaultSourceResult = await pool.query("SELECT id FROM sources WHERE name = 'Default Source';");
    const defaultSourceId = defaultSourceResult.rows[0]?.id;

    // Seed sample documents
    if (defaultSourceId && testAdminUserId) {
      console.log('Seeding sample documents for admin...');
      await pool.query(`
        INSERT INTO documents (title, source_id, content_type)
        VALUES ('Test Document 1 by Admin', $1, 'article');
      `, [defaultSourceId]);
    }

    if (defaultSourceId && testUserId) {
      console.log('Seeding sample documents for user...');
      await pool.query(`
        INSERT INTO documents (title, source_id, content_type)
        VALUES ('Test Document 2 by User', $1, 'report');
      `, [defaultSourceId]);
    }
    console.log('Sample documents seeded (if applicable).');

    // Retrieve document IDs
    const doc1Result = await pool.query("SELECT id FROM documents WHERE title = 'Test Document 1 by Admin';");
    const doc1Id = doc1Result.rows[0]?.id;

    // Seed sample jobs
    if (testAdminUserId && defaultSourceId && doc1Id) {
      console.log('Seeding sample jobs...');
      await pool.query(`
        INSERT INTO jobs (job_type, status, payload, source_id, document_id)
        VALUES ('ingestion', 'completed', $1, $2, $3); 
      `, ['{"name":"Test Job 1 - Ingestion", "param":"value1"}', defaultSourceId, doc1Id]);
    }

    if (testUserId && defaultSourceId) {
      await pool.query(`
        INSERT INTO jobs (job_type, status, payload, source_id)
        VALUES ('analysis', 'pending', $1, $2);
      `, ['{"name":"Test Job 2 - Analysis", "param":"value2"}', defaultSourceId]);
    }
    console.log('Sample jobs seeded (if applicable).');

  } catch (error) {
    console.error('❌ Error setting up test database:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  setupTestDatabase();
}

module.exports = { setupTestDatabase };
