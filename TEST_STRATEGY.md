# Comprehensive Test Strategy for TheWell Pipeline

## Test Pyramid & Coverage Requirements

```
         ╱╲
        ╱  ╲       Browser BDD (10%)
       ╱    ╲      - Critical user journeys
      ╱──────╲     - Visual regression
     ╱        ╲    
    ╱   E2E    ╲   E2E Tests (15%)
   ╱   Tests    ╲  - Complete workflows
  ╱──────────────╲ - Performance tests
 ╱                ╲
╱  Integration     ╲ Integration (25%)
╱     Tests         ╲- API contracts
╱────────────────────╲- Database tests
╱                    ╲
╱    Unit Tests       ╲ Unit Tests (50%)
╱──────────────────────╲- Business logic
────────────────────────- Pure functions
```

## Test Categories & Requirements

### 1. Unit Tests (Target: 90%+ Coverage)

#### What to Test
- Pure functions and business logic
- Service methods in isolation
- Utility functions
- Data transformations
- Error handling

#### Testing Patterns
```javascript
// Example: Testing VersioningService
describe('VersioningService', () => {
  let service;
  let mockDAO;
  
  beforeEach(() => {
    mockDAO = {
      createVersion: jest.fn(),
      getVersions: jest.fn(),
      getLatestVersion: jest.fn()
    };
    service = new VersioningService(mockDAO);
  });
  
  describe('createVersion', () => {
    it('should create new version when content changes', async () => {
      // Arrange
      const document = { id: 1, content: 'old content', version: 1 };
      const newContent = 'new content';
      mockDAO.getLatestVersion.mockResolvedValue(document);
      mockDAO.createVersion.mockResolvedValue({ ...document, version: 2 });
      
      // Act
      const result = await service.createVersion(document.id, newContent);
      
      // Assert
      expect(mockDAO.createVersion).toHaveBeenCalledWith({
        document_id: 1,
        content: newContent,
        version_number: 2,
        change_summary: expect.any(String)
      });
      expect(result.version).toBe(2);
    });
    
    it('should skip version when content unchanged', async () => {
      // Test implementation
    });
    
    it('should handle concurrent version creation', async () => {
      // Test race conditions
    });
  });
});
```

#### Coverage Rules
```json
{
  "jest": {
    "collectCoverageFrom": [
      "src/**/*.js",
      "!src/**/*.test.js",
      "!src/**/__mocks__/**"
    ],
    "coverageThreshold": {
      "global": {
        "branches": 80,
        "functions": 85,
        "lines": 90,
        "statements": 90
      },
      "src/services/": {
        "lines": 95
      },
      "src/database/": {
        "lines": 90
      }
    }
  }
}
```

### 2. Integration Tests (Target: All API Endpoints)

#### Test Structure
```javascript
// Example: API Integration Test
describe('Document Versioning API', () => {
  let app;
  let db;
  
  beforeAll(async () => {
    db = await setupTestDatabase();
    app = await createTestApp(db);
  });
  
  afterAll(async () => {
    await db.close();
  });
  
  describe('GET /api/v1/documents/:id/versions', () => {
    it('should return version history', async () => {
      // Seed test data
      const doc = await createTestDocument();
      await createTestVersions(doc.id, 3);
      
      // Make request
      const response = await request(app)
        .get(`/api/v1/documents/${doc.id}/versions`)
        .set('x-api-key', TEST_API_KEY)
        .expect(200);
      
      // Assertions
      expect(response.body).toMatchObject({
        success: true,
        data: expect.arrayContaining([
          expect.objectContaining({
            version_number: expect.any(Number),
            created_at: expect.any(String),
            change_summary: expect.any(String)
          })
        ])
      });
      expect(response.body.data).toHaveLength(3);
    });
    
    it('should handle missing document', async () => {
      const response = await request(app)
        .get('/api/v1/documents/99999/versions')
        .set('x-api-key', TEST_API_KEY)
        .expect(404);
      
      expect(response.body.error).toBe('Document not found');
    });
    
    it('should enforce authentication', async () => {
      await request(app)
        .get('/api/v1/documents/1/versions')
        .expect(401);
    });
  });
});
```

#### Database Testing
```javascript
describe('DocumentVersionDAO Integration', () => {
  let dao;
  let db;
  
  beforeAll(async () => {
    db = await createTestDatabase();
    dao = new DocumentVersionDAO(db);
  });
  
  afterEach(async () => {
    await db.query('TRUNCATE document_versions CASCADE');
  });
  
  it('should handle version conflicts gracefully', async () => {
    const docId = 1;
    
    // Simulate concurrent version creation
    const promises = Array(5).fill(null).map((_, i) => 
      dao.createVersion({
        document_id: docId,
        content: `content ${i}`,
        version_number: 2
      })
    );
    
    const results = await Promise.allSettled(promises);
    
    // Only one should succeed
    const successful = results.filter(r => r.status === 'fulfilled');
    expect(successful).toHaveLength(1);
    
    // Others should fail with conflict error
    const failed = results.filter(r => r.status === 'rejected');
    expect(failed).toHaveLength(4);
    failed.forEach(result => {
      expect(result.reason.code).toBe('VERSION_CONFLICT');
    });
  });
});
```

### 3. E2E Tests (Target: Critical User Journeys)

#### Workflow Testing
```javascript
// Example: Complete Ingestion to Search Workflow
describe('Document Processing E2E', () => {
  let browser;
  let testDocumentId;
  
  beforeAll(async () => {
    browser = await puppeteer.launch();
    await resetTestEnvironment();
  });
  
  afterAll(async () => {
    await browser.close();
  });
  
  it('should process document from ingestion to searchable', async () => {
    // 1. Ingest document
    const ingestionResponse = await ingestTestDocument({
      source_id: 'test-source-1',
      content: 'This is a test policy about content moderation on social media platforms.'
    });
    
    expect(ingestionResponse.status).toBe('queued');
    testDocumentId = ingestionResponse.document_id;
    
    // 2. Wait for processing
    await waitForJobCompletion(ingestionResponse.job_id, {
      timeout: 30000,
      expectedStages: ['fetched', 'cleaned', 'enriched', 'indexed']
    });
    
    // 3. Verify document is searchable
    const searchResponse = await searchDocuments({
      query: 'content moderation policy',
      limit: 10
    });
    
    expect(searchResponse.results).toContainEqual(
      expect.objectContaining({
        document_id: testDocumentId,
        relevance_score: expect.any(Number)
      })
    );
    
    // 4. Verify enrichment completed
    const document = await getDocument(testDocumentId);
    expect(document.embeddings).toBeDefined();
    expect(document.entities).toContainEqual(
      expect.objectContaining({
        type: 'topic',
        value: 'content moderation'
      })
    );
  });
});
```

#### Performance Testing
```javascript
describe('Performance E2E Tests', () => {
  it('should handle 100 concurrent searches under 2s', async () => {
    // Prepare test data
    await seedSearchableDocuments(1000);
    
    // Generate diverse queries
    const queries = generateTestQueries(100);
    
    // Execute concurrent searches
    const startTime = Date.now();
    const results = await Promise.all(
      queries.map(query => 
        searchDocuments({ query, limit: 10 })
      )
    );
    const duration = Date.now() - startTime;
    
    // Assertions
    expect(duration).toBeLessThan(2000);
    expect(results.every(r => r.success)).toBe(true);
    
    // Verify response times
    const avgResponseTime = results.reduce((sum, r) => sum + r.responseTime, 0) / results.length;
    expect(avgResponseTime).toBeLessThan(200);
  });
});
```

### 4. Browser-Based BDD Tests (Target: All UI Features)

#### Cucumber Feature Files
```gherkin
# tests/bdd/features/document-versioning-ui.feature
@ui @versioning
Feature: Document Version Management UI

  Background:
    Given I am logged in as "Researcher"
    And the following documents exist:
      | id | title                  | versions |
      | 1  | TikTok Guidelines      | 3        |
      | 2  | Instagram Policies     | 2        |

  @critical
  Scenario: Viewing version history
    When I navigate to document "TikTok Guidelines"
    And I click on "Version History"
    Then I should see 3 versions listed
    And each version should show:
      | field         | visible |
      | version number| yes     |
      | change date   | yes     |
      | change summary| yes     |
      | author        | yes     |

  @visual
  Scenario: Comparing document versions
    Given I am viewing document "TikTok Guidelines"
    When I select version "1" and version "3" for comparison
    And I click "Compare Versions"
    Then I should see the diff viewer
    And additions should be highlighted in green
    And deletions should be highlighted in red
    When I toggle to "inline view"
    Then the layout should change to single column
    And I take a screenshot named "version-diff-inline"

  @accessibility
  Scenario: Keyboard navigation in diff viewer
    Given I am in the diff viewer
    When I press "Tab" key
    Then focus should move through interactive elements
    And I press "Space" on view toggle
    Then the view should switch
```

#### Step Definitions
```typescript
// tests/bdd/steps/versioning-ui.steps.ts
import { Given, When, Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { VersioningPage } from '../pages/VersioningPage';

Given('I am viewing document {string}', async function(docTitle: string) {
  const page = new VersioningPage(this.page);
  await page.navigateToDocument(docTitle);
  await page.waitForLoad();
});

When('I select version {string} and version {string} for comparison', 
  async function(v1: string, v2: string) {
    const page = new VersioningPage(this.page);
    await page.selectVersions(v1, v2);
  }
);

Then('I should see the diff viewer', async function() {
  await expect(this.page.locator('[data-testid="diff-viewer"]'))
    .toBeVisible({ timeout: 5000 });
});

Then('additions should be highlighted in green', async function() {
  const additions = this.page.locator('.diff-addition');
  await expect(additions.first()).toHaveCSS('background-color', 'rgb(198, 246, 213)');
});
```

#### Page Object Model
```typescript
// tests/bdd/pages/VersioningPage.ts
export class VersioningPage {
  constructor(private page: Page) {}
  
  async navigateToDocument(title: string) {
    await this.page.goto('/documents');
    await this.page.click(`text="${title}"`);
  }
  
  async selectVersions(v1: string, v2: string) {
    await this.page.check(`[data-testid="version-checkbox-${v1}"]`);
    await this.page.check(`[data-testid="version-checkbox-${v2}"]`);
  }
  
  async waitForLoad() {
    await this.page.waitForLoadState('networkidle');
    await expect(this.page.locator('[data-testid="loading-spinner"]'))
      .not.toBeVisible();
  }
}
```

## Test Data Management

### 1. Test Fixtures
```javascript
// tests/fixtures/documents.js
export const testDocuments = {
  policyDocument: {
    source_id: 'tiktok-guidelines-2024',
    title: 'TikTok Community Guidelines',
    content: readFileSync('./fixtures/tiktok-guidelines.html'),
    metadata: {
      platform: 'TikTok',
      document_type: 'policy',
      language: 'en'
    }
  },
  
  multilingualDocument: {
    source_id: 'instagram-terms-es',
    title: 'Términos de Instagram',
    content: readFileSync('./fixtures/instagram-terms-es.html'),
    metadata: {
      platform: 'Instagram',
      document_type: 'terms',
      language: 'es'
    }
  }
};
```

### 2. Test Database Seeding
```javascript
// tests/helpers/seed.js
export async function seedTestData(scenario) {
  switch(scenario) {
    case 'versioning':
      await seedVersioningData();
      break;
    case 'search':
      await seedSearchData();
      break;
    case 'rbac':
      await seedRBACData();
      break;
  }
}

async function seedVersioningData() {
  const docs = await Document.bulkCreate([
    { title: 'Policy A', content: 'Version 1 content' },
    { title: 'Policy B', content: 'Version 1 content' }
  ]);
  
  // Create multiple versions
  for (const doc of docs) {
    for (let v = 2; v <= 3; v++) {
      await DocumentVersion.create({
        document_id: doc.id,
        version_number: v,
        content: `Version ${v} content with changes`,
        change_summary: `Update ${v}: Modified section ${v}`
      });
    }
  }
}
```

## Continuous Integration Setup

### 1. GitHub Actions Workflow
```yaml
name: Comprehensive Test Suite

on:
  pull_request:
    types: [opened, synchronize, reopened]
  push:
    branches: [main]

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node: [16, 18, 20]
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: ${{ matrix.node }}
      - run: npm ci
      - run: npm run test:unit:coverage
      - uses: codecov/codecov-action@v3
        with:
          file: ./coverage/lcov.info
          flags: unit

  integration-tests:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15-alpine
        env:
          POSTGRES_PASSWORD: test
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
      redis:
        image: redis:7-alpine
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: npm run db:test:setup
      - run: npm run test:integration
      - uses: actions/upload-artifact@v3
        if: failure()
        with:
          name: integration-test-logs
          path: logs/

  e2e-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: docker-compose -f docker-compose.test.yml up -d
      - run: npm run wait-for-services
      - run: npm run test:e2e
      - run: docker-compose -f docker-compose.test.yml logs
        if: failure()

  browser-bdd-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: npx playwright install --with-deps
      - run: docker-compose -f docker-compose.test.yml up -d
      - run: npm run test:bdd
      - uses: actions/upload-artifact@v3
        if: always()
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 30

  visual-regression:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: npx playwright install --with-deps
      - run: npm run test:visual
      - uses: actions/upload-artifact@v3
        if: failure()
        with:
          name: visual-diff-report
          path: test-results/

  performance-tests:
    runs-on: ubuntu-latest
    if: github.event_name == 'pull_request'
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: npm run test:performance
      - uses: actions/github-script@v6
        with:
          script: |
            const results = require('./performance-results.json');
            const comment = `## Performance Test Results
            
            | Metric | Value | Threshold | Status |
            |--------|-------|-----------|--------|
            | Avg Response Time | ${results.avgResponseTime}ms | <200ms | ${results.avgResponseTime < 200 ? '✅' : '❌'} |
            | P95 Response Time | ${results.p95ResponseTime}ms | <500ms | ${results.p95ResponseTime < 500 ? '✅' : '❌'} |
            | Throughput | ${results.throughput} req/s | >50 req/s | ${results.throughput > 50 ? '✅' : '❌'} |
            `;
            
            await github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: comment
            });
```

## Bug Prevention & Resolution

### 1. Pre-commit Hooks
```javascript
// .husky/pre-commit
#!/bin/sh
. "$(dirname "$0")/_/husky.sh"

# Run fast checks
npm run lint
npm run typecheck

# Run affected tests
npm run test:affected
```

### 2. Test Failure Analysis
```javascript
// scripts/analyze-test-failures.js
const analyzeFailures = async () => {
  const report = await parseTestResults();
  
  // Categorize failures
  const categories = {
    flaky: [],
    regression: [],
    newFailure: []
  };
  
  for (const failure of report.failures) {
    if (await isFlaky(failure)) {
      categories.flaky.push(failure);
    } else if (await isRegression(failure)) {
      categories.regression.push(failure);
    } else {
      categories.newFailure.push(failure);
    }
  }
  
  // Generate report
  await generateFailureReport(categories);
  
  // Create issues for regressions
  for (const regression of categories.regression) {
    await createGitHubIssue({
      title: `Regression: ${regression.testName}`,
      body: formatRegressionDetails(regression),
      labels: ['bug', 'regression', 'p1']
    });
  }
};
```

## Test Maintenance

### 1. Flaky Test Detection
```javascript
// jest.config.js
module.exports = {
  reporters: [
    'default',
    ['./tests/reporters/flaky-test-reporter.js', {
      threshold: 0.95, // Flag tests that fail >5% of the time
      retries: 3
    }]
  ]
};
```

### 2. Test Performance Monitoring
```javascript
// Track slow tests
afterEach(() => {
  if (global.testRuntime > 1000) {
    console.warn(`Slow test detected: ${expect.getState().currentTestName} took ${global.testRuntime}ms`);
  }
});
```

## Security Testing

### 1. Dependency Scanning
```yaml
- name: Security Audit
  run: |
    npm audit --audit-level=moderate
    npx snyk test
```

### 2. API Security Tests
```javascript
describe('API Security', () => {
  it('should prevent SQL injection', async () => {
    const maliciousInput = "1'; DROP TABLE users; --";
    const response = await request(app)
      .get(`/api/v1/documents/${maliciousInput}`)
      .set('x-api-key', TEST_API_KEY)
      .expect(400);
    
    expect(response.body.error).toContain('Invalid input');
  });
  
  it('should rate limit aggressive requests', async () => {
    const requests = Array(100).fill(null).map(() =>
      request(app)
        .get('/api/v1/rag/search')
        .set('x-api-key', TEST_API_KEY)
        .send({ query: 'test' })
    );
    
    const responses = await Promise.all(requests);
    const rateLimited = responses.filter(r => r.status === 429);
    
    expect(rateLimited.length).toBeGreaterThan(0);
  });
});
```

## Monitoring & Alerting

### 1. Test Health Dashboard
```javascript
// Generate test metrics
{
  "testHealth": {
    "totalTests": 1250,
    "passingTests": 1242,
    "flakyTests": 5,
    "avgRuntime": "4m 32s",
    "coverage": {
      "lines": 92.3,
      "branches": 87.5,
      "functions": 90.1
    },
    "lastRun": "2024-06-05T10:30:00Z"
  }
}
```

### 2. Automated Test Alerts
```yaml
# Alert on test failures
alert: TestSuiteFailure
expr: test_suite_success_rate < 0.95
for: 30m
annotations:
  summary: "Test suite success rate below 95%"
  description: "Success rate: {{ $value }}%"
```