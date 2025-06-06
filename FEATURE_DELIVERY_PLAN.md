# Feature Delivery Plan: AI-Driven Policy & Safety Intelligence Pipeline

## Delivery Standards & Requirements

### Definition of Done (DoD) for Each Feature

1. **Code Implementation** ✅
   - Feature code complete and follows existing patterns
   - Code review completed
   - No linting errors (`npm run lint`)
   - No type errors (`npm run typecheck`)

2. **Test Coverage** ✅
   - Unit tests: ≥90% coverage for new code
   - Integration tests: All API endpoints tested
   - E2E tests: Critical paths covered
   - Browser-based BDD tests: All UI scenarios using Playwright/Cucumber

3. **Documentation** ✅
   - API documentation updated (Swagger)
   - README updated if needed
   - BDD scenarios documented
   - Architecture diagrams updated

4. **Quality Gates** ✅
   - All tests passing locally
   - All tests passing in CI
   - No regression in existing tests
   - Performance benchmarks met (<2s for searches)

5. **Deployment Verification** ✅
   - Feature branch merged to main
   - GitHub Actions CI successful (verified via logs)
   - Docker build successful
   - Smoke tests passing in staging

## Phase 1: Foundation (Weeks 1-8)

### Feature 1.1: Document Versioning System
**Duration**: 2-3 weeks
**BDD Scenarios**: QR-02, AL-01

#### Requirements
```gherkin
Feature: Document Versioning
  Scenario: Creating document versions
    Given a document exists in the system
    When new content is ingested with the same source_id
    Then a new version should be created
    And the previous version should be preserved
    
  Scenario: Comparing versions
    Given a document with multiple versions
    When I request a diff between version 1 and 3
    Then I should see additions highlighted
    And deletions should be marked
```

#### Implementation Tasks
1. **Database Schema** (Day 1-2)
   ```sql
   -- migrations/0005_add_document_versioning.sql
   CREATE TABLE document_versions (
     id SERIAL PRIMARY KEY,
     document_id INTEGER REFERENCES documents(id),
     version_number INTEGER NOT NULL,
     content TEXT NOT NULL,
     content_hash VARCHAR(64),
     created_at TIMESTAMP DEFAULT NOW(),
     created_by VARCHAR(255),
     change_summary TEXT,
     UNIQUE(document_id, version_number)
   );
   
   CREATE TABLE document_diffs (
     id SERIAL PRIMARY KEY,
     document_id INTEGER REFERENCES documents(id),
     from_version INTEGER NOT NULL,
     to_version INTEGER NOT NULL,
     diff_content JSONB,
     created_at TIMESTAMP DEFAULT NOW()
   );
   ```

2. **Core Implementation** (Day 3-7)
   - `src/database/DocumentVersionDAO.js`
   - `src/services/DiffService.js`
   - `src/services/VersioningService.js`

3. **API Endpoints** (Day 8-9)
   - `GET /api/v1/documents/:id/versions`
   - `GET /api/v1/diff?doc_id=:id&v1=:v1&v2=:v2`

4. **Test Requirements**
   ```javascript
   // Unit Tests (tests/unit/services/VersioningService.test.js)
   describe('VersioningService', () => {
     test('creates new version when content changes');
     test('skips version when content unchanged');
     test('maintains version history');
     test('generates accurate diffs');
   });
   
   // Integration Tests (tests/integration/versioning.test.js)
   describe('Versioning API', () => {
     test('GET /versions returns version list');
     test('GET /diff returns highlighted changes');
     test('handles missing versions gracefully');
   });
   
   // E2E Tests (tests/e2e/versioning/document-versioning.e2e.test.js)
   describe('Document Versioning E2E', () => {
     test('complete versioning workflow');
     test('diff generation performance < 500ms');
   });
   
   // Browser BDD (tests/bdd/features/versioning.feature)
   Feature: Version Management UI
     Scenario: Viewing version history
     Scenario: Comparing versions visually
   ```

5. **Delivery Checklist**
   - [ ] Create feature branch: `feat/document-versioning`
   - [ ] Implement database migrations
   - [ ] Write unit tests (target: 95% coverage)
   - [ ] Implement core services
   - [ ] Write integration tests
   - [ ] Implement API endpoints
   - [ ] Write E2E tests
   - [ ] Create UI components
   - [ ] Write Playwright BDD tests
   - [ ] Run full test suite: `npm run test:all`
   - [ ] Fix any failing tests
   - [ ] Create PR with test results
   - [ ] Code review approval
   - [ ] Merge to main
   - [ ] Verify GitHub Actions success
   - [ ] Deploy to staging
   - [ ] Run smoke tests
   - [ ] Update BDD.md verification

### Feature 1.2: Content Processing Pipeline
**Duration**: 2 weeks
**BDD Scenarios**: NC-01, NC-02, NC-03

#### Requirements
```gherkin
Feature: Content Processing
  Scenario: HTML boilerplate removal
    Given raw HTML with navigation and ads
    When content is processed
    Then main content should be extracted
    And boilerplate should be removed
    
  Scenario: Language detection and translation
    Given content in Spanish
    When auto-translation is enabled
    Then English version should be created
    And original language preserved
```

#### Implementation Tasks
1. **Dependencies** (Day 1)
   ```json
   {
     "dependencies": {
       "trafilatura": "^1.0.0",
       "langdetect": "^0.2.1",
       "@google-cloud/translate": "^7.0.0",
       "tiktoken": "^1.0.0"
     }
   }
   ```

2. **Core Services** (Day 2-5)
   - `src/enrichment/ContentCleaner.js`
   - `src/enrichment/LanguageProcessor.js`
   - `src/enrichment/DocumentChunker.js`

3. **Pipeline Integration** (Day 6-7)
   - Update `IngestionEngine.js`
   - Add processing stages
   - Implement pipeline monitoring

4. **Test Requirements**
   ```javascript
   // Unit Tests
   describe('ContentCleaner', () => {
     test('removes navigation elements');
     test('preserves main content');
     test('handles malformed HTML');
   });
   
   describe('LanguageProcessor', () => {
     test('detects language accurately');
     test('translates content');
     test('preserves original metadata');
   });
   
   describe('DocumentChunker', () => {
     test('chunks within token limits');
     test('maintains context overlap');
     test('preserves document references');
   });
   
   // E2E Pipeline Test
   describe('Processing Pipeline E2E', () => {
     test('processes multilingual HTML document end-to-end');
     test('performance: processes 10MB document < 5s');
   });
   ```

5. **Delivery Checklist**
   - [ ] Feature branch: `feat/content-processing`
   - [ ] Install dependencies
   - [ ] Unit tests first (TDD approach)
   - [ ] Implement services
   - [ ] Integration tests
   - [ ] Pipeline integration
   - [ ] E2E tests
   - [ ] Performance tests
   - [ ] PR with coverage report
   - [ ] Merge after CI passes
   - [ ] Verify GitHub logs
   - [ ] Update documentation

### Feature 1.3: Role-Based Access Control (RBAC)
**Duration**: 1-2 weeks
**BDD Scenarios**: SR-04, AD-01, AD-02

#### Requirements
```gherkin
Feature: Role-Based Access
  Scenario: Role enforcement
    Given a user with "Analyst" role
    When they attempt to delete a source
    Then they should receive 403 Forbidden
    
  Scenario: API key rotation
    Given an active API key
    When rotation is triggered
    Then new key is generated
    And old key works for grace period
    And old key expires after 60 seconds
```

#### Implementation Tasks
1. **Database Schema** (Day 1)
   ```sql
   CREATE TABLE roles (
     id SERIAL PRIMARY KEY,
     name VARCHAR(50) UNIQUE NOT NULL,
     permissions JSONB DEFAULT '[]'
   );
   
   CREATE TABLE users (
     id SERIAL PRIMARY KEY,
     email VARCHAR(255) UNIQUE NOT NULL,
     role_id INTEGER REFERENCES roles(id)
   );
   
   CREATE TABLE api_keys (
     id SERIAL PRIMARY KEY,
     user_id INTEGER REFERENCES users(id),
     key_hash VARCHAR(64) NOT NULL,
     expires_at TIMESTAMP,
     rotated_from INTEGER REFERENCES api_keys(id),
     created_at TIMESTAMP DEFAULT NOW()
   );
   ```

2. **Middleware Enhancement** (Day 2-3)
   - `src/web/middleware/rbac.js`
   - `src/services/ApiKeyService.js`

3. **Test Requirements**
   ```javascript
   // Unit Tests
   describe('RBAC Middleware', () => {
     test('allows permitted actions');
     test('denies forbidden actions');
     test('handles missing roles');
   });
   
   // Integration Tests
   describe('RBAC Integration', () => {
     test.each([
       ['Admin', '/api/v1/sources', 'DELETE', 200],
       ['Analyst', '/api/v1/sources', 'DELETE', 403],
       ['Researcher', '/api/v1/rag/search', 'POST', 200]
     ])('%s role accessing %s %s returns %i', async (role, path, method, status) => {
       // Test implementation
     });
   });
   
   // Browser BDD
   Feature: User Management UI
     Scenario: Creating users with roles
     Scenario: Rotating API keys
   ```

## Phase 2: Intelligence Features (Weeks 9-18)

### Feature 2.1: Entity Extraction & Classification
**Duration**: 3 weeks
**BDD Scenarios**: SE-02, SE-03

#### Test Strategy
```javascript
// Unit Test Structure
describe('EntityExtractor', () => {
  describe('Platform detection', () => {
    test.each([
      ['TikTok announced new guidelines', ['TikTok']],
      ['Meta and Instagram policies', ['Meta', 'Instagram']],
      ['No platforms mentioned', []]
    ])('extracts platforms from: %s', (text, expected) => {
      // Test implementation
    });
  });
});

// E2E Test with Real NLP Model
describe('Entity Extraction E2E', () => {
  beforeAll(async () => {
    await loadSpacyModel();
  });
  
  test('extracts entities from policy document', async () => {
    const document = await loadFixture('policy-document.html');
    const entities = await extractEntities(document);
    expect(entities).toMatchSnapshot();
  });
});

// Browser BDD for Entity Explorer
Feature: Entity Explorer UI
  Background:
    Given I am logged in as Researcher
    And entities have been extracted
    
  Scenario: Viewing entity relationships
    When I navigate to entity explorer
    And I search for "TikTok"
    Then I should see related policies
    And I should see violation types
```

### Feature 2.2: Alert System
**Duration**: 2 weeks
**BDD Scenarios**: AL-01, AL-02

#### Comprehensive Testing
```javascript
// Mock Testing for Notifications
describe('AlertManager', () => {
  let slackMock, emailMock;
  
  beforeEach(() => {
    slackMock = jest.fn();
    emailMock = jest.fn();
  });
  
  test('sends alerts on policy change', async () => {
    const change = createPolicyChange();
    await alertManager.processChange(change);
    
    expect(slackMock).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('Policy Change Detected')
      })
    );
  });
});

// Integration Test with Real Services
describe('Alert Integration', () => {
  test('end-to-end alert flow', async () => {
    // Ingest document with policy change
    await ingestDocument(policyV1);
    await ingestDocument(policyV2);
    
    // Wait for alerts
    await waitFor(() => {
      expect(getSlackMessages()).toContainEqual(
        expect.objectContaining({
          type: 'policy_change'
        })
      );
    });
  });
});
```

## Phase 3: UI Enhancements (Weeks 19-22)

### Feature 3.1: Advanced Search UI
**Duration**: 1 week
**BDD Scenarios**: UI-01

#### Playwright BDD Tests
```typescript
// tests/bdd/features/search.feature
Feature: Advanced Search
  
  @critical
  Scenario: Autocomplete suggestions
    Given I am on the search page
    When I type "minor" in the search box
    Then I should see autocomplete suggestions
    And "TikTok • Minor Safety" should be highlighted
    When I select "TikTok • Minor Safety"
    Then search results should be filtered by this entity

// tests/bdd/steps/search.steps.ts
import { Given, When, Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';

Given('I am on the search page', async function() {
  await this.page.goto('/search');
});

When('I type {string} in the search box', async function(text: string) {
  await this.page.fill('[data-testid="search-input"]', text);
});

Then('I should see autocomplete suggestions', async function() {
  await expect(this.page.locator('[data-testid="autocomplete-dropdown"]'))
    .toBeVisible();
});
```

### Feature 3.2: Diff Viewer Component
**Duration**: 1 week
**BDD Scenarios**: UI-02

#### Visual Regression Testing
```javascript
// tests/visual/diff-viewer.spec.js
describe('Diff Viewer Visual Tests', () => {
  test('side-by-side view', async ({ page }) => {
    await page.goto('/diff?doc=123&v1=1&v2=2');
    await expect(page).toHaveScreenshot('diff-side-by-side.png');
  });
  
  test('inline view', async ({ page }) => {
    await page.click('[data-testid="view-toggle"]');
    await expect(page).toHaveScreenshot('diff-inline.png');
  });
});
```

## Testing Infrastructure Requirements

### 1. Test Environment Setup
```yaml
# .github/workflows/feature-delivery.yml
name: Feature Delivery Pipeline

on:
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: test
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
      redis:
        image: redis:7
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s

    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          
      - name: Install dependencies
        run: npm ci
        
      - name: Run linter
        run: npm run lint
        
      - name: Run type check
        run: npm run typecheck
        
      - name: Run unit tests with coverage
        run: npm run test:unit:coverage
        
      - name: Check coverage threshold
        run: |
          coverage=$(cat coverage/coverage-summary.json | jq '.total.lines.pct')
          if (( $(echo "$coverage < 90" | bc -l) )); then
            echo "Coverage $coverage% is below 90% threshold"
            exit 1
          fi
          
      - name: Run integration tests
        run: npm run test:integration
        
      - name: Run E2E tests
        run: npm run test:e2e
        
      - name: Setup Playwright
        run: npx playwright install --with-deps
        
      - name: Run BDD browser tests
        run: npm run test:bdd
        
      - name: Upload test results
        uses: actions/upload-artifact@v3
        with:
          name: test-results
          path: |
            coverage/
            test-results/
            playwright-report/
            
      - name: Comment PR with results
        uses: actions/github-script@v6
        with:
          script: |
            const coverage = require('./coverage/coverage-summary.json');
            const comment = `## Test Results
            
            ✅ All tests passed!
            
            **Coverage**: ${coverage.total.lines.pct}%
            - Statements: ${coverage.total.statements.pct}%
            - Branches: ${coverage.total.branches.pct}%
            - Functions: ${coverage.total.functions.pct}%
            - Lines: ${coverage.total.lines.pct}%
            `;
            
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: comment
            });
```

### 2. Test Scripts
```json
{
  "scripts": {
    "test:all": "npm run lint && npm run typecheck && npm run test:unit && npm run test:integration && npm run test:e2e && npm run test:bdd",
    "test:unit": "jest --testMatch='**/unit/**/*.test.js'",
    "test:unit:coverage": "jest --testMatch='**/unit/**/*.test.js' --coverage --coverageThreshold='{\"global\":{\"lines\":90,\"statements\":90,\"functions\":85,\"branches\":80}}'",
    "test:integration": "jest --testMatch='**/integration/**/*.test.js' --runInBand",
    "test:e2e": "jest --config jest.e2e.config.js --runInBand",
    "test:bdd": "cucumber-js tests/bdd/features --require tests/bdd/steps --require tests/bdd/support",
    "test:visual": "playwright test tests/visual",
    "test:performance": "k6 run tests/performance/load-test.js",
    "test:security": "npm audit && snyk test"
  }
}
```

### 3. Bug Resolution Process

```markdown
## Bug Resolution Workflow

1. **Bug Detection**
   - Failing test in CI
   - Production monitoring alert
   - User report

2. **Bug Triage**
   - P0: Production down, data loss risk
   - P1: Feature broken, no workaround
   - P2: Feature degraded, workaround exists
   - P3: Minor issue, cosmetic

3. **Bug Fix Process**
   ```bash
   # Create bug fix branch
   git checkout -b fix/ISSUE-123-description
   
   # Write failing test first
   npm run test:watch -- --testNamePattern="bug reproduction"
   
   # Fix the bug
   # Run all tests
   npm run test:all
   
   # Create PR with test results
   gh pr create --title "fix: [P1] Resolve issue with..." --body "Fixes #123"
   ```

4. **Verification**
   - CI must pass
   - Code review required
   - Deploy to staging
   - Verify fix in staging
   - Monitor after production deploy
```

## Delivery Verification Checklist

For **EVERY** feature delivery:

### Pre-Merge Checklist
- [ ] Feature branch created from latest main
- [ ] All acceptance criteria met
- [ ] Unit tests written and passing (≥90% coverage)
- [ ] Integration tests written and passing
- [ ] E2E tests written and passing
- [ ] BDD browser tests written and passing (UI features)
- [ ] No linting errors
- [ ] No type errors
- [ ] Documentation updated
- [ ] Performance benchmarks met
- [ ] Security scan passing
- [ ] Code review approved by 2 reviewers
- [ ] CI pipeline fully green

### Merge Process
```bash
# Update from main
git checkout main
git pull origin main
git checkout feat/your-feature
git rebase main

# Run full test suite locally
npm run test:all

# Push and create PR
git push origin feat/your-feature
gh pr create

# Wait for CI to pass
# Check GitHub Actions logs
gh run list --limit 1
gh run view [run-id]

# After approval and CI success
gh pr merge --squash --delete-branch
```

### Post-Merge Verification
- [ ] Check main branch CI status
- [ ] Verify GitHub Actions logs show success
- [ ] Pull latest main locally
- [ ] Run smoke tests
- [ ] Deploy to staging
- [ ] Run E2E tests against staging
- [ ] Check monitoring dashboards
- [ ] Update feature tracking

### Production Deployment
- [ ] Create release tag
- [ ] Deploy to production
- [ ] Run smoke tests in production
- [ ] Monitor for 24 hours
- [ ] Update BDD verification status

## Monthly Feature Delivery Review

```markdown
## Feature Delivery Metrics

- Features Delivered: X
- Average Test Coverage: X%
- CI Success Rate: X%
- Bugs Found in Production: X
- Average Time to Fix P1: X hours
- BDD Scenarios Passing: X/Y

## Continuous Improvement

1. Review failed deliveries
2. Update test strategies
3. Improve CI/CD pipeline
4. Update delivery checklist
```

## Emergency Rollback Procedure

```bash
# If feature causes production issues
# 1. Immediate rollback
git revert --no-commit HEAD
git commit -m "revert: emergency rollback of feature X"
git push origin main

# 2. Run tests to ensure stability
npm run test:smoke

# 3. Deploy rollback
./scripts/deploy-production.sh

# 4. Post-mortem
# - Document what went wrong
# - Add missing tests
# - Update delivery process
```