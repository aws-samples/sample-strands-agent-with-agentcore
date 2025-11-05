#!/bin/bash

set -e

echo "Starting Chatbot destruction..."

# Set region - use environment variable or default
export AWS_REGION=${AWS_REGION:-us-west-2}
export AWS_DEFAULT_REGION=$AWS_REGION

echo "🌍 Destruction region: $AWS_REGION"

# Get account ID
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "Destroying from AWS Account: $ACCOUNT_ID in region: $AWS_REGION"

# Get the absolute path to the infrastructure directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRASTRUCTURE_DIR="$(dirname "$SCRIPT_DIR")"

# Change to the CDK infrastructure directory
cd "$INFRASTRUCTURE_DIR"

# Debug: Show current directory
echo "📂 Current directory: $(pwd)"

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing CDK dependencies..."
    npm install
fi

# Set CDK environment variables
export CDK_DEFAULT_ACCOUNT=$ACCOUNT_ID
export CDK_DEFAULT_REGION=$AWS_REGION

echo "🗑️  Destroying Chatbot stacks..."

# Function to ensure stack deletion starts
ensure_stack_deletion() {
    local stack_name=$1
    local display_name=$2

    echo "$display_name Destroying $stack_name..."

    # Try CDK destroy first
    npx cdk destroy $stack_name --force --require-approval never 2>&1 || true

    # Wait a moment for deletion to start
    sleep 3

    # Check if deletion actually started
    if aws cloudformation describe-stacks --stack-name "$stack_name" --region $AWS_REGION &>/dev/null; then
        stack_status=$(aws cloudformation describe-stacks --stack-name "$stack_name" --region $AWS_REGION --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo "DELETED")

        if [[ "$stack_status" != "DELETE_IN_PROGRESS" && "$stack_status" != "DELETE_COMPLETE" && "$stack_status" != "DELETED" ]]; then
            echo "⚠️  CDK destroy did not start deletion (status: $stack_status), using CloudFormation directly..."
            aws cloudformation delete-stack --stack-name "$stack_name" --region $AWS_REGION
            echo "✅ CloudFormation delete-stack command executed for $stack_name"
        else
            echo "✅ Stack deletion in progress for $stack_name"
        fi
    else
        echo "✅ $stack_name already deleted or not found"
    fi
}

# Check if Cognito stack exists and destroy it first (due to dependencies)
if aws cloudformation describe-stacks --stack-name "CognitoAuthStack" --region $AWS_REGION &>/dev/null; then
    ensure_stack_deletion "CognitoAuthStack" "🔐"
else
    echo "ℹ️  CognitoAuthStack not found or already destroyed"
fi

# Destroy main Chatbot stack
if aws cloudformation describe-stacks --stack-name "ChatbotStack" --region $AWS_REGION &>/dev/null; then
    ensure_stack_deletion "ChatbotStack" "🚀"
else
    echo "ℹ️  ChatbotStack not found or already destroyed"
fi

# Function to wait for stack deletion with progress
wait_for_stack_deletion() {
    local stack_name=$1
    local max_wait=600  # 10 minutes
    local elapsed=0
    local interval=10

    echo "⏳ Waiting for $stack_name deletion..."

    while [ $elapsed -lt $max_wait ]; do
        # Check stack status
        stack_status=$(aws cloudformation describe-stacks --stack-name "$stack_name" --region $AWS_REGION --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo "DELETED")

        if [ "$stack_status" == "DELETED" ] || [ "$stack_status" == "DELETE_COMPLETE" ]; then
            echo "✅ $stack_name deleted successfully"
            return 0
        elif [ "$stack_status" == "DELETE_FAILED" ]; then
            echo "❌ $stack_name deletion failed"
            return 1
        else
            echo "   ⏳ Status: $stack_status (${elapsed}s elapsed)"
            sleep $interval
            elapsed=$((elapsed + interval))
        fi
    done

    echo "⚠️  Timeout waiting for $stack_name deletion (waited ${max_wait}s)"
    return 1
}

# Wait for stacks to be deleted
echo "⏳ Waiting for stacks to be deleted..."

# Wait for Cognito stack deletion
if aws cloudformation describe-stacks --stack-name "CognitoAuthStack" --region $AWS_REGION &>/dev/null; then
    wait_for_stack_deletion "CognitoAuthStack"
fi

# Wait for main stack deletion
if aws cloudformation describe-stacks --stack-name "ChatbotStack" --region $AWS_REGION &>/dev/null; then
    wait_for_stack_deletion "ChatbotStack"
fi

echo "✅ Chatbot destruction completed successfully!"
echo ""
echo "🧹 Optional cleanup:"
echo "  - ECR repositories: chatbot-backend, chatbot-frontend"
echo "  - CloudWatch log groups: /aws/ecs/chatbot-*"
echo "  - Parameter Store entries: /mcp/endpoints/*"
echo ""
echo "Run the following commands to clean up ECR repositories:"
echo "  aws ecr delete-repository --repository-name chatbot-backend --force --region $AWS_REGION"
echo "  aws ecr delete-repository --repository-name chatbot-frontend --force --region $AWS_REGION"