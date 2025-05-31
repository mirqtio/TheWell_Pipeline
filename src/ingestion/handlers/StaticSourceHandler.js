const fs = require('fs').promises;
const path = require('path');
const mime = require('mime-types');
const crypto = require('crypto');
const { BaseSourceHandler, SOURCE_TYPES, VISIBILITY_LEVELS } = require('../types');

/**
 * Static Source Handler
 * Handles one-time bulk loads from file systems, archives, or static datasets
 */
class StaticSourceHandler extends BaseSourceHandler {
  constructor(config) {
    super(config);
    // Handle fileTypes configuration and ensure proper extension format
    const fileTypes = config.config?.fileTypes || ['txt', 'md', 'pdf', 'docx', 'html', 'json', 'csv'];
    this.supportedExtensions = fileTypes.map(ext => ext.startsWith('.') ? ext : `.${ext}`);
  }

  /**
   * Initialize the static source handler
   */
  async initialize() {
    this.logger?.info('Initializing StaticSourceHandler', { sourceId: this.config.id });
    
    // Validate required configuration
    if (!this.config.config?.basePath) {
      throw new Error('StaticSourceHandler requires config.basePath');
    }

    // Ensure base path exists and is accessible
    try {
      await fs.access(this.config.config.basePath);
    } catch (error) {
      throw new Error(`Base path not accessible: ${this.config.config.basePath}`);
    }

    this.logger?.info('StaticSourceHandler initialized successfully');
  }

  /**
   * Validate static source configuration
   */
  async validateConfig(config) {
    const required = ['basePath'];
    const missing = required.filter(field => !config.config?.[field]);
    
    if (missing.length > 0) {
      throw new Error(`Missing required config fields: ${missing.join(', ')}`);
    }

    // Validate base path exists
    try {
      await fs.access(config.config.basePath);
      return true;
    } catch (error) {
      throw new Error(`Invalid basePath: ${config.config.basePath}`);
    }
  }

  /**
   * Discover all files in the static source
   */
  async discover() {
    this.logger?.info('Starting discovery for static source', { 
      sourceId: this.config.id,
      basePath: this.config.config.basePath 
    });

    const documents = [];
    const basePath = this.config.config.basePath;
    const includePatterns = this.config.config.includePatterns || ['**/*'];
    const excludePatterns = this.config.config.excludePatterns || [];

    try {
      const files = await this._walkDirectory(basePath);
      
      for (const filePath of files) {
        try {
          const relativePath = path.relative(basePath, filePath);
          
          // Check if file matches include/exclude patterns
          if (!this._matchesPatterns(relativePath, includePatterns, excludePatterns)) {
            continue;
          }

          // Check if file extension is supported
          const ext = path.extname(filePath).toLowerCase();
          if (!this.supportedExtensions.includes(ext)) {
            this.logger?.debug('Skipping unsupported file type', { filePath, ext });
            continue;
          }

          const stats = await fs.stat(filePath);
          const document = {
            id: this._generateDocumentId(filePath),
            title: path.basename(filePath), // Add title property for compatibility
            path: filePath,
            url: filePath, // Add url property for compatibility
            relativePath,
            name: path.basename(filePath),
            extension: ext,
            size: stats.size,
            lastModified: stats.mtime,
            contentType: mime.lookup(filePath) || 'application/octet-stream',
            metadata: {
              sourceId: this.config.id,
              sourceType: SOURCE_TYPES.STATIC,
              originalPath: filePath,
              fileExtension: ext,
              directory: path.dirname(relativePath),
              visibility: this.config.visibility || VISIBILITY_LEVELS.INTERNAL
            }
          };

          documents.push(document);
        } catch (error) {
          this.logger?.warn('Error processing file during discovery', { 
            filePath, 
            error: error.message 
          });
        }
      }

      this.logger?.info('Discovery completed', { 
        sourceId: this.config.id,
        documentsFound: documents.length 
      });

      return documents;
    } catch (error) {
      this.logger?.error('Discovery failed', { 
        sourceId: this.config.id,
        error: error.message 
      });
      throw error;
    }
  }

  /**
   * Extract content from a static file
   */
  async extract(document) {
    this.logger?.info('Extracting content from document', { 
      documentId: document.id,
      path: document.filePath || document.path 
    });

    try {
      const filePath = document.filePath || document.path;
      const fileExtension = path.extname(filePath);
      
      let content;
      let encoding = 'utf-8';
      
      if (this._isBinaryExtension(fileExtension)) {
        // Handle binary files
        const fileName = path.basename(filePath);
        content = `[Binary file: ${fileName}]`;
        encoding = 'binary';
      } else {
        // Handle text files
        content = await fs.readFile(filePath, 'utf-8');
      }
      
      const hash = crypto.createHash('sha256').update(content).digest('hex');

      return {
        id: document.id,
        content,
        contentHash: hash,
        extractedAt: new Date(),
        metadata: {
          ...document.metadata,
          extractionMethod: 'file-system-read',
          encoding,
          originalSize: document.size
        }
      };
    } catch (error) {
      this.logger?.error('Content extraction failed', { 
        documentId: document.id,
        path: document.filePath || document.path,
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

    // Basic transformation - can be extended for different file types
    const transformed = {
      id: extractedContent.id,
      title: this._extractTitle(extractedContent),
      content: this._cleanContent(extractedContent.content),
      contentHash: extractedContent.contentHash,
      metadata: {
        ...extractedContent.metadata,
        transformedAt: new Date(),
        wordCount: this._countWords(extractedContent.content),
        characterCount: extractedContent.content.length
      }
    };

    return transformed;
  }

  /**
   * Walk directory recursively to find all files
   */
  async _walkDirectory(dir) {
    const files = [];
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const recursive = this.config.config.recursive !== false; // Default to true

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      
      if (entry.isDirectory()) {
        // Skip hidden directories and common ignore patterns
        if (!entry.name.startsWith('.') && !['node_modules', 'dist', 'build'].includes(entry.name)) {
          if (recursive) {
            const subFiles = await this._walkDirectory(fullPath);
            files.push(...subFiles);
          }
        }
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }

    return files;
  }

  /**
   * Check if file path matches include/exclude patterns
   */
  _matchesPatterns(filePath, includePatterns, excludePatterns) {
    // Simple pattern matching - can be enhanced with glob patterns
    const included = includePatterns.some(pattern => {
      if (pattern === '**/*') return true;
      return filePath.includes(pattern);
    });

    const excluded = excludePatterns.some(pattern => {
      return filePath.includes(pattern);
    });

    return included && !excluded;
  }

  /**
   * Generate unique document ID based on file path
   */
  _generateDocumentId(filePath) {
    return crypto.createHash('md5').update(filePath).digest('hex');
  }

  /**
   * Extract title from content or use filename
   */
  _extractTitle(extractedContent) {
    const content = extractedContent.content;
    const metadata = extractedContent.metadata;

    // Try to extract title from content (markdown, HTML, etc.)
    const titleMatch = content.match(/^#\s+(.+)$/m) || // Markdown H1
                      content.match(/<title>(.+)<\/title>/i); // HTML title

    if (titleMatch && titleMatch[1]) {
      return titleMatch[1].trim();
    }

    // Fallback to filename without extension
    return path.basename(metadata.originalPath, path.extname(metadata.originalPath));
  }

  /**
   * Clean and normalize content
   */
  _cleanContent(content) {
    return content
      .replace(/\r\n/g, '\n') // Normalize line endings
      .replace(/\n{3,}/g, '\n\n') // Remove excessive newlines
      .replace(/[ \t]+$/gm, '') // Remove trailing whitespace from each line
      .trim();
  }

  /**
   * Count words in content
   */
  _countWords(content) {
    return content.split(/\s+/).filter(word => word.length > 0).length;
  }

  /**
   * Check if file type is allowed
   */
  _isAllowedFileType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return this.config.config.fileTypes.includes(ext);
  }

  /**
   * Check if file extension is binary
   */
  _isBinaryExtension(ext) {
    const binaryExtensions = ['.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png', '.gif', '.zip', '.tar', '.gz'];
    return binaryExtensions.includes(ext.toLowerCase());
  }
}

module.exports = StaticSourceHandler;
