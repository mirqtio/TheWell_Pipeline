/**
 * Setup Services for Tests
 * 
 * Configures the service container for test environment
 */

const { serviceContainer } = require('../../src/services');

// Clear any existing services before each test
beforeEach(() => {
  serviceContainer.clear();
});

// Cleanup after all tests
afterAll(async () => {
  await serviceContainer.shutdownAll();
});

// Export for use in specific tests
module.exports = {
  serviceContainer
};