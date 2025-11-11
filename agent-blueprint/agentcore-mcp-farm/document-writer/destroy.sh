#!/bin/bash

# Document Writer MCP Server AgentCore Destroy Script
# This script removes all resources created by the deployment

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
CDK_DIR="$SCRIPT_DIR/cdk"

# Load environment from .env file (project root)
ENV_FILE="$SCRIPT_DIR/../../.env"
if [ -f "$ENV_FILE" ]; then
    set -a
    source "$ENV_FILE"
    set +a
fi

REGION="${AWS_REGION:-us-west-2}"
STACK_NAME="DocumentWriterAgentCoreStack"

print_status "=========================================="
print_status "Document Writer MCP AgentCore Cleanup"
print_status "=========================================="
echo ""
print_status "Destroying the following resources:"
echo "  - Bedrock AgentCore Runtime"
echo "  - ECR Repository and all images"
echo "  - S3 Bucket (WARNING: This will delete all documents!)"
echo "  - IAM Roles and Policies"
echo "  - CloudWatch Log Groups"
echo "  - SSM Parameters"
echo ""
print_status "Stack: $STACK_NAME"
print_status "Region: $REGION"
echo ""

# Prompt for confirmation
read -p "Are you sure you want to delete all resources? (type 'yes' to confirm): " confirmation
if [ "$confirmation" != "yes" ]; then
    print_status "Cleanup cancelled"
    exit 0
fi

# Get stack outputs before deletion
get_resources() {
    print_status "Retrieving resource information..."

    ECR_REPO_NAME=$(aws cloudformation describe-stacks \
        --stack-name "$STACK_NAME" \
        --region $REGION \
        --query 'Stacks[0].Outputs[?OutputKey==`EcrRepositoryName`].OutputValue' \
        --output text 2>/dev/null || echo "")

    BUCKET_NAME=$(aws cloudformation describe-stacks \
        --stack-name "$STACK_NAME" \
        --region $REGION \
        --query 'Stacks[0].Outputs[?OutputKey==`DocumentBucketName`].OutputValue' \
        --output text 2>/dev/null || echo "")

    print_status "ECR Repository: ${ECR_REPO_NAME:-Not found}"
    print_status "S3 Bucket: ${BUCKET_NAME:-Not found}"
}

# List documents in S3 bucket
list_documents() {
    if [ -z "$BUCKET_NAME" ] || [ "$BUCKET_NAME" == "None" ]; then
        print_status "No S3 bucket to check"
        return
    fi

    print_status "Listing documents in bucket: $BUCKET_NAME"

    DOCUMENT_COUNT=$(aws s3 ls "s3://$BUCKET_NAME/documents/" --recursive --region $REGION 2>/dev/null | wc -l || echo "0")

    if [ "$DOCUMENT_COUNT" -gt 0 ]; then
        print_warning "Found $DOCUMENT_COUNT document(s) in the bucket"
        print_warning "These will be permanently deleted!"
        echo ""
        aws s3 ls "s3://$BUCKET_NAME/documents/" --recursive --region $REGION --human-readable || true
        echo ""
        read -p "Continue with deletion? (type 'yes' to confirm): " doc_confirmation
        if [ "$doc_confirmation" != "yes" ]; then
            print_status "Cleanup cancelled"
            exit 0
        fi
    else
        print_status "No documents found in bucket"
    fi
}

# Empty S3 bucket
empty_s3_bucket() {
    if [ -z "$BUCKET_NAME" ] || [ "$BUCKET_NAME" == "None" ]; then
        print_status "No S3 bucket to empty"
        return
    fi

    print_status "Emptying S3 bucket: $BUCKET_NAME"

    # Delete all objects and versions
    aws s3 rm "s3://$BUCKET_NAME" --recursive --region $REGION 2>/dev/null || print_warning "Failed to empty bucket"

    print_success "S3 bucket emptied"
}

# Delete SSM parameter
delete_ssm_parameter() {
    print_status "Deleting SSM parameter..."

    SSM_PARAM="/mcp/endpoints/agentcore/document-writer"

    if aws ssm get-parameter --name "$SSM_PARAM" --region $REGION &> /dev/null; then
        aws ssm delete-parameter --name "$SSM_PARAM" --region $REGION || true
        print_success "SSM parameter deleted"
    else
        print_status "SSM parameter does not exist"
    fi
}

# Destroy CDK stack
destroy_cdk_stack() {
    print_status "Destroying CDK stack..."

    cd "$CDK_DIR"

    # Check if virtual environment exists
    if [ -d ".venv" ]; then
        source .venv/bin/activate
    else
        print_warning "Virtual environment not found. Creating one..."
        python3 -m venv .venv
        source .venv/bin/activate
        pip install -q --upgrade pip
        pip install -q -r requirements.txt
    fi

    # Set environment variables
    export AWS_REGION=$REGION

    # Check if stack exists
    if aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region $REGION &> /dev/null; then
        # Destroy stack
        print_status "Destroying stack $STACK_NAME..."
        cdk destroy --force

        print_success "CDK stack destroyed"
    else
        print_warning "Stack $STACK_NAME does not exist"
    fi
}

# Delete ECR repository and images
delete_ecr_repository() {
    if [ -z "$ECR_REPO_NAME" ] || [ "$ECR_REPO_NAME" == "None" ]; then
        print_status "No ECR repository to clean up"
        return
    fi

    print_status "Deleting ECR repository and images: $ECR_REPO_NAME"

    # Delete repository with --force flag (deletes images automatically)
    if aws ecr delete-repository \
        --repository-name "$ECR_REPO_NAME" \
        --region $REGION \
        --force 2>/dev/null; then
        print_success "ECR repository deleted"
    else
        print_warning "Failed to delete ECR repository (may not exist)"
    fi
}

# Clean up CDK environment
cleanup_cdk_environment() {
    print_status "Cleaning up CDK environment..."

    cd "$CDK_DIR"

    # Remove cdk.out directory
    if [ -d "cdk.out" ]; then
        rm -rf cdk.out
        print_status "Removed cdk.out directory"
    fi

    # Remove outputs.json
    if [ -f "outputs.json" ]; then
        rm -f outputs.json
        print_status "Removed outputs.json"
    fi

    print_success "CDK environment cleaned up"
}

# Display cleanup summary
display_summary() {
    print_status "=========================================="
    print_success "Cleanup completed successfully!"
    print_status "=========================================="
    echo ""
    print_status "Removed resources:"
    echo "  ✓ Bedrock AgentCore Runtime"
    echo "  ✓ ECR Repository and images"
    echo "  ✓ S3 Bucket and all documents"
    echo "  ✓ IAM Roles and Policies"
    echo "  ✓ CloudWatch Log Groups"
    echo "  ✓ SSM Parameters"
    echo ""
}

# Main execution
main() {
    get_resources
    list_documents
    empty_s3_bucket
    delete_ssm_parameter
    destroy_cdk_stack
    delete_ecr_repository
    cleanup_cdk_environment
    display_summary
}

# Run main function
main
