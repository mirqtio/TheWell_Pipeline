/**
 * OpenAI Provider Implementation
 * 
 * Implements the BaseProvider interface for OpenAI's API.
 * Supports GPT models with proper error handling and cost calculation.
 */

const BaseProvider = require('./BaseProvider');
const logger = require('../../utils/logger');

class OpenAIProvider extends BaseProvider {
  constructor(config = {}) {
    super(config);
    
    if (!config.apiKey) {
      throw new Error('OpenAI API key is required');
    }
    
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || 'https://api.openai.com/v1';
    this.defaultModel = config.model || 'gpt-4-turbo';
    
    // Model pricing per 1K tokens (as of 2024)
    this.pricing = {
      'gpt-4-turbo': { input: 0.01, output: 0.03 },
      'gpt-4': { input: 0.03, output: 0.06 },
      'gpt-3.5-turbo': { input: 0.0015, output: 0.002 },
      'gpt-3.5-turbo-16k': { input: 0.003, output: 0.004 }
    };
  }

  getName() {
    return 'openai';
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
      messages: [{ role: 'user', content: prompt }],
      max_tokens: options.maxTokens || 1000,
      temperature: options.temperature || 0.7,
      top_p: options.topP || 1,
      frequency_penalty: options.frequencyPenalty || 0,
      presence_penalty: options.presencePenalty || 0
    };

    const startTime = Date.now();
    let attempt = 0;
    
    while (attempt < this.config.maxRetries) {
      try {
        const response = await this.makeRequest('/chat/completions', requestBody);
        const duration = Date.now() - startTime;
        
        const result = {
          content: response.choices[0].message.content,
          model: response.model,
          usage: {
            inputTokens: response.usage.prompt_tokens,
            outputTokens: response.usage.completion_tokens,
            totalTokens: response.usage.total_tokens
          },
          cost: this.calculateCost(
            response.model,
            response.usage.prompt_tokens,
            response.usage.completion_tokens
          ),
          metadata: {
            provider: this.getName(),
            duration,
            attempt: attempt + 1,
            finishReason: response.choices[0].finish_reason
          }
        };

        logger.info('OpenAI completion successful', {
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
        
        logger.warn('OpenAI completion attempt failed', {
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
          logger.error('OpenAI completion failed after all retries', {
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
          'Authorization': `Bearer ${this.apiKey}`,
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
    return nonRetryableStatuses.includes(error.status);
  }
}

module.exports = OpenAIProvider;
