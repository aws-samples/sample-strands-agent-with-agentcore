#!/bin/bash

# Nova Act MCP Server Fargate Deployment Script
# This script builds and deploys the Nova Act MCP server to AWS Fargate

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

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NOVA_ACT_SOURCE_DIR="$SCRIPT_DIR/src"
REGION="${AWS_REGION:-us-west-2}"
STAGE="${STAGE:-prod}"
STACK_NAME="nova-act-mcp-fargate-${STAGE}"

print_status "Starting Nova Act MCP Fargate deployment..."
print_status "Script directory: $SCRIPT_DIR"
print_status "Nova Act source: $NOVA_ACT_SOURCE_DIR"
print_status "Region: $REGION"
print_status "Stage: $STAGE"
print_status "Stack name: $STACK_NAME"

# Function to collect Nova Act API key
collect_nova_act_key() {
    print_status "🔑 Nova Act MCP requires an API key..."
    echo ""

    # Create .env file if it doesn't exist
    if [ ! -f ".env" ]; then
        touch .env
    fi

    # Source existing .env to check for values
    if [ -f ".env" ]; then
        set -a
        source .env 2>/dev/null || true
        set +a
    fi

    if [ -z "$NOVA_ACT_API_KEY" ]; then
        echo "🤖 Nova Act API Key Required:"
        echo "   This MCP server provides browser automation capabilities"
        echo ""
        echo "   1. Sign up at: https://www.browserbase.com/"
        echo "   2. Get your API key from the dashboard"
        echo "   3. The key enables web browsing and automation features"
        echo ""
        read -p "Enter your Nova Act API Key: " nova_key

        if [ -z "$nova_key" ]; then
            print_error "Nova Act API key is required for deployment!"
            print_error "Please get your API key from https://www.browserbase.com/ and try again."
            exit 1
        fi

        export NOVA_ACT_API_KEY="$nova_key"
        echo "NOVA_ACT_API_KEY=$nova_key" >> .env
        print_success "Nova Act API key configured"
    else
        print_success "Nova Act API key already configured"
    fi
    echo ""
}

# Check prerequisites
check_prerequisites() {
    print_status "Checking prerequisites..."
    
    # Check if AWS CLI is installed
    if ! command -v aws &> /dev/null; then
        print_error "AWS CLI is required but not installed. Please install AWS CLI first."
        exit 1
    fi
    
    # Check if CDK is installed
    if ! command -v cdk &> /dev/null; then
        print_error "AWS CDK is required but not installed. Please install CDK first:"
        print_error "npm install -g aws-cdk"
        exit 1
    fi
    
    # Check if Docker is installed and running
    if ! command -v docker &> /dev/null; then
        print_error "Docker is required but not installed. Please install Docker first."
        exit 1
    fi
    
    if ! docker info &> /dev/null; then
        print_error "Docker is not running. Please start Docker first."
        exit 1
    fi
    
    # Check if Python 3 is installed
    if ! command -v python3 &> /dev/null; then
        print_error "Python 3 is required but not installed."
        exit 1
    fi
    
    # Check if Nova Act MCP source directory exists
    if [ ! -d "$NOVA_ACT_SOURCE_DIR" ]; then
        print_error "Nova Act MCP source directory not found: $NOVA_ACT_SOURCE_DIR"
        print_error "Please ensure the Nova Act MCP directory exists in the monorepo."
        exit 1
    fi
    
    # Check if key Nova Act files exist
    if [ ! -f "$NOVA_ACT_SOURCE_DIR/nova_act_server.py" ]; then
        print_error "Nova Act MCP server file not found: $NOVA_ACT_SOURCE_DIR/nova_act_server.py"
        print_error "Please ensure the Nova Act MCP files exist in src directory."
        exit 1
    fi
    
    print_success "All prerequisites met"
}

# Setup Python virtual environment for CDK
setup_cdk_environment() {
    print_status "Setting up CDK environment..."
    
    cd "$SCRIPT_DIR/cdk"
    
    # Create virtual environment if it doesn't exist
    if [ ! -d "venv" ]; then
        print_status "Creating Python virtual environment..."
        python3 -m venv venv
    fi
    
    # Activate virtual environment
    source venv/bin/activate
    
    # Upgrade pip
    pip install --upgrade pip
    
    # Install CDK dependencies
    print_status "Installing CDK dependencies..."
    pip install -r requirements.txt
    
    print_success "CDK environment ready"
}

# Bootstrap CDK (if needed)
bootstrap_cdk() {
    print_status "Checking CDK bootstrap status..."
    
    # Check if CDK is already bootstrapped
    if aws cloudformation describe-stacks --stack-name CDKToolkit --region "$REGION" &> /dev/null; then
        print_status "CDK already bootstrapped in region $REGION"
    else
        print_status "Bootstrapping CDK in region $REGION..."
        cdk bootstrap --region "$REGION"
        print_success "CDK bootstrapped successfully"
    fi
}

# Build and push Docker image
build_and_push_image() {
    print_status "Building and pushing Docker image..."
    
    # Get ECR repository URI from CDK outputs (if stack exists)
    ECR_URI=""
    if aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" &> /dev/null; then
        ECR_URI=$(aws cloudformation describe-stacks \
            --stack-name "$STACK_NAME" \
            --region "$REGION" \
            --query 'Stacks[0].Outputs[?OutputKey==`EcrRepositoryUri`].OutputValue' \
            --output text 2>/dev/null || echo "")
    fi
    
    if [ -z "$ECR_URI" ] || [ "$ECR_URI" = "None" ]; then
        print_warning "ECR repository not found. Will deploy infrastructure first, then build image."
        return 0
    fi
    
    print_status "ECR Repository: $ECR_URI"
    
    # Login to ECR
    print_status "Logging in to ECR..."
    aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$ECR_URI"
    
    # Build Docker image
    print_status "Building Docker image..."
    
    # Prepare Nova Act build context
    print_status "Preparing Nova Act build context..."
    "$SCRIPT_DIR/prepare-build-context.sh"
    
    # Build from the prepared build context
    cd "$SCRIPT_DIR/build-context"
    
    # Build Nova Act MCP image
    docker build \
        -t nova-act-mcp-fargate .
    
    # Tag and push image
    docker tag nova-act-mcp-fargate:latest "$ECR_URI:latest"
    docker push "$ECR_URI:latest"
    
    # Clean up build context directory
    cd "$SCRIPT_DIR"
    rm -rf "$SCRIPT_DIR/build-context"
    
    print_success "Docker image built and pushed successfully"
}

# Deploy CDK stack
deploy_cdk_stack() {
    print_status "Deploying CDK stack..."
    
    cd "$SCRIPT_DIR/cdk"
    source venv/bin/activate
    
    # Deploy the stack
    cdk deploy --region "$REGION" --require-approval never
    
    print_success "CDK stack deployed successfully"
}

# Update ECS service (force new deployment)
update_ecs_service() {
    print_status "Updating ECS service..."
    
    # Get service details from CDK outputs
    CLUSTER_NAME=$(aws cloudformation describe-stacks \
        --stack-name "$STACK_NAME" \
        --region "$REGION" \
        --query 'Stacks[0].Outputs[?OutputKey==`ClusterName`].OutputValue' \
        --output text 2>/dev/null || echo "")
    
    SERVICE_NAME=$(aws cloudformation describe-stacks \
        --stack-name "$STACK_NAME" \
        --region "$REGION" \
        --query 'Stacks[0].Outputs[?OutputKey==`ServiceName`].OutputValue' \
        --output text 2>/dev/null || echo "")
    
    if [ -n "$CLUSTER_NAME" ] && [ -n "$SERVICE_NAME" ] && [ "$CLUSTER_NAME" != "None" ] && [ "$SERVICE_NAME" != "None" ]; then
        print_status "Forcing ECS service update..."
        aws ecs update-service \
            --cluster "$CLUSTER_NAME" \
            --service "$SERVICE_NAME" \
            --force-new-deployment \
            --region "$REGION" > /dev/null
        
        print_status "Waiting for service to stabilize..."
        aws ecs wait services-stable \
            --cluster "$CLUSTER_NAME" \
            --services "$SERVICE_NAME" \
            --region "$REGION"
        
        print_success "ECS service updated successfully"
    else
        print_warning "Could not find ECS service details for update"
    fi
}

# Test deployment
test_deployment() {
    print_status "Testing deployment..."
    
    # Get MCP endpoint from CDK outputs
    MCP_ENDPOINT=$(aws cloudformation describe-stacks \
        --stack-name "$STACK_NAME" \
        --region "$REGION" \
        --query 'Stacks[0].Outputs[?OutputKey==`McpEndpoint`].OutputValue' \
        --output text 2>/dev/null || echo "")
    
    if [ -n "$MCP_ENDPOINT" ] && [ "$MCP_ENDPOINT" != "None" ]; then
        print_status "Testing MCP endpoint: $MCP_ENDPOINT"
        
        # Wait a bit for the service to be ready
        sleep 30
        
        # Test health check
        if curl -s -f "${MCP_ENDPOINT%/mcp}/health" > /dev/null; then
            print_success "Health check passed"
        else
            print_warning "Health check failed - service might still be starting"
        fi
        
        # Test MCP initialize
        print_status "Testing MCP initialize..."
        response=$(curl -s -X POST "$MCP_ENDPOINT" \
            -H "Content-Type: application/json" \
            -d '{
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {},
                    "clientInfo": {"name": "test-client", "version": "1.0.0"}
                }
            }' || echo "")
        
        if echo "$response" | grep -q "serverInfo"; then
            print_success "MCP initialize test passed"
        else
            print_warning "MCP initialize test failed - response: $response"
        fi
    else
        print_warning "Could not find MCP endpoint for testing"
    fi
}

# Generate deployment summary
generate_summary() {
    print_status "Generating deployment summary..."
    
    echo ""
    echo "=========================================="
    echo "  Playwright MCP Fargate Deployment"
    echo "=========================================="
    echo ""
    
    # Get outputs from CloudFormation
    LOAD_BALANCER_URL=$(aws cloudformation describe-stacks \
        --stack-name "$STACK_NAME" \
        --region "$REGION" \
        --query 'Stacks[0].Outputs[?OutputKey==`LoadBalancerUrl`].OutputValue' \
        --output text 2>/dev/null || echo "Not available")
    
    MCP_ENDPOINT=$(aws cloudformation describe-stacks \
        --stack-name "$STACK_NAME" \
        --region "$REGION" \
        --query 'Stacks[0].Outputs[?OutputKey==`McpEndpoint`].OutputValue' \
        --output text 2>/dev/null || echo "Not available")
    
    ECR_URI=$(aws cloudformation describe-stacks \
        --stack-name "$STACK_NAME" \
        --region "$REGION" \
        --query 'Stacks[0].Outputs[?OutputKey==`EcrRepositoryUri`].OutputValue' \
        --output text 2>/dev/null || echo "Not available")
    
    echo "Stack Name: $STACK_NAME"
    echo "Region: $REGION"
    echo "Load Balancer URL: $LOAD_BALANCER_URL"
    echo "MCP Endpoint: $MCP_ENDPOINT"
    echo "ECR Repository: $ECR_URI"
    echo ""
    echo "Configuration for MCP Client:"
    echo "  URL: $MCP_ENDPOINT"
    echo ""
    echo "=========================================="
}

# Main deployment function
main() {
    local skip_image_build=false
    
    # Parse command line arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            --skip-image)
                skip_image_build=true
                shift
                ;;
            --region)
                REGION="$2"
                shift 2
                ;;
            --stage)
                STAGE="$2"
                STACK_NAME="nova-act-mcp-fargate-${STAGE}"
                shift 2
                ;;
            -h|--help)
                echo "Usage: $0 [OPTIONS]"
                echo ""
                echo "Options:"
                echo "  --skip-image     Skip Docker image build and push"
                echo "  --region REGION  AWS region (default: us-west-2)"
                echo "  --stage STAGE    Deployment stage (default: prod)"
                echo "  -h, --help       Show this help message"
                exit 0
                ;;
            *)
                print_error "Unknown option: $1"
                exit 1
                ;;
        esac
    done
    
    # Run deployment steps
    check_prerequisites

    # Collect Nova Act API key (skip if called from master script)
    if [ "$SKIP_API_KEY_COLLECTION" != "true" ]; then
        collect_nova_act_key
    fi

    setup_cdk_environment
    bootstrap_cdk
    deploy_cdk_stack
    
    if [ "$skip_image_build" = false ]; then
        build_and_push_image
        update_ecs_service
    else
        print_warning "Skipping Docker image build as requested"
    fi
    
    test_deployment
    generate_summary
    
    print_success "Deployment completed successfully!"
}

# Run main function with all arguments
main "$@"
