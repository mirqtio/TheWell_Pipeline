#!/bin/bash

# BDD Scenario Verification Script
# Tests each scenario from BDD.md against actual implementation

set -e

echo "🔍 BDD Scenario Verification for TheWell Pipeline"
echo "=================================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Counters
TOTAL=0
PASSED=0
FAILED=0
PARTIAL=0

# Test result function
test_scenario() {
    local id=$1
    local description=$2
    local status=$3
    local details=$4
    
    TOTAL=$((TOTAL + 1))
    
    echo -n "[$id] $description... "
    
    case $status in
        "pass")
            echo -e "${GREEN}✅ PASS${NC}"
            PASSED=$((PASSED + 1))
            ;;
        "fail")
            echo -e "${RED}❌ FAIL${NC}"
            FAILED=$((FAILED + 1))
            echo "     Details: $details"
            ;;
        "partial")
            echo -e "${YELLOW}⚠️  PARTIAL${NC}"
            PARTIAL=$((PARTIAL + 1))
            echo "     Details: $details"
            ;;
    esac
}

API_KEY="${REVIEW_API_KEY:-dev-review-key}"
BASE_URL="http://localhost:3000"

echo "Testing against: $BASE_URL"
echo "Using API Key: $API_KEY"
echo ""

# Feature 1: Source Registry & On-Ramp
echo -e "${BLUE}Feature 1: Source Registry & On-Ramp${NC}"
echo "------------------------------------"

test_scenario "SR-01" "Add Source via wizard" "fail" "No source wizard UI exists"
test_scenario "SR-02" "Edit Source with audit" "fail" "No source editing UI or audit log"
test_scenario "SR-03" "Bulk CSV import" "fail" "No bulk import functionality"
test_scenario "SR-04" "Role-based deletion" "partial" "Auth exists but no roles"

echo ""

# Feature 2: Ingestion Engine & Scheduler
echo -e "${BLUE}Feature 2: Ingestion Engine & Scheduler${NC}"
echo "---------------------------------------"

# Test job scheduling
JOBS_RESPONSE=$(curl -s "$BASE_URL/api/v1/jobs" -H "x-api-key: $API_KEY" -w "\nHTTP_CODE:%{http_code}")
if echo "$JOBS_RESPONSE" | grep -q "HTTP_CODE:200"; then
    test_scenario "IE-01" "Scheduled crawl dispatch" "pass" ""
else
    test_scenario "IE-01" "Scheduled crawl dispatch" "fail" "Jobs endpoint not working"
fi

test_scenario "IE-02" "MIME type validation" "fail" "No MIME checking implemented"
test_scenario "IE-03" "Change detection" "partial" "Basic deduplication exists"
test_scenario "IE-04" "HTTP 429 backoff" "fail" "No rate limit handling"

echo ""

# Feature 3: Normalization & Cleaning
echo -e "${BLUE}Feature 3: Normalization & Cleaning${NC}"
echo "-----------------------------------"

test_scenario "NC-01" "Boilerplate removal" "fail" "No HTML cleaning"
test_scenario "NC-02" "Language detection" "fail" "No language processing"
test_scenario "NC-03" "Document chunking" "fail" "No chunking implementation"

echo ""

# Feature 4: Semantic Enrichment
echo -e "${BLUE}Feature 4: Semantic Enrichment${NC}"
echo "-------------------------------"

test_scenario "SE-01" "Embedding generation" "partial" "Different model than specified"
test_scenario "SE-02" "Entity extraction" "fail" "No NER functionality"
test_scenario "SE-03" "Classification" "fail" "No classification system"

echo ""

# Feature 5: Storage Layer
echo -e "${BLUE}Feature 5: Storage Layer${NC}"
echo "------------------------"

# Check if PostgreSQL has vector extension
PG_VECTOR=$(docker-compose -f docker-compose.production.yml exec -T postgres psql -U thewell_user -d thewell -c "SELECT 1 FROM pg_extension WHERE extname='vector';" 2>/dev/null || echo "")
if echo "$PG_VECTOR" | grep -q "1"; then
    test_scenario "ST-01" "Vector index updates" "pass" ""
else
    test_scenario "ST-01" "Vector index updates" "partial" "pgvector may not be installed"
fi

test_scenario "ST-02" "Point-in-time restore" "fail" "No backup/restore"

echo ""

# Feature 6: Query & Retrieval API
echo -e "${BLUE}Feature 6: Query & Retrieval API${NC}"
echo "--------------------------------"

# Test semantic search
SEARCH_RESPONSE=$(curl -s -X POST "$BASE_URL/api/v1/rag/search" \
    -H "Content-Type: application/json" \
    -H "x-api-key: $API_KEY" \
    -d '{"query":"test","limit":3}' \
    -w "\nHTTP_CODE:%{http_code}")

if echo "$SEARCH_RESPONSE" | grep -q "HTTP_CODE:200"; then
    test_scenario "QR-01" "Semantic search" "pass" ""
else
    test_scenario "QR-01" "Semantic search" "fail" "Search endpoint error"
fi

test_scenario "QR-02" "Diff endpoint" "fail" "No versioning or diff"
test_scenario "QR-03" "Rate limiting" "partial" "Different implementation"

echo ""

# Feature 7: Alerts & Notifications
echo -e "${BLUE}Feature 7: Alerts & Notifications${NC}"
echo "---------------------------------"

test_scenario "AL-01" "Policy change alerts" "fail" "No alert system"
test_scenario "AL-02" "Failure alerts" "fail" "No Slack/email integration"

echo ""

# Feature 8: Dashboard UI
echo -e "${BLUE}Feature 8: Dashboard UI${NC}"
echo "-----------------------"

# Check if admin UI is accessible
ADMIN_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/admin/")
if [ "$ADMIN_RESPONSE" = "200" ]; then
    test_scenario "UI-01" "Global search" "fail" "UI exists but no autocomplete"
else
    test_scenario "UI-01" "Global search" "fail" "Admin UI not accessible"
fi

test_scenario "UI-02" "Diff viewer" "fail" "No diff viewing"
test_scenario "UI-03" "API key management" "fail" "No API key UI"

echo ""

# Feature 9: Administration & Access Control
echo -e "${BLUE}Feature 9: Administration & Access Control${NC}"
echo "------------------------------------------"

# Test auth
AUTH_TEST=$(curl -s "$BASE_URL/api/v1/rag/search" -w "\nHTTP_CODE:%{http_code}")
if echo "$AUTH_TEST" | grep -q "HTTP_CODE:401"; then
    test_scenario "AD-01" "Role-based access" "partial" "Basic auth works, no roles"
else
    test_scenario "AD-01" "Role-based access" "fail" "Auth not working properly"
fi

test_scenario "AD-02" "API key rotation" "fail" "No key lifecycle"

echo ""

# Feature 10: Observability & Monitoring
echo -e "${BLUE}Feature 10: Observability & Monitoring${NC}"
echo "--------------------------------------"

# Check Prometheus
PROM_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:9090/api/v1/query?query=up")
if [ "$PROM_RESPONSE" = "200" ]; then
    test_scenario "OB-01" "Queue depth alerting" "partial" "Metrics exist, no PagerDuty"
else
    test_scenario "OB-01" "Queue depth alerting" "fail" "Prometheus not accessible"
fi

# Check health endpoint
HEALTH_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/health")
if [ "$HEALTH_RESPONSE" = "200" ]; then
    test_scenario "OB-02" "Health probes" "pass" ""
else
    test_scenario "OB-02" "Health probes" "fail" "Health endpoint not working"
fi

echo ""

# Feature 11: Agent Orchestration
echo -e "${BLUE}Feature 11: Agent Orchestration${NC}"
echo "-------------------------------"

test_scenario "AG-01" "TaskMaster runner" "fail" "No agent system"

echo ""

# Feature 12: Model Management
echo -e "${BLUE}Feature 12: Model Management${NC}"
echo "----------------------------"

test_scenario "MM-01" "A/B model routing" "fail" "No model versioning"

echo ""

# Feature 13: Data Export & Integrations
echo -e "${BLUE}Feature 13: Data Export & Integrations${NC}"
echo "--------------------------------------"

test_scenario "EX-01" "CSV export" "fail" "No export functionality"
test_scenario "EX-02" "Webhook push" "fail" "No webhook system"

echo ""
echo "======================================"
echo "Summary:"
echo "--------------------------------------"
echo -e "Total Scenarios: $TOTAL"
echo -e "${GREEN}Passed: $PASSED${NC}"
echo -e "${YELLOW}Partial: $PARTIAL${NC}"
echo -e "${RED}Failed: $FAILED${NC}"
echo ""

# Calculate percentage
if [ $TOTAL -gt 0 ]; then
    IMPL_PERCENT=$(( (PASSED * 100 + PARTIAL * 50) / TOTAL ))
    echo "Implementation Score: ${IMPL_PERCENT}%"
fi

echo ""
echo "Key Findings:"
echo "- TheWell implements basic document pipeline features"
echo "- BDD spec describes a policy intelligence system"
echo "- Major gaps in UI, processing, and intelligence features"
echo ""
echo "See BDD_VERIFICATION_REPORT.md for detailed analysis"