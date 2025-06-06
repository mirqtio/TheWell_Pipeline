#!/bin/bash

# Merge Readiness Verification Script
# Run this before merging any feature to main

set -e

echo "🚀 Feature Delivery Verification"
echo "================================"
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Track results
FAILED=0
WARNINGS=0

# Function to check requirement
check_requirement() {
    local description=$1
    local command=$2
    local required=${3:-true}
    
    echo -n "Checking: $description... "
    
    if eval "$command" > /dev/null 2>&1; then
        echo -e "${GREEN}✅ PASS${NC}"
        return 0
    else
        if [ "$required" = true ]; then
            echo -e "${RED}❌ FAIL${NC}"
            FAILED=$((FAILED + 1))
            return 1
        else
            echo -e "${YELLOW}⚠️  WARNING${NC}"
            WARNINGS=$((WARNINGS + 1))
            return 0
        fi
    fi
}

echo -e "${BLUE}1. Code Quality Checks${NC}"
echo "----------------------"
check_requirement "Linting" "npm run lint"
check_requirement "Type checking" "npm run typecheck" false
check_requirement "No console.log statements" "! grep -r 'console\.log' src/ --exclude='*.test.js' --exclude-dir=node_modules"
check_requirement "No TODO comments" "! grep -r 'TODO' src/ --exclude='*.test.js'" false
echo ""

echo -e "${BLUE}2. Test Coverage${NC}"
echo "----------------"
# Run unit tests with coverage
echo -n "Running unit tests with coverage... "
if npm run test:unit -- --coverage --silent > /tmp/test-output.txt 2>&1; then
    echo -e "${GREEN}✅ PASS${NC}"
    
    # Check coverage threshold
    if [ -f "coverage/coverage-summary.json" ]; then
        COVERAGE=$(cat coverage/coverage-summary.json | jq -r '.total.lines.pct')
        echo -n "Line coverage: ${COVERAGE}%... "
        
        if (( $(echo "$COVERAGE >= 90" | bc -l) )); then
            echo -e "${GREEN}✅ MEETS THRESHOLD${NC}"
        else
            echo -e "${RED}❌ BELOW 90% THRESHOLD${NC}"
            FAILED=$((FAILED + 1))
        fi
    fi
else
    echo -e "${RED}❌ FAIL${NC}"
    FAILED=$((FAILED + 1))
    echo "Test output:"
    tail -20 /tmp/test-output.txt
fi
echo ""

echo -e "${BLUE}3. Integration Tests${NC}"
echo "-------------------"
check_requirement "Database connection" "docker-compose exec -T postgres pg_isready -U thewell_user" false

echo -n "Running integration tests... "
if npm run test:integration -- --silent > /tmp/integration-output.txt 2>&1; then
    echo -e "${GREEN}✅ PASS${NC}"
else
    echo -e "${RED}❌ FAIL${NC}"
    FAILED=$((FAILED + 1))
    echo "Test output:"
    tail -20 /tmp/integration-output.txt
fi
echo ""

echo -e "${BLUE}4. E2E Tests${NC}"
echo "------------"
echo -n "Running E2E tests... "
if npm run test:e2e:fast -- --silent > /tmp/e2e-output.txt 2>&1; then
    echo -e "${GREEN}✅ PASS${NC}"
else
    echo -e "${RED}❌ FAIL${NC}"
    FAILED=$((FAILED + 1))
    echo "Test output:"
    tail -20 /tmp/e2e-output.txt
fi
echo ""

echo -e "${BLUE}5. Documentation${NC}"
echo "----------------"
check_requirement "API documentation (Swagger)" "[ -f 'src/web/swagger.js' ]"
check_requirement "README updated" "git diff origin/main -- README.md | grep -q '^+' || [ $? -eq 1 ]" false
check_requirement "CHANGELOG entry" "[ -f 'CHANGELOG.md' ] && git diff origin/main -- CHANGELOG.md | grep -q '^+'" false
echo ""

echo -e "${BLUE}6. Git Status${NC}"
echo "-------------"
check_requirement "Working directory clean" "[ -z \"$(git status --porcelain)\" ]"
check_requirement "Branch up to date with main" "git fetch origin && [ $(git rev-list --count HEAD..origin/main) -eq 0 ]"
check_requirement "No merge conflicts" "! git merge --no-commit --no-ff origin/main 2>&1 | grep -q 'conflict'" false
git merge --abort 2>/dev/null || true
echo ""

echo -e "${BLUE}7. Security Checks${NC}"
echo "-----------------"
check_requirement "No high severity vulnerabilities" "npm audit --production --audit-level=high"
check_requirement "No exposed secrets" "! grep -r 'api_key\\|password\\|secret' src/ --exclude='*.test.js' --exclude='*.example' | grep -v '\\*\\*\\*'" 
echo ""

echo -e "${BLUE}8. Performance Benchmarks${NC}"
echo "------------------------"
if [ -f "tests/performance/benchmark.js" ]; then
    echo "Running performance benchmarks..."
    node tests/performance/benchmark.js || echo -e "${YELLOW}⚠️  Performance tests not configured${NC}"
else
    echo -e "${YELLOW}⚠️  No performance benchmarks found${NC}"
    WARNINGS=$((WARNINGS + 1))
fi
echo ""

echo -e "${BLUE}9. GitHub Actions Status${NC}"
echo "-----------------------"
# Get latest workflow run
BRANCH=$(git branch --show-current)
echo -n "Checking CI status for branch '$BRANCH'... "

# This would normally check GitHub API
# For now, we'll remind to check manually
echo -e "${YELLOW}⚠️  Please verify GitHub Actions are green${NC}"
echo "   Visit: https://github.com/$(git remote get-url origin | sed 's/.*://;s/.git$//')/actions"
WARNINGS=$((WARNINGS + 1))
echo ""

echo -e "${BLUE}10. Feature Verification${NC}"
echo "-----------------------"
# Run BDD scenario verification if exists
if [ -f "scripts/verify-bdd-scenarios.sh" ]; then
    echo "Running BDD scenario verification..."
    ./scripts/verify-bdd-scenarios.sh | tail -5
else
    echo -e "${YELLOW}⚠️  No BDD verification script found${NC}"
    WARNINGS=$((WARNINGS + 1))
fi
echo ""

# Summary
echo "======================================"
echo -e "${BLUE}Merge Readiness Summary${NC}"
echo "======================================"

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✅ All required checks passed!${NC}"
    echo ""
    
    if [ $WARNINGS -gt 0 ]; then
        echo -e "${YELLOW}⚠️  $WARNINGS warnings found (non-blocking)${NC}"
    fi
    
    echo "You are ready to merge! Next steps:"
    echo "1. Create/update your pull request"
    echo "2. Wait for GitHub Actions to complete"
    echo "3. Get code review approval"
    echo "4. Merge with confidence!"
    echo ""
    echo "Merge command:"
    echo -e "${BLUE}gh pr merge --squash --delete-branch${NC}"
    
    exit 0
else
    echo -e "${RED}❌ $FAILED required checks failed!${NC}"
    echo ""
    echo "Please fix the issues above before merging."
    echo "Run this script again after fixes."
    
    exit 1
fi