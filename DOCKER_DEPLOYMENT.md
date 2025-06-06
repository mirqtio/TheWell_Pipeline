# Docker Desktop Deployment Guide

## Quick Start

1. **Ensure Docker Desktop is running**

2. **Configure environment variables**:
   ```bash
   cp .env.production .env.production.local
   # Edit .env.production.local and add your API keys:
   # - OPENAI_API_KEY
   # - ANTHROPIC_API_KEY
   # - GRAFANA_ADMIN_PASSWORD
   # - JWT_SECRET
   ```

3. **Run the deployment script**:
   ```bash
   ./scripts/deploy-docker.sh
   ```

## Manual Deployment

If you prefer to deploy manually:

```bash
# Load environment variables
export $(cat .env.production | grep -v '^#' | xargs)

# Build and start services
docker-compose -f docker-compose.production.yml up -d --build

# Check status
docker-compose -f docker-compose.production.yml ps

# View logs
docker-compose -f docker-compose.production.yml logs -f
```

## Service URLs

- **API**: http://localhost:3000
- **API Documentation**: http://localhost:3000/api-docs
- **Grafana Dashboard**: http://localhost:3001
- **Prometheus**: http://localhost:9090

## Health Checks

```bash
# Check API health
curl http://localhost:3000/health

# Check database connection
docker-compose -f docker-compose.production.yml exec postgres pg_isready

# Check all services
docker-compose -f docker-compose.production.yml ps
```

## Troubleshooting

### Database Issues
```bash
# View database logs
docker-compose -f docker-compose.production.yml logs postgres

# Connect to database
docker-compose -f docker-compose.production.yml exec postgres psql -U thewell_user -d thewell

# Reset database (WARNING: Deletes all data)
docker-compose -f docker-compose.production.yml down -v
```

### API Issues
```bash
# View API logs
docker-compose -f docker-compose.production.yml logs api

# Restart API
docker-compose -f docker-compose.production.yml restart api
```

### Complete Reset
```bash
# Stop all services and remove volumes
docker-compose -f docker-compose.production.yml down -v

# Remove all images
docker-compose -f docker-compose.production.yml down --rmi all

# Start fresh
./scripts/deploy-docker.sh
```

## Data Persistence

Data is persisted in Docker volumes:
- `postgres_data` - PostgreSQL database
- `redis_data` - Redis cache
- `grafana_data` - Grafana dashboards
- `prometheus_data` - Prometheus metrics
- `loki_data` - Log storage

To backup data:
```bash
# Backup PostgreSQL
docker-compose -f docker-compose.production.yml exec postgres pg_dump -U thewell_user thewell > backup.sql

# Restore PostgreSQL
docker-compose -f docker-compose.production.yml exec -T postgres psql -U thewell_user thewell < backup.sql
```

## Monitoring

1. **Grafana Dashboards**: http://localhost:3001
   - Default login: admin / (password from .env.production)
   - Pre-configured dashboards in `infrastructure/grafana/dashboards/`

2. **Prometheus Metrics**: http://localhost:9090
   - Query examples:
     - `up` - Service health
     - `http_request_duration_seconds` - API latency
     - `nodejs_memory_usage_bytes` - Memory usage

3. **Application Logs**:
   ```bash
   # All logs
   docker-compose -f docker-compose.production.yml logs -f
   
   # Specific service
   docker-compose -f docker-compose.production.yml logs -f api
   ```