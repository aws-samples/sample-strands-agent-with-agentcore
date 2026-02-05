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
    echo "  - ENABLE_COGNITO: ${ENABLE_COGNITO:-true}"
    echo "  - CORS_ORIGINS: ${CORS_ORIGINS:-not set}"
    echo "  - ALLOWED_IP_RANGES: ${ALLOWED_IP_RANGES:-not set}"
else
    echo "No .env file found at $ENV_FILE, using environment defaults"
fi

# Set ENABLE_COGNITO default to true if not explicitly set
export ENABLE_COGNITO=${ENABLE_COGNITO:-true}

# Note: Docker is NOT required for deployment
# Container images are built automatically by AWS CodeBuild during CDK deployment

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

# Check if DynamoDB tables already exist
echo "🔍 Checking for existing DynamoDB tables..."
USERS_TABLE_EXISTS=$(aws dynamodb describe-table --table-name strands-agent-chatbot-users --region $AWS_REGION 2>/dev/null && echo "true" || echo "false")
SESSIONS_TABLE_EXISTS=$(aws dynamodb describe-table --table-name strands-agent-chatbot-sessions --region $AWS_REGION 2>/dev/null && echo "true" || echo "false")

if [ "$USERS_TABLE_EXISTS" = "true" ] && [ "$SESSIONS_TABLE_EXISTS" = "true" ]; then
    echo "✅ Existing DynamoDB tables found - will import them"
    export USE_EXISTING_TABLES=true
elif [ "$USERS_TABLE_EXISTS" = "true" ] || [ "$SESSIONS_TABLE_EXISTS" = "true" ]; then
    echo "⚠️  Only some DynamoDB tables exist - deployment may fail"
    echo "   Users table: $USERS_TABLE_EXISTS"
    echo "   Sessions table: $SESSIONS_TABLE_EXISTS"
    export USE_EXISTING_TABLES=false
else
    echo "📝 No existing DynamoDB tables found - will create new ones"
    export USE_EXISTING_TABLES=false
fi

# Install dependencies
echo "Installing CDK dependencies..."
npm install

# Bootstrap CDK (if not already done)
echo "Bootstrapping CDK..."
npx cdk bootstrap aws://$ACCOUNT_ID/$AWS_REGION || echo "CDK already bootstrapped"

# Container images will be built by CodeBuild during CDK deployment
echo "📦 Container images will be built automatically by CodeBuild during CDK deployment..."

# Check if log group already exists and set environment variable accordingly
if aws logs describe-log-groups --log-group-name-prefix "agents/strands-agent-logs" --region $AWS_REGION --query 'logGroups[?logGroupName==`agents/strands-agent-logs`]' --output text | grep -q "agents/strands-agent-logs"; then
    echo "📋 Found existing log group: agents/strands-agent-logs"
    export IMPORT_EXISTING_LOG_GROUP=true
else
    echo "📋 Log group does not exist, will create new one"
    export IMPORT_EXISTING_LOG_GROUP=false
fi

# Check if ECR repository already exists and set environment variable accordingly
if aws ecr describe-repositories --repository-names chatbot-frontend --region $AWS_REGION > /dev/null 2>&1; then
    echo "📦 Found existing ECR repository: chatbot-frontend"
    export USE_EXISTING_ECR=true
else
    echo "📦 ECR repository does not exist, will create new one"
    export USE_EXISTING_ECR=false
fi

# Deploy Cognito stack first if enabled
if [ "$ENABLE_COGNITO" = "true" ]; then
    echo "🔐 Deploying Cognito authentication stack first..."
    export ENABLE_COGNITO=true

    # Ensure we're in the infrastructure directory
    SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
    INFRA_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"

    cd "$INFRA_DIR"

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

    # Create test user
    echo ""
    echo "👤 Creating test user..."
    TEST_USER_EMAIL="test@example.com"
    TEST_USER_PASSWORD="TestUser123!"

    # Check if test user already exists
    USER_EXISTS=$(aws cognito-idp list-users \
        --user-pool-id "$COGNITO_USER_POOL_ID" \
        --region "$AWS_REGION" \
        --filter "email=\"$TEST_USER_EMAIL\"" \
        --query 'Users[0].Username' \
        --output text 2>/dev/null || echo "")

    if [ -n "$USER_EXISTS" ] && [ "$USER_EXISTS" != "None" ]; then
        echo "✅ Test user already exists: $TEST_USER_EMAIL"
    else
        # Create test user
        aws cognito-idp admin-create-user \
            --user-pool-id "$COGNITO_USER_POOL_ID" \
            --username "$TEST_USER_EMAIL" \
            --user-attributes Name=email,Value="$TEST_USER_EMAIL" Name=email_verified,Value=true \
            --temporary-password "$TEST_USER_PASSWORD" \
            --message-action SUPPRESS \
            --region "$AWS_REGION" > /dev/null 2>&1

        # Set permanent password
        aws cognito-idp admin-set-user-password \
            --user-pool-id "$COGNITO_USER_POOL_ID" \
            --username "$TEST_USER_EMAIL" \
            --password "$TEST_USER_PASSWORD" \
            --permanent \
            --region "$AWS_REGION" > /dev/null 2>&1

        echo "✅ Test user created successfully!"
        echo ""
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo "🔑 Test User Credentials"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo "Email:    $TEST_USER_EMAIL"
        echo "Password: $TEST_USER_PASSWORD"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    fi
    echo ""

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
    echo "📦 Container will be built automatically by CodeBuild with Cognito configuration during CDK deployment..."
fi

# CORS Origins Configuration (used for both API access and embedding)
# Default to empty (development mode - allows all origins)
export CORS_ORIGINS=${CORS_ORIGINS:-""}

if [ -z "$CORS_ORIGINS" ]; then
    echo "🌐 CORS: Development mode (all origins allowed)"
else
    echo "🌐 CORS Origins: $CORS_ORIGINS"
fi

# Detect configured API keys from Secrets Manager
echo ""
echo "🔑 Detecting configured API keys from Secrets Manager..."
DEFAULT_KEYS=""

# Check Tavily
if aws secretsmanager get-secret-value --secret-id "strands-agent-chatbot/mcp/tavily-api-key" --region "$AWS_REGION" &>/dev/null; then
    DEFAULT_KEYS="tavily_api_key"
    echo "  ✓ Tavily API key found"
fi

# Check Google Search
if aws secretsmanager get-secret-value --secret-id "strands-agent-chatbot/mcp/google-credentials" --region "$AWS_REGION" &>/dev/null; then
    [ -n "$DEFAULT_KEYS" ] && DEFAULT_KEYS="$DEFAULT_KEYS,"
    DEFAULT_KEYS="${DEFAULT_KEYS}google_api_key,google_search_engine_id"
    echo "  ✓ Google Search credentials found"
fi

# Check Google Maps
if aws secretsmanager get-secret-value --secret-id "strands-agent-chatbot/mcp/google-maps-credentials" --region "$AWS_REGION" &>/dev/null; then
    [ -n "$DEFAULT_KEYS" ] && DEFAULT_KEYS="$DEFAULT_KEYS,"
    DEFAULT_KEYS="${DEFAULT_KEYS}google_maps_api_key"
    echo "  ✓ Google Maps credentials found"
fi

# Check Nova Act
if aws secretsmanager get-secret-value --secret-id "strands-agent-chatbot/nova-act-api-key" --region "$AWS_REGION" &>/dev/null; then
    [ -n "$DEFAULT_KEYS" ] && DEFAULT_KEYS="$DEFAULT_KEYS,"
    DEFAULT_KEYS="${DEFAULT_KEYS}nova_act_api_key"
    echo "  ✓ Nova Act API key found"
fi

if [ -n "$DEFAULT_KEYS" ]; then
    export NEXT_PUBLIC_DEFAULT_KEYS="$DEFAULT_KEYS"
    echo "✅ Default API keys: $DEFAULT_KEYS"

    # Save to master .env file
    MAIN_ENV_FILE="../../.env"
    grep -v "^NEXT_PUBLIC_DEFAULT_KEYS=" "$MAIN_ENV_FILE" > "$MAIN_ENV_FILE.tmp" 2>/dev/null || touch "$MAIN_ENV_FILE.tmp"
    mv "$MAIN_ENV_FILE.tmp" "$MAIN_ENV_FILE"
    echo "NEXT_PUBLIC_DEFAULT_KEYS=$DEFAULT_KEYS" >> "$MAIN_ENV_FILE"
else
    echo "⚠️  No default API keys found in Secrets Manager"
fi
echo ""

# Collect IP ranges for CIDR-based access control (if not using Cognito)
if [ "$ENABLE_COGNITO" != "true" ]; then
    # Set default IP ranges if not configured
    export ALLOWED_IP_RANGES=${ALLOWED_IP_RANGES:-"0.0.0.0/0"}

    # Get current IP for MCP access
    current_ip=$(curl -s ifconfig.me 2>/dev/null || echo '0.0.0.0')
    export ALLOWED_MCP_CIDRS=${ALLOWED_MCP_CIDRS:-"${current_ip}/32"}

    echo "🔒 IP Access Control:"
    echo "  - Application IP ranges: $ALLOWED_IP_RANGES"
    echo "  - MCP access ranges: $ALLOWED_MCP_CIDRS"
    echo ""
fi

# Deploy remaining CDK stack
echo "Deploying remaining CDK stack..."

# Check if Cognito should be enabled
if [ "$ENABLE_COGNITO" = "true" ]; then
    echo "🔐 Deploying ChatbotStack with Cognito authentication..."
    export ENABLE_COGNITO=true

    # Ensure we're in the infrastructure directory
    SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
    INFRA_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"
    cd "$INFRA_DIR"

    npx cdk deploy ChatbotStack --require-approval never

else
    echo "🔓 Deploying with CIDR-based access control only..."
    echo "Allowed IP ranges: $ALLOWED_IP_RANGES"
    export ENABLE_COGNITO=false

    # Ensure we're in the infrastructure directory
    SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
    INFRA_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"
    cd "$INFRA_DIR"

    npx cdk deploy ChatbotStack --require-approval never
fi

echo "Deployment completed successfully!"
echo ""
echo "🎉 Your containerized chatbot application is now running!"
echo ""

# Extract and save Streaming ALB URL for frontend
echo "📦 Extracting ALB URL for streaming endpoints..."
STREAMING_ALB_URL=$(aws cloudformation describe-stacks --stack-name ChatbotStack --query 'Stacks[0].Outputs[?OutputKey==`StreamingAlbUrl`].OutputValue' --output text --region $AWS_REGION 2>/dev/null || echo "")

if [ -n "$STREAMING_ALB_URL" ] && [ "$STREAMING_ALB_URL" != "None" ]; then
    echo "✅ Streaming ALB URL: $STREAMING_ALB_URL"

    # Save to master .env file
    MAIN_ENV_FILE="../../.env"
    if [ ! -f "$MAIN_ENV_FILE" ]; then
        touch "$MAIN_ENV_FILE"
    fi

    # Remove existing entry and add new one
    grep -v "^NEXT_PUBLIC_STREAMING_API_URL=" "$MAIN_ENV_FILE" > "$MAIN_ENV_FILE.tmp" 2>/dev/null || touch "$MAIN_ENV_FILE.tmp"
    mv "$MAIN_ENV_FILE.tmp" "$MAIN_ENV_FILE"
    echo "NEXT_PUBLIC_STREAMING_API_URL=$STREAMING_ALB_URL" >> "$MAIN_ENV_FILE"

    echo "💾 Streaming ALB URL saved to .env"
    echo "⚠️  Note: Frontend container needs rebuild to use new streaming URL"
    echo "   Run: cd ../.. && ./scripts/rebuild-frontend.sh"
else
    echo "⚠️  Could not retrieve Streaming ALB URL from stack outputs"
fi

echo ""
echo "📋 Access URLs:"
aws cloudformation describe-stacks --stack-name ChatbotStack --query "Stacks[0].Outputs" --output table --region $AWS_REGION

echo ""
echo "🔧 Useful commands:"
echo "  View Frontend+BFF logs: aws logs tail /ecs/chatbot-frontend --follow --region $AWS_REGION"
echo "  Scale up Frontend:      aws ecs update-service --cluster chatbot-cluster --service ChatbotFrontendService --desired-count 2 --region $AWS_REGION"
echo ""
echo "📊 AgentCore Runtime:"
echo "  View Runtime logs:      aws logs tail /aws/bedrock-agentcore/runtimes/strands_agent_chatbot_runtime --follow --region $AWS_REGION"
echo "  Check Runtime status:   aws bedrock-agentcore list-agent-runtimes --region $AWS_REGION"
