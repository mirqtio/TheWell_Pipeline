/**
 * Response Generator
 * Generates responses using LLM with retrieved documents as context
 */

const logger = require('../../utils/logger');

class ResponseGenerator {
  constructor(options = {}) {
    this.llmProviderManager = options.llmProviderManager;
    this.maxTokens = options.maxTokens || 2048;
    this.temperature = options.temperature || 0.7;
    this.isInitialized = false;
    
    // Response generation prompts
    this.systemPrompt = `You are a helpful AI assistant that answers questions based on provided context documents. 
Follow these guidelines:
1. Answer questions accurately based on the provided context
2. If the context doesn't contain enough information, say so clearly
3. Cite specific sources when possible
4. Be concise but comprehensive
5. Maintain a professional and helpful tone`;

    this.responseTemplates = {
      question: `Based on the provided context, here's what I found regarding your question: "{query}"

Context Documents:
{context}

Answer: `,
      command: `I'll help you with: "{query}"

Based on the available information:
{context}

Response: `,
      general: `Regarding: "{query}"

Here's what I found in the available documents:
{context}

Summary: `
    };
  }

  /**
   * Initialize the Response Generator
   */
  async initialize() {
    try {
      logger.info('Initializing Response Generator...');
      
      if (!this.llmProviderManager) {
        throw new Error('LLM Provider Manager is required');
      }
      
      this.isInitialized = true;
      logger.info('Response Generator initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Response Generator:', error);
      throw error;
    }
  }

  /**
   * Generate response using LLM
   * @param {string} query - The user's query
   * @param {Array} documents - Retrieved documents
   * @param {Object} context - Additional context
   * @returns {Object} Generated response
   */
  async generate(query, documents, context = {}) {
    try {
      logger.debug('Generating response', {
        queryLength: query.length,
        documentsCount: documents.length,
        contextKeys: Object.keys(context)
      });

      // Prepare context from documents
      const documentContext = this.prepareDocumentContext(documents);
      
      // Select appropriate template based on query type
      const queryType = context.queryType || 'general';
      const template = this.responseTemplates[queryType] || this.responseTemplates.general;
      
      // Build the prompt
      const prompt = template
        .replace('{query}', query)
        .replace('{context}', documentContext);
      
      // Generate response using LLM
      const llmResponse = await this.callLLM(prompt, context);
      
      // Process and validate response
      const processedResponse = this.processResponse(llmResponse, documents, query);
      
      logger.debug('Response generated successfully', {
        responseLength: processedResponse.content?.length,
        sourcesUsed: processedResponse.sources?.length || 0
      });
      
      return processedResponse;
      
    } catch (error) {
      logger.error('Failed to generate response:', error);
      throw error;
    }
  }

  /**
   * Prepare document context for the LLM
   * @param {Array} documents - Retrieved documents
   * @returns {string} Formatted document context
   */
  prepareDocumentContext(documents) {
    if (!documents || documents.length === 0) {
      return "No relevant documents found.";
    }
    
    const contextParts = documents.map((doc, index) => {
      const title = doc.title || 'Untitled Document';
      const content = this.truncateContent(doc.content || '', 500);
      const source = doc.source_url || 'Unknown Source';
      
      return `Document ${index + 1}: ${title}
Source: ${source}
Content: ${content}
---`;
    });
    
    return contextParts.join('\n\n');
  }

  /**
   * Truncate content to fit within token limits
   * @param {string} content - Content to truncate
   * @param {number} maxLength - Maximum character length
   * @returns {string} Truncated content
   */
  truncateContent(content, maxLength) {
    if (content.length <= maxLength) {
      return content;
    }
    
    // Truncate at word boundary
    const truncated = content.substring(0, maxLength);
    const lastSpace = truncated.lastIndexOf(' ');
    
    if (lastSpace > maxLength * 0.8) {
      return truncated.substring(0, lastSpace) + '...';
    }
    
    return truncated + '...';
  }

  /**
   * Call the LLM provider
   * @param {string} prompt - The prompt to send
   * @param {Object} context - Additional context
   * @returns {Object} LLM response
   */
  async callLLM(prompt, context) {
    try {
      const requestData = {
        messages: [
          {
            role: 'system',
            content: this.systemPrompt
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: this.maxTokens,
        temperature: this.temperature,
        stream: false
      };
      
      // Add conversation history if available
      if (context.previousQueries && context.previousQueries.length > 0) {
        // Insert previous queries before the current one
        const historyMessages = context.previousQueries.slice(-3).map(prevQuery => [
          { role: 'user', content: prevQuery },
          { role: 'assistant', content: 'I understand. Please provide your current question.' }
        ]).flat();
        
        requestData.messages.splice(1, 0, ...historyMessages);
      }
      
      // Use the LLM Provider Manager to make the request
      const response = await this.llmProviderManager.executeWithFailover(requestData);
      
      return response;
      
    } catch (error) {
      logger.error('LLM call failed:', error);
      
      // Return fallback response
      return {
        content: "I apologize, but I'm unable to generate a response at this time due to a technical issue. Please try again later.",
        metadata: {
          error: true,
          fallback: true,
          errorMessage: error.message
        }
      };
    }
  }

  /**
   * Process and validate the LLM response
   * @param {Object} llmResponse - Raw LLM response
   * @param {Array} documents - Source documents
   * @param {string} query - Original query
   * @returns {Object} Processed response
   */
  processResponse(llmResponse, documents, query) {
    const content = llmResponse.content || llmResponse.message || '';
    
    // Extract sources mentioned in the response
    const mentionedSources = this.extractMentionedSources(content, documents);
    
    // Calculate confidence score based on document relevance
    const confidenceScore = this.calculateConfidenceScore(documents, content);
    
    return {
      content: content.trim(),
      sources: mentionedSources,
      metadata: {
        confidence_score: confidenceScore,
        documents_used: documents.length,
        response_length: content.length,
        generated_at: new Date().toISOString(),
        model_used: llmResponse.model || 'unknown',
        tokens_used: llmResponse.usage?.total_tokens || 0,
        fallback: llmResponse.metadata?.fallback || false
      }
    };
  }

  /**
   * Extract sources mentioned in the response
   * @param {string} content - Response content
   * @param {Array} documents - Source documents
   * @returns {Array} Mentioned sources
   */
  extractMentionedSources(content, documents) {
    const mentionedSources = [];
    
    documents.forEach((doc, index) => {
      const docNumber = index + 1;
      const patterns = [
        new RegExp(`Document ${docNumber}`, 'i'),
        new RegExp(`source ${docNumber}`, 'i'),
        new RegExp(`\\[${docNumber}\\]`, 'g')
      ];
      
      const isMentioned = patterns.some(pattern => pattern.test(content));
      
      if (isMentioned) {
        mentionedSources.push({
          document_id: doc.id,
          title: doc.title,
          source_url: doc.source_url,
          relevance_score: doc.search_metadata?.combined_score || 0
        });
      }
    });
    
    return mentionedSources;
  }

  /**
   * Calculate confidence score for the response
   * @param {Array} documents - Source documents
   * @param {string} content - Response content
   * @returns {number} Confidence score (0-1)
   */
  calculateConfidenceScore(documents, content) {
    if (!documents || documents.length === 0) {
      return 0.1; // Low confidence with no sources
    }
    
    // Base score from document relevance
    const avgRelevance = documents.reduce((sum, doc) => {
      return sum + (doc.search_metadata?.combined_score || 0);
    }, 0) / documents.length;
    
    // Adjust based on response characteristics
    let confidenceScore = avgRelevance * 0.7; // Start with 70% of relevance score
    
    // Boost confidence if response is substantial
    if (content.length > 100) {
      confidenceScore += 0.1;
    }
    
    // Boost confidence if multiple sources are used
    if (documents.length > 1) {
      confidenceScore += 0.1;
    }
    
    // Reduce confidence if response is too short
    if (content.length < 50) {
      confidenceScore -= 0.2;
    }
    
    // Ensure score is between 0 and 1
    return Math.max(0, Math.min(1, confidenceScore));
  }

  /**
   * Get generator status
   */
  async getStatus() {
    return {
      initialized: this.isInitialized,
      maxTokens: this.maxTokens,
      temperature: this.temperature,
      llmProviderConnected: !!this.llmProviderManager,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Shutdown the generator
   */
  async shutdown() {
    logger.info('Shutting down Response Generator...');
    this.isInitialized = false;
  }
}

module.exports = ResponseGenerator;
