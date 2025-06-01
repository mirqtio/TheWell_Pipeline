const PromptVersionManager = require('../../../src/enrichment/PromptVersionManager');
const LLMProviderManager = require('../../../src/enrichment/LLMProviderManager');
const fs = require('fs').promises;
const path = require('path');

describe('Prompt Lifecycle E2E Tests', () => {
  let promptManager;
  let llmManager;
  let testDir;

  beforeAll(async () => {
    // Create temporary test directory
    testDir = path.join(__dirname, '../../../temp/test-prompts-e2e');
    
    try {
      await fs.mkdir(testDir, { recursive: true });
    } catch (error) {
      // Directory might already exist
    }
  });

  beforeEach(async () => {
    // Clean test directory
    try {
      const files = await fs.readdir(testDir);
      await Promise.all(files.map(file => 
        fs.unlink(path.join(testDir, file)).catch(() => {})
      ));
    } catch (error) {
      // Directory might not exist
    }

    // Mock fetch for LLM calls
    global.fetch = jest.fn().mockImplementation((url, options) => {
      const body = JSON.parse(options.body);
      const prompt = body.messages?.[0]?.content || body.prompt || '';
      
      // Simulate different responses based on prompt content
      let response = 'Default LLM response';
      
      if (prompt.includes('Focus on') || prompt.includes('Main themes') || prompt.includes('summary')) {
        response = 'This is a comprehensive summary of the document content with key insights and main points.';
      } else if (prompt.includes('sentiment') || prompt.includes('analyze') || prompt.includes('emotional tone')) {
        response = 'The sentiment analysis shows positive sentiment with a confidence score of 85%.';
      } else if (prompt.includes('entities') || prompt.includes('Extract') || prompt.includes('Person') || prompt.includes('Location')) {
        response = 'Extracted entities include: Person: John Doe, Location: New York, Date: 2024-01-01';
      } else if (prompt.includes('content-extraction') || prompt.includes('Extract the main content')) {
        response = 'Extracted content: This document contains important information about data processing.';
      } else if (prompt.includes('quality-assessment') || prompt.includes('Assess the quality')) {
        response = 'Quality assessment: High quality content with good structure and clarity.';
      } else if (prompt.includes('metadata-enhancement') || prompt.includes('Enhance the metadata')) {
        response = 'Enhanced metadata: Category: Technical, Complexity: Medium, Audience: Professional';
      }

      return Promise.resolve({
        ok: true,
        json: async () => ({
          choices: [{
            message: { content: response },
            finish_reason: 'stop'
          }],
          usage: {
            prompt_tokens: prompt.length / 4, // Rough estimate
            completion_tokens: response.length / 4,
            total_tokens: (prompt.length + response.length) / 4
          },
          model: 'gpt-3.5-turbo'
        })
      });
    });

    // Initialize managers
    promptManager = new PromptVersionManager({
      promptsDirectory: testDir,
      gitEnabled: false, // Disable git for E2E tests
      autoCommit: false
    });

    llmManager = new LLMProviderManager({
      openai: {
        apiKey: 'test-key-e2e',
        model: 'gpt-3.5-turbo',
        maxRetries: 1,
        timeout: 5000
      },
      prompts: {
        promptsDirectory: testDir,
        gitEnabled: false
      }
    });

    await promptManager.initialize();
    await llmManager.initializePromptVersioning();
  });

  afterEach(async () => {
    delete global.fetch;
    
    if (promptManager) {
      await promptManager.shutdown();
    }
    if (llmManager) {
      await llmManager.shutdown();
    }
  });

  afterAll(async () => {
    // Clean up test directory
    try {
      const files = await fs.readdir(testDir);
      await Promise.all(files.map(file => 
        fs.unlink(path.join(testDir, file)).catch(() => {})
      ));
      await fs.rmdir(testDir);
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('Complete Prompt Lifecycle', () => {
    it('should handle complete document summarization workflow', async () => {
      // Step 1: Create summarization prompt
      const summaryPrompt = {
        content: `Please provide a comprehensive summary of the following document.

Document Title: {{title}}
Document Type: {{documentType}}
Content: {{content}}

Focus on:
1. Main themes and topics
2. Key findings or arguments
3. Important details and data
4. Conclusions and implications`,
        metadata: {
          description: 'Comprehensive document summarization',
          tags: ['summarization', 'analysis', 'document-processing'],
          author: 'E2E Test Suite'
        }
      };

      const savedPrompt = await llmManager.savePrompt('doc-summary-v1', summaryPrompt);
      expect(savedPrompt.version).toBe('1.0.0');

      // Step 2: Execute summarization with real document data
      const documentData = {
        title: 'Climate Change Impact Report',
        documentType: 'Research Report',
        content: `Climate change represents one of the most significant challenges facing humanity in the 21st century. 
        Recent studies indicate that global temperatures have risen by 1.1°C since pre-industrial times, with 
        accelerating impacts on weather patterns, sea levels, and ecosystems. The report analyzes data from 
        150 countries and projects that without immediate action, temperatures could rise by 3-4°C by 2100, 
        leading to catastrophic consequences for food security, water resources, and human settlements.`
      };

      const result = await llmManager.executeWithPrompt('doc-summary-v1', documentData, {
        taskType: 'summarization'
      });

      // Verify execution results
      expect(result.promptMetadata.promptId).toBe('doc-summary-v1');
      expect(result.promptMetadata.promptVersion).toBe('1.0.0');
      expect(result.promptMetadata.variables).toEqual(documentData);
      expect(result.content).toContain('summary');
      expect(result.provider).toBeDefined();

      // Step 3: Update prompt based on results
      const improvedPrompt = {
        ...summaryPrompt,
        content: summaryPrompt.content + '\n\nPlease also include a confidence score for your analysis.',
        metadata: {
          ...summaryPrompt.metadata,
          description: 'Enhanced summarization with confidence scoring'
        }
      };

      const updatedPrompt = await llmManager.savePrompt('doc-summary-v1', improvedPrompt);
      expect(updatedPrompt.version).toBe('1.0.1');

      // Step 4: Execute with updated prompt
      const improvedResult = await llmManager.executeWithPrompt('doc-summary-v1', documentData);
      expect(improvedResult.promptMetadata.promptVersion).toBe('1.0.1');
    });

    it('should handle sentiment analysis workflow with multiple iterations', async () => {
      // Step 1: Create initial sentiment analysis prompt
      const sentimentPrompt = {
        content: 'Analyze the sentiment of the following text: {{text}}',
        metadata: {
          description: 'Basic sentiment analysis',
          tags: ['sentiment', 'analysis']
        }
      };

      await llmManager.savePrompt('sentiment-basic', sentimentPrompt);

      // Step 2: Test with various text samples
      const testTexts = [
        'I absolutely love this new product! It exceeded all my expectations.',
        'The service was terrible and I will never come back.',
        'The weather today is partly cloudy with a chance of rain.'
      ];

      const results = [];
      for (const text of testTexts) {
        const result = await llmManager.executeWithPrompt('sentiment-basic', { text });
        results.push(result);
      }

      expect(results).toHaveLength(3);
      results.forEach(result => {
        expect(result.promptMetadata.promptId).toBe('sentiment-basic');
        expect(result.content).toContain('sentiment');
      });

      // Step 3: Create enhanced sentiment prompt
      const enhancedSentimentPrompt = {
        content: `Analyze the sentiment of the following text and provide:
1. Overall sentiment (Positive/Negative/Neutral)
2. Confidence score (0-100%)
3. Key emotional indicators
4. Tone assessment

Text: {{text}}`,
        metadata: {
          description: 'Enhanced sentiment analysis with detailed breakdown',
          tags: ['sentiment', 'analysis', 'detailed']
        }
      };

      const enhanced = await llmManager.savePrompt('sentiment-basic', enhancedSentimentPrompt);
      expect(enhanced.version).toBe('1.0.1');

      // Step 4: Test enhanced version
      const enhancedResult = await llmManager.executeWithPrompt('sentiment-basic', {
        text: testTexts[0]
      });

      expect(enhancedResult.promptMetadata.promptVersion).toBe('1.0.1');
    });

    it('should handle entity extraction workflow', async () => {
      // Step 1: Create entity extraction prompt
      const entityPrompt = {
        content: `Extract entities from the following text and categorize them:

Text: {{text}}

Please identify:
- People (names of individuals)
- Organizations (companies, institutions)
- Locations (cities, countries, addresses)
- Dates and times
- Other relevant entities

Format your response as a structured list.`,
        metadata: {
          description: 'Comprehensive entity extraction',
          tags: ['entities', 'extraction', 'nlp']
        }
      };

      await llmManager.savePrompt('entity-extraction', entityPrompt);

      // Step 2: Test with complex text
      const complexText = `John Smith, CEO of TechCorp Inc., announced yesterday that the company will open 
      a new headquarters in San Francisco, California by December 2024. The announcement was made during 
      a press conference at the Marriott Hotel on Market Street. Smith mentioned that the move will create 
      500 new jobs and strengthen TechCorp's presence on the West Coast.`;

      const result = await llmManager.executeWithPrompt('entity-extraction', {
        text: complexText
      });

      expect(result.promptMetadata.promptId).toBe('entity-extraction');
      expect(result.content).toContain('entities');
      expect(result.promptMetadata.variables.text).toBe(complexText);

      // Step 3: Verify prompt hash for reproducibility
      const prompt = await llmManager.getPrompt('entity-extraction');
      const hash1 = llmManager.generatePromptHash(prompt);
      
      // Execute again with same prompt
      const result2 = await llmManager.executeWithPrompt('entity-extraction', {
        text: complexText
      });

      expect(result2.promptMetadata.promptHash).toBe(hash1);
    });
  });

  describe('Multi-Prompt Workflows', () => {
    it('should handle document processing pipeline with multiple prompts', async () => {
      // Step 1: Create multiple specialized prompts
      const prompts = {
        'content-extraction': {
          content: 'Extract the main content and key information from: {{document}}',
          metadata: { description: 'Content extraction', tags: ['extraction'] }
        },
        'summary-generation': {
          content: 'Summarize the following extracted content: {{content}}',
          metadata: { description: 'Summary generation', tags: ['summary'] }
        },
        'key-insights': {
          content: 'Identify key insights and recommendations from: {{summary}}',
          metadata: { description: 'Insight extraction', tags: ['insights'] }
        }
      };

      // Save all prompts
      for (const [id, promptData] of Object.entries(prompts)) {
        await llmManager.savePrompt(id, promptData);
      }

      // Step 2: Execute pipeline
      const originalDocument = `This quarterly report shows significant growth in our software division, 
      with revenue increasing by 25% year-over-year. Customer satisfaction scores have improved to 4.2/5.0, 
      and our new AI features have been adopted by 78% of enterprise clients. However, we face challenges 
      in the mobile segment where competition has intensified.`;

      // Extract content
      const extraction = await llmManager.executeWithPrompt('content-extraction', {
        document: originalDocument
      });

      // Generate summary
      const summary = await llmManager.executeWithPrompt('summary-generation', {
        content: extraction.content
      });

      // Extract insights
      const insights = await llmManager.executeWithPrompt('key-insights', {
        summary: summary.content
      });

      // Verify pipeline execution
      expect(extraction.promptMetadata.promptId).toBe('content-extraction');
      expect(summary.promptMetadata.promptId).toBe('summary-generation');
      expect(insights.promptMetadata.promptId).toBe('key-insights');

      // All should have version 1.0.0
      expect(extraction.promptMetadata.promptVersion).toBe('1.0.0');
      expect(summary.promptMetadata.promptVersion).toBe('1.0.0');
      expect(insights.promptMetadata.promptVersion).toBe('1.0.0');
    });

    it('should handle prompt versioning across workflow iterations', async () => {
      // Step 1: Create initial workflow prompts
      await llmManager.savePrompt('analyze-step1', {
        content: 'Step 1: Analyze {{input}}',
        metadata: { description: 'Analysis step 1' }
      });

      await llmManager.savePrompt('analyze-step2', {
        content: 'Step 2: Process {{step1_result}}',
        metadata: { description: 'Analysis step 2' }
      });

      // Step 2: Execute initial workflow
      const step1_v1 = await llmManager.executeWithPrompt('analyze-step1', {
        input: 'Initial data'
      });

      const step2_v1 = await llmManager.executeWithPrompt('analyze-step2', {
        step1_result: step1_v1.content
      });

      // Step 3: Update prompts
      await llmManager.savePrompt('analyze-step1', {
        content: 'Step 1 Enhanced: Thoroughly analyze {{input}} with detailed breakdown',
        metadata: { description: 'Enhanced analysis step 1' }
      });

      await llmManager.savePrompt('analyze-step2', {
        content: 'Step 2 Enhanced: Comprehensively process {{step1_result}} with recommendations',
        metadata: { description: 'Enhanced analysis step 2' }
      });

      // Step 4: Execute updated workflow
      const step1_v2 = await llmManager.executeWithPrompt('analyze-step1', {
        input: 'Initial data'
      });

      const step2_v2 = await llmManager.executeWithPrompt('analyze-step2', {
        step1_result: step1_v2.content
      });

      // Verify version progression
      expect(step1_v1.promptMetadata.promptVersion).toBe('1.0.0');
      expect(step2_v1.promptMetadata.promptVersion).toBe('1.0.0');
      expect(step1_v2.promptMetadata.promptVersion).toBe('1.0.1');
      expect(step2_v2.promptMetadata.promptVersion).toBe('1.0.1');
    });
  });

  describe('Error Recovery and Edge Cases', () => {
    it('should handle missing variable substitution gracefully', async () => {
      const promptWithMissingVars = {
        content: 'Process {{available_var}} and also {{missing_var}}',
        metadata: { description: 'Test missing variables' }
      };

      await llmManager.savePrompt('missing-vars', promptWithMissingVars);

      // Execute with only partial variables
      const result = await llmManager.executeWithPrompt('missing-vars', {
        available_var: 'provided value'
      });

      expect(result.promptMetadata.promptId).toBe('missing-vars');
      expect(result.promptMetadata.variables.available_var).toBe('provided value');
      // Should still execute despite missing variable
      expect(result.content).toBeDefined();
    });

    it('should handle prompt execution failures gracefully', async () => {
      // Mock fetch to fail
      global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

      const testPrompt = {
        content: 'This will fail: {{input}}',
        metadata: { description: 'Failure test' }
      };

      await llmManager.savePrompt('fail-test', testPrompt);

      await expect(llmManager.executeWithPrompt('fail-test', { input: 'test' }))
        .rejects.toThrow();
    });

    it('should handle large prompt content', async () => {
      // Create a large prompt
      const largeContent = 'Analyze the following large document: {{content}}\n' + 
        'Additional instructions: '.repeat(100) + 
        'Please provide detailed analysis covering all aspects mentioned above.';

      const largePrompt = {
        content: largeContent,
        metadata: { description: 'Large prompt test' }
      };

      const saved = await llmManager.savePrompt('large-prompt', largePrompt);
      expect(saved.content.length).toBeGreaterThan(1000);

      // Execute with large content
      const largeDocument = 'Document content: '.repeat(200);
      const result = await llmManager.executeWithPrompt('large-prompt', {
        content: largeDocument
      });

      expect(result.promptMetadata.promptId).toBe('large-prompt');
    });
  });

  describe('Performance and Concurrency', () => {
    it('should handle concurrent prompt executions', async () => {
      // Create test prompt
      await llmManager.savePrompt('concurrent-test', {
        content: 'Process: {{data}}',
        metadata: { description: 'Concurrency test' }
      });

      // Execute multiple prompts concurrently
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(
          llmManager.executeWithPrompt('concurrent-test', {
            data: `Dataset ${i}`
          })
        );
      }

      const results = await Promise.all(promises);

      expect(results).toHaveLength(5);
      results.forEach((result, index) => {
        expect(result.promptMetadata.promptId).toBe('concurrent-test');
        expect(result.promptMetadata.variables.data).toBe(`Dataset ${index}`);
      });
    });

    it('should maintain prompt integrity under concurrent updates', async () => {
      // Create initial prompt
      await llmManager.savePrompt('update-test', {
        content: 'Version 0',
        metadata: { description: 'Update test' }
      });

      // Concurrent updates
      const updatePromises = [];
      for (let i = 1; i <= 3; i++) {
        updatePromises.push(
          llmManager.savePrompt('update-test', {
            content: `Version ${i}`,
            metadata: { description: `Update test v${i}` }
          })
        );
      }

      const updates = await Promise.all(updatePromises);

      // Verify final state
      const finalPrompt = await llmManager.getPrompt('update-test');
      expect(finalPrompt.version).toMatch(/^1\.0\.[1-3]$/); // Should be one of the versions
      
      // All updates should have different versions
      const versions = updates.map(u => u.version);
      const uniqueVersions = new Set(versions);
      expect(uniqueVersions.size).toBe(3); // All versions should be unique
    });
  });
});
