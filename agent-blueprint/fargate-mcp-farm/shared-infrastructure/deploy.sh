#!/bin/bash

# MCP Farm Shared Infrastructure Deployment Script
# This script deploys the shared ALB and VPC for all MCP servers

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CDK_DIR="$SCRIPT_DIR/cdk"

print_status "Starting MCP Farm Shared Infrastructure deployment..."
print_status "Script directory: $SCRIPT_DIR"
print_status "CDK directory: $CDK_DIR"

# Check if CDK directory exists
if [ ! -d "$CDK_DIR" ]; then
    print_error "CDK directory not found: $CDK_DIR"
    exit 1
fi

# Change to CDK directory
cd "$CDK_DIR"

# Check dependencies
print_status "Checking system dependencies..."

# Check if AWS CLI is installed and configured
if ! command -v aws &> /dev/null; then
    print_error "AWS CLI is required but not installed. Please install AWS CLI first."
    exit 1
fi

if ! aws sts get-caller-identity &> /dev/null; then
    print_error "AWS CLI is not configured. Please run 'aws configure' first."
    exit 1
fi

# Check if CDK is installed
if ! command -v cdk &> /dev/null; then
    print_error "AWS CDK is required but not installed. Please install CDK first:"
    print_error "npm install -g aws-cdk"
    exit 1
fi

# Check if Python is available
if ! command -v python3 &> /dev/null; then
    print_error "Python 3 is required but not installed."
    exit 1
fi

print_success "All dependencies met"

# Set up Python virtual environment
print_status "Setting up Python virtual environment..."
if [ ! -d "venv" ]; then
    python3 -m venv venv
    print_success "Created Python virtual environment"
else
    print_status "Using existing Python virtual environment"
fi

# Activate virtual environment
source venv/bin/activate

# Install Python dependencies
print_status "Installing Python dependencies..."
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
print_success "Python dependencies installed"

# Get AWS account and region
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
REGION=${AWS_REGION:-${AWS_DEFAULT_REGION:-us-west-2}}

print_status "Deploying to AWS Account: $ACCOUNT_ID in region: $REGION"

# Bootstrap CDK (if not already done)
print_status "Bootstrapping CDK..."
cdk bootstrap aws://$ACCOUNT_ID/$REGION || print_warning "CDK already bootstrapped or bootstrap failed"

# Deploy the stack
print_status "Deploying MCP Farm Shared Infrastructure stack..."
cdk deploy McpFarmAlbStack --require-approval never

if [ $? -eq 0 ]; then
    print_success "MCP Farm Shared Infrastructure deployed successfully!"
    
    # Get stack outputs
    print_status "Retrieving stack outputs..."
    echo ""
    echo "=========================================="
    echo "  MCP Farm Shared Infrastructure Outputs"
    echo "=========================================="
    echo ""
    
    aws cloudformation describe-stacks \
        --stack-name McpFarmAlbStack \
        --query "Stacks[0].Outputs" \
        --output table \
        --region $REGION
    
    echo ""
    print_success "Shared infrastructure is ready for MCP servers!"
    echo ""
    print_status "Next steps:"
    echo "  1. Deploy individual MCP servers (they will use this shared ALB)"
    echo "  2. Configure path-based routing for each MCP server"
    echo "  3. Test the MCP Farm ALB endpoint"
    echo ""
    
    # Get ALB DNS name for easy reference
    ALB_DNS=$(aws cloudformation describe-stacks \
        --stack-name McpFarmAlbStack \
        --query "Stacks[0].Outputs[?OutputKey=='McpFarmAlbDnsName'].OutputValue" \
        --output text \
        --region $REGION 2>/dev/null || echo "")
    
    if [ -n "$ALB_DNS" ] && [ "$ALB_DNS" != "None" ]; then
        print_status "MCP Farm ALB URL: http://$ALB_DNS"
        print_status "Test the ALB: curl http://$ALB_DNS"
    fi
    
else
    print_error "Failed to deploy MCP Farm Shared Infrastructure"
    exit 1
fi

# Deactivate virtual environment
deactivate

print_success "Deployment completed!"
