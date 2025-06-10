/**
 * Git-based Prompt Versioning Helper
 * Provides Git operations for prompt template versioning
 */

const { exec } = require('child_process');
const path = require('path');
const fs = require('fs').promises;
const logger = require('../utils/logger');

class GitPromptVersioning {
  constructor(repoPath, options = {}) {
    this.repoPath = repoPath;
    this.config = {
      author: options.author || 'TheWell Pipeline',
      email: options.email || 'system@thewell.com',
      ...options
    };
  }

  /**
   * Initialize git repository
   */
  async initRepository() {
    try {
      await this._execGit('init');
      await this._execGit(`config user.name "${this.config.author}"`);
      await this._execGit(`config user.email "${this.config.email}"`);
      
      logger.info('Git repository initialized for prompt versioning', {
        repoPath: this.repoPath
      });

      return true;
    } catch (error) {
      logger.error('Failed to initialize git repository', { error: error.message });
      throw error;
    }
  }

  /**
   * Add and commit files
   */
  async commitChanges(message, files = []) {
    try {
      if (files.length > 0) {
        for (const file of files) {
          await this._execGit(`add "${file}"`);
        }
      } else {
        await this._execGit('add .');
      }

      const commitHash = await this._execGit(`commit -m "${message}"`);
      const hash = await this._execGit('rev-parse HEAD');

      logger.info('Changes committed to git', {
        message,
        commitHash: hash.trim(),
        files: files.length || 'all'
      });

      return hash.trim();
    } catch (error) {
      logger.error('Failed to commit changes', { error: error.message });
      throw error;
    }
  }

  /**
   * Get file content from specific commit
   */
  async getFileFromCommit(commitHash, filePath) {
    try {
      const content = await this._execGit(`show ${commitHash}:${filePath}`);
      return content;
    } catch (error) {
      logger.error('Failed to get file from commit', {
        commitHash,
        filePath,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get commit history for a file
   */
  async getFileHistory(filePath, options = {}) {
    try {
      const format = options.format || '%H|%an|%ae|%ad|%s';
      const maxCount = options.maxCount ? `--max-count=${options.maxCount}` : '';
      
      const gitLog = await this._execGit(
        `log ${maxCount} --pretty=format:"${format}" --date=iso --follow -- "${filePath}"`
      );

      if (!gitLog.trim()) {
        return [];
      }

      return gitLog.trim().split('\n').map(commit => {
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
      logger.error('Failed to get file history', { filePath, error: error.message });
      throw error;
    }
  }

  /**
   * Create a tag for a specific commit
   */
  async createTag(tagName, commitHash, message = '') {
    try {
      const tagCommand = message ? 
        `tag -a "${tagName}" -m "${message}" ${commitHash}` :
        `tag "${tagName}" ${commitHash}`;
      
      await this._execGit(tagCommand);

      logger.info('Git tag created', { tagName, commitHash, message });

      return true;
    } catch (error) {
      logger.error('Failed to create git tag', {
        tagName,
        commitHash,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * List all tags
   */
  async listTags(pattern = null) {
    try {
      const command = pattern ? `tag -l "${pattern}"` : 'tag -l';
      const tags = await this._execGit(command);
      
      return tags.trim().split('\n').filter(tag => tag.trim());
    } catch (error) {
      logger.error('Failed to list git tags', { error: error.message });
      return [];
    }
  }

  /**
   * Get tag information
   */
  async getTagInfo(tagName) {
    try {
      const info = await this._execGit(`show ${tagName} --format="%H|%an|%ae|%ad|%s" --quiet`);
      const [hash, author, email, date, message] = info.split('|');
      
      return {
        tag: tagName,
        hash,
        author,
        email,
        date: new Date(date).toISOString(),
        message
      };
    } catch (error) {
      logger.error('Failed to get tag info', { tagName, error: error.message });
      throw error;
    }
  }

  /**
   * Check if repository is clean (no uncommitted changes)
   */
  async isRepositoryClean() {
    try {
      const status = await this._execGit('status --porcelain');
      return status.trim() === '';
    } catch (error) {
      logger.error('Failed to check repository status', { error: error.message });
      return false;
    }
  }

  /**
   * Get current branch name
   */
  async getCurrentBranch() {
    try {
      const branch = await this._execGit('rev-parse --abbrev-ref HEAD');
      return branch.trim();
    } catch (error) {
      logger.error('Failed to get current branch', { error: error.message });
      throw error;
    }
  }

  /**
   * Create and checkout a new branch
   */
  async createBranch(branchName, startPoint = null) {
    try {
      const command = startPoint ? 
        `checkout -b "${branchName}" "${startPoint}"` :
        `checkout -b "${branchName}"`;
      
      await this._execGit(command);

      logger.info('New branch created and checked out', { branchName, startPoint });

      return true;
    } catch (error) {
      logger.error('Failed to create branch', {
        branchName,
        startPoint,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Checkout a branch or commit
   */
  async checkout(target) {
    try {
      await this._execGit(`checkout "${target}"`);

      logger.info('Checked out target', { target });

      return true;
    } catch (error) {
      logger.error('Failed to checkout target', { target, error: error.message });
      throw error;
    }
  }

  /**
   * Get diff between two commits
   */
  async getDiff(fromCommit, toCommit, filePath = null) {
    try {
      const fileArg = filePath ? ` -- "${filePath}"` : '';
      const diff = await this._execGit(`diff ${fromCommit} ${toCommit}${fileArg}`);
      
      return diff;
    } catch (error) {
      logger.error('Failed to get diff', {
        fromCommit,
        toCommit,
        filePath,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get list of changed files between commits
   */
  async getChangedFiles(fromCommit, toCommit) {
    try {
      const files = await this._execGit(`diff --name-only ${fromCommit} ${toCommit}`);
      
      return files.trim().split('\n').filter(file => file.trim());
    } catch (error) {
      logger.error('Failed to get changed files', {
        fromCommit,
        toCommit,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Create a backup branch from current state
   */
  async createBackupBranch(prefix = 'backup') {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const branchName = `${prefix}-${timestamp}`;
      
      await this.createBranch(branchName);
      
      logger.info('Backup branch created', { branchName });

      return branchName;
    } catch (error) {
      logger.error('Failed to create backup branch', { error: error.message });
      throw error;
    }
  }

  /**
   * Reset repository to a specific commit
   */
  async resetToCommit(commitHash, mode = 'hard') {
    try {
      await this._execGit(`reset --${mode} ${commitHash}`);

      logger.info('Repository reset to commit', { commitHash, mode });

      return true;
    } catch (error) {
      logger.error('Failed to reset repository', {
        commitHash,
        mode,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get repository statistics
   */
  async getRepositoryStats() {
    try {
      const totalCommits = await this._execGit('rev-list --count HEAD');
      const branches = await this._execGit('branch -a --format="%(refname:short)"');
      const tags = await this.listTags();
      const currentBranch = await this.getCurrentBranch();
      const isClean = await this.isRepositoryClean();

      return {
        totalCommits: parseInt(totalCommits.trim()),
        branches: branches.trim().split('\n').filter(b => b.trim()),
        tags: tags,
        currentBranch,
        isClean,
        lastCommit: await this._execGit('log -1 --format="%H|%an|%ad|%s"')
      };

    } catch (error) {
      logger.error('Failed to get repository stats', { error: error.message });
      throw error;
    }
  }

  /**
   * Execute git command in repository directory
   */
  async _execGit(command) {
    return new Promise((resolve, reject) => {
      exec(`git ${command}`, {
        cwd: this.repoPath,
        maxBuffer: 1024 * 1024
      }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`Git command failed: ${stderr || error.message}`));
        } else {
          resolve(stdout);
        }
      });
    });
  }
}

module.exports = GitPromptVersioning;