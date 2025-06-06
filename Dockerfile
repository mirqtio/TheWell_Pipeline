# Multi-stage build for TheWell Pipeline

# Base stage with dependencies
FROM node:20-bookworm AS base

# Set working directory
WORKDIR /app

# Install system dependencies for PostgreSQL client and other tools
RUN echo "Installing system dependencies..." && \
    apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    python3 \
    postgresql-client \
    curl \
    bash \
    chromium \
    # NSS, freetype, harfbuzz, ttf-freefont are typically dependencies of chromium on Debian
    # Add them explicitly if needed, but chromium package should pull them.
    # libnss3 libfreetype6 libharfbuzz-icu0 fonts-freefont-ttf
    && apt-get clean && rm -rf /var/lib/apt/lists/* && \
    echo "System dependencies installed successfully"

# Copy package files
COPY package*.json ./

# Development stage
FROM base AS development
RUN echo "Installing all dependencies for development..." && \
    npm ci --verbose && \
    npm cache clean --force && \
    echo "Development dependencies installed successfully"

# Copy application source
COPY src/ ./src/
COPY config/ ./config/
COPY tests/ ./tests/

# Production stage
FROM base AS production

# Define a shared path for Playwright browsers
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers
RUN mkdir -p ${PLAYWRIGHT_BROWSERS_PATH} # Create directory as root

RUN echo "Installing production dependencies..." && \
    npm ci --verbose && \
    npm cache clean --force && \
    echo "Production dependencies installed successfully"

# Install Playwright browsers and their system dependencies (as root)
RUN echo "Installing Playwright browsers and dependencies..." && \
    npx playwright install --with-deps && \
    echo "Playwright browsers and dependencies installed successfully"

# Ensure the installed browsers are accessible by changing permissions AFTER installation
RUN echo "Setting permissions for Playwright browsers..." && \
    chmod -R 777 ${PLAYWRIGHT_BROWSERS_PATH} && \
    echo "Permissions set for Playwright browsers."

# Copy application source
COPY src/ ./src/
COPY config/ ./config/
COPY scripts/ ./scripts/
COPY tests/ ./tests/
COPY .sequelizerc ./.sequelizerc
COPY jest.e2e.config.js ./jest.e2e.config.js
COPY jest.e2e.setup.js ./jest.e2e.setup.js
COPY jest.setup.js ./jest.setup.js
COPY playwright.config.js ./playwright.config.js

# Create non-root user for security
RUN echo "Creating non-root user..." && \
    addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 --ingroup nodejs --no-create-home --shell /bin/false thewell && \
    echo "Non-root user created successfully"

# Change ownership of app directory
RUN echo "Setting file permissions..." && \
    chown -R thewell:nodejs /app && \
    echo "File permissions set successfully"

USER thewell

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Start the application
CMD ["npm", "start"]
