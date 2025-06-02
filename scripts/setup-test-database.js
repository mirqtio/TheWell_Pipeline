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
        type VARCHAR(50) NOT NULL,
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
