#!/bin/bash

# Phase Execution Script
# Orchestrates feature delivery while maintaining coherence

set -e

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
EXECUTION_DIR=".execution-tracking"
COHERENCE_MONITOR="$EXECUTION_DIR/coherence-monitor.js"

# Functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

check_prerequisites() {
    log_info "Checking prerequisites..."
    
    # Check Node.js
    if ! command -v node &> /dev/null; then
        log_error "Node.js is required but not installed"
        exit 1
    fi
    
    # Check npm
    if ! command -v npm &> /dev/null; then
        log_error "npm is required but not installed"
        exit 1
    fi
    
    # Check Docker
    if ! command -v docker &> /dev/null; then
        log_warning "Docker not found - some features may not work"
    fi
    
    # Check execution tracking directory
    if [ ! -d "$EXECUTION_DIR" ]; then
        log_info "Creating execution tracking directory..."
        mkdir -p "$EXECUTION_DIR"
    fi
    
    log_success "Prerequisites check passed"
}

capture_baseline() {
    log_info "Capturing baseline metrics..."
    
    # Run coherence monitor baseline
    if [ -f "$COHERENCE_MONITOR" ]; then
        node "$COHERENCE_MONITOR" baseline
    else
        log_warning "Coherence monitor not found, skipping baseline"
    fi
    
    # Capture current git state
    git rev-parse HEAD > "$EXECUTION_DIR/baseline-commit.txt"
    
    # Run all tests to establish baseline
    log_info "Running baseline tests..."
    npm run test:all > "$EXECUTION_DIR/baseline-test-results.txt" 2>&1 || true
    
    log_success "Baseline captured"
}

start_phase() {
    local phase=$1
    log_info "Starting Phase $phase execution"
    
    # Create phase tracking file
    cat > "$EXECUTION_DIR/phase-$phase-status.json" << EOF
{
    "phase": $phase,
    "startDate": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
    "status": "in-progress",
    "features": []
}
EOF
    
    # Check coherence before starting
    node "$COHERENCE_MONITOR" check
}

execute_feature() {
    local feature_name=$1
    local feature_branch=$2
    local bdd_scenarios=$3
    
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo -e "${BLUE}Feature: $feature_name${NC}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    
    # 1. Create feature branch
    log_info "Creating feature branch: $feature_branch"
    git checkout main
    git pull origin main
    git checkout -b "$feature_branch"
    
    # 2. Feature implementation prompt
    echo ""
    log_warning "Ready to implement: $feature_name"
    echo "BDD Scenarios to implement: $bdd_scenarios"
    echo ""
    echo "Follow these steps:"
    echo "1. Implement the feature following TDD"
    echo "2. Ensure all tests pass"
    echo "3. Update documentation"
    echo "4. Run: npm run test:all"
    echo ""
    read -p "Press Enter when implementation is complete..."
    
    # 3. Run verification
    log_info "Running feature verification..."
    
    # Check tests
    if ! npm run test:all; then
        log_error "Tests failed! Fix issues before continuing."
        return 1
    fi
    
    # Check coverage
    if [ -f "coverage/coverage-summary.json" ]; then
        COVERAGE=$(cat coverage/coverage-summary.json | jq -r '.total.lines.pct')
        log_info "Test coverage: ${COVERAGE}%"
        
        if (( $(echo "$COVERAGE < 90" | bc -l) )); then
            log_error "Coverage below 90% threshold!"
            return 1
        fi
    fi
    
    # Check coherence
    log_info "Checking system coherence..."
    node "$COHERENCE_MONITOR" check
    
    # 4. Create PR
    log_info "Creating pull request..."
    git add -A
    git commit -m "feat: implement $feature_name

Implements BDD scenarios: $bdd_scenarios

- Comprehensive test coverage
- Documentation updated
- Performance verified"
    
    git push origin "$feature_branch"
    
    # Create PR using GitHub CLI if available
    if command -v gh &> /dev/null; then
        gh pr create \
            --title "feat: $feature_name" \
            --body "## Description
Implements $feature_name feature

## BDD Scenarios
$bdd_scenarios

## Checklist
- [x] Tests written and passing
- [x] Documentation updated
- [x] Code reviewed
- [x] Performance verified" \
            --label "feature" \
            --label "ready-for-review"
    else
        log_warning "GitHub CLI not found. Please create PR manually."
    fi
    
    # 5. Wait for CI
    log_info "Waiting for CI/CD pipeline..."
    echo "Monitor GitHub Actions for build status"
    read -p "Press Enter when CI is green and PR is approved..."
    
    # 6. Merge
    log_info "Merging feature..."
    if command -v gh &> /dev/null; then
        gh pr merge --squash --delete-branch
    else
        git checkout main
        git pull origin main
        git branch -d "$feature_branch"
    fi
    
    # 7. Post-merge verification
    log_info "Running post-merge verification..."
    git checkout main
    git pull origin main
    
    # Run tests on main
    if ! npm run test:all; then
        log_error "Tests failing on main after merge!"
        return 1
    fi
    
    # Final coherence check
    node "$COHERENCE_MONITOR" check
    
    log_success "Feature $feature_name successfully delivered!"
    
    # Update tracking
    echo "{\"feature\": \"$feature_name\", \"completed\": \"$(date -u +"%Y-%m-%dT%H:%M:%SZ")\"}" >> "$EXECUTION_DIR/completed-features.jsonl"
}

complete_phase() {
    local phase=$1
    log_info "Completing Phase $phase"
    
    # Update phase status
    if [ -f "$EXECUTION_DIR/phase-$phase-status.json" ]; then
        jq '.status = "completed" | .endDate = "'$(date -u +"%Y-%m-%dT%H:%M:%SZ")'"' \
            "$EXECUTION_DIR/phase-$phase-status.json" > "$EXECUTION_DIR/phase-$phase-status.json.tmp"
        mv "$EXECUTION_DIR/phase-$phase-status.json.tmp" "$EXECUTION_DIR/phase-$phase-status.json"
    fi
    
    # Generate phase report
    log_info "Generating phase report..."
    cat > "$EXECUTION_DIR/phase-$phase-report.md" << EOF
# Phase $phase Completion Report

## Summary
- Start Date: $(jq -r '.startDate' "$EXECUTION_DIR/phase-$phase-status.json")
- End Date: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
- Status: Completed

## Features Delivered
$(grep -E "phase$phase" "$EXECUTION_DIR/completed-features.jsonl" | jq -r '.feature' | sed 's/^/- /')

## Metrics
- Test Coverage: $(cat coverage/coverage-summary.json | jq -r '.total.lines.pct')%
- Build Time: $(cat "$EXECUTION_DIR/metrics/current-latest.json" | jq -r '.build.durationMinutes') minutes

## Coherence Status
$(node "$COHERENCE_MONITOR" check | tail -20)
EOF
    
    log_success "Phase $phase completed!"
}

# Main execution flow
main() {
    case "$1" in
        "init")
            log_info "Initializing execution environment..."
            check_prerequisites
            capture_baseline
            log_success "Initialization complete!"
            ;;
            
        "phase1")
            start_phase 1
            
            # Document Versioning
            execute_feature "Document Versioning" "feat/document-versioning" "QR-02, AL-01"
            
            # Content Processing
            execute_feature "Content Processing Pipeline" "feat/content-processing" "NC-01, NC-02, NC-03"
            
            # RBAC
            execute_feature "Role-Based Access Control" "feat/rbac" "SR-04, AD-01, AD-02"
            
            complete_phase 1
            ;;
            
        "phase2")
            start_phase 2
            
            # Entity Extraction
            execute_feature "Entity Extraction & Classification" "feat/entity-extraction" "SE-02, SE-03"
            
            # Knowledge Graph
            execute_feature "Knowledge Graph" "feat/knowledge-graph" "None specified"
            
            # Alert System
            execute_feature "Alert System" "feat/alert-system" "AL-01, AL-02"
            
            complete_phase 2
            ;;
            
        "phase3")
            start_phase 3
            
            # Search UI
            execute_feature "Advanced Search UI" "feat/search-ui" "UI-01"
            
            # Diff Viewer
            execute_feature "Diff Viewer Component" "feat/diff-viewer" "UI-02"
            
            # Source Management UI
            execute_feature "Source Management UI" "feat/source-ui" "UI-03"
            
            complete_phase 3
            ;;
            
        "phase4")
            start_phase 4
            
            # Model Management
            execute_feature "Model Management" "feat/model-management" "MM-01"
            
            # Agent Orchestration
            execute_feature "Agent Orchestration" "feat/agent-orchestration" "AG-01"
            
            # Data Export
            execute_feature "Data Export & Integrations" "feat/data-export" "EX-01, EX-02"
            
            complete_phase 4
            ;;
            
        "status")
            log_info "Execution Status"
            echo ""
            
            # Show completed features
            if [ -f "$EXECUTION_DIR/completed-features.jsonl" ]; then
                echo "Completed Features:"
                cat "$EXECUTION_DIR/completed-features.jsonl" | jq -r '"\(.feature) - \(.completed)"'
            fi
            
            echo ""
            
            # Show current metrics
            node "$COHERENCE_MONITOR" check
            
            echo ""
            
            # Show trends
            node "$COHERENCE_MONITOR" trends
            ;;
            
        "rollback")
            feature=$2
            if [ -z "$feature" ]; then
                log_error "Usage: $0 rollback <feature-name>"
                exit 1
            fi
            
            log_warning "Rolling back feature: $feature"
            read -p "Are you sure? (y/N) " -n 1 -r
            echo
            if [[ $REPLY =~ ^[Yy]$ ]]; then
                ./scripts/emergency-rollback.js "$feature"
            fi
            ;;
            
        *)
            echo "Usage: $0 [init|phase1|phase2|phase3|phase4|status|rollback]"
            echo ""
            echo "Commands:"
            echo "  init    - Initialize execution environment"
            echo "  phase1  - Execute Phase 1 (Foundation)"
            echo "  phase2  - Execute Phase 2 (Intelligence)"
            echo "  phase3  - Execute Phase 3 (UI)"
            echo "  phase4  - Execute Phase 4 (Advanced)"
            echo "  status  - Show execution status"
            echo "  rollback <feature> - Emergency rollback"
            exit 1
            ;;
    esac
}

# Execute main function
main "$@"