/**
 * Database test helpers
 */

const path = require('path');
const fs = require('fs').promises;
const { createTestDatabase, setupTestSchema } = require('./setup-test-db');
const { Pool } = require('pg');

/**
 * Setup test database
 * Creates database, user, and applies all schemas
 */
async function setupTestDatabase() {
  try {
    // First create the database and user
    await createTestDatabase();
    
    // Then apply the schema
    await setupTestSchema();
    
    // Also create test fixtures directory
    const testDataDir = path.join(__dirname, '../fixtures');
    try {
      await fs.access(testDataDir);
    } catch (error) {
      await fs.mkdir(testDataDir, { recursive: true });
    }
    
    console.log('Test database setup completed');
    
    return true;
  } catch (error) {
    console.error('Failed to setup test database:', error);
    throw error;
  }
}

/**
 * Cleanup test database
 */
async function cleanupTestDatabase() {
  try {
    const dbName = process.env.DB_NAME || 'thewell_test';
    const testUser = process.env.DB_USER || 'thewell_test';
    const testPassword = process.env.DB_PASSWORD || 'thewell_test_password';

    const pool = new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: dbName,
      user: testUser,
      password: testPassword
    });

    // Clean up test data from tables
    const tablesToClean = [
      'feedback',
      'feedback_aggregates',
      'documents',
      'jobs',
      'sources'
    ];

    for (const table of tablesToClean) {
      try {
        await pool.query(`TRUNCATE TABLE ${table} CASCADE`);
      } catch (error) {
        // Table might not exist, ignore
      }
    }

    await pool.end();
    console.log('Test database cleanup completed');
    
    return true;
  } catch (error) {
    console.error('Failed to cleanup test database:', error);
    // Don't throw on cleanup errors to avoid masking test failures
    return false;
  }
}

/**
 * Reset test database to initial state
 */
async function resetTestDatabase() {
  try {
    await cleanupTestDatabase();
    await setupTestDatabase();
    
    return true;
  } catch (error) {
    console.error('Failed to reset test database:', error);
    throw error;
  }
}

/**
 * Create test data fixtures
 */
async function createTestFixtures() {
  const testDocuments = [
    {
      id: 'test-doc-1',
      title: 'Test Document 1',
      content: 'This is test content for document 1',
      source: {
        id: 'test-source-1',
        name: 'Test Source 1',
        type: 'web'
      },
      status: 'pending',
      createdAt: new Date().toISOString()
    },
    {
      id: 'test-doc-2',
      title: 'Test Document 2',
      content: 'This is test content for document 2',
      source: {
        id: 'test-source-2',
        name: 'Test Source 2',
        type: 'file'
      },
      status: 'pending',
      createdAt: new Date().toISOString()
    }
  ];
  
  return testDocuments;
}

/**
 * Get test database connection
 */
function getTestDatabaseConnection() {
  const dbName = process.env.DB_NAME || 'thewell_test';
  const testUser = process.env.DB_USER || 'thewell_test';
  const testPassword = process.env.DB_PASSWORD || 'thewell_test_password';

  return new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: dbName,
    user: testUser,
    password: testPassword
  });
}

module.exports = {
  setupTestDatabase,
  cleanupTestDatabase,
  resetTestDatabase,
  createTestFixtures,
  getTestDatabaseConnection
};
