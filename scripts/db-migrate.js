#!/usr/bin/env node

/**
 * Database Migration Script
 * Runs pending database migrations
 */

const DatabaseManager = require('../src/database/DatabaseManager');
const MigrationManager = require('../src/database/MigrationManager');
const logger = require('../src/utils/logger');

async function runMigrations() {
  let databaseManager;
  let migrationManager;
  
  try {
    // Parse command line arguments
    const args = process.argv.slice(2);
    const command = args[0] || 'up';
    const target = args[1];
    
    // Database configuration from environment
    const dbConfig = {
      host: process.env.DB_HOST || process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || process.env.POSTGRES_PORT || '5432'),
      database: process.env.DB_NAME || process.env.POSTGRES_DB || 'thewell_prod',
      username: process.env.DB_USER || process.env.POSTGRES_USER || 'thewell',
      password: process.env.DB_PASSWORD || process.env.POSTGRES_PASSWORD || 'postgres'
    };
    
    logger.info('Connecting to database...', {
      host: dbConfig.host,
      port: dbConfig.port,
      database: dbConfig.database,
      user: dbConfig.username
    });
    
    // Initialize database connection
    databaseManager = new DatabaseManager(dbConfig);
    await databaseManager.initialize();
    
    // Initialize migration manager
    migrationManager = new MigrationManager(databaseManager);
    await migrationManager.initializeMigrationTable();
    
    switch (command) {
      case 'up':
        logger.info('Running pending migrations...');
        const pendingMigrations = await migrationManager.getPendingMigrations();
        
        if (pendingMigrations.length === 0) {
          logger.info('No pending migrations found.');
          break;
        }
        
        logger.info(`Found ${pendingMigrations.length} pending migrations`);
        
        for (const migration of pendingMigrations) {
          logger.info(`Applying migration: ${migration.version}_${migration.name}`);
          await migrationManager.runMigration(migration.version, migration.name);
          logger.info(`✓ Migration ${migration.version} applied successfully`);
        }
        
        logger.info('All migrations completed successfully');
        break;
        
      case 'down':
        if (!target) {
          logger.error('Please specify target version for rollback');
          logger.info('Usage: npm run db:migrate down <version>');
          process.exit(1);
        }
        
        logger.info(`Rolling back to version: ${target}`);
        await migrationManager.rollbackToVersion(target);
        logger.info('Rollback completed successfully');
        break;
        
      case 'status':
        logger.info('Migration status:');
        const applied = await migrationManager.getAppliedMigrations();
        const pending = await migrationManager.getPendingMigrations();
        
        if (applied.length > 0) {
          logger.info('\nApplied migrations:');
          for (const m of applied) {
            logger.info(`  ✓ ${m.version}_${m.name} (applied at: ${m.applied_at})`);
          }
        }
        
        if (pending.length > 0) {
          logger.info('\nPending migrations:');
          for (const m of pending) {
            logger.info(`  ○ ${m.version}_${m.name}`);
          }
        } else if (applied.length > 0) {
          logger.info('\nAll migrations are up to date');
        }
        break;
        
      case 'create':
        if (!target) {
          logger.error('Please specify migration name');
          logger.info('Usage: npm run db:migrate create <name>');
          process.exit(1);
        }
        
        const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const version = String(await migrationManager.getNextVersion()).padStart(4, '0');
        const filename = `${version}_${target.replace(/[^a-z0-9_]/gi, '_').toLowerCase()}.sql`;
        const filepath = require('path').join(migrationManager.migrationsPath, filename);
        
        const template = `-- Migration: ${target}
-- Date: ${new Date().toISOString().slice(0, 10)}
-- Description: Add description here

-- Forward migration
BEGIN;

-- Add your migration SQL here

COMMIT;

-- Rollback migration
-- BEGIN;
-- Add your rollback SQL here
-- COMMIT;
`;
        
        await require('fs').promises.writeFile(filepath, template);
        logger.info(`Created migration: ${filename}`);
        break;
        
      default:
        logger.error(`Unknown command: ${command}`);
        logger.info('Usage: npm run db:migrate [up|down|status|create]');
        process.exit(1);
    }
    
  } catch (error) {
    logger.error('Migration failed:', error);
    process.exit(1);
  } finally {
    // Close database connection
    if (databaseManager) {
      await databaseManager.close();
    }
  }
}

// Run migrations if executed directly
if (require.main === module) {
  runMigrations();
}

module.exports = runMigrations;