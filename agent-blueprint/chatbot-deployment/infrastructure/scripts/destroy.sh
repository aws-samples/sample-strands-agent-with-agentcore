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

# Check if Cognito stack exists and destroy it first (due to dependencies)
if aws cloudformation describe-stacks --stack-name "CognitoAuthStack" --region $AWS_REGION &>/dev/null; then
    echo "🔐 Destroying Cognito Authentication stack..."
    npx cdk destroy CognitoAuthStack --force --require-approval never || {
        echo "⚠️  CDK destroy failed for CognitoAuthStack, trying CloudFormation..."
        aws cloudformation delete-stack --stack-name "CognitoAuthStack" --region $AWS_REGION
    }
else
    echo "ℹ️  CognitoAuthStack not found or already destroyed"
fi

# Destroy main Chatbot stack
if aws cloudformation describe-stacks --stack-name "ChatbotStack" --region $AWS_REGION &>/dev/null; then
    echo "🚀 Destroying main Chatbot stack..."
    npx cdk destroy ChatbotStack --force --require-approval never || {
        echo "⚠️  CDK destroy failed for ChatbotStack, trying CloudFormation..."
        aws cloudformation delete-stack --stack-name "ChatbotStack" --region $AWS_REGION
    }
else
    echo "ℹ️  ChatbotStack not found or already destroyed"
fi

# Wait for stacks to be deleted
echo "⏳ Waiting for stacks to be deleted..."

# Wait for Cognito stack deletion
if aws cloudformation describe-stacks --stack-name "CognitoAuthStack" --region $AWS_REGION &>/dev/null; then
    echo "⏳ Waiting for CognitoAuthStack deletion..."
    aws cloudformation wait stack-delete-complete --stack-name "CognitoAuthStack" --region $AWS_REGION 2>/dev/null || {
        echo "⚠️  CognitoAuthStack deletion timeout or already completed"
    }
fi

# Wait for main stack deletion
if aws cloudformation describe-stacks --stack-name "ChatbotStack" --region $AWS_REGION &>/dev/null; then
    echo "⏳ Waiting for ChatbotStack deletion..."
    aws cloudformation wait stack-delete-complete --stack-name "ChatbotStack" --region $AWS_REGION 2>/dev/null || {
        echo "⚠️  ChatbotStack deletion timeout or already completed"
    }
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