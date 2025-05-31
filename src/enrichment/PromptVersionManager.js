const fs = require('fs');
const fsPromises = fs.promises;
const path = require('path');
const { execSync, exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const EventEmitter = require('events');

/**
 * PromptVersionManager - Git-based prompt versioning system
 * 
 * Manages prompt versions using Git for version control, enabling:
 * - Semantic versioning of prompts
 * - Rollback capabilities
 * - Audit trails
 * - Reproducibility linking
 */
class PromptVersionManager extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      promptsDirectory: config.promptsDirectory || path.join(process.cwd(), 'src/enrichment/prompts'),
      gitEnabled: config.gitEnabled !== false,
      autoCommit: config.autoCommit !== false,
      maxVersionHistory: config.maxVersionHistory || 100,
      ...config
    };
    
    this.promptCache = new Map();
    this.versionHistory = new Map();
    this.isInitialized = false;
    
    // Ensure prompts directory exists
    this.ensurePromptsDirectory();
  }

  /**
   * Initialize the prompt versioning system
   */
  async initialize() {
    try {
      await this.ensurePromptsDirectory();
      
      if (this.config.gitEnabled) {
        await this.initializeGitRepo();
      }
      
      await this.loadExistingPrompts();
      this.isInitialized = true;
      
      this.emit('initialized');
      return true;
    } catch (error) {
      this.emit('error', error);
      throw new Error(`Failed to initialize PromptVersionManager: ${error.message}`);
    }
  }

  /**
   * Ensure prompts directory exists
   */
  async ensurePromptsDirectory() {
    try {
      await fsPromises.access(this.config.promptsDirectory);
    } catch (error) {
      await fsPromises.mkdir(this.config.promptsDirectory, { recursive: true });
    }
  }

  /**
   * Initialize Git repository for prompt versioning
   */
  async initializeGitRepo() {
    try {
      // Check if already a git repo
      try {
        execSync('git rev-parse --git-dir', { 
          cwd: this.config.promptsDirectory,
          stdio: 'ignore'
        });
        return; // Already initialized
      } catch (error) {
        // Not a git repo, initialize it
      }
      
      execSync('git init', { cwd: this.config.promptsDirectory });
      
      // Create .gitignore if it doesn't exist
      const gitignorePath = path.join(this.config.promptsDirectory, '.gitignore');
      try {
        await fsPromises.access(gitignorePath);
      } catch (error) {
        await fsPromises.writeFile(gitignorePath, '# Prompt versioning\n*.tmp\n*.log\n');
      }
      
      // Initial commit if no commits exist
      try {
        execSync('git rev-parse HEAD', { 
          cwd: this.config.promptsDirectory,
          stdio: 'ignore'
        });
      } catch (error) {
        // No commits yet, create initial commit
        execSync('git add .gitignore', { cwd: this.config.promptsDirectory });
        execSync('git commit -m "Initial prompt repository setup"', { 
          cwd: this.config.promptsDirectory 
        });
      }
    } catch (error) {
      throw new Error(`Failed to initialize Git repository: ${error.message}`);
    }
  }

  /**
   * Load existing prompts from the directory
   */
  async loadExistingPrompts() {
    try {
      const files = await fsPromises.readdir(this.config.promptsDirectory);
      const promptFiles = files.filter(file => file.endsWith('.json'));
      
      for (const file of promptFiles) {
        const promptPath = path.join(this.config.promptsDirectory, file);
        const promptData = JSON.parse(await fsPromises.readFile(promptPath, 'utf8'));
        
        const promptId = path.basename(file, '.json');
        this.promptCache.set(promptId, promptData);
        
        if (this.config.gitEnabled) {
          await this.loadVersionHistory(promptId);
        }
      }
    } catch (error) {
      // Directory might be empty, which is fine
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  /**
   * Load version history for a prompt from Git
   */
  async loadVersionHistory(promptId) {
    try {
      const promptFile = `${promptId}.json`;
      const { stdout } = await execAsync(
        `git log --oneline --follow -- ${promptFile}`,
        { cwd: this.config.promptsDirectory }
      );
      
      const commits = stdout.trim().split('\n').filter(line => line.length > 0);
      const history = commits.map(commit => {
        const [hash, ...messageParts] = commit.split(' ');
        return {
          hash,
          message: messageParts.join(' '),
          timestamp: null // Will be populated when needed
        };
      });
      
      this.versionHistory.set(promptId, history.slice(0, this.config.maxVersionHistory));
    } catch (error) {
      // File might not exist in Git yet
      this.versionHistory.set(promptId, []);
    }
  }

  /**
   * Create or update a prompt with versioning
   */
  async savePrompt(promptId, promptData, options = {}) {
    if (!this.isInitialized) {
      throw new Error('PromptVersionManager not initialized');
    }

    try {
      const {
        version = this.generateNextVersion(promptId),
        commitMessage = `Update prompt ${promptId} to version ${version}`,
        author = 'PromptVersionManager',
        tags = []
      } = options;

      // Prepare prompt metadata
      const promptWithMetadata = {
        id: promptId,
        version,
        content: promptData.content || promptData,
        metadata: {
          author,
          createdAt: promptData.metadata?.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          tags: [...new Set([...tags, ...(promptData.metadata?.tags || [])])],
          description: promptData.metadata?.description || '',
          ...promptData.metadata
        },
        schema: promptData.schema || {
          version: '1.0.0',
          type: 'prompt',
          variables: this.extractVariables(promptData.content || promptData)
        }
      };

      // Save to file
      const promptPath = path.join(this.config.promptsDirectory, `${promptId}.json`);
      await fsPromises.writeFile(promptPath, JSON.stringify(promptWithMetadata, null, 2));
      
      // Update cache
      this.promptCache.set(promptId, promptWithMetadata);

      // Git operations
      if (this.config.gitEnabled && this.config.autoCommit) {
        await this.commitPrompt(promptId, commitMessage);
        await this.loadVersionHistory(promptId);
      }

      this.emit('promptSaved', {
        promptId,
        version,
        metadata: promptWithMetadata.metadata
      });

      return promptWithMetadata;
    } catch (error) {
      this.emit('error', error);
      throw new Error(`Failed to save prompt ${promptId}: ${error.message}`);
    }
  }

  /**
   * Get a prompt by ID and optional version
   */
  async getPrompt(promptId, version = 'latest') {
    if (!this.isInitialized) {
      throw new Error('PromptVersionManager not initialized');
    }

    try {
      if (version === 'latest') {
        return this.promptCache.get(promptId) || null;
      }

      // Get specific version from Git
      if (this.config.gitEnabled) {
        return await this.getPromptVersion(promptId, version);
      }

      // Fallback to latest if Git not enabled
      return this.promptCache.get(promptId) || null;
    } catch (error) {
      this.emit('error', error);
      throw new Error(`Failed to get prompt ${promptId}: ${error.message}`);
    }
  }

  /**
   * Get specific version of prompt from Git
   */
  async getPromptVersion(promptId, version) {
    try {
      const history = this.versionHistory.get(promptId) || [];
      const commit = history.find(h => h.message.includes(version));
      
      if (!commit) {
        throw new Error(`Version ${version} not found for prompt ${promptId}`);
      }

      const { stdout } = await execAsync(
        `git show ${commit.hash}:${promptId}.json`,
        { cwd: this.config.promptsDirectory }
      );

      return JSON.parse(stdout);
    } catch (error) {
      throw new Error(`Failed to get prompt version: ${error.message}`);
    }
  }

  /**
   * Generate next semantic version for a prompt
   */
  generateNextVersion(promptId) {
    const existingPrompt = this.promptCache.get(promptId);
    
    if (!existingPrompt || !existingPrompt.version) {
      return '1.0.0';
    }

    const [major, minor, patch] = existingPrompt.version.split('.').map(Number);
    return `${major}.${minor}.${patch + 1}`;
  }

  /**
   * Extract variables from prompt content
   */
  extractVariables(content) {
    if (typeof content !== 'string') {
      return [];
    }

    const variableRegex = /\{\{(\w+)\}\}/g;
    const variables = [];
    let match;

    while ((match = variableRegex.exec(content)) !== null) {
      if (!variables.includes(match[1])) {
        variables.push(match[1]);
      }
    }

    return variables;
  }

  /**
   * Commit prompt changes to Git
   */
  async commitPrompt(promptId, message) {
    try {
      const promptFile = `${promptId}.json`;
      execSync(`git add ${promptFile}`, { cwd: this.config.promptsDirectory });
      execSync(`git commit -m "${message}"`, { cwd: this.config.promptsDirectory });
    } catch (error) {
      throw new Error(`Failed to commit prompt: ${error.message}`);
    }
  }

  /**
   * Get version history for a prompt
   */
  getVersionHistory(promptId) {
    return this.versionHistory.get(promptId) || [];
  }

  /**
   * List all available prompts
   */
  listPrompts() {
    return Array.from(this.promptCache.keys());
  }

  /**
   * Get prompt metadata
   */
  getPromptMetadata(promptId) {
    const prompt = this.promptCache.get(promptId);
    return prompt ? prompt.metadata : null;
  }

  /**
   * Rollback prompt to a previous version
   */
  async rollbackPrompt(promptId, targetVersion) {
    if (!this.config.gitEnabled) {
      throw new Error('Rollback requires Git to be enabled');
    }

    try {
      const previousVersion = await this.getPromptVersion(promptId, targetVersion);
      
      // Create new version with rollback content
      const rollbackOptions = {
        version: this.generateNextVersion(promptId),
        commitMessage: `Rollback prompt ${promptId} to version ${targetVersion}`,
        author: 'PromptVersionManager (Rollback)'
      };

      return await this.savePrompt(promptId, previousVersion, rollbackOptions);
    } catch (error) {
      this.emit('error', error);
      throw new Error(`Failed to rollback prompt ${promptId}: ${error.message}`);
    }
  }

  /**
   * Get system statistics
   */
  getStatistics() {
    const totalPrompts = this.promptCache.size;
    const totalVersions = Array.from(this.versionHistory.values())
      .reduce((sum, history) => sum + history.length, 0);

    return {
      totalPrompts,
      totalVersions,
      averageVersionsPerPrompt: totalPrompts > 0 ? totalVersions / totalPrompts : 0,
      gitEnabled: this.config.gitEnabled,
      isInitialized: this.isInitialized
    };
  }

  /**
   * Graceful shutdown
   */
  async shutdown() {
    try {
      this.promptCache.clear();
      this.versionHistory.clear();
      this.isInitialized = false;
      
      this.emit('shutdown');
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }
}

module.exports = PromptVersionManager;
