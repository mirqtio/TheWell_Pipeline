/**
 * Anthropic Provider Implementation
 * 
 * Implements the BaseProvider interface for Anthropic's Claude API.
 * Supports Claude models with proper error handling and cost calculation.
 */

const BaseProvider = require('./BaseProvider');
const logger = require('../../utils/logger');

class AnthropicProvider extends BaseProvider {
  constructor(config = {}) {
    super(config);
    
    if (!config.apiKey) {
      throw new Error('Anthropic API key is required');
    }
    
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || 'https://api.anthropic.com/v1';
    this.defaultModel = config.model || 'claude-3-sonnet-20240229';
    this.version = config.version || '2023-06-01';
    
    // Model pricing per 1K tokens (as of 2024)
    this.pricing = {
      'claude-3-opus-20240229': { input: 0.015, output: 0.075 },
      'claude-3-sonnet-20240229': { input: 0.003, output: 0.015 },
      'claude-3-haiku-20240307': { input: 0.00025, output: 0.00125 },
      'claude-2.1': { input: 0.008, output: 0.024 },
      'claude-2.0': { input: 0.008, output: 0.024 }
    };
  }

  getName() {
    return 'anthropic';
  }

  getSupportedModels() {
    return Object.keys(this.pricing);
  }

  async complete(request) {
    const { model = this.defaultModel, prompt, options = {} } = request;
    
    if (!this.getSupportedModels().includes(model)) {
      throw new Error(`Unsupported model: ${model}`);
    }

    this.incrementRequestCount();
    
    const requestBody = {
      model,
      max_tokens: options.maxTokens || 1000,
      messages: [{ role: 'user', content: prompt }],
      temperature: options.temperature || 0.7,
      top_p: options.topP || 1,
      top_k: options.topK || 40
    };

    const startTime = Date.now();
    let attempt = 0;
    
    while (attempt < this.config.maxRetries) {
      try {
        const response = await this.makeRequest('/messages', requestBody);
        const duration = Date.now() - startTime;
        
        const result = {
          content: response.content[0].text,
          model: response.model,
          usage: {
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
            totalTokens: response.usage.input_tokens + response.usage.output_tokens
          },
          cost: this.calculateCost(
            response.model,
            response.usage.input_tokens,
            response.usage.output_tokens
          ),
          metadata: {
            provider: this.getName(),
            duration,
            attempt: attempt + 1,
            finishReason: response.stop_reason
          }
        };

        logger.info('Anthropic completion successful', {
          model: response.model,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          cost: result.cost.total,
          duration
        });

        return result;
        
      } catch (error) {
        attempt++;
        this.incrementErrorCount();
        
        logger.warn('Anthropic completion attempt failed', {
          attempt,
          error: error.message,
          model,
          maxRetries: this.config.maxRetries
        });
        
        // Don't retry on certain errors
        if (this.isNonRetryableError(error)) {
          throw error;
        }
        
        if (attempt >= this.config.maxRetries) {
          logger.error('Anthropic completion failed after all retries', {
            error: error.message,
            model,
            attempts: attempt
          });
          throw error;
        }
        
        // Exponential backoff
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  calculateCost(model, inputTokens, outputTokens) {
    const modelPricing = this.pricing[model];
    if (!modelPricing) {
      throw new Error(`No pricing information for model: ${model}`);
    }
    
    const inputCost = (inputTokens / 1000) * modelPricing.input;
    const outputCost = (outputTokens / 1000) * modelPricing.output;
    const total = inputCost + outputCost;
    
    return {
      inputCost: Number(inputCost.toFixed(6)),
      outputCost: Number(outputCost.toFixed(6)),
      total: Number(total.toFixed(6)),
      currency: 'USD'
    };
  }

  async makeRequest(endpoint, data) {
    const url = `${this.baseUrl}${endpoint}`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, this.config.timeout);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': this.version,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(data),
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const error = new Error(errorData.error?.message || `HTTP ${response.status}`);
        error.status = response.status;
        error.type = errorData.error?.type;
        throw error;
      }

      return await response.json();
    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error.name === 'AbortError') {
        const timeoutError = new Error(`Request timeout after ${this.config.timeout}ms`);
        timeoutError.code = 'TIMEOUT';
        throw timeoutError;
      }
      
      throw error;
    }
  }

  isNonRetryableError(error) {
    // Don't retry on authentication, permission, or validation errors
    const nonRetryableStatuses = [400, 401, 403, 404];
    const nonRetryableTypes = ['invalid_request_error', 'authentication_error', 'permission_error'];
    
    return nonRetryableStatuses.includes(error.status) || 
           nonRetryableTypes.includes(error.type);
  }
}

module.exports = AnthropicProvider;
