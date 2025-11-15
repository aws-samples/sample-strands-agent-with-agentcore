#!/bin/bash
set -e

# Strands Agent Chatbot - Main Deployment Orchestrator
# Routes to specific deployment scripts

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
display_banner() {
    echo "========================================"
    echo "  Strands Agent Chatbot - Deployment"
    echo "========================================"
    echo ""
}

# Select AWS Region
select_region() {
    echo "Select AWS Region:"
    echo ""
    echo "  1) us-east-1      (US East - N. Virginia)"
    echo "  2) us-west-2      (US West - Oregon)"
    echo "  3) ap-northeast-1 (Asia Pacific - Tokyo)"
    echo "  4) ap-northeast-2 (Asia Pacific - Seoul)"
    echo "  5) ap-southeast-1 (Asia Pacific - Singapore)"
    echo "  6) eu-west-1      (Europe - Ireland)"
    echo "  7) eu-central-1   (Europe - Frankfurt)"
    echo "  8) Custom region"
    echo ""

    read -p "Select region (1-8) [default: 2]: " REGION_OPTION
    REGION_OPTION=${REGION_OPTION:-2}
    echo ""

    case $REGION_OPTION in
        1)
            AWS_REGION="us-east-1"
            ;;
        2)
            AWS_REGION="us-west-2"
            ;;
        3)
            AWS_REGION="ap-northeast-1"
            ;;
        4)
            AWS_REGION="ap-northeast-2"
            ;;
        5)
            AWS_REGION="ap-southeast-1"
            ;;
        6)
            AWS_REGION="eu-west-1"
            ;;
        7)
            AWS_REGION="eu-central-1"
            ;;
        8)
            read -p "Enter AWS region: " AWS_REGION
            if [ -z "$AWS_REGION" ]; then
                log_error "Region cannot be empty"
                exit 1
            fi
            ;;
        *)
            log_error "Invalid option. Using default region: us-west-2"
            AWS_REGION="us-west-2"
            ;;
    esac

    # Export region for deployment scripts
    export AWS_REGION

    log_info "Selected region: $AWS_REGION"
    echo ""
}

# Display menu
display_menu() {
    echo "What would you like to deploy?"
    echo ""
    echo "  1) AgentCore Runtime      (Agent container on Bedrock AgentCore)"
    echo "  2) Frontend + BFF         (Next.js + CloudFront + ALB)"
    echo "  3) MCP Servers            (Serverless Lambda + Fargate)"
    echo "  4) Full Stack             (AgentCore + Frontend + MCPs)"
    echo ""
    echo "  0) Exit"
    echo ""
}

# Check Docker
check_docker() {
    log_step "Checking Docker..."

    # Check if Docker is installed
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed. Please install Docker first."
        echo "  Visit: https://docs.docker.com/get-docker/"
        exit 1
    fi

    # Check if Docker daemon is running
    if ! docker info &> /dev/null; then
        log_error "Docker daemon is not running. Please start Docker."
        echo "  On macOS: Open Docker Desktop"
        echo "  On Linux: sudo systemctl start docker"
        exit 1
    fi

    log_info "Docker is running"
    echo ""
}

# Check if AWS CLI is configured
check_aws() {
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
}

# Deploy AgentCore Runtime
deploy_agentcore_runtime() {
    log_step "Deploying AgentCore Runtime..."
    echo ""

    cd agentcore-runtime-stack

    # Install dependencies if needed
    if [ ! -d "node_modules" ]; then
        log_step "Installing CDK dependencies..."
        npm install
    fi

    # Build TypeScript
    log_step "Building CDK stack..."
    npm run build

    # Check if ECR repository already exists
    if aws ecr describe-repositories --repository-names strands-agent-chatbot-agent-core --region $AWS_REGION &> /dev/null; then
        log_info "ECR repository already exists, importing..."
        export USE_EXISTING_ECR=true
    else
        log_info "Creating new ECR repository..."
        export USE_EXISTING_ECR=false
    fi

    # Deploy infrastructure
    log_step "Deploying CDK infrastructure..."
    npx cdk deploy --require-approval never

    # Get outputs
    log_step "Retrieving stack outputs..."
    REPO_URI=$(aws cloudformation describe-stacks \
        --stack-name AgentRuntimeStack \
        --region $AWS_REGION \
        --query 'Stacks[0].Outputs[?OutputKey==`RepositoryUri`].OutputValue' \
        --output text)

    EXECUTION_ROLE_ARN=$(aws cloudformation describe-stacks \
        --stack-name AgentRuntimeStack \
        --region $AWS_REGION \
        --query 'Stacks[0].Outputs[?OutputKey==`ExecutionRoleArn`].OutputValue' \
        --output text)

    log_info "ECR Repository: $REPO_URI"
    log_info "Execution Role: $EXECUTION_ROLE_ARN"

    # Build and push Docker image
    log_step "Building Agent Core Docker image..."
    cd ../chatbot-app/agentcore

    # Login to ECR
    aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $REPO_URI

    # Build image
    IMAGE_TAG="latest"
    docker build -t $REPO_URI:$IMAGE_TAG -f Dockerfile .

    # Push image
    log_step "Pushing image to ECR..."
    docker push $REPO_URI:$IMAGE_TAG

    log_info "Image pushed: $REPO_URI:$IMAGE_TAG"

    # Create AgentCore Runtime
    log_step "Creating/Updating AgentCore Runtime..."

    # Note: Runtime name can only contain alphanumeric characters and underscores
    RUNTIME_NAME="strands_agent_chatbot_runtime"

    # Check if runtime already exists
    RUNTIME_ARN=$(aws bedrock-agentcore list-agent-runtimes \
        --region $AWS_REGION \
        --query "agentRuntimes[?runtimeName=='$RUNTIME_NAME'].agentRuntimeArn" \
        --output text 2>/dev/null || echo "")

    if [ -n "$RUNTIME_ARN" ]; then
        log_warn "Runtime already exists: $RUNTIME_ARN"
        log_step "Updating runtime configuration..."

        # Create new version
        aws bedrock-agentcore create-agent-runtime-version \
            --agent-runtime-arn $RUNTIME_ARN \
            --region $AWS_REGION || true
    else
        log_step "Creating new runtime..."

        # Create runtime
        RUNTIME_ARN=$(aws bedrock-agentcore create-agent-runtime \
            --runtime-name "$RUNTIME_NAME" \
            --description "Strands Agent Chatbot Runtime" \
            --execution-role-arn $EXECUTION_ROLE_ARN \
            --runtime-artifact "{\"agentRuntimeArtifactType\":\"Container\",\"containerConfiguration\":{\"imageUri\":\"$REPO_URI:$IMAGE_TAG\"}}" \
            --protocol-configuration "{\"protocolType\":\"HTTP\"}" \
            --region $AWS_REGION \
            --query 'agentRuntimeArn' \
            --output text)

        log_info "Runtime created: $RUNTIME_ARN"
    fi

    # Get Runtime ID
    RUNTIME_ID=$(echo $RUNTIME_ARN | awk -F'/' '{print $NF}')

    # Update Parameter Store
    log_step "Updating Parameter Store..."

    aws ssm put-parameter \
        --name "/strands-agent-chatbot/dev/agentcore/runtime-arn" \
        --value "$RUNTIME_ARN" \
        --type "String" \
        --overwrite \
        --region $AWS_REGION

    aws ssm put-parameter \
        --name "/strands-agent-chatbot/dev/agentcore/runtime-id" \
        --value "$RUNTIME_ID" \
        --type "String" \
        --overwrite \
        --region $AWS_REGION

    log_info "Parameters updated"

    echo ""
    log_info "AgentCore Runtime deployment complete!"
    echo ""
    echo "Runtime ARN: $RUNTIME_ARN"
    echo "Runtime ID: $RUNTIME_ID"
    echo ""

    cd ../..
}

# Deploy Frontend + BFF
deploy_frontend() {
    log_step "Deploying Frontend + BFF..."
    echo ""

    cd chatbot-deployment/infrastructure

    # Check if scripts exist
    if [ ! -f "scripts/deploy.sh" ]; then
        log_error "scripts/deploy.sh not found"
        exit 1
    fi

    chmod +x scripts/deploy.sh
    ./scripts/deploy.sh

    cd ../..
}

# Deploy MCP Servers
deploy_mcp_servers() {
    log_step "Deploying MCP Servers..."
    echo ""

    # Serverless MCPs (Lambda)
    if [ -d "serverless-mcp-farm" ]; then
        log_step "Deploying Serverless MCP Servers..."
        cd serverless-mcp-farm

        if [ -f "deploy-server.sh" ]; then
            chmod +x deploy-server.sh
            ./deploy-server.sh
        else
            log_warn "serverless-mcp-farm/deploy-server.sh not found"
        fi

        cd ..
    fi

    # Stateful MCPs (Fargate)
    if [ -d "fargate-mcp-farm" ]; then
        log_step "Deploying Stateful MCP Servers..."
        cd fargate-mcp-farm

        # Deploy shared infrastructure first
        if [ -d "shared-infrastructure" ]; then
            cd shared-infrastructure
            if [ -f "deploy.sh" ]; then
                chmod +x deploy.sh
                ./deploy.sh
            fi
            cd ..
        fi

        # Deploy individual MCP servers
        if [ -f "deploy-all.sh" ]; then
            chmod +x deploy-all.sh
            ./deploy-all.sh -s nova-act-mcp
            ./deploy-all.sh -s python-mcp
        else
            log_warn "fargate-mcp-farm/deploy-all.sh not found"
        fi

        cd ..
    fi

    log_info "MCP Servers deployment complete!"
}

# Main function
main() {
    display_banner
    check_docker
    check_aws
    select_region
    display_menu

    read -p "Select option (0-4): " OPTION
    echo ""

    case $OPTION in
        1)
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            echo "  Option 1: AgentCore Runtime Only"
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            echo ""
            deploy_agentcore_runtime
            ;;
        2)
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            echo "  Option 2: Frontend + BFF Only"
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            echo ""
            deploy_frontend
            ;;
        3)
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            echo "  Option 3: MCP Servers Only"
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            echo ""
            deploy_mcp_servers
            ;;
        4)
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            echo "  Option 4: Full Stack"
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            echo ""
            deploy_agentcore_runtime
            echo ""
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            echo ""
            deploy_frontend
            echo ""
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            echo ""
            deploy_mcp_servers
            ;;
        0)
            log_info "Exiting..."
            exit 0
            ;;
        *)
            log_error "Invalid option. Please select 0-4."
            exit 1
            ;;
    esac

    echo ""
    echo "========================================"
    log_info "Deployment Complete!"
    echo "========================================"
    echo ""
    log_info "Next Steps:"
    echo "  1. Frontend URL will be shown in CloudFormation outputs"
    echo "  2. AgentCore Runtime ARN is stored in Parameter Store"
    echo "  3. Test the integration at the frontend URL"
    echo ""
}

# Run main
main
