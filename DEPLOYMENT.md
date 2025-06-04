# TheWell Pipeline - Deployment Guide

This document provides comprehensive instructions for deploying TheWell Pipeline in various environments.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Environment Configuration](#environment-configuration)
3. [Development Deployment](#development-deployment)
4. [Production Deployment](#production-deployment)
5. [Monitoring Setup](#monitoring-setup)
6. [Maintenance Operations](#maintenance-operations)
7. [Troubleshooting](#troubleshooting)

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
POSTGRES_PASSWORD=your_secure_postgres_password
GRAFANA_ADMIN_PASSWORD=your_grafana_admin_password
JWT_SECRET=your_jwt_secret_key
OPENAI_API_KEY=your_openai_api_key
ANTHROPIC_API_KEY=your_anthropic_api_key
```

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

### Option 1: Docker Compose (Single Server)

1. **Prepare environment**:
   ```bash
   # Create production directory
   mkdir -p /opt/thewell-pipeline
   cd /opt/thewell-pipeline
   
   # Copy production files
   scp docker-compose.production.yml server:/opt/thewell-pipeline/
   scp -r infrastructure/ server:/opt/thewell-pipeline/
   ```

2. **Configure SSL certificates**:
   ```bash
   # Place SSL certificates
   mkdir -p infrastructure/ssl
   cp your-certificate.crt infrastructure/ssl/thewell.crt
   cp your-private-key.key infrastructure/ssl/thewell.key
   ```

3. **Deploy the stack**:
   ```bash
   # Set environment variables
   export POSTGRES_PASSWORD=your_secure_password
   export GRAFANA_ADMIN_PASSWORD=your_grafana_password
   
   # Deploy
   docker-compose -f docker-compose.production.yml up -d
   ```

4. **Initialize database**:
   ```bash
   docker-compose -f docker-compose.production.yml exec api npm run db:migrate
   ```

### Option 2: Kubernetes Deployment

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

### Option 3: AWS ECS Deployment

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

## Contact Information

- **DevOps Team**: devops@company.com
- **Emergency Escalation**: +1-555-0123
- **Slack Channel**: #thewell-ops
- **Documentation**: https://docs.thewell.pipeline.com

---

*Last updated: December 2024*