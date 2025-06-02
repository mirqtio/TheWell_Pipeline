/**
 * Output Formatter
 * Formats RAG responses into standardized output formats
 */

const logger = require('../../utils/logger');

class OutputFormatter {
  constructor(options = {}) {
    this.includeMetadata = options.includeMetadata !== false;
    this.includeSources = options.includeSources !== false;
    this.isInitialized = false;
    
    // Output format schemas
    this.formats = {
      json: this.formatAsJSON.bind(this),
      text: this.formatAsText.bind(this),
      markdown: this.formatAsMarkdown.bind(this)
    };
  }

  /**
   * Initialize the Output Formatter
   */
  async initialize() {
    try {
      logger.info('Initializing Output Formatter...');
      this.isInitialized = true;
      logger.info('Output Formatter initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Output Formatter:', error);
      throw error;
    }
  }

  /**
   * Format the RAG response
   * @param {Object} response - Generated response
   * @param {Array} documents - Source documents
   * @param {Object} metadata - Additional metadata
   * @returns {Object} Formatted output
   */
  async format(response, documents, metadata = {}) {
    try {
      const format = metadata.responseFormat || 'json';
      
      logger.debug('Formatting response', {
        format,
        responseLength: response.content?.length,
        documentsCount: documents.length,
        includeMetadata: this.includeMetadata,
        includeSources: this.includeSources
      });

      // Build the base response structure
      const baseResponse = {
        answer: response.content,
        confidence: response.metadata?.confidence_score || 0,
        timestamp: new Date().toISOString(),
        trace_id: metadata.traceId
      };

      // Add sources if enabled
      if (this.includeSources) {
        baseResponse.sources = this.formatSources(response.sources || [], documents);
      }

      // Add metadata if enabled
      if (this.includeMetadata) {
        baseResponse.metadata = this.formatMetadata(response.metadata, metadata, documents);
      }

      // Apply format-specific formatting
      const formatter = this.formats[format] || this.formats.json;
      const formattedResponse = await formatter(baseResponse);

      logger.debug('Response formatted successfully', {
        format,
        outputLength: JSON.stringify(formattedResponse).length
      });

      return formattedResponse;

    } catch (error) {
      logger.error('Failed to format response:', error);
      throw error;
    }
  }

  /**
   * Format as JSON (default)
   */
  formatAsJSON(response) {
    return {
      success: true,
      data: response,
      format: 'json'
    };
  }

  /**
   * Format as plain text
   */
  formatAsText(response) {
    let output = response.answer;

    if (this.includeSources && response.sources && response.sources.length > 0) {
      output += '\n\nSources:\n';
      response.sources.forEach((source, index) => {
        output += `${index + 1}. ${source.title} (${source.source_url})\n`;
      });
    }

    if (this.includeMetadata && response.metadata) {
      output += `\n\nConfidence: ${Math.round(response.confidence * 100)}%`;
      output += `\nGenerated at: ${response.timestamp}`;
      if (response.trace_id) {
        output += `\nTrace ID: ${response.trace_id}`;
      }
    }

    return {
      success: true,
      data: {
        content: output,
        format: 'text'
      }
    };
  }

  /**
   * Format as Markdown
   */
  formatAsMarkdown(response) {
    let output = response.answer;

    if (this.includeSources && response.sources && response.sources.length > 0) {
      output += '\n\n## Sources\n\n';
      response.sources.forEach((source, index) => {
        const title = source.title || 'Untitled';
        const url = source.source_url || '#';
        output += `${index + 1}. [${title}](${url})\n`;
      });
    }

    if (this.includeMetadata && response.metadata) {
      output += '\n\n---\n\n';
      output += `**Confidence:** ${Math.round(response.confidence * 100)}%  \n`;
      output += `**Generated:** ${new Date(response.timestamp).toLocaleString()}  \n`;
      if (response.trace_id) {
        output += `**Trace ID:** \`${response.trace_id}\`  \n`;
      }
    }

    return {
      success: true,
      data: {
        content: output,
        format: 'markdown'
      }
    };
  }

  /**
   * Format sources information
   * @param {Array} responseSources - Sources mentioned in response
   * @param {Array} allDocuments - All retrieved documents
   * @returns {Array} Formatted sources
   */
  formatSources(responseSources, allDocuments) {
    const sources = [];

    // Add sources mentioned in the response
    responseSources.forEach(source => {
      sources.push({
        id: source.document_id,
        title: source.title,
        url: source.source_url,
        relevance: source.relevance_score,
        mentioned: true
      });
    });

    // Add other relevant documents not mentioned
    allDocuments.forEach(doc => {
      const alreadyIncluded = sources.some(s => s.id === doc.id);
      if (!alreadyIncluded) {
        sources.push({
          id: doc.id,
          title: doc.title,
          url: doc.source_url,
          relevance: doc.search_metadata?.combined_score || 0,
          mentioned: false
        });
      }
    });

    // Sort by relevance and limit to top sources
    return sources
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, 10)
      .map(source => ({
        title: source.title || 'Untitled Document',
        source_url: source.url || '',
        relevance_score: Math.round(source.relevance * 100) / 100,
        mentioned_in_response: source.mentioned
      }));
  }

  /**
   * Format metadata information
   * @param {Object} responseMetadata - Response generation metadata
   * @param {Object} requestMetadata - Request processing metadata
   * @param {Array} documents - Retrieved documents
   * @returns {Object} Formatted metadata
   */
  formatMetadata(responseMetadata, requestMetadata, documents) {
    return {
      processing: {
        total_time_ms: requestMetadata.processingTime || 0,
        trace_id: requestMetadata.traceId,
        timestamp: requestMetadata.timestamp || new Date().toISOString()
      },
      retrieval: {
        documents_found: documents.length,
        documents_used: responseMetadata?.documents_used || 0,
        search_strategy: 'hybrid_vector_keyword'
      },
      generation: {
        model_used: responseMetadata?.model_used || 'unknown',
        tokens_used: responseMetadata?.tokens_used || 0,
        confidence_score: responseMetadata?.confidence_score || 0,
        fallback_used: responseMetadata?.fallback || false
      },
      quality: {
        response_length: responseMetadata?.response_length || 0,
        sources_cited: (responseMetadata?.sources || []).length,
        avg_document_relevance: this.calculateAverageRelevance(documents)
      }
    };
  }

  /**
   * Calculate average relevance of retrieved documents
   * @param {Array} documents - Retrieved documents
   * @returns {number} Average relevance score
   */
  calculateAverageRelevance(documents) {
    if (!documents || documents.length === 0) {
      return 0;
    }

    const totalRelevance = documents.reduce((sum, doc) => {
      return sum + (doc.search_metadata?.combined_score || 0);
    }, 0);

    return Math.round((totalRelevance / documents.length) * 100) / 100;
  }

  /**
   * Format error response
   * @param {Error} error - Error object
   * @param {string} traceId - Trace ID
   * @returns {Object} Formatted error response
   */
  formatError(error, traceId) {
    return {
      success: false,
      error: {
        message: error.message || 'An unexpected error occurred',
        type: error.name || 'UnknownError',
        trace_id: traceId,
        timestamp: new Date().toISOString()
      }
    };
  }

  /**
   * Get formatter status
   */
  async getStatus() {
    return {
      initialized: this.isInitialized,
      includeMetadata: this.includeMetadata,
      includeSources: this.includeSources,
      supportedFormats: Object.keys(this.formats),
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Shutdown the formatter
   */
  async shutdown() {
    logger.info('Shutting down Output Formatter...');
    this.isInitialized = false;
  }
}

module.exports = OutputFormatter;
