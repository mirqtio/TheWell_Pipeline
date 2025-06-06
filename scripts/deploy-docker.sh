#!/bin/bash

# Deploy TheWell Pipeline to Docker Desktop
# This script handles the complete deployment process

set -e

echo "🚀 Starting TheWell Pipeline Docker Deployment..."

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker Desktop and try again."
    exit 1
fi

# Load environment variables
if [ -f .env.production ]; then
    echo "✅ Loading production environment variables..."
    export $(cat .env.production | grep -v '^#' | xargs)
else
    echo "⚠️  No .env.production file found. Using default values."
fi

# Stop any existing containers
echo "🛑 Stopping existing containers..."
docker-compose -f docker-compose.production.yml down 2>/dev/null || true

# Remove old volumes for fresh start (optional - comment out to preserve data)
read -p "Do you want to remove existing volumes for a fresh start? (y/N) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "🗑️  Removing existing volumes..."
    docker-compose -f docker-compose.production.yml down -v
fi

# Build the application image
echo "🔨 Building Docker images..."
docker-compose -f docker-compose.production.yml build

# Start infrastructure services first
echo "🏗️  Starting infrastructure services..."
docker-compose -f docker-compose.production.yml up -d postgres redis

# Wait for PostgreSQL to be ready
echo "⏳ Waiting for PostgreSQL to be ready..."
until docker-compose -f docker-compose.production.yml exec -T postgres pg_isready -U ${POSTGRES_USER:-thewell_user} -d ${POSTGRES_DB:-thewell} > /dev/null 2>&1; do
    echo -n "."
    sleep 2
done
echo " ✅"

# Wait a bit more for initialization scripts to complete
echo "⏳ Waiting for database initialization..."
sleep 10

# Start monitoring services
echo "📊 Starting monitoring services..."
docker-compose -f docker-compose.production.yml up -d prometheus grafana loki promtail

# Start application services
echo "🚀 Starting application services..."
docker-compose -f docker-compose.production.yml up -d api background-worker queue-worker

# Wait for API to be ready
echo "⏳ Waiting for API to be ready..."
until curl -f http://localhost:3000/health > /dev/null 2>&1; do
    echo -n "."
    sleep 2
done
echo " ✅"

# Start the remaining services
echo "🌐 Starting web services..."
docker-compose -f docker-compose.production.yml up -d nginx

# Show status
echo ""
echo "✅ Deployment complete!"
echo ""
echo "📋 Service Status:"
docker-compose -f docker-compose.production.yml ps

echo ""
echo "🔗 Access Points:"
echo "   - API: http://localhost:3000"
echo "   - API Docs: http://localhost:3000/api-docs"
echo "   - Grafana: http://localhost:3001 (admin/${GRAFANA_ADMIN_PASSWORD:-admin})"
echo "   - Prometheus: http://localhost:9090"
echo ""
echo "📝 Logs:"
echo "   - All services: docker-compose -f docker-compose.production.yml logs -f"
echo "   - API only: docker-compose -f docker-compose.production.yml logs -f api"
echo ""
echo "🛑 To stop:"
echo "   docker-compose -f docker-compose.production.yml down"
echo ""