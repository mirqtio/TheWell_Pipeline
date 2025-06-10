/**
 * Unit Tests for PromptTemplateManager
 * Git-based prompt versioning system with template storage and output linking
 */

const path = require('path');
const fs = require('fs');
const PromptTemplateManager = require('../../../src/enrichment/PromptTemplateManager');

describe('PromptTemplateManager', () => {
  let promptManager;
  const testRepoPath = path.join(__dirname, '../../../temp/test-prompts');

  beforeEach(async () => {
    // Clean up test repository
    if (fs.existsSync(testRepoPath)) {
      fs.rmSync(testRepoPath, { recursive: true, force: true });
    }
    
    promptManager = new PromptTemplateManager({
      repoPath: testRepoPath,
      autoInit: true
    });
    
    await promptManager.initialize();
  });

  afterEach(async () => {
    if (promptManager) {
      await promptManager.cleanup();
    }
  });

  describe('initialization', () => {
    test('should initialize git repository', async () => {
      expect(fs.existsSync(path.join(testRepoPath, '.git'))).toBe(true);
    });

    test('should create prompts directory structure', async () => {
      expect(fs.existsSync(path.join(testRepoPath, 'prompts'))).toBe(true);
      expect(fs.existsSync(path.join(testRepoPath, 'templates'))).toBe(true);
      expect(fs.existsSync(path.join(testRepoPath, 'versions'))).toBe(true);
    });
  });

  describe('template storage', () => {
    test('should store new prompt template', async () => {
      const template = {
        name: 'test-summarization',
        version: '1.0.0',
        template: 'Summarize the following text: {{content}}',
        variables: ['content'],
        metadata: {
          author: 'test-user',
          description: 'Test summarization prompt'
        }
      };

      const result = await promptManager.storeTemplate(template);
      
      expect(result.success).toBe(true);
      expect(result.version).toBe('1.0.0');
      expect(result.commitHash).toBeDefined();
      expect(result.filepath).toContain('test-summarization');
    });

    test('should validate template structure', async () => {
      const invalidTemplate = {
        name: 'invalid',
        // missing required fields
      };

      await expect(promptManager.storeTemplate(invalidTemplate))
        .rejects.toThrow('Template validation failed');
    });

    test('should auto-increment version for existing templates', async () => {
      const template = {
        name: 'versioning-test',
        template: 'Original template: {{input}}',
        variables: ['input']
      };

      // Store first version
      const v1 = await promptManager.storeTemplate(template);
      expect(v1.version).toBe('1.0.0');

      // Store updated version
      template.template = 'Updated template: {{input}}';
      const v2 = await promptManager.storeTemplate(template);
      expect(v2.version).toBe('1.0.1');
    });
  });

  describe('template retrieval', () => {
    beforeEach(async () => {
      // Setup test templates
      await promptManager.storeTemplate({
        name: 'retrieval-test',
        template: 'Test template: {{data}}',
        variables: ['data'],
        metadata: { category: 'test' }
      });
    });

    test('should retrieve latest template version', async () => {
      const template = await promptManager.getTemplate('retrieval-test');
      
      expect(template.name).toBe('retrieval-test');
      expect(template.template).toBe('Test template: {{data}}');
      expect(template.version).toBe('1.0.0');
      expect(template.variables).toEqual(['data']);
    });

    test('should retrieve specific template version', async () => {
      // Store another version
      await promptManager.storeTemplate({
        name: 'retrieval-test',
        template: 'Updated template: {{data}}',
        variables: ['data']
      });

      const v1 = await promptManager.getTemplate('retrieval-test', '1.0.0');
      const v2 = await promptManager.getTemplate('retrieval-test', '1.0.1');

      expect(v1.template).toBe('Test template: {{data}}');
      expect(v2.template).toBe('Updated template: {{data}}');
    });

    test('should list all template versions', async () => {
      // Add more versions
      await promptManager.storeTemplate({
        name: 'retrieval-test',
        template: 'Version 2: {{data}}',
        variables: ['data']
      });

      const versions = await promptManager.getTemplateVersions('retrieval-test');
      
      expect(versions).toHaveLength(2);
      expect(versions[0].version).toBe('1.0.1'); // Latest first
      expect(versions[1].version).toBe('1.0.0');
    });
  });

  describe('template validation', () => {
    test('should validate template syntax', () => {
      const validTemplate = 'Hello {{name}}, your score is {{score}}';
      const result = promptManager.validateTemplate(validTemplate);
      
      expect(result.valid).toBe(true);
      expect(result.variables).toEqual(['name', 'score']);
    });

    test('should detect invalid template syntax', () => {
      const invalidTemplate = 'Hello {{name}, unclosed variable';
      const result = promptManager.validateTemplate(invalidTemplate);
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Unclosed variable brackets detected');
    });

    test('should enforce schema requirements', async () => {
      const template = {
        name: '', // Invalid: empty name
        template: 'Valid template: {{input}}',
        variables: ['input']
      };

      await expect(promptManager.storeTemplate(template))
        .rejects.toThrow('Template name is required');
    });
  });

  describe('output linking', () => {
    beforeEach(async () => {
      await promptManager.storeTemplate({
        name: 'link-test',
        template: 'Process: {{input}}',
        variables: ['input']
      });
    });

    test('should link template to enrichment output', async () => {
      const templateVersion = await promptManager.getTemplate('link-test');
      const outputMetadata = {
        documentId: 'doc-123',
        enrichmentType: 'summarization',
        timestamp: new Date().toISOString(),
        result: 'Generated summary text'
      };

      const linkResult = await promptManager.linkToOutput(
        templateVersion.id,
        templateVersion.version,
        outputMetadata
      );

      expect(linkResult.success).toBe(true);
      expect(linkResult.linkId).toBeDefined();
    });

    test('should retrieve outputs linked to template', async () => {
      const template = await promptManager.getTemplate('link-test');
      
      // Link multiple outputs
      await promptManager.linkToOutput(template.id, template.version, {
        documentId: 'doc-1',
        enrichmentType: 'summary',
        timestamp: new Date().toISOString()
      });
      
      await promptManager.linkToOutput(template.id, template.version, {
        documentId: 'doc-2', 
        enrichmentType: 'summary',
        timestamp: new Date().toISOString()
      });

      const linkedOutputs = await promptManager.getLinkedOutputs(template.id, template.version);
      
      expect(linkedOutputs).toHaveLength(2);
      expect(linkedOutputs[0].documentId).toBeDefined();
      expect(linkedOutputs[1].documentId).toBeDefined();
    });
  });

  describe('version rollback', () => {
    test('should rollback to previous version', async () => {
      const template = {
        name: 'rollback-test',
        template: 'Version 1: {{input}}',
        variables: ['input']
      };

      // Store multiple versions
      const v1 = await promptManager.storeTemplate(template);
      
      template.template = 'Version 2: {{input}}';
      await promptManager.storeTemplate(template);

      template.template = 'Version 3: {{input}}';
      await promptManager.storeTemplate(template);

      // Rollback to v1
      const rollbackResult = await promptManager.rollbackToVersion('rollback-test', v1.version);
      
      expect(rollbackResult.success).toBe(true);
      expect(rollbackResult.rolledBackTo).toBe(v1.version);

      // Verify current version is now v1 content
      const current = await promptManager.getTemplate('rollback-test');
      expect(current.template).toBe('Version 1: {{input}}');
    });

    test('should handle rollback to non-existent version', async () => {
      await expect(promptManager.rollbackToVersion('nonexistent', '999.0.0'))
        .rejects.toThrow('Version 999.0.0 not found');
    });
  });

  describe('git integration', () => {
    test('should create commit for each template change', async () => {
      await promptManager.storeTemplate({
        name: 'git-test',
        template: 'Git template: {{data}}',
        variables: ['data']
      });

      const commits = await promptManager.getCommitHistory('git-test');
      
      expect(commits).toHaveLength(1);
      expect(commits[0].message).toContain('Add template: git-test');
      expect(commits[0].hash).toBeDefined();
      expect(commits[0].author).toBeDefined();
      expect(commits[0].date).toBeDefined();
    });

    test('should track template changes in git log', async () => {
      const template = {
        name: 'change-tracking',
        template: 'Original: {{input}}',
        variables: ['input']
      };

      await promptManager.storeTemplate(template);
      
      template.template = 'Modified: {{input}}';
      await promptManager.storeTemplate(template);

      const commits = await promptManager.getCommitHistory('change-tracking');
      
      expect(commits).toHaveLength(2);
      expect(commits[0].message).toContain('Update template: change-tracking');
      expect(commits[1].message).toContain('Add template: change-tracking');
    });
  });
});