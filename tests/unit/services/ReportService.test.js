const ReportService = require('../../../src/services/ReportService');
const ReportGenerator = require('../../../src/reporting/ReportGenerator');
const DatabaseManager = require('../../../src/database/DatabaseManager');

// Mock dependencies
jest.mock('../../../src/reporting/ReportGenerator');
jest.mock('../../../src/database/DatabaseManager');
// Mock pg module
jest.mock('pg', () => {
  const mockPool = {
    query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    connect: jest.fn().mockResolvedValue({
      query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: jest.fn()
    }),
    end: jest.fn().mockResolvedValue(undefined),
    on: jest.fn()
  };
  
  return {
    Pool: jest.fn(() => mockPool)
  };
});
jest.mock('node-schedule', () => ({
  scheduleJob: jest.fn((cron, fn) => ({
    nextInvocation: () => new Date(Date.now() + 86400000),
    cancel: jest.fn()
  }))
}));
jest.mock('fs', () => ({
  promises: {
    mkdir: jest.fn(),
    readdir: jest.fn(() => []),
    writeFile: jest.fn(),
    readFile: jest.fn(() => Buffer.from('test content')),
    unlink: jest.fn(),
    access: jest.fn()
  }
}));

describe('ReportService', () => {
  let service;
  let mockDb;
  let mockGenerator;
  let originalDate;

  beforeEach(() => {
    // Save original Date
    originalDate = global.Date;
    
    // Mock Date.now
    const mockDate = jest.fn().mockImplementation((arg) => {
      if (arg) return new originalDate(arg);
      return new originalDate('2024-01-15T10:00:00');
    }) as any;
    mockDate.now = jest.fn(() => new originalDate('2024-01-15T10:00:00').getTime());
    mockDate.parse = originalDate.parse;
    mockDate.UTC = originalDate.UTC;
    global.Date = mockDate;
    
    mockDb = {
      query: jest.fn()
    };
    
    mockGenerator = {
      generate: jest.fn(),
      loadTemplate: jest.fn()
    };
    
    DatabaseManager.mockImplementation(() => mockDb);
    ReportGenerator.mockImplementation(() => mockGenerator);
    
    service = new ReportService();
    jest.clearAllMocks();
  });

  afterEach(() => {
    // Restore original Date
    global.Date = originalDate;
  });

  describe('initialize', () => {
    it('should initialize service successfully', async () => {
      mockDb.query.mockResolvedValue({ rows: [] });
      
      await service.initialize();
      
      expect(require('fs').promises.mkdir).toHaveBeenCalledWith(
        expect.stringContaining('exports/reports'),
        { recursive: true }
      );
    });

    it('should handle initialization errors', async () => {
      require('fs').promises.mkdir.mockRejectedValue(new Error('Permission denied'));
      
      await expect(service.initialize()).rejects.toThrow('Permission denied');
    });
  });

  describe('createReportDefinition', () => {
    it('should create report definition successfully', async () => {
      const definition = {
        name: 'Test Report',
        description: 'Test description',
        reportType: 'document-analytics',
        createdBy: 'user123'
      };

      const mockResult = {
        rows: [{
          id: 1,
          report_id: 'def_123',
          ...definition
        }]
      };

      mockDb.query.mockResolvedValue(mockResult);

      const result = await service.createReportDefinition(definition);

      expect(result).toEqual(mockResult.rows[0]);
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO report_definitions'),
        expect.arrayContaining([
          expect.stringContaining('def_'),
          definition.name,
          definition.description,
          definition.reportType
        ])
      );
    });

    it('should handle database errors', async () => {
      mockDb.query.mockRejectedValue(new Error('Database error'));

      await expect(service.createReportDefinition({
        name: 'Test',
        reportType: 'test'
      })).rejects.toThrow('Database error');
    });
  });

  describe('scheduleReport', () => {
    it('should schedule report successfully', async () => {
      const scheduleConfig = {
        reportDefinitionId: 1,
        scheduleType: 'daily',
        scheduleConfig: { hour: 9, minute: 0 },
        outputFormat: 'pdf',
        createdBy: 'user123'
      };

      // Mock report definition exists
      mockDb.query.mockResolvedValueOnce({
        rows: [{
          id: 1,
          report_id: 'def_123',
          is_active: true
        }]
      });

      // Mock insert scheduled report
      mockDb.query.mockResolvedValueOnce({
        rows: [{
          id: 1,
          schedule_id: 'sch_123',
          ...scheduleConfig
        }]
      });

      const result = await service.scheduleReport(scheduleConfig);

      expect(result.schedule_id).toContain('sch_');
      expect(mockDb.query).toHaveBeenCalledTimes(2);
    });

    it('should throw error if report definition not found', async () => {
      mockDb.query.mockResolvedValue({ rows: [] });

      await expect(service.scheduleReport({
        reportDefinitionId: 999,
        scheduleType: 'daily',
        outputFormat: 'pdf'
      })).rejects.toThrow('Report definition not found or inactive');
    });

    it('should calculate correct next run times', () => {
      // Daily
      const daily = service.calculateNextRunTime('daily', { hour: 9, minute: 0 });
      expect(daily.getHours()).toBe(9);
      expect(daily.getDate()).toBe(16); // Next day

      // Weekly
      const weekly = service.calculateNextRunTime('weekly', { 
        dayOfWeek: 1, // Monday
        hour: 9, 
        minute: 0 
      });
      expect(weekly.getDay()).toBe(1);

      // Monthly
      const monthly = service.calculateNextRunTime('monthly', {
        dayOfMonth: 1,
        hour: 9,
        minute: 0
      });
      expect(monthly.getDate()).toBe(1);
    });
  });

  describe('generateReport', () => {
    it('should generate report successfully', async () => {
      const reportRequest = {
        reportType: 'document-analytics',
        name: 'Test Report',
        format: 'pdf',
        parameters: { startDate: '2024-01-01' },
        requestedBy: 'user123'
      };

      // Mock create history
      mockDb.query.mockResolvedValueOnce({
        rows: [{
          id: 1,
          report_id: 'rpt_123',
          status: 'pending'
        }]
      });

      // Mock update status calls
      mockDb.query.mockResolvedValue({ rows: [] });

      // Mock data query
      mockDb.query.mockResolvedValueOnce({
        rows: [
          { id: 1, title: 'Doc 1', qualityScore: 85 },
          { id: 2, title: 'Doc 2', qualityScore: 92 }
        ]
      });

      // Mock generator
      mockGenerator.generate.mockResolvedValue({
        buffer: Buffer.from('PDF content'),
        contentType: 'application/pdf',
        extension: 'pdf'
      });

      const result = await service.generateReport(reportRequest);

      expect(result).toHaveProperty('reportId');
      expect(result).toHaveProperty('filePath');
      expect(result.format).toBe('pdf');
      expect(mockGenerator.generate).toHaveBeenCalled();
      expect(require('fs').promises.writeFile).toHaveBeenCalled();
    });

    it('should handle generation errors', async () => {
      const reportRequest = {
        reportType: 'invalid-type',
        format: 'pdf',
        requestedBy: 'user123'
      };

      // Mock create history
      mockDb.query.mockResolvedValueOnce({
        rows: [{
          id: 1,
          report_id: 'rpt_123',
          status: 'pending'
        }]
      });

      await expect(service.generateReport(reportRequest))
        .rejects.toThrow('Unknown report type: invalid-type');
    });
  });

  describe('getReportData', () => {
    it('should get document analytics data', async () => {
      const parameters = {
        startDate: '2024-01-01',
        endDate: '2024-01-31',
        status: 'published'
      };

      const mockData = [
        { id: 1, title: 'Doc 1', status: 'published' }
      ];

      mockDb.query.mockResolvedValue({ rows: mockData });

      const result = await service.getDocumentAnalyticsData(parameters);

      expect(result).toEqual(mockData);
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('FROM documents'),
        expect.arrayContaining(['2024-01-01', '2024-01-31', 'published'])
      );
    });

    it('should get entity extraction data', async () => {
      const parameters = {
        entityType: 'person',
        minConfidence: 0.8
      };

      const mockData = [
        { id: 1, text: 'John Doe', type: 'person', confidence: 0.9 }
      ];

      mockDb.query.mockResolvedValue({ rows: mockData });

      const result = await service.getEntityExtractionData(parameters);

      expect(result).toEqual(mockData);
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('FROM extracted_entities'),
        expect.arrayContaining(['person', 0.8])
      );
    });

    it('should handle unknown report types', async () => {
      await expect(service.getReportData('unknown-type', {}))
        .rejects.toThrow('Unknown report type: unknown-type');
    });
  });

  describe('getReport', () => {
    it('should get report by ID', async () => {
      const mockReport = {
        report_id: 'rpt_123',
        name: 'Test Report',
        status: 'completed'
      };

      mockDb.query.mockResolvedValue({ rows: [mockReport] });

      const result = await service.getReport('rpt_123');

      expect(result).toEqual(mockReport);
      expect(mockDb.query).toHaveBeenCalledWith(
        'SELECT * FROM report_history WHERE report_id = $1',
        ['rpt_123']
      );
    });

    it('should throw error if report not found', async () => {
      mockDb.query.mockResolvedValue({ rows: [] });

      await expect(service.getReport('invalid'))
        .rejects.toThrow('Report not found');
    });
  });

  describe('getReportFile', () => {
    it('should get report file successfully', async () => {
      const mockReport = {
        report_id: 'rpt_123',
        file_path: '/path/to/report.pdf',
        format: 'pdf',
        status: 'completed'
      };

      mockDb.query.mockResolvedValueOnce({ rows: [mockReport] });
      mockDb.query.mockResolvedValueOnce({ rows: [] }); // increment download

      const result = await service.getReportFile('rpt_123');

      expect(result).toHaveProperty('buffer');
      expect(result).toHaveProperty('filename');
      expect(result.contentType).toBe('application/pdf');
      expect(require('fs').promises.access).toHaveBeenCalledWith('/path/to/report.pdf');
    });

    it('should throw error if file not available', async () => {
      const mockReport = {
        report_id: 'rpt_123',
        file_path: null,
        status: 'failed'
      };

      mockDb.query.mockResolvedValue({ rows: [mockReport] });

      await expect(service.getReportFile('rpt_123'))
        .rejects.toThrow('Report file not available');
    });
  });

  describe('listReports', () => {
    it('should list reports with filters', async () => {
      const filters = {
        status: 'completed',
        reportType: 'document-analytics',
        limit: 10,
        offset: 0
      };

      const mockReports = [
        { report_id: 'rpt_1', status: 'completed' },
        { report_id: 'rpt_2', status: 'completed' }
      ];

      mockDb.query.mockResolvedValue({ rows: mockReports });

      const result = await service.listReports(filters);

      expect(result).toEqual(mockReports);
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('FROM report_history'),
        expect.arrayContaining(['completed', 'document-analytics', 10, 0])
      );
    });
  });

  describe('cleanupOldReports', () => {
    it('should cleanup old reports', async () => {
      const oldReports = [
        { report_id: 'rpt_1', file_path: '/path/to/old1.pdf' },
        { report_id: 'rpt_2', file_path: '/path/to/old2.pdf' }
      ];

      mockDb.query.mockResolvedValueOnce({ rows: oldReports });
      mockDb.query.mockResolvedValue({ rows: [] });

      const result = await service.cleanupOldReports(30);

      expect(result).toBe(2);
      expect(require('fs').promises.unlink).toHaveBeenCalledTimes(2);
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM report_history'),
        expect.any(Array)
      );
    });

    it('should handle cleanup errors gracefully', async () => {
      const oldReports = [
        { report_id: 'rpt_1', file_path: '/path/to/old1.pdf' }
      ];

      mockDb.query.mockResolvedValueOnce({ rows: oldReports });
      mockDb.query.mockRejectedValueOnce(new Error('Delete failed'));

      const result = await service.cleanupOldReports(30);

      expect(result).toBe(0);
    });
  });

  describe('helper methods', () => {
    it('should generate unique report IDs', () => {
      const id1 = service.generateReportId('test');
      const id2 = service.generateReportId('test');

      expect(id1).toMatch(/^test_[a-z0-9]+_[a-f0-9]+$/);
      expect(id1).not.toBe(id2);
    });

    it('should build correct cron expressions', () => {
      expect(service.buildCronExpression('daily', { hour: 9, minute: 30 }))
        .toBe('30 9 * * *');
      
      expect(service.buildCronExpression('weekly', { dayOfWeek: 1, hour: 9 }))
        .toBe('0 9 * * 1');
      
      expect(service.buildCronExpression('monthly', { dayOfMonth: 15, hour: 9 }))
        .toBe('0 9 15 * *');
    });

    it('should get correct content types', () => {
      expect(service.getContentType('pdf')).toBe('application/pdf');
      expect(service.getContentType('csv')).toBe('text/csv');
      expect(service.getContentType('excel')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      expect(service.getContentType('json')).toBe('application/json');
      expect(service.getContentType('html')).toBe('text/html');
      expect(service.getContentType('unknown')).toBe('application/octet-stream');
    });
  });
});