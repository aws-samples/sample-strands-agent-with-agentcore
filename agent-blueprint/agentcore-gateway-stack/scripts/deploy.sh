#!/bin/bash
# ============================================================================
# AgentCore Gateway Stack Deployment Script
# Builds Lambda packages and deploys CDK stacks
# ============================================================================

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$SCRIPT_DIR/.."
INFRA_DIR="$PROJECT_ROOT/infrastructure"

# ============================================================================
# Parse Command Line Arguments
# ============================================================================

FORCE_REBUILD=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --force-rebuild)
      FORCE_REBUILD=true
      shift
      ;;
    --help)
      echo "Usage: $0 [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --force-rebuild    Force rebuild all Lambda packages even if source hasn't changed"
      echo "  --help             Show this help message"
      echo ""
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      echo "Run '$0 --help' for usage information"
      exit 1
      ;;
  esac
done

echo "🚀 Deploying AgentCore Gateway Stack..."
echo ""

if [ "$FORCE_REBUILD" = true ]; then
  echo "⚡ Force rebuild mode enabled"
  echo ""
fi

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
echo "   Force Rebuild: $FORCE_REBUILD"
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

# Check if Google Maps Credentials exist
GOOGLE_MAPS_SECRET_EXISTS=$(aws secretsmanager describe-secret \
    --secret-id "${PROJECT_NAME}/mcp/google-maps-credentials" \
    --query 'Name' \
    --output text \
    --region "$AWS_REGION" 2>/dev/null || echo "")

if [ -z "$GOOGLE_MAPS_SECRET_EXISTS" ]; then
    echo "⚠️  Google Maps Credentials not configured"
    echo ""
    echo "Google Maps Platform is required for 6 tools:"
    echo "  • search_places, search_nearby_places, get_place_details"
    echo "  • get_directions, geocode_address, reverse_geocode"
    echo ""
    echo "Setup instructions:"
    echo "  1. Go to: https://console.cloud.google.com/apis/credentials"
    echo "  2. Enable APIs: Places API, Directions API, Geocoding API"
    echo "  3. Create an API Key and restrict it to these 3 APIs"
    echo ""
    read -p "Enter Google Maps API Key (or press Enter to skip): " GOOGLE_MAPS_API_KEY

    if [ -n "$GOOGLE_MAPS_API_KEY" ]; then
        echo "   Setting Google Maps Credentials..."
        GOOGLE_MAPS_JSON="{\"api_key\":\"$GOOGLE_MAPS_API_KEY\"}"
        aws secretsmanager create-secret \
            --name "${PROJECT_NAME}/mcp/google-maps-credentials" \
            --secret-string "$GOOGLE_MAPS_JSON" \
            --description "Google Maps Platform API Key" \
            --region "$AWS_REGION" > /dev/null 2>&1 || \
        aws secretsmanager put-secret-value \
            --secret-id "${PROJECT_NAME}/mcp/google-maps-credentials" \
            --secret-string "$GOOGLE_MAPS_JSON" \
            --region "$AWS_REGION" > /dev/null 2>&1
        echo "   ✅ Google Maps Credentials configured"
    else
        echo "   ⚠️  Skipped - Google Maps tools will not work without API key"
    fi
else
    echo "   ✅ Google Maps Credentials already configured"
fi
echo ""

# ============================================================================
# Step 4.5: Force Rebuild (if requested)
# ============================================================================

if [ "$FORCE_REBUILD" = true ]; then
  echo "🔄 Step 4.5: Forcing Lambda rebuild..."
  echo ""

  # Get AWS account ID
  AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text 2>/dev/null || echo "")

  if [ -n "$AWS_ACCOUNT_ID" ]; then
    LAMBDA_BUCKET="${PROJECT_NAME}-gateway-lambdas-${AWS_ACCOUNT_ID}-${AWS_REGION}"

    # Check if bucket exists
    if aws s3 ls "s3://${LAMBDA_BUCKET}" > /dev/null 2>&1; then
      echo "   Clearing previous builds from S3..."

      # Delete all build artifacts to force rebuild
      aws s3 rm "s3://${LAMBDA_BUCKET}/builds/" --recursive --quiet || {
        echo "   ⚠️  Warning: Could not delete previous builds (bucket may not exist yet)"
      }

      echo "   ✅ Previous builds cleared - CodeBuild will rebuild all packages"
    else
      echo "   ℹ️  Lambda bucket doesn't exist yet (first deployment)"
    fi
  else
    echo "   ⚠️  Warning: Could not determine AWS account ID"
  fi

  echo ""
fi

# ============================================================================
# Step 5: Upload Lambda Sources to S3
# ============================================================================

echo "📤 Step 5: Uploading Lambda sources to S3..."
echo ""

# Get AWS account ID
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text 2>/dev/null || echo "")
LAMBDA_BUCKET="${PROJECT_NAME}-gateway-lambdas-${AWS_ACCOUNT_ID}-${AWS_REGION}"

# Check if bucket exists, create if not
if ! aws s3 ls "s3://${LAMBDA_BUCKET}" > /dev/null 2>&1; then
    echo "   Creating S3 bucket: ${LAMBDA_BUCKET}"
    aws s3 mb "s3://${LAMBDA_BUCKET}" --region "$AWS_REGION" 2>/dev/null || true
fi

# Upload all Lambda sources
LAMBDA_FUNCTIONS_DIR="$PROJECT_ROOT/lambda-functions"
for func in tavily wikipedia arxiv google-search google-maps finance weather; do
    if [ -d "$LAMBDA_FUNCTIONS_DIR/$func" ]; then
        echo "   Uploading $func..."
        aws s3 sync "$LAMBDA_FUNCTIONS_DIR/$func/" "s3://${LAMBDA_BUCKET}/source/$func/" \
            --exclude "__pycache__/*" \
            --exclude "*.pyc" \
            --exclude ".DS_Store" \
            --exclude "build/*" \
            --exclude "*.zip" \
            --delete \
            --quiet
    fi
done
echo "   ✅ All Lambda sources uploaded"
echo ""

# ============================================================================
# Step 6: Deploy to AWS (CodeBuild will build Lambda packages automatically)
# ============================================================================

echo "☁️  Step 6: Deploying to AWS..."
echo ""
echo "ℹ️  Lambda functions will be built automatically by CodeBuild during deployment"
echo "   This may take 5-10 minutes for the first deployment."
echo ""
npm run deploy
echo ""

# ============================================================================
# Step 7: Retrieve Gateway Information
# ============================================================================

echo "📡 Step 7: Retrieving Gateway information..."
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
# Step 8: Verify API Key Configuration
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

GOOGLE_MAPS_CONFIGURED=$(aws secretsmanager describe-secret \
    --secret-id "${PROJECT_NAME}/mcp/google-maps-credentials" \
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

if [ -n "$GOOGLE_MAPS_CONFIGURED" ]; then
    echo "✅ Google Maps Credentials: Configured"
    echo "   Tools: search_places, search_nearby_places, get_place_details,"
    echo "          get_directions, geocode_address, reverse_geocode"
else
    echo "⚠️  Google Maps Credentials: Not configured"
    echo "   Tools disabled: search_places, search_nearby_places, get_place_details,"
    echo "                   get_directions, geocode_address, reverse_geocode"
    echo ""
    echo "   To configure manually:"
    echo "   aws secretsmanager put-secret-value \\"
    echo "     --secret-id ${PROJECT_NAME}/mcp/google-maps-credentials \\"
    echo "     --secret-string '{\"api_key\":\"YOUR_GOOGLE_MAPS_API_KEY\"}' \\"
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
echo "💡 Troubleshooting:"
echo "   If Lambda functions show 'No module named' errors:"
echo "   - Run: ./scripts/deploy.sh --force-rebuild"
echo "   - This will rebuild all Lambda packages with fresh dependencies"
echo ""
