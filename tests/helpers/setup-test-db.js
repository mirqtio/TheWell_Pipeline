#!/usr/bin/env node

/**
 * Setup test database with proper user, extensions, and schema
 * This ensures all tests have a consistent database environment
 */

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

async function createTestDatabase() {
  // Connect to default postgres database to create test database
  const adminClient = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: 'postgres',
    user: process.env.DB_ADMIN_USER || process.env.USER || 'postgres',
    password: process.env.DB_ADMIN_PASSWORD || ''
  });

  try {
    await adminClient.connect();
    console.log('Connected to PostgreSQL as admin');

    // Create test database if it doesn't exist
    const dbName = process.env.DB_NAME || 'thewell_test';
    const dbCheckResult = await adminClient.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [dbName]
    );

    if (dbCheckResult.rows.length === 0) {
      await adminClient.query(`CREATE DATABASE ${dbName}`);
      console.log(`Created database: ${dbName}`);
    } else {
      console.log(`Database ${dbName} already exists`);
    }

    // Create test user if it doesn't exist
    const testUser = process.env.DB_USER || 'thewell_test';
    const testPassword = process.env.DB_PASSWORD || 'thewell_test_password';
    
    const userCheckResult = await adminClient.query(
      'SELECT 1 FROM pg_roles WHERE rolname = $1',
      [testUser]
    );

    if (userCheckResult.rows.length === 0) {
      await adminClient.query(`CREATE ROLE ${testUser} WITH LOGIN PASSWORD '${testPassword}'`);
      console.log(`Created user: ${testUser}`);
    } else {
      console.log(`User ${testUser} already exists`);
      // Update password in case it changed
      await adminClient.query(`ALTER ROLE ${testUser} WITH PASSWORD '${testPassword}'`);
    }

    // Grant privileges
    await adminClient.query(`GRANT ALL PRIVILEGES ON DATABASE ${dbName} TO ${testUser}`);
    console.log(`Granted privileges on ${dbName} to ${testUser}`);

    // Also create thewell_user role if tests expect it
    const thewellUserCheck = await adminClient.query(
      'SELECT 1 FROM pg_roles WHERE rolname = \'thewell_user\''
    );

    if (thewellUserCheck.rows.length === 0) {
      await adminClient.query('CREATE ROLE thewell_user WITH LOGIN PASSWORD \'SuperSecurePwd123!\'');
      console.log('Created role: thewell_user');
    }

    await adminClient.query(`GRANT ALL PRIVILEGES ON DATABASE ${dbName} TO thewell_user`);

  } catch (error) {
    console.error('Error creating test database:', error);
    throw error;
  } finally {
    await adminClient.end();
  }
}

async function setupTestSchema() {
  const dbName = process.env.DB_NAME || 'thewell_test';
  const testUser = process.env.DB_USER || 'thewell_test';
  const testPassword = process.env.DB_PASSWORD || 'thewell_test_password';

  const client = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: dbName,
    user: testUser,
    password: testPassword
  });

  try {
    await client.connect();
    console.log(`Connected to ${dbName} as ${testUser}`);

    // Create extensions
    console.log('Creating extensions...');
    await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    await client.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
    
    // Try to create vector extension (might fail if not installed)
    try {
      await client.query('CREATE EXTENSION IF NOT EXISTS vector');
      console.log('Created vector extension');
    } catch (error) {
      console.log('Vector extension not available (optional)');
    }

    // Grant schema permissions
    await client.query(`GRANT CREATE ON SCHEMA public TO ${testUser}`);
    await client.query('GRANT CREATE ON SCHEMA public TO thewell_user');
    await client.query('GRANT USAGE ON SCHEMA public TO thewell_user');

    // Read and apply main schema
    const schemaPath = path.join(__dirname, '../../src/database/schema.sql');
    if (fs.existsSync(schemaPath)) {
      console.log('Applying main schema...');
      const schema = fs.readFileSync(schemaPath, 'utf8');
      
      // Execute the entire schema as one command
      try {
        await client.query(schema);
        console.log('Main schema applied');
      } catch (error) {
        console.log('Error applying main schema:', error.message);
        // Try to apply individual statements if full schema fails
        const statements = schema
          .split(/;(?=\s*(?:--|CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|GRANT|$))/i)
          .filter(stmt => stmt.trim() && !stmt.trim().startsWith('--'))
          .map(stmt => stmt.trim() + (stmt.trim().endsWith(';') ? '' : ';'));

        console.log('Applying schema statement by statement...');
        for (const statement of statements) {
          if (statement.includes('CREATE EXTENSION') && statement.includes('vector')) {
            // Skip vector extension if not available
            continue;
          }
          
          try {
            await client.query(statement);
          } catch (error) {
            // Only log non-duplicate errors
            if (!error.message.includes('already exists')) {
              console.log('Statement error:', error.message.substring(0, 100));
            }
          }
        }
      }
    }

    // Apply permissions schema
    const permissionsSchemaPath = path.join(__dirname, '../../src/database/permissions-schema.sql');
    if (fs.existsSync(permissionsSchemaPath)) {
      console.log('Applying permissions schema...');
      const permissionsSchema = fs.readFileSync(permissionsSchemaPath, 'utf8');
      
      try {
        await client.query(permissionsSchema);
        console.log('Permissions schema applied');
      } catch (error) {
        console.log('Permissions schema partially applied:', error.message);
      }
    }

    // Apply visibility schema
    const visibilitySchemaPath = path.join(__dirname, '../../src/ingestion/schemas/visibility.sql');
    if (fs.existsSync(visibilitySchemaPath)) {
      console.log('Applying visibility schema...');
      const visibilitySchema = fs.readFileSync(visibilitySchemaPath, 'utf8');
      
      try {
        await client.query(visibilitySchema);
        console.log('Visibility schema applied');
      } catch (error) {
        console.log('Visibility schema partially applied:', error.message);
      }
    }

    // Grant permissions on all tables
    console.log('Granting table permissions...');
    await client.query(`
      GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO ${testUser};
      GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO ${testUser};
      GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO ${testUser};
      
      GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO thewell_user;
      GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO thewell_user;
      GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO thewell_user;
    `);

    console.log('Test database setup complete!');

  } catch (error) {
    console.error('Error setting up test schema:', error);
    throw error;
  } finally {
    await client.end();
  }
}

async function main() {
  try {
    console.log('Setting up test database...');
    await createTestDatabase();
    await setupTestSchema();
    console.log('✅ Test database setup complete');
  } catch (error) {
    console.error('❌ Test database setup failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  createTestDatabase,
  setupTestSchema
};