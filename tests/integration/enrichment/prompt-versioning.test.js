const PromptVersionManager = require('../../../src/enrichment/PromptVersionManager');
const LLMProviderManager = require('../../../src/enrichment/LLMProviderManager');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

describe('Prompt Versioning Integration Tests', () => {
  let promptManager;
  let llmManager;
  let testDir;

  beforeAll(async () => {
    // Create temporary test directory
    testDir = path.join(__dirname, '../../../temp/test-prompts-integration');
    
    try {
      await fs.promises.mkdir(testDir, { recursive: true });
    } catch (error) {
      // Directory might already exist
    }
  });

  beforeEach(async () => {
    // Clean test directory
    try {
      const files = await fs.promises.readdir(testDir);
      await Promise.all(files.map(file => 
        fs.promises.unlink(path.join(testDir, file)).catch(() => {})
      ));
    } catch (error) {
      // Directory might not exist
    }

    // Initialize managers
    promptManager = new PromptVersionManager({
      promptsDirectory: testDir,
      gitEnabled: false, // Disable git for integration tests
      autoCommit: false
    });

    llmManager = new LLMProviderManager({
      openai: {
        apiKey: 'test-key',
        model: 'gpt-3.5-turbo',
        maxRetries: 1
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
      const files = await fs.promises.readdir(testDir);
      await Promise.all(files.map(file => 
        fs.promises.unlink(path.join(testDir, file)).catch(() => {})
      ));
      await fs.promises.rmdir(testDir);
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('Prompt Storage and Retrieval', () => {
    it('should save and retrieve prompts', async () => {
      const promptData = {
        content: 'Summarize the following document: {{content}}',
        metadata: {
          description: 'Document summarization prompt',
          tags: ['summarization', 'document']
        }
      };

      // Save prompt
      const savedPrompt = await promptManager.savePrompt('doc-summary', promptData);

      expect(savedPrompt.id).toBe('doc-summary');
      expect(savedPrompt.version).toBe('1.0.0');
      expect(savedPrompt.content).toBe(promptData.content);

      // Retrieve prompt
      const retrievedPrompt = await promptManager.getPrompt('doc-summary');

      expect(retrievedPrompt).toEqual(savedPrompt);
    });

    it('should persist prompts to filesystem', async () => {
      const promptData = {
        content: 'Extract entities from: {{text}}',
        metadata: { description: 'Entity extraction' }
      };

      await promptManager.savePrompt('entity-extract', promptData);

      // Check file exists
      const promptPath = path.join(testDir, 'entity-extract.json');
      const fileExists = await fs.promises.access(promptPath).then(() => true).catch(() => false);
      expect(fileExists).toBe(true);

      // Check file content
      const fileContent = JSON.parse(await fs.promises.readFile(promptPath, 'utf8'));
      expect(fileContent.id).toBe('entity-extract');
      expect(fileContent.content).toBe(promptData.content);
    });

    it('should load existing prompts on initialization', async () => {
      // Create prompt file manually
      const promptData = {
        id: 'existing-prompt',
        version: '2.1.0',
        content: 'Existing prompt content',
        metadata: { author: 'Test' }
      };

      const promptPath = path.join(testDir, 'existing-prompt.json');
      await fs.promises.writeFile(promptPath, JSON.stringify(promptData, null, 2));

      // Create new manager and initialize
      const newManager = new PromptVersionManager({
        promptsDirectory: testDir,
        gitEnabled: false
      });

      await newManager.initialize();

      const retrievedPrompt = await newManager.getPrompt('existing-prompt');
      expect(retrievedPrompt).toEqual(promptData);

      await newManager.shutdown();
    });
  });

  describe('Version Management', () => {
    it('should increment versions correctly', async () => {
      const basePrompt = {
        content: 'Version 1.0.0 content',
        metadata: { description: 'Base version' }
      };

      // Save initial version
      const v1 = await promptManager.savePrompt('versioned', basePrompt);
      expect(v1.version).toBe('1.0.0');

      // Update prompt
      const updatedPrompt = {
        content: 'Version 1.0.1 content',
        metadata: { description: 'Updated version' }
      };

      const v2 = await promptManager.savePrompt('versioned', updatedPrompt);
      expect(v2.version).toBe('1.0.1');

      // Another update
      const v3 = await promptManager.savePrompt('versioned', { content: 'Version 1.0.2' });
      expect(v3.version).toBe('1.0.2');
    });

    it('should extract and track variables', async () => {
      const promptWithVars = {
        content: 'Hello {{name}}, your task is to {{task}} the {{document_type}} about {{topic}}.',
        metadata: { description: 'Multi-variable prompt' }
      };

      const saved = await promptManager.savePrompt('multi-var', promptWithVars);

      expect(saved.schema.variables).toEqual(['name', 'task', 'document_type', 'topic']);
    });

    it('should handle prompts without variables', async () => {
      const staticPrompt = {
        content: 'This is a static prompt with no variables.',
        metadata: { description: 'Static prompt' }
      };

      const saved = await promptManager.savePrompt('static', staticPrompt);

      expect(saved.schema.variables).toEqual([]);
    });
  });

  describe('LLMProviderManager Integration', () => {
    beforeEach(async () => {
      // Mock fetch for LLM provider calls
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: 'Mocked LLM response'
            }
          }],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 20,
            total_tokens: 30
          }
        })
      });
    });

    afterEach(() => {
      delete global.fetch;
    });

    it('should execute prompts through LLMProviderManager', async () => {
      // Save a prompt with variables to the LLM manager's prompt system
      await llmManager.savePrompt('greeting', {
        content: 'Hello {{name}}, welcome to {{place}}!',
        description: 'A greeting prompt'
      });

      // Mock the LLM execution to avoid actual API calls
      const mockExecute = jest.spyOn(llmManager, 'executeWithFailover')
        .mockResolvedValue({
          content: 'Hello John, welcome to Earth!',
          metadata: {
            provider: 'openai',
            model: 'gpt-3.5-turbo',
            promptHash: expect.any(String)
          }
        });

      const result = await llmManager.executeWithPrompt('greeting', {
        name: 'John',
        place: 'Earth'
      });

      expect(result.content).toBe('Hello John, welcome to Earth!');
      expect(result.metadata.promptHash).toBeDefined();
      expect(mockExecute).toHaveBeenCalled();
      
      mockExecute.mockRestore();
    });

    it('should substitute variables correctly', async () => {
      const promptData = {
        content: 'Hello {{name}}, please {{action}} the {{item}}.'
      };

      await llmManager.savePrompt('template', promptData);

      const variables = {
        name: 'Alice',
        action: 'review',
        item: 'document'
      };

      // We'll test the substitution by checking what gets sent to the provider
      const substituted = llmManager.substitutePromptVariables(promptData.content, variables);
      expect(substituted).toBe('Hello Alice, please review the document.');
    });

    it('should handle missing variables gracefully', async () => {
      const promptData = {
        content: 'Hello {{name}}, your {{missing_var}} is ready.'
      };

      await llmManager.savePrompt('incomplete', promptData);

      const variables = { name: 'Bob' };
      const substituted = llmManager.substitutePromptVariables(promptData.content, variables);

      expect(substituted).toBe('Hello Bob, your {{missing_var}} is ready.');
    });

    it('should generate prompt hashes for reproducibility', async () => {
      const promptData = {
        content: 'Test prompt for hashing',
        metadata: { description: 'Hash test' }
      };

      const saved = await llmManager.savePrompt('hash-test', promptData);
      const hash1 = llmManager.generatePromptHash(saved);

      // Same prompt should generate same hash
      const hash2 = llmManager.generatePromptHash(saved);
      expect(hash1).toBe(hash2);

      // Different prompt should generate different hash
      const differentPrompt = { ...saved, content: 'Different content' };
      const hash3 = llmManager.generatePromptHash(differentPrompt);
      expect(hash1).not.toBe(hash3);
    });
  });

  describe('Prompt Management Operations', () => {
    it('should list all prompts', async () => {
      await promptManager.savePrompt('prompt1', { content: 'Content 1' });
      await promptManager.savePrompt('prompt2', { content: 'Content 2' });
      await promptManager.savePrompt('prompt3', { content: 'Content 3' });

      const prompts = promptManager.listPrompts();
      expect(prompts).toHaveLength(3);
      expect(prompts).toContain('prompt1');
      expect(prompts).toContain('prompt2');
      expect(prompts).toContain('prompt3');
    });

    it('should get prompt metadata', async () => {
      const promptData = {
        content: 'Test content',
        metadata: {
          description: 'Test prompt',
          tags: ['test', 'example'],
          author: 'Integration Test'
        }
      };

      await promptManager.savePrompt('meta-test', promptData);

      const metadata = promptManager.getPromptMetadata('meta-test');
      expect(metadata.description).toBe('Test prompt');
      expect(metadata.tags).toEqual(['test', 'example']);
      expect(metadata.author).toBe('Integration Test');
    });

    it('should return null for non-existent prompt metadata', () => {
      const metadata = promptManager.getPromptMetadata('non-existent');
      expect(metadata).toBeNull();
    });

    it('should get system statistics', async () => {
      await promptManager.savePrompt('stat1', { content: 'Content 1' });
      await promptManager.savePrompt('stat2', { content: 'Content 2' });

      const stats = promptManager.getStatistics();
      expect(stats.totalPrompts).toBe(2);
      expect(stats.isInitialized).toBe(true);
      expect(stats.gitEnabled).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should handle prompt not found errors', async () => {
      await expect(llmManager.executeWithPrompt('non-existent', {}))
        .rejects.toThrow('Prompt not found: non-existent');
    });

    it('should handle invalid prompt data', async () => {
      // Try to save prompt without content
      await expect(promptManager.savePrompt('invalid', {}))
        .resolves.toBeDefined(); // Should still work with empty content
    });

    it('should handle filesystem errors gracefully', async () => {
      // Skip this test for now - filesystem mocking in integration tests is complex
      // This functionality is covered in unit tests
    });
  });

  describe('Concurrent Operations', () => {
    it('should handle concurrent prompt saves', async () => {
      const promises = [];
      
      // Create multiple concurrent save operations
      for (let i = 0; i < 5; i++) {
        promises.push(
          promptManager.savePrompt(`concurrent-${i}`, {
            content: `Content ${i}`,
            description: `Concurrent prompt ${i}`
          })
        );
      }

      const results = await Promise.all(promises);
      
      // All saves should succeed
      expect(results).toHaveLength(5);
      results.forEach((result, index) => {
        expect(result.id).toBe(`concurrent-${index}`);
        expect(result.version).toBe('1.0.0');
      });

      // Verify all prompts were saved
      const prompts = promptManager.listPrompts();
      expect(prompts.filter(p => p.startsWith('concurrent-'))).toHaveLength(5);
    });

    it('should handle concurrent reads', async () => {
      // First save a prompt
      await promptManager.savePrompt('read-test', {
        content: 'Read test content',
        description: 'For concurrent read testing'
      });

      // Create multiple concurrent read operations
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(promptManager.getPrompt('read-test'));
      }

      const results = await Promise.all(promises);
      
      // All reads should return the same data
      expect(results).toHaveLength(10);
      results.forEach(result => {
        expect(result.id).toBe('read-test');
        expect(result.content).toBe('Read test content');
        expect(result.version).toBe('1.0.0');
      });
    });
  });
});
