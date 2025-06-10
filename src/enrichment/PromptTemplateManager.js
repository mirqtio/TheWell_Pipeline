/**
 * Prompt Template Management System
 * Git-based prompt versioning with template storage and output linking
 */

const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const { execSync, exec } = require('child_process');
const crypto = require('crypto');
const semver = require('semver');
const logger = require('../utils/logger');

class PromptTemplateManager {
  constructor(options = {}) {
    this.config = {
      repoPath: options.repoPath || path.join(process.cwd(), 'prompt-templates'),
      autoInit: options.autoInit !== false,
      author: options.author || 'TheWell Pipeline',
      email: options.email || 'system@thewell.com',
      ...options
    };

    this.isInitialized = false;
    this.templateCache = new Map();
    this.outputLinks = new Map();
  }

  /**
   * Initialize the git repository and directory structure
   */
  async initialize() {
    try {
      // Ensure repository directory exists
      await fs.mkdir(this.config.repoPath, { recursive: true });

      // Initialize git repository if it doesn't exist
      const gitDir = path.join(this.config.repoPath, '.git');
      if (!fsSync.existsSync(gitDir)) {
        await this._execGit('init');
        
        // Configure git user
        await this._execGit(`config user.name "${this.config.author}"`);
        await this._execGit(`config user.email "${this.config.email}"`);

        // Create initial directory structure
        await this._createDirectoryStructure();
        
        // Create initial commit
        await this._execGit('add .');
        await this._execGit('commit -m "Initial prompt template repository setup"');
      }

      // Load existing templates into cache
      await this._loadTemplateCache();

      this.isInitialized = true;
      logger.info('PromptTemplateManager initialized successfully', {
        repoPath: this.config.repoPath
      });

    } catch (error) {
      logger.error('Failed to initialize PromptTemplateManager', { error: error.message });
      throw new Error(`Failed to initialize PromptTemplateManager: ${error.message}`);
    }
  }

  /**
   * Store a new template or update existing one
   */
  async storeTemplate(template) {
    if (!this.isInitialized) {
      throw new Error('PromptTemplateManager not initialized');
    }

    try {
      // Validate template
      const validationResult = this._validateTemplateObject(template);
      if (!validationResult.valid) {
        throw new Error(`Template validation failed: ${validationResult.errors.join(', ')}`);
      }

      // Generate template ID and determine version
      const templateId = this._generateTemplateId(template.name);
      const currentVersion = await this._getCurrentVersion(template.name);
      const newVersion = template.version || this._incrementVersion(currentVersion);

      // Validate template syntax
      const syntaxValidation = this.validateTemplate(template.template);
      if (!syntaxValidation.valid) {
        throw new Error(`Template syntax validation failed: ${syntaxValidation.errors.join(', ')}`);
      }

      // Create template object with metadata
      const templateObject = {
        id: templateId,
        name: template.name,
        version: newVersion,
        template: template.template,
        variables: template.variables || syntaxValidation.variables,
        metadata: {
          author: template.metadata?.author || this.config.author,
          description: template.metadata?.description || '',
          category: template.metadata?.category || 'general',
          tags: template.metadata?.tags || [],
          provider: template.metadata?.provider,
          model: template.metadata?.model,
          maxTokens: template.metadata?.maxTokens,
          createdAt: new Date().toISOString(),
          ...template.metadata
        },
        schema: {
          version: '1.0.0',
          requiredFields: ['name', 'template', 'variables'],
          validationRules: syntaxValidation.rules || []
        }
      };

      // Save template to filesystem
      const templatePath = await this._saveTemplateToFile(templateObject);

      // Commit to git
      const commitMessage = currentVersion ? 
        `Update template: ${template.name} (v${newVersion})` : 
        `Add template: ${template.name} (v${newVersion})`;
      
      await this._execGit(`add "${templatePath}"`);
      const commitHash = await this._commitTemplate(commitMessage, templateObject);

      // Update cache
      this.templateCache.set(templateId, templateObject);

      logger.info('Template stored successfully', {
        name: template.name,
        version: newVersion,
        templateId,
        commitHash
      });

      return {
        success: true,
        templateId,
        version: newVersion,
        commitHash,
        filepath: templatePath
      };

    } catch (error) {
      logger.error('Failed to store template', { 
        templateName: template.name,
        error: error.message 
      });
      throw error;
    }
  }

  /**
   * Retrieve a template by name and optional version
   */
  async getTemplate(name, version = null) {
    if (!this.isInitialized) {
      throw new Error('PromptTemplateManager not initialized');
    }

    try {
      const templateId = this._generateTemplateId(name);
      
      if (version) {
        // Get specific version from git history
        return await this._getTemplateFromGit(name, version);
      } else {
        // Get latest version from cache or filesystem
        if (this.templateCache.has(templateId)) {
          return this.templateCache.get(templateId);
        }

        // Load from filesystem if not in cache
        const template = await this._loadTemplateFromFile(name);
        if (template) {
          this.templateCache.set(templateId, template);
        }
        return template;
      }

    } catch (error) {
      logger.error('Failed to retrieve template', { name, version, error: error.message });
      throw new Error(`Template not found: ${name}${version ? ` v${version}` : ''}`);
    }
  }

  /**
   * Get all versions of a template
   */
  async getTemplateVersions(name) {
    if (!this.isInitialized) {
      throw new Error('PromptTemplateManager not initialized');
    }

    try {
      const templatePath = this._getTemplatePath(name);
      const gitLog = await this._execGit(`log --oneline --follow -- "${templatePath}"`);
      
      const commits = gitLog.trim().split('\n').filter(line => line.trim());
      const versions = [];

      for (const commit of commits) {
        const [hash] = commit.split(' ');
        try {
          const template = await this._getTemplateFromCommit(hash, name);
          if (template) {
            versions.push({
              version: template.version,
              commitHash: hash,
              createdAt: template.metadata?.createdAt,
              author: template.metadata?.author,
              description: template.metadata?.description
            });
          }
        } catch (error) {
          // Skip commits that don't contain valid template data
          logger.warn('Skipping invalid template commit', { hash, name, error: error.message });
        }
      }

      // Sort by version (latest first)
      versions.sort((a, b) => semver.rcompare(a.version, b.version));

      return versions;

    } catch (error) {
      logger.error('Failed to get template versions', { name, error: error.message });
      throw error;
    }
  }

  /**
   * Validate template syntax and extract variables
   */
  validateTemplate(templateText) {
    const errors = [];
    const variables = [];
    const rules = [];

    try {
      // Check for basic template structure
      if (!templateText || typeof templateText !== 'string') {
        errors.push('Template must be a non-empty string');
        return { valid: false, errors, variables, rules };
      }

      // Extract variables using regex for {{variable}} pattern
      const variablePattern = /\{\{([^}]+)\}\}/g;
      let match;
      const foundVariables = new Set();

      while ((match = variablePattern.exec(templateText)) !== null) {
        const variableName = match[1].trim();
        
        // Validate variable name
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(variableName)) {
          errors.push(`Invalid variable name: ${variableName}`);
        } else {
          foundVariables.add(variableName);
        }
      }

      variables.push(...Array.from(foundVariables));

      // Check for unclosed variables
      const openBraces = (templateText.match(/\{\{/g) || []).length;
      const closeBraces = (templateText.match(/\}\}/g) || []).length;
      
      if (openBraces !== closeBraces) {
        errors.push('Unclosed variable brackets detected');
      }

      // Check for nested variables (not supported)
      const nestedPattern = /\{\{[^}]*\{\{/g;
      if (nestedPattern.test(templateText)) {
        errors.push('Nested variables are not supported');
      }

      // Add validation rules
      rules.push({
        rule: 'variable_format',
        description: 'Variables must use {{variable}} format',
        pattern: variablePattern.source
      });

      return {
        valid: errors.length === 0,
        errors,
        variables,
        rules
      };

    } catch (error) {
      errors.push(`Template validation error: ${error.message}`);
      return { valid: false, errors, variables, rules };
    }
  }

  /**
   * Link template to enrichment output
   */
  async linkToOutput(templateId, version, outputMetadata) {
    if (!this.isInitialized) {
      throw new Error('PromptTemplateManager not initialized');
    }

    try {
      const linkId = crypto.randomUUID();
      const link = {
        linkId,
        templateId,
        templateVersion: version,
        outputMetadata: {
          ...outputMetadata,
          linkedAt: new Date().toISOString()
        }
      };

      // Store link in memory and persist to file
      const linkKey = `${templateId}-${version}`;
      if (!this.outputLinks.has(linkKey)) {
        this.outputLinks.set(linkKey, []);
      }
      this.outputLinks.get(linkKey).push(link);

      // Persist links to filesystem
      await this._persistOutputLinks();

      logger.info('Template linked to output', {
        templateId,
        version,
        linkId,
        documentId: outputMetadata.documentId
      });

      return {
        success: true,
        linkId
      };

    } catch (error) {
      logger.error('Failed to link template to output', {
        templateId,
        version,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get outputs linked to a template version
   */
  async getLinkedOutputs(templateId, version) {
    if (!this.isInitialized) {
      throw new Error('PromptTemplateManager not initialized');
    }

    try {
      const linkKey = `${templateId}-${version}`;
      const links = this.outputLinks.get(linkKey) || [];
      
      return links.map(link => link.outputMetadata);

    } catch (error) {
      logger.error('Failed to get linked outputs', {
        templateId,
        version,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Rollback template to a previous version
   */
  async rollbackToVersion(name, targetVersion) {
    if (!this.isInitialized) {
      throw new Error('PromptTemplateManager not initialized');
    }

    try {
      // Get the target version template
      const targetTemplate = await this._getTemplateFromGit(name, targetVersion);
      if (!targetTemplate) {
        throw new Error('Template or version not found');
      }

      // Create new version with rollback content
      const currentVersion = await this._getCurrentVersion(name);
      const newVersion = this._incrementVersion(currentVersion);
      
      const rollbackTemplate = {
        ...targetTemplate,
        version: newVersion,
        metadata: {
          ...targetTemplate.metadata,
          rolledBackFrom: currentVersion,
          rolledBackTo: targetVersion,
          rolledBackAt: new Date().toISOString(),
          rollbackReason: `Rollback from v${currentVersion} to v${targetVersion}`
        }
      };

      // Save rolled back template
      const templatePath = await this._saveTemplateToFile(rollbackTemplate);
      
      // Commit rollback
      const commitMessage = `Rollback template: ${name} from v${currentVersion} to v${targetVersion}`;
      await this._execGit(`add "${templatePath}"`);
      await this._commitTemplate(commitMessage, rollbackTemplate);

      // Update cache
      const templateId = this._generateTemplateId(name);
      this.templateCache.set(templateId, rollbackTemplate);

      logger.info('Template rolled back successfully', {
        name,
        rolledBackFrom: currentVersion,
        rolledBackTo: targetVersion,
        newVersion
      });

      return {
        success: true,
        rolledBackFrom: currentVersion,
        rolledBackTo: targetVersion,
        newVersion
      };

    } catch (error) {
      logger.error('Failed to rollback template', {
        name,
        targetVersion,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get commit history for a template
   */
  async getCommitHistory(name) {
    if (!this.isInitialized) {
      throw new Error('PromptTemplateManager not initialized');
    }

    try {
      const templatePath = this._getTemplatePath(name);
      const gitLog = await this._execGit(`log --pretty=format:"%H|%an|%ae|%ad|%s" --date=iso -- "${templatePath}"`);
      
      const commits = gitLog.trim().split('\n').filter(line => line.trim());
      
      return commits.map(commit => {
        const [hash, author, email, date, message] = commit.split('|');
        return {
          hash,
          author,
          email,
          date: new Date(date).toISOString(),
          message
        };
      });

    } catch (error) {
      logger.error('Failed to get commit history', { name, error: error.message });
      throw error;
    }
  }

  /**
   * Search templates by criteria
   */
  async searchTemplates(criteria = {}) {
    if (!this.isInitialized) {
      throw new Error('PromptTemplateManager not initialized');
    }

    try {
      const allTemplates = Array.from(this.templateCache.values());
      let results = [...allTemplates];

      // Filter by category
      if (criteria.category) {
        results = results.filter(template => 
          template.metadata?.category === criteria.category
        );
      }

      // Filter by tags
      if (criteria.tags && criteria.tags.length > 0) {
        results = results.filter(template => {
          const templateTags = template.metadata?.tags || [];
          return criteria.tags.some(tag => templateTags.includes(tag));
        });
      }

      // Filter by text content
      if (criteria.text) {
        const searchText = criteria.text.toLowerCase();
        results = results.filter(template =>
          template.template.toLowerCase().includes(searchText) ||
          template.name.toLowerCase().includes(searchText) ||
          (template.metadata?.description || '').toLowerCase().includes(searchText)
        );
      }

      // Filter by variables
      if (criteria.variables && criteria.variables.length > 0) {
        results = results.filter(template => {
          return criteria.variables.every(variable => 
            template.variables.includes(variable)
          );
        });
      }

      return results.map(template => ({
        id: template.id,
        name: template.name,
        version: template.version,
        template: template.template,
        variables: template.variables,
        metadata: template.metadata
      }));

    } catch (error) {
      logger.error('Failed to search templates', { criteria, error: error.message });
      throw error;
    }
  }

  /**
   * Create backup of template repository
   */
  async createBackup(backupPath) {
    if (!this.isInitialized) {
      throw new Error('PromptTemplateManager not initialized');
    }

    try {
      await fs.mkdir(backupPath, { recursive: true });
      
      // Copy entire repository
      await this._execGit(`clone "${this.config.repoPath}" "${backupPath}"`);

      logger.info('Backup created successfully', { backupPath });

      return {
        success: true,
        backupPath,
        createdAt: new Date().toISOString()
      };

    } catch (error) {
      logger.error('Failed to create backup', { backupPath, error: error.message });
      throw error;
    }
  }

  /**
   * Restore from backup
   */
  async restoreFromBackup(backupPath) {
    try {
      if (!fsSync.existsSync(backupPath)) {
        throw new Error('Backup path does not exist');
      }

      // Remove current repository
      if (fsSync.existsSync(this.config.repoPath)) {
        await fs.rm(this.config.repoPath, { recursive: true, force: true });
      }

      // Copy backup to repository path
      await fs.mkdir(path.dirname(this.config.repoPath), { recursive: true });
      execSync(`cp -r "${backupPath}" "${this.config.repoPath}"`);

      // Reinitialize
      await this.initialize();

      logger.info('Restored from backup successfully', { backupPath });

      return {
        success: true,
        restoredFrom: backupPath,
        restoredAt: new Date().toISOString()
      };

    } catch (error) {
      logger.error('Failed to restore from backup', { backupPath, error: error.message });
      throw error;
    }
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    try {
      // Clear caches
      this.templateCache.clear();
      this.outputLinks.clear();
      
      this.isInitialized = false;
      
      logger.info('PromptTemplateManager cleanup completed');

    } catch (error) {
      logger.error('Failed to cleanup PromptTemplateManager', { error: error.message });
      throw error;
    }
  }

  // Private methods

  async _createDirectoryStructure() {
    const dirs = ['prompts', 'templates', 'versions', 'links'];
    
    for (const dir of dirs) {
      await fs.mkdir(path.join(this.config.repoPath, dir), { recursive: true });
    }

    // Create README
    const readme = `# Prompt Template Repository

This repository contains versioned prompt templates for TheWell Pipeline.

## Structure
- \`prompts/\` - Individual prompt template files
- \`templates/\` - Template collections and categories
- \`versions/\` - Version metadata and history
- \`links/\` - Output linkage tracking

Generated by PromptTemplateManager
`;

    await fs.writeFile(path.join(this.config.repoPath, 'README.md'), readme);
  }

  async _loadTemplateCache() {
    try {
      const promptsDir = path.join(this.config.repoPath, 'prompts');
      
      if (!fsSync.existsSync(promptsDir)) {
        return;
      }

      const files = await fs.readdir(promptsDir);
      const jsonFiles = files.filter(file => file.endsWith('.json'));

      for (const file of jsonFiles) {
        try {
          const filePath = path.join(promptsDir, file);
          const content = await fs.readFile(filePath, 'utf8');
          const template = JSON.parse(content);
          
          if (template.id) {
            this.templateCache.set(template.id, template);
          }
        } catch (error) {
          logger.warn('Failed to load template from cache', { file, error: error.message });
        }
      }

      // Load output links
      await this._loadOutputLinks();

    } catch (error) {
      logger.warn('Failed to load template cache', { error: error.message });
    }
  }

  async _loadOutputLinks() {
    try {
      const linksFile = path.join(this.config.repoPath, 'links', 'output-links.json');
      
      if (fsSync.existsSync(linksFile)) {
        const content = await fs.readFile(linksFile, 'utf8');
        const links = JSON.parse(content);
        
        for (const [key, value] of Object.entries(links)) {
          this.outputLinks.set(key, value);
        }
      }
    } catch (error) {
      logger.warn('Failed to load output links', { error: error.message });
    }
  }

  async _persistOutputLinks() {
    try {
      const linksDir = path.join(this.config.repoPath, 'links');
      await fs.mkdir(linksDir, { recursive: true });
      
      const linksFile = path.join(linksDir, 'output-links.json');
      const linksObject = Object.fromEntries(this.outputLinks);
      
      await fs.writeFile(linksFile, JSON.stringify(linksObject, null, 2));
    } catch (error) {
      logger.error('Failed to persist output links', { error: error.message });
    }
  }

  _validateTemplateObject(template) {
    const errors = [];

    if (!template.name || typeof template.name !== 'string' || template.name.trim() === '') {
      errors.push('Template name is required');
    }

    if (!template.template || typeof template.template !== 'string') {
      errors.push('Template content is required');
    }

    if (template.variables && !Array.isArray(template.variables)) {
      errors.push('Template variables must be an array');
    }

    if (template.name && !/^[a-zA-Z0-9_-]+$/.test(template.name)) {
      errors.push('Template name can only contain letters, numbers, hyphens, and underscores');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  _generateTemplateId(name) {
    return crypto.createHash('sha256').update(name).digest('hex').substring(0, 16);
  }

  async _getCurrentVersion(name) {
    try {
      const template = await this.getTemplate(name);
      return template ? template.version : null;
    } catch (error) {
      return null;
    }
  }

  _incrementVersion(currentVersion) {
    if (!currentVersion) {
      return '1.0.0';
    }

    try {
      return semver.inc(currentVersion, 'patch');
    } catch (error) {
      // If semver parsing fails, default to patch increment
      const parts = currentVersion.split('.').map(n => parseInt(n) || 0);
      parts[2] = (parts[2] || 0) + 1;
      return parts.join('.');
    }
  }

  _getTemplatePath(name) {
    return path.join(this.config.repoPath, 'prompts', `${name}.json`);
  }

  async _saveTemplateToFile(template) {
    const templatePath = this._getTemplatePath(template.name);
    await fs.writeFile(templatePath, JSON.stringify(template, null, 2));
    return templatePath;
  }

  async _loadTemplateFromFile(name) {
    try {
      const templatePath = this._getTemplatePath(name);
      const content = await fs.readFile(templatePath, 'utf8');
      return JSON.parse(content);
    } catch (error) {
      return null;
    }
  }

  async _getTemplateFromGit(name, version) {
    try {
      const templatePath = this._getTemplatePath(name);
      const commits = await this._execGit(`log --oneline --follow -- "${templatePath}"`);
      
      for (const commit of commits.split('\n')) {
        if (!commit.trim()) continue;
        
        const [hash] = commit.split(' ');
        const template = await this._getTemplateFromCommit(hash, name);
        
        if (template && template.version === version) {
          return template;
        }
      }
      
      throw new Error(`Version ${version} not found`);
    } catch (error) {
      throw error;
    }
  }

  async _getTemplateFromCommit(commitHash, name) {
    try {
      const templatePath = `prompts/${name}.json`;
      const content = await this._execGit(`show ${commitHash}:${templatePath}`);
      return JSON.parse(content);
    } catch (error) {
      return null;
    }
  }

  async _commitTemplate(message, template) {
    try {
      const commitResult = await this._execGit(`commit -m "${message}"`);
      const hash = await this._execGit('rev-parse HEAD');
      return hash.trim();
    } catch (error) {
      logger.error('Failed to commit template', { error: error.message });
      throw error;
    }
  }

  async _execGit(command) {
    return new Promise((resolve, reject) => {
      exec(`git ${command}`, {
        cwd: this.config.repoPath,
        maxBuffer: 1024 * 1024
      }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`Git command failed: ${stderr || error.message}`));
        } else {
          resolve(stdout.trim());
        }
      });
    });
  }
}

module.exports = PromptTemplateManager;