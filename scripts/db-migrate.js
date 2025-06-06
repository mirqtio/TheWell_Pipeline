#!/usr/bin/env node

/**
 * Database Migration Script
 * Runs pending database migrations
 */

const DatabaseManager = require('../src/database/DatabaseManager');
const MigrationManager = require('../src/database/MigrationManager');
const logger = require('../src/utils/logger');

async function readAndParseMigrationFile(filePath) {
  const fullContent = await require('fs').promises.readFile(filePath, 'utf8');
  const lines = fullContent.split('\n');
  
  let forwardSQL = '';
  let rollbackSQL = '';
  let currentSection = null; 

  for (const line of lines) {
    const trimmedLine = line.trim().toUpperCase();
    if (trimmedLine.startsWith('-- FORWARD MIGRATION')) {
      currentSection = 'forward';
      continue; 
    } else if (trimmedLine.startsWith('-- ROLLBACK')) {
      currentSection = 'rollback';
      continue;
    }

    if (currentSection === 'forward') {
      forwardSQL += line + '\n';
    } else if (currentSection === 'rollback') {
      rollbackSQL += line + '\n';
    }
  }

  // If no section markers are found, assume the whole file is forward migration
  if (currentSection === null && fullContent.trim() !== '') {
    forwardSQL = fullContent;
  }

  return {
    forwardSQL: forwardSQL.trim(),
    rollbackSQL: rollbackSQL.trim()
  };
}

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
          const filePath = require('path').join(migrationManager.migrationsPath, migration.filename);
          
          try {
            const { forwardSQL, rollbackSQL } = await readAndParseMigrationFile(filePath);

            // Check if both forward and rollback SQL are empty, which might indicate an empty or non-standard file
            if (!forwardSQL && !rollbackSQL && migration.filename) {
                logger.warn(`Migration file ${migration.filename} is empty or has no parsable SQL content. Skipping.`);
                continue; // Skip this migration if no SQL content is found
            }
            // Proceed to apply migration if there's content
            await migrationManager.applyMigration(migration.version, migration.name, forwardSQL, rollbackSQL);
            logger.info(`Successfully applied migration: ${migration.version}_${migration.name}`);
          } catch (fileError) {
            // Log specific error related to file processing or applying this migration
            logger.error(`Error processing or applying migration ${migration.filename || migration.version + '_' + migration.name}: ${fileError.message}`);
            throw fileError; // Re-throw to stop the migration process on error
          }
        }
        break;
        
      case 'down':
        logger.info('Rolling back last migration...');
        // Implementation for rollback
        const lastApplied = await migrationManager.getLastAppliedMigration();
        if (!lastApplied) {
          logger.info('No migrations to roll back.');
          break;
        }
        logger.info(`Rolling back migration: ${lastApplied.version}_${lastApplied.name}`);
        // Assuming rollbackScript is stored or can be parsed from file
        const rollbackFilePath = require('path').join(migrationManager.migrationsPath, `${lastApplied.version}_${lastApplied.name}.sql`);
        const { rollbackSQL } = await readAndParseMigrationFile(rollbackFilePath);
        if (!rollbackSQL) {
            logger.error(`No rollback script found or parsable for ${lastApplied.version}_${lastApplied.name}.`);
            throw new Error(`Rollback script missing for ${lastApplied.version}_${lastApplied.name}`);
        }
        await migrationManager.rollbackMigration(lastApplied.version, lastApplied.name, rollbackSQL);
        logger.info(`Successfully rolled back migration: ${lastApplied.version}_${lastApplied.name}`);
        break;
        
      case 'status':
        logger.info('Checking migration status...');
        const applied = await migrationManager.getAppliedMigrations();
        const pending = await migrationManager.getPendingMigrations();
        
        if (applied.length === 0 && pending.length === 0) {
          logger.info('No migrations found (applied or pending).');
          break;
        }

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
        
        // const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, ''); // Not used in filename
        const version = String(await migrationManager.getNextVersion()).padStart(4, '0');
        const filename = `${version}_${target.replace(/[^a-z0-9_]/gi, '_').toLowerCase()}.sql`;
        const filepath = require('path').join(migrationManager.migrationsPath, filename);
        
        const template = `-- Migration: ${target}\n-- Version: ${version}\n-- Date: ${new Date().toISOString()}\n\n-- FORWARD MIGRATION\n-- Add your SQL queries for the forward migration here.\n-- Example:\n-- CREATE TABLE my_new_table (\n--   id SERIAL PRIMARY KEY,\n--   name VARCHAR(255) NOT NULL\n-- );\n\n-- ROLLBACK\n-- Add your SQL queries for the rollback migration here.\n-- This section should contain SQL to undo the changes made by the forward migration.\n-- Example:\n-- DROP TABLE IF EXISTS my_new_table;\n`;
        
        await require('fs').promises.writeFile(filepath, template);
        logger.info(`Created migration: ${filename} at ${filepath}`);
        break;
        
      default:
        logger.error(`Unknown command: ${command}`);
        logger.info('Usage: npm run db:migrate [up|down|status|create]');
        process.exit(1);
    }
    
  } catch (error) {
    logger.error('Migration script failed:', error);
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
