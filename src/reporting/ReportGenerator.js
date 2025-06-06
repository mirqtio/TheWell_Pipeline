/**
 * ReportGenerator - Core report generation engine
 * Supports multiple output formats and custom templates
 */

const PDFDocument = require('pdfkit');
const fs = require('fs').promises;
const path = require('path');
const Handlebars = require('handlebars');
const { Parser } = require('json2csv');
const ExcelJS = require('exceljs');
const Chart = require('chart.js');
let createCanvas;
try {
  ({ createCanvas } = require('canvas'));
} catch (error) {
  // Canvas is optional - charts will not be generated in reports
  createCanvas = null;
}
const logger = require('../utils/logger');

class ReportGenerator {
  constructor() {
    this.templates = new Map();
    this.formatters = {
      pdf: this.generatePDF.bind(this),
      csv: this.generateCSV.bind(this),
      excel: this.generateExcel.bind(this),
      json: this.generateJSON.bind(this),
      html: this.generateHTML.bind(this)
    };
    this.charts = new Map();
    this.initializeHandlebarsHelpers();
  }

  /**
   * Initialize Handlebars helpers for report templates
   */
  initializeHandlebarsHelpers() {
    // Date formatting helper
    Handlebars.registerHelper('formatDate', (date, format = 'YYYY-MM-DD') => {
      if (!date) return '';
      const d = new Date(date);
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const hours = String(d.getHours()).padStart(2, '0');
      const minutes = String(d.getMinutes()).padStart(2, '0');
      
      switch (format) {
      case 'YYYY-MM-DD':
        return `${year}-${month}-${day}`;
      case 'YYYY-MM-DD HH:mm':
        return `${year}-${month}-${day} ${hours}:${minutes}`;
      case 'MM/DD/YYYY':
        return `${month}/${day}/${year}`;
      default:
        return date.toString();
      }
    });

    // Number formatting helper
    Handlebars.registerHelper('formatNumber', (number, decimals = 2) => {
      if (typeof number !== 'number') return number;
      return number.toFixed(decimals);
    });

    // Percentage helper
    Handlebars.registerHelper('formatPercentage', (value, total) => {
      if (!total || total === 0) return '0%';
      const percentage = (value / total) * 100;
      return `${percentage.toFixed(1)}%`;
    });

    // Conditional helper
    Handlebars.registerHelper('ifEquals', function(arg1, arg2, options) {
      return (arg1 == arg2) ? options.fn(this) : options.inverse(this);
    });

    // Array iteration with index
    Handlebars.registerHelper('eachWithIndex', function(context, options) {
      let ret = '';
      for (let i = 0; i < context.length; i++) {
        ret = ret + options.fn({ ...context[i], index: i + 1 });
      }
      return ret;
    });
  }

  /**
   * Load template from file or string
   */
  async loadTemplate(templatePath, templateContent = null) {
    try {
      let content;
      if (templateContent) {
        content = templateContent;
      } else {
        const fullPath = path.isAbsolute(templatePath) 
          ? templatePath 
          : path.join(__dirname, 'templates', templatePath);
        content = await fs.readFile(fullPath, 'utf8');
      }
      
      const template = Handlebars.compile(content);
      const templateName = path.basename(templatePath, path.extname(templatePath));
      this.templates.set(templateName, template);
      
      return template;
    } catch (error) {
      logger.error('Failed to load template', { error: error.message, templatePath });
      throw error;
    }
  }

  /**
   * Generate report in specified format
   */
  async generate(reportType, data, format = 'pdf', options = {}) {
    try {
      // Validate format
      if (!this.formatters[format]) {
        throw new Error(`Unsupported format: ${format}`);
      }

      // Apply data transformations
      const transformedData = await this.transformData(reportType, data, options);

      // Add metadata
      const reportData = {
        ...transformedData,
        metadata: {
          reportType,
          generatedAt: new Date(),
          format,
          ...options.metadata
        }
      };

      // Generate report in requested format
      const result = await this.formatters[format](reportType, reportData, options);

      logger.info('Report generated', {
        reportType,
        format,
        dataCount: Array.isArray(data) ? data.length : Object.keys(data).length
      });

      return result;
    } catch (error) {
      logger.error('Failed to generate report', {
        error: error.message,
        reportType,
        format
      });
      throw error;
    }
  }

  /**
   * Transform data based on report type
   */
  async transformData(reportType, data, options = {}) {
    const transformers = {
      'document-analytics': this.transformDocumentAnalytics.bind(this),
      'entity-extraction': this.transformEntityExtraction.bind(this),
      'alert-summary': this.transformAlertSummary.bind(this),
      'search-analytics': this.transformSearchAnalytics.bind(this),
      'user-activity': this.transformUserActivity.bind(this),
      'system-performance': this.transformSystemPerformance.bind(this)
    };

    const transformer = transformers[reportType];
    if (transformer) {
      return await transformer(data, options);
    }

    return data;
  }

  /**
   * Generate PDF report
   */
  async generatePDF(reportType, data, options = {}) {
    const doc = new PDFDocument({
      size: options.pageSize || 'A4',
      margin: options.margin || 50
    });

    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));

    // Add header
    this.addPDFHeader(doc, reportType, data.metadata);

    // Add content based on report type
    await this.addPDFContent(doc, reportType, data, options);

    // Add footer
    this.addPDFFooter(doc, data.metadata);

    doc.end();

    return new Promise((resolve, reject) => {
      doc.on('end', () => {
        const buffer = Buffer.concat(chunks);
        resolve({
          buffer,
          contentType: 'application/pdf',
          extension: 'pdf'
        });
      });
      doc.on('error', reject);
    });
  }

  /**
   * Add PDF header
   */
  addPDFHeader(doc, reportType, metadata) {
    doc.fontSize(20)
      .text(this.formatReportTitle(reportType), { align: 'center' });
    
    doc.fontSize(10)
      .text(`Generated: ${new Date(metadata.generatedAt).toLocaleString()}`, { align: 'center' });
    
    doc.moveDown();
  }

  /**
   * Add PDF content
   */
  async addPDFContent(doc, reportType, data, options) {
    // Add summary section
    if (data.summary) {
      doc.fontSize(16).text('Summary', { underline: true });
      doc.fontSize(12);
      
      Object.entries(data.summary).forEach(([key, value]) => {
        doc.text(`${this.formatLabel(key)}: ${value}`);
      });
      
      doc.moveDown();
    }

    // Add charts if available
    if (data.charts && data.charts.length > 0) {
      for (const chartData of data.charts) {
        await this.addPDFChart(doc, chartData);
      }
    }

    // Add detailed data
    if (data.details) {
      doc.fontSize(16).text('Details', { underline: true });
      doc.fontSize(10);
      
      if (Array.isArray(data.details)) {
        this.addPDFTable(doc, data.details, options);
      } else {
        Object.entries(data.details).forEach(([key, value]) => {
          doc.text(`${this.formatLabel(key)}: ${JSON.stringify(value, null, 2)}`);
        });
      }
    }
  }

  /**
   * Add chart to PDF
   */
  async addPDFChart(doc, chartData) {
    const width = 400;
    const height = 300;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // Create chart
    new Chart(ctx, chartData);

    // Add to PDF
    const buffer = canvas.toBuffer('image/png');
    doc.image(buffer, {
      fit: [width, height],
      align: 'center'
    });
    doc.moveDown();
  }

  /**
   * Add table to PDF
   */
  addPDFTable(doc, data, options = {}) {
    if (!data || data.length === 0) return;

    const columns = options.columns || Object.keys(data[0]);
    const columnWidth = (doc.page.width - 100) / columns.length;

    // Header
    doc.font('Helvetica-Bold');
    let x = doc.x;
    const y = doc.y;
    
    columns.forEach(col => {
      doc.text(this.formatLabel(col), x, y, {
        width: columnWidth,
        align: 'left'
      });
      x += columnWidth;
    });

    doc.font('Helvetica');
    doc.moveDown();

    // Rows
    data.forEach(row => {
      x = doc.x;
      columns.forEach(col => {
        const value = row[col] || '';
        doc.text(String(value), x, doc.y, {
          width: columnWidth,
          align: 'left'
        });
        x += columnWidth;
      });
      doc.moveDown(0.5);
    });
  }

  /**
   * Add PDF footer
   */
  addPDFFooter(doc, _metadata) {
    const pageCount = doc.bufferedPageRange().count;
    
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      
      // Add page number
      doc.fontSize(8)
        .text(
          `Page ${i + 1} of ${pageCount}`,
          50,
          doc.page.height - 50,
          { align: 'center' }
        );
    }
  }

  /**
   * Generate CSV report
   */
  async generateCSV(reportType, data, options = {}) {
    try {
      const csvData = data.details || data;
      
      if (!Array.isArray(csvData)) {
        throw new Error('CSV format requires array data');
      }

      const fields = options.fields || (csvData.length > 0 ? Object.keys(csvData[0]) : []);
      const parser = new Parser({ fields });
      const csv = parser.parse(csvData);

      return {
        buffer: Buffer.from(csv),
        contentType: 'text/csv',
        extension: 'csv'
      };
    } catch (error) {
      logger.error('Failed to generate CSV', { error: error.message });
      throw error;
    }
  }

  /**
   * Generate Excel report
   */
  async generateExcel(reportType, data, options = {}) {
    const workbook = new ExcelJS.Workbook();
    
    // Add metadata
    workbook.creator = 'TheWell Pipeline';
    workbook.created = new Date();
    workbook.modified = new Date();

    // Add summary sheet
    if (data.summary) {
      const summarySheet = workbook.addWorksheet('Summary');
      this.addExcelSummary(summarySheet, data.summary);
    }

    // Add details sheet
    if (data.details) {
      const detailsSheet = workbook.addWorksheet('Details');
      this.addExcelDetails(detailsSheet, data.details, options);
    }

    // Add charts sheet if applicable
    if (data.charts && data.charts.length > 0) {
      const chartsSheet = workbook.addWorksheet('Charts');
      await this.addExcelCharts(chartsSheet, data.charts);
    }

    // Generate buffer
    const buffer = await workbook.xlsx.writeBuffer();

    return {
      buffer,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      extension: 'xlsx'
    };
  }

  /**
   * Add summary to Excel sheet
   */
  addExcelSummary(sheet, summary) {
    sheet.addRow(['Summary']);
    sheet.addRow([]);
    
    Object.entries(summary).forEach(([key, value]) => {
      sheet.addRow([this.formatLabel(key), value]);
    });

    // Format
    sheet.getRow(1).font = { bold: true, size: 16 };
    sheet.columns = [
      { width: 30 },
      { width: 50 }
    ];
  }

  /**
   * Add details to Excel sheet
   */
  addExcelDetails(sheet, details, options = {}) {
    if (!Array.isArray(details) || details.length === 0) return;

    const columns = options.columns || Object.keys(details[0]);
    
    // Add headers
    sheet.addRow(columns.map(col => this.formatLabel(col)));
    
    // Add data
    details.forEach(row => {
      sheet.addRow(columns.map(col => row[col] || ''));
    });

    // Format headers
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };

    // Auto-fit columns
    sheet.columns.forEach((column, index) => {
      column.width = Math.max(15, columns[index].length * 1.5);
    });
  }

  /**
   * Add charts to Excel sheet
   */
  async addExcelCharts(sheet, charts) {
    // Note: ExcelJS doesn't support direct chart creation
    // We'll add chart data that can be used to create charts in Excel
    sheet.addRow(['Chart Data']);
    sheet.addRow([]);

    charts.forEach((chart, index) => {
      sheet.addRow([`Chart ${index + 1}: ${chart.title || 'Untitled'}`]);
      
      if (chart.data && chart.data.labels && chart.data.datasets) {
        // Add labels
        const row = [''];
        row.push(...chart.data.labels);
        sheet.addRow(row);
        
        // Add datasets
        chart.data.datasets.forEach(dataset => {
          const dataRow = [dataset.label];
          dataRow.push(...dataset.data);
          sheet.addRow(dataRow);
        });
      }
      
      sheet.addRow([]);
    });
  }

  /**
   * Generate JSON report
   */
  async generateJSON(reportType, data, options = {}) {
    const jsonData = {
      reportType,
      metadata: data.metadata,
      summary: data.summary,
      details: data.details,
      charts: data.charts
    };

    const formatted = options.pretty 
      ? JSON.stringify(jsonData, null, 2)
      : JSON.stringify(jsonData);

    return {
      buffer: Buffer.from(formatted),
      contentType: 'application/json',
      extension: 'json'
    };
  }

  /**
   * Generate HTML report
   */
  async generateHTML(reportType, data, options = {}) {
    // Get or load template
    let template = this.templates.get(reportType);
    
    if (!template) {
      // Load default template
      const templatePath = `${reportType}.hbs`;
      try {
        template = await this.loadTemplate(templatePath);
      } catch (error) {
        // Use generic template
        template = await this.loadGenericHTMLTemplate();
      }
    }

    // Generate HTML
    const html = template(data);

    return {
      buffer: Buffer.from(html),
      contentType: 'text/html',
      extension: 'html'
    };
  }

  /**
   * Load generic HTML template
   */
  async loadGenericHTMLTemplate() {
    const template = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>{{metadata.reportType}} Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        h1 { color: #333; }
        .summary { background: #f5f5f5; padding: 15px; margin: 20px 0; }
        table { border-collapse: collapse; width: 100%; margin: 20px 0; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background: #f2f2f2; font-weight: bold; }
        .chart { margin: 20px 0; }
    </style>
</head>
<body>
    <h1>{{metadata.reportType}} Report</h1>
    <p>Generated: {{formatDate metadata.generatedAt "YYYY-MM-DD HH:mm"}}</p>
    
    {{#if summary}}
    <div class="summary">
        <h2>Summary</h2>
        {{#each summary}}
        <p><strong>{{@key}}:</strong> {{this}}</p>
        {{/each}}
    </div>
    {{/if}}
    
    {{#if details}}
    <h2>Details</h2>
    <table>
        <thead>
            <tr>
                {{#each details.[0]}}
                <th>{{@key}}</th>
                {{/each}}
            </tr>
        </thead>
        <tbody>
            {{#each details}}
            <tr>
                {{#each this}}
                <td>{{this}}</td>
                {{/each}}
            </tr>
            {{/each}}
        </tbody>
    </table>
    {{/if}}
</body>
</html>`;

    return Handlebars.compile(template);
  }

  /**
   * Data transformation methods
   */
  async transformDocumentAnalytics(data, options) {
    const summary = {
      totalDocuments: data.length,
      averageQualityScore: this.calculateAverage(data, 'qualityScore'),
      totalFeedback: data.reduce((sum, doc) => sum + (doc.feedbackCount || 0), 0),
      documentsByStatus: this.groupBy(data, 'status')
    };

    const charts = [
      {
        type: 'bar',
        title: 'Documents by Status',
        data: {
          labels: Object.keys(summary.documentsByStatus),
          datasets: [{
            label: 'Document Count',
            data: Object.values(summary.documentsByStatus).map(group => group.length)
          }]
        }
      },
      {
        type: 'line',
        title: 'Quality Score Trend',
        data: this.generateTrendData(data, 'qualityScore', 'createdAt')
      }
    ];

    return { summary, details: data, charts };
  }

  async transformEntityExtraction(data, options) {
    const entities = data.flatMap(doc => doc.entities || []);
    const entityTypes = this.groupBy(entities, 'type');
    
    const summary = {
      totalEntities: entities.length,
      uniqueEntityTypes: Object.keys(entityTypes).length,
      mostCommonType: this.getMostCommon(entityTypes),
      averageConfidence: this.calculateAverage(entities, 'confidence')
    };

    const charts = [
      {
        type: 'pie',
        title: 'Entity Distribution',
        data: {
          labels: Object.keys(entityTypes),
          datasets: [{
            data: Object.values(entityTypes).map(group => group.length)
          }]
        }
      }
    ];

    return { summary, details: entities, charts };
  }

  async transformAlertSummary(data, options) {
    const alertsByType = this.groupBy(data, 'type');
    const alertsBySeverity = this.groupBy(data, 'severity');
    
    const summary = {
      totalAlerts: data.length,
      criticalAlerts: alertsBySeverity.critical?.length || 0,
      warningAlerts: alertsBySeverity.warning?.length || 0,
      resolvedAlerts: data.filter(a => a.status === 'resolved').length,
      averageResolutionTime: this.calculateAverageTime(data, 'createdAt', 'resolvedAt')
    };

    const charts = [
      {
        type: 'doughnut',
        title: 'Alerts by Severity',
        data: {
          labels: Object.keys(alertsBySeverity),
          datasets: [{
            data: Object.values(alertsBySeverity).map(group => group.length)
          }]
        }
      }
    ];

    return { summary, details: data, charts };
  }

  async transformSearchAnalytics(data, options) {
    const searchesByQuery = this.groupBy(data, 'query');
    const topQueries = Object.entries(searchesByQuery)
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 10);
    
    const summary = {
      totalSearches: data.length,
      uniqueQueries: Object.keys(searchesByQuery).length,
      averageResultCount: this.calculateAverage(data, 'resultCount'),
      averageResponseTime: this.calculateAverage(data, 'responseTime'),
      successRate: (data.filter(s => s.successful).length / data.length * 100).toFixed(2) + '%'
    };

    const charts = [
      {
        type: 'bar',
        title: 'Top Search Queries',
        data: {
          labels: topQueries.map(([query]) => query),
          datasets: [{
            label: 'Search Count',
            data: topQueries.map(([, searches]) => searches.length)
          }]
        }
      }
    ];

    return { summary, details: data, charts };
  }

  async transformUserActivity(data, options) {
    const activitiesByUser = this.groupBy(data, 'userId');
    const activitiesByType = this.groupBy(data, 'activityType');
    
    const summary = {
      totalActivities: data.length,
      uniqueUsers: Object.keys(activitiesByUser).length,
      mostActiveUser: this.getMostActive(activitiesByUser),
      averageSessionDuration: this.calculateAverage(data, 'sessionDuration'),
      peakHour: this.findPeakHour(data)
    };

    const charts = [
      {
        type: 'line',
        title: 'Activity Over Time',
        data: this.generateTimeSeriesData(data, 'timestamp', 'hour')
      }
    ];

    return { summary, details: data, charts };
  }

  async transformSystemPerformance(data, options) {
    const summary = {
      averageCPU: this.calculateAverage(data, 'cpuUsage'),
      averageMemory: this.calculateAverage(data, 'memoryUsage'),
      averageResponseTime: this.calculateAverage(data, 'responseTime'),
      errorRate: (data.filter(d => d.hasError).length / data.length * 100).toFixed(2) + '%',
      uptime: this.calculateUptime(data)
    };

    const charts = [
      {
        type: 'line',
        title: 'System Metrics',
        data: {
          labels: data.map(d => new Date(d.timestamp).toLocaleTimeString()),
          datasets: [
            {
              label: 'CPU Usage (%)',
              data: data.map(d => d.cpuUsage)
            },
            {
              label: 'Memory Usage (%)',
              data: data.map(d => d.memoryUsage)
            }
          ]
        }
      }
    ];

    return { summary, details: data, charts };
  }

  /**
   * Utility methods
   */
  formatReportTitle(reportType) {
    return reportType.split('-').map(word => 
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ') + ' Report';
  }

  formatLabel(key) {
    return key.replace(/([A-Z])/g, ' $1')
      .replace(/^./, str => str.toUpperCase())
      .trim();
  }

  calculateAverage(data, field) {
    if (!data || data.length === 0) return 0;
    const sum = data.reduce((acc, item) => acc + (item[field] || 0), 0);
    return (sum / data.length).toFixed(2);
  }

  groupBy(data, field) {
    return data.reduce((groups, item) => {
      const key = item[field] || 'unknown';
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
      return groups;
    }, {});
  }

  getMostCommon(groups) {
    let maxCount = 0;
    let mostCommon = null;
    
    for (const [key, items] of Object.entries(groups)) {
      if (items.length > maxCount) {
        maxCount = items.length;
        mostCommon = key;
      }
    }
    
    return mostCommon;
  }

  getMostActive(groups) {
    return this.getMostCommon(groups);
  }

  calculateAverageTime(data, startField, endField) {
    const times = data
      .filter(item => item[startField] && item[endField])
      .map(item => new Date(item[endField]) - new Date(item[startField]));
    
    if (times.length === 0) return '0 minutes';
    
    const avgMs = times.reduce((sum, time) => sum + time, 0) / times.length;
    const minutes = Math.floor(avgMs / 60000);
    
    return `${minutes} minutes`;
  }

  findPeakHour(data) {
    const hourCounts = data.reduce((counts, item) => {
      const hour = new Date(item.timestamp).getHours();
      counts[hour] = (counts[hour] || 0) + 1;
      return counts;
    }, {});
    
    let peakHour = 0;
    let maxCount = 0;
    
    for (const [hour, count] of Object.entries(hourCounts)) {
      if (count > maxCount) {
        maxCount = count;
        peakHour = hour;
      }
    }
    
    return `${peakHour}:00`;
  }

  generateTimeSeriesData(data, timestampField, granularity = 'hour') {
    const groups = data.reduce((acc, item) => {
      const date = new Date(item[timestampField]);
      let key;
      
      switch (granularity) {
      case 'hour':
        key = `${date.getHours()}:00`;
        break;
      case 'day':
        key = date.toLocaleDateString();
        break;
      default:
        key = date.toISOString();
      }
      
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    
    return {
      labels: Object.keys(groups),
      datasets: [{
        label: 'Activity Count',
        data: Object.values(groups)
      }]
    };
  }

  generateTrendData(data, valueField, dateField) {
    const sorted = [...data].sort((a, b) => 
      new Date(a[dateField]) - new Date(b[dateField])
    );
    
    return {
      labels: sorted.map(item => new Date(item[dateField]).toLocaleDateString()),
      datasets: [{
        label: this.formatLabel(valueField),
        data: sorted.map(item => item[valueField] || 0)
      }]
    };
  }

  calculateUptime(data) {
    const downtime = data.filter(d => d.status === 'down').length;
    const uptime = ((data.length - downtime) / data.length * 100).toFixed(2);
    return `${uptime}%`;
  }
}

module.exports = ReportGenerator;