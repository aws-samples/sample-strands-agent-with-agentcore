#!/bin/bash
# Run all tests across the project
#
# Usage:
#   ./scripts/run-all-tests.sh              # Run unit tests (frontend + backend)
#   ./scripts/run-all-tests.sh frontend     # Frontend tests only
#   ./scripts/run-all-tests.sh backend      # Backend tests only
#   ./scripts/run-all-tests.sh integration  # AWS integration tests
#   ./scripts/run-all-tests.sh config       # Config validation
#   ./scripts/run-all-tests.sh all          # Everything

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_header() { echo -e "\n${BLUE}=== $1 ===${NC}\n"; }
print_success() { echo -e "${GREEN}✓ $1${NC}"; }
print_error() { echo -e "${RED}✗ $1${NC}"; }
print_warning() { echo -e "${YELLOW}⚠ $1${NC}"; }

# Track results
FAILED=0

run_frontend_tests() {
    print_header "Frontend Tests (Vitest)"
    cd "$PROJECT_ROOT/chatbot-app/frontend"

    [ ! -d "node_modules" ] && npm install
    npm run test && print_success "Frontend passed" || { print_error "Frontend failed"; FAILED=1; }

    cd "$PROJECT_ROOT"
}

run_backend_tests() {
    print_header "Backend Tests (pytest)"
    cd "$PROJECT_ROOT/chatbot-app/agentcore"

    # Activate venv
    if [ -d "venv" ]; then
        source venv/bin/activate
    elif [ -d ".venv" ]; then
        source .venv/bin/activate
    else
        print_error "No venv found. Create with: python -m venv venv && pip install -r requirements.txt"
        FAILED=1
        cd "$PROJECT_ROOT"
        return
    fi

    python -m pytest tests/ -v && print_success "Backend passed" || { print_error "Backend failed"; FAILED=1; }
    cd "$PROJECT_ROOT"
}

run_config_test() {
    print_header "Config Validation"
    python3 "$SCRIPT_DIR/test_config.py" "$1" && print_success "Config passed" || { print_error "Config failed"; FAILED=1; }
}

run_integration_tests() {
    print_header "Integration Tests"
    cd "$PROJECT_ROOT"

    # Activate venv if available
    [ -d "chatbot-app/agentcore/venv" ] && source chatbot-app/agentcore/venv/bin/activate

    for test in gateway memory a2a dynamodb code_interpreter browser; do
        echo -e "\n${YELLOW}Testing ${test}...${NC}"
        python3 "$SCRIPT_DIR/test_${test}.py" && print_success "${test} passed" || { print_warning "${test} failed"; FAILED=1; }
    done
}

# Main
case "$1" in
    frontend|fe)    run_frontend_tests ;;
    backend|be)     run_backend_tests ;;
    config)         run_config_test "${2:-local}" ;;
    integration)    run_integration_tests ;;
    all)
        run_config_test "local"
        run_frontend_tests
        run_backend_tests
        run_integration_tests
        ;;
    *)
        run_frontend_tests
        run_backend_tests
        ;;
esac

# Final result
echo ""
[ $FAILED -eq 0 ] && echo -e "${GREEN}All tests passed!${NC}" || echo -e "${RED}Some tests failed!${NC}"
exit $FAILED
