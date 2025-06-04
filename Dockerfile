# Multi-stage build for TheWell Pipeline

# Base stage with dependencies
FROM node:20-alpine AS base

# Set working directory
WORKDIR /app

# Install system dependencies for PostgreSQL client and other tools
RUN echo "Installing system dependencies..." && \
    apk add --no-cache \
    postgresql-client \
    curl \
    bash && \
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

# Install only production dependencies
RUN echo "Installing production dependencies..." && \
    npm ci --only=production --verbose && \
    npm cache clean --force && \
    echo "Production dependencies installed successfully"

# Copy application source (no tests in production)
COPY src/ ./src/
COPY config/ ./config/

# Create non-root user for security
RUN echo "Creating non-root user..." && \
    addgroup -g 1001 -S nodejs && \
    adduser -S thewell -u 1001 -G nodejs && \
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
