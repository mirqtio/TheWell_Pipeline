const ReportService = require('../../../src/services/ReportService');
const ReportGenerator = require('../../../src/reporting/ReportGenerator');
const DatabaseManager = require('../../../src/database/DatabaseManager');
const path = require('path');
const fs = require('fs').promises;

describe('Report Generation Integration Tests', () => {
  let reportService;
  let databaseManager;
  let testReportIds = [];

  beforeAll(async () => {
    // Initialize database
    databaseManager = new DatabaseManager();
    await databaseManager.initialize();

    // Initialize report service
    reportService = new ReportService(databaseManager);
    await reportService.initialize();

    // Create test data
    await createTestData();
  });

  afterAll(async () => {
    // Cleanup test reports
    for (const reportId of testReportIds) {
      try {
        await databaseManager.query(
          'DELETE FROM report_history WHERE report_id = $1',
          [reportId]
        );
      } catch (error) {
        // Ignore cleanup errors
      }
    }

    // Close database connection
    await databaseManager.close();
  });

  async function createTestData() {
    // Insert test documents
    await databaseManager.query(`
      INSERT INTO documents (id, title, content, status, quality_score, created_at)
      VALUES 
        ('test-doc-1', 'Test Document 1', 'Content 1', 'published', 85, NOW() - INTERVAL '7 days'),
        ('test-doc-2', 'Test Document 2', 'Content 2', 'draft', 92, NOW() - INTERVAL '3 days'),
        ('test-doc-3', 'Test Document 3', 'Content 3', 'published', 78, NOW() - INTERVAL '1 day')
      ON CONFLICT (id) DO NOTHING
    `);

    // Insert test feedback
    await databaseManager.query(`
      INSERT INTO document_feedback (document_id, user_id, rating, comment, created_at)
      VALUES 
        ('test-doc-1', 'user1', 4, 'Good document', NOW() - INTERVAL '5 days'),
        ('test-doc-1', 'user2', 5, 'Excellent', NOW() - INTERVAL '3 days'),
        ('test-doc-2', 'user1', 3, 'Needs improvement', NOW() - INTERVAL '2 days')
      ON CONFLICT DO NOTHING
    `);

    // Insert test entities
    await databaseManager.query(`
      INSERT INTO extracted_entities (document_id, text, type, confidence, context, extracted_at)
      VALUES 
        ('test-doc-1', 'John Doe', 'person', 0.95, 'Author John Doe wrote...', NOW() - INTERVAL '5 days'),
        ('test-doc-1', 'New York', 'location', 0.88, '...based in New York...', NOW() - INTERVAL '5 days'),
        ('test-doc-2', 'Acme Corp', 'organization', 0.92, 'Acme Corp announced...', NOW() - INTERVAL '2 days')
      ON CONFLICT DO NOTHING
    `);
  }

  describe('Report Definition Management', () => {
    it('should create and retrieve report definition', async () => {
      const definition = await reportService.createReportDefinition({
        name: 'Integration Test Report',
        description: 'Test report for integration testing',
        reportType: 'document-analytics',
        configuration: {
          includeCharts: true,
          dateRange: 'last_30_days'
        },
        filters: {
          status: 'published'
        },
        createdBy: 'test-user'
      });

      expect(definition).toBeDefined();
      expect(definition.report_id).toMatch(/^def_/);
      expect(definition.name).toBe('Integration Test Report');

      // Retrieve definition
      const query = 'SELECT * FROM report_definitions WHERE report_id = $1';
      const result = await databaseManager.query(query, [definition.report_id]);
      
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].report_type).toBe('document-analytics');
    });
  });

  describe('Report Generation', () => {
    it('should generate document analytics report in PDF format', async () => {
      const report = await reportService.generateReport({
        reportType: 'document-analytics',
        name: 'Test Document Analytics Report',
        format: 'pdf',
        parameters: {
          startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          endDate: new Date()
        },
        requestedBy: 'test-user'
      });

      testReportIds.push(report.reportId);

      expect(report).toBeDefined();
      expect(report.reportId).toMatch(/^rpt_/);
      expect(report.format).toBe('pdf');
      expect(report.filePath).toBeDefined();
      expect(report.size).toBeGreaterThan(0);
      expect(report.generationTime).toBeGreaterThan(0);

      // Verify file exists
      await expect(fs.access(report.filePath)).resolves.not.toThrow();

      // Verify report history
      const history = await reportService.getReport(report.reportId);
      expect(history.status).toBe('completed');
      expect(history.file_path).toBe(report.filePath);
    });

    it('should generate entity extraction report in CSV format', async () => {
      const report = await reportService.generateReport({
        reportType: 'entity-extraction',
        name: 'Test Entity Report',
        format: 'csv',
        parameters: {
          minConfidence: 0.8
        },
        requestedBy: 'test-user'
      });

      testReportIds.push(report.reportId);

      expect(report.format).toBe('csv');
      expect(report.filePath).toMatch(/\.csv$/);

      // Read and verify CSV content
      const content = await fs.readFile(report.filePath, 'utf8');
      expect(content).toContain('text');
      expect(content).toContain('type');
      expect(content).toContain('confidence');
      expect(content).toContain('John Doe');
      expect(content).toContain('person');
    });

    it('should generate report in Excel format', async () => {
      const report = await reportService.generateReport({
        reportType: 'document-analytics',
        name: 'Test Excel Report',
        format: 'excel',
        parameters: {},
        requestedBy: 'test-user'
      });

      testReportIds.push(report.reportId);

      expect(report.format).toBe('excel');
      expect(report.filePath).toMatch(/\.xlsx$/);
      expect(report.size).toBeGreaterThan(0);
    });

    it('should generate report in JSON format', async () => {
      const report = await reportService.generateReport({
        reportType: 'document-analytics',
        name: 'Test JSON Report',
        format: 'json',
        parameters: {},
        options: { pretty: true },
        requestedBy: 'test-user'
      });

      testReportIds.push(report.reportId);

      expect(report.format).toBe('json');
      expect(report.filePath).toMatch(/\.json$/);

      // Read and parse JSON
      const content = await fs.readFile(report.filePath, 'utf8');
      const data = JSON.parse(content);
      
      expect(data.reportType).toBe('document-analytics');
      expect(data.metadata).toBeDefined();
      expect(data.summary).toBeDefined();
      expect(data.details).toBeDefined();
    });

    it('should generate report in HTML format', async () => {
      const report = await reportService.generateReport({
        reportType: 'document-analytics',
        name: 'Test HTML Report',
        format: 'html',
        parameters: {},
        requestedBy: 'test-user'
      });

      testReportIds.push(report.reportId);

      expect(report.format).toBe('html');
      expect(report.filePath).toMatch(/\.html$/);

      // Read and verify HTML content
      const content = await fs.readFile(report.filePath, 'utf8');
      expect(content).toContain('<!DOCTYPE html>');
      expect(content).toContain('Document Analytics Report');
      expect(content).toContain('<table');
    });

    it('should handle report generation errors', async () => {
      await expect(reportService.generateReport({
        reportType: 'invalid-type',
        format: 'pdf',
        parameters: {},
        requestedBy: 'test-user'
      })).rejects.toThrow('Unknown report type: invalid-type');
    });
  });

  describe('Report Scheduling', () => {
    let testDefinitionId;

    beforeAll(async () => {
      // Create a test report definition
      const definition = await reportService.createReportDefinition({
        name: 'Scheduled Test Report',
        reportType: 'document-analytics',
        createdBy: 'test-user'
      });
      testDefinitionId = definition.id;
    });

    it('should schedule a daily report', async () => {
      const scheduledReport = await reportService.scheduleReport({
        reportDefinitionId: testDefinitionId,
        scheduleType: 'daily',
        scheduleConfig: { hour: 9, minute: 0 },
        outputFormat: 'pdf',
        recipients: ['test@example.com'],
        deliveryMethod: 'email',
        createdBy: 'test-user'
      });

      expect(scheduledReport).toBeDefined();
      expect(scheduledReport.schedule_id).toMatch(/^sch_/);
      expect(scheduledReport.schedule_type).toBe('daily');
      expect(scheduledReport.next_run_at).toBeDefined();

      // Verify scheduled job was created
      expect(reportService.scheduledJobs.has(scheduledReport.schedule_id)).toBe(true);

      // Cancel the job
      const job = reportService.scheduledJobs.get(scheduledReport.schedule_id);
      if (job) job.cancel();
    });

    it('should schedule a weekly report', async () => {
      const scheduledReport = await reportService.scheduleReport({
        reportDefinitionId: testDefinitionId,
        scheduleType: 'weekly',
        scheduleConfig: { dayOfWeek: 1, hour: 10, minute: 30 },
        outputFormat: 'csv',
        createdBy: 'test-user'
      });

      expect(scheduledReport.schedule_type).toBe('weekly');
      const nextRun = new Date(scheduledReport.next_run_at);
      expect(nextRun.getDay()).toBe(1); // Monday

      // Cancel the job
      const job = reportService.scheduledJobs.get(scheduledReport.schedule_id);
      if (job) job.cancel();
    });

    it('should schedule a one-time report', async () => {
      const runAt = new Date(Date.now() + 60000); // 1 minute from now
      
      const scheduledReport = await reportService.scheduleReport({
        reportDefinitionId: testDefinitionId,
        scheduleType: 'once',
        scheduleConfig: { runAt },
        outputFormat: 'json',
        createdBy: 'test-user'
      });

      expect(scheduledReport.schedule_type).toBe('once');
      expect(new Date(scheduledReport.next_run_at).getTime())
        .toBeCloseTo(runAt.getTime(), -3);
    });
  });

  describe('Report Retrieval and Download', () => {
    let testReportId;

    beforeAll(async () => {
      // Generate a test report
      const report = await reportService.generateReport({
        reportType: 'document-analytics',
        name: 'Download Test Report',
        format: 'pdf',
        parameters: {},
        requestedBy: 'test-user'
      });
      testReportId = report.reportId;
      testReportIds.push(testReportId);
    });

    it('should retrieve report metadata', async () => {
      const report = await reportService.getReport(testReportId);

      expect(report).toBeDefined();
      expect(report.report_id).toBe(testReportId);
      expect(report.status).toBe('completed');
      expect(report.file_path).toBeDefined();
      expect(report.generation_time_ms).toBeGreaterThan(0);
    });

    it('should download report file', async () => {
      const file = await reportService.getReportFile(testReportId);

      expect(file).toBeDefined();
      expect(file.buffer).toBeInstanceOf(Buffer);
      expect(file.filename).toMatch(/\.pdf$/);
      expect(file.contentType).toBe('application/pdf');

      // Verify download count was incremented
      const report = await reportService.getReport(testReportId);
      expect(report.download_count).toBe(1);
    });

    it('should list reports with filters', async () => {
      const reports = await reportService.listReports({
        status: 'completed',
        reportType: 'document-analytics',
        limit: 10
      });

      expect(reports).toBeDefined();
      expect(Array.isArray(reports)).toBe(true);
      expect(reports.length).toBeGreaterThan(0);
      
      const testReport = reports.find(r => r.report_id === testReportId);
      expect(testReport).toBeDefined();
    });
  });

  describe('Report Cleanup', () => {
    it('should cleanup old reports', async () => {
      // Create an old report
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 40);

      await databaseManager.query(`
        INSERT INTO report_history 
        (report_id, report_type, name, format, status, requested_by, requested_at, file_path)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [
        'rpt_old_test',
        'document-analytics',
        'Old Test Report',
        'pdf',
        'completed',
        'test-user',
        oldDate,
        '/fake/path/old.pdf'
      ]);

      const deletedCount = await reportService.cleanupOldReports(30);
      
      expect(deletedCount).toBeGreaterThanOrEqual(1);

      // Verify old report was deleted
      const result = await databaseManager.query(
        'SELECT * FROM report_history WHERE report_id = $1',
        ['rpt_old_test']
      );
      expect(result.rows).toHaveLength(0);
    });
  });

  describe('Report Templates', () => {
    it('should load and use custom template', async () => {
      const customTemplate = `
        <h1>{{metadata.reportType}} - Custom Template</h1>
        <p>Generated: {{formatDate metadata.generatedAt}}</p>
        <ul>
        {{#each details}}
          <li>{{title}} - Score: {{qualityScore}}</li>
        {{/each}}
        </ul>
      `;

      await reportService.generator.loadTemplate('custom-test', customTemplate);

      const report = await reportService.generateReport({
        reportType: 'document-analytics',
        name: 'Custom Template Test',
        format: 'html',
        parameters: {},
        requestedBy: 'test-user'
      });

      testReportIds.push(report.reportId);

      const content = await fs.readFile(report.filePath, 'utf8');
      expect(content).toContain('Document Analytics Report');
      expect(content).toContain('Generated:');
    });
  });

  describe('Data Aggregation', () => {
    it('should aggregate document analytics data correctly', async () => {
      const data = await reportService.getDocumentAnalyticsData({
        startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        endDate: new Date()
      });

      expect(data).toBeDefined();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);

      // Verify aggregated fields
      const doc = data[0];
      expect(doc).toHaveProperty('feedbackCount');
      expect(doc).toHaveProperty('averageRating');
    });

    it('should filter data based on parameters', async () => {
      const data = await reportService.getDocumentAnalyticsData({
        status: 'published',
        minQualityScore: 80
      });

      expect(data).toBeDefined();
      data.forEach(doc => {
        expect(doc.status).toBe('published');
        expect(doc.qualityScore).toBeGreaterThanOrEqual(80);
      });
    });
  });
});