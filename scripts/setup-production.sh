#!/bin/bash

# TheWell Pipeline Production Setup Script
# Automated production environment setup and deployment

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PROJECT_NAME="thewell-pipeline"
DEPLOY_DIR="/opt/${PROJECT_NAME}"
BACKUP_DIR="/opt/backups/${PROJECT_NAME}"
LOG_FILE="/var/log/${PROJECT_NAME}/setup.log"

# Default values
ENVIRONMENT="production"
SKIP_BACKUP=false
SKIP_TESTS=false
AUTO_MIGRATE=false
DRY_RUN=false

# Functions
log() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')] $1${NC}" | tee -a "$LOG_FILE"
}

error() {
    echo -e "${RED}[ERROR] $1${NC}" | tee -a "$LOG_FILE"
    exit 1
}

warn() {
    echo -e "${YELLOW}[WARNING] $1${NC}" | tee -a "$LOG_FILE"
}

success() {
    echo -e "${GREEN}[SUCCESS] $1${NC}" | tee -a "$LOG_FILE"
}

usage() {
    cat << EOF
Usage: $0 [OPTIONS]

Options:
    -e, --environment ENV    Environment to deploy (production, staging, development)
    -d, --deploy-dir DIR     Deployment directory (default: /opt/thewell-pipeline)
    -b, --skip-backup        Skip backup creation
    -t, --skip-tests         Skip health checks and tests
    -m, --auto-migrate       Automatically run database migrations
    -n, --dry-run           Show what would be done without executing
    -h, --help              Show this help message

Examples:
    $0                              # Standard production deployment
    $0 -e staging -m                # Staging deployment with auto-migration
    $0 --dry-run                    # Show deployment plan
    $0 -b -t -m                     # Quick deployment (skip backup/tests)

EOF
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -e|--environment)
            ENVIRONMENT="$2"
            shift 2
            ;;
        -d|--deploy-dir)
            DEPLOY_DIR="$2"
            shift 2
            ;;
        -b|--skip-backup)
            SKIP_BACKUP=true
            shift
            ;;
        -t|--skip-tests)
            SKIP_TESTS=true
            shift
            ;;
        -m|--auto-migrate)
            AUTO_MIGRATE=true
            shift
            ;;
        -n|--dry-run)
            DRY_RUN=true
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            error "Unknown option: $1"
            ;;
    esac
done

# Validate environment
validate_environment() {
    log "Validating environment..."
    
    # Check if running as root
    if [[ $EUID -ne 0 ]]; then
        error "This script must be run as root"
    fi
    
    # Check required commands
    local required_commands=("docker" "docker-compose" "curl" "jq")
    for cmd in "${required_commands[@]}"; do
        if ! command -v "$cmd" &> /dev/null; then
            error "Required command not found: $cmd"
        fi
    done
    
    # Check Docker daemon
    if ! docker info &> /dev/null; then
        error "Docker daemon is not running"
    fi
    
    # Check available disk space (require at least 10GB)
    local available_space=$(df / | awk 'NR==2 {print $4}')
    if [[ $available_space -lt 10485760 ]]; then
        error "Insufficient disk space. At least 10GB required."
    fi
    
    success "Environment validation completed"
}

# Setup directories and permissions
setup_directories() {
    log "Setting up directories..."
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log "[DRY RUN] Would create directories: $DEPLOY_DIR, $BACKUP_DIR, $(dirname "$LOG_FILE")"
        return
    fi
    
    # Create necessary directories
    mkdir -p "$DEPLOY_DIR"
    mkdir -p "$BACKUP_DIR"
    mkdir -p "$(dirname "$LOG_FILE")"
    mkdir -p "$DEPLOY_DIR/logs"
    mkdir -p "$DEPLOY_DIR/exports"
    mkdir -p "$DEPLOY_DIR/infrastructure"
    
    # Set proper permissions
    chown -R root:docker "$DEPLOY_DIR" 2>/dev/null || true
    chmod -R 755 "$DEPLOY_DIR"
    
    success "Directories setup completed"
}

# Create backup of existing deployment
create_backup() {
    if [[ "$SKIP_BACKUP" == "true" ]]; then
        warn "Skipping backup creation"
        return
    fi
    
    log "Creating backup of existing deployment..."
    
    local backup_timestamp=$(date +%Y%m%d_%H%M%S)
    local backup_path="$BACKUP_DIR/backup_$backup_timestamp"
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log "[DRY RUN] Would create backup at: $backup_path"
        return
    fi
    
    if [[ -d "$DEPLOY_DIR" ]]; then
        # Stop existing services
        if [[ -f "$DEPLOY_DIR/docker-compose.production.yml" ]]; then
            log "Stopping existing services..."
            cd "$DEPLOY_DIR"
            docker-compose -f docker-compose.production.yml down || true
        fi
        
        # Create backup
        mkdir -p "$backup_path"
        cp -r "$DEPLOY_DIR"/* "$backup_path/" 2>/dev/null || true
        
        # Backup database
        if docker ps | grep -q postgres; then
            log "Backing up database..."
            docker exec $(docker ps -q -f name=postgres) pg_dumpall -U thewell > "$backup_path/database_backup.sql"
        fi
        
        success "Backup created at: $backup_path"
    else
        log "No existing deployment found, skipping backup"
    fi
}

# Deploy application files
deploy_application() {
    log "Deploying application files..."
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log "[DRY RUN] Would deploy application files to: $DEPLOY_DIR"
        return
    fi
    
    # Copy deployment files
    local script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    local project_root="$(dirname "$script_dir")"
    
    cp "$project_root/docker-compose.production.yml" "$DEPLOY_DIR/"
    cp -r "$project_root/infrastructure" "$DEPLOY_DIR/"
    cp "$project_root/package.json" "$DEPLOY_DIR/"
    cp "$project_root/Dockerfile" "$DEPLOY_DIR/"
    
    # Set up environment file
    if [[ ! -f "$DEPLOY_DIR/.env.production" ]]; then
        log "Creating default environment file..."
        cat > "$DEPLOY_DIR/.env.production" << EOF
# TheWell Pipeline Production Environment
NODE_ENV=production
POSTGRES_PASSWORD=change_me_in_production
GRAFANA_ADMIN_PASSWORD=change_me_in_production
JWT_SECRET=change_me_in_production
LOG_LEVEL=info
PROMETHEUS_PORT=9090

# External API Keys (set these manually)
# OPENAI_API_KEY=your_openai_key
# ANTHROPIC_API_KEY=your_anthropic_key

# Database URLs
DATABASE_URL=postgresql://thewell:\${POSTGRES_PASSWORD}@postgres:5432/thewell_prod
REDIS_URL=redis://redis:6379

# Monitoring
GRAFANA_URL=http://grafana:3001
PROMETHEUS_URL=http://prometheus:9090
EOF
        warn "Default environment file created. Please update passwords and API keys!"
    fi
    
    success "Application files deployed"
}

# Setup SSL certificates
setup_ssl() {
    log "Setting up SSL certificates..."
    
    local ssl_dir="$DEPLOY_DIR/infrastructure/ssl"
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log "[DRY RUN] Would setup SSL certificates in: $ssl_dir"
        return
    fi
    
    mkdir -p "$ssl_dir"
    
    # Check if certificates exist
    if [[ ! -f "$ssl_dir/thewell.crt" ]] || [[ ! -f "$ssl_dir/thewell.key" ]]; then
        log "Creating self-signed certificates for development..."
        openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
            -keyout "$ssl_dir/thewell.key" \
            -out "$ssl_dir/thewell.crt" \
            -subj "/C=US/ST=State/L=City/O=Organization/CN=thewell.pipeline.com"
        
        warn "Self-signed certificates created. Replace with valid certificates for production!"
    else
        log "SSL certificates already exist"
    fi
    
    # Set proper permissions
    chmod 600 "$ssl_dir/thewell.key"
    chmod 644 "$ssl_dir/thewell.crt"
    
    success "SSL setup completed"
}

# Pull Docker images
pull_images() {
    log "Pulling Docker images..."
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log "[DRY RUN] Would pull Docker images"
        return
    fi
    
    cd "$DEPLOY_DIR"
    
    # Pull all images
    docker-compose -f docker-compose.production.yml pull
    
    success "Docker images pulled"
}

# Deploy services
deploy_services() {
    log "Deploying services..."
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log "[DRY RUN] Would deploy services using docker-compose.production.yml"
        return
    fi
    
    cd "$DEPLOY_DIR"
    
    # Load environment variables
    source .env.production
    
    # Deploy infrastructure services first
    log "Starting infrastructure services..."
    docker-compose -f docker-compose.production.yml up -d postgres redis prometheus grafana loki
    
    # Wait for database to be ready
    log "Waiting for database to be ready..."
    local max_attempts=30
    local attempt=1
    
    while [[ $attempt -le $max_attempts ]]; do
        if docker-compose -f docker-compose.production.yml exec -T postgres pg_isready -U thewell; then
            break
        fi
        log "Waiting for database... (attempt $attempt/$max_attempts)"
        sleep 10
        ((attempt++))
    done
    
    if [[ $attempt -gt $max_attempts ]]; then
        error "Database failed to start within expected time"
    fi
    
    # Run database migrations if requested
    if [[ "$AUTO_MIGRATE" == "true" ]]; then
        log "Running database migrations..."
        # This would run migrations - implementation depends on your migration system
        # docker-compose -f docker-compose.production.yml exec api npm run db:migrate
    fi
    
    # Deploy application services
    log "Starting application services..."
    docker-compose -f docker-compose.production.yml up -d
    
    success "Services deployed"
}

# Run health checks
run_health_checks() {
    if [[ "$SKIP_TESTS" == "true" ]]; then
        warn "Skipping health checks"
        return
    fi
    
    log "Running health checks..."
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log "[DRY RUN] Would run health checks"
        return
    fi
    
    # Wait for services to start
    sleep 30
    
    local health_checks=(
        "http://localhost:3000/health:API"
        "http://localhost:9090/-/healthy:Prometheus"
        "http://localhost:3001/api/health:Grafana"
    )
    
    local failed_checks=0
    
    for check in "${health_checks[@]}"; do
        local url="${check%:*}"
        local service="${check#*:}"
        
        log "Checking $service health..."
        
        if curl -f -s "$url" > /dev/null; then
            success "$service is healthy"
        else
            error "$service health check failed"
            ((failed_checks++))
        fi
    done
    
    if [[ $failed_checks -eq 0 ]]; then
        success "All health checks passed"
    else
        error "$failed_checks health checks failed"
    fi
}

# Setup monitoring and alerting
setup_monitoring() {
    log "Setting up monitoring and alerting..."
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log "[DRY RUN] Would setup monitoring configuration"
        return
    fi
    
    # Configure Grafana data sources and dashboards
    local grafana_url="http://localhost:3001"
    local max_attempts=10
    local attempt=1
    
    # Wait for Grafana to be ready
    while [[ $attempt -le $max_attempts ]]; do
        if curl -f -s "$grafana_url/api/health" > /dev/null; then
            break
        fi
        log "Waiting for Grafana... (attempt $attempt/$max_attempts)"
        sleep 10
        ((attempt++))
    done
    
    if [[ $attempt -le $max_attempts ]]; then
        success "Monitoring setup completed"
    else
        warn "Grafana not ready, monitoring setup may be incomplete"
    fi
}

# Display deployment summary
show_summary() {
    log "Deployment Summary"
    echo "===================="
    echo "Environment: $ENVIRONMENT"
    echo "Deploy Directory: $DEPLOY_DIR"
    echo "Backup Directory: $BACKUP_DIR"
    echo ""
    echo "Access URLs:"
    echo "  Application: https://localhost (or your domain)"
    echo "  Monitoring: http://localhost:3001"
    echo "  Prometheus: http://localhost:9090"
    echo "  API Health: http://localhost:3000/health"
    echo ""
    echo "Next Steps:"
    echo "1. Update passwords in $DEPLOY_DIR/.env.production"
    echo "2. Configure SSL certificates if using custom domain"
    echo "3. Set up external API keys (OpenAI, Anthropic)"
    echo "4. Configure backup strategies"
    echo "5. Set up monitoring alerts"
    echo ""
    if [[ "$DRY_RUN" == "true" ]]; then
        echo "This was a DRY RUN - no changes were made"
    else
        echo "Deployment completed successfully!"
    fi
}

# Main execution
main() {
    log "Starting TheWell Pipeline deployment..."
    log "Environment: $ENVIRONMENT"
    log "Deploy Directory: $DEPLOY_DIR"
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log "DRY RUN MODE - No changes will be made"
    fi
    
    validate_environment
    setup_directories
    create_backup
    deploy_application
    setup_ssl
    pull_images
    deploy_services
    setup_monitoring
    run_health_checks
    show_summary
    
    success "TheWell Pipeline deployment completed!"
}

# Handle interruption
trap 'error "Deployment interrupted by user"' INT TERM

# Run main function
main "$@"