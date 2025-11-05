#!/bin/bash

# Python MCP Server Destroy Script
# Removes Python MCP Server deployment from AWS ECS Fargate using CDK

set -e

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CDK_DIR="${SCRIPT_DIR}/cdk"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
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

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to destroy the stack
destroy_stack() {
    local STACK_NAME="python-mcp-fargate"

    log_warning "Permanently deleting stack: ${STACK_NAME}"
    log_warning "All resources including ECR images, logs, and ECS services will be removed"

    log_info "Destroying stack: ${STACK_NAME}..."
    
    cd "${CDK_DIR}"
    
    # Activate virtual environment if it exists
    if [ -d "venv" ]; then
        source venv/bin/activate
    fi
    
    # Destroy the stack
    cdk destroy "${STACK_NAME}" \
        --force \
        --verbose
    
    log_success "Stack destruction completed: ${STACK_NAME}"
}

# Main function
main() {
    # Check prerequisites
    if ! command_exists cdk; then
        log_error "AWS CDK is not installed. Please install it first: npm install -g aws-cdk"
        exit 1
    fi
    
    if ! command_exists aws; then
        log_error "AWS CLI is not installed. Please install it first."
        exit 1
    fi
    
    # Check AWS credentials
    if ! aws sts get-caller-identity >/dev/null 2>&1; then
        log_error "AWS credentials are not configured. Please run 'aws configure' first."
        exit 1
    fi
    
    log_info "Starting Python MCP Server destruction..."
    log_info "Stack name: python-mcp-fargate"
    
    destroy_stack
    
    log_success "Python MCP Server destruction completed successfully!"
}

# Script usage
usage() {
    echo "Usage: $0"
    echo ""
    echo "Description:"
    echo "  Destroy Python MCP Server from AWS ECS Fargate"
    echo ""
    echo "Example:"
    echo "  $0           # Destroy Python MCP Server"
    echo ""
}

# Parse command line arguments
if [ "$1" == "--help" ] || [ "$1" == "-h" ]; then
    usage
    exit 0
fi

# Run main function
main