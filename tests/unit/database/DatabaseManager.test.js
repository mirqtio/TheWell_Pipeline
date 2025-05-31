const DatabaseManager = require('../../../src/database/DatabaseManager');
const fs = require('fs').promises;
const path = require('path');

// Mock dependencies
jest.mock('pg');
jest.mock('fs', () => ({
    promises: {
        readFile: jest.fn(),
        readdir: jest.fn()
    }
}));

const mockPool = {
    connect: jest.fn(),
    query: jest.fn(),
    end: jest.fn()
};

const mockClient = {
    query: jest.fn(),
    release: jest.fn()
};

const { Pool } = require('pg');
Pool.mockImplementation(() => mockPool);

describe('DatabaseManager', () => {
    let databaseManager;

    beforeEach(() => {
        jest.clearAllMocks();
        databaseManager = new DatabaseManager({
            host: 'localhost',
            port: 5432,
            database: 'test_db',
            user: 'test_user',
            password: 'test_pass'
        });
    });

    describe('constructor', () => {
        it('should initialize with default configuration', () => {
            const db = new DatabaseManager();
            expect(db.config.host).toBe('localhost');
            expect(db.config.port).toBe(5432);
            expect(db.config.database).toBe('thewell_pipeline');
        });

        it('should use provided configuration', () => {
            expect(databaseManager.config.host).toBe('localhost');
            expect(databaseManager.config.database).toBe('test_db');
            expect(databaseManager.config.user).toBe('test_user');
        });

        it('should use environment variables when available', () => {
            process.env.DB_HOST = 'env-host';
            process.env.DB_PORT = '3306';
            process.env.DB_NAME = 'env-db';
            
            const db = new DatabaseManager();
            expect(db.config.host).toBe('env-host');
            expect(db.config.port).toBe('3306');
            expect(db.config.database).toBe('env-db');
            
            // Clean up
            delete process.env.DB_HOST;
            delete process.env.DB_PORT;
            delete process.env.DB_NAME;
        });
    });

    describe('initialize', () => {
        it('should successfully initialize connection', async () => {
            mockPool.connect.mockResolvedValue(mockClient);
            mockClient.query.mockResolvedValue({ rows: [{ now: new Date() }] });

            const result = await databaseManager.initialize();

            expect(Pool).toHaveBeenCalledWith(databaseManager.config);
            expect(mockPool.connect).toHaveBeenCalled();
            expect(mockClient.query).toHaveBeenCalledWith('SELECT NOW()');
            expect(mockClient.release).toHaveBeenCalled();
            expect(databaseManager.isConnected).toBe(true);
            expect(result).toBe(databaseManager);
        });

        it('should handle connection failure', async () => {
            const error = new Error('Connection failed');
            mockPool.connect.mockRejectedValue(error);

            await expect(databaseManager.initialize()).rejects.toThrow('Connection failed');
            expect(databaseManager.isConnected).toBe(false);
        });
    });

    describe('query', () => {
        beforeEach(async () => {
            mockPool.connect.mockResolvedValue(mockClient);
            mockClient.query.mockResolvedValue({ rows: [{ now: new Date() }] });
            await databaseManager.initialize();
        });

        it('should execute query successfully', async () => {
            const queryText = 'SELECT * FROM users WHERE id = $1';
            const params = [123];
            const expectedResult = { rows: [{ id: 123, name: 'Test User' }], rowCount: 1 };

            mockPool.query.mockResolvedValue(expectedResult);

            const result = await databaseManager.query(queryText, params);

            expect(mockPool.query).toHaveBeenCalledWith(queryText, params);
            expect(result).toEqual(expectedResult);
        });

        it('should handle query errors', async () => {
            const queryText = 'INVALID SQL';
            const error = new Error('Syntax error');
            
            mockPool.query.mockRejectedValue(error);

            await expect(databaseManager.query(queryText)).rejects.toThrow('Syntax error');
        });

        it('should throw error when not connected', async () => {
            databaseManager.isConnected = false;

            await expect(databaseManager.query('SELECT 1')).rejects.toThrow(
                'Database not connected. Call initialize() first.'
            );
        });
    });

    describe('transaction', () => {
        beforeEach(async () => {
            mockPool.connect.mockResolvedValue(mockClient);
            mockClient.query.mockResolvedValue({ rows: [{ now: new Date() }] });
            await databaseManager.initialize();
        });

        it('should execute transaction successfully', async () => {
            const callback = jest.fn().mockResolvedValue('transaction result');
            mockClient.query.mockResolvedValue({});

            const result = await databaseManager.transaction(callback);

            expect(mockPool.connect).toHaveBeenCalled();
            expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
            expect(callback).toHaveBeenCalledWith(mockClient);
            expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
            expect(mockClient.release).toHaveBeenCalled();
            expect(result).toBe('transaction result');
        });

        it('should rollback on error', async () => {
            const error = new Error('Transaction error');
            const callback = jest.fn().mockRejectedValue(error);
            mockClient.query.mockResolvedValue({});

            await expect(databaseManager.transaction(callback)).rejects.toThrow('Transaction error');

            expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
            expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
            expect(mockClient.release).toHaveBeenCalled();
        });
    });

    describe('applySchema', () => {
        beforeEach(async () => {
            mockPool.connect.mockResolvedValue(mockClient);
            mockClient.query.mockResolvedValue({ rows: [{ now: new Date() }] });
            await databaseManager.initialize();
        });

        it('should apply schema successfully', async () => {
            const schemaSQL = 'CREATE TABLE test (id SERIAL PRIMARY KEY);';
            fs.readFile.mockResolvedValue(schemaSQL);
            mockPool.query.mockResolvedValue({});

            const result = await databaseManager.applySchema();

            expect(fs.readFile).toHaveBeenCalledWith(
                path.join(__dirname, '../../../src/database/schema.sql'),
                'utf8'
            );
            expect(mockPool.query).toHaveBeenCalledWith(schemaSQL, []);
            expect(result).toBe(true);
        });

        it('should handle schema file read error', async () => {
            const error = new Error('File not found');
            fs.readFile.mockRejectedValue(error);

            await expect(databaseManager.applySchema()).rejects.toThrow('File not found');
        });
    });

    describe('runMigrations', () => {
        beforeEach(async () => {
            mockPool.connect.mockResolvedValue(mockClient);
            mockClient.query.mockResolvedValue({ rows: [{ now: new Date() }] });
            await databaseManager.initialize();
        });

        it('should create migrations table and run migrations', async () => {
            fs.readdir.mockResolvedValue(['001_initial.sql', '002_add_indexes.sql']);
            fs.readFile.mockResolvedValueOnce('CREATE TABLE users (id SERIAL);')
                      .mockResolvedValueOnce('CREATE INDEX idx_users_id ON users(id);');
            
            // Mock migration table queries
            mockPool.query
                .mockResolvedValueOnce({}) // CREATE migrations table
                .mockResolvedValueOnce({ rows: [] }) // Check first migration
                .mockResolvedValueOnce({ rows: [] }); // Check second migration

            // Mock transaction queries
            mockClient.query
                .mockResolvedValueOnce({}) // BEGIN
                .mockResolvedValueOnce({}) // Migration SQL
                .mockResolvedValueOnce({}) // Insert migration record
                .mockResolvedValueOnce({}) // COMMIT
                .mockResolvedValueOnce({}) // BEGIN
                .mockResolvedValueOnce({}) // Migration SQL
                .mockResolvedValueOnce({}) // Insert migration record
                .mockResolvedValueOnce({}); // COMMIT

            const result = await databaseManager.runMigrations();

            expect(fs.readdir).toHaveBeenCalled();
            expect(fs.readFile).toHaveBeenCalledTimes(2);
            expect(result).toBe(true);
        });

        it('should skip already applied migrations', async () => {
            fs.readdir.mockResolvedValue(['001_initial.sql']);
            
            // Mock migration already exists
            mockPool.query
                .mockResolvedValueOnce({}) // CREATE migrations table
                .mockResolvedValueOnce({ rows: [{ id: 1 }] }); // Migration exists

            const result = await databaseManager.runMigrations();

            expect(fs.readFile).not.toHaveBeenCalled();
            expect(result).toBe(true);
        });

        it('should handle missing migrations directory', async () => {
            const error = new Error('ENOENT: no such file or directory');
            error.code = 'ENOENT';
            fs.readdir.mockRejectedValue(error);

            mockPool.query.mockResolvedValueOnce({}); // CREATE migrations table

            const result = await databaseManager.runMigrations();

            expect(result).toBe(true);
        });
    });

    describe('healthCheck', () => {
        beforeEach(async () => {
            mockPool.connect.mockResolvedValue(mockClient);
            mockClient.query.mockResolvedValue({ rows: [{ now: new Date() }] });
            await databaseManager.initialize();
        });

        it('should return healthy status', async () => {
            const now = new Date();
            const version = 'PostgreSQL 13.0';
            mockPool.query.mockResolvedValue({
                rows: [{ current_time: now, version }]
            });

            const health = await databaseManager.healthCheck();

            expect(health.status).toBe('healthy');
            expect(health.timestamp).toBe(now);
            expect(health.version).toBe(version);
            expect(health.connected).toBe(true);
        });

        it('should return unhealthy status on error', async () => {
            const error = new Error('Connection lost');
            mockPool.query.mockRejectedValue(error);

            const health = await databaseManager.healthCheck();

            expect(health.status).toBe('unhealthy');
            expect(health.error).toBe('Connection lost');
            expect(health.connected).toBe(false);
        });
    });

    describe('getStats', () => {
        beforeEach(async () => {
            mockPool.connect.mockResolvedValue(mockClient);
            mockClient.query.mockResolvedValue({ rows: [{ now: new Date() }] });
            await databaseManager.initialize();
        });

        it('should return database statistics', async () => {
            mockPool.query
                .mockResolvedValueOnce({ rows: [{ count: '100' }] }) // sources
                .mockResolvedValueOnce({ rows: [{ count: '1000' }] }) // documents
                .mockResolvedValueOnce({ rows: [{ count: '50' }] }) // jobs
                .mockResolvedValueOnce({ rows: [{ count: '25' }] }) // document_visibility
                .mockResolvedValueOnce({ rows: [{ count: '10' }] }) // review_sessions
                .mockResolvedValueOnce({ rows: [{ count: '200' }] }) // document_reviews
                .mockResolvedValueOnce({ rows: [{ count: '500' }] }) // document_enrichments
                .mockResolvedValueOnce({ rows: [{ count: '5' }] }) // active_jobs
                .mockResolvedValueOnce({ rows: [{ count: '20' }] }); // recent_documents

            const stats = await databaseManager.getStats();

            expect(stats.sources).toBe(100);
            expect(stats.documents).toBe(1000);
            expect(stats.jobs).toBe(50);
            expect(stats.active_jobs).toBe(5);
            expect(stats.recent_documents).toBe(20);
        });
    });

    describe('cleanup', () => {
        beforeEach(async () => {
            mockPool.connect.mockResolvedValue(mockClient);
            mockClient.query.mockResolvedValue({ rows: [{ now: new Date() }] });
            await databaseManager.initialize();
        });

        it('should cleanup old data', async () => {
            mockPool.query
                .mockResolvedValueOnce({ rowCount: 100 }) // job logs
                .mockResolvedValueOnce({ rowCount: 50 }) // completed jobs
                .mockResolvedValueOnce({ rowCount: 25 }); // audit logs

            const results = await databaseManager.cleanup({
                jobLogRetentionDays: 30,
                completedJobRetentionDays: 7,
                auditLogRetentionDays: 90
            });

            expect(results['job logs']).toBe(100);
            expect(results['completed jobs']).toBe(50);
            expect(results['audit logs']).toBe(25);
        });
    });

    describe('close', () => {
        it('should close connection', async () => {
            mockPool.connect.mockResolvedValue(mockClient);
            mockClient.query.mockResolvedValue({ rows: [{ now: new Date() }] });
            await databaseManager.initialize();

            mockPool.end.mockResolvedValue();

            await databaseManager.close();

            expect(mockPool.end).toHaveBeenCalled();
            expect(databaseManager.isConnected).toBe(false);
        });

        it('should handle close when pool is null', async () => {
            databaseManager.pool = null;

            await expect(databaseManager.close()).resolves.toBeUndefined();
        });
    });

    describe('getClient', () => {
        beforeEach(async () => {
            mockPool.connect.mockResolvedValue(mockClient);
            mockClient.query.mockResolvedValue({ rows: [{ now: new Date() }] });
            await databaseManager.initialize();
        });

        it('should return a client', async () => {
            const client = await databaseManager.getClient();

            expect(mockPool.connect).toHaveBeenCalled();
            expect(client).toBe(mockClient);
        });
    });
});
