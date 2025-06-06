const request = require('supertest');
const express = require('express');
const { router, initializeRoute } = require('../../../../src/web/routes/reports');
const DatabaseManager = require('../../../../src/database/DatabaseManager');
const { ORMManager } = require('../../../../src/orm');
const jwt = require('jsonwebtoken');

describe('Reports API Routes', () => {
  let app;
  let databaseManager;
  let ormManager;
  let authToken;
  let testReportIds = [];
  let testDefinitionId;

  beforeAll(async () => {
    // Initialize database and ORM
    databaseManager = new DatabaseManager();
    await databaseManager.initialize();
    
    ormManager = new ORMManager();
    await ormManager.initialize(databaseManager);

    // Initialize Express app
    app = express();
    app.use(express.json());
    
    // Mock authentication middleware
    app.use((req, res, next) => {
      if (req.headers.authorization) {
        req.user = { id: 'test-user', role: 'admin' };
      }
      next();
    });

    // Initialize routes
    const reportRoutes = initializeRoute(databaseManager, ormManager);
    app.use('/api/reports', reportRoutes);

    // Create auth token
    authToken = jwt.sign(
      { id: 'test-user', role: 'admin' },
      process.env.JWT_SECRET || 'test-secret'
    );

    // Create test data
    await createTestData();
  });

  afterAll(async () => {
    // Cleanup test data
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

    if (testDefinitionId) {
      await databaseManager.query(
        'DELETE FROM report_definitions WHERE id = $1',
        [testDefinitionId]
      );
    }

    await ormManager.close();
    await databaseManager.close();
  });

  async function createTestData() {
    // Insert test documents
    await databaseManager.query(`
      INSERT INTO documents (id, title, content, status, quality_score)
      VALUES 
        ('api-test-doc-1', 'API Test Doc 1', 'Content', 'published', 85),
        ('api-test-doc-2', 'API Test Doc 2', 'Content', 'draft', 90)
      ON CONFLICT (id) DO NOTHING
    `);
  }

  describe('POST /api/reports/definitions', () => {
    it('should create a report definition', async () => {
      const response = await request(app)
        .post('/api/reports/definitions')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'API Test Report Definition',
          description: 'Test description',
          reportType: 'document-analytics',
          configuration: {
            includeCharts: true
          },
          filters: {
            status: 'published'
          }
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.definition).toBeDefined();
      expect(response.body.definition.report_id).toMatch(/^def_/);
      expect(response.body.definition.name).toBe('API Test Report Definition');

      // Store for cleanup
      if (response.body.definition.id) {
        testDefinitionId = response.body.definition.id;
      }
    });

    it('should reject invalid report definition', async () => {
      const response = await request(app)
        .post('/api/reports/definitions')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          description: 'Missing required fields'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Name and report type are required');
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .post('/api/reports/definitions')
        .send({
          name: 'Test',
          reportType: 'document-analytics'
        });

      expect(response.status).toBe(401);
    });
  });

  describe('GET /api/reports/definitions', () => {
    it('should list report definitions', async () => {
      const response = await request(app)
        .get('/api/reports/definitions')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.definitions).toBeDefined();
      expect(Array.isArray(response.body.definitions)).toBe(true);
      expect(response.body.total).toBeDefined();
    });

    it('should filter by report type', async () => {
      const response = await request(app)
        .get('/api/reports/definitions')
        .query({ reportType: 'document-analytics' })
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      response.body.definitions.forEach(def => {
        expect(def.report_type).toBe('document-analytics');
      });
    });

    it('should filter by active status', async () => {
      const response = await request(app)
        .get('/api/reports/definitions')
        .query({ isActive: true })
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      response.body.definitions.forEach(def => {
        expect(def.is_active).toBe(true);
      });
    });
  });

  describe('POST /api/reports/generate', () => {
    it('should generate a PDF report', async () => {
      const response = await request(app)
        .post('/api/reports/generate')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          reportType: 'document-analytics',
          name: 'API Test Report',
          format: 'pdf',
          parameters: {
            startDate: '2024-01-01',
            endDate: '2024-12-31'
          }
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.report).toBeDefined();
      expect(response.body.report.reportId).toMatch(/^rpt_/);
      expect(response.body.report.format).toBe('pdf');
      expect(response.body.report.size).toBeGreaterThan(0);

      testReportIds.push(response.body.report.reportId);
    });

    it('should generate a CSV report', async () => {
      const response = await request(app)
        .post('/api/reports/generate')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          reportType: 'document-analytics',
          format: 'csv',
          parameters: {}
        });

      expect(response.status).toBe(200);
      expect(response.body.report.format).toBe('csv');
      
      testReportIds.push(response.body.report.reportId);
    });

    it('should reject invalid format', async () => {
      const response = await request(app)
        .post('/api/reports/generate')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          reportType: 'document-analytics',
          format: 'invalid'
        });

      expect(response.status).toBe(500);
    });

    it('should require report type and format', async () => {
      const response = await request(app)
        .post('/api/reports/generate')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'Test Report'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Report type and format are required');
    });
  });

  describe('POST /api/reports/schedule', () => {
    beforeAll(async () => {
      // Ensure we have a report definition
      if (!testDefinitionId) {
        const result = await databaseManager.query(`
          INSERT INTO report_definitions (report_id, name, report_type, created_by)
          VALUES ('def_test_schedule', 'Schedule Test', 'document-analytics', 'test-user')
          RETURNING id
        `);
        testDefinitionId = result.rows[0].id;
      }
    });

    it('should schedule a daily report', async () => {
      const response = await request(app)
        .post('/api/reports/schedule')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          reportDefinitionId: testDefinitionId,
          scheduleType: 'daily',
          scheduleConfig: { hour: 9, minute: 0 },
          outputFormat: 'pdf',
          recipients: ['test@example.com']
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.scheduledReport).toBeDefined();
      expect(response.body.scheduledReport.schedule_id).toMatch(/^sch_/);
      expect(response.body.scheduledReport.schedule_type).toBe('daily');
    });

    it('should reject invalid schedule request', async () => {
      const response = await request(app)
        .post('/api/reports/schedule')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          scheduleType: 'daily'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('required');
    });
  });

  describe('GET /api/reports/scheduled', () => {
    it('should list scheduled reports', async () => {
      const response = await request(app)
        .get('/api/reports/scheduled')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.scheduledReports).toBeDefined();
      expect(Array.isArray(response.body.scheduledReports)).toBe(true);
    });

    it('should filter by active status', async () => {
      const response = await request(app)
        .get('/api/reports/scheduled')
        .query({ isActive: true })
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      response.body.scheduledReports.forEach(report => {
        expect(report.is_active).toBe(true);
      });
    });
  });

  describe('GET /api/reports/history', () => {
    it('should get report history', async () => {
      const response = await request(app)
        .get('/api/reports/history')
        .set('Authorization', `Bearer ${authToken}`)
        .query({
          limit: 10,
          offset: 0
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.reports).toBeDefined();
      expect(Array.isArray(response.body.reports)).toBe(true);
    });

    it('should filter by status', async () => {
      const response = await request(app)
        .get('/api/reports/history')
        .set('Authorization', `Bearer ${authToken}`)
        .query({
          status: 'completed'
        });

      expect(response.status).toBe(200);
      response.body.reports.forEach(report => {
        expect(report.status).toBe('completed');
      });
    });

    it('should filter by report type', async () => {
      const response = await request(app)
        .get('/api/reports/history')
        .set('Authorization', `Bearer ${authToken}`)
        .query({
          reportType: 'document-analytics'
        });

      expect(response.status).toBe(200);
      response.body.reports.forEach(report => {
        expect(report.report_type).toBe('document-analytics');
      });
    });
  });

  describe('GET /api/reports/:reportId', () => {
    let testReportId;

    beforeAll(async () => {
      // Generate a test report
      const response = await request(app)
        .post('/api/reports/generate')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          reportType: 'document-analytics',
          format: 'json',
          parameters: {}
        });
      
      testReportId = response.body.report.reportId;
      testReportIds.push(testReportId);
    });

    it('should get report details', async () => {
      const response = await request(app)
        .get(`/api/reports/${testReportId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.report).toBeDefined();
      expect(response.body.report.report_id).toBe(testReportId);
    });

    it('should return 404 for non-existent report', async () => {
      const response = await request(app)
        .get('/api/reports/rpt_nonexistent')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Report not found');
    });
  });

  describe('GET /api/reports/:reportId/download', () => {
    let downloadReportId;

    beforeAll(async () => {
      // Generate a test report for download
      const response = await request(app)
        .post('/api/reports/generate')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          reportType: 'document-analytics',
          format: 'pdf',
          parameters: {}
        });
      
      downloadReportId = response.body.report.reportId;
      testReportIds.push(downloadReportId);
    });

    it('should download report file', async () => {
      const response = await request(app)
        .get(`/api/reports/${downloadReportId}/download`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toBe('application/pdf');
      expect(response.headers['content-disposition']).toMatch(/attachment/);
      expect(response.body).toBeInstanceOf(Buffer);
    });

    it('should return 404 for non-existent report', async () => {
      const response = await request(app)
        .get('/api/reports/rpt_nonexistent/download')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(404);
    });
  });

  describe('DELETE /api/reports/:reportId', () => {
    let deleteReportId;

    beforeAll(async () => {
      // Generate a test report to delete
      const response = await request(app)
        .post('/api/reports/generate')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          reportType: 'document-analytics',
          format: 'json',
          parameters: {}
        });
      
      deleteReportId = response.body.report.reportId;
    });

    it('should delete a report', async () => {
      const response = await request(app)
        .delete(`/api/reports/${deleteReportId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Report deleted successfully');

      // Verify report is deleted
      const getResponse = await request(app)
        .get(`/api/reports/${deleteReportId}`)
        .set('Authorization', `Bearer ${authToken}`);
      
      expect(getResponse.status).toBe(404);
    });

    it('should return 404 when deleting non-existent report', async () => {
      const response = await request(app)
        .delete('/api/reports/rpt_nonexistent')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(404);
    });
  });

  describe('GET /api/reports/templates', () => {
    it('should list available templates', async () => {
      const response = await request(app)
        .get('/api/reports/templates')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.templates).toBeDefined();
      expect(Array.isArray(response.body.templates)).toBe(true);
    });

    it('should filter templates by report type', async () => {
      const response = await request(app)
        .get('/api/reports/templates')
        .query({ reportType: 'document-analytics' })
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      response.body.templates.forEach(template => {
        expect(template.report_type).toBe('document-analytics');
      });
    });
  });

  describe('GET /api/reports/types', () => {
    it('should get available report types', async () => {
      const response = await request(app)
        .get('/api/reports/types')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.reportTypes).toBeDefined();
      expect(Array.isArray(response.body.reportTypes)).toBe(true);
      expect(response.body.reportTypes.length).toBe(6);

      const documentAnalytics = response.body.reportTypes.find(
        type => type.id === 'document-analytics'
      );
      expect(documentAnalytics).toBeDefined();
      expect(documentAnalytics.name).toBe('Document Analytics Report');
      expect(documentAnalytics.parameters).toContain('startDate');
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors gracefully', async () => {
      // Mock database error
      const originalQuery = databaseManager.query;
      databaseManager.query = jest.fn().mockRejectedValue(new Error('Database connection lost'));

      const response = await request(app)
        .get('/api/reports/history')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(500);

      // Restore original function
      databaseManager.query = originalQuery;
    });
  });
});