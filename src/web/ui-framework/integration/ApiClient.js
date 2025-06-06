/**
 * API Client Wrapper
 * Unified API client with error handling and interceptors
 */

class ApiClient {
  constructor(baseURL = '/api', options = {}) {
    this.baseURL = baseURL;
    this.defaultHeaders = {
      'Content-Type': 'application/json',
      ...options.headers,
    };
    this.interceptors = {
      request: [],
      response: [],
      error: [],
    };
    this.timeout = options.timeout || 30000;
  }

  // Add request interceptor
  addRequestInterceptor(interceptor) {
    this.interceptors.request.push(interceptor);
    return () => {
      const index = this.interceptors.request.indexOf(interceptor);
      if (index >= 0) {
        this.interceptors.request.splice(index, 1);
      }
    };
  }

  // Add response interceptor
  addResponseInterceptor(interceptor) {
    this.interceptors.response.push(interceptor);
    return () => {
      const index = this.interceptors.response.indexOf(interceptor);
      if (index >= 0) {
        this.interceptors.response.splice(index, 1);
      }
    };
  }

  // Add error interceptor
  addErrorInterceptor(interceptor) {
    this.interceptors.error.push(interceptor);
    return () => {
      const index = this.interceptors.error.indexOf(interceptor);
      if (index >= 0) {
        this.interceptors.error.splice(index, 1);
      }
    };
  }

  // Build full URL
  buildURL(endpoint, params) {
    const url = new URL(
      endpoint.startsWith('http') ? endpoint : `${this.baseURL}${endpoint}`,
      window.location.origin
    );

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          url.searchParams.append(key, value);
        }
      });
    }

    return url.toString();
  }

  // Make request
  async request(method, endpoint, options = {}) {
    const {
      params,
      data,
      headers = {},
      timeout = this.timeout,
      signal,
      ...otherOptions
    } = options;

    // Create abort controller for timeout
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), timeout);

    try {
      // Build request config
      let config = {
        method,
        headers: { ...this.defaultHeaders, ...headers },
        signal: signal || abortController.signal,
        ...otherOptions,
      };

      // Add body for non-GET requests
      if (data && method !== 'GET') {
        config.body = JSON.stringify(data);
      }

      // Apply request interceptors
      for (const interceptor of this.interceptors.request) {
        config = await interceptor(config);
      }

      // Make request
      const url = this.buildURL(endpoint, params);
      let response = await fetch(url, config);

      // Clear timeout
      clearTimeout(timeoutId);

      // Parse response
      const contentType = response.headers.get('content-type');
      let responseData;

      if (contentType?.includes('application/json')) {
        responseData = await response.json();
      } else if (contentType?.includes('text/')) {
        responseData = await response.text();
      } else {
        responseData = await response.blob();
      }

      // Create response object
      const result = {
        data: responseData,
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        ok: response.ok,
      };

      // Apply response interceptors
      for (const interceptor of this.interceptors.response) {
        await interceptor(result);
      }

      // Handle HTTP errors
      if (!response.ok) {
        const error = new Error(responseData?.message || response.statusText);
        error.response = result;
        throw error;
      }

      return result;
    } catch (error) {
      clearTimeout(timeoutId);

      // Handle timeout
      if (error.name === 'AbortError') {
        error.message = 'Request timeout';
        error.code = 'TIMEOUT';
      }

      // Apply error interceptors
      for (const interceptor of this.interceptors.error) {
        await interceptor(error);
      }

      throw error;
    }
  }

  // HTTP methods
  get(endpoint, options) {
    return this.request('GET', endpoint, options);
  }

  post(endpoint, data, options) {
    return this.request('POST', endpoint, { ...options, data });
  }

  put(endpoint, data, options) {
    return this.request('PUT', endpoint, { ...options, data });
  }

  patch(endpoint, data, options) {
    return this.request('PATCH', endpoint, { ...options, data });
  }

  delete(endpoint, options) {
    return this.request('DELETE', endpoint, options);
  }
}

// Create default instance
export const apiClient = new ApiClient();

// Export class for custom instances
export default ApiClient;