# Test info

- Name: Admin UI - Navigation >> should load the dashboard
- Location: /app/tests/e2e/admin/admin-ui.e2e.test.js:53:3

# Error details

```
Error: locator.isVisible: Error: strict mode violation: locator('text=/Loading...|Connecting.../i') resolved to 15 elements:
    1) <span id="user-info" class="navbar-text">…</span> aka locator('#user-info')
    2) <span id="system-status" class="navbar-text ms-3">…</span> aka getByText('Connecting...')
    3) <div class="alert alert-info">…</div> aka getByText('Review data loading will be')
    4) <span class="visually-hidden">Loading...</span> aka locator('#jobs-table-body').getByText('Loading...')
    5) <p class="mt-2">Loading jobs...</p> aka getByText('Loading jobs...')
    6) <span class="visually-hidden">Loading...</span> aka locator('#queue-stats-container').getByText('Loading...')
    7) <p class="mt-2">Loading queue statistics...</p> aka getByText('Loading queue statistics...')
    8) <span class="visually-hidden">Loading...</span> aka getByLabel('Documents').getByText('Loading...')
    9) <p class="mt-2">Loading documents...</p> aka getByText('Loading documents...')
    10) <span class="visually-hidden">Loading...</span> aka getByLabel('Pending Approvals').getByText('Loading...')
    ...

Call log:
    - checking visibility of locator('text=/Loading...|Connecting.../i')

    at /app/tests/e2e/admin/admin-ui.e2e.test.js:58:32
```

# Page snapshot

```yaml
- navigation:
  - link " TheWell Pipeline":
    - /url: "#"
  - list:
    - listitem:
      - link " Review":
        - /url: "#"
    - listitem:
      - link " Curation Board":
        - /url: "#"
    - listitem:
      - link " Jobs":
        - /url: "#"
    - listitem:
      - link " Visibility":
        - /url: "#"
    - listitem:
      - link " Statistics":
        - /url: "#"
  - text:  Loading...  Connecting...
- heading " Document Review" [level=2]
- button " Refresh"
- button " Bulk Actions"
- button " Filter"
- text: 
- textbox "Search documents..."
- text: 0 pending 0 in review 0 approved 0 rejected  Review data loading will be implemented in the full review system.
```

# Test source

```ts
   1 | /**
   2 |  * Admin UI End-to-End Tests
   3 |  * Tests the admin interface functionality using Playwright
   4 |  */
   5 |
   6 | const { test, expect } = require('@playwright/test');
   7 |
   8 | // Configuration
   9 | const BASE_URL = process.env.ADMIN_UI_URL || 'http://localhost:3000';
   10 | const API_KEY = process.env.API_KEY || 'test-api-key';
   11 |
   12 | test.describe('Admin UI - Navigation', () => {
   13 |   test.beforeEach(async ({ page }) => {
   14 |     console.log(`[Navigation beforeEach] Navigating to BASE_URL: ${BASE_URL}`);
   15 |     await page.goto(BASE_URL);
   16 |     await page.waitForLoadState('domcontentloaded');
   17 |     console.log('[Navigation beforeEach] DOM content loaded.');
   18 |
   19 |     const apiKeyInputLocator = page.locator('input[name="apiKey"], input[placeholder*="API Key"]');
   20 |     const loginButtonLocator = page.locator('button:has-text("Submit"), button:has-text("Login")');
   21 |
   22 |     const loginFormVisible = await apiKeyInputLocator.isVisible({ timeout: 7000 });
   23 |
   24 |     if (loginFormVisible) {
   25 |       console.log('[Navigation beforeEach] Login form found. Attempting login...');
   26 |       await apiKeyInputLocator.fill(API_KEY);
   27 |       await loginButtonLocator.click();
   28 |       console.log('[Navigation beforeEach] Login submitted. Waiting for login form to disappear...');
   29 |       await expect(apiKeyInputLocator).not.toBeVisible({ timeout: 15000 });
   30 |       console.log('[Navigation beforeEach] Login form disappeared.');
   31 |
   32 |       console.log(`[Navigation beforeEach] Waiting for URL to be ${BASE_URL}{,/}* after login...`);
   33 |       await page.waitForURL(BASE_URL + "{,/}*", { timeout: 20000, waitUntil: 'domcontentloaded' });
   34 |       console.log(`[Navigation beforeEach] URL is now ${page.url()}. Waiting for network idle...`);
   35 |
   36 |       await page.waitForLoadState('networkidle', { timeout: 15000 });
   37 |       console.log('[Navigation beforeEach] Network is idle after login and URL change.');
   38 |     } else {
   39 |       console.log('[Navigation beforeEach] Login form not visible. Assuming already logged in or no auth needed.');
   40 |       if (page.url().startsWith(BASE_URL)) {
   41 |           console.log(`[Navigation beforeEach] Already on BASE_URL or sub-path. Current URL: ${page.url()}. Waiting for network idle...`);
   42 |           await page.waitForLoadState('networkidle', { timeout: 15000 });
   43 |           console.log('[Navigation beforeEach] Network is idle on initial page (assumed logged in).');
   44 |       } else {
   45 |           console.log(`[Navigation beforeEach] Not on BASE_URL. Current URL: ${page.url()}. Waiting for network idle...`);
   46 |           await page.waitForLoadState('networkidle', { timeout: 10000 });
   47 |           console.log('[Navigation beforeEach] Network is idle on unexpected initial page.');
   48 |       }
   49 |     }
   50 |     console.log(`[Navigation beforeEach] Completed. Current URL: ${page.url()}`);
   51 |   });
   52 |
   53 |   test('should load the dashboard', async ({ page }) => {
   54 |     // beforeEach should have handled login if necessary and waited for network idle.
   55 |     console.log(`[Test: should load the dashboard] Current URL after beforeEach: ${page.url()}`);
   56 |     // Wait for any 'Loading...' or 'Connecting...' indicators to disappear as the page might be fetching initial data.
   57 |     const loadingIndicator = page.locator('text=/Loading...|Connecting.../i');
>  58 |     if (await loadingIndicator.isVisible()) {
      |                                ^ Error: locator.isVisible: Error: strict mode violation: locator('text=/Loading...|Connecting.../i') resolved to 15 elements:
   59 |       console.log('[Test: should load the dashboard] Loading indicator found. Waiting for it to disappear...');
   60 |       await expect(loadingIndicator).not.toBeVisible({ timeout: 20000 }); // Wait up to 20s for loading
   61 |       console.log('[Test: should load the dashboard] Loading indicator disappeared.');
   62 |     } else {
   63 |       console.log('[Test: should load the dashboard] No loading indicator found initially.');
   64 |     }
   65 |
   66 |     // Commenting out the strict URL check for now as the page might be dynamic during initial load.
   67 |     // The primary concern is that the dashboard content loads correctly.
   68 |     // await expect(page).toHaveURL(BASE_URL + "{,/}*", { timeout: 10000 });
   69 |     // console.log('[Test: should load the dashboard] URL check passed.');
   70 |
   71 |     // 2. Verify the main dashboard heading is visible
   72 |     const dashboardHeadingLocator = page.locator('h1, h2').filter({ hasText: /The Well - Manual Review/i }).first();
   73 |     console.log('[Test: should load the dashboard] Checking for dashboard heading visibility...');
   74 |     try {
   75 |       await expect(dashboardHeadingLocator).toBeVisible({ timeout: 20000 }); // Increased timeout for heading
   76 |       console.log('[Test: should load the dashboard] Dashboard heading is visible.');
   77 |     } catch (error) {
   78 |       console.log(`[Test: should load the dashboard] Dashboard heading NOT visible. Current URL: ${page.url()}`);
   79 |       try {
   80 |         const pageTitle = await page.title();
   81 |         console.log(`[Test: should load the dashboard] Page Title: ${pageTitle}`);
   82 |         
   83 |         const apiKeyInputLocator = page.locator('input[name="apiKey"], input[placeholder*="API Key"]');
   84 |         const isLoginInputVisible = await apiKeyInputLocator.isVisible({ timeout: 1000 }); // Quick check
   85 |         console.log(`[Test: should load the dashboard] Login API key input visible: ${isLoginInputVisible}`);
   86 |
   87 |         const h1Elements = await page.locator('h1').evaluateAll(els => els.map(el => el.outerHTML));
   88 |         console.log('[Test: should load the dashboard] H1 Elements outerHTML:', JSON.stringify(h1Elements));
   89 |         
   90 |         const h2Elements = await page.locator('h2').evaluateAll(els => els.map(el => el.outerHTML));
   91 |         console.log('[Test: should load the dashboard] H2 Elements outerHTML:', JSON.stringify(h2Elements));
   92 |       } catch (diagError) {
   93 |         console.log('[Test: should load the dashboard] Error during diagnostics:', diagError);
   94 |       }
   95 |       throw error; // Re-throw to ensure test fails
   96 |     }
   97 |
   98 |     // 3. Verify the page title
   99 |     await expect(page).toHaveTitle(/The Well - Manual Review/);
  100 |     console.log('[Test: should load the dashboard] Page title check passed.');
  101 |   });
  102 |
  103 |   test('should navigate to review queue', async ({ page }) => {
  104 |     // Navigation and auth handled by beforeEach
  105 |     await page.locator('a:has-text("Review"), a:has-text("Curation")').first().click();
  106 |     await expect(page.url()).toContain('/review');
  107 |     await expect(page.locator('h1, h2').first()).toContainText(/The Well - Manual Review/i);
  108 |   });
  109 |
  110 |   test('should navigate to jobs queue', async ({ page }) => {
  111 |     // Navigation and auth handled by beforeEach
  112 |     await page.locator('a:has-text("Jobs"), a:has-text("Queue")').first().click();
  113 |     await expect(page.url()).toContain('/jobs');
  114 |     await expect(page.locator('h1, h2').first()).toContainText(/The Well - Manual Review/i);
  115 |   });
  116 |
  117 |   test('should show system status', async ({ page }) => {
  118 |     // Navigation and auth handled by beforeEach
  119 |     const statusElement = page.locator('[data-testid="system-status"], .status, .health-status').first();
  120 |     await expect(statusElement).toBeVisible();
  121 |     const statusText = await statusElement.textContent();
  122 |     expect(statusText).toMatch(/Status: All Systems Operational|System Health: Good|API Status: Online/i);
  123 |   });
  124 |
  125 |   test('should navigate to costs page', async ({ page }) => {
  126 |     // Navigation and auth handled by beforeEach
  127 |     await page.locator('a:has-text("Costs"), a:has-text("Billing")').first().click();
  128 |     await expect(page.url()).toContain('/costs');
  129 |     await expect(page.locator('h1, h2').first()).toContainText(/The Well - Manual Review/i);
  130 |   });
  131 | });
  132 |
  133 | test.describe('Admin UI - Document Review', () => {
  134 |   test.beforeEach(async ({ page }) => {
  135 |     await page.goto(`${BASE_URL}/review`);
  136 |     await page.waitForLoadState('domcontentloaded'); // Wait for initial page load
  137 |
  138 |     const apiKeyInputLocator = page.locator('input[name="apiKey"], input[placeholder*="API Key"]');
  139 |     const loginButtonLocator = page.locator('button:has-text("Submit"), button:has-text("Login")');
  140 |
  141 |     if (await apiKeyInputLocator.isVisible({ timeout: 5000 })) {
  142 |       await apiKeyInputLocator.fill(API_KEY);
  143 |       await loginButtonLocator.click();
  144 |       await expect(apiKeyInputLocator).not.toBeVisible({ timeout: 10000 }); 
  145 |     }
  146 |     await page.waitForLoadState('networkidle', { timeout: 7000 });
  147 |   });
  148 |
  149 |   test('should display pending documents', async ({ page }) => {
  150 |     // Wait for documents to load
  151 |     await page.waitForSelector('.document-item, .review-item, tr[data-document-id]', { 
  152 |       timeout: 5000 
  153 |     }).catch(() => {
  154 |       // If no documents, check for empty state
  155 |     });
  156 |     
  157 |     // Check for document list or empty state
  158 |     const hasDocuments = await page.locator('.document-item, .review-item, tr[data-document-id]').count() > 0;
```