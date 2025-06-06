// const logger = require('../utils/logger');

/**
 * Entity Extractor - Extracts named entities from text using patterns and heuristics
 * Supports: persons, organizations, locations, dates, times, emails, URLs, money, phones
 */
class EntityExtractor {
  constructor(options = {}) {
    this.confidence = options.confidence || 0.7;
    this.customPatterns = new Map();
    
    // Common name prefixes/titles
    this.namePrefixes = [
      'Mr.', 'Mrs.', 'Ms.', 'Miss', 'Dr.', 'Prof.', 'Professor',
      'Sir', 'Lord', 'Lady', 'Rev.', 'Hon.', 'Capt.', 'Col.',
      'Gen.', 'Lt.', 'Sgt.', 'Officer', 'Agent'
    ];
    
    // Known organizations (can be extended)
    this.knownOrgs = [
      'Microsoft', 'Google', 'Apple', 'Amazon', 'Facebook', 'Meta',
      'IBM', 'Oracle', 'SAP', 'Salesforce', 'Adobe', 'Intel',
      'World Health Organization', 'United Nations', 'World Bank',
      'International Monetary Fund', 'European Union', 'NATO'
    ];
    
    // Common location indicators
    this.locationIndicators = [
      'in', 'at', 'from', 'to', 'near', 'around', 'between',
      'located in', 'based in', 'headquarters in'
    ];
  }
  
  /**
   * Extract all entities from text
   */
  async extractEntities(text) {
    if (!text || typeof text !== 'string') {
      return this._emptyResult();
    }
    
    const result = {
      persons: await this._extractPersons(text),
      organizations: await this._extractOrganizations(text),
      locations: await this._extractLocations(text),
      dates: await this._extractDates(text),
      times: await this._extractTimes(text),
      emails: await this._extractEmails(text),
      urls: await this._extractURLs(text),
      money: await this._extractMoney(text),
      phones: await this._extractPhones(text),
      custom: await this._extractCustom(text)
    };
    
    // Deduplicate entities
    for (const entityType in result) {
      if (entityType !== 'custom') {
        result[entityType] = this._deduplicateEntities(result[entityType]);
      }
    }
    
    return result;
  }
  
  /**
   * Extract entities from a document object
   */
  async extractFromDocument(document) {
    const textParts = [];
    
    // Combine relevant text fields
    if (document.title) textParts.push(document.title);
    if (document.content) textParts.push(document.content);
    if (document.metadata) {
      if (document.metadata.author) textParts.push(document.metadata.author);
      if (document.metadata.description) textParts.push(document.metadata.description);
    }
    
    const combinedText = textParts.join(' ');
    const entities = await this.extractEntities(combinedText);
    
    return {
      documentId: document.id,
      entities,
      extractedAt: new Date()
    };
  }
  
  /**
   * Extract person names
   */
  async _extractPersons(text) {
    const persons = [];
    
    // Pattern 1: Title + Name
    const titlePattern = new RegExp(
      `\\b(${this.namePrefixes.join('|')})\\s+([A-Z][a-z]+(?:\\s+[A-Z][a-z]+){0,2})\\b`,
      'g'
    );
    
    let match;
    while ((match = titlePattern.exec(text)) !== null) {
      persons.push({
        name: match[0],
        type: 'PERSON',
        confidence: 0.9
      });
    }
    
    // Pattern 2: Capitalized names (2-3 words)
    const namePattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\b/g;
    while ((match = namePattern.exec(text)) !== null) {
      const potentialName = match[0];
      
      // Skip if it's a known organization
      if (this.knownOrgs.some(org => potentialName.includes(org))) {
        continue;
      }
      
      // Skip if already found with title
      if (persons.some(p => p.name.includes(potentialName))) {
        continue;
      }
      
      persons.push({
        name: potentialName,
        type: 'PERSON',
        confidence: 0.7
      });
    }
    
    return persons;
  }
  
  /**
   * Extract organization names
   */
  async _extractOrganizations(text) {
    const organizations = [];
    
    // Known organizations
    for (const org of this.knownOrgs) {
      const regex = new RegExp(`\\b${org}\\b`, 'gi');
      while (regex.exec(text) !== null) {
        organizations.push({
          name: org,
          type: 'ORGANIZATION',
          confidence: 1.0
        });
      }
    }
    
    // Pattern: Inc., Corp., LLC, Ltd., etc.
    const corpPattern = /\b([A-Z][A-Za-z\s&]+(?:Inc\.|Corp\.|Corporation|LLC|Ltd\.|Limited|Company|Co\.))\b/g;
    let match;
    while ((match = corpPattern.exec(text)) !== null) {
      organizations.push({
        name: match[1].trim(),
        type: 'ORGANIZATION',
        confidence: 0.9
      });
    }
    
    return organizations;
  }
  
  /**
   * Extract locations
   */
  async _extractLocations(text) {
    const locations = [];
    
    // Pattern: Common cities and countries
    const locationPattern = /\b(New York City|London|Paris|Tokyo|Beijing|Sydney|Berlin|Moscow|Dubai|Singapore|Hong Kong|Los Angeles|San Francisco|Chicago|Boston|Washington|Miami|Seattle|Toronto|Vancouver|Montreal|Mexico City|São Paulo|Buenos Aires|Rio de Janeiro|Madrid|Barcelona|Rome|Milan|Amsterdam|Brussels|Vienna|Prague|Stockholm|Oslo|Copenhagen|Mumbai|Delhi|Bangalore|Shanghai|Seoul|Bangkok|Jakarta|Manila|Cairo|Lagos|Johannesburg|Cape Town|Melbourne|Auckland|Dublin|Edinburgh|Manchester|Birmingham)\b/gi;
    
    let match;
    while ((match = locationPattern.exec(text)) !== null) {
      locations.push({
        name: match[0],
        type: 'LOCATION',
        confidence: 0.9
      });
    }
    
    // Pattern: "in [Location]"
    const inLocationPattern = /\b(?:in|at|from|to|near)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b/g;
    while ((match = inLocationPattern.exec(text)) !== null) {
      const location = match[1];
      
      // Skip if it's a person or organization
      if (this._isLikelyPerson(location) || this._isLikelyOrganization(location)) {
        continue;
      }
      
      locations.push({
        name: location,
        type: 'LOCATION',
        confidence: 0.7
      });
    }
    
    return locations;
  }
  
  /**
   * Extract dates
   */
  async _extractDates(text) {
    const dates = [];
    
    // Pattern 1: Full dates (December 31, 2024)
    const fullDatePattern = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b/gi;
    let match;
    while ((match = fullDatePattern.exec(text)) !== null) {
      dates.push({
        text: match[0],
        type: 'DATE',
        parsed: new Date(match[0]).toISOString(),
        confidence: 0.9
      });
    }
    
    // Pattern 2: Numeric dates (12/31/2024, 2024-12-31)
    const numericDatePattern = /\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}[/-]\d{1,2}[/-]\d{1,2})\b/g;
    while ((match = numericDatePattern.exec(text)) !== null) {
      dates.push({
        text: match[0],
        type: 'DATE',
        confidence: 0.8
      });
    }
    
    // Pattern 3: Relative dates (Monday, Tuesday, etc.)
    const dayPattern = /\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|yesterday|today|tomorrow)\b/gi;
    while ((match = dayPattern.exec(text)) !== null) {
      dates.push({
        text: match[0],
        type: 'DATE',
        relative: true,
        confidence: 0.7
      });
    }
    
    return dates;
  }
  
  /**
   * Extract times
   */
  async _extractTimes(text) {
    const times = [];
    
    // Pattern: 12:00 PM, 3:30 AM, 14:30
    const timePattern = /\b(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?)\b/gi;
    let match;
    while ((match = timePattern.exec(text)) !== null) {
      times.push({
        text: match[0],
        type: 'TIME',
        confidence: 0.9
      });
    }
    
    return times;
  }
  
  /**
   * Extract email addresses
   */
  async _extractEmails(text) {
    const emails = [];
    
    const emailPattern = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
    let match;
    while ((match = emailPattern.exec(text)) !== null) {
      emails.push({
        address: match[0],
        type: 'EMAIL',
        confidence: 1.0
      });
    }
    
    return emails;
  }
  
  /**
   * Extract URLs
   */
  async _extractURLs(text) {
    const urls = [];
    
    const urlPattern = /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&//=]*)/gi;
    let match;
    while ((match = urlPattern.exec(text)) !== null) {
      urls.push({
        url: match[0],
        type: 'URL',
        confidence: 1.0
      });
    }
    
    return urls;
  }
  
  /**
   * Extract monetary amounts
   */
  async _extractMoney(text) {
    const money = [];
    
    // Pattern: $1,000.00, €10.50, £100, etc.
    const moneyPattern = /([£$€¥₹]\s*\d+(?:,\d{3})*(?:\.\d+)?(?:\s*(?:million|billion|thousand|k|m|b))?)/gi;
    let match;
    while ((match = moneyPattern.exec(text)) !== null) {
      const amount = this._parseMoneyAmount(match[0]);
      money.push({
        text: match[0],
        type: 'MONEY',
        amount: amount.value,
        currency: amount.currency,
        confidence: 0.9
      });
    }
    
    return money;
  }
  
  /**
   * Extract phone numbers
   */
  async _extractPhones(text) {
    const phones = [];
    
    // Pattern: Various phone formats
    const phonePattern = /(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
    let match;
    while ((match = phonePattern.exec(text)) !== null) {
      phones.push({
        number: match[0],
        type: 'PHONE',
        confidence: 0.8
      });
    }
    
    return phones;
  }
  
  /**
   * Extract custom entities based on user patterns
   */
  async _extractCustom(text) {
    const custom = [];
    
    for (const [type, pattern] of this.customPatterns) {
      const regex = new RegExp(pattern, 'g');
      let match;
      while ((match = regex.exec(text)) !== null) {
        custom.push({
          text: match[0],
          type,
          confidence: 0.8
        });
      }
    }
    
    return custom;
  }
  
  /**
   * Add custom entity pattern
   */
  addCustomPattern(type, pattern) {
    this.customPatterns.set(type, pattern);
  }
  
  /**
   * Remove duplicate entities
   */
  _deduplicateEntities(entities) {
    const seen = new Set();
    return entities.filter(entity => {
      const key = `${entity.name || entity.text || entity.address || entity.url || entity.number}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }
  
  /**
   * Check if text is likely a person name
   */
  _isLikelyPerson(text) {
    return this.namePrefixes.some(prefix => text.startsWith(prefix));
  }
  
  /**
   * Check if text is likely an organization
   */
  _isLikelyOrganization(text) {
    return text.match(/\b(Inc\.|Corp\.|LLC|Ltd\.|Company|Organization|Institute|University|College)\b/i);
  }
  
  /**
   * Parse monetary amount
   */
  _parseMoneyAmount(text) {
    const currencyMap = {
      '$': 'USD',
      '€': 'EUR',
      '£': 'GBP',
      '¥': 'JPY',
      '₹': 'INR'
    };
    
    const currency = currencyMap[text[0]] || 'USD';
    
    // Extract numeric value
    const numericMatch = text.match(/[\d,]+\.?\d*/);
    if (!numericMatch) return { value: 0, currency };
    
    let value = parseFloat(numericMatch[0].replace(/,/g, ''));
    
    // Handle abbreviations
    if (text.toLowerCase().includes('million')) {
      value = value * 1000000;
    } else if (text.toLowerCase().includes('billion')) {
      value = value * 1000000000;
    } else if (text.toLowerCase().includes('thousand')) {
      value = value * 1000;
    } else if (text.toLowerCase().endsWith('m')) {
      value = value * 1000000;
    } else if (text.toLowerCase().endsWith('b')) {
      value = value * 1000000000;
    } else if (text.toLowerCase().endsWith('k')) {
      value = value * 1000;
    }
    
    return { value, currency };
  }
  
  /**
   * Return empty result structure
   */
  _emptyResult() {
    return {
      persons: [],
      organizations: [],
      locations: [],
      dates: [],
      times: [],
      emails: [],
      urls: [],
      money: [],
      phones: [],
      custom: []
    };
  }
}

module.exports = EntityExtractor;