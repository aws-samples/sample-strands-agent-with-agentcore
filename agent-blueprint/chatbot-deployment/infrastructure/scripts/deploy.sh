#!/bin/bash

set -e

echo "Starting Chatbot deployment..."

# Load environment variables from .env file
ENV_FILE="../../.env"
if [ -f "$ENV_FILE" ]; then
    echo "Loading environment variables from $ENV_FILE"
    # Use set -a to automatically export all variables, then source the file
    set -a
    source "$ENV_FILE"
    set +a
    echo "✅ Environment variables loaded successfully"
    echo "📋 Key configuration:"
    echo "  - AWS_REGION: ${AWS_REGION:-us-west-2}"
    echo "  - ENABLE_COGNITO: ${ENABLE_COGNITO:-false}"
    echo "  - CORS_ORIGINS: ${CORS_ORIGINS:-not set}"
    echo "  - ALLOWED_IP_RANGES: ${ALLOWED_IP_RANGES:-not set}"
else
    echo "No .env file found at $ENV_FILE, using environment defaults"
fi

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
cd ../../../chatbot-app/backend
docker build --platform linux/amd64 -t chatbot-backend .
docker tag chatbot-backend:latest $ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/chatbot-backend:latest
docker push $ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/chatbot-backend:latest

# Build and push Frontend (only if Cognito is not enabled)
if [ "$ENABLE_COGNITO" != "true" ]; then
    echo "🔓 Building frontend container without Cognito..."
    cd ../frontend
    docker build --platform linux/amd64 \
        --build-arg NEXT_PUBLIC_AWS_REGION=$AWS_REGION \
        --build-arg CORS_ORIGINS="$CORS_ORIGINS" \
        -t chatbot-frontend .
    docker tag chatbot-frontend:latest $ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/chatbot-frontend:latest
    docker push $ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/chatbot-frontend:latest
fi

# Return to CDK directory (infrastructure directory)
cd "$CURRENT_DIR"

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

    # Save Cognito configuration to master .env file only
    echo "💾 Saving Cognito configuration to master .env file..."
    
    # Save to agent-blueprint/.env (single master .env file)
    MAIN_ENV_FILE="../../.env"
    if [ ! -f "$MAIN_ENV_FILE" ]; then
        touch "$MAIN_ENV_FILE"
    fi
    
    # Remove existing Cognito entries and add new ones
    grep -v "^COGNITO_USER_POOL_ID=" "$MAIN_ENV_FILE" > "$MAIN_ENV_FILE.tmp" 2>/dev/null || touch "$MAIN_ENV_FILE.tmp"
    grep -v "^COGNITO_USER_POOL_CLIENT_ID=" "$MAIN_ENV_FILE.tmp" > "$MAIN_ENV_FILE.tmp2" 2>/dev/null || touch "$MAIN_ENV_FILE.tmp2"
    grep -v "^NEXT_PUBLIC_COGNITO_USER_POOL_ID=" "$MAIN_ENV_FILE.tmp2" > "$MAIN_ENV_FILE.tmp3" 2>/dev/null || touch "$MAIN_ENV_FILE.tmp3"
    grep -v "^NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID=" "$MAIN_ENV_FILE.tmp3" > "$MAIN_ENV_FILE" 2>/dev/null || touch "$MAIN_ENV_FILE"
    
    # Add Cognito configuration to master .env file
    echo "COGNITO_USER_POOL_ID=$COGNITO_USER_POOL_ID" >> "$MAIN_ENV_FILE"
    echo "COGNITO_USER_POOL_CLIENT_ID=$COGNITO_USER_POOL_CLIENT_ID" >> "$MAIN_ENV_FILE"
    echo "NEXT_PUBLIC_COGNITO_USER_POOL_ID=$COGNITO_USER_POOL_ID" >> "$MAIN_ENV_FILE"
    echo "NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID=$COGNITO_USER_POOL_CLIENT_ID" >> "$MAIN_ENV_FILE"
    echo "NEXT_PUBLIC_AWS_REGION=$AWS_REGION" >> "$MAIN_ENV_FILE"
    
    # Clean up temp files
    rm -f "$MAIN_ENV_FILE.tmp" "$MAIN_ENV_FILE.tmp2" "$MAIN_ENV_FILE.tmp3"
    
    echo "✅ Cognito configuration saved to master .env file: $MAIN_ENV_FILE"
    echo "📋 All applications will use this single source of truth for environment variables"

    # Build frontend with Cognito configuration
    echo "Building frontend container with Cognito..."
    cd ../../../chatbot-app/frontend
    docker build --platform linux/amd64 \
        --build-arg NEXT_PUBLIC_AWS_REGION=$AWS_REGION \
        --build-arg NEXT_PUBLIC_COGNITO_USER_POOL_ID=$COGNITO_USER_POOL_ID \
        --build-arg NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID=$COGNITO_USER_POOL_CLIENT_ID \
        --build-arg CORS_ORIGINS="$CORS_ORIGINS" \
        -t chatbot-frontend .
    docker tag chatbot-frontend:latest $ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/chatbot-frontend:latest
    docker push $ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/chatbot-frontend:latest

    cd "$CURRENT_DIR"
fi

# CORS Origins Configuration (used for both API access and embedding)
echo ""
echo "🌐 CORS Origins Configuration"
echo "Configure which domains are allowed to:"
echo "  1. Make API calls to the backend (CORS)"
echo "  2. Embed the chatbot via iframe (CSP frame-ancestors)"
echo "This unified configuration simplifies security management."
echo ""
echo "Examples:"
echo "  - Single domain: https://example.com"
echo "  - Multiple domains: https://example.com,https://blog.example.com,https://partner-site.org"
echo "  - With ports: https://example.com:8080,https://localhost:3000"
echo "  - Leave empty for development mode (allows all origins)"
echo ""

# Check if CORS origins are already set via environment variable
if [ -z "$CORS_ORIGINS" ]; then
    read -p "Enter allowed CORS origins (comma-separated, include protocol) [leave empty for dev mode]: " cors_input
    
    if [ -z "$cors_input" ]; then
        export CORS_ORIGINS=""
        echo "Development mode - all origins allowed (not recommended for production)"
    else
        export CORS_ORIGINS="$cors_input"
        echo "CORS origins configured: $CORS_ORIGINS"
        echo "These domains will be allowed for both API access and iframe embedding"
    fi
else
    echo "Using configured CORS origins: $CORS_ORIGINS"
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
