/**
 * Service Container
 * 
 * Provides lazy initialization and dependency injection for services
 * to prevent initialization during module import in tests
 */

const logger = require('../utils/logger');

class ServiceContainer {
  constructor() {
    this.services = new Map();
    this.factories = new Map();
    this.initialized = new Map();
    this.validateEnvironment();
  }

  /**
   * Validate required environment variables
   */
  validateEnvironment() {
    // Required vars for all environments
    const requiredBase = ['NODE_ENV'];
    
    // Additional required vars for production
    const requiredProduction = [
      'DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER',
      'REDIS_HOST', 'REDIS_PORT'
    ];
    
    // Check base requirements
    const missing = requiredBase.filter(v => !process.env[v]);
    
    // In production, check additional requirements
    if (process.env.NODE_ENV === 'production') {
      missing.push(...requiredProduction.filter(v => !process.env[v]));
    }
    
    if (missing.length > 0) {
      logger.error('Missing required environment variables:', missing);
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }
    
    // Validate NODE_ENV value
    const validEnvironments = ['development', 'test', 'production'];
    if (!validEnvironments.includes(process.env.NODE_ENV)) {
      throw new Error(`Invalid NODE_ENV: ${process.env.NODE_ENV}. Must be one of: ${validEnvironments.join(', ')}`);
    }
    
    logger.info('Environment validated successfully', {
      NODE_ENV: process.env.NODE_ENV,
      CI: process.env.CI || false
    });
  }

  /**
   * Register a service factory
   * @param {string} name - Service name
   * @param {Function} factory - Factory function that creates the service
   */
  register(name, factory) {
    if (typeof factory !== 'function') {
      throw new Error(`Factory for ${name} must be a function`);
    }
    this.factories.set(name, factory);
    logger.debug(`Registered service factory: ${name}`);
  }

  /**
   * Get a service instance (lazy initialization)
   * @param {string} name - Service name
   * @returns {*} Service instance
   */
  get(name) {
    // In test environment, return null unless explicitly configured
    if (process.env.NODE_ENV === 'test' && !this.isTestServiceEnabled(name)) {
      return null;
    }

    // Return existing instance if already created
    if (this.services.has(name)) {
      return this.services.get(name);
    }

    // Create new instance using factory
    const factory = this.factories.get(name);
    if (!factory) {
      throw new Error(`No factory registered for service: ${name}`);
    }

    try {
      const instance = factory();
      this.services.set(name, instance);
      this.initialized.set(name, false);
      logger.info(`Created service instance: ${name}`);
      return instance;
    } catch (error) {
      logger.error(`Failed to create service ${name}:`, error);
      throw error;
    }
  }

  /**
   * Initialize a service
   * @param {string} name - Service name
   */
  async initialize(name) {
    const service = this.get(name);
    if (!service || this.initialized.get(name)) {
      return;
    }

    if (typeof service.initialize === 'function') {
      await service.initialize();
      this.initialized.set(name, true);
      logger.info(`Initialized service: ${name}`);
    }
  }

  /**
   * Initialize all registered services
   */
  async initializeAll() {
    for (const name of this.factories.keys()) {
      await this.initialize(name);
    }
  }

  /**
   * Shutdown a service
   * @param {string} name - Service name
   */
  async shutdown(name) {
    const service = this.services.get(name);
    if (!service) {
      return;
    }

    if (typeof service.shutdown === 'function') {
      await service.shutdown();
      logger.info(`Shutdown service: ${name}`);
    }

    this.services.delete(name);
    this.initialized.delete(name);
  }

  /**
   * Shutdown all services
   */
  async shutdownAll() {
    for (const name of this.services.keys()) {
      await this.shutdown(name);
    }
  }

  /**
   * Clear all services (for testing)
   */
  clear() {
    this.services.clear();
    this.initialized.clear();
  }

  /**
   * Check if a service should be enabled in test environment
   * @param {string} name - Service name
   * @returns {boolean}
   */
  isTestServiceEnabled(name) {
    // Allow specific services to be enabled in tests via environment variable
    const enabledServices = process.env.TEST_ENABLED_SERVICES?.split(',') || [];
    return enabledServices.includes(name);
  }

  /**
   * Replace a service instance (for testing)
   * @param {string} name - Service name
   * @param {*} instance - Service instance
   */
  replace(name, instance) {
    this.services.set(name, instance);
    this.initialized.set(name, true);
  }
}

// Export singleton instance
module.exports = new ServiceContainer();