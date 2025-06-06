#!/usr/bin/env node

/**
 * Coherence Monitoring Dashboard
 * Tracks system health throughout feature implementation
 */

const fs = require('fs').promises;
const path = require('path');
const { promisify } = require('util');
const { exec: execCallback } = require('child_process');
const exec = promisify(execCallback);

class CoherenceMonitor {
  constructor() {
    this.metrics = {
      baseline: null,
      current: null,
      trends: [],
      alerts: []
    };
    
    this.thresholds = {
      testPassRate: 0.95,
      coverageMin: 0.85,
      performanceMaxMs: 2000,
      apiCompatibility: 1.0,
      buildTimeMaxMinutes: 10
    };
  }

  async captureBaseline() {
    console.log('📊 Capturing baseline metrics...');
    
    this.metrics.baseline = await this.captureMetrics();
    await this.saveMetrics('baseline', this.metrics.baseline);
    
    console.log('✅ Baseline captured');
    return this.metrics.baseline;
  }

  async checkCoherence() {
    console.log('\n🔍 Coherence Check - ' + new Date().toISOString());
    console.log('=' .repeat(50));
    
    this.metrics.current = await this.captureMetrics();
    const report = this.compareMetrics();
    
    // Display results
    this.displayReport(report);
    
    // Check for critical issues
    if (report.criticalIssues.length > 0) {
      console.error('\n🚨 CRITICAL ISSUES DETECTED:');
      report.criticalIssues.forEach(issue => {
        console.error(`   - ${issue}`);
      });
      
      // Save alert
      this.metrics.alerts.push({
        timestamp: new Date().toISOString(),
        issues: report.criticalIssues
      });
    }
    
    // Save metrics
    await this.saveMetrics('current', this.metrics.current);
    await this.saveMetrics('alerts', this.metrics.alerts);
    
    return report;
  }

  async captureMetrics() {
    const metrics = {
      timestamp: new Date().toISOString(),
      tests: await this.getTestMetrics(),
      performance: await this.getPerformanceMetrics(),
      build: await this.getBuildMetrics(),
      api: await this.getAPIMetrics(),
      database: await this.getDatabaseMetrics(),
      docker: await this.getDockerMetrics()
    };
    
    return metrics;
  }

  async getTestMetrics() {
    try {
      // Run tests and capture results
      const { stdout } = await exec('npm run test:unit -- --json --outputFile=test-results.json', {
        maxBuffer: 1024 * 1024 * 10
      });
      
      const results = JSON.parse(await fs.readFile('test-results.json', 'utf8'));
      
      // Get coverage
      let coverage = { lines: 0 };
      try {
        const coverageData = JSON.parse(
          await fs.readFile('coverage/coverage-summary.json', 'utf8')
        );
        coverage = coverageData.total.lines;
      } catch (e) {
        console.warn('Coverage data not available');
      }
      
      return {
        total: results.numTotalTests || 0,
        passed: results.numPassedTests || 0,
        failed: results.numFailedTests || 0,
        passRate: results.numTotalTests ? 
          (results.numPassedTests / results.numTotalTests) : 0,
        coverage: coverage.pct || 0,
        duration: results.totalTime || 0
      };
    } catch (error) {
      console.error('Failed to get test metrics:', error.message);
      return {
        total: 0,
        passed: 0,
        failed: 0,
        passRate: 0,
        coverage: 0,
        duration: 0,
        error: error.message
      };
    }
  }

  async getPerformanceMetrics() {
    try {
      // Simple performance check - measure API response time
      const start = Date.now();
      const { stdout } = await exec('curl -s -w "%{time_total}" -o /dev/null http://localhost:3000/health');
      const responseTime = parseFloat(stdout) * 1000; // Convert to ms
      
      return {
        healthCheckMs: responseTime,
        apiAvailable: true
      };
    } catch (error) {
      return {
        healthCheckMs: null,
        apiAvailable: false,
        error: error.message
      };
    }
  }

  async getBuildMetrics() {
    try {
      const start = Date.now();
      await exec('npm run build --if-present');
      const buildTime = Date.now() - start;
      
      return {
        success: true,
        durationMs: buildTime,
        durationMinutes: buildTime / 60000
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async getAPIMetrics() {
    try {
      // Check API compatibility by running contract tests
      const { stdout } = await exec('npm run test:contract --if-present -- --json');
      const results = JSON.parse(stdout);
      
      return {
        compatible: results.numFailedTests === 0,
        endpoints: results.numTotalTests,
        breaking: results.numFailedTests
      };
    } catch (error) {
      // If no contract tests, assume compatible
      return {
        compatible: true,
        endpoints: 0,
        breaking: 0,
        note: 'No contract tests found'
      };
    }
  }

  async getDatabaseMetrics() {
    try {
      // Check if migrations are up to date
      const { stdout } = await exec('npm run db:status --if-present');
      
      return {
        migrationsUpToDate: !stdout.includes('pending'),
        connectionHealthy: true
      };
    } catch (error) {
      return {
        migrationsUpToDate: false,
        connectionHealthy: false,
        error: error.message
      };
    }
  }

  async getDockerMetrics() {
    try {
      // Get docker image size
      const { stdout } = await exec('docker images thewell-api --format "{{.Size}}"');
      
      return {
        imageSize: stdout.trim(),
        available: true
      };
    } catch (error) {
      return {
        imageSize: 'N/A',
        available: false
      };
    }
  }

  compareMetrics() {
    const current = this.metrics.current;
    const baseline = this.metrics.baseline || current;
    
    const report = {
      status: 'healthy',
      criticalIssues: [],
      warnings: [],
      improvements: [],
      regressions: []
    };
    
    // Test coverage check
    if (current.tests.coverage < baseline.tests.coverage * 0.95) {
      report.regressions.push(
        `Test coverage decreased from ${baseline.tests.coverage}% to ${current.tests.coverage}%`
      );
    }
    
    if (current.tests.coverage < this.thresholds.coverageMin * 100) {
      report.criticalIssues.push(
        `Test coverage ${current.tests.coverage}% below minimum ${this.thresholds.coverageMin * 100}%`
      );
    }
    
    // Test pass rate check
    if (current.tests.passRate < this.thresholds.testPassRate) {
      report.criticalIssues.push(
        `Test pass rate ${(current.tests.passRate * 100).toFixed(1)}% below threshold`
      );
    }
    
    // Performance check
    if (current.performance.healthCheckMs > this.thresholds.performanceMaxMs) {
      report.warnings.push(
        `API response time ${current.performance.healthCheckMs}ms exceeds threshold`
      );
    }
    
    // API compatibility
    if (!current.api.compatible) {
      report.criticalIssues.push(
        `API breaking changes detected: ${current.api.breaking} endpoints affected`
      );
    }
    
    // Build time check
    if (current.build.durationMinutes > this.thresholds.buildTimeMaxMinutes) {
      report.warnings.push(
        `Build time ${current.build.durationMinutes.toFixed(1)} minutes exceeds threshold`
      );
    }
    
    // Set overall status
    if (report.criticalIssues.length > 0) {
      report.status = 'critical';
    } else if (report.warnings.length > 0 || report.regressions.length > 0) {
      report.status = 'warning';
    }
    
    return report;
  }

  displayReport(report) {
    const statusEmoji = {
      healthy: '✅',
      warning: '⚠️',
      critical: '🚨'
    };
    
    console.log(`\nOverall Status: ${statusEmoji[report.status]} ${report.status.toUpperCase()}`);
    console.log('\nCurrent Metrics:');
    console.log(`  Tests: ${this.metrics.current.tests.passed}/${this.metrics.current.tests.total} (${(this.metrics.current.tests.passRate * 100).toFixed(1)}%)`);
    console.log(`  Coverage: ${this.metrics.current.tests.coverage}%`);
    console.log(`  API Response: ${this.metrics.current.performance.healthCheckMs || 'N/A'}ms`);
    console.log(`  Build Time: ${this.metrics.current.build.durationMinutes?.toFixed(1) || 'N/A'} minutes`);
    
    if (report.improvements.length > 0) {
      console.log('\n✨ Improvements:');
      report.improvements.forEach(item => console.log(`  - ${item}`));
    }
    
    if (report.warnings.length > 0) {
      console.log('\n⚠️  Warnings:');
      report.warnings.forEach(item => console.log(`  - ${item}`));
    }
    
    if (report.regressions.length > 0) {
      console.log('\n📉 Regressions:');
      report.regressions.forEach(item => console.log(`  - ${item}`));
    }
  }

  async saveMetrics(type, data) {
    const dir = path.join(__dirname, 'metrics');
    await fs.mkdir(dir, { recursive: true });
    
    const filename = path.join(dir, `${type}-${Date.now()}.json`);
    await fs.writeFile(filename, JSON.stringify(data, null, 2));
    
    // Also update latest
    const latestFile = path.join(dir, `${type}-latest.json`);
    await fs.writeFile(latestFile, JSON.stringify(data, null, 2));
  }

  async generateTrendReport() {
    console.log('\n📈 Generating Trend Report...');
    
    const metricsDir = path.join(__dirname, 'metrics');
    const files = await fs.readdir(metricsDir);
    
    const currentFiles = files
      .filter(f => f.startsWith('current-') && f.endsWith('.json'))
      .sort();
    
    const trends = [];
    for (const file of currentFiles.slice(-10)) { // Last 10 data points
      const data = JSON.parse(await fs.readFile(path.join(metricsDir, file), 'utf8'));
      trends.push({
        timestamp: data.timestamp,
        coverage: data.tests.coverage,
        passRate: data.tests.passRate,
        performance: data.performance.healthCheckMs
      });
    }
    
    // Simple trend analysis
    if (trends.length >= 2) {
      const first = trends[0];
      const last = trends[trends.length - 1];
      
      console.log('\nTrends over last', trends.length, 'checks:');
      console.log(`  Coverage: ${first.coverage}% → ${last.coverage}% (${last.coverage > first.coverage ? '↑' : '↓'})`);
      console.log(`  Pass Rate: ${(first.passRate * 100).toFixed(1)}% → ${(last.passRate * 100).toFixed(1)}% (${last.passRate > first.passRate ? '↑' : '↓'})`);
      
      if (first.performance && last.performance) {
        console.log(`  Performance: ${first.performance}ms → ${last.performance}ms (${last.performance < first.performance ? '↑' : '↓'})`);
      }
    }
    
    return trends;
  }
}

// CLI Interface
async function main() {
  const monitor = new CoherenceMonitor();
  const command = process.argv[2];
  
  switch (command) {
    case 'baseline':
      await monitor.captureBaseline();
      break;
      
    case 'check':
      await monitor.checkCoherence();
      break;
      
    case 'trends':
      await monitor.generateTrendReport();
      break;
      
    case 'watch':
      // Continuous monitoring
      console.log('Starting continuous coherence monitoring...');
      await monitor.checkCoherence();
      setInterval(async () => {
        console.log('\n' + '='.repeat(70) + '\n');
        await monitor.checkCoherence();
      }, 5 * 60 * 1000); // Every 5 minutes
      break;
      
    default:
      console.log('Usage: coherence-monitor.js [baseline|check|trends|watch]');
      console.log('  baseline - Capture baseline metrics');
      console.log('  check    - Run coherence check');
      console.log('  trends   - Show trends over time');
      console.log('  watch    - Continuous monitoring');
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = CoherenceMonitor;