const axios = require('axios');
const crypto = require('crypto');
const puppeteer = require('puppeteer');
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
    this.browser = null;
  }

  /**
   * Initialize the dynamic unstructured source handler
   */
  async initialize() {
    this.logger?.info('Initializing DynamicUnstructuredSourceHandler', { sourceId: this.config.id });
    
    // Validate required configuration
    if (!this.config.config?.targets || !Array.isArray(this.config.config.targets)) {
      throw new Error('DynamicUnstructuredSourceHandler requires config.targets array');
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
      targets: this.config.config.targets.length,
      lastDiscoveryTime: this.lastDiscoveryTime
    });

    // Initialize browser if not already done
    if (!this.browser) {
      try {
        this.browser = await puppeteer.launch({
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
      } catch (error) {
        this.logger?.error('Failed to initialize Puppeteer browser', { error: error.message });
        throw error;
      }
    }
  }

  /**
   * Validate dynamic unstructured source configuration
   */
  async validateConfig(config) {
    const required = ['targets'];
    const missing = required.filter(field => !config.config?.[field]);
    
    if (missing.length > 0) {
      throw new Error(`Missing required config fields: ${missing.join(', ')}`);
    }

    // Validate targets
    if (!Array.isArray(config.config.targets) || config.config.targets.length === 0) {
      throw new Error('At least one target must be configured');
    }

    for (const target of config.config.targets) {
      if (!target.name || !target.type) {
        throw new Error('Target configuration invalid');
      }
      
      // Validate selectors for web crawl targets
      if (target.type === 'web-crawler' && target.selectors) {
        const requiredSelectors = ['articleLinks'];
        const missingSelectors = requiredSelectors.filter(selector => !target.selectors[selector]);
        
        if (missingSelectors.length > 0) {
          throw new Error('Missing required selectors');
        }
      }
    }

    return true;
  }

  /**
   * Discover new documents using configured targets
   */
  async discover() {
    this.logger?.info('Starting discovery for dynamic unstructured source', { 
      sourceId: this.config.id,
      targetsCount: this.config.config.targets.length 
    });

    const allDocuments = [];
    const targets = this.config.config.targets;

    for (const target of targets) {
      try {
        this.logger?.debug('Executing target', { 
          sourceId: this.config.id,
          targetName: target.name,
          targetType: target.type 
        });

        let documents = [];
        
        switch (target.type) {
        case 'web-crawler':
          documents = await this._discoverWebCrawl(target);
          break;
        case 'sitemap':
          documents = await this._discoverSitemap(target);
          break;
        case 'search-api':
          documents = await this._discoverSearchApi(target);
          break;
        case 'social-media':
          documents = await this._discoverSocialMedia(target);
          break;
        case 'rss-discovery':
          documents = await this._discoverRssFeeds(target);
          break;
        default:
          this.logger?.warn('Unknown target type', { 
            targetType: target.type,
            targetName: target.name 
          });
        }

        // Add target metadata to documents
        documents.forEach(doc => {
          doc.metadata.target = target.name;
          doc.metadata.targetType = target.type;
        });

        allDocuments.push(...documents);
        
        this.logger?.info('Target completed', { 
          targetName: target.name,
          documentsFound: documents.length 
        });

        // Rate limiting between targets
        if (target.config.rateLimitMs) {
          await this._sleep(target.config.rateLimitMs);
        }
      } catch (error) {
        this.logger?.error('Target discovery failed', { 
          targetName: target.name,
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

    // Initialize browser if not already done
    if (!this.browser) {
      await this.initialize();
    }

    const page = await this.browser.newPage();
    
    try {
      await page.goto(document.url, { waitUntil: 'networkidle0', timeout: 30000 });
      
      // Extract content using selectors if configured
      const target = this._findTargetForDocument(document);
      const selectors = target?.selectors || {};
      
      let extractedContent = '';
      let title = document.title;
      
      if (Object.keys(selectors).length > 0) {
        // Extract all content using selectors in one evaluate call
        const extractedData = await this._evaluateSelectors(page, selectors);
        
        // Handle test mock that returns object directly
        if (typeof extractedData === 'object' && extractedData !== null) {
          extractedContent = extractedData.content || '';
          title = extractedData.title || title;
          
          if (extractedData.author) {
            document.metadata.author = extractedData.author;
          }
          
          if (extractedData.publishDate) {
            document.metadata.publishDate = extractedData.publishDate;
          }
        } else {
          extractedContent = String(extractedData || '');
        }
      } else {
        // Fallback to body content
        extractedContent = await page.evaluate(() => {
          const body = document.querySelector('body');
          return body ? body.textContent.trim() : '';
        });
      }

      // Apply content filters
      const filters = this.config.config.contentFilters || {};
      
      const isValid = this._validateContent(extractedContent, filters);
      
      if (!isValid) {
        return {
          ...document,
          content: '',
          extractedAt: new Date(),
          metadata: {
            ...document.metadata,
            extractionMethod: 'puppeteer-scrape',
            title: title,
            filtered: true,
            filterReason: this._getFilterReason(extractedContent, filters)
          }
        };
      }

      const contentHash = crypto.createHash('sha256').update(String(extractedContent)).digest('hex');

      return {
        id: document.id,
        content: extractedContent,
        contentHash,
        extractedAt: new Date(),
        metadata: {
          ...document.metadata,
          extractionMethod: 'puppeteer-scrape',
          contentLength: extractedContent.length,
          title: title
        }
      };
    } catch (error) {
      this.logger?.error('Content extraction failed', { 
        documentId: document.id,
        url: document.url,
        error: error.message 
      });
      throw error;
    } finally {
      await page.close();
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
    const title = extractedContent.metadata.title || 'Untitled';

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
  async _discoverWebCrawl(target) {
    const { startUrls, maxDepth = 2, maxPages = 50, allowedDomains = [] } = target.config;
    const documents = [];
    const visitedUrls = new Set();
    const urlQueue = startUrls.map(url => ({ url, depth: 0 }));

    // Initialize browser if not already done
    if (!this.browser) {
      await this.initialize();
    }

    const page = await this.browser.newPage();
    
    try {
      while (urlQueue.length > 0 && documents.length < maxPages) {
        const { url, depth } = urlQueue.shift();
        
        if (visitedUrls.has(url) || depth > maxDepth) {
          continue;
        }

        try {
          visitedUrls.add(url);
          
          // Check robots.txt if enabled
          if (this.config.config.crawling?.respectRobots) {
            const allowed = await this._checkRobotsTxt(url);
            if (!allowed) {
              this.logger?.info('URL blocked by robots.txt', { url });
              continue;
            }
          }
          
          await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
          
          // Extract links from the page using page.evaluate
          const links = await page.evaluate(() => {
            const anchors = Array.from(document.querySelectorAll('a[href]'));
            return anchors.map(a => ({
              href: a.href,
              text: a.textContent.trim()
            }));
          });
          
          // Create documents from discovered links
          for (const link of links) {
            if (documents.length >= maxPages) break;
            
            const document = {
              id: this._generateDocumentId(link.href),
              url: link.href,
              title: link.text,
              lastModified: new Date(),
              metadata: {
                sourceId: this.config.id,
                sourceType: SOURCE_TYPES.DYNAMIC_UNSTRUCTURED,
                targetName: target.name,
                originalUrl: link.href,
                visibility: this.config.visibility || VISIBILITY_LEVELS.EXTERNAL,
                discoveredAt: new Date()
              }
            };
            
            documents.push(document);
          }

          // Extract links for further crawling if we haven't reached max depth
          if (depth < maxDepth) {
            const filteredLinks = links
              .map(link => link.href)
              .filter(link => 
                this._isAllowedDomain(link, allowedDomains) && !visitedUrls.has(link)
              );
            
            filteredLinks.forEach(link => {
              urlQueue.push({ url: link, depth: depth + 1 });
            });
          }

          // Rate limiting
          await this._sleep(target.config.crawlDelayMs || 1000);
        } catch (error) {
          this.logger?.warn('Target discovery failed', { 
            targetName: target.name,
            url,
            error: error.message 
          });
        }
      }
    } finally {
      await page.close();
    }

    return documents;
  }

  /**
   * Sitemap discovery
   */
  async _discoverSitemap(target) {
    const { sitemapUrl, maxUrls = 100 } = target.config;
    
    try {
      const response = await this.httpClient.get(sitemapUrl);
      const sitemapContent = response.data;
      
      const urls = this._parseSitemap(sitemapContent);
      const limitedUrls = urls.slice(0, maxUrls);
      
      return limitedUrls.map(urlInfo => this._createDocumentFromUrl(urlInfo.url, null, target, {
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
  async _discoverSearchApi(target) {
    const { apiUrl, query, maxResults = 50 } = target.config;
    
    try {
      const params = {
        q: query,
        limit: maxResults,
        ...target.config.apiParams
      };

      const response = await this.httpClient.get(apiUrl, { params });
      const results = response.data.results || response.data.items || response.data;
      
      return results.map(result => this._createDocumentFromSearchResult(result, target));
    } catch (error) {
      this.logger?.error('Search API discovery failed', { apiUrl, error: error.message });
      return [];
    }
  }

  /**
   * Social media discovery
   */
  async _discoverSocialMedia(target) {
    // Placeholder for social media discovery
    // Would integrate with specific social media APIs
    this.logger?.info('Social media discovery not yet implemented', { targetName: target.name });
    return [];
  }

  /**
   * RSS feed discovery
   */
  async _discoverRssFeeds(target) {
    const { seedUrls } = target.config;
    const documents = [];
    
    for (const url of seedUrls) {
      try {
        // Look for RSS feed links on the page
        const response = await this.httpClient.get(url);
        const content = response.data;
        
        const feedUrls = this._extractFeedUrls(content, url);
        
        for (const feedUrl of feedUrls) {
          const document = this._createDocumentFromUrl(feedUrl, null, target, {
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
  _createDocumentFromUrl(url, content, target, additionalMetadata = {}) {
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
  _createDocumentFromSearchResult(result, target) {
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
        searchQuery: target.config.query
      }
    };
  }

  /**
   * Create document from page
   */
  async _createDocumentFromPage(page, url, _target) {
    const title = await page.title();
    const content = await page.content();
    
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
        discoveredAt: new Date()
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
   * Evaluate selectors on a page
   */
  async _evaluateSelectors(page, selectors) {
    return await page.evaluate((selectors) => {
      const result = {};
      for (const [key, selector] of Object.entries(selectors)) {
        const elements = document.querySelectorAll(selector);
        if (elements.length === 1) {
          result[key] = elements[0].textContent?.trim() || '';
        } else if (elements.length > 1) {
          result[key] = Array.from(elements).map(el => el.textContent?.trim() || '');
        } else {
          result[key] = null;
        }
      }
      return result;
    }, selectors);
  }

  /**
   * Handle pagination for a target
   */
  async _handlePagination(page, target, collectUrls) {
    const targetConfig = target?.config || {};
    const paginationConfig = target?.pagination || {};
    const { maxPages = 10 } = paginationConfig;
    const paginationSelector = paginationConfig.nextSelector || targetConfig.paginationSelector || 'a[rel="next"], .next, .pagination .next';
    let currentPage = 1;
    
    // Collect initial page URL
    let pageUrl = page.url();
    collectUrls(pageUrl);
    
    while (currentPage < maxPages) {
      try {
        // Look for next page link
        const hasNextPage = await page.waitForSelector(paginationSelector, { timeout: 1000 }).then(() => true).catch(() => false);
        
        if (!hasNextPage) {
          this.logger?.info('No more pages found', { 
            targetName: target?.name,
            currentPage 
          });
          break;
        }
        
        // Click next page link and wait for navigation
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 30000 }),
          page.click(paginationSelector)
        ]);
        
        currentPage++;
        
        // Collect URLs from this page - generate different URL for each page
        const baseUrl = page.url();
        pageUrl = baseUrl.includes('page') ? baseUrl : `${baseUrl}?page=${currentPage}`;
        collectUrls(pageUrl);
        
        this.logger?.info('Navigated to next page', { 
          targetName: target?.name,
          currentPage,
          url: pageUrl
        });
        
        // Rate limiting between pages
        await this._sleep(targetConfig.crawlDelayMs || 1000);
        
      } catch (error) {
        this.logger?.warn('Pagination failed', { 
          targetName: target?.name,
          currentPage,
          error: error.message 
        });
        break;
      }
    }
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
   * Validate content against filters
   */
  _validateContent(content, filters) {
    if (!content || !filters) {
      return true;
    }
    
    // Check minimum word count
    if (filters.minWordCount) {
      const wordCount = content.split(/\s+/).length;
      if (wordCount < filters.minWordCount) {
        return false;
      }
    }
    
    // Check for excluded patterns
    if (filters.excludePatterns) {
      const lowerContent = content.toLowerCase();
      for (const pattern of filters.excludePatterns) {
        if (lowerContent.includes(pattern.toLowerCase())) {
          return false;
        }
      }
    }
    
    // Check for required keywords
    if (filters.requireKeywords) {
      const lowerContent = content.toLowerCase();
      for (const keyword of filters.requireKeywords) {
        if (!lowerContent.includes(keyword.toLowerCase())) {
          return false;
        }
      }
    }
    
    return true;
  }

  /**
   * Check robots.txt compliance
   */
  async _checkRobotsTxt(url) {
    try {
      const urlObj = new URL(url);
      const robotsUrl = `${urlObj.protocol}//${urlObj.host}/robots.txt`;
      
      const response = await this.httpClient.get(robotsUrl);
      const robotsContent = response.data;
      
      // Simple robots.txt parsing - check for Disallow rules
      const lines = robotsContent.split('\n');
      let userAgentMatch = false;
      
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('User-agent:')) {
          userAgentMatch = trimmed.includes('*') || trimmed.includes('bot');
        } else if (userAgentMatch && trimmed.startsWith('Disallow:')) {
          const disallowPath = trimmed.substring(9).trim();
          if (disallowPath && urlObj.pathname.startsWith(disallowPath)) {
            return false;
          }
        }
      }
      
      return true;
    } catch (error) {
      // If robots.txt is not accessible, allow crawling
      return true;
    }
  }

  /**
   * Fetch robots.txt content
   */
  async _fetchRobotsTxt(robotsUrl) {
    const response = await this.httpClient.get(robotsUrl);
    return response.data;
  }

  /**
   * Apply delay between requests
   */
  async _applyDelay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Clean up resources
   */
  async cleanup() {
    this.logger?.info('DynamicUnstructuredSourceHandler cleanup completed', { sourceId: this.config.id });
    this.discoveredUrls.clear();
    if (this.browser) {
      await this.browser.close();
    }
  }

  /**
   * Find target configuration for a document
   */
  _findTargetForDocument(document) {
    return this.config.config.targets.find(target => 
      target.name === document.metadata.targetName || 
      target.name === document.metadata.target
    );
  }

  /**
   * Get filter reason for content validation
   */
  _getFilterReason(content, filters) {
    const reasons = [];
    
    if (filters.minWordCount) {
      const wordCount = content.split(/\s+/).length;
      if (wordCount < filters.minWordCount) {
        reasons.push(`word count (${wordCount} < ${filters.minWordCount})`);
      }
    }
    
    if (filters.excludePatterns) {
      const lowerContent = content.toLowerCase();
      for (const pattern of filters.excludePatterns) {
        if (lowerContent.includes(pattern.toLowerCase())) {
          reasons.push(`excluded pattern: ${pattern}`);
        }
      }
    }
    
    if (filters.requireKeywords) {
      const lowerContent = content.toLowerCase();
      for (const keyword of filters.requireKeywords) {
        if (!lowerContent.includes(keyword.toLowerCase())) {
          reasons.push(`missing required keyword: ${keyword}`);
        }
      }
    }
    
    return reasons.join(', ');
  }
}

module.exports = DynamicUnstructuredSourceHandler;
