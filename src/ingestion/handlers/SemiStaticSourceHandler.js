const crypto = require('crypto');
const axios = require('axios');
const { BaseSourceHandler, SOURCE_TYPES, VISIBILITY_LEVELS } = require('../types');

/**
 * Semi-Static Source Handler
 * Handles weekly polling of platform policies and semi-static content
 * Examples: Terms of Service, Privacy Policies, API documentation
 */
class SemiStaticSourceHandler extends BaseSourceHandler {
  constructor(config) {
    super(config);
    this.httpClient = null;
    this.lastPollTime = null;
  }

  /**
   * Initialize the semi-static source handler
   */
  async initialize() {
    this.logger?.info('Initializing SemiStaticSourceHandler', { sourceId: this.config.id });
    
    // Validate required configuration
    if (!this.config.config?.endpoints || !Array.isArray(this.config.config.endpoints)) {
      throw new Error('SemiStaticSourceHandler requires config.endpoints array');
    }

    // Initialize HTTP client with default settings
    this.httpClient = axios.create({
      timeout: this.config.config.timeout || 30000,
      headers: {
        'User-Agent': 'TheWell-Pipeline/1.0',
        ...this.config.config.headers
      }
    });

    // Add authentication if configured
    if (this.config.authentication) {
      this._configureAuthentication();
    }

    this.logger?.info('SemiStaticSourceHandler initialized successfully');
  }

  /**
   * Validate semi-static source configuration
   */
  async validateConfig(config) {
    const required = ['endpoints'];
    const missing = required.filter(field => !config.config?.[field]);
    
    if (missing.length > 0) {
      throw new Error(`Missing required config fields: ${missing.join(', ')}`);
    }

    // Validate endpoints array
    if (!Array.isArray(config.config.endpoints) || config.config.endpoints.length === 0) {
      throw new Error('endpoints must be a non-empty array');
    }

    // Validate each endpoint
    for (const endpoint of config.config.endpoints) {
      if (!endpoint.url || !endpoint.name) {
        throw new Error('Each endpoint must have url and name properties');
      }
    }

    return true;
  }

  /**
   * Discover documents from configured endpoints
   */
  async discover() {
    this.logger?.info('Starting discovery for semi-static source', { 
      sourceId: this.config.id,
      endpointCount: this.config.config.endpoints.length 
    });

    const documents = [];
    const endpoints = this.config.config.endpoints;

    for (const endpoint of endpoints) {
      try {
        this.logger?.debug('Discovering endpoint', { 
          sourceId: this.config.id,
          endpoint: endpoint.name,
          url: endpoint.url 
        });

        // Check if endpoint has changed since last poll
        const lastModified = await this._checkLastModified(endpoint);
        
        const document = {
          id: this._generateDocumentId(endpoint.url),
          url: endpoint.url,
          name: endpoint.name,
          type: endpoint.type || 'webpage',
          lastModified,
          contentType: endpoint.contentType || 'text/html',
          metadata: {
            sourceId: this.config.id,
            sourceType: SOURCE_TYPES.SEMI_STATIC,
            originalUrl: endpoint.url,
            endpointName: endpoint.name,
            visibility: endpoint.visibility || this.config.visibility || VISIBILITY_LEVELS.EXTERNAL,
            pollFrequency: this.config.config.pollFrequency || 'weekly',
            tags: endpoint.tags || [],
            customMetadata: endpoint.metadata || {}
          }
        };

        documents.push(document);
      } catch (error) {
        this.logger?.warn('Error discovering endpoint', { 
          sourceId: this.config.id,
          endpoint: endpoint.name,
          error: error.message 
        });
      }
    }

    this.logger?.info('Discovery completed', { 
      sourceId: this.config.id,
      documentsFound: documents.length 
    });

    return documents;
  }

  /**
   * Extract content from a semi-static endpoint
   */
  async extract(document) {
    this.logger?.info('Extracting content from document', { 
      documentId: document.id,
      url: document.url 
    });

    try {
      const response = await this.httpClient.get(document.url, {
        headers: {
          'Accept': this._getAcceptHeader(document.contentType),
          'If-Modified-Since': document.lastModified ? document.lastModified.toUTCString() : undefined
        }
      });

      // Handle 304 Not Modified
      if (response.status === 304) {
        this.logger?.info('Content not modified since last fetch', { 
          documentId: document.id 
        });
        return null;
      }

      const content = response.data;
      const contentHash = crypto.createHash('sha256').update(JSON.stringify(content)).digest('hex');

      return {
        id: document.id,
        content,
        contentHash,
        extractedAt: new Date(),
        httpStatus: response.status,
        headers: response.headers,
        metadata: {
          ...document.metadata,
          extractionMethod: 'http-request',
          responseHeaders: this._sanitizeHeaders(response.headers),
          contentLength: response.headers['content-length'],
          lastModified: response.headers['last-modified'],
          etag: response.headers.etag
        }
      };
    } catch (error) {
      if (error.response?.status === 404) {
        this.logger?.warn('Document not found', { 
          documentId: document.id,
          url: document.url 
        });
        return null;
      }

      this.logger?.error('Content extraction failed', { 
        documentId: document.id,
        url: document.url,
        error: error.message,
        status: error.response?.status 
      });
      throw error;
    }
  }

  /**
   * Transform extracted content to standard format
   */
  async transform(extractedContent) {
    if (!extractedContent) {
      return null; // Content not modified
    }

    this.logger?.debug('Transforming content', { 
      documentId: extractedContent.id 
    });

    const contentType = extractedContent.metadata.responseHeaders?.['content-type'] || '';
    let transformedContent = extractedContent.content;
    let title = extractedContent.metadata.endpointName;

    // Transform based on content type
    if (contentType.includes('text/html')) {
      const htmlTransform = this._transformHtml(extractedContent.content);
      transformedContent = htmlTransform.content;
      title = htmlTransform.title || title;
    } else if (contentType.includes('application/json')) {
      transformedContent = this._transformJson(extractedContent.content);
    } else if (contentType.includes('text/plain')) {
      transformedContent = this._transformPlainText(extractedContent.content);
    }

    const transformed = {
      id: extractedContent.id,
      title,
      content: transformedContent,
      contentHash: extractedContent.contentHash,
      metadata: {
        ...extractedContent.metadata,
        transformedAt: new Date(),
        wordCount: this._countWords(transformedContent),
        characterCount: transformedContent.length,
        contentType: contentType.split(';')[0] // Remove charset info
      }
    };

    return transformed;
  }

  /**
   * Configure authentication for HTTP requests
   */
  _configureAuthentication() {
    const auth = this.config.authentication;
    
    if (auth.type === 'bearer') {
      this.httpClient.defaults.headers.common['Authorization'] = `Bearer ${auth.token}`;
    } else if (auth.type === 'basic') {
      this.httpClient.defaults.auth = {
        username: auth.username,
        password: auth.password
      };
    } else if (auth.type === 'api-key') {
      this.httpClient.defaults.headers.common[auth.headerName || 'X-API-Key'] = auth.key;
    }
  }

  /**
   * Check last modified date for an endpoint
   */
  async _checkLastModified(endpoint) {
    try {
      const response = await this.httpClient.head(endpoint.url);
      const lastModified = response.headers['last-modified'];
      return lastModified ? new Date(lastModified) : new Date();
    } catch (error) {
      this.logger?.debug('Could not check last modified date', { 
        endpoint: endpoint.name,
        error: error.message 
      });
      return new Date();
    }
  }

  /**
   * Generate appropriate Accept header based on content type
   */
  _getAcceptHeader(contentType) {
    const acceptMap = {
      'text/html': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'application/json': 'application/json,*/*;q=0.8',
      'text/plain': 'text/plain,*/*;q=0.8'
    };
    
    return acceptMap[contentType] || '*/*';
  }

  /**
   * Sanitize response headers for storage
   */
  _sanitizeHeaders(headers) {
    const sanitized = {};
    const keepHeaders = ['content-type', 'content-length', 'last-modified', 'etag', 'cache-control'];
    
    for (const header of keepHeaders) {
      if (headers[header]) {
        sanitized[header] = headers[header];
      }
    }
    
    return sanitized;
  }

  /**
   * Transform HTML content
   */
  _transformHtml(html) {
    // Basic HTML parsing - would use a proper parser like cheerio in production
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : null;
    
    // Remove HTML tags and extract text content
    const content = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '') // Remove scripts
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '') // Remove styles
      .replace(/<[^>]+>/g, ' ') // Remove HTML tags
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
    
    return { title, content };
  }

  /**
   * Transform JSON content
   */
  _transformJson(json) {
    if (typeof json === 'string') {
      try {
        json = JSON.parse(json);
      } catch (error) {
        return json; // Return as-is if not valid JSON
      }
    }
    
    return JSON.stringify(json, null, 2);
  }

  /**
   * Transform plain text content
   */
  _transformPlainText(text) {
    return text
      .replace(/\r\n/g, '\n') // Normalize line endings
      .replace(/\n{3,}/g, '\n\n') // Remove excessive newlines
      .trim();
  }

  /**
   * Generate unique document ID based on URL
   */
  _generateDocumentId(url) {
    return crypto.createHash('md5').update(url).digest('hex');
  }

  /**
   * Count words in content
   */
  _countWords(content) {
    return content.split(/\s+/).filter(word => word.length > 0).length;
  }

  /**
   * Clean up resources
   */
  async cleanup() {
    this.logger?.info('Cleaning up SemiStaticSourceHandler', { sourceId: this.config.id });
    // No specific cleanup needed for HTTP client
  }
}

module.exports = SemiStaticSourceHandler;
