const JobDAO = require('../../../src/database/JobDAO');

describe('JobDAO', () => {
    let jobDAO;
    let mockDb;

    beforeEach(() => {
        mockDb = {
            query: jest.fn()
        };
        jobDAO = new JobDAO(mockDb);
    });

    describe('create', () => {
        it('should create a job successfully', async () => {
            const jobData = {
                type: 'ingestion',
                source_id: 'source-123',
                document_id: 'doc-456',
                config: { timeout: 30000 },
                priority: 5
            };

            const expectedResult = { id: 'job-123', ...jobData };
            mockDb.query.mockResolvedValue({ rows: [expectedResult] });

            const result = await jobDAO.create(jobData);

            expect(mockDb.query).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO jobs'),
                ['ingestion', 'pending', 5, 'source-123', 'doc-456', '{"timeout":30000}', 0]
            );
            expect(result).toEqual(expectedResult);
        });

        it('should use default values', async () => {
            const jobData = { type: 'processing' };
            mockDb.query.mockResolvedValue({ rows: [{ id: 'job-123' }] });

            await jobDAO.create(jobData);

            expect(mockDb.query).toHaveBeenCalledWith(
                expect.anything(),
                ['processing', 'pending', 0, undefined, undefined, '{}', 0]
            );
        });

        it('should handle creation errors', async () => {
            const error = new Error('Database error');
            mockDb.query.mockRejectedValue(error);

            await expect(jobDAO.create({ type: 'test' })).rejects.toThrow('Database error');
        });
    });

    describe('findById', () => {
        it('should find job by ID', async () => {
            const jobId = 'job-123';
            const expectedJob = {
                id: jobId,
                type: 'ingestion',
                status: 'running'
            };

            mockDb.query.mockResolvedValue({ rows: [expectedJob] });

            const result = await jobDAO.findById(jobId);

            expect(mockDb.query).toHaveBeenCalledWith(
                'SELECT * FROM jobs WHERE id = $1',
                [jobId]
            );
            expect(result).toEqual(expectedJob);
        });

        it('should return null when job not found', async () => {
            mockDb.query.mockResolvedValue({ rows: [] });

            const result = await jobDAO.findById('nonexistent');

            expect(result).toBeNull();
        });

        it('should handle query errors', async () => {
            const error = new Error('Database error');
            mockDb.query.mockRejectedValue(error);

            await expect(jobDAO.findById('job-123')).rejects.toThrow('Database error');
        });
    });

    describe('updateStatus', () => {
        it('should update job status successfully', async () => {
            const jobId = 'job-123';
            const status = 'completed';
            const options = {
                progress: 100,
                result: { processed: 50 }
            };

            const expectedResult = { id: jobId, status, progress: 100 };
            mockDb.query.mockResolvedValue({ rows: [expectedResult] });

            const result = await jobDAO.updateStatus(jobId, status, options);

            expect(mockDb.query).toHaveBeenCalledWith(
                expect.stringContaining('UPDATE jobs'),
                [jobId, status, 100, '{"processed":50}']
            );
            expect(result).toEqual(expectedResult);
        });

        it('should add started_at when status is running', async () => {
            const jobId = 'job-123';
            mockDb.query.mockResolvedValue({ rows: [{ id: jobId }] });

            await jobDAO.updateStatus(jobId, 'running');

            expect(mockDb.query).toHaveBeenCalledWith(
                expect.stringContaining('started_at = NOW()'),
                [jobId, 'running']
            );
        });

        it('should add completed_at when status is completed', async () => {
            const jobId = 'job-123';
            mockDb.query.mockResolvedValue({ rows: [{ id: jobId }] });

            await jobDAO.updateStatus(jobId, 'completed');

            expect(mockDb.query).toHaveBeenCalledWith(
                expect.stringContaining('completed_at = NOW()'),
                [jobId, 'completed']
            );
        });

        it('should throw error when job not found', async () => {
            mockDb.query.mockResolvedValue({ rows: [] });

            await expect(jobDAO.updateStatus('nonexistent', 'completed'))
                .rejects.toThrow('Job not found');
        });
    });

    describe('findByStatus', () => {
        it('should find jobs by status', async () => {
            const status = 'pending';
            const expectedJobs = [
                { id: 'job-1', status },
                { id: 'job-2', status }
            ];

            mockDb.query.mockResolvedValue({ rows: expectedJobs });

            const result = await jobDAO.findByStatus(status);

            expect(mockDb.query).toHaveBeenCalledWith(
                expect.stringContaining('WHERE status = $1'),
                [status, 100, 0]
            );
            expect(result).toEqual(expectedJobs);
        });

        it('should filter by type when provided', async () => {
            const status = 'pending';
            const options = { type: 'ingestion', limit: 50, offset: 10 };

            mockDb.query.mockResolvedValue({ rows: [] });

            await jobDAO.findByStatus(status, options);

            expect(mockDb.query).toHaveBeenCalledWith(
                expect.stringContaining('AND type = $2'),
                [status, 'ingestion', 50, 10]
            );
        });
    });

    describe('getNextPending', () => {
        it('should get next pending job without dependencies', async () => {
            const expectedJob = {
                id: 'job-123',
                type: 'ingestion',
                status: 'pending'
            };

            mockDb.query.mockResolvedValue({ rows: [expectedJob] });

            const result = await jobDAO.getNextPending();

            expect(mockDb.query).toHaveBeenCalledWith(
                expect.stringContaining('WHERE j.status = \'pending\''),
                []
            );
            expect(result).toEqual(expectedJob);
        });

        it('should filter by type when provided', async () => {
            const type = 'processing';
            mockDb.query.mockResolvedValue({ rows: [] });

            await jobDAO.getNextPending(type);

            expect(mockDb.query).toHaveBeenCalledWith(
                expect.stringContaining('AND j.type = $1'),
                [type]
            );
        });

        it('should return null when no pending jobs', async () => {
            mockDb.query.mockResolvedValue({ rows: [] });

            const result = await jobDAO.getNextPending();

            expect(result).toBeNull();
        });
    });

    describe('addDependency', () => {
        it('should add job dependency successfully', async () => {
            const jobId = 'job-123';
            const dependsOnJobId = 'job-456';
            const expectedResult = { job_id: jobId, depends_on_job_id: dependsOnJobId };

            mockDb.query.mockResolvedValue({ rows: [expectedResult] });

            const result = await jobDAO.addDependency(jobId, dependsOnJobId);

            expect(mockDb.query).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO job_dependencies'),
                [jobId, dependsOnJobId]
            );
            expect(result).toEqual(expectedResult);
        });

        it('should handle dependency creation errors', async () => {
            const error = new Error('Dependency error');
            mockDb.query.mockRejectedValue(error);

            await expect(jobDAO.addDependency('job-1', 'job-2')).rejects.toThrow('Dependency error');
        });
    });

    describe('addLog', () => {
        it('should add job log entry', async () => {
            const jobId = 'job-123';
            const level = 'info';
            const message = 'Job started';
            const metadata = { timestamp: Date.now() };

            const expectedResult = { id: 'log-123', job_id: jobId, level, message };
            mockDb.query.mockResolvedValue({ rows: [expectedResult] });

            const result = await jobDAO.addLog(jobId, level, message, metadata);

            expect(mockDb.query).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO job_logs'),
                [jobId, level, message, JSON.stringify(metadata)]
            );
            expect(result).toEqual(expectedResult);
        });

        it('should handle empty metadata', async () => {
            const jobId = 'job-123';
            mockDb.query.mockResolvedValue({ rows: [{ id: 'log-123' }] });

            await jobDAO.addLog(jobId, 'info', 'Test message');

            expect(mockDb.query).toHaveBeenCalledWith(
                expect.anything(),
                [jobId, 'info', 'Test message', '{}']
            );
        });
    });

    describe('getLogs', () => {
        it('should get job logs', async () => {
            const jobId = 'job-123';
            const expectedLogs = [
                { id: 'log-1', level: 'info', message: 'Started' },
                { id: 'log-2', level: 'info', message: 'Completed' }
            ];

            mockDb.query.mockResolvedValue({ rows: expectedLogs });

            const result = await jobDAO.getLogs(jobId);

            expect(mockDb.query).toHaveBeenCalledWith(
                expect.stringContaining('WHERE job_id = $1'),
                [jobId, 100, 0]
            );
            expect(result).toEqual(expectedLogs);
        });

        it('should filter by level when provided', async () => {
            const jobId = 'job-123';
            const options = { level: 'error', limit: 50, offset: 10 };

            mockDb.query.mockResolvedValue({ rows: [] });

            await jobDAO.getLogs(jobId, options);

            expect(mockDb.query).toHaveBeenCalledWith(
                expect.stringContaining('AND level = $2'),
                [jobId, 'error', 50, 10]
            );
        });
    });

    describe('cancel', () => {
        it('should cancel job successfully', async () => {
            const jobId = 'job-123';
            const reason = 'User requested cancellation';

            // Mock updateStatus call
            jobDAO.updateStatus = jest.fn().mockResolvedValue({ id: jobId, status: 'cancelled' });
            jobDAO.addLog = jest.fn().mockResolvedValue({});

            const result = await jobDAO.cancel(jobId, reason);

            expect(jobDAO.updateStatus).toHaveBeenCalledWith(jobId, 'cancelled', {
                error_message: reason
            });
            expect(jobDAO.addLog).toHaveBeenCalledWith(jobId, 'info', 'Job cancelled', { reason });
            expect(result.status).toBe('cancelled');
        });
    });

    describe('retry', () => {
        it('should retry failed job successfully', async () => {
            const jobId = 'job-123';
            const failedJob = { id: jobId, status: 'failed' };

            jobDAO.findById = jest.fn().mockResolvedValue(failedJob);
            jobDAO.updateStatus = jest.fn().mockResolvedValue({ id: jobId, status: 'pending' });
            jobDAO.addLog = jest.fn().mockResolvedValue({});

            const result = await jobDAO.retry(jobId);

            expect(jobDAO.updateStatus).toHaveBeenCalledWith(jobId, 'pending', {
                progress: 0,
                error_message: null,
                result: null
            });
            expect(jobDAO.addLog).toHaveBeenCalledWith(jobId, 'info', 'Job retried');
            expect(result.status).toBe('pending');
        });

        it('should throw error when job not found', async () => {
            jobDAO.findById = jest.fn().mockResolvedValue(null);

            await expect(jobDAO.retry('nonexistent')).rejects.toThrow('Job not found');
        });

        it('should throw error when job is not failed', async () => {
            const runningJob = { id: 'job-123', status: 'running' };
            jobDAO.findById = jest.fn().mockResolvedValue(runningJob);

            await expect(jobDAO.retry('job-123')).rejects.toThrow('Only failed jobs can be retried');
        });
    });

    describe('getStats', () => {
        it('should return job statistics', async () => {
            mockDb.query
                .mockResolvedValueOnce({ rows: [{ count: '1000' }] }) // total
                .mockResolvedValueOnce({ rows: [
                    { status: 'completed', count: '800' },
                    { status: 'failed', count: '100' }
                ]}) // by_status
                .mockResolvedValueOnce({ rows: [
                    { type: 'ingestion', count: '600' },
                    { type: 'processing', count: '400' }
                ]}) // by_type
                .mockResolvedValueOnce({ rows: [{ count: '50' }] }) // recent_completed
                .mockResolvedValueOnce({ rows: [{ count: '10' }] }) // recent_failed
                .mockResolvedValueOnce({ rows: [{ avg_seconds: '120.5' }] }); // avg_duration

            const stats = await jobDAO.getStats();

            expect(stats.total).toBe(1000);
            expect(stats.by_status).toHaveLength(2);
            expect(stats.by_type).toHaveLength(2);
            expect(stats.recent_completed).toBe(50);
            expect(stats.recent_failed).toBe(10);
            expect(stats.avg_duration).toBe(120.5);
        });
    });

    describe('cleanup', () => {
        it('should cleanup old jobs', async () => {
            const retentionDays = 30;
            mockDb.query.mockResolvedValue({ rowCount: 150 });

            const result = await jobDAO.cleanup(retentionDays);

            expect(mockDb.query).toHaveBeenCalledWith(
                expect.stringContaining('DELETE FROM jobs')
            );
            expect(result).toBe(150);
        });

        it('should use default retention period', async () => {
            mockDb.query.mockResolvedValue({ rowCount: 100 });

            await jobDAO.cleanup();

            expect(mockDb.query).toHaveBeenCalledWith(
                expect.anything()
            );
        });
    });

    describe('getQueueStatus', () => {
        it('should return queue status', async () => {
            const expectedStatus = [
                { status: 'pending', type: 'ingestion', count: '10', avg_priority: '5.0' },
                { status: 'running', type: 'processing', count: '3', avg_priority: '3.0' }
            ];

            mockDb.query.mockResolvedValue({ rows: expectedStatus });

            const result = await jobDAO.getQueueStatus();

            expect(mockDb.query).toHaveBeenCalledWith(
                expect.stringContaining('WHERE status IN')
            );
            expect(result).toEqual(expectedStatus);
        });
    });
});
