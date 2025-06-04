# TheWell Pipeline - Deployment Guide

This document provides comprehensive instructions for deploying TheWell Pipeline in various environments.

## Table of Contents

1. [Quick Start](#quick-start)
2. [Prerequisites](#prerequisites)
3. [Environment Configuration](#environment-configuration)
4. [Development Deployment](#development-deployment)
5. [Production Deployment](#production-deployment)
6. [Monitoring Setup](#monitoring-setup)
7. [Maintenance Operations](#maintenance-operations)
8. [Troubleshooting](#troubleshooting)

## Quick Start

### Fastest Path to Production

1. **Install prerequisites**:
   ```bash
   # Install Docker and Docker Compose
   curl -fsSL https://get.docker.com -o get-docker.sh
   sudo sh get-docker.sh
   sudo usermod -aG docker $USER
   
   # Install required tools
   sudo apt-get update && sudo apt-get install -y curl jq openssl
   ```

2. **Clone and configure**:
   ```bash
   git clone https://github.com/your-org/TheWell_Pipeline.git
   cd TheWell_Pipeline
   
   # Generate secure environment file
   cat > .env.production << EOF
   NODE_ENV=production
   POSTGRES_PASSWORD=$(openssl rand -base64 32)
   GRAFANA_ADMIN_PASSWORD=$(openssl rand -base64 32)
   JWT_SECRET=$(openssl rand -base64 32)
   OPENAI_API_KEY=your_openai_api_key_here
   ANTHROPIC_API_KEY=your_anthropic_api_key_here
   EOF
   ```

3. **Run automated setup**:
   ```bash
   # Dry run to preview changes
   sudo ./scripts/setup-production.sh --dry-run
   
   # Execute production setup
   sudo ./scripts/setup-production.sh
   ```

4. **Verify installation**:
   ```bash
   curl -f http://localhost:3000/health
   docker-compose -f docker-compose.production.yml ps
   ```

5. **Access points**:
   - API: http://localhost:3000
   - API Docs: http://localhost:3000/api-docs
   - Grafana: http://localhost:3001 (admin/[your_password])
   - Prometheus: http://localhost:9090

## Prerequisites

### System Requirements

- **Docker**: Version 20.10+ with Docker Compose v2
- **Node.js**: Version 18+ (for development)
- **PostgreSQL**: Version 15+ (if not using Docker)
- **Redis**: Version 7+ (if not using Docker)
- **Minimum Hardware**: 4 CPU cores, 8GB RAM, 50GB storage
- **Recommended Hardware**: 8 CPU cores, 16GB RAM, 200GB SSD storage

### Required Secrets

Create the following environment files:

```bash
# .env.production
NODE_ENV=production
POSTGRES_PASSWORD=your_secure_postgres_password
GRAFANA_ADMIN_PASSWORD=your_grafana_admin_password
JWT_SECRET=your_jwt_secret_key
OPENAI_API_KEY=your_openai_api_key
ANTHROPIC_API_KEY=your_anthropic_api_key
LOG_LEVEL=info

# Database URLs (automatically configured)
DATABASE_URL=postgresql://thewell:${POSTGRES_PASSWORD}@postgres:5432/thewell_prod
REDIS_URL=redis://redis:6379
```

### Additional Tools Required

- **curl**: For API testing and health checks
- **jq**: For JSON parsing in scripts
- **openssl**: For generating secure passwords

## Environment Configuration

### Development Environment

1. **Clone the repository**:
   ```bash
   git clone https://github.com/your-org/TheWell_Pipeline.git
   cd TheWell_Pipeline
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Setup development database**:
   ```bash
   docker-compose up -d postgres redis
   npm run db:setup
   ```

4. **Start development server**:
   ```bash
   npm run dev
   ```

### Staging Environment

1. **Use Docker Compose override**:
   ```bash
   docker-compose -f docker-compose.yml -f docker-compose.staging.yml up -d
   ```

2. **Run database migrations**:
   ```bash
   docker-compose exec api npm run db:migrate
   ```

3. **Verify deployment**:
   ```bash
   curl -f http://localhost:3000/health
   ```

## Production Deployment

### Option 1: Automated Setup Script (Recommended)

The automated setup script handles all deployment steps including validation, backup, SSL setup, and health checks:

```bash
# View available options
./scripts/setup-production.sh --help

# Run with specific options
./scripts/setup-production.sh \
  --environment production \
  --deploy-dir /opt/thewell-pipeline \
  --auto-migrate \
  --dry-run  # Remove --dry-run to execute

# Quick deployment (skip backup and tests)
./scripts/setup-production.sh -b -t -m
```

### Option 2: Manual Docker Compose Deployment

1. **Prepare environment**:
   ```bash
   # Create production directory
   sudo mkdir -p /opt/thewell-pipeline
   cd /opt/thewell-pipeline
   
   # Copy production files
   cp docker-compose.production.yml /opt/thewell-pipeline/
   cp -r infrastructure/ /opt/thewell-pipeline/
   cp .env.production /opt/thewell-pipeline/
   ```

2. **Configure SSL certificates**:
   ```bash
   # For self-signed certificates (development)
   sudo mkdir -p infrastructure/ssl
   sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
     -keyout infrastructure/ssl/thewell.key \
     -out infrastructure/ssl/thewell.crt \
     -subj "/C=US/ST=State/L=City/O=Organization/CN=localhost"
   
   # For production certificates
   sudo cp your-certificate.crt infrastructure/ssl/thewell.crt
   sudo cp your-private-key.key infrastructure/ssl/thewell.key
   sudo chmod 600 infrastructure/ssl/thewell.key
   ```

3. **Deploy the stack**:
   ```bash
   # Load environment variables
   source .env.production
   
   # Start infrastructure services first
   docker-compose -f docker-compose.production.yml up -d postgres redis prometheus grafana
   
   # Wait for database readiness
   sleep 30
   
   # Initialize database
   docker-compose -f docker-compose.production.yml exec api npm run db:migrate
   
   # Start all services
   docker-compose -f docker-compose.production.yml up -d
   ```

4. **Configure data sources**:
   ```bash
   # Edit sources configuration
   sudo nano /opt/thewell-pipeline/config/sources.json
   
   # Restart to apply changes
   docker-compose -f docker-compose.production.yml restart api
   ```

### Option 3: Kubernetes Deployment

1. **Prepare Kubernetes manifests**:
   ```bash
   kubectl apply -f k8s/namespace.yaml
   kubectl apply -f k8s/secrets.yaml
   kubectl apply -f k8s/configmaps.yaml
   ```

2. **Deploy database and cache**:
   ```bash
   kubectl apply -f k8s/postgres/
   kubectl apply -f k8s/redis/
   ```

3. **Deploy application services**:
   ```bash
   kubectl apply -f k8s/api/
   kubectl apply -f k8s/workers/
   ```

4. **Deploy monitoring stack**:
   ```bash
   kubectl apply -f k8s/monitoring/
   ```

### Option 4: AWS ECS Deployment

The CI/CD pipeline automatically deploys to ECS when:
- Pushing to `develop` branch → Development environment
- Pushing to `main` branch → Staging environment  
- Creating a release → Production environment

**Manual ECS deployment**:

1. **Build and push images**:
   ```bash
   docker build -t thewell-pipeline .
   docker tag thewell-pipeline:latest your-registry/thewell-pipeline:latest
   docker push your-registry/thewell-pipeline:latest
   ```

2. **Update ECS service**:
   ```bash
   aws ecs update-service \
     --cluster thewell-prod-cluster \
     --service thewell-prod-service \
     --force-new-deployment
   ```

## Monitoring Setup

### Prometheus Configuration

1. **Configure scraping targets** in `infrastructure/prometheus/prometheus.yml`:
   ```yaml
   scrape_configs:
     - job_name: 'thewell-api'
       static_configs:
         - targets: ['api:3000']
       metrics_path: '/metrics'
       scrape_interval: 30s
   ```

2. **Set up alerting rules** in `infrastructure/prometheus/rules/`:
   ```yaml
   # alerts.yml
   groups:
     - name: thewell.rules
       rules:
         - alert: HighErrorRate
           expr: rate(http_requests_total{status=~"5.."}[5m]) > 0.1
           for: 5m
           labels:
             severity: warning
           annotations:
             summary: High error rate detected
   ```

### Grafana Dashboards

1. **Import pre-configured dashboards**:
   - System Overview: `infrastructure/grafana/dashboards/system-overview.json`
   - API Performance: `infrastructure/grafana/dashboards/api-performance.json`
   - Cost Monitoring: `infrastructure/grafana/dashboards/cost-monitoring.json`

2. **Access Grafana**:
   - URL: `https://monitoring.thewell.pipeline.com`
   - Username: `admin`
   - Password: Set in `GRAFANA_ADMIN_PASSWORD`

### Log Aggregation

**Loki and Promtail** are configured for log aggregation:

1. **View logs in Grafana**:
   - Add Loki data source: `http://loki:3100`
   - Query logs: `{job="thewell"} |= "error"`

2. **Log retention**: Configured for 30 days in production

## Maintenance Operations

### Database Backups

**Automated backups** (configured in production):
```bash
# Manual backup
docker-compose exec postgres pg_dump -U thewell thewell_prod > backup_$(date +%Y%m%d_%H%M%S).sql

# Restore from backup
docker-compose exec -T postgres psql -U thewell thewell_prod < backup_file.sql
```

### Updates and Rollbacks

**Rolling updates**:
```bash
# Update API service
docker-compose -f docker-compose.production.yml up -d --no-deps api

# Rollback to previous version
docker-compose -f docker-compose.production.yml up -d --no-deps api:previous-tag
```

**Database migrations**:
```bash
# Run migrations
docker-compose exec api npm run db:migrate

# Rollback migration
docker-compose exec api npm run db:migrate:rollback
```

### Scaling Services

**Scale API instances**:
```bash
docker-compose -f docker-compose.production.yml up -d --scale api=3
```

**Scale workers**:
```bash
docker-compose -f docker-compose.production.yml up -d --scale worker=5 --scale queue-worker=3
```

### Certificate Renewal

**Let's Encrypt certificates**:
```bash
# Renew certificates
certbot renew --nginx --quiet

# Reload NGINX
docker-compose exec nginx nginx -s reload
```

## Health Checks and Monitoring

### Service Health Endpoints

- **API Health**: `GET /health`
- **Database Connection**: `GET /health/db`
- **Cache Status**: `GET /health/cache`
- **Queue Status**: `GET /health/queue`

### Key Metrics to Monitor

1. **Application Metrics**:
   - Response time: < 2 seconds (95th percentile)
   - Error rate: < 1%
   - Throughput: Monitor requests/second
   - Queue length: Should remain manageable

2. **System Metrics**:
   - CPU usage: < 80%
   - Memory usage: < 85%
   - Disk usage: < 90%
   - Network I/O: Monitor for bottlenecks

3. **Business Metrics**:
   - Document processing rate
   - Curation approval rate
   - User session duration
   - API usage by endpoint

### Alerting Thresholds

**Critical alerts**:
- API down for > 5 minutes
- Error rate > 5% for > 10 minutes
- Database connection lost
- Disk usage > 95%

**Warning alerts**:
- Response time > 5 seconds for > 5 minutes
- Memory usage > 90% for > 10 minutes
- Queue backup > 1000 items

## Troubleshooting

### Common Issues

**1. Application won't start**:
```bash
# Check logs
docker-compose logs api

# Common causes:
# - Database connection issues
# - Missing environment variables
# - Port conflicts
```

**2. Database connection errors**:
```bash
# Check database status
docker-compose ps postgres

# Test connection
docker-compose exec postgres psql -U thewell -d thewell_prod -c "SELECT 1;"

# Reset connections
docker-compose restart postgres
```

**3. High memory usage**:
```bash
# Check container memory usage
docker stats

# Scale down non-essential services
docker-compose -f docker-compose.production.yml up -d --scale worker=1
```

**4. Slow API responses**:
```bash
# Check API logs for slow queries
docker-compose logs api | grep "slow query"

# Monitor database performance
docker-compose exec postgres psql -U thewell -c "SELECT * FROM pg_stat_activity;"
```

### Performance Tuning

**Database optimization**:
```sql
-- Add indexes for frequently queried fields
CREATE INDEX CONCURRENTLY idx_documents_created_at ON documents(created_at);
CREATE INDEX CONCURRENTLY idx_feedback_session_id ON feedback(session_id);

-- Analyze query performance
EXPLAIN ANALYZE SELECT * FROM documents WHERE created_at > NOW() - INTERVAL '1 day';
```

**Cache optimization**:
```bash
# Monitor Redis memory usage
docker-compose exec redis redis-cli info memory

# Configure memory limits
# Set maxmemory in redis.conf
```

**NGINX tuning**:
```nginx
# Increase worker connections
worker_connections 8192;

# Optimize buffer sizes
proxy_buffer_size 8k;
proxy_buffers 16 8k;
```

### Emergency Procedures

**Service outage**:
1. Check service status: `docker-compose ps`
2. Restart affected services: `docker-compose restart <service>`
3. Check logs for errors: `docker-compose logs <service>`
4. Scale up if needed: `docker-compose up -d --scale api=3`

**Database corruption**:
1. Stop all services writing to DB
2. Restore from latest backup
3. Apply any missing migrations
4. Restart services

**Security incident**:
1. Isolate affected systems
2. Check access logs: `docker-compose logs nginx`
3. Update credentials
4. Review and patch vulnerabilities

## Post-Deployment Configuration

### Essential Configuration Steps

1. **Update API Keys**:
   ```bash
   # Edit production environment file
   sudo nano /opt/thewell-pipeline/.env.production
   # Add your actual OpenAI and Anthropic API keys
   ```

2. **Configure Data Sources**:
   ```bash
   # Edit sources configuration
   sudo nano /opt/thewell-pipeline/config/sources.json
   # Add your actual data sources following the examples
   ```

3. **Set Up Automated Backups**:
   ```bash
   # Add backup cron job
   echo "0 2 * * * /opt/thewell-pipeline/scripts/backup.sh" | sudo crontab -
   ```

4. **Configure Domain and SSL**:
   ```bash
   # For Let's Encrypt SSL
   sudo certbot --nginx -d your-domain.com
   ```

5. **Initial Data Ingestion**:
   ```bash
   # Start ingestion process
   docker-compose -f docker-compose.production.yml exec api npm run ingestion:start
   
   # Monitor ingestion
   docker-compose -f docker-compose.production.yml logs -f worker
   ```

### Quick Validation Commands

```bash
# Test RAG search functionality
curl -X POST http://localhost:3000/api/rag/search \
  -H "Content-Type: application/json" \
  -d '{"query": "test query"}'

# Check system metrics
curl http://localhost:9090/api/v1/query?query=up

# View API documentation
open http://localhost:3000/api-docs
```

## Contact Information

- **DevOps Team**: devops@company.com
- **Emergency Escalation**: +1-555-0123
- **Slack Channel**: #thewell-ops
- **Documentation**: https://docs.thewell.pipeline.com

---

*Last updated: January 2025*