#!/bin/bash

# S3 Iceberg MCP Server AgentCore Destroy Script
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
REGION="${AWS_REGION:-us-west-2}"
STAGE="${STAGE:-prod}"
STACK_NAME="s3-iceberg-agentcore-${STAGE}"

print_status "=========================================="
print_status "S3 Iceberg MCP AgentCore Cleanup"
print_status "=========================================="
echo ""
print_status "Destroying the following resources:"
echo "  - Bedrock AgentCore Runtime"
echo "  - ECR Repository and all images"
echo "  - S3 Bucket (and all Iceberg tables)"
echo "  - IAM Roles and Policies"
echo "  - Security Groups"
echo "  - CloudWatch Log Groups"
echo "  - SSM Parameters"
echo ""
print_status "Stack: $STACK_NAME"
print_status "Region: $REGION"
echo ""

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
        --query 'Stacks[0].Outputs[?OutputKey==`TableBucketName`].OutputValue' \
        --output text 2>/dev/null || echo "")

    print_status "ECR Repository: ${ECR_REPO_NAME:-Not found}"
    print_status "S3 Bucket: ${BUCKET_NAME:-Not found}"
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

# Clean up S3 Tables bucket
clean_table_bucket() {
    if [ -z "$BUCKET_NAME" ] || [ "$BUCKET_NAME" == "None" ]; then
        print_status "No S3 Tables bucket to clean up"
        return
    fi

    print_status "Cleaning up S3 Tables bucket: $BUCKET_NAME"

    # Get Table Bucket ARN from stack outputs
    TABLE_BUCKET_ARN=$(aws cloudformation describe-stacks \
        --stack-name "$STACK_NAME" \
        --region $REGION \
        --query 'Stacks[0].Outputs[?OutputKey==`TableBucketArn`].OutputValue' \
        --output text 2>/dev/null || echo "")

    if [ -z "$TABLE_BUCKET_ARN" ] || [ "$TABLE_BUCKET_ARN" == "None" ]; then
        print_warning "Could not retrieve Table Bucket ARN, skipping table deletion"
        return
    fi

    print_status "Table Bucket ARN: $TABLE_BUCKET_ARN"

    # List all tables in the default namespace
    print_status "Listing tables in namespace 'default'..."
    TABLES=$(aws s3tables list-tables \
        --table-bucket-arn "$TABLE_BUCKET_ARN" \
        --namespace "default" \
        --region $REGION \
        --query 'tables[*].name' \
        --output text 2>/dev/null || echo "")

    if [ -z "$TABLES" ]; then
        print_status "No tables found to delete"
        return
    fi

    print_status "Found tables: $TABLES"

    # Delete each table
    for table in $TABLES; do
        print_status "Deleting table: $table"
        aws s3tables delete-table \
            --table-bucket-arn "$TABLE_BUCKET_ARN" \
            --namespace "default" \
            --name "$table" \
            --region $REGION 2>/dev/null || print_warning "Failed to delete table: $table"
    done

    print_success "All tables deleted from S3 Tables bucket"
}

# Delete SSM parameter
delete_ssm_parameter() {
    print_status "Deleting SSM parameter..."

    SSM_PARAM="/mcp/endpoints/agentcore/s3-iceberg"

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
    export STAGE=$STAGE

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

# Clean up CDK environment
cleanup_cdk_environment() {
    print_status "Cleaning up CDK environment..."

    cd "$CDK_DIR"

    # Remove CDK outputs
    rm -rf outputs.json cdk.out

    print_success "CDK environment cleaned up"
}

# Display cleanup summary
display_summary() {
    print_status "=========================================="
    print_success "Cleanup completed successfully!"
    print_status "=========================================="
    echo ""
    echo "Deleted resources:"
    echo "  - Stack: $STACK_NAME"
    echo "  - ECR Repository: ${ECR_REPO_NAME:-N/A}"
    echo "  - S3 Bucket: ${BUCKET_NAME:-N/A}"
    echo "  - SSM Parameter: /mcp/endpoints/agentcore/s3-iceberg"
    echo ""
    print_status "All resources have been removed."
}

# Main execution
main() {
    get_resources
    clean_table_bucket          # Delete tables first
    delete_ssm_parameter        # Delete SSM parameter
    destroy_cdk_stack           # Destroy CDK stack
    delete_ecr_repository       # Delete ECR repo (created outside CDK)
    cleanup_cdk_environment     # Clean up CDK artifacts
    display_summary
}

# Run main function
main
