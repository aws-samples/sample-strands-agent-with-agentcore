#!/bin/bash

set -e

echo "Starting Chatbot deployment..."

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "Error: Docker is not running. Please start Docker and try again."
    exit 1
fi

# Check if AWS CLI is configured
if ! aws sts get-caller-identity > /dev/null 2>&1; then
    echo "Error: AWS CLI is not configured. Please run 'aws configure' first."
    exit 1
fi

# Set region - use environment variable or default
export AWS_REGION=${AWS_REGION:-us-west-2}
export AWS_DEFAULT_REGION=$AWS_REGION

echo "🌍 Deployment region: $AWS_REGION"

# Get account ID
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "Deploying to AWS Account: $ACCOUNT_ID in region: $AWS_REGION"

# Install dependencies
echo "Installing CDK dependencies..."
npm install

# Bootstrap CDK (if not already done)
echo "Bootstrapping CDK..."
npx cdk bootstrap aws://$ACCOUNT_ID/$AWS_REGION || echo "CDK already bootstrapped"

# Build and push Docker images
echo "Building and pushing Docker images..."

# Get ECR login token
aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com

# Create ECR repositories if they don't exist
aws ecr describe-repositories --repository-names chatbot-backend --region $AWS_REGION > /dev/null 2>&1 || \
aws ecr create-repository --repository-name chatbot-backend --region $AWS_REGION

aws ecr describe-repositories --repository-names chatbot-frontend --region $AWS_REGION > /dev/null 2>&1 || \
aws ecr create-repository --repository-name chatbot-frontend --region $AWS_REGION

# Store current directory for returning later
CURRENT_DIR=$(pwd)

# Build and push Backend
echo "Building backend container..."
cd ../../../../chatbot-app/backend
docker build --platform linux/amd64 -t chatbot-backend .
docker tag chatbot-backend:latest $ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/chatbot-backend:latest
docker push $ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/chatbot-backend:latest

# Build and push Frontend (only if Cognito is not enabled)
if [ "$ENABLE_COGNITO" != "true" ]; then
    echo "🔓 Building frontend container without Cognito..."
    cd ../frontend
    docker build --platform linux/amd64 \
        --build-arg NEXT_PUBLIC_AWS_REGION=$AWS_REGION \
        -t chatbot-frontend .
    docker tag chatbot-frontend:latest $ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/chatbot-frontend:latest
    docker push $ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/chatbot-frontend:latest
fi

# Return to CDK directory (parent of scripts directory)
cd "$CURRENT_DIR/.."

# Check if log group already exists and set environment variable accordingly
if aws logs describe-log-groups --log-group-name-prefix "agents/strands-agent-logs" --region $AWS_REGION --query 'logGroups[?logGroupName==`agents/strands-agent-logs`]' --output text | grep -q "agents/strands-agent-logs"; then
    echo "📋 Found existing log group: agents/strands-agent-logs"
    export IMPORT_EXISTING_LOG_GROUP=true
else
    echo "📋 Log group does not exist, will create new one"
    export IMPORT_EXISTING_LOG_GROUP=false
fi

# Deploy Cognito stack first if enabled
if [ "$ENABLE_COGNITO" = "true" ]; then
    echo "🔐 Deploying Cognito authentication stack first..."
    export ENABLE_COGNITO=true
    npx cdk deploy CognitoAuthStack --require-approval never

    echo "📋 Getting Cognito configuration from CloudFormation..."
    COGNITO_USER_POOL_ID=$(aws cloudformation describe-stacks --stack-name CognitoAuthStack --query 'Stacks[0].Outputs[?OutputKey==`UserPoolId`].OutputValue' --output text --region $AWS_REGION)
    COGNITO_USER_POOL_CLIENT_ID=$(aws cloudformation describe-stacks --stack-name CognitoAuthStack --query 'Stacks[0].Outputs[?OutputKey==`UserPoolClientId`].OutputValue' --output text --region $AWS_REGION)

    echo "🔍 Retrieved Cognito config:"
    echo "  User Pool ID: $COGNITO_USER_POOL_ID"
    echo "  Client ID: $COGNITO_USER_POOL_CLIENT_ID"

    # Validate Cognito values are not empty
    if [ -z "$COGNITO_USER_POOL_ID" ] || [ "$COGNITO_USER_POOL_ID" = "None" ]; then
        echo "❌ Error: Failed to retrieve Cognito User Pool ID from CloudFormation"
        exit 1
    fi

    if [ -z "$COGNITO_USER_POOL_CLIENT_ID" ] || [ "$COGNITO_USER_POOL_CLIENT_ID" = "None" ]; then
        echo "❌ Error: Failed to retrieve Cognito User Pool Client ID from CloudFormation"
        exit 1
    fi

    echo "✅ Cognito configuration validated successfully"

    # Build frontend with Cognito configuration
    echo "Building frontend container with Cognito..."
    cd ../../../chatbot-app/frontend
    docker build --platform linux/amd64 \
        --build-arg NEXT_PUBLIC_AWS_REGION=$AWS_REGION \
        --build-arg NEXT_PUBLIC_COGNITO_USER_POOL_ID=$COGNITO_USER_POOL_ID \
        --build-arg NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID=$COGNITO_USER_POOL_CLIENT_ID \
        -t chatbot-frontend .
    docker tag chatbot-frontend:latest $ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/chatbot-frontend:latest
    docker push $ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/chatbot-frontend:latest

    cd "$CURRENT_DIR/.."
fi

# Embedding Configuration
echo ""
echo "🌐 Embedding Configuration"
echo "Configure which domains are allowed to embed the chatbot via iframe."
echo "This helps prevent unauthorized usage while allowing legitimate integrations."
echo ""
echo "Examples:"
echo "  - Single domain: example.com"
echo "  - Multiple domains: example.com,subdomain.example.com,another-site.org"
echo "  - Leave empty to disable embedding"
echo ""

# Check if embed domains are already set via environment variable
if [ -z "$EMBED_ALLOWED_DOMAINS" ]; then
    read -p "Enter allowed embedding domains (comma-separated) [leave empty to disable]: " embed_input
    
    if [ -z "$embed_input" ]; then
        export EMBED_ALLOWED_DOMAINS=""
        echo "Embedding disabled - no domains configured"
    else
        export EMBED_ALLOWED_DOMAINS="$embed_input"
        echo "Embedding allowed for domains: $EMBED_ALLOWED_DOMAINS"
    fi
else
    echo "Using configured embedding domains: $EMBED_ALLOWED_DOMAINS"
fi

# Collect IP ranges for CIDR-based access control (if not using Cognito)
if [ "$ENABLE_COGNITO" != "true" ]; then
    echo ""
    echo "🔒 Security Configuration - IP Access Control"
    echo "When Cognito authentication is disabled, the application uses IP-based access control."
    echo "Please specify the IP ranges that should have access to the application."
    echo ""
    echo "Examples:"
    echo "  - Single IP: 203.0.113.45/32"
    echo "  - Office network: 203.0.113.0/24"
    echo "  - Home network: 192.168.1.0/24"
    echo "  - Multiple ranges: separate with commas"
    echo ""

    # Check if IP ranges are already set via environment variable
    if [ -z "$ALLOWED_IP_RANGES" ]; then
        read -p "Enter allowed IP ranges (CIDR notation, comma-separated) [0.0.0.0/0 for all IPs]: " ip_input

        # Use default if empty
        if [ -z "$ip_input" ]; then
            export ALLOWED_IP_RANGES="0.0.0.0/0"
            echo "⚠️  WARNING: Using 0.0.0.0/0 allows access from any IP address!"
        else
            export ALLOWED_IP_RANGES="$ip_input"
        fi
    fi

    echo "Using IP ranges: $ALLOWED_IP_RANGES"

    # MCP Server Access Configuration
    echo ""
    echo "🔒 MCP Server Access Configuration"
    echo "For local development access to MCP servers, please specify IP ranges."
    echo "This allows developers to directly test MCP servers while maintaining security."
    echo ""
    echo "Your current IP: $(curl -s ifconfig.me 2>/dev/null || echo 'Unable to detect')/32"
    echo ""
    echo "Examples:"
    echo "  - Your current IP: $(curl -s ifconfig.me 2>/dev/null || echo '203.0.113.45')/32"
    echo "  - Office network: 203.0.113.0/24"
    echo "  - Home + Office: $(curl -s ifconfig.me 2>/dev/null || echo '203.0.113.45')/32,192.168.1.0/24"
    echo ""

    # Check if MCP CIDR ranges are already set
    if [ -z "$ALLOWED_MCP_CIDRS" ]; then
        read -p "Enter MCP access IP ranges (CIDR notation, comma-separated) [your current IP]: " mcp_input

        # Use current IP if empty
        if [ -z "$mcp_input" ]; then
            current_ip=$(curl -s ifconfig.me 2>/dev/null || echo '0.0.0.0')
            export ALLOWED_MCP_CIDRS="${current_ip}/32"
            echo "Using your current IP: ${current_ip}/32"
        else
            export ALLOWED_MCP_CIDRS="$mcp_input"
        fi
    fi

    echo "Using MCP access ranges: $ALLOWED_MCP_CIDRS"
    echo ""
fi

# Deploy remaining CDK stack
echo "Deploying remaining CDK stack..."

# Check if Cognito should be enabled
if [ "$ENABLE_COGNITO" = "true" ]; then
    echo "🔐 Deploying ChatbotStack with Cognito authentication..."
    export ENABLE_COGNITO=true
    npx cdk deploy ChatbotStack --require-approval never
else
    echo "🔓 Deploying with CIDR-based access control only..."
    echo "Allowed IP ranges: $ALLOWED_IP_RANGES"
    export ENABLE_COGNITO=false
    npx cdk deploy ChatbotStack --require-approval never
fi

echo "Deployment completed successfully!"
echo ""
echo "🎉 Your containerized chatbot application is now running!"
echo ""
echo "📋 Access URLs:"
aws cloudformation describe-stacks --stack-name ChatbotStack --query "Stacks[0].Outputs" --output table --region $AWS_REGION

echo ""
echo "🔧 Useful commands:"
echo "  View logs: aws logs tail /aws/ecs/chatbot-backend --follow --region $AWS_REGION"
echo "  View logs: aws logs tail /aws/ecs/chatbot-frontend --follow --region $AWS_REGION"
echo "  Scale up:  aws ecs update-service --cluster chatbot-cluster --service ChatbotBackendService --desired-count 2 --region $AWS_REGION"
