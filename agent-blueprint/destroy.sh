#!/bin/bash
set -e

# Strands Agent Chatbot - Main Destruction Orchestrator
# Routes to specific destroy scripts

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
    echo "  Strands Agent Chatbot - Destruction"
    echo "========================================"
    echo ""
    echo -e "${RED}⚠️  WARNING: Destructive Operation${NC}"
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

    # Export region for destroy scripts
    export AWS_REGION

    log_info "Selected region: $AWS_REGION"
    echo ""
}

# Display menu
display_menu() {
    echo "What would you like to destroy?"
    echo ""
    echo "  1) AgentCore Runtime      (Agent container on Bedrock AgentCore)"
    echo "  2) Frontend + BFF         (Next.js + CloudFront + ALB)"
    echo "  3) MCP Servers            (Serverless Lambda + Fargate)"
    echo "  4) AgentCore Runtime A2A  (Research Agent, Code Agent)"
    echo "  5) Full Stack             (AgentCore + Frontend + MCPs + A2A)"
    echo ""
    echo "  0) Exit"
    echo ""
    echo -e "${YELLOW}Note: Destruction order is reverse of deployment${NC}"
    echo -e "${YELLOW}      (A2A → MCP Servers → Frontend → AgentCore)${NC}"
    echo ""
}

# Check AWS CLI
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

# Destroy AgentCore Runtime
destroy_agentcore_runtime() {
    log_step "Destroying AgentCore Runtime..."
    echo ""

    cd agentcore-runtime-stack

    # Check if runtime exists
    # Note: Runtime name uses underscores, not hyphens
    RUNTIME_ARN=$(aws bedrock-agentcore list-agent-runtimes \
        --region $AWS_REGION \
        --query "agentRuntimes[?runtimeName=='strands_agent_chatbot_runtime'].agentRuntimeArn" \
        --output text 2>/dev/null || echo "")

    if [ -n "$RUNTIME_ARN" ]; then
        log_step "Deleting AgentCore Runtime: $RUNTIME_ARN"
        aws bedrock-agentcore delete-agent-runtime \
            --agent-runtime-arn "$RUNTIME_ARN" \
            --region $AWS_REGION || true

        log_info "Waiting for runtime deletion..."
        sleep 10
    else
        log_warn "AgentCore Runtime not found (might be already deleted)"
    fi

    # Destroy CDK stack
    log_step "Destroying CDK infrastructure..."
    npx cdk destroy --force --all

    log_info "AgentCore Runtime destroyed!"
    echo ""

    cd ..
}

# Destroy Frontend + BFF
destroy_frontend() {
    log_step "Destroying Frontend + BFF..."
    echo ""

    cd chatbot-deployment/infrastructure

    # Check if destroy script exists
    if [ ! -f "scripts/destroy.sh" ]; then
        log_warn "Frontend destroy script not found, using CDK destroy"
        npx cdk destroy --force --all
    else
        chmod +x scripts/destroy.sh
        ./scripts/destroy.sh
    fi

    log_info "Frontend + BFF destroyed!"
    echo ""

    cd ../..
}

# Destroy MCP Servers
destroy_mcp_servers() {
    log_step "Destroying MCP Servers..."
    echo ""

    # Stateful MCPs (Fargate) - destroy first
    if [ -d "fargate-mcp-farm" ]; then
        log_step "Destroying Stateful MCP Servers..."
        cd fargate-mcp-farm

        # Destroy individual MCP servers
        if [ -f "destroy-all.sh" ]; then
            chmod +x destroy-all.sh
            ./destroy-all.sh -s nova-act-mcp
            ./destroy-all.sh -s python-mcp
        else
            log_warn "fargate-mcp-farm/destroy-all.sh not found"
        fi

        # Destroy shared infrastructure last
        if [ -d "shared-infrastructure" ]; then
            cd shared-infrastructure
            if [ -f "destroy.sh" ]; then
                chmod +x destroy.sh
                ./destroy.sh
            fi
            cd ..
        fi

        cd ..
    fi

    # Serverless MCPs (Lambda)
    if [ -d "serverless-mcp-farm" ]; then
        log_step "Destroying Serverless MCP Servers..."
        cd serverless-mcp-farm

        if [ -f "destroy-all-mcp.sh" ]; then
            chmod +x destroy-all-mcp.sh
            ./destroy-all-mcp.sh
        else
            log_warn "serverless-mcp-farm/destroy-all-mcp.sh not found"
        fi

        cd ..
    fi

    # AgentCore Gateway Stack (Lambda MCP Tools)
    if [ -d "agentcore-gateway-stack" ]; then
        log_step "Destroying AgentCore Gateway Stack..."
        cd agentcore-gateway-stack/scripts

        if [ -f "destroy.sh" ]; then
            chmod +x destroy.sh
            echo "yes" | ./destroy.sh
        else
            log_warn "agentcore-gateway-stack/scripts/destroy.sh not found"
        fi

        cd ../..
    fi

    log_info "MCP Servers destroyed!"
    echo ""
}

# Destroy AgentCore Runtime A2A
destroy_agentcore_a2a() {
    log_step "Destroying AgentCore Runtime A2A Agents..."
    echo ""

    if [ ! -d "agentcore-runtime-a2a-stack" ]; then
        log_warn "agentcore-runtime-a2a-stack directory not found"
        return
    fi

    cd agentcore-runtime-a2a-stack

    # Agents excluded from deployment/destruction
    EXCLUDED_AGENTS=("browser-use-agent")

    # List available A2A agents
    A2A_AGENTS=()
    for agent_dir in */; do
        if [ -d "$agent_dir/cdk" ]; then
            agent_name=$(basename "$agent_dir")
            # Skip excluded agents
            if [[ " ${EXCLUDED_AGENTS[@]} " =~ " ${agent_name} " ]]; then
                continue
            fi
            A2A_AGENTS+=("$agent_name")
        fi
    done

    if [ ${#A2A_AGENTS[@]} -eq 0 ]; then
        log_warn "No A2A agents found"
        cd ..
        return
    fi

    log_info "Available A2A Agents:"
    echo ""
    for i in "${!A2A_AGENTS[@]}"; do
        echo "  $((i+1))) ${A2A_AGENTS[$i]}"
    done
    echo ""
    echo "  a) Destroy all available agents"
    echo "  0) Skip"
    echo ""

    read -p "Select agent to destroy (0/1/2/3/a): " A2A_OPTION
    echo ""

    case $A2A_OPTION in
        0)
            log_info "Skipping A2A agent destruction"
            cd ..
            return
            ;;
        a)
            log_step "Destroying all A2A agents..."
            for agent_name in "${A2A_AGENTS[@]}"; do
                destroy_single_a2a_agent "$agent_name"
            done
            ;;
        [1-9])
            idx=$((A2A_OPTION-1))
            if [ $idx -ge 0 ] && [ $idx -lt ${#A2A_AGENTS[@]} ]; then
                agent_name="${A2A_AGENTS[$idx]}"
                destroy_single_a2a_agent "$agent_name"
            else
                log_error "Invalid option"
                cd ..
                return 1
            fi
            ;;
        *)
            log_error "Invalid option"
            cd ..
            return 1
            ;;
    esac

    cd ..
    log_info "AgentCore Runtime A2A agents destroyed!"
    echo ""
}

# Destroy single A2A agent
destroy_single_a2a_agent() {
    local agent_name=$1
    log_step "Destroying $agent_name A2A Agent..."
    echo ""

    if [ ! -d "$agent_name/cdk" ]; then
        log_warn "$agent_name/cdk directory not found"
        return
    fi

    cd "$agent_name/cdk"

    # Install dependencies if needed
    if [ ! -d "node_modules" ]; then
        log_step "Installing CDK dependencies..."
        npm install --silent
    fi

    # Destroy CDK stack
    log_step "Destroying CDK stack..."
    npx cdk destroy --force --all --region $AWS_REGION

    cd ../..

    log_info "$agent_name A2A agent destroyed!"
    echo ""
}

# Main function
main() {
    display_banner
    check_aws
    select_region
    display_menu

    read -p "Select option (0-5): " OPTION
    echo ""

    case $OPTION in
        1)
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            echo "  Option 1: AgentCore Runtime Only"
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            echo ""
            destroy_agentcore_runtime
            ;;
        2)
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            echo "  Option 2: Frontend + BFF Only"
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            echo ""
            destroy_frontend
            ;;
        3)
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            echo "  Option 3: MCP Servers Only"
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            echo ""
            destroy_mcp_servers
            ;;
        4)
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            echo "  Option 4: AgentCore Runtime A2A"
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            echo ""
            destroy_agentcore_a2a
            ;;
        5)
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            echo "  Option 5: Full Stack (Everything)"
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            echo ""
            log_warn "Destroying in reverse order: A2A → MCP Servers → Frontend → AgentCore"
            echo ""

            # Destroy A2A Agents first
            destroy_agentcore_a2a
            echo ""
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            echo ""

            # Destroy MCP Servers
            destroy_mcp_servers
            echo ""
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            echo ""

            # Then Frontend
            destroy_frontend
            echo ""
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            echo ""

            # Finally AgentCore Runtime
            destroy_agentcore_runtime
            ;;
        0)
            log_info "Exiting..."
            exit 0
            ;;
        *)
            log_error "Invalid option. Please select 0-5."
            exit 1
            ;;
    esac

    echo ""
    echo "========================================"
    log_info "Destruction Complete!"
    echo "========================================"
    echo ""
    echo "All selected resources have been removed from AWS."
    echo ""
}

# Run main
main
