#!/bin/bash
set -e

# Research Agent A2A Runtime - Deployment Script
# Deploys Research Agent as AgentCore Runtime using CDK

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Functions
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

# Display banner
echo "========================================"
echo "  Research Agent A2A Runtime Deployment"
echo "========================================"
echo ""

# Check AWS CLI
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
echo ""

# Get AWS account and region
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
echo ""

# Change to CDK directory
cd cdk

# Install CDK dependencies
log_step "Installing CDK dependencies..."
if [ ! -d "node_modules" ]; then
    npm install
else
    log_info "Dependencies already installed"
fi
echo ""

# Clean previous build artifacts to force fresh asset generation
log_step "Cleaning previous CDK build artifacts..."
rm -rf cdk.out
log_info "Clean complete"
echo ""

# Build TypeScript
log_step "Building CDK stack..."
npm run build
log_info "Build complete"
echo ""

# Check if ECR repository exists
log_step "Checking ECR repository..."
if aws ecr describe-repositories --repository-names ${PROJECT_NAME}-research-agent --region $AWS_REGION &> /dev/null; then
    log_info "ECR repository already exists, importing..."
    export USE_EXISTING_ECR=true
else
    log_info "Creating new ECR repository..."
    export USE_EXISTING_ECR=false
fi
echo ""

# Bootstrap CDK (if needed)
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

# Deploy CDK stack
log_step "Deploying Research Agent A2A Runtime Stack..."
echo ""
if ! npx cdk deploy --require-approval never 2>&1 | tee /tmp/cdk-deploy-output.txt; then
    if grep -q "research-charts\|already exists" /tmp/cdk-deploy-output.txt; then
        echo ""
        echo "========================================"
        log_warn "Legacy S3 bucket conflict detected (ResearchChartStorageBucket)."
        echo ""
        echo -e "  The old ${YELLOW}research-charts${NC} bucket conflicts with the new"
        echo -e "  consolidated artifact bucket layout."
        echo ""
        read -p "  Automatically destroy and redeploy? [y/N]: " AUTO_FIX
        echo ""

        if [[ "$AUTO_FIX" =~ ^[Yy]$ ]]; then
            log_step "Destroying ResearchAgentRuntimeStack..."
            npx cdk destroy --force --all --region $AWS_REGION
            log_info "Stack destroyed."
            echo ""

            log_step "Redeploying Research Agent A2A Runtime Stack..."
            echo ""
            npx cdk deploy --require-approval never
        else
            log_error "Deployment aborted. Run destroy manually then redeploy."
            exit 1
        fi
    else
        echo ""
        log_error "Deployment failed. See output above for details."
        exit 1
    fi
fi

# Get stack outputs
log_step "Retrieving stack outputs..."
echo ""

RUNTIME_ARN=$(aws cloudformation describe-stacks \
    --stack-name ResearchAgentRuntimeStack \
    --region $AWS_REGION \
    --query 'Stacks[0].Outputs[?OutputKey==`RuntimeArn`].OutputValue' \
    --output text 2>/dev/null || echo "")

RUNTIME_ID=$(aws cloudformation describe-stacks \
    --stack-name ResearchAgentRuntimeStack \
    --region $AWS_REGION \
    --query 'Stacks[0].Outputs[?OutputKey==`RuntimeId`].OutputValue' \
    --output text 2>/dev/null || echo "")

REPO_URI=$(aws cloudformation describe-stacks \
    --stack-name ResearchAgentRuntimeStack \
    --region $AWS_REGION \
    --query 'Stacks[0].Outputs[?OutputKey==`RepositoryUri`].OutputValue' \
    --output text 2>/dev/null || echo "")

echo ""
echo "========================================"
log_info "Research Agent A2A Runtime Deployment Complete!"
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

echo ""
echo "Parameter Store Keys:"
echo "  /${PROJECT_NAME}/${ENVIRONMENT}/a2a/research-agent-runtime-arn"
echo "  /${PROJECT_NAME}/${ENVIRONMENT}/a2a/research-agent-runtime-id"
echo ""
echo "Integration Note:"
echo "  Main agent can invoke Research Agent via InvokeAgentRuntime API"
echo "  using the Runtime ARN stored in Parameter Store."
echo ""

log_info "Deployment successful!"
echo ""
