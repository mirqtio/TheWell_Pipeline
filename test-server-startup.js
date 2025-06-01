/**
 * Test script to debug server startup issues
 */

const ManualReviewServer = require('./src/web/server');

async function testServerStartup() {
  console.log('Testing server startup...');
  
  try {
    // Mock dependencies
    const mockQueueManager = {
      getJobs: () => Promise.resolve({ jobs: [], pagination: { page: 1, pages: 1, total: 0, hasNext: false, hasPrev: false } }),
      getQueueStats: () => Promise.resolve({ queues: {} })
    };

    const mockIngestionEngine = {
      options: { enableVisibilityManagement: true },
      getDocuments: () => Promise.resolve({ documents: [] }),
      getDocumentVisibility: () => Promise.resolve({ visibility: 'internal' }),
      setDocumentVisibility: () => Promise.resolve({ success: true })
    };

    console.log('Creating server instance...');
    const server = new ManualReviewServer({
      queueManager: mockQueueManager,
      ingestionEngine: mockIngestionEngine,
      port: 0,
      host: 'localhost'
    });

    console.log('Starting server...');
    await server.start();
    
    const address = server.server.address();
    console.log(`Server started successfully at http://localhost:${address.port}`);
    
    console.log('Shutting down server...');
    await server.shutdown();
    console.log('Server shutdown complete');
    
  } catch (error) {
    console.error('Server startup failed:', error);
    console.error('Stack trace:', error.stack);
  }
}

testServerStartup();
