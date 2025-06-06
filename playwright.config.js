// Playwright configuration for UI tests
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.e2e.test.js',
  // outputDir: '/app/test-artifacts',
  
  // Maximum time one test can run
  timeout: 60 * 1000,
  
  expect: {
    // Maximum time expect() should wait
    timeout: 10000
  },
  
  // Run tests in files in parallel
  fullyParallel: true,
  
  // Fail the build on CI if you accidentally left test.only in the source code
  forbidOnly: !!process.env.CI,
  
  // Retry on CI only
  retries: process.env.CI ? 2 : 0,
  
  // Opt out of parallel tests on CI
  workers: process.env.CI ? 1 : undefined,
  
  // Reporter to use
  reporter: [
    // Explicitly set output folder for HTML report to avoid conflicts or assumptions
    ['html', { open: 'never', outputFolder: '/app/html-report' }],

    ['json', { outputFile: '/app/test-results/ui-test-results.json' }],
    ['list']
  ],
  
  // Shared settings for all the projects below
  use: {
    // Base URL to use in actions like `await page.goto('/')`
    baseURL: process.env.ADMIN_UI_URL || 'http://localhost:3000',
    
    // Collect trace when retrying the failed test
    trace: 'retain-on-failure',
    
    // Screenshot on failure
    screenshot: 'only-on-failure',
    
    // Video on failure
    video: 'retain-on-failure',
    
  },

  // Configure projects for major browsers
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },

    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },

    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },

    // Test against mobile viewports
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'Mobile Safari',
      use: { ...devices['iPhone 12'] },
    },
  ],

  // Run your local dev server before starting the tests
  webServer: process.env.CI ? undefined : {
    command: 'npm start',
    url: process.env.ADMIN_UI_URL || 'http://localhost:3000', // URL to poll


    timeout: 120 * 1000,
    reuseExistingServer: true, // Always try to reuse
  },
});