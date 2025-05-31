const axios = require('axios');
const crypto = require('crypto');
const { BaseSourceHandler, SOURCE_TYPES, VISIBILITY_LEVELS } = require('../types');

/**
 * Dynamic Unstructured Source Handler
 * Handles weekly discovery runs for unstructured, dynamic content
 * Examples: Web scraping, social media monitoring, forum posts, news aggregation
 */
class DynamicUnstructuredSourceHandler extends BaseSourceHandler {
  constructor(config) {
    super(config);
    this.httpClient = null;
    this.discoveredUrls = new Set();
    this.lastDiscoveryTime = null;
  }

  /**
   * Initialize the dynamic unstructured source handler
   */
  async initialize() {
    this.logger?.info('Initializing DynamicUnstructuredSourceHandler', { sourceId: this.config.id });
    
    // Validate required configuration
    if (!this.config.config?.discoveryRules || !Array.isArray(this.config.config.discoveryRules)) {
      throw new Error('DynamicUnstructuredSourceHandler requires config.discoveryRules array');
    }

    // Initialize HTTP client with default settings
    this.httpClient = axios.create({
      timeout: this.config.config.timeout || 45000,
      headers: {
        'User-Agent': this.config.config.userAgent || 'TheWell-Pipeline/1.0 (+https://thewell.ai)',
        ...this.config.config.headers
      }
    });

    // Add authentication if configured
    if (this.config.authentication) {
      this._configureAuthentication();
    }

    // Load last discovery time
    this.lastDiscoveryTime = this.config.config.lastDiscoveryTime ? 
      new Date(this.config.config.lastDiscoveryTime) : 
      new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // Default to 7 days ago

    this.logger?.info('DynamicUnstructuredSourceHandler initialized successfully', {
      discoveryRules: this.config.config.discoveryRules.length,
      lastDiscoveryTime: this.lastDiscoveryTime
    });
  }

  /**
   * Validate dynamic unstructured source configuration
   */
  async validateConfig(config) {
    const required = ['discoveryRules'];
    const missing = required.filter(field => !config.config?.[field]);
    
    if (missing.length > 0) {
      throw new Error(`Missing required config fields: ${missing.join(', ')}`);
    }

    // Validate discovery rules
    if (!Array.isArray(config.config.discoveryRules) || config.config.discoveryRules.length === 0) {
      throw new Error('discoveryRules must be a non-empty array');
    }

    for (const rule of config.config.discoveryRules) {
      if (!rule.name || !rule.type || !rule.config) {
        throw new Error('Each discovery rule must have name, type, and config properties');
      }
    }

    return true;
  }

  /**
   * Discover new documents using configured discovery rules
   */
  async discover() {
    this.logger?.info('Starting discovery for dynamic unstructured source', { 
      sourceId: this.config.id,
      rulesCount: this.config.config.discoveryRules.length 
    });

    const allDocuments = [];
    const discoveryRules = this.config.config.discoveryRules;

    for (const rule of discoveryRules) {
      try {
        this.logger?.debug('Executing discovery rule', { 
          sourceId: this.config.id,
          ruleName: rule.name,
          ruleType: rule.type 
        });

        let documents = [];
        
        switch (rule.type) {
          case 'web-crawler':
            documents = await this._discoverWebCrawl(rule);
            break;
          case 'sitemap':
            documents = await this._discoverSitemap(rule);
            break;
          case 'search-api':
            documents = await this._discoverSearchApi(rule);
            break;
          case 'social-media':
            documents = await this._discoverSocialMedia(rule);
            break;
          case 'rss-discovery':
            documents = await this._discoverRssFeeds(rule);
            break;
          default:
            this.logger?.warn('Unknown discovery rule type', { 
              ruleType: rule.type,
              ruleName: rule.name 
            });
        }

        // Add rule metadata to documents
        documents.forEach(doc => {
          doc.metadata.discoveryRule = rule.name;
          doc.metadata.discoveryType = rule.type;
        });

        allDocuments.push(...documents);
        
        this.logger?.info('Discovery rule completed', { 
          ruleName: rule.name,
          documentsFound: documents.length 
        });

        // Rate limiting between rules
        if (rule.config.rateLimitMs) {
          await this._sleep(rule.config.rateLimitMs);
        }
      } catch (error) {
        this.logger?.error('Discovery rule failed', { 
          ruleName: rule.name,
          error: error.message 
        });
      }
    }

    // Deduplicate documents by URL
    const uniqueDocuments = this._deduplicateDocuments(allDocuments);

    this.logger?.info('Discovery completed', { 
      sourceId: this.config.id,
      totalFound: allDocuments.length,
      uniqueDocuments: uniqueDocuments.length 
    });

    return uniqueDocuments;
  }

  /**
   * Extract content from a discovered document
   */
  async extract(document) {
    this.logger?.info('Extracting content from document', { 
      documentId: document.id,
      url: document.url 
    });

    try {
      const response = await this.httpClient.get(document.url, {
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9'
        }
      });

      const content = response.data;
      const contentType = response.headers['content-type'] || '';
      
      let extractedContent = content;
      let title = document.title;

      // Extract content based on type
      if (contentType.includes('text/html')) {
        const htmlExtraction = this._extractFromHtml(content);
        extractedContent = htmlExtraction.content;
        title = htmlExtraction.title || title;
      } else if (contentType.includes('application/json')) {
        extractedContent = JSON.stringify(JSON.parse(content), null, 2);
      }

      const contentHash = crypto.createHash('sha256').update(extractedContent).digest('hex');

      return {
        id: document.id,
        content: extractedContent,
        contentHash,
        extractedAt: new Date(),
        metadata: {
          ...document.metadata,
          extractionMethod: 'http-fetch',
          contentType: contentType.split(';')[0],
          responseStatus: response.status,
          contentLength: extractedContent.length,
          title: title
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
        error: error.message 
      });
      throw error;
    }
  }

  /**
   * Transform extracted content to standard format
   */
  async transform(extractedContent) {
    if (!extractedContent) {
      return null;
    }

    this.logger?.debug('Transforming content', { 
      documentId: extractedContent.id 
    });

    const content = this._cleanContent(extractedContent.content);
    const title = extractedContent.metadata.title || 
                 this._extractTitleFromContent(content) ||
                 `Document ${extractedContent.id}`;

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
        discoveredAt: new Date(),
        requiresReview: this._requiresManualReview(extractedContent)
      }
    };

    return transformed;
  }

  /**
   * Web crawler discovery
   */
  async _discoverWebCrawl(rule) {
    const { startUrls, maxDepth = 2, maxPages = 50, allowedDomains = [] } = rule.config;
    const documents = [];
    const visitedUrls = new Set();
    const urlQueue = startUrls.map(url => ({ url, depth: 0 }));

    while (urlQueue.length > 0 && documents.length < maxPages) {
      const { url, depth } = urlQueue.shift();
      
      if (visitedUrls.has(url) || depth > maxDepth) {
        continue;
      }

      try {
        visitedUrls.add(url);
        
        const response = await this.httpClient.get(url);
        const content = response.data;
        
        // Extract document info
        const document = this._createDocumentFromUrl(url, content, rule);
        documents.push(document);

        // Extract links for further crawling
        if (depth < maxDepth) {
          const links = this._extractLinksFromHtml(content, url);
          const filteredLinks = links.filter(link => 
            this._isAllowedDomain(link, allowedDomains) && !visitedUrls.has(link)
          );
          
          filteredLinks.forEach(link => {
            urlQueue.push({ url: link, depth: depth + 1 });
          });
        }

        // Rate limiting
        await this._sleep(rule.config.crawlDelayMs || 1000);
      } catch (error) {
        this.logger?.warn('Failed to crawl URL', { url, error: error.message });
      }
    }

    return documents;
  }

  /**
   * Sitemap discovery
   */
  async _discoverSitemap(rule) {
    const { sitemapUrl, maxUrls = 100 } = rule.config;
    
    try {
      const response = await this.httpClient.get(sitemapUrl);
      const sitemapContent = response.data;
      
      const urls = this._parseSitemap(sitemapContent);
      const limitedUrls = urls.slice(0, maxUrls);
      
      return limitedUrls.map(urlInfo => this._createDocumentFromUrl(urlInfo.url, null, rule, {
        lastModified: urlInfo.lastmod ? new Date(urlInfo.lastmod) : new Date(),
        priority: urlInfo.priority,
        changeFreq: urlInfo.changefreq
      }));
    } catch (error) {
      this.logger?.error('Sitemap discovery failed', { sitemapUrl, error: error.message });
      return [];
    }
  }

  /**
   * Search API discovery
   */
  async _discoverSearchApi(rule) {
    const { apiUrl, query, maxResults = 50 } = rule.config;
    
    try {
      const params = {
        q: query,
        limit: maxResults,
        ...rule.config.apiParams
      };

      const response = await this.httpClient.get(apiUrl, { params });
      const results = response.data.results || response.data.items || response.data;
      
      return results.map(result => this._createDocumentFromSearchResult(result, rule));
    } catch (error) {
      this.logger?.error('Search API discovery failed', { apiUrl, error: error.message });
      return [];
    }
  }

  /**
   * Social media discovery
   */
  async _discoverSocialMedia(rule) {
    // Placeholder for social media discovery
    // Would integrate with specific social media APIs
    this.logger?.info('Social media discovery not yet implemented', { ruleName: rule.name });
    return [];
  }

  /**
   * RSS feed discovery
   */
  async _discoverRssFeeds(rule) {
    const { seedUrls } = rule.config;
    const documents = [];
    
    for (const url of seedUrls) {
      try {
        // Look for RSS feed links on the page
        const response = await this.httpClient.get(url);
        const content = response.data;
        
        const feedUrls = this._extractFeedUrls(content, url);
        
        for (const feedUrl of feedUrls) {
          const document = this._createDocumentFromUrl(feedUrl, null, rule, {
            feedType: 'rss',
            parentUrl: url
          });
          documents.push(document);
        }
      } catch (error) {
        this.logger?.warn('RSS discovery failed for URL', { url, error: error.message });
      }
    }
    
    return documents;
  }

  /**
   * Create document object from URL
   */
  _createDocumentFromUrl(url, content, rule, additionalMetadata = {}) {
    const title = content ? this._extractTitleFromHtml(content) : this._getTitleFromUrl(url);
    
    return {
      id: this._generateDocumentId(url),
      url,
      title,
      lastModified: new Date(),
      metadata: {
        sourceId: this.config.id,
        sourceType: SOURCE_TYPES.DYNAMIC_UNSTRUCTURED,
        originalUrl: url,
        visibility: this.config.visibility || VISIBILITY_LEVELS.EXTERNAL,
        discoveredAt: new Date(),
        ...additionalMetadata
      }
    };
  }

  /**
   * Create document from search result
   */
  _createDocumentFromSearchResult(result, rule) {
    return {
      id: this._generateDocumentId(result.url || result.link),
      url: result.url || result.link,
      title: result.title || result.name,
      description: result.description || result.snippet,
      lastModified: new Date(),
      metadata: {
        sourceId: this.config.id,
        sourceType: SOURCE_TYPES.DYNAMIC_UNSTRUCTURED,
        originalUrl: result.url || result.link,
        visibility: this.config.visibility || VISIBILITY_LEVELS.EXTERNAL,
        discoveredAt: new Date(),
        searchScore: result.score,
        searchQuery: rule.config.query
      }
    };
  }

  /**
   * Extract content and title from HTML
   */
  _extractFromHtml(html) {
    const title = this._extractTitleFromHtml(html);
    const content = this._extractTextFromHtml(html);
    return { title, content };
  }

  /**
   * Extract title from HTML
   */
  _extractTitleFromHtml(html) {
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    return titleMatch ? titleMatch[1].trim() : null;
  }

  /**
   * Extract text content from HTML
   */
  _extractTextFromHtml(html) {
    return html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '') // Remove scripts
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '') // Remove styles
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '') // Remove navigation
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '') // Remove headers
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '') // Remove footers
      .replace(/<[^>]+>/g, ' ') // Remove HTML tags
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
  }

  /**
   * Extract links from HTML
   */
  _extractLinksFromHtml(html, baseUrl) {
    const linkMatches = html.match(/<a[^>]+href=["']([^"']+)["'][^>]*>/gi) || [];
    const links = linkMatches.map(match => {
      const hrefMatch = match.match(/href=["']([^"']+)["']/i);
      return hrefMatch ? hrefMatch[1] : null;
    }).filter(Boolean);

    // Convert relative URLs to absolute
    return links.map(link => {
      if (link.startsWith('http')) return link;
      if (link.startsWith('/')) return new URL(link, baseUrl).href;
      return new URL(link, baseUrl).href;
    });
  }

  /**
   * Parse sitemap XML
   */
  _parseSitemap(sitemapXml) {
    const urlMatches = sitemapXml.match(/<url[^>]*>[\s\S]*?<\/url>/gi) || [];
    
    return urlMatches.map(urlXml => {
      const loc = this._extractXmlValue(urlXml, 'loc');
      const lastmod = this._extractXmlValue(urlXml, 'lastmod');
      const priority = this._extractXmlValue(urlXml, 'priority');
      const changefreq = this._extractXmlValue(urlXml, 'changefreq');
      
      return { url: loc, lastmod, priority, changefreq };
    }).filter(item => item.url);
  }

  /**
   * Extract RSS feed URLs from HTML
   */
  _extractFeedUrls(html, baseUrl) {
    const feedLinks = [];
    const linkMatches = html.match(/<link[^>]+>/gi) || [];
    
    for (const linkTag of linkMatches) {
      const typeMatch = linkTag.match(/type=["']([^"']+)["']/i);
      const hrefMatch = linkTag.match(/href=["']([^"']+)["']/i);
      
      if (typeMatch && hrefMatch) {
        const type = typeMatch[1].toLowerCase();
        if (type.includes('rss') || type.includes('atom') || type.includes('xml')) {
          const href = hrefMatch[1];
          const absoluteUrl = href.startsWith('http') ? href : new URL(href, baseUrl).href;
          feedLinks.push(absoluteUrl);
        }
      }
    }
    
    return feedLinks;
  }

  /**
   * Helper methods
   */
  _extractXmlValue(xml, tagName) {
    const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
    const match = xml.match(regex);
    return match ? match[1].trim() : null;
  }

  _isAllowedDomain(url, allowedDomains) {
    if (allowedDomains.length === 0) return true;
    try {
      const domain = new URL(url).hostname;
      return allowedDomains.some(allowed => domain.includes(allowed));
    } catch {
      return false;
    }
  }

  _getTitleFromUrl(url) {
    try {
      const pathname = new URL(url).pathname;
      return pathname.split('/').pop() || url;
    } catch {
      return url;
    }
  }

  _extractTitleFromContent(content) {
    const lines = content.split('\n').filter(line => line.trim());
    return lines[0]?.substring(0, 100) || null;
  }

  _deduplicateDocuments(documents) {
    const seen = new Set();
    return documents.filter(doc => {
      const key = doc.url || doc.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  _requiresManualReview(extractedContent) {
    // Simple heuristics for manual review requirement
    const content = extractedContent.content;
    const contentLength = content.length;
    
    // Require review for very short or very long content
    if (contentLength < 100 || contentLength > 50000) return true;
    
    // Require review for content with suspicious patterns
    const suspiciousPatterns = [
      /error|404|not found/i,
      /access denied|forbidden/i,
      /javascript required/i
    ];
    
    return suspiciousPatterns.some(pattern => pattern.test(content));
  }

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

  _generateDocumentId(identifier) {
    return crypto.createHash('md5').update(identifier || '').digest('hex');
  }

  _cleanContent(content) {
    if (!content) return '';
    
    return content
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/\s+/g, ' ')
      .trim();
  }

  _countWords(content) {
    return content.split(/\s+/).filter(word => word.length > 0).length;
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Update last discovery time
   */
  updateLastDiscoveryTime(timestamp = new Date()) {
    this.lastDiscoveryTime = timestamp;
    this.logger?.info('Updated last discovery time', { 
      sourceId: this.config.id,
      lastDiscoveryTime: this.lastDiscoveryTime 
    });
  }

  /**
   * Clean up resources
   */
  async cleanup() {
    this.logger?.info('Cleaning up DynamicUnstructuredSourceHandler', { sourceId: this.config.id });
    this.discoveredUrls.clear();
  }
}

module.exports = DynamicUnstructuredSourceHandler;
