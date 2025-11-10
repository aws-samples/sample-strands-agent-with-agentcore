#!/bin/bash

# S3 Iceberg MCP Server AgentCore Deployment Script
# This script builds and deploys the S3 Iceberg MCP server to AWS Bedrock AgentCore Runtime

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

# Parse command line arguments
SKIP_SAMPLE_DATA=false
for arg in "$@"; do
    case $arg in
        --skip-sample-data)
            SKIP_SAMPLE_DATA=true
            shift
            ;;
        -h|--help)
            echo "S3 Iceberg MCP Server AgentCore Deployment Script"
            echo ""
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --skip-sample-data    Skip loading sample e-commerce data"
            echo "  -h, --help            Show this help message"
            echo ""
            echo "Environment Variables:"
            echo "  AWS_REGION            AWS region (default: from .env file)"
            echo "  STAGE                 Deployment stage (default: prod)"
            echo ""
            echo "Note: Sample data is loaded by default. Use --skip-sample-data to skip."
            exit 0
            ;;
    esac
done

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="$SCRIPT_DIR/src"
CDK_DIR="$SCRIPT_DIR/cdk"

# Load environment from .env file (project root)
ENV_FILE="$SCRIPT_DIR/../../.env"
if [ -f "$ENV_FILE" ]; then
    print_status "Loading environment from $ENV_FILE"
    # Source .env file with automatic export
    set -a
    source "$ENV_FILE"
    set +a
else
    print_warning "No .env file found at $ENV_FILE"
fi

REGION="${AWS_REGION}"
STAGE="${STAGE:-prod}"
STACK_NAME="s3-iceberg-agentcore-${STAGE}"

# Validate required configuration
if [ -z "$REGION" ]; then
    print_error "AWS_REGION is not set. Please set it in $ENV_FILE"
    exit 1
fi

print_status "Starting S3 Iceberg MCP AgentCore deployment..."
print_status "Script directory: $SCRIPT_DIR"
print_status "Source directory: $SOURCE_DIR"
print_status "CDK directory: $CDK_DIR"
print_status "Region: $REGION"
print_status "Stage: $STAGE"
print_status "Stack name: $STACK_NAME"

# Check prerequisites
check_prerequisites() {
    print_status "Checking prerequisites..."

    # Check if AWS CLI is installed
    if ! command -v aws &> /dev/null; then
        print_error "AWS CLI is required but not installed. Please install AWS CLI first."
        exit 1
    fi

    # Check AWS credentials
    if ! aws sts get-caller-identity &> /dev/null; then
        print_error "AWS credentials not configured. Please configure AWS CLI first."
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

    # Check for docker buildx
    if ! docker buildx version &> /dev/null; then
        print_error "Docker buildx is required for ARM64 builds."
        print_error "Please install Docker buildx: https://docs.docker.com/buildx/working-with-buildx/"
        exit 1
    fi

    # Check if Python 3 is installed
    if ! command -v python3 &> /dev/null; then
        print_error "Python 3 is required but not installed."
        exit 1
    fi

    # Check if source directory exists
    if [ ! -d "$SOURCE_DIR" ]; then
        print_error "Source directory not found: $SOURCE_DIR"
        exit 1
    fi

    # Check if key files exist
    if [ ! -f "$SOURCE_DIR/mcp_server.py" ]; then
        print_error "MCP server file not found: $SOURCE_DIR/mcp_server.py"
        exit 1
    fi

    if [ ! -f "$SOURCE_DIR/Dockerfile" ]; then
        print_error "Dockerfile not found: $SOURCE_DIR/Dockerfile"
        exit 1
    fi

    print_success "All prerequisites met"
}

# Setup Python virtual environment for CDK
setup_cdk_environment() {
    print_status "Setting up CDK environment..."

    cd "$CDK_DIR"

    # Create virtual environment if it doesn't exist
    if [ ! -d ".venv" ]; then
        print_status "Creating Python virtual environment..."
        python3 -m venv .venv
    fi

    # Activate virtual environment
    source .venv/bin/activate

    # Install CDK dependencies
    print_status "Installing CDK dependencies..."
    pip install -q --upgrade pip
    pip install -q -r requirements.txt

    print_success "CDK environment ready"
}

# Bootstrap CDK if needed
bootstrap_cdk() {
    print_status "Checking CDK bootstrap status..."

    # Check if bootstrap is needed
    if ! aws cloudformation describe-stacks --stack-name CDKToolkit --region $REGION &> /dev/null; then
        print_status "Bootstrapping CDK for region $REGION..."
        cdk bootstrap aws://$(aws sts get-caller-identity --query Account --output text)/$REGION
        print_success "CDK bootstrap completed"
    else
        print_status "CDK already bootstrapped"
    fi
}

# Deploy CDK stack
deploy_cdk_stack() {
    print_status "Deploying CDK stack..."

    cd "$CDK_DIR"
    source .venv/bin/activate

    # Set environment variables
    export AWS_REGION=$REGION
    export STAGE=$STAGE

    # Synthesize CloudFormation template
    print_status "Synthesizing CloudFormation template..."
    cdk synth

    # Deploy stack
    print_status "Deploying stack $STACK_NAME..."
    cdk deploy --require-approval never --outputs-file outputs.json

    print_success "CDK stack deployed successfully"
}

# Get stack outputs
get_stack_outputs() {
    print_status "Retrieving stack outputs..."

    cd "$CDK_DIR"

    # Read outputs from file
    if [ -f "outputs.json" ]; then
        ECR_URI=$(cat outputs.json | python3 -c "import json, sys; print(json.load(sys.stdin)['$STACK_NAME']['EcrRepositoryUri'])")
        RUNTIME_ENDPOINT=$(cat outputs.json | python3 -c "import json, sys; print(json.load(sys.stdin)['$STACK_NAME']['RuntimeEndpoint'])")
        BUCKET_NAME=$(cat outputs.json | python3 -c "import json, sys; print(json.load(sys.stdin)['$STACK_NAME']['TableBucketName'])")
    else
        # Fallback to CloudFormation describe-stacks
        ECR_URI=$(aws cloudformation describe-stacks \
            --stack-name "$STACK_NAME" \
            --region $REGION \
            --query 'Stacks[0].Outputs[?OutputKey==`EcrRepositoryUri`].OutputValue' \
            --output text)

        RUNTIME_ENDPOINT=$(aws cloudformation describe-stacks \
            --stack-name "$STACK_NAME" \
            --region $REGION \
            --query 'Stacks[0].Outputs[?OutputKey==`RuntimeEndpoint`].OutputValue' \
            --output text)

        BUCKET_NAME=$(aws cloudformation describe-stacks \
            --stack-name "$STACK_NAME" \
            --region $REGION \
            --query 'Stacks[0].Outputs[?OutputKey==`TableBucketName`].OutputValue' \
            --output text)
    fi

    if [ -z "$ECR_URI" ] || [ "$ECR_URI" == "None" ]; then
        print_error "Failed to retrieve ECR repository URI from stack outputs"
        exit 1
    fi

    print_success "Stack outputs retrieved"
    print_status "ECR URI: $ECR_URI"
    print_status "Runtime Endpoint: $RUNTIME_ENDPOINT"
    print_status "S3 Bucket: $BUCKET_NAME"
}

# Build and push Docker image
build_and_push_image() {
    print_status "Building and pushing Docker image..."

    cd "$SOURCE_DIR"

    # Login to ECR
    print_status "Logging in to ECR..."
    aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin $ECR_URI

    # Create buildx builder if needed
    if ! docker buildx inspect multiarch-builder &> /dev/null; then
        print_status "Creating multi-architecture builder..."
        docker buildx create --name multiarch-builder --use
        docker buildx inspect --bootstrap
    else
        docker buildx use multiarch-builder
    fi

    # Build image for ARM64
    print_status "Building Docker image for ARM64..."
    docker buildx build \
        --platform linux/arm64 \
        --tag $ECR_URI:latest \
        --tag $ECR_URI:$STAGE \
        --push \
        .

    print_success "Docker image built and pushed successfully"
}

# Test deployment
test_deployment() {
    print_status "Testing deployment..."

    if [ -z "$RUNTIME_ENDPOINT" ] || [ "$RUNTIME_ENDPOINT" == "None" ]; then
        print_warning "Runtime endpoint not available. Skipping tests."
        return
    fi

    # Wait for runtime to be ready
    print_status "Waiting for runtime to be ready..."
    sleep 60

    # Test health endpoint
    print_status "Testing health endpoint..."
    if curl -f -s "${RUNTIME_ENDPOINT}/health" > /dev/null 2>&1; then
        print_success "Health check passed"
    else
        print_warning "Health check failed. Runtime may still be initializing."
    fi

    # Test MCP initialize
    print_status "Testing MCP initialize..."
    if curl -f -s -X POST "${RUNTIME_ENDPOINT}/mcp" \
        -H "Content-Type: application/json" \
        -d '{"jsonrpc":"2.0","method":"initialize","id":1,"params":{}}' > /dev/null 2>&1; then
        print_success "MCP initialize test passed"
    else
        print_warning "MCP initialize test failed. Check CloudWatch logs for details."
    fi
}

# Load sample data
load_sample_data() {
    print_status "=========================================="
    print_status "Loading sample e-commerce data..."
    print_status "=========================================="

    cd "$SCRIPT_DIR"

    # Check if scripts directory exists
    if [ ! -d "scripts" ]; then
        print_error "Scripts directory not found: $SCRIPT_DIR/scripts"
        print_warning "Sample data loading failed. Continuing..."
        return 1
    fi

    # Check if generate_sample_data.py exists
    if [ ! -f "scripts/generate_sample_data.py" ]; then
        print_error "Data generation script not found: $SCRIPT_DIR/scripts/generate_sample_data.py"
        print_warning "Sample data loading failed. Continuing..."
        return 1
    fi

    # Check Python dependencies
    print_status "Checking Python dependencies..."
    python3 -c "import boto3, pyarrow, pyiceberg" 2>/dev/null || {
        print_warning "Missing Python dependencies. Installing..."
        pip3 install boto3 pyarrow pyiceberg pandas || {
            print_error "Failed to install dependencies"
            print_warning "Sample data loading failed. Continuing..."
            return 1
        }
    }

    # Run the data generation script
    print_status "Running data generation script..."
    if python3 scripts/generate_sample_data.py --auto; then
        print_success "Sample data loaded successfully!"
    else
        print_warning "Sample data loading failed (non-critical). Deployment is still complete."
        print_status "You can manually load data later by running:"
        print_status "  cd $SCRIPT_DIR && ./scripts/load_data.sh"
        return 1
    fi
}

# Display deployment summary
display_summary() {
    print_status "=========================================="
    print_success "Deployment completed successfully!"
    print_status "=========================================="
    echo ""
    echo "Stack Name:         $STACK_NAME"
    echo "Region:             $REGION"
    echo "Stage:              $STAGE"
    echo ""
    echo "ECR Repository:     $ECR_URI"
    echo "Runtime Endpoint:   $RUNTIME_ENDPOINT"
    echo "S3 Bucket:          $BUCKET_NAME"
    echo ""
    echo "SSM Parameter:      /mcp/endpoints/agentcore/s3-iceberg"
    echo "CloudWatch Logs:    /aws/bedrockagentcore/$STACK_NAME"
    echo ""

    if [[ "$SKIP_SAMPLE_DATA" != "true" ]]; then
        print_status "Sample Data:        Loaded (100 customers, 200 products, 500 orders)"
    else
        print_status "Sample Data:        Skipped (--skip-sample-data flag used)"
        print_status "To load sample data later, run:"
        echo "  cd $SCRIPT_DIR && ./scripts/load_data.sh"
        echo ""
    fi

    print_status "To view logs:"
    echo "  aws logs tail /aws/bedrockagentcore/$STACK_NAME --follow"
    echo ""
    print_status "To test the MCP server:"
    echo "  curl -X POST $RUNTIME_ENDPOINT/mcp \\"
    echo "    -H 'Content-Type: application/json' \\"
    echo "    -d '{\"jsonrpc\":\"2.0\",\"method\":\"tools/list\",\"id\":1}'"
    echo ""
}

# Create ECR repository (before CDK deployment)
create_ecr_repository() {
    print_status "Creating ECR repository..."

    local repo_name="${STACK_NAME}-repository"

    # Check if repository already exists
    if aws ecr describe-repositories --repository-names "$repo_name" --region $REGION > /dev/null 2>&1; then
        print_status "ECR repository already exists: $repo_name"
    else
        print_status "Creating new ECR repository: $repo_name"
        aws ecr create-repository \
            --repository-name "$repo_name" \
            --region $REGION 
        print_success "ECR repository created: $repo_name"
    fi

    # Get repository URI
    ECR_REPO_NAME="$repo_name"
    ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
    ECR_URI="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${repo_name}"

    print_status "ECR Repository: $ECR_URI"
}

# Build and push Docker image (before CDK deployment)
build_and_push_image_initial() {
    print_status "Building and pushing Docker image..."

    cd "$SOURCE_DIR"

    # Login to ECR
    print_status "Logging in to ECR..."
    aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin ${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com

    # Build Docker image for ARM64
    # Note: No build args needed - configuration is auto-discovered at runtime via boto3
    print_status "Building Docker image for ARM64..."
    print_status "Container will auto-discover S3 Tables configuration at runtime"
    docker buildx build \
        --platform linux/arm64 \
        --tag ${ECR_URI}:latest \
        --tag ${ECR_URI}:${STAGE} \
        --load \
        .

    # Push images
    print_status "Pushing Docker images to ECR..."
    docker push ${ECR_URI}:latest
    docker push ${ECR_URI}:${STAGE}

    print_success "Docker image built and pushed successfully"

    cd "$SCRIPT_DIR"
}

# Main execution
main() {
    check_prerequisites
    setup_cdk_environment
    bootstrap_cdk

    # NEW ORDER: Create ECR and push image BEFORE CDK deployment
    create_ecr_repository
    build_and_push_image_initial

    # Now deploy CDK stack (AgentCore Runtime can pull the image)
    deploy_cdk_stack
    get_stack_outputs

    # Update runtime and test
    test_deployment

    # Load sample data by default (unless skipped)
    if [[ "$SKIP_SAMPLE_DATA" != "true" ]]; then
        load_sample_data
    else
        print_status "Skipping sample data load (--skip-sample-data flag used)"
    fi

    display_summary
}

# Run main function
main
