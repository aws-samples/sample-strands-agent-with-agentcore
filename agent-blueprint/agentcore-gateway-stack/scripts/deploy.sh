#!/bin/bash
# ============================================================================
# AgentCore Gateway Stack Deployment Script
# Builds Lambda packages and deploys CDK stacks
# ============================================================================

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$SCRIPT_DIR/.."
INFRA_DIR="$PROJECT_ROOT/infrastructure"

echo "🚀 Deploying AgentCore Gateway Stack..."
echo ""

# ============================================================================
# Environment Variables
# ============================================================================

export PROJECT_NAME="${PROJECT_NAME:-strands-agent-chatbot}"
export ENVIRONMENT="${ENVIRONMENT:-dev}"
export AWS_REGION="${AWS_REGION:-us-west-2}"

echo "📋 Configuration:"
echo "   Project: $PROJECT_NAME"
echo "   Environment: $ENVIRONMENT"
echo "   Region: $AWS_REGION"
echo ""

# ============================================================================
# Step 1: Install CDK Dependencies
# ============================================================================

echo "📦 Step 1: Installing CDK dependencies..."
cd "$INFRA_DIR"

if [ ! -d "node_modules" ]; then
    echo "   Installing npm packages..."
    npm install
else
    echo "   ✅ Dependencies already installed"
fi
echo ""

# ============================================================================
# Step 2: Build TypeScript
# ============================================================================

echo "🔧 Step 2: Building TypeScript..."
npm run build
echo ""

# ============================================================================
# Step 3: Synthesize CDK Stacks
# ============================================================================

echo "🏗️  Step 3: Synthesizing CDK stacks..."
npm run synth
echo ""

# ============================================================================
# Step 4: Check and Configure API Keys
# ============================================================================

echo "🔑 Step 4: Checking API key configuration..."
echo ""

# Check if Tavily API key exists
TAVILY_SECRET_EXISTS=$(aws secretsmanager describe-secret \
    --secret-id "${PROJECT_NAME}/mcp/tavily-api-key" \
    --query 'Name' \
    --output text \
    --region "$AWS_REGION" 2>/dev/null || echo "")

if [ -z "$TAVILY_SECRET_EXISTS" ]; then
    echo "⚠️  Tavily API Key not configured"
    echo ""
    echo "Tavily is required for tavily_search and tavily_extract tools."
    echo "Get your API key from: https://tavily.com/"
    echo ""
    read -p "Enter Tavily API Key (or press Enter to skip): " TAVILY_API_KEY

    if [ -n "$TAVILY_API_KEY" ]; then
        echo "   Setting Tavily API Key..."
        aws secretsmanager create-secret \
            --name "${PROJECT_NAME}/mcp/tavily-api-key" \
            --secret-string "$TAVILY_API_KEY" \
            --description "Tavily API Key for web search" \
            --region "$AWS_REGION" > /dev/null 2>&1 || \
        aws secretsmanager put-secret-value \
            --secret-id "${PROJECT_NAME}/mcp/tavily-api-key" \
            --secret-string "$TAVILY_API_KEY" \
            --region "$AWS_REGION" > /dev/null 2>&1
        echo "   ✅ Tavily API Key configured"
    else
        echo "   ⚠️  Skipped - Tavily tools will not work without API key"
    fi
else
    echo "   ✅ Tavily API Key already configured"
fi
echo ""

# Check if Google Credentials exist
GOOGLE_SECRET_EXISTS=$(aws secretsmanager describe-secret \
    --secret-id "${PROJECT_NAME}/mcp/google-credentials" \
    --query 'Name' \
    --output text \
    --region "$AWS_REGION" 2>/dev/null || echo "")

if [ -z "$GOOGLE_SECRET_EXISTS" ]; then
    echo "⚠️  Google Credentials not configured"
    echo ""
    echo "Google Custom Search is required for google_web_search and google_image_search."
    echo "Setup instructions:"
    echo "  1. API Key: https://console.cloud.google.com/apis/credentials"
    echo "  2. Search Engine: https://programmablesearchengine.google.com/"
    echo ""
    read -p "Enter Google API Key (or press Enter to skip): " GOOGLE_API_KEY

    if [ -n "$GOOGLE_API_KEY" ]; then
        read -p "Enter Google Search Engine ID: " GOOGLE_ENGINE_ID

        if [ -n "$GOOGLE_ENGINE_ID" ]; then
            echo "   Setting Google Credentials..."
            GOOGLE_JSON="{\"api_key\":\"$GOOGLE_API_KEY\",\"search_engine_id\":\"$GOOGLE_ENGINE_ID\"}"
            aws secretsmanager create-secret \
                --name "${PROJECT_NAME}/mcp/google-credentials" \
                --secret-string "$GOOGLE_JSON" \
                --description "Google Custom Search API credentials" \
                --region "$AWS_REGION" > /dev/null 2>&1 || \
            aws secretsmanager put-secret-value \
                --secret-id "${PROJECT_NAME}/mcp/google-credentials" \
                --secret-string "$GOOGLE_JSON" \
                --region "$AWS_REGION" > /dev/null 2>&1
            echo "   ✅ Google Credentials configured"
        else
            echo "   ⚠️  Search Engine ID required - Google tools will not work"
        fi
    else
        echo "   ⚠️  Skipped - Google search tools will not work without credentials"
    fi
else
    echo "   ✅ Google Credentials already configured"
fi
echo ""

# ============================================================================
# Step 5: Deploy to AWS (CodeBuild will build Lambda packages automatically)
# ============================================================================

echo "☁️  Step 5: Deploying to AWS..."
echo ""
echo "ℹ️  Lambda functions will be built automatically by CodeBuild during deployment"
echo "   This may take 5-10 minutes for the first deployment."
echo ""
npm run deploy
echo ""

# ============================================================================
# Step 6: Retrieve Gateway Information
# ============================================================================

echo "📡 Step 6: Retrieving Gateway information..."
echo ""

# Get Gateway URL from Parameter Store
GATEWAY_URL=$(aws ssm get-parameter \
    --name "/${PROJECT_NAME}/${ENVIRONMENT}/mcp/gateway-url" \
    --query 'Parameter.Value' \
    --output text \
    --region "$AWS_REGION" 2>/dev/null || echo "Not yet available")

GATEWAY_ID=$(aws ssm get-parameter \
    --name "/${PROJECT_NAME}/${ENVIRONMENT}/mcp/gateway-id" \
    --query 'Parameter.Value' \
    --output text \
    --region "$AWS_REGION" 2>/dev/null || echo "Not yet available")

echo "✅ Deployment complete!"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🎯 AgentCore Gateway Information"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Gateway URL:  $GATEWAY_URL"
echo "Gateway ID:   $GATEWAY_ID"
echo "Region:       $AWS_REGION"
echo ""

# ============================================================================
# Step 7: Verify API Key Configuration
# ============================================================================

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔑 API Key Status"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Re-check API keys after deployment
TAVILY_CONFIGURED=$(aws secretsmanager describe-secret \
    --secret-id "${PROJECT_NAME}/mcp/tavily-api-key" \
    --query 'Name' \
    --output text \
    --region "$AWS_REGION" 2>/dev/null || echo "")

GOOGLE_CONFIGURED=$(aws secretsmanager describe-secret \
    --secret-id "${PROJECT_NAME}/mcp/google-credentials" \
    --query 'Name' \
    --output text \
    --region "$AWS_REGION" 2>/dev/null || echo "")

if [ -n "$TAVILY_CONFIGURED" ]; then
    echo "✅ Tavily API Key: Configured"
    echo "   Tools: tavily_search, tavily_extract"
else
    echo "⚠️  Tavily API Key: Not configured"
    echo "   Tools disabled: tavily_search, tavily_extract"
    echo ""
    echo "   To configure manually:"
    echo "   aws secretsmanager put-secret-value \\"
    echo "     --secret-id ${PROJECT_NAME}/mcp/tavily-api-key \\"
    echo "     --secret-string 'YOUR_TAVILY_API_KEY' \\"
    echo "     --region $AWS_REGION"
fi
echo ""

if [ -n "$GOOGLE_CONFIGURED" ]; then
    echo "✅ Google Credentials: Configured"
    echo "   Tools: google_web_search, google_image_search"
else
    echo "⚠️  Google Credentials: Not configured"
    echo "   Tools disabled: google_web_search, google_image_search"
    echo ""
    echo "   To configure manually:"
    echo "   aws secretsmanager put-secret-value \\"
    echo "     --secret-id ${PROJECT_NAME}/mcp/google-credentials \\"
    echo "     --secret-string '{\"api_key\":\"YOUR_API_KEY\",\"search_engine_id\":\"YOUR_ENGINE_ID\"}' \\"
    echo "     --region $AWS_REGION"
fi
echo ""

# API-key-free tools
echo "✅ Wikipedia Tools: Always available"
echo "   Tools: wikipedia_search, wikipedia_get_article"
echo ""
echo "✅ ArXiv Tools: Always available"
echo "   Tools: arxiv_search, arxiv_get_paper"
echo ""
echo "✅ Finance Tools: Always available"
echo "   Tools: stock_quote, stock_history, financial_news, stock_analysis"
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📝 Next Steps"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "1. Test Gateway: bash scripts/test-gateway.sh"
echo "2. Update AgentCore Runtime to use Gateway URL"
echo "3. Configure missing API keys if needed (see above)"
echo ""
