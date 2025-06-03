/**
 * Server test helpers for E2E testing
 */

const http = require('http');
const { spawn } = require('child_process');

/**
 * Wait for a server to become available
 * @param {string} url - Server URL to check
 * @param {number} timeout - Timeout in milliseconds
 * @param {number} interval - Check interval in milliseconds
 * @returns {Promise<boolean>} - Resolves when server is available
 */
function waitForServer(url, timeout = 30000, interval = 500) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    
    const checkServer = () => {
      const request = http.get(url + '/health', (res) => {
        if (res.statusCode === 200) {
          resolve(true);
        } else {
          scheduleNextCheck();
        }
      });
      
      request.on('error', () => {
        scheduleNextCheck();
      });
      
      request.setTimeout(1000, () => {
        request.destroy();
        scheduleNextCheck();
      });
    };
    
    const scheduleNextCheck = () => {
      if (Date.now() - startTime > timeout) {
        reject(new Error(`Server at ${url} did not become available within ${timeout}ms`));
        return;
      }
      
      setTimeout(checkServer, interval);
    };
    
    checkServer();
  });
}

/**
 * Kill a process gracefully
 * @param {ChildProcess} process - Process to kill
 * @param {number} timeout - Timeout for graceful shutdown
 * @returns {Promise<void>}
 */
function killProcess(process, timeout = 5000) {
  return new Promise((resolve) => {
    if (!process || process.killed) {
      resolve();
      return;
    }
    
    let resolved = false;
    
    const onExit = () => {
      if (!resolved) {
        resolved = true;
        resolve();
      }
    };
    
    process.on('exit', onExit);
    process.on('close', onExit);
    
    // Try graceful shutdown first
    process.kill('SIGTERM');
    
    // Force kill if graceful shutdown doesn't work
    setTimeout(() => {
      if (!resolved && !process.killed) {
        process.kill('SIGKILL');
      }
    }, timeout);
    
    // Ensure we resolve even if the process doesn't exit cleanly
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve();
      }
    }, timeout + 1000);
  });
}

/**
 * Start a test server
 * @param {string} serverPath - Path to server script
 * @param {Object} options - Server options
 * @returns {Promise<ChildProcess>} - Server process
 */
function startTestServer(serverPath, options = {}) {
  return new Promise((resolve, reject) => {
    const {
      port = 3000,
      env = {},
      timeout = 30000
    } = options;
    
    const serverEnv = {
      ...process.env,
      PORT: port,
      NODE_ENV: 'test',
      ...env
    };
    
    const serverProcess = spawn('node', [serverPath], {
      env: serverEnv,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    let resolved = false;
    
    const onError = (error) => {
      if (!resolved) {
        resolved = true;
        reject(error);
      }
    };
    
    const onExit = (code) => {
      if (!resolved) {
        resolved = true;
        reject(new Error(`Server process exited with code ${code}`));
      }
    };
    
    serverProcess.on('error', onError);
    serverProcess.on('exit', onExit);
    
    // Wait for server to be ready
    const baseUrl = `http://localhost:${port}`;
    waitForServer(baseUrl, timeout)
      .then(() => {
        if (!resolved) {
          resolved = true;
          resolve(serverProcess);
        }
      })
      .catch(onError);
  });
}

/**
 * Create a test server manager
 * @param {string} serverPath - Path to server script
 * @param {Object} options - Server options
 * @returns {Object} - Server manager with start/stop methods
 */
function createTestServerManager(serverPath, options = {}) {
  let serverProcess = null;
  let baseUrl = null;
  
  return {
    async start() {
      if (serverProcess) {
        throw new Error('Server is already running');
      }
      
      serverProcess = await startTestServer(serverPath, options);
      baseUrl = `http://localhost:${options.port || 3000}`;
      
      return { process: serverProcess, url: baseUrl };
    },
    
    async stop() {
      if (serverProcess) {
        await killProcess(serverProcess);
        serverProcess = null;
        baseUrl = null;
      }
    },
    
    getUrl() {
      return baseUrl;
    },
    
    isRunning() {
      return serverProcess && !serverProcess.killed;
    }
  };
}

/**
 * Make HTTP request with retry logic
 * @param {Function} requestFn - Function that makes the request
 * @param {Object} options - Retry options
 * @returns {Promise} - Request result
 */
function requestWithRetry(requestFn, options = {}) {
  const {
    maxRetries = 3,
    retryDelay = 1000,
    retryCondition = (error) => error.code === 'ECONNREFUSED'
  } = options;
  
  return new Promise((resolve, reject) => {
    let attempt = 0;
    
    const makeRequest = () => {
      attempt++;
      
      requestFn()
        .then(resolve)
        .catch((error) => {
          if (attempt < maxRetries && retryCondition(error)) {
            setTimeout(makeRequest, retryDelay);
          } else {
            reject(error);
          }
        });
    };
    
    makeRequest();
  });
}

module.exports = {
  waitForServer,
  killProcess,
  startTestServer,
  createTestServerManager,
  requestWithRetry
};
