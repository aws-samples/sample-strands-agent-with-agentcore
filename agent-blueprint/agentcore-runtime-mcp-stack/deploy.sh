#!/bin/bash
set -e

# MCP 3LO Server Runtime - Deployment Script
# Deploys MCP 3LO Server as AgentCore Runtime + registers OAuth credential provider

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}✓${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}⚠${NC} $1"
}

log_error() {
    echo -e "${RED}✗${NC} $1"
}

log_step() {
    echo -e "${BLUE}▶${NC} $1"
}

echo "========================================"
echo "  MCP 3LO Server Runtime Deployment"
echo "========================================"
echo ""

# ── 1. AWS Credentials Validation ─────────────────────────────
log_step "Checking AWS CLI..."
if ! command -v aws &> /dev/null; then
    log_error "AWS CLI is not installed"
    exit 1
fi

if ! aws sts get-caller-identity &> /dev/null; then
    log_error "AWS CLI is not configured. Please run: aws configure"
    exit 1
fi

log_info "AWS CLI is configured"

# Set up Python with boto3 for credential provider management
if python3 -c "import boto3" 2>/dev/null; then
    PYTHON_CMD="python3"
else
    log_step "Setting up Python environment for credential provider management..."
    BOTO3_VENV="/tmp/mcp-deploy-venv"
    if [ ! -f "$BOTO3_VENV/bin/python3" ] || ! "$BOTO3_VENV/bin/python3" -c "import boto3" 2>/dev/null; then
        rm -rf "$BOTO3_VENV"
        python3 -m venv "$BOTO3_VENV"
        "$BOTO3_VENV/bin/pip" install --quiet boto3
    fi
    PYTHON_CMD="$BOTO3_VENV/bin/python3"
    log_info "Python environment ready"
fi
echo ""

AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
AWS_REGION=${AWS_REGION:-$(aws configure get region)}
AWS_REGION=${AWS_REGION:-us-west-2}

export PROJECT_NAME=${PROJECT_NAME:-strands-agent-chatbot}
export ENVIRONMENT=${ENVIRONMENT:-dev}
export AWS_REGION
export AWS_ACCOUNT_ID
export CDK_DEFAULT_ACCOUNT=$AWS_ACCOUNT_ID
export CDK_DEFAULT_REGION=$AWS_REGION

log_info "AWS Account: $AWS_ACCOUNT_ID"
log_info "AWS Region: $AWS_REGION"
log_info "Project Name: $PROJECT_NAME"
log_info "Environment: $ENVIRONMENT"

# ── Cognito configuration for JWT inbound auth ────────────────
# Try to get Cognito values from CloudFormation exports if not set
if [ -z "$COGNITO_USER_POOL_ID" ]; then
    COGNITO_USER_POOL_ID=$(aws cloudformation list-exports --region $AWS_REGION \
        --query "Exports[?Name=='CognitoAuthStack-UserPoolId'].Value" \
        --output text 2>/dev/null || echo "")
fi

if [ -z "$COGNITO_CLIENT_ID" ]; then
    COGNITO_CLIENT_ID=$(aws cloudformation list-exports --region $AWS_REGION \
        --query "Exports[?Name=='CognitoAuthStack-UserPoolClientId'].Value" \
        --output text 2>/dev/null || echo "")
fi

if [ -n "$COGNITO_USER_POOL_ID" ] && [ -n "$COGNITO_CLIENT_ID" ]; then
    export COGNITO_USER_POOL_ID
    export COGNITO_CLIENT_ID
    log_info "Cognito User Pool: $COGNITO_USER_POOL_ID"
    log_info "Cognito Client ID: $COGNITO_CLIENT_ID"
else
    log_warn "Cognito not configured - MCP Runtime will not have JWT inbound auth"
    log_warn "3LO OAuth (user federation) requires Cognito. Deploy CognitoAuthStack first."
fi
echo ""

# ── Frontend URL for OAuth callback ────────────────────────────
# Try to get frontend URL from CloudFormation exports or environment
if [ -z "$FRONTEND_URL" ]; then
    FRONTEND_URL=$(aws cloudformation list-exports --region $AWS_REGION \
        --query "Exports[?Name=='ChatbotDeploymentStack-DistributionUrl'].Value" \
        --output text 2>/dev/null || echo "")
fi

if [ -n "$FRONTEND_URL" ]; then
    # Ensure URL has https:// prefix and /oauth-complete path
    if [[ ! "$FRONTEND_URL" =~ ^https?:// ]]; then
        FRONTEND_URL="https://${FRONTEND_URL}"
    fi
    OAUTH_CALLBACK_URL="${FRONTEND_URL}/oauth-complete"

    log_step "Storing frontend URL for OAuth callback..."
    aws ssm put-parameter \
        --name "/${PROJECT_NAME}/${ENVIRONMENT}/frontend-url" \
        --value "$OAUTH_CALLBACK_URL" \
        --type String \
        --overwrite \
        --region "$AWS_REGION" > /dev/null 2>&1
    log_info "Frontend URL: $OAUTH_CALLBACK_URL"
else
    log_warn "Frontend URL not found. Set FRONTEND_URL env var or deploy ChatbotDeploymentStack first."
    log_warn "3LO OAuth callback will not work without frontend URL."
fi
echo ""

# ── 2. CDK Build & Deploy ─────────────────────────────────────
cd cdk

log_step "Installing CDK dependencies..."
if [ ! -d "node_modules" ]; then
    npm install
else
    log_info "Dependencies already installed"
fi
echo ""

log_step "Cleaning previous CDK build artifacts..."
rm -rf cdk.out
log_info "Clean complete"
echo ""

log_step "Building CDK stack..."
npm run build
log_info "Build complete"
echo ""

# Check ECR repository
log_step "Checking ECR repository..."
if aws ecr describe-repositories --repository-names ${PROJECT_NAME}-mcp-3lo-server --region $AWS_REGION &> /dev/null; then
    log_info "ECR repository already exists, importing..."
    export USE_EXISTING_ECR=true
else
    log_info "Creating new ECR repository..."
    export USE_EXISTING_ECR=false
fi
echo ""

# Bootstrap CDK
log_step "Checking CDK bootstrap..."
if ! aws cloudformation describe-stacks --stack-name CDKToolkit --region $AWS_REGION &> /dev/null; then
    log_warn "CDK not bootstrapped in this region"
    log_step "Bootstrapping CDK..."
    npx cdk bootstrap aws://$AWS_ACCOUNT_ID/$AWS_REGION
    log_info "CDK bootstrap complete"
else
    log_info "CDK already bootstrapped"
fi
echo ""

# Deploy
log_step "Deploying MCP 3LO Server Runtime Stack..."
echo ""
npx cdk deploy --require-approval never

cd ..

# ── 3. OAuth Credential Provider Registration ─────────────────
echo ""
log_step "Checking OAuth credential providers..."
echo ""

# Check if Google OAuth provider already exists
PROVIDER_EXISTS=$($PYTHON_CMD -c "
import boto3
try:
    client = boto3.client('bedrock-agentcore-control', region_name='${AWS_REGION}')
    client.get_oauth2_credential_provider(name='google-oauth-provider')
    print('exists')
except Exception:
    print('not_found')
" 2>/dev/null || echo "not_found")

if [ "$PROVIDER_EXISTS" = "exists" ]; then
    log_info "Google OAuth provider already registered"

    # Get callback URL from existing provider and store in SSM if not already stored
    EXISTING_CALLBACK_URL=$($PYTHON_CMD -c "
import boto3
client = boto3.client('bedrock-agentcore-control', region_name='${AWS_REGION}')
response = client.get_oauth2_credential_provider(name='google-oauth-provider')
print(response.get('callbackUrl', ''))
" 2>/dev/null || echo "")

    if [ -n "$EXISTING_CALLBACK_URL" ]; then
        log_step "Storing OAuth callback URL in Parameter Store..."
        aws ssm put-parameter \
            --name "/${PROJECT_NAME}/${ENVIRONMENT}/mcp/oauth2-callback-url" \
            --value "$EXISTING_CALLBACK_URL" \
            --type String \
            --overwrite \
            --region "$AWS_REGION" > /dev/null 2>&1
        log_info "Callback URL stored: $EXISTING_CALLBACK_URL"
    fi
else
    # Provider not registered yet - ask for credentials if not provided via env vars
    if [ -z "$GOOGLE_CLIENT_ID" ] || [ -z "$GOOGLE_CLIENT_SECRET" ]; then
        log_warn "Google OAuth provider not yet registered"
        echo ""
        echo "To register, provide Google OAuth credentials."
        echo "  (Create at https://console.cloud.google.com/apis/credentials)"
        echo ""
        read -p "Enter Google OAuth Client ID (or press Enter to skip): " GOOGLE_CLIENT_ID < /dev/tty
        if [ -n "$GOOGLE_CLIENT_ID" ]; then
            read -s -p "Enter Google OAuth Client Secret: " GOOGLE_CLIENT_SECRET < /dev/tty
            echo ""
        fi
    fi

    if [ -n "$GOOGLE_CLIENT_ID" ] && [ -n "$GOOGLE_CLIENT_SECRET" ]; then
        log_step "Registering Google OAuth credential provider..."

        CALLBACK_URL=$($PYTHON_CMD -c "
import boto3

client = boto3.client('bedrock-agentcore-control', region_name='${AWS_REGION}')
response = client.create_oauth2_credential_provider(
    name='google-oauth-provider',
    credentialProviderVendor='GoogleOauth2',
    oauth2ProviderConfigInput={
        'googleOauth2ProviderConfig': {
            'clientId': '${GOOGLE_CLIENT_ID}',
            'clientSecret': '${GOOGLE_CLIENT_SECRET}'
        }
    }
)

arn = response.get('credentialProviderArn', 'N/A')
callback_url = response.get('callbackUrl', 'N/A')
print(callback_url)
" 2>/dev/null || echo "")

        if [ -n "$CALLBACK_URL" ] && [ "$CALLBACK_URL" != "N/A" ]; then
            log_info "Provider registered with callback URL: $CALLBACK_URL"

            # Store callback URL in SSM Parameter Store
            log_step "Storing OAuth callback URL in Parameter Store..."
            aws ssm put-parameter \
                --name "/${PROJECT_NAME}/${ENVIRONMENT}/mcp/oauth2-callback-url" \
                --value "$CALLBACK_URL" \
                --type String \
                --overwrite \
                --region "$AWS_REGION" > /dev/null 2>&1
            log_info "Callback URL stored in Parameter Store"

            echo ""
            echo "IMPORTANT: Add the Callback URL as an Authorized redirect URI in Google Cloud Console:"
            echo "  $CALLBACK_URL"
        fi

        if [ $? -eq 0 ]; then
            log_info "Google OAuth provider registered"
        else
            log_error "Failed to register Google OAuth provider"
        fi
    else
        log_warn "Skipped - Google OAuth provider not registered"
        log_warn "To register later, re-run with credentials"
    fi
fi
echo ""

# Check if Notion OAuth provider already exists
NOTION_PROVIDER_EXISTS=$($PYTHON_CMD -c "
import boto3
try:
    client = boto3.client('bedrock-agentcore-control', region_name='${AWS_REGION}')
    client.get_oauth2_credential_provider(name='notion-oauth-provider')
    print('exists')
except Exception:
    print('not_found')
" 2>/dev/null || echo "not_found")

if [ "$NOTION_PROVIDER_EXISTS" = "exists" ]; then
    log_info "Notion OAuth provider already registered"

    # Get callback URL from existing provider
    NOTION_CALLBACK_URL=$($PYTHON_CMD -c "
import boto3
client = boto3.client('bedrock-agentcore-control', region_name='${AWS_REGION}')
response = client.get_oauth2_credential_provider(name='notion-oauth-provider')
print(response.get('callbackUrl', ''))
" 2>/dev/null || echo "")

    if [ -n "$NOTION_CALLBACK_URL" ]; then
        log_info "Notion callback URL: $NOTION_CALLBACK_URL"
    fi
else
    # Provider not registered yet - ask for credentials if not provided via env vars
    if [ -z "$NOTION_CLIENT_ID" ] || [ -z "$NOTION_CLIENT_SECRET" ]; then
        log_warn "Notion OAuth provider not yet registered"
        echo ""
        echo "To register, provide Notion OAuth credentials."
        echo "  (Create Public Integration at https://www.notion.so/my-integrations)"
        echo ""
        read -p "Enter Notion OAuth Client ID (or press Enter to skip): " NOTION_CLIENT_ID < /dev/tty
        if [ -n "$NOTION_CLIENT_ID" ]; then
            read -s -p "Enter Notion OAuth Client Secret: " NOTION_CLIENT_SECRET < /dev/tty
            echo ""
        fi
    fi

    if [ -n "$NOTION_CLIENT_ID" ] && [ -n "$NOTION_CLIENT_SECRET" ]; then
        log_step "Registering Notion OAuth credential provider..."

        NOTION_CALLBACK_URL=$($PYTHON_CMD -c "
import boto3

client = boto3.client('bedrock-agentcore-control', region_name='${AWS_REGION}')
response = client.create_oauth2_credential_provider(
    name='notion-oauth-provider',
    credentialProviderVendor='CustomOauth2',
    oauth2ProviderConfigInput={
        'customOauth2ProviderConfig': {
            'clientId': '${NOTION_CLIENT_ID}',
            'clientSecret': '${NOTION_CLIENT_SECRET}',
            'oauthDiscovery': {
                'authorizationServerMetadata': {
                    'issuer': 'https://api.notion.com',
                    'authorizationEndpoint': 'https://api.notion.com/v1/oauth/authorize',
                    'tokenEndpoint': 'https://api.notion.com/v1/oauth/token',
                }
            }
        }
    }
)

callback_url = response.get('callbackUrl', 'N/A')
print(callback_url)
" 2>/dev/null || echo "")

        if [ -n "$NOTION_CALLBACK_URL" ] && [ "$NOTION_CALLBACK_URL" != "N/A" ]; then
            log_info "Provider registered with callback URL: $NOTION_CALLBACK_URL"
            echo ""
            echo "IMPORTANT: Add this Callback URL to your Notion Integration's Redirect URIs:"
            echo "  $NOTION_CALLBACK_URL"
        fi

        if [ $? -eq 0 ]; then
            log_info "Notion OAuth provider registered"
        else
            log_error "Failed to register Notion OAuth provider"
        fi
    else
        log_warn "Skipped - Notion OAuth provider not registered"
        log_warn "To register later, re-run with NOTION_CLIENT_ID and NOTION_CLIENT_SECRET"
    fi
fi
echo ""

# Check if GitHub OAuth provider already exists
GITHUB_PROVIDER_EXISTS=$($PYTHON_CMD -c "
import boto3
try:
    client = boto3.client('bedrock-agentcore-control', region_name='${AWS_REGION}')
    client.get_oauth2_credential_provider(name='github-oauth-provider')
    print('exists')
except Exception:
    print('not_found')
" 2>/dev/null || echo "not_found")

if [ "$GITHUB_PROVIDER_EXISTS" = "exists" ]; then
    log_info "GitHub OAuth provider already registered"

    # Get callback URL from existing provider
    GITHUB_CALLBACK_URL=$($PYTHON_CMD -c "
import boto3
client = boto3.client('bedrock-agentcore-control', region_name='${AWS_REGION}')
response = client.get_oauth2_credential_provider(name='github-oauth-provider')
print(response.get('callbackUrl', ''))
" 2>/dev/null || echo "")

    if [ -n "$GITHUB_CALLBACK_URL" ]; then
        log_info "GitHub callback URL: $GITHUB_CALLBACK_URL"
    fi
else
    # Provider not registered yet - ask for credentials if not provided via env vars
    if [ -z "$GITHUB_CLIENT_ID" ] || [ -z "$GITHUB_CLIENT_SECRET" ]; then
        log_warn "GitHub OAuth provider not yet registered"
        echo ""
        echo "To register, provide GitHub OAuth credentials."
        echo "  (Create OAuth App at https://github.com/settings/developers)"
        echo ""
        read -p "Enter GitHub OAuth Client ID (or press Enter to skip): " GITHUB_CLIENT_ID < /dev/tty
        if [ -n "$GITHUB_CLIENT_ID" ]; then
            read -s -p "Enter GitHub OAuth Client Secret: " GITHUB_CLIENT_SECRET < /dev/tty
            echo ""
        fi
    fi

    if [ -n "$GITHUB_CLIENT_ID" ] && [ -n "$GITHUB_CLIENT_SECRET" ]; then
        log_step "Registering GitHub OAuth credential provider..."

        GITHUB_CALLBACK_URL=$($PYTHON_CMD -c "
import boto3

client = boto3.client('bedrock-agentcore-control', region_name='${AWS_REGION}')
response = client.create_oauth2_credential_provider(
    name='github-oauth-provider',
    credentialProviderVendor='CustomOauth2',
    oauth2ProviderConfigInput={
        'customOauth2ProviderConfig': {
            'clientId': '${GITHUB_CLIENT_ID}',
            'clientSecret': '${GITHUB_CLIENT_SECRET}',
            'oauthDiscovery': {
                'authorizationServerMetadata': {
                    'issuer': 'https://github.com',
                    'authorizationEndpoint': 'https://github.com/login/oauth/authorize',
                    'tokenEndpoint': 'https://github.com/login/oauth/access_token',
                }
            }
        }
    }
)

callback_url = response.get('callbackUrl', 'N/A')
print(callback_url)
" 2>/dev/null || echo "")

        if [ -n "$GITHUB_CALLBACK_URL" ] && [ "$GITHUB_CALLBACK_URL" != "N/A" ]; then
            log_info "Provider registered with callback URL: $GITHUB_CALLBACK_URL"
            echo ""
            echo "IMPORTANT: Add this Callback URL to your GitHub OAuth App's Authorization callback URL:"
            echo "  $GITHUB_CALLBACK_URL"
        fi

        if [ $? -eq 0 ]; then
            log_info "GitHub OAuth provider registered"
        else
            log_error "Failed to register GitHub OAuth provider"
        fi
    else
        log_warn "Skipped - GitHub OAuth provider not registered"
        log_warn "To register later, re-run with GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET"
    fi
fi
echo ""

# ── 4. Retrieve Stack Outputs ─────────────────────────────────
log_step "Retrieving stack outputs..."
echo ""

RUNTIME_ARN=$(aws cloudformation describe-stacks \
    --stack-name Mcp3loRuntimeStack \
    --region $AWS_REGION \
    --query 'Stacks[0].Outputs[?OutputKey==`RuntimeArn`].OutputValue' \
    --output text 2>/dev/null || echo "")

RUNTIME_ID=$(aws cloudformation describe-stacks \
    --stack-name Mcp3loRuntimeStack \
    --region $AWS_REGION \
    --query 'Stacks[0].Outputs[?OutputKey==`RuntimeId`].OutputValue' \
    --output text 2>/dev/null || echo "")

REPO_URI=$(aws cloudformation describe-stacks \
    --stack-name Mcp3loRuntimeStack \
    --region $AWS_REGION \
    --query 'Stacks[0].Outputs[?OutputKey==`RepositoryUri`].OutputValue' \
    --output text 2>/dev/null || echo "")

# ── 5. Configure Workload Identity for 3LO OAuth ─────────────────
# The Runtime creates a Workload Identity. We need to update it with
# allowedResourceOauth2ReturnUrls so AgentCore knows where to redirect
# after user completes OAuth consent.
echo ""
log_step "Configuring Workload Identity for 3LO OAuth..."

# Get the frontend callback URL from SSM
FRONTEND_CALLBACK_URL=$(aws ssm get-parameter \
    --name "/${PROJECT_NAME}/${ENVIRONMENT}/frontend-url" \
    --region "$AWS_REGION" \
    --query "Parameter.Value" \
    --output text 2>/dev/null || echo "")

if [ -n "$FRONTEND_CALLBACK_URL" ] && [ -n "$RUNTIME_ARN" ]; then
    log_step "Updating Workload Identity with OAuth callback URL..."

    # Get Workload Identity ARN from Runtime
    WORKLOAD_IDENTITY_ARN=$($PYTHON_CMD -c "
import boto3

client = boto3.client('bedrock-agentcore-control', region_name='${AWS_REGION}')
response = client.get_agent_runtime(agentRuntimeArn='${RUNTIME_ARN}')
workload_details = response.get('workloadIdentityDetails', {})
print(workload_details.get('workloadIdentityArn', ''))
" 2>/dev/null || echo "")

    if [ -n "$WORKLOAD_IDENTITY_ARN" ]; then
        log_info "Workload Identity ARN: $WORKLOAD_IDENTITY_ARN"

        # Update Workload Identity with allowed callback URLs
        UPDATE_RESULT=$($PYTHON_CMD -c "
import boto3

client = boto3.client('bedrock-agentcore-control', region_name='${AWS_REGION}')
try:
    response = client.update_workload_identity(
        workloadIdentityArn='${WORKLOAD_IDENTITY_ARN}',
        allowedResourceOauth2ReturnUrls=['${FRONTEND_CALLBACK_URL}']
    )
    print('success')
except Exception as e:
    print(f'error: {e}')
" 2>/dev/null || echo "error")

        if [ "$UPDATE_RESULT" = "success" ]; then
            log_info "Workload Identity updated with callback URL: $FRONTEND_CALLBACK_URL"
        else
            log_warn "Failed to update Workload Identity: $UPDATE_RESULT"
            log_warn "You may need to manually configure allowedResourceOauth2ReturnUrls"
        fi
    else
        log_warn "Could not retrieve Workload Identity ARN from Runtime"
    fi
else
    if [ -z "$FRONTEND_CALLBACK_URL" ]; then
        log_warn "Frontend callback URL not configured in SSM"
        log_warn "Deploy frontend first, then re-run this script"
    fi
    if [ -z "$RUNTIME_ARN" ]; then
        log_warn "Runtime ARN not available"
    fi
fi
echo ""

echo ""
echo "========================================"
log_info "MCP 3LO Server Runtime Deployment Complete!"
echo "========================================"
echo ""

if [ -n "$RUNTIME_ARN" ]; then
    echo "Runtime ARN: $RUNTIME_ARN"
fi

if [ -n "$RUNTIME_ID" ]; then
    echo "Runtime ID: $RUNTIME_ID"
fi

if [ -n "$REPO_URI" ]; then
    echo "Repository URI: $REPO_URI"
fi

if [ -n "$WORKLOAD_IDENTITY_ARN" ]; then
    echo "Workload Identity ARN: $WORKLOAD_IDENTITY_ARN"
fi

echo ""
echo "Parameter Store Keys:"
echo "  /${PROJECT_NAME}/${ENVIRONMENT}/mcp/mcp-3lo-runtime-arn"
echo "  /${PROJECT_NAME}/${ENVIRONMENT}/mcp/mcp-3lo-runtime-id"
echo ""
echo "3LO OAuth Configuration:"
echo "  Frontend Callback URL: ${FRONTEND_CALLBACK_URL:-'Not configured'}"
echo ""
echo "Prerequisites (Google):"
echo "  1. Create Google OAuth 2.0 Client ID at https://console.cloud.google.com/apis/credentials"
echo "  2. Enable Gmail API at https://console.cloud.google.com/apis/library/gmail.googleapis.com"
echo "  3. Enable Calendar API at https://console.cloud.google.com/apis/library/calendar-json.googleapis.com"
echo "  4. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET env vars and re-run deploy.sh"
echo ""
echo "Prerequisites (Notion):"
echo "  1. Create Public Integration at https://www.notion.so/my-integrations"
echo "  2. Set Distribution type to 'Public' and configure OAuth redirect URI"
echo "  3. Set NOTION_CLIENT_ID and NOTION_CLIENT_SECRET env vars and re-run deploy.sh"
echo ""

log_info "Deployment successful!"
echo ""
