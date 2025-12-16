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
    echo "  3) MCP Tools              (AgentCore Gateway + Lambda functions)"
    echo "  4) AgentCore Runtime A2A  (Research Agent, Browser Use Agent)"
    echo "  5) Runtime + Frontend     (1 + 2 combined)"
    echo "  6) Full Stack             (All components: Runtime + Frontend + Gateway + A2A)"
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

    # Check and configure Nova Act API key
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  Browser Automation Setup (Nova Act)"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""

    NOVA_SECRET_EXISTS=$(aws secretsmanager describe-secret \
        --secret-id "strands-agent-chatbot/nova-act-api-key" \
        --query 'Name' \
        --output text \
        --region "$AWS_REGION" 2>/dev/null || echo "")

    if [ -z "$NOVA_SECRET_EXISTS" ]; then
        log_warn "Nova Act API Key not configured"
        echo ""
        echo "Nova Act is required for browser automation tools."
        echo "Get your API key from Nova Act dashboard."
        echo ""
        read -p "Enter Nova Act API Key (or press Enter to skip): " NOVA_ACT_KEY

        if [ -n "$NOVA_ACT_KEY" ]; then
            log_step "Setting Nova Act API Key in Secrets Manager..."
            aws secretsmanager create-secret \
                --name "strands-agent-chatbot/nova-act-api-key" \
                --secret-string "$NOVA_ACT_KEY" \
                --description "Nova Act API Key for browser automation" \
                --region "$AWS_REGION" > /dev/null 2>&1 || \
            aws secretsmanager put-secret-value \
                --secret-id "strands-agent-chatbot/nova-act-api-key" \
                --secret-string "$NOVA_ACT_KEY" \
                --region "$AWS_REGION" > /dev/null 2>&1
            log_info "Nova Act API Key configured"
        else
            log_warn "Skipped - Browser automation tools will not work without API key"
        fi
    else
        log_info "Nova Act API Key already configured"
    fi
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

    # Get Runtime info from CDK stack outputs
    log_step "Retrieving Runtime information from CDK stack..."

    RUNTIME_ARN=$(aws cloudformation describe-stacks \
        --stack-name AgentRuntimeStack \
        --region $AWS_REGION \
        --query 'Stacks[0].Outputs[?OutputKey==`AgentRuntimeArn`].OutputValue' \
        --output text)

    RUNTIME_ID=$(aws cloudformation describe-stacks \
        --stack-name AgentRuntimeStack \
        --region $AWS_REGION \
        --query 'Stacks[0].Outputs[?OutputKey==`AgentRuntimeId`].OutputValue' \
        --output text)

    echo ""
    log_info "AgentCore Runtime deployment complete!"
    echo ""
    echo "Runtime ARN: $RUNTIME_ARN"
    echo "Runtime ID: $RUNTIME_ID"
    echo "Memory ARN: $(aws cloudformation describe-stacks --stack-name AgentRuntimeStack --region $AWS_REGION --query 'Stacks[0].Outputs[?OutputKey==`MemoryArn`].OutputValue' --output text)"
    echo ""

    cd ../../agent-blueprint
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

# Deploy MCP Servers (AgentCore Gateway + Lambda)
deploy_mcp_servers() {
    log_step "Deploying AgentCore Gateway Stack..."
    echo ""

    log_info "This will deploy:"
    echo "  • AgentCore Gateway (MCP protocol with AWS_IAM auth)"
    echo "  • 5 Lambda functions (ARM64, Python 3.13)"
    echo "  • 12 MCP tools via Gateway Targets"
    echo ""

    log_step "Tools that will be available:"
    echo "  • tavily_search, tavily_extract"
    echo "  • wikipedia_search, wikipedia_get_article"
    echo "  • arxiv_search, arxiv_get_paper"
    echo "  • google_web_search, google_image_search"
    echo "  • stock_quote, stock_history, financial_news, stock_analysis"
    echo ""

    # Check if agentcore-gateway-stack exists
    if [ ! -d "agentcore-gateway-stack" ]; then
        log_error "agentcore-gateway-stack directory not found"
        exit 1
    fi

    cd agentcore-gateway-stack/scripts

    # Check if deploy script exists
    if [ ! -f "deploy.sh" ]; then
        log_error "agentcore-gateway-stack/scripts/deploy.sh not found"
        exit 1
    fi

    # Make script executable
    chmod +x deploy.sh

    # Export AWS region for the deployment script
    export AWS_REGION
    export PROJECT_NAME="strands-agent-chatbot"
    export ENVIRONMENT="dev"

    # Run deployment
    ./deploy.sh

    cd ../..

    # Verify deployment
    log_step "Verifying deployment..."

    GATEWAY_URL=$(aws ssm get-parameter \
        --name "/strands-agent-chatbot/dev/mcp/gateway-url" \
        --query 'Parameter.Value' \
        --output text \
        --region $AWS_REGION 2>/dev/null || echo "")

    if [ -n "$GATEWAY_URL" ]; then
        log_info "Gateway deployed successfully!"
        echo ""
        echo "Gateway URL: $GATEWAY_URL"
        echo ""
    else
        log_warn "Gateway URL not found in Parameter Store"
    fi

    log_info "AgentCore Gateway Stack deployment complete!"
}

# Deploy AgentCore Runtime A2A Agents
deploy_agentcore_runtime_a2a() {
    log_step "Deploying AgentCore Runtime A2A Agents..."
    echo ""

    log_info "Available A2A Agents:"
    echo ""

    # Check which A2A agents are available
    AVAILABLE_SERVERS=()

    if [ -d "agentcore-runtime-a2a-stack/research-agent" ]; then
        AVAILABLE_SERVERS+=("research-agent")
        echo "  1) research-agent      (Web research and markdown report generation via A2A)"
    fi

    if [ -d "agentcore-runtime-a2a-stack/browser-use-agent" ]; then
        AVAILABLE_SERVERS+=("browser-use-agent")
        echo "  2) browser-use-agent   (Autonomous browser automation via A2A)"
    fi

    echo ""
    echo "  a) Deploy all available servers"
    echo "  0) Back to main menu"
    echo ""

    read -p "Select server to deploy (0/1/2/a): " MCP_OPTION
    echo ""

    case $MCP_OPTION in
        1)
            if [[ " ${AVAILABLE_SERVERS[@]} " =~ " research-agent " ]]; then
                deploy_research_agent
            else
                log_error "research-agent not found"
                exit 1
            fi
            ;;
        2)
            if [[ " ${AVAILABLE_SERVERS[@]} " =~ " browser-use-agent " ]]; then
                deploy_browser_use_agent
            else
                log_error "browser-use-agent not found"
                exit 1
            fi
            ;;
        a)
            log_info "Deploying all available AgentCore Runtime A2A agents..."
            echo ""
            for server in "${AVAILABLE_SERVERS[@]}"; do
                case $server in
                    "research-agent")
                        deploy_research_agent
                        ;;
                    "browser-use-agent")
                        deploy_browser_use_agent
                        ;;
                esac
                echo ""
                echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
                echo ""
            done
            ;;
        0)
            log_info "Returning to main menu..."
            return
            ;;
        *)
            log_error "Invalid option"
            exit 1
            ;;
    esac
}

# Deploy Research Agent
deploy_research_agent() {
    log_step "Deploying Research Agent A2A Agent..."
    echo ""

    cd agentcore-runtime-a2a-stack/research-agent

    # Check if deploy script exists
    if [ ! -f "deploy.sh" ]; then
        log_error "deploy.sh not found in research-agent"
        exit 1
    fi

    # Make script executable
    chmod +x deploy.sh

    # Export environment variables for the deployment script
    export AWS_REGION
    export PROJECT_NAME="strands-agent-chatbot"
    export ENVIRONMENT="dev"

    # Run deployment
    ./deploy.sh

    cd ../..

    log_info "Research Agent A2A agent deployment complete!"
}

# Deploy Browser Use Agent
deploy_browser_use_agent() {
    log_step "Deploying Browser Use Agent A2A Agent..."
    echo ""

    cd agentcore-runtime-a2a-stack/browser-use-agent/cdk

    # Install dependencies if needed
    if [ ! -d "node_modules" ]; then
        log_step "Installing CDK dependencies..."
        npm install
    fi

    # Clean previous build artifacts to force fresh asset generation
    log_step "Cleaning previous CDK build artifacts..."
    rm -rf cdk.out

    # Build TypeScript
    log_step "Building CDK stack..."
    npm run build

    # Export environment variables for the deployment script
    export AWS_REGION
    export PROJECT_NAME="strands-agent-chatbot"
    export ENVIRONMENT="dev"

    # Check if ECR repository already exists
    if aws ecr describe-repositories --repository-names strands-agent-chatbot-browser-use-agent --region $AWS_REGION &> /dev/null; then
        log_info "ECR repository already exists, importing..."
        export USE_EXISTING_ECR=true
    else
        log_info "Creating new ECR repository..."
        export USE_EXISTING_ECR=false
    fi

    # Deploy infrastructure
    log_step "Deploying CDK infrastructure..."
    npx cdk deploy BrowserUseAgentRuntimeStack --require-approval never

    # Verify deployment
    log_step "Verifying deployment..."

    RUNTIME_ARN=$(aws ssm get-parameter \
        --name "/strands-agent-chatbot/dev/a2a/browser-use-agent-runtime-arn" \
        --query 'Parameter.Value' \
        --output text \
        --region $AWS_REGION 2>/dev/null || echo "")

    if [ -n "$RUNTIME_ARN" ]; then
        log_info "Browser Use Agent deployed successfully!"
        echo ""
        echo "Runtime ARN: $RUNTIME_ARN"
        echo ""
    else
        log_warn "Runtime ARN not found in Parameter Store"
    fi

    cd ../../..

    log_info "Browser Use Agent A2A agent deployment complete!"
}

# Deploy all available A2A agents automatically (for Full Stack deployment)
deploy_all_a2a_agents() {
    log_step "Deploying all available A2A agents..."
    echo ""

    # Check which A2A agents are available
    AVAILABLE_SERVERS=()

    if [ -d "agentcore-runtime-a2a-stack/research-agent" ]; then
        AVAILABLE_SERVERS+=("research-agent")
    fi

    if [ -d "agentcore-runtime-a2a-stack/browser-use-agent" ]; then
        AVAILABLE_SERVERS+=("browser-use-agent")
    fi

    if [ ${#AVAILABLE_SERVERS[@]} -eq 0 ]; then
        log_warn "No A2A agents found to deploy"
        return
    fi

    log_info "Found ${#AVAILABLE_SERVERS[@]} A2A agent(s) to deploy"
    echo ""

    # Deploy all available agents
    for server in "${AVAILABLE_SERVERS[@]}"; do
        case $server in
            "research-agent")
                deploy_research_agent
                ;;
            "browser-use-agent")
                deploy_browser_use_agent
                ;;
        esac
        echo ""
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo ""
    done

    log_info "All A2A agents deployed successfully!"
}

# Display deployment summary with all important URLs
display_deployment_summary() {
    echo ""
    echo "========================================"
    echo "  🎉 DEPLOYMENT SUMMARY"
    echo "========================================"
    echo ""

    # Get CloudFront URL
    CLOUDFRONT_URL=$(aws cloudformation describe-stacks \
        --stack-name ChatbotStack \
        --region $AWS_REGION \
        --query 'Stacks[0].Outputs[?OutputKey==`ApplicationUrl`].OutputValue' \
        --output text 2>/dev/null || echo "Not available")

    # Get Streaming ALB URL
    STREAMING_ALB_URL=$(aws cloudformation describe-stacks \
        --stack-name ChatbotStack \
        --region $AWS_REGION \
        --query 'Stacks[0].Outputs[?OutputKey==`StreamingAlbUrl`].OutputValue' \
        --output text 2>/dev/null || echo "Not available")

    # Get AgentCore Runtime ARN
    RUNTIME_ARN=$(aws cloudformation describe-stacks \
        --stack-name AgentRuntimeStack \
        --region $AWS_REGION \
        --query 'Stacks[0].Outputs[?OutputKey==`AgentRuntimeArn`].OutputValue' \
        --output text 2>/dev/null || echo "Not available")

    # Get Gateway URL
    GATEWAY_URL=$(aws ssm get-parameter \
        --name "/strands-agent-chatbot/dev/mcp/gateway-url" \
        --query 'Parameter.Value' \
        --output text \
        --region $AWS_REGION 2>/dev/null || echo "Not available")

    # Get A2A Runtime ARNs
    RESEARCH_AGENT_ARN=$(aws ssm get-parameter \
        --name "/strands-agent-chatbot/dev/a2a/research-agent-runtime-arn" \
        --query 'Parameter.Value' \
        --output text \
        --region $AWS_REGION 2>/dev/null || echo "Not deployed")

    BROWSER_AGENT_ARN=$(aws ssm get-parameter \
        --name "/strands-agent-chatbot/dev/a2a/browser-use-agent-runtime-arn" \
        --query 'Parameter.Value' \
        --output text \
        --region $AWS_REGION 2>/dev/null || echo "Not deployed")

    log_info "Deployment Region: $AWS_REGION"
    echo ""

    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "🌐 FRONTEND"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "CloudFront URL:      $CLOUDFRONT_URL"
    echo "Streaming ALB URL:   $STREAMING_ALB_URL"
    echo ""

    # Check if Cognito is enabled
    COGNITO_USER_POOL_ID=$(aws cloudformation describe-stacks \
        --stack-name CognitoAuthStack \
        --region $AWS_REGION \
        --query 'Stacks[0].Outputs[?OutputKey==`UserPoolId`].OutputValue' \
        --output text 2>/dev/null || echo "")

    if [ -n "$COGNITO_USER_POOL_ID" ] && [ "$COGNITO_USER_POOL_ID" != "None" ]; then
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo "🔐 COGNITO AUTHENTICATION"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo ""
        echo "User Pool ID:        $COGNITO_USER_POOL_ID"
        echo ""
        echo "Test User Credentials:"
        echo "  Email:             test@example.com"
        echo "  Password:          TestUser123!"
        echo ""
    fi


    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "🤖 AGENTCORE RUNTIME"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "Runtime ARN:         $RUNTIME_ARN"
    echo ""

    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "🔧 MCP GATEWAY"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "Gateway URL:         $GATEWAY_URL"
    echo ""

    if [ "$RESEARCH_AGENT_ARN" != "Not deployed" ] || [ "$BROWSER_AGENT_ARN" != "Not deployed" ]; then
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo "🚀 A2A AGENTS"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo ""
        if [ "$RESEARCH_AGENT_ARN" != "Not deployed" ]; then
            echo "Research Agent:      $RESEARCH_AGENT_ARN"
        fi
        if [ "$BROWSER_AGENT_ARN" != "Not deployed" ]; then
            echo "Browser Use Agent:   $BROWSER_AGENT_ARN"
        fi
        echo ""
    fi

    echo "========================================"
    echo "✅ All components deployed successfully!"
    echo "========================================"
    echo ""
    echo "🚀 Access your chatbot at: $CLOUDFRONT_URL"
    echo ""
}

# Main function
main() {
    display_banner
    check_aws
    select_region
    display_menu

    read -p "Select option (0-6): " OPTION
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
            echo "  Option 3: MCP Tools Only"
            echo "  (AgentCore Gateway + Lambda)"
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            echo ""
            deploy_mcp_servers
            ;;
        4)
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            echo "  Option 4: AgentCore Runtime A2A"
            echo "  (Research Agent, Browser Use Agent)"
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            echo ""
            deploy_agentcore_runtime_a2a
            ;;
        5)
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            echo "  Option 5: Runtime + Frontend"
            echo "  (AgentCore + BFF/Frontend)"
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            echo ""
            deploy_agentcore_runtime
            echo ""
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            echo ""
            deploy_frontend
            ;;
        6)
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            echo "  Option 6: Full Stack"
            echo "  (Runtime + Frontend + Gateway + A2A)"
            echo "  Cognito authentication will be enabled"
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            echo ""
            deploy_agentcore_runtime
            echo ""
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            echo ""
            # Enable Cognito for Full Stack deployment
            export ENABLE_COGNITO=true
            deploy_frontend
            echo ""
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            echo ""
            deploy_mcp_servers
            echo ""
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            echo ""
            deploy_all_a2a_agents
            echo ""
            display_deployment_summary
            return
            ;;
        0)
            log_info "Exiting..."
            exit 0
            ;;
        *)
            log_error "Invalid option. Please select 0-6."
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
