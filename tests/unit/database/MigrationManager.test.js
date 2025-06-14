const { DatabaseManager } = require('../../../src/database/DatabaseManager');
const MigrationManager = require('../../../src/database/MigrationManager');
const fs = require('fs').promises;
const path = require('path');

// Mock filesystem operations
jest.mock('fs', () => ({
  promises: {
    readdir: jest.fn(),
    readFile: jest.fn(),
    writeFile: jest.fn()
  }
}));

describe('MigrationManager', () => {
  let migrationManager;
  let mockDb;
  let mockClient;

  beforeEach(() => {
    // Mock database client
    mockClient = {
      query: jest.fn(),
      release: jest.fn()
    };

    // Mock database manager
    mockDb = {
      query: jest.fn(),
      getClient: jest.fn().mockResolvedValue(mockClient),
      connect: jest.fn(),
      disconnect: jest.fn()
    };

    migrationManager = new MigrationManager(mockDb);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('initializeMigrationTable', () => {
    it('should create migration tracking table', async () => {
      await migrationManager.initializeMigrationTable();

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE IF NOT EXISTS schema_migrations')
      );
    });
  });

  describe('getAvailableMigrations', () => {
    it('should return sorted list of migration files', async () => {
      const mockFiles = [
        '0002_add_indexes.sql',
        '0001_initial_schema.sql',
        '0003_add_audit.sql',
        'not_a_migration.txt'
      ];

      fs.readdir.mockResolvedValue(mockFiles);

      const result = await migrationManager.getAvailableMigrations();

      expect(result).toEqual([
        { version: '0001', name: 'initial_schema', filename: '0001_initial_schema.sql' },
        { version: '0002', name: 'add_indexes', filename: '0002_add_indexes.sql' },
        { version: '0003', name: 'add_audit', filename: '0003_add_audit.sql' }
      ]);
    });

    it('should return empty array when migrations directory does not exist', async () => {
      fs.readdir.mockRejectedValue({ code: 'ENOENT' });

      const result = await migrationManager.getAvailableMigrations();

      expect(result).toEqual([]);
    });

    it('should throw error for other filesystem errors', async () => {
      fs.readdir.mockRejectedValue(new Error('Permission denied'));

      await expect(migrationManager.getAvailableMigrations()).rejects.toThrow('Permission denied');
    });
  });

  describe('getAppliedMigrations', () => {
    it('should return list of applied migrations', async () => {
      const mockRows = [
        { version: '0001', name: 'initial_schema', applied_at: '2025-01-01T00:00:00Z' },
        { version: '0002', name: 'add_indexes', applied_at: '2025-01-02T00:00:00Z' }
      ];

      mockDb.query.mockResolvedValueOnce(undefined); // initializeMigrationTable
      mockDb.query.mockResolvedValueOnce({ rows: mockRows });

      const result = await migrationManager.getAppliedMigrations();

      expect(result).toEqual(mockRows);
    });
  });

  describe('getPendingMigrations', () => {
    it('should return migrations not yet applied', async () => {
      const availableMigrations = [
        { version: '0001', name: 'initial_schema', filename: '0001_initial_schema.sql' },
        { version: '0002', name: 'add_indexes', filename: '0002_add_indexes.sql' },
        { version: '0003', name: 'add_audit', filename: '0003_add_audit.sql' }
      ];

      const appliedMigrations = [
        { version: '0001', name: 'initial_schema', applied_at: '2025-01-01T00:00:00Z' }
      ];

      jest.spyOn(migrationManager, 'getAvailableMigrations').mockResolvedValue(availableMigrations);
      jest.spyOn(migrationManager, 'getAppliedMigrations').mockResolvedValue(appliedMigrations);

      const result = await migrationManager.getPendingMigrations();

      expect(result).toEqual([
        { version: '0002', name: 'add_indexes', filename: '0002_add_indexes.sql' },
        { version: '0003', name: 'add_audit', filename: '0003_add_audit.sql' }
      ]);
    });
  });

  describe('calculateChecksum', () => {
    it('should calculate SHA256 checksum of content', () => {
      const content = 'CREATE TABLE test (id INTEGER);';
      const checksum = migrationManager.calculateChecksum(content);

      expect(checksum).toMatch(/^[a-f0-9]{64}$/);
      expect(checksum).toBe(migrationManager.calculateChecksum(content)); // Consistent
    });
  });

  describe('parseMigrationFile', () => {
    it('should parse migration file into forward and rollback scripts', () => {
      const content = `-- Migration comment
CREATE TABLE test (id INTEGER);

-- ROLLBACK
DROP TABLE test;`;

      const result = migrationManager.parseMigrationFile(content);

      expect(result.forward).toContain('CREATE TABLE test');
      expect(result.rollback).toContain('DROP TABLE test');
    });

    it('should handle migration with no rollback section', () => {
      const content = 'CREATE TABLE test (id INTEGER);';

      const result = migrationManager.parseMigrationFile(content);

      expect(result.forward).toContain('CREATE TABLE test');
      expect(result.rollback).toBe('');
    });
  });

  describe('applyMigration', () => {
    it('should apply migration successfully', async () => {
      const migration = {
        version: '0001',
        name: 'test_migration',
        filename: '0001_test_migration.sql'
      };

      const migrationContent = `CREATE TABLE test (id INTEGER);

-- ROLLBACK
DROP TABLE test;`;

      fs.readFile.mockResolvedValue(migrationContent);
      mockClient.query.mockResolvedValue();

      await migrationManager.applyMigration(migration);

      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith('CREATE TABLE test (id INTEGER);');
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO schema_migrations'),
        expect.arrayContaining(['0001', 'test_migration'])
      );
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should rollback transaction on error', async () => {
      const migration = {
        version: '0001',
        name: 'test_migration',
        filename: '0001_test_migration.sql'
      };

      fs.readFile.mockResolvedValue('CREATE TABLE test (id INTEGER);');
      mockClient.query.mockImplementation((query) => {
        if (query.includes('CREATE TABLE')) {
          throw new Error('SQL error');
        }
      });

      await expect(migrationManager.applyMigration(migration)).rejects.toThrow('Failed to apply migration');

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe('rollbackMigration', () => {
    it('should rollback migration successfully', async () => {
      const appliedMigrations = [
        { version: '0001', name: 'test_migration', applied_at: '2025-01-01T00:00:00Z' }
      ];

      jest.spyOn(migrationManager, 'getAppliedMigrations').mockResolvedValue(appliedMigrations);
      mockDb.query.mockResolvedValue({
        rows: [{ rollback_script: 'DROP TABLE test;' }]
      });
      mockClient.query.mockResolvedValue();

      await migrationManager.rollbackMigration('0001');

      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith('DROP TABLE test;');
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM schema_migrations'),
        ['0001']
      );
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    });

    it('should throw error if migration not found', async () => {
      jest.spyOn(migrationManager, 'getAppliedMigrations').mockResolvedValue([]);

      await expect(migrationManager.rollbackMigration('0001')).rejects.toThrow(
        'Migration 0001 not found in applied migrations'
      );
    });

    it('should throw error if rollback script is empty', async () => {
      const appliedMigrations = [
        { version: '0001', name: 'test_migration', applied_at: '2025-01-01T00:00:00Z' }
      ];

      jest.spyOn(migrationManager, 'getAppliedMigrations').mockResolvedValue(appliedMigrations);
      mockDb.query.mockResolvedValue({
        rows: [{ rollback_script: '' }]
      });

      await expect(migrationManager.rollbackMigration('0001')).rejects.toThrow(
        'Empty rollback script for migration 0001'
      );
    });
  });

  describe('migrate', () => {
    it('should apply all pending migrations', async () => {
      const pendingMigrations = [
        { version: '0001', name: 'migration1', filename: '0001_migration1.sql' },
        { version: '0002', name: 'migration2', filename: '0002_migration2.sql' }
      ];

      jest.spyOn(migrationManager, 'getPendingMigrations').mockResolvedValue(pendingMigrations);
      jest.spyOn(migrationManager, 'applyMigration').mockResolvedValue();

      await migrationManager.migrate();

      expect(migrationManager.applyMigration).toHaveBeenCalledTimes(2);
      expect(migrationManager.applyMigration).toHaveBeenCalledWith(pendingMigrations[0]);
      expect(migrationManager.applyMigration).toHaveBeenCalledWith(pendingMigrations[1]);
    });

    it('should do nothing if no pending migrations', async () => {
      jest.spyOn(migrationManager, 'getPendingMigrations').mockResolvedValue([]);
      jest.spyOn(migrationManager, 'applyMigration').mockResolvedValue();

      await migrationManager.migrate();

      expect(migrationManager.applyMigration).not.toHaveBeenCalled();
    });
  });

  describe('getStatus', () => {
    it('should return migration status summary', async () => {
      const availableMigrations = [
        { version: '0001', name: 'migration1', filename: '0001_migration1.sql' },
        { version: '0002', name: 'migration2', filename: '0002_migration2.sql' }
      ];
      const appliedMigrations = [
        { version: '0001', name: 'migration1', applied_at: '2025-01-01T00:00:00Z' }
      ];
      const pendingMigrations = [
        { version: '0002', name: 'migration2', filename: '0002_migration2.sql' }
      ];

      jest.spyOn(migrationManager, 'getAvailableMigrations').mockResolvedValue(availableMigrations);
      jest.spyOn(migrationManager, 'getAppliedMigrations').mockResolvedValue(appliedMigrations);
      jest.spyOn(migrationManager, 'getPendingMigrations').mockResolvedValue(pendingMigrations);

      const result = await migrationManager.getStatus();

      expect(result).toEqual({
        available: 2,
        applied: 1,
        pending: 1,
        appliedMigrations,
        pendingMigrations
      });
    });
  });

  describe('validateMigrations', () => {
    it('should detect checksum mismatches', async () => {
      const appliedMigrations = [
        { version: '0001', name: 'test_migration', applied_at: '2025-01-01T00:00:00Z' }
      ];

      jest.spyOn(migrationManager, 'getAppliedMigrations').mockResolvedValue(appliedMigrations);
      fs.readFile.mockResolvedValue('CREATE TABLE modified (id INTEGER);');
      mockDb.query.mockResolvedValue({
        rows: [{ checksum: 'different_checksum' }]
      });

      const issues = await migrationManager.validateMigrations();

      expect(issues).toHaveLength(1);
      expect(issues[0].issue).toBe('checksum_mismatch');
    });

    it('should detect missing migration files', async () => {
      const appliedMigrations = [
        { version: '0001', name: 'test_migration', applied_at: '2025-01-01T00:00:00Z' }
      ];

      jest.spyOn(migrationManager, 'getAppliedMigrations').mockResolvedValue(appliedMigrations);
      fs.readFile.mockRejectedValue({ code: 'ENOENT' });

      const issues = await migrationManager.validateMigrations();

      expect(issues).toHaveLength(1);
      expect(issues[0].issue).toBe('file_missing');
    });
  });

  describe('createMigration', () => {
    it('should create new migration file with incremented version', async () => {
      const availableMigrations = [
        { version: '0001', name: 'migration1', filename: '0001_migration1.sql' }
      ];

      jest.spyOn(migrationManager, 'getAvailableMigrations').mockResolvedValue(availableMigrations);
      fs.writeFile.mockResolvedValue();

      const result = await migrationManager.createMigration('add new feature');

      expect(result.version).toBe('0002');
      expect(result.filename).toBe('0002_add_new_feature.sql');
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('0002_add_new_feature.sql'),
        expect.stringContaining('Migration: add new feature')
      );
    });

    it('should start with version 0001 if no migrations exist', async () => {
      jest.spyOn(migrationManager, 'getAvailableMigrations').mockResolvedValue([]);
      fs.writeFile.mockResolvedValue();

      const result = await migrationManager.createMigration('initial migration');

      expect(result.version).toBe('0001');
      expect(result.filename).toBe('0001_initial_migration.sql');
    });
  });
});
