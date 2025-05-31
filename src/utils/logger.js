/**
 * Logger utility for TheWell Pipeline
 * Provides structured logging with different levels
 */

const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3
};

class Logger {
  constructor(options = {}) {
    this.level = options.level || process.env.LOG_LEVEL || 'INFO';
    this.service = options.service || 'thewell-pipeline';
    this.enableConsole = options.enableConsole !== false;
  }

  _shouldLog(level) {
    return LOG_LEVELS[level.toUpperCase()] <= LOG_LEVELS[this.level.toUpperCase()];
  }

  _formatMessage(level, message, meta = {}) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level: level.toUpperCase(),
      service: this.service,
      message,
      ...meta
    };

    if (this.enableConsole) {
      const colorMap = {
        ERROR: '\x1b[31m', // Red
        WARN: '\x1b[33m',  // Yellow
        INFO: '\x1b[36m',  // Cyan
        DEBUG: '\x1b[37m'  // White
      };
      const resetColor = '\x1b[0m';
      const color = colorMap[level.toUpperCase()] || '';
      
      console.log(`${color}[${timestamp}] ${level.toUpperCase()}: ${message}${resetColor}`, meta);
    }

    return logEntry;
  }

  error(message, meta = {}) {
    if (this._shouldLog('ERROR')) {
      return this._formatMessage('ERROR', message, meta);
    }
  }

  warn(message, meta = {}) {
    if (this._shouldLog('WARN')) {
      return this._formatMessage('WARN', message, meta);
    }
  }

  info(message, meta = {}) {
    if (this._shouldLog('INFO')) {
      return this._formatMessage('INFO', message, meta);
    }
  }

  debug(message, meta = {}) {
    if (this._shouldLog('DEBUG')) {
      return this._formatMessage('DEBUG', message, meta);
    }
  }
}

// Create default logger instance
const logger = new Logger();

module.exports = logger;