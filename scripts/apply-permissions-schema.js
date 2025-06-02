#!/usr/bin/env node

/**
 * Apply permissions schema to the database
 * This script applies the permissions-schema.sql to the database
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

async function applyPermissionsSchema() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/thewell_pipeline'
  });

  try {
    console.log('Connecting to database...');
    
    // Read the permissions schema file
    const schemaPath = path.join(__dirname, '../src/database/permissions-schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    
    console.log('Applying permissions schema...');
    
    // Execute the schema
    await pool.query(schema);
    
    console.log('✅ Permissions schema applied successfully!');
    
    // Verify tables were created
    const result = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('users', 'roles', 'permissions', 'user_permissions', 'role_permissions', 'user_roles', 'document_access_policies', 'document_access_grants', 'access_logs')
      ORDER BY table_name
    `);
    
    console.log('Created tables:', result.rows.map(r => r.table_name).join(', '));
    
  } catch (error) {
    console.error('❌ Error applying permissions schema:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  applyPermissionsSchema();
}

module.exports = { applyPermissionsSchema };
