#!/bin/bash

# Nova Act MCP Server Fargate Destruction Script
# This script destroys the Nova Act MCP server Fargate deployment

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
REGION="${AWS_REGION:-us-west-2}"
STAGE="${STAGE:-prod}"
STACK_NAME="nova-act-mcp-fargate"

print_status "Starting Nova Act MCP Fargate destruction..."
print_status "Region: $REGION"
print_status "Stage: $STAGE"
print_status "Stack name: $STACK_NAME"

# Confirm destruction
confirm_destruction() {
    echo ""
    print_warning "Destroying the following resources:"
    print_warning "  - ECS Fargate cluster and service"
    print_warning "  - Application Load Balancer"
    print_warning "  - ECR repository and all images"
    print_warning "  - VPC and networking resources"
    print_warning "  - CloudWatch log groups"
    print_warning "  - IAM roles and policies"
    echo ""
}

# Setup CDK environment
setup_cdk_environment() {
    print_status "Setting up CDK environment..."
    
    cd "$SCRIPT_DIR/cdk"
    
    # Check if virtual environment exists
    if [ ! -d "venv" ]; then
        print_error "CDK virtual environment not found. Please run deploy.sh first."
        exit 1
    fi
    
    # Activate virtual environment
    source venv/bin/activate
    
    print_success "CDK environment ready"
}

# Empty ECR repository before destruction
empty_ecr_repository() {
    print_status "Emptying ECR repository..."
    
    # Get ECR repository name from CDK outputs
    ECR_REPO_NAME=""
    if aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" &> /dev/null; then
        ECR_REPO_NAME=$(aws cloudformation describe-stacks \
            --stack-name "$STACK_NAME" \
            --region "$REGION" \
            --query 'Stacks[0].Outputs[?OutputKey==`EcrRepositoryUri`].OutputValue' \
            --output text 2>/dev/null | cut -d'/' -f2 || echo "")
    fi
    
    if [ -n "$ECR_REPO_NAME" ] && [ "$ECR_REPO_NAME" != "None" ]; then
        print_status "Deleting all images from ECR repository: $ECR_REPO_NAME"
        
        # Get all image tags
        IMAGE_TAGS=$(aws ecr list-images \
            --repository-name "$ECR_REPO_NAME" \
            --region "$REGION" \
            --query 'imageIds[?imageTag!=null].imageTag' \
            --output text 2>/dev/null || echo "")
        
        if [ -n "$IMAGE_TAGS" ]; then
            # Delete images with tags
            for tag in $IMAGE_TAGS; do
                aws ecr batch-delete-image \
                    --repository-name "$ECR_REPO_NAME" \
                    --image-ids imageTag="$tag" \
                    --region "$REGION" > /dev/null 2>&1 || true
            done
        fi
        
        # Delete untagged images
        UNTAGGED_IMAGES=$(aws ecr list-images \
            --repository-name "$ECR_REPO_NAME" \
            --region "$REGION" \
            --filter tagStatus=UNTAGGED \
            --query 'imageIds[].imageDigest' \
            --output text 2>/dev/null || echo "")
        
        if [ -n "$UNTAGGED_IMAGES" ]; then
            for digest in $UNTAGGED_IMAGES; do
                aws ecr batch-delete-image \
                    --repository-name "$ECR_REPO_NAME" \
                    --image-ids imageDigest="$digest" \
                    --region "$REGION" > /dev/null 2>&1 || true
            done
        fi
        
        print_success "ECR repository emptied"
    else
        print_warning "ECR repository not found or already deleted"
    fi
}

# Destroy CDK stack
destroy_cdk_stack() {
    print_status "Destroying CDK stack..."
    
    cd "$SCRIPT_DIR/cdk"
    source venv/bin/activate
    
    # Check if stack exists
    if ! aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" &> /dev/null; then
        print_warning "Stack $STACK_NAME does not exist in region $REGION"
        return 0
    fi
    
    # Destroy the stack
    cdk destroy --region "$REGION" --force
    
    print_success "CDK stack destroyed successfully"
}

# Clean up local resources
cleanup_local() {
    print_status "Cleaning up local resources..."
    
    cd "$SCRIPT_DIR"
    
    # Remove CDK virtual environment
    if [ -d "cdk/venv" ]; then
        rm -rf cdk/venv
        print_status "Removed CDK virtual environment"
    fi
    
    # Remove CDK output files
    if [ -d "cdk/cdk.out" ]; then
        rm -rf cdk/cdk.out
        print_status "Removed CDK output files"
    fi
    
    print_success "Local cleanup completed"
}

# Main destruction function
main() {
    local force=false
    local skip_confirmation=false
    
    # Parse command line arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            --force)
                force=true
                skip_confirmation=true
                shift
                ;;
            --region)
                REGION="$2"
                shift 2
                ;;
            --stage)
                STAGE="$2"
                STACK_NAME="nova-act-mcp-fargate"
                shift 2
                ;;
            -y|--yes)
                skip_confirmation=true
                shift
                ;;
            -h|--help)
                echo "Usage: $0 [OPTIONS]"
                echo ""
                echo "Options:"
                echo "  --force          Force destruction without confirmation"
                echo "  --region REGION  AWS region (default: us-west-2)"
                echo "  --stage STAGE    Deployment stage (default: prod)"
                echo "  -y, --yes        Skip confirmation prompt"
                echo "  -h, --help       Show this help message"
                exit 0
                ;;
            *)
                print_error "Unknown option: $1"
                exit 1
                ;;
        esac
    done
    
    # Confirm destruction unless skipped
    if [ "$skip_confirmation" = false ]; then
        confirm_destruction
    fi
    
    # Run destruction steps
    setup_cdk_environment
    empty_ecr_repository
    destroy_cdk_stack
    cleanup_local
    
    echo ""
    print_success "Nova Act MCP Fargate deployment destroyed successfully!"
    print_status "All AWS resources have been removed."
    echo ""
}

# Run main function with all arguments
main "$@"
