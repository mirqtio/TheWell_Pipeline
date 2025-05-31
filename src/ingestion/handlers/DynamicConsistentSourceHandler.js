const axios = require('axios');
const crypto = require('crypto');
const { BaseSourceHandler, SOURCE_TYPES, VISIBILITY_LEVELS } = require('../types');

/**
 * Dynamic Consistent Source Handler
 * Handles daily batch processing of consistent data sources
 * Examples: RSS feeds, API endpoints with regular updates, news feeds
 */
class DynamicConsistentSourceHandler extends BaseSourceHandler {
  constructor(config) {
    super(config);
    this.httpClient = null;
    this.lastSyncTime = null;
  }

  /**
   * Initialize the dynamic consistent source handler
   */
  async initialize() {
    this.logger?.info('Initializing DynamicConsistentSourceHandler', { sourceId: this.config.id });
    
    // Validate required configuration
    if (!this.config.config?.apiEndpoint && !this.config.config?.feedUrl) {
      throw new Error('DynamicConsistentSourceHandler requires either apiEndpoint or feedUrl');
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

    // Load last sync time from storage (would be persisted in production)
    this.lastSyncTime = this.config.config.lastSyncTime ? 
      new Date(this.config.config.lastSyncTime) : 
      new Date(Date.now() - 24 * 60 * 60 * 1000); // Default to 24 hours ago

    this.logger?.info('DynamicConsistentSourceHandler initialized successfully', {
      lastSyncTime: this.lastSyncTime
    });
  }

  /**
   * Validate dynamic consistent source configuration
   */
  async validateConfig(config) {
    // Must have either API endpoint or feed URL
    if (!config.config?.apiEndpoint && !config.config?.feedUrl) {
      throw new Error('Must specify either apiEndpoint or feedUrl');
    }

    // Validate batch size if specified
    if (config.config.batchSize && (config.config.batchSize < 1 || config.config.batchSize > 1000)) {
      throw new Error('batchSize must be between 1 and 1000');
    }

    return true;
  }

  /**
   * Discover new or updated documents since last sync
   */
  async discover() {
    this.logger?.info('Starting discovery for dynamic consistent source', { 
      sourceId: this.config.id,
      lastSyncTime: this.lastSyncTime 
    });

    const documents = [];
    
    try {
      if (this.config.config.feedUrl) {
        // Handle RSS/Atom feeds
        const feedDocuments = await this._discoverFromFeed();
        documents.push(...feedDocuments);
      } else if (this.config.config.apiEndpoint) {
        // Handle API endpoints
        const apiDocuments = await this._discoverFromApi();
        documents.push(...apiDocuments);
      }

      // Filter documents updated since last sync
      const newDocuments = documents.filter(doc => 
        !doc.lastModified || doc.lastModified > this.lastSyncTime
      );

      this.logger?.info('Discovery completed', { 
        sourceId: this.config.id,
        totalFound: documents.length,
        newDocuments: newDocuments.length 
      });

      return newDocuments;
    } catch (error) {
      this.logger?.error('Discovery failed', { 
        sourceId: this.config.id,
        error: error.message 
      });
      throw error;
    }
  }

  /**
   * Extract content from a dynamic document
   */
  async extract(document) {
    this.logger?.info('Extracting content from document', { 
      documentId: document.id,
      url: document.url || document.link 
    });

    try {
      let content;
      let metadata = { ...document.metadata };

      if (document.type === 'feed-item') {
        // For feed items, content might already be in the document
        content = document.content || document.description || document.summary;
        
        // If content is truncated, fetch full content from link
        if (document.link && (!content || content.length < 500)) {
          const fullContent = await this._fetchFullContent(document.link);
          if (fullContent) {
            content = fullContent;
            metadata.extractionMethod = 'full-content-fetch';
          }
        } else {
          metadata.extractionMethod = 'feed-content';
        }
      } else {
        // For API documents, fetch content from URL
        content = await this._fetchFullContent(document.url);
        metadata.extractionMethod = 'api-fetch';
      }

      const contentHash = crypto.createHash('sha256').update(content || '').digest('hex');

      return {
        id: document.id,
        content: content || '',
        contentHash,
        extractedAt: new Date(),
        metadata: {
          ...metadata,
          originalLength: content?.length || 0
        }
      };
    } catch (error) {
      this.logger?.error('Content extraction failed', { 
        documentId: document.id,
        error: error.message 
      });
      throw error;
    }
  }

  /**
   * Transform extracted content to standard format
   */
  async transform(extractedContent) {
    this.logger?.debug('Transforming content', { 
      documentId: extractedContent.id 
    });

    const content = this._cleanContent(extractedContent.content);
    const title = this._extractTitle(extractedContent);

    const transformed = {
      id: extractedContent.id,
      title,
      content,
      contentHash: extractedContent.contentHash,
      metadata: {
        ...extractedContent.metadata,
        transformedAt: new Date(),
        wordCount: this._countWords(content),
        characterCount: content.length,
        publishedDate: extractedContent.metadata.publishedDate,
        author: extractedContent.metadata.author,
        categories: extractedContent.metadata.categories || []
      }
    };

    return transformed;
  }

  /**
   * Discover documents from RSS/Atom feed
   */
  async _discoverFromFeed() {
    const feedUrl = this.config.config.feedUrl;
    this.logger?.debug('Discovering from feed', { feedUrl });

    try {
      const response = await this.httpClient.get(feedUrl, {
        headers: { 'Accept': 'application/rss+xml,application/atom+xml,application/xml,text/xml' }
      });

      const feedData = response.data;
      const documents = this._parseFeed(feedData);

      return documents.map(item => ({
        id: this._generateDocumentId(item.link || item.guid),
        title: item.title,
        link: item.link,
        description: item.description,
        content: item.content,
        publishedDate: item.publishedDate,
        lastModified: item.publishedDate,
        type: 'feed-item',
        metadata: {
          sourceId: this.config.id,
          sourceType: SOURCE_TYPES.DYNAMIC_CONSISTENT,
          originalUrl: item.link,
          feedUrl: feedUrl,
          visibility: this.config.visibility || VISIBILITY_LEVELS.EXTERNAL,
          author: item.author,
          categories: item.categories,
          guid: item.guid
        }
      }));
    } catch (error) {
      this.logger?.error('Feed discovery failed', { feedUrl, error: error.message });
      throw error;
    }
  }

  /**
   * Discover documents from API endpoint
   */
  async _discoverFromApi() {
    const apiEndpoint = this.config.config.apiEndpoint;
    const batchSize = this.config.config.batchSize || 100;
    
    this.logger?.debug('Discovering from API', { apiEndpoint, batchSize });

    try {
      const params = {
        limit: batchSize,
        since: this.lastSyncTime.toISOString(),
        ...this.config.config.apiParams
      };

      const response = await this.httpClient.get(apiEndpoint, { params });
      const data = response.data;

      // Handle different API response formats
      const items = Array.isArray(data) ? data : 
                   data.items || data.results || data.data || [];

      return items.map(item => ({
        id: this._generateDocumentId(item.id || item.url || item.link),
        title: item.title || item.name,
        url: item.url || item.link,
        content: item.content || item.body || item.description,
        publishedDate: new Date(item.published_at || item.created_at || item.date),
        lastModified: new Date(item.updated_at || item.modified_at || item.published_at || item.created_at),
        type: 'api-item',
        metadata: {
          sourceId: this.config.id,
          sourceType: SOURCE_TYPES.DYNAMIC_CONSISTENT,
          originalUrl: item.url || item.link,
          apiEndpoint: apiEndpoint,
          visibility: this.config.visibility || VISIBILITY_LEVELS.EXTERNAL,
          author: item.author || item.creator,
          categories: item.tags || item.categories || [],
          apiId: item.id
        }
      }));
    } catch (error) {
      this.logger?.error('API discovery failed', { apiEndpoint, error: error.message });
      throw error;
    }
  }

  /**
   * Parse RSS/Atom feed content
   */
  _parseFeed(feedData) {
    // Basic feed parsing - would use a proper XML parser like xml2js in production
    const items = [];
    
    // This is a simplified parser for demonstration
    // In production, use a proper RSS/Atom parser
    const itemMatches = feedData.match(/<item[^>]*>[\s\S]*?<\/item>/gi) || 
                       feedData.match(/<entry[^>]*>[\s\S]*?<\/entry>/gi) || [];

    for (const itemXml of itemMatches) {
      try {
        const item = {
          title: this._extractXmlValue(itemXml, 'title'),
          link: this._extractXmlValue(itemXml, 'link'),
          description: this._extractXmlValue(itemXml, 'description') || 
                      this._extractXmlValue(itemXml, 'summary'),
          content: this._extractXmlValue(itemXml, 'content:encoded') || 
                  this._extractXmlValue(itemXml, 'content'),
          author: this._extractXmlValue(itemXml, 'author') || 
                 this._extractXmlValue(itemXml, 'dc:creator'),
          publishedDate: new Date(this._extractXmlValue(itemXml, 'pubDate') || 
                                 this._extractXmlValue(itemXml, 'published') ||
                                 this._extractXmlValue(itemXml, 'updated')),
          guid: this._extractXmlValue(itemXml, 'guid'),
          categories: this._extractXmlCategories(itemXml)
        };

        items.push(item);
      } catch (error) {
        this.logger?.warn('Error parsing feed item', { error: error.message });
      }
    }

    return items;
  }

  /**
   * Extract value from XML element
   */
  _extractXmlValue(xml, tagName) {
    const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
    const match = xml.match(regex);
    return match ? match[1].trim() : null;
  }

  /**
   * Extract categories from XML
   */
  _extractXmlCategories(xml) {
    const categoryMatches = xml.match(/<category[^>]*>([^<]*)<\/category>/gi) || [];
    return categoryMatches.map(match => {
      const valueMatch = match.match(/>([^<]*)</);
      return valueMatch ? valueMatch[1].trim() : '';
    }).filter(Boolean);
  }

  /**
   * Fetch full content from URL
   */
  async _fetchFullContent(url) {
    try {
      const response = await this.httpClient.get(url, {
        headers: { 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' }
      });

      const content = response.data;
      
      // Basic HTML content extraction
      if (typeof content === 'string' && content.includes('<html')) {
        return this._extractTextFromHtml(content);
      }
      
      return content;
    } catch (error) {
      this.logger?.warn('Failed to fetch full content', { url, error: error.message });
      return null;
    }
  }

  /**
   * Extract text content from HTML
   */
  _extractTextFromHtml(html) {
    return html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '') // Remove scripts
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '') // Remove styles
      .replace(/<[^>]+>/g, ' ') // Remove HTML tags
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
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
   * Generate unique document ID
   */
  _generateDocumentId(identifier) {
    return crypto.createHash('md5').update(identifier || '').digest('hex');
  }

  /**
   * Extract title from content
   */
  _extractTitle(extractedContent) {
    return extractedContent.metadata.title || 
           extractedContent.metadata.originalUrl || 
           `Document ${extractedContent.id}`;
  }

  /**
   * Clean and normalize content
   */
  _cleanContent(content) {
    if (!content) return '';
    
    return content
      .replace(/\r\n/g, '\n') // Normalize line endings
      .replace(/\n{3,}/g, '\n\n') // Remove excessive newlines
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
  }

  /**
   * Count words in content
   */
  _countWords(content) {
    return content.split(/\s+/).filter(word => word.length > 0).length;
  }

  /**
   * Update last sync time
   */
  updateLastSyncTime(timestamp = new Date()) {
    this.lastSyncTime = timestamp;
    // In production, this would be persisted to storage
    this.logger?.info('Updated last sync time', { 
      sourceId: this.config.id,
      lastSyncTime: this.lastSyncTime 
    });
  }

  /**
   * Clean up resources
   */
  async cleanup() {
    this.logger?.info('Cleaning up DynamicConsistentSourceHandler', { sourceId: this.config.id });
    // No specific cleanup needed for HTTP client
  }
}

module.exports = DynamicConsistentSourceHandler;
