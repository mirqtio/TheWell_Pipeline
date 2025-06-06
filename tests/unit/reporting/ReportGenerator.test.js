const ReportGenerator = require('../../../src/reporting/ReportGenerator');
const fs = require('fs').promises;
const path = require('path');

// Mock dependencies
jest.mock('pdfkit');
jest.mock('exceljs');
jest.mock('chart.js');
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
// Canvas is optional in ReportGenerator, so we don't need to mock it

describe('ReportGenerator', () => {
  let generator;

  beforeEach(() => {
    generator = new ReportGenerator();
    jest.clearAllMocks();
  });

  describe('initialize', () => {
    it('should initialize handlebars helpers', () => {
      expect(generator.formatters).toBeDefined();
      expect(generator.formatters.pdf).toBeDefined();
      expect(generator.formatters.csv).toBeDefined();
      expect(generator.formatters.excel).toBeDefined();
      expect(generator.formatters.json).toBeDefined();
      expect(generator.formatters.html).toBeDefined();
    });
  });

  describe('loadTemplate', () => {
    it('should load template from content', async () => {
      const templateContent = '<h1>{{title}}</h1>';
      const template = await generator.loadTemplate('test.hbs', templateContent);
      
      expect(template).toBeDefined();
      expect(generator.templates.has('test')).toBe(true);
      
      const result = template({ title: 'Test Report' });
      expect(result).toBe('<h1>Test Report</h1>');
    });

    it('should handle template loading errors', async () => {
      await expect(generator.loadTemplate('/invalid/path.hbs'))
        .rejects.toThrow();
    });
  });

  describe('generate', () => {
    const mockData = [
      { id: 1, title: 'Doc 1', qualityScore: 85 },
      { id: 2, title: 'Doc 2', qualityScore: 92 }
    ];

    it('should generate PDF report', async () => {
      const result = await generator.generate(
        'document-analytics',
        mockData,
        'pdf',
        { metadata: { user: 'test' } }
      );

      expect(result).toBeDefined();
      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(result.contentType).toBe('application/pdf');
      expect(result.extension).toBe('pdf');
    });

    it('should generate CSV report', async () => {
      const result = await generator.generate(
        'document-analytics',
        mockData,
        'csv'
      );

      expect(result).toBeDefined();
      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(result.contentType).toBe('text/csv');
      expect(result.extension).toBe('csv');
    });

    it('should generate Excel report', async () => {
      const result = await generator.generate(
        'document-analytics',
        mockData,
        'excel'
      );

      expect(result).toBeDefined();
      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(result.contentType).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      expect(result.extension).toBe('xlsx');
    });

    it('should generate JSON report', async () => {
      const result = await generator.generate(
        'document-analytics',
        mockData,
        'json',
        { pretty: true }
      );

      expect(result).toBeDefined();
      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(result.contentType).toBe('application/json');
      expect(result.extension).toBe('json');
      
      const parsed = JSON.parse(result.buffer.toString());
      expect(parsed.reportType).toBe('document-analytics');
    });

    it('should generate HTML report', async () => {
      const result = await generator.generate(
        'document-analytics',
        mockData,
        'html'
      );

      expect(result).toBeDefined();
      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(result.contentType).toBe('text/html');
      expect(result.extension).toBe('html');
    });

    it('should throw error for unsupported format', async () => {
      await expect(generator.generate(
        'document-analytics',
        mockData,
        'invalid'
      )).rejects.toThrow('Unsupported format: invalid');
    });
  });

  describe('transformData', () => {
    it('should transform document analytics data', async () => {
      const data = [
        { id: 1, status: 'published', qualityScore: 85, feedbackCount: 3 },
        { id: 2, status: 'draft', qualityScore: 92, feedbackCount: 1 }
      ];

      const result = await generator.transformDocumentAnalytics(data, {});

      expect(result.summary).toBeDefined();
      expect(result.summary.totalDocuments).toBe(2);
      expect(result.summary.averageQualityScore).toBe('88.50');
      expect(result.summary.totalFeedback).toBe(4);
      expect(result.charts).toBeDefined();
      expect(result.charts.length).toBeGreaterThan(0);
    });

    it('should transform entity extraction data', async () => {
      const data = [
        { entities: [
          { type: 'person', confidence: 0.9 },
          { type: 'location', confidence: 0.85 }
        ]},
        { entities: [
          { type: 'person', confidence: 0.95 }
        ]}
      ];

      const result = await generator.transformEntityExtraction(data, {});

      expect(result.summary).toBeDefined();
      expect(result.summary.totalEntities).toBe(3);
      expect(result.summary.uniqueEntityTypes).toBe(2);
      expect(result.charts).toBeDefined();
    });

    it('should transform alert summary data', async () => {
      const data = [
        { type: 'error', severity: 'critical', status: 'resolved' },
        { type: 'warning', severity: 'warning', status: 'open' }
      ];

      const result = await generator.transformAlertSummary(data, {});

      expect(result.summary).toBeDefined();
      expect(result.summary.totalAlerts).toBe(2);
      expect(result.summary.criticalAlerts).toBe(1);
      expect(result.summary.resolvedAlerts).toBe(1);
    });

    it('should transform search analytics data', async () => {
      const data = [
        { query: 'test', resultCount: 10, responseTime: 150, successful: true },
        { query: 'test', resultCount: 8, responseTime: 120, successful: true },
        { query: 'demo', resultCount: 0, responseTime: 80, successful: false }
      ];

      const result = await generator.transformSearchAnalytics(data, {});

      expect(result.summary).toBeDefined();
      expect(result.summary.totalSearches).toBe(3);
      expect(result.summary.uniqueQueries).toBe(2);
      expect(result.summary.successRate).toBe('66.67%');
    });

    it('should transform user activity data', async () => {
      const data = [
        { userId: 'user1', activityType: 'login', timestamp: new Date() },
        { userId: 'user1', activityType: 'search', timestamp: new Date() },
        { userId: 'user2', activityType: 'login', timestamp: new Date() }
      ];

      const result = await generator.transformUserActivity(data, {});

      expect(result.summary).toBeDefined();
      expect(result.summary.totalActivities).toBe(3);
      expect(result.summary.uniqueUsers).toBe(2);
    });

    it('should transform system performance data', async () => {
      const data = [
        { cpuUsage: 45, memoryUsage: 60, responseTime: 100, hasError: false },
        { cpuUsage: 55, memoryUsage: 70, responseTime: 150, hasError: true }
      ];

      const result = await generator.transformSystemPerformance(data, {});

      expect(result.summary).toBeDefined();
      expect(result.summary.averageCPU).toBe('50.00');
      expect(result.summary.averageMemory).toBe('65.00');
      expect(result.summary.errorRate).toBe('50.00%');
    });
  });

  describe('utility methods', () => {
    it('should format report title correctly', () => {
      expect(generator.formatReportTitle('document-analytics'))
        .toBe('Document Analytics Report');
      expect(generator.formatReportTitle('entity-extraction'))
        .toBe('Entity Extraction Report');
    });

    it('should format labels correctly', () => {
      expect(generator.formatLabel('firstName')).toBe('First Name');
      expect(generator.formatLabel('qualityScore')).toBe('Quality Score');
      expect(generator.formatLabel('id')).toBe('Id');
    });

    it('should calculate average correctly', () => {
      const data = [
        { score: 10 },
        { score: 20 },
        { score: 30 }
      ];
      expect(generator.calculateAverage(data, 'score')).toBe('20.00');
      expect(generator.calculateAverage([], 'score')).toBe('0.00');
    });

    it('should group data correctly', () => {
      const data = [
        { type: 'A', value: 1 },
        { type: 'B', value: 2 },
        { type: 'A', value: 3 }
      ];
      const grouped = generator.groupBy(data, 'type');
      
      expect(grouped.A).toHaveLength(2);
      expect(grouped.B).toHaveLength(1);
    });

    it('should find most common item', () => {
      const groups = {
        'A': [1, 2, 3],
        'B': [1, 2],
        'C': [1]
      };
      expect(generator.getMostCommon(groups)).toBe('A');
    });

    it('should calculate average time correctly', () => {
      const now = new Date();
      const later = new Date(now.getTime() + 5 * 60 * 1000); // 5 minutes later
      
      const data = [
        { startedAt: now, completedAt: later }
      ];
      
      expect(generator.calculateAverageTime(data, 'startedAt', 'completedAt'))
        .toBe('5 minutes');
    });

    it('should find peak hour', () => {
      const data = [
        { timestamp: new Date('2024-01-01T10:00:00') },
        { timestamp: new Date('2024-01-01T10:30:00') },
        { timestamp: new Date('2024-01-01T14:00:00') }
      ];
      
      expect(generator.findPeakHour(data)).toBe('10:00');
    });

    it('should calculate uptime percentage', () => {
      const data = [
        { status: 'up' },
        { status: 'up' },
        { status: 'down' },
        { status: 'up' }
      ];
      
      expect(generator.calculateUptime(data)).toBe('75.00%');
    });
  });

  describe('PDF generation', () => {
    it('should add proper header to PDF', () => {
      const mockDoc = {
        fontSize: jest.fn().mockReturnThis(),
        text: jest.fn().mockReturnThis(),
        moveDown: jest.fn().mockReturnThis()
      };

      generator.addPDFHeader(mockDoc, 'document-analytics', {
        generatedAt: new Date()
      });

      expect(mockDoc.fontSize).toHaveBeenCalledWith(20);
      expect(mockDoc.text).toHaveBeenCalledWith(
        'Document Analytics Report',
        { align: 'center' }
      );
    });

    it('should add table to PDF', () => {
      const mockDoc = {
        page: { width: 600 },
        x: 50,
        y: 100,
        font: jest.fn().mockReturnThis(),
        text: jest.fn().mockReturnThis(),
        moveDown: jest.fn().mockReturnThis()
      };

      const data = [
        { name: 'Test', value: 123 }
      ];

      generator.addPDFTable(mockDoc, data);

      expect(mockDoc.font).toHaveBeenCalledWith('Helvetica-Bold');
      expect(mockDoc.font).toHaveBeenCalledWith('Helvetica');
      expect(mockDoc.text).toHaveBeenCalled();
    });
  });

  describe('CSV generation', () => {
    it('should generate CSV from array data', async () => {
      const data = {
        details: [
          { id: 1, name: 'Test 1', value: 100 },
          { id: 2, name: 'Test 2', value: 200 }
        ]
      };

      const result = await generator.generateCSV('test', data);

      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(result.contentType).toBe('text/csv');
      
      const csv = result.buffer.toString();
      expect(csv).toContain('id');
      expect(csv).toContain('name');
      expect(csv).toContain('value');
    });

    it('should throw error for non-array data', async () => {
      const data = { details: { notAnArray: true } };

      await expect(generator.generateCSV('test', data))
        .rejects.toThrow('CSV format requires array data');
    });
  });

  describe('Handlebars helpers', () => {
    it('should format dates correctly', () => {
      const template = generator.templates.get('test') || 
        require('handlebars').compile('{{formatDate date "YYYY-MM-DD"}}');
      
      const result = template({ date: new Date('2024-01-15T10:30:00') });
      expect(result).toContain('2024-01-15');
    });

    it('should format numbers correctly', () => {
      const template = require('handlebars').compile('{{formatNumber value 2}}');
      
      const result = template({ value: 123.456 });
      expect(result).toBe('123.46');
    });

    it('should format percentages correctly', () => {
      const template = require('handlebars').compile('{{formatPercentage value total}}');
      
      const result = template({ value: 25, total: 100 });
      expect(result).toBe('25.0%');
    });
  });
});