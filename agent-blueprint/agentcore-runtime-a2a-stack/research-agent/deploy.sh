#!/bin/bash
set -e

# Research Agent A2A Runtime - Deployment Script
# 1. Create ECR repo (if needed)
# 2. Build & push Docker image (synchronous)
# 3. CDK deploy (Runtime + SSM params only)

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() { echo -e "${GREEN}✓${NC} $1"; }
log_warn() { echo -e "${YELLOW}⚠${NC} $1"; }
log_error() { echo -e "${RED}✗${NC} $1"; }
log_step() { echo -e "${BLUE}▶${NC} $1"; }

echo "========================================"
echo "  Research Agent A2A Runtime Deployment"
echo "========================================"
echo ""

# Check prerequisites
log_step "Checking prerequisites..."
if ! command -v aws &> /dev/null; then
    log_error "AWS CLI is not installed"
    exit 1
fi
if ! aws sts get-caller-identity &> /dev/null; then
    log_error "AWS CLI is not configured. Please run: aws configure"
    exit 1
fi
if ! command -v docker &> /dev/null; then
    log_error "Docker is not installed"
    exit 1
fi
if ! docker info &> /dev/null; then
    log_error "Docker daemon is not running"
    exit 1
fi
log_info "All prerequisites met"
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

ECR_REPO="${PROJECT_NAME}-research-agent"
ECR_URI="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPO}"

log_info "AWS Account: $AWS_ACCOUNT_ID"
log_info "AWS Region: $AWS_REGION"
log_info "ECR Repo: $ECR_REPO"
echo ""

# ============================================================
# Step 1: Create ECR repository if it doesn't exist
# ============================================================
log_step "Checking ECR repository..."
if aws ecr describe-repositories --repository-names "$ECR_REPO" --region "$AWS_REGION" &> /dev/null; then
    log_info "ECR repository already exists"
else
    log_step "Creating ECR repository..."
    aws ecr create-repository \
        --repository-name "$ECR_REPO" \
        --region "$AWS_REGION" \
        --image-scanning-configuration scanOnPush=true \
        --output text > /dev/null
    log_info "ECR repository created"
fi
export USE_EXISTING_ECR=true
echo ""

# ============================================================
# Step 2: Build Docker image (ARM64 for AgentCore Runtime)
# ============================================================
log_step "Building Docker image (linux/arm64)..."

# Get the research-agent source directory (parent of cdk/)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

docker buildx build \
    --platform linux/arm64 \
    --tag "${ECR_URI}:latest" \
    --load \
    "$SCRIPT_DIR"

log_info "Docker image built successfully"
echo ""

# ============================================================
# Step 3: Push to ECR
# ============================================================
log_step "Pushing image to ECR..."

aws ecr get-login-password --region "$AWS_REGION" | \
    docker login --username AWS --password-stdin "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

docker push "${ECR_URI}:latest"

log_info "Image pushed to ECR"
echo ""

# Verify image exists
IMAGE_DIGEST=$(aws ecr describe-images \
    --repository-name "$ECR_REPO" \
    --image-ids imageTag=latest \
    --region "$AWS_REGION" \
    --query 'imageDetails[0].imageDigest' \
    --output text 2>/dev/null || echo "")

if [ -z "$IMAGE_DIGEST" ] || [ "$IMAGE_DIGEST" = "None" ]; then
    log_error "Image verification failed — latest tag not found in ECR"
    exit 1
fi
log_info "Image verified in ECR: $IMAGE_DIGEST"
echo ""

# ============================================================
# Step 4: CDK deploy (Runtime + SSM params)
# ============================================================
cd "$SCRIPT_DIR/cdk"

if [ ! -d "node_modules" ]; then
    log_step "Installing CDK dependencies..."
    npm install
fi

log_step "Cleaning previous CDK build artifacts..."
rm -rf cdk.out

log_step "Building CDK stack..."
npm run build
echo ""

# Bootstrap CDK if needed
if ! aws cloudformation describe-stacks --stack-name CDKToolkit --region "$AWS_REGION" &> /dev/null; then
    log_step "Bootstrapping CDK..."
    npx cdk bootstrap "aws://$AWS_ACCOUNT_ID/$AWS_REGION"
fi

log_step "Deploying CDK stack..."
npx cdk deploy --require-approval never
echo ""

# ============================================================
# Step 5: Verify deployment
# ============================================================
log_step "Retrieving stack outputs..."

RUNTIME_ARN=$(aws cloudformation describe-stacks \
    --stack-name ResearchAgentRuntimeStack \
    --region "$AWS_REGION" \
    --query 'Stacks[0].Outputs[?OutputKey==`RuntimeArn`].OutputValue' \
    --output text 2>/dev/null || echo "")

RUNTIME_ID=$(aws cloudformation describe-stacks \
    --stack-name ResearchAgentRuntimeStack \
    --region "$AWS_REGION" \
    --query 'Stacks[0].Outputs[?OutputKey==`RuntimeId`].OutputValue' \
    --output text 2>/dev/null || echo "")

echo ""
echo "========================================"
log_info "Research Agent Deployment Complete!"
echo "========================================"
echo ""

if [ -n "$RUNTIME_ARN" ]; then
    echo "Runtime ARN: $RUNTIME_ARN"
fi
if [ -n "$RUNTIME_ID" ]; then
    echo "Runtime ID: $RUNTIME_ID"
fi

echo ""
echo "Parameter Store Keys:"
echo "  /${PROJECT_NAME}/${ENVIRONMENT}/a2a/research-agent-runtime-arn"
echo "  /${PROJECT_NAME}/${ENVIRONMENT}/a2a/research-agent-runtime-id"
echo ""
