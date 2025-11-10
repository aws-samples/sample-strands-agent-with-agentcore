#!/bin/bash

# Sample Strands Agent Chatbot - Complete Deployment Script
# Run this script from the agent-blueprint directory
# This script deploys all components in the correct dependency order

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to check prerequisites
check_prerequisites() {
    print_status "🔍 Checking prerequisites..."

    # Check Docker
    if ! command -v docker &> /dev/null || ! docker info > /dev/null 2>&1; then
        print_error "Docker is not running. Please start Docker and try again."
        exit 1
    fi

    # Check AWS CLI
    if ! command -v aws &> /dev/null; then
        print_error "AWS CLI is not installed. Please install AWS CLI and try again."
        exit 1
    fi

    # Check AWS credentials
    if ! aws sts get-caller-identity > /dev/null 2>&1; then
        print_error "AWS CLI is not configured. Please run 'aws configure' first."
        exit 1
    fi

    # Check Node.js for TypeScript CDK
    if ! command -v node &> /dev/null; then
        print_error "Node.js is not installed. Please install Node.js 18+ and try again."
        exit 1
    fi

    # Check Python for Python CDK
    if ! command -v python3 &> /dev/null; then
        print_error "Python 3 is not installed. Please install Python 3.8+ and try again."
        exit 1
    fi

    print_success "All prerequisites satisfied!"
}

# Function to setup shared virtual environment
setup_shared_venv() {
    print_status "Setting up shared Python virtual environment..."

    # Create shared venv in agent-blueprint if it doesn't exist
    if [ ! -d "venv" ]; then
        python3 -m venv venv
    fi

    source venv/bin/activate

    # Install/upgrade requirements if needed
    if [ -f "requirements.txt" ]; then
        pip install --upgrade pip
        pip install -r requirements.txt
        print_success "Shared virtual environment ready"
    else
        print_warning "No requirements.txt found in agent-blueprint directory"
    fi
}

# Function to activate shared environment
activate_shared_venv() {
    if [ -f "venv/bin/activate" ]; then
        source venv/bin/activate
    else
        print_error "Shared virtual environment not found. Run setup first."
        exit 1
    fi
}

# Function to check if stack exists
stack_exists() {
    local stack_name="$1"
    aws cloudformation describe-stacks --stack-name "$stack_name" --region ${AWS_REGION:-us-west-2} &>/dev/null
}

# Function to deploy with error handling
deploy_component() {
    local component_name="$1"
    local deploy_script="$2"
    local cdk_dir="$3"
    local use_python_cdk="$4"
    local stack_name="$5"  # Optional: for checking if already deployed

    # Check if already deployed (if stack name provided)
    if [ -n "$stack_name" ] && stack_exists "$stack_name"; then
        print_warning "$component_name ($stack_name) already deployed. Skipping."
        return 0
    fi

    print_status "🚀 Deploying $component_name..."

    if [ -f "$deploy_script" ]; then
        # Use existing deploy script
        local script_dir="$(dirname "$deploy_script")"
        local script_name="$(basename "$deploy_script")"

        # Store current directory
        local original_dir="$(pwd)"

        cd "$script_dir"
        chmod +x "$script_name"

        # Export environment variables for the script
        export ENABLE_COGNITO
        export ALLOWED_IP_RANGES
        export AWS_REGION
        export AWS_DEFAULT_REGION
        export IMPORT_EXISTING_LOG_GROUP
        export TAVILY_API_KEY
        export BEDROCK_KNOWLEDGE_BASE_ID
        export NOVA_ACT_API_KEY

        if ! "./$script_name"; then
            print_error "Failed to deploy $component_name using script"
            cd "$original_dir"
            return 1
        fi

        cd "$original_dir"
    elif [ -n "$cdk_dir" ] && [ -d "$cdk_dir" ]; then
        # Deploy using CDK
        if [ "$use_python_cdk" = "true" ]; then
            activate_shared_venv
            cd "$cdk_dir"
        else
            cd "$cdk_dir"
            npm install
        fi

        # Bootstrap CDK if needed
        npx cdk bootstrap || print_warning "CDK bootstrap failed or already done"

        # Deploy
        if ! npx cdk deploy --all --require-approval never; then
            print_error "Failed to deploy $component_name using CDK"
            return 1
        fi

        cd - > /dev/null
    else
        print_error "No deployment method found for $component_name"
        return 1
    fi

    print_success "✅ $component_name deployed successfully!"
}

# Function to collect API keys for all MCP servers
collect_api_keys() {
    print_status "🔑 Collecting API keys and configuration for MCP servers..."
    echo ""

    # Create .env file if it doesn't exist
    if [ ! -f ".env" ]; then
        touch .env
    fi

    # Source existing .env to check for values
    if [ -f ".env" ]; then
        set -a
        source .env 2>/dev/null || true
        set +a
    fi

    print_warning "Some MCP servers require API keys for full functionality:"
    echo ""

    # Tavily Web Search API Key
    if [ -z "$TAVILY_API_KEY" ]; then
        echo "🔍 Tavily Web Search MCP (Web search capabilities):"
        echo "   1. Sign up at: https://tavily.com/"
        echo "   2. Get your API key from the dashboard"
        echo ""
        read -p "Enter your Tavily API Key (or press Enter to skip): " tavily_key
        if [ -n "$tavily_key" ]; then
            export TAVILY_API_KEY="$tavily_key"
            echo "TAVILY_API_KEY=$tavily_key" >> .env
            print_success "Tavily API key saved"
        else
            print_warning "Tavily Web Search MCP will be disabled"
        fi
        echo ""
    else
        print_success "Tavily API Key already configured"
    fi

    # Bedrock Knowledge Base ID
    if [ -z "$BEDROCK_KNOWLEDGE_BASE_ID" ]; then
        echo "🧠 Bedrock Knowledge Base MCP (Custom knowledge retrieval):"
        echo "   1. Go to Amazon Bedrock console"
        echo "   2. Create or select a Knowledge Base"
        echo "   3. Copy the Knowledge Base ID"
        echo ""
        read -p "Enter your Bedrock Knowledge Base ID (or press Enter to skip): " kb_id
        if [ -n "$kb_id" ]; then
            export BEDROCK_KNOWLEDGE_BASE_ID="$kb_id"
            echo "BEDROCK_KNOWLEDGE_BASE_ID=$kb_id" >> .env
            print_success "Bedrock Knowledge Base ID saved"
        else
            print_warning "Bedrock Knowledge Base MCP will be disabled"
        fi
        echo ""
    else
        print_success "Bedrock Knowledge Base ID already configured"
    fi

    # Nova Act API Key
    if [ -z "$NOVA_ACT_API_KEY" ]; then
        echo "🤖 Nova Act MCP (Browser automation):"
        echo "   1. Sign up at: https://www.browserbase.com/"
        echo "   2. Get your API key from the dashboard"
        echo "   3. Enables web browsing and automation features"
        echo ""
        read -p "Enter your Nova Act API Key (or press Enter to skip): " nova_key
        if [ -n "$nova_key" ]; then
            export NOVA_ACT_API_KEY="$nova_key"
            echo "NOVA_ACT_API_KEY=$nova_key" >> .env
            print_success "Nova Act API key saved"
        else
            print_warning "Nova Act MCP will be disabled"
        fi
        echo ""
    else
        print_success "Nova Act API Key already configured"
    fi

    # Set flag to skip individual API key collection
    export SKIP_API_KEY_COLLECTION="true"

    print_success "API key collection completed!"
    echo ""
}

# Function to collect IP ranges for access control
collect_ip_ranges() {
    # Skip if Cognito is enabled or IP ranges already set
    if [ "$ENABLE_COGNITO" = "true" ] || [ -n "$ALLOWED_IP_RANGES" ]; then
        return 0
    fi

    print_status "🔒 Configuring IP-based access control..."
    echo ""
    print_warning "Cognito authentication is disabled. The application will use IP-based access control."
    echo "Please specify the IP ranges that should have access to the application."
    echo ""
    echo "Examples:"
    echo "  - Single IP: 203.0.113.45/32"
    echo "  - Office network: 203.0.113.0/24"
    echo "  - Home network: 192.168.1.0/24"
    echo "  - Multiple ranges: separate with commas"
    echo ""

    read -p "Enter allowed IP ranges (CIDR notation, comma-separated) [0.0.0.0/0 for all IPs]: " ip_input

    # Use default if empty
    if [ -z "$ip_input" ]; then
        export ALLOWED_IP_RANGES="0.0.0.0/0"
        print_warning "Using 0.0.0.0/0 allows access from any IP address!"
    else
        export ALLOWED_IP_RANGES="$ip_input"
        print_success "IP ranges configured: $ALLOWED_IP_RANGES"
    fi

    echo ""
}

# Function to configure MCP endpoints
configure_mcp_endpoints() {
    print_status "🔗 Configuring MCP endpoints..."

    # Get region
    local region=${AWS_REGION:-us-west-2}

    # Collect serverless MCP endpoints
    print_status "Collecting serverless MCP endpoints..."

    # Get API Gateway endpoints for serverless MCPs
    local endpoints=""
    
    # Function to get stack name for server (compatible with older bash)
    get_stack_name() {
        case "$1" in
            "aws-documentation") echo "mcp-aws-documentation" ;;
            "aws-pricing") echo "mcp-aws-pricing" ;;
            "bedrock-kb-retrieval") echo "mcp-bedrock-kb-retrieval" ;;
            "tavily-web-search") echo "mcp-tavily-web-search" ;;
            "financial-market") echo "mcp-financial-analysis-server" ;;
            "recruiter-insights") echo "mcp-recruiter-insights-server" ;;
            *) echo "$1" ;;
        esac
    }

    for server in aws-documentation aws-pricing bedrock-kb-retrieval tavily-web-search financial-market recruiter-insights; do
        local stack_name=$(get_stack_name "$server")
        local endpoint=$(aws cloudformation describe-stacks \
            --stack-name "$stack_name" \
            --region $region \
            --query 'Stacks[0].Outputs[?OutputKey==`McpEndpoint`].OutputValue' \
            --output text 2>/dev/null || echo "")

        if [ -n "$endpoint" ]; then
            print_status "Found $server endpoint: $endpoint"
            endpoints="$endpoints$server=$endpoint\n"
        fi
    done

    # Get Fargate MCP endpoints (internal ALB)
    local mcp_alb_dns=$(aws cloudformation describe-stacks \
        --stack-name "McpFarmAlbStack" \
        --region $region \
        --query 'Stacks[0].Outputs[?OutputKey==`McpFarmAlbDnsName`].OutputValue' \
        --output text 2>/dev/null || echo "")

    if [ -n "$mcp_alb_dns" ]; then
        print_status "Found MCP Farm ALB: $mcp_alb_dns"

        # Check if Python MCP is deployed
        if aws cloudformation describe-stacks --stack-name "python-mcp-fargate" --region $region &>/dev/null; then
            endpoints="${endpoints}python-mcp=http://${mcp_alb_dns}/python\n"
        fi

        # Check if Nova Act MCP is deployed
        if aws cloudformation describe-stacks --stack-name "nova-act-mcp-fargate" --region $region &>/dev/null; then
            endpoints="${endpoints}nova-act-mcp=http://${mcp_alb_dns}/nova\n"
        fi
    fi

    # Get AgentCore MCP endpoints
    print_status "Collecting AgentCore MCP endpoints..."
    local agentcore_endpoints=$(aws ssm get-parameters-by-path \
        --path "/mcp/endpoints/agentcore" \
        --region $region \
        --query 'Parameters[*].[Name,Value]' \
        --output text 2>/dev/null || echo "")

    if [ -n "$agentcore_endpoints" ]; then
        while IFS=$'\t' read -r name value; do
            local server_name=$(basename "$name")
            print_status "Found AgentCore MCP: $server_name at $value"
            # AgentCore endpoints are already stored in SSM by their individual deployment scripts
        done <<< "$agentcore_endpoints"
    fi

    # Store endpoints in Parameter Store for the chatbot to discover
    if [ -n "$endpoints" ]; then
        print_status "Storing MCP endpoints in Parameter Store..."
        echo -e "$endpoints" | while IFS='=' read -r name endpoint; do
            if [ -n "$name" ] && [ -n "$endpoint" ]; then
                # Determine if this is a serverless or stateful MCP
                case "$name" in
                    "python-mcp"|"nova-act-mcp")
                        # Stateful MCPs (Fargate-based)
                        aws ssm put-parameter \
                            --name "/mcp/endpoints/stateful/$name" \
                            --value "$endpoint" \
                            --type "String" \
                            --overwrite \
                            --region $region 2>/dev/null || print_warning "Failed to store endpoint for $name"
                        ;;
                    *)
                        # Serverless MCPs (Lambda-based)
                        aws ssm put-parameter \
                            --name "/mcp/endpoints/serverless/$name" \
                            --value "$endpoint" \
                            --type "String" \
                            --overwrite \
                            --region $region 2>/dev/null || print_warning "Failed to store endpoint for $name"
                        ;;
                esac
            fi
        done
        print_success "MCP endpoints configured!"
    fi
}

# Main deployment process
main() {
    print_status "🚀 Starting complete deployment of Sample Strands Agent Chatbot..."

    # Ensure we're in the agent-blueprint directory
    if [[ ! -d "chatbot-deployment" ]] || [[ ! -d "fargate-mcp-farm" ]] || [[ ! -d "serverless-mcp-farm" ]]; then
        print_error "This script must be run from the agent-blueprint directory!"
        print_error "Current directory: $(pwd)"
        print_error "Please cd to agent-blueprint and run the script again."
        exit 1
    fi

    # Check prerequisites
    check_prerequisites

    # Load AWS region from .env file if available
    if [ -f ".env" ]; then
        set -a
        source .env 2>/dev/null || true
        set +a
        print_status "Loaded environment variables from .env file"
    fi

    # Set AWS region - use from .env or default
    export AWS_REGION=${AWS_REGION:-${NEXT_PUBLIC_AWS_REGION:-us-west-2}}
    export AWS_DEFAULT_REGION=$AWS_REGION

    # Enable Cognito by default
    export ENABLE_COGNITO=${ENABLE_COGNITO:-true}

    # Export API keys for MCP servers (loaded from .env)
    export TAVILY_API_KEY=${TAVILY_API_KEY}
    export BEDROCK_KNOWLEDGE_BASE_ID=${BEDROCK_KNOWLEDGE_BASE_ID}
    export NOVA_ACT_API_KEY=${NOVA_ACT_API_KEY}

    # Check if AgentCore log group already exists
    if aws logs describe-log-groups --log-group-name-prefix "agents/strands-agent-logs" --region $AWS_REGION --query 'logGroups[?logGroupName==`agents/strands-agent-logs`]' --output text 2>/dev/null | grep -q "agents/strands-agent-logs"; then
        print_status "📋 Found existing log group: agents/strands-agent-logs"
        export IMPORT_EXISTING_LOG_GROUP=true
    else
        print_status "📋 Log group does not exist, will create new one"
        export IMPORT_EXISTING_LOG_GROUP=false
    fi

    # Setup shared virtual environment
    setup_shared_venv

    # Collect API keys for all MCP servers
    collect_api_keys

    # Collect IP ranges for CIDR-based access control (if not using Cognito)
    collect_ip_ranges

    print_status "🌍 Deployment region: $AWS_REGION"

    # Get AWS account info
    ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
    print_status "🏗️  Deploying to AWS Account: $ACCOUNT_ID"

    echo ""
    print_warning "This deployment will create the following components:"
    echo "  ✅ Web Application (Chatbot) with Cognito Authentication"
    echo "  ✅ Serverless MCP Servers (Lambda-based tools)"
    echo "  ⏭️  Shared Infrastructure (DISABLED - Stateful MCP disabled)"
    echo "  ⏭️  Fargate MCP Servers (DISABLED - Stateful MCP disabled)"
    echo "  ✅ VPC, security groups, and networking"
    echo ""

    print_status "Starting deployment in dependency order..."

    # Step 1: Deploy Web Application (creates base VPC)
    # Always redeploy to ensure Docker images and configurations are up-to-date
    print_status "🚀 Step 1: Deploying Web Application (Chatbot)..."
    if ! deploy_component "Web Application" \
        "chatbot-deployment/infrastructure/scripts/deploy.sh" \
        "chatbot-deployment/infrastructure" \
        "false" \
        ""; then  # Empty stack name to force redeployment
        print_error "Failed to deploy Web Application. Aborting deployment."
        exit 1
    fi

    # Wait for VPC exports to be available (only if just deployed)
    if ! stack_exists "ChatbotStack"; then
        print_status "⏳ Waiting for VPC exports to be available..."
        sleep 30
    fi

    # Step 2: Deploy Serverless MCP Servers (independent of VPC)
    print_status "🚀 Step 2: Deploying Serverless MCP Servers..."
    if ! deploy_component "Serverless MCP Servers" \
        "serverless-mcp-farm/deploy-server.sh" \
        "" \
        "" \
        ""; then
        print_warning "Some serverless MCP servers failed to deploy, continuing..."
    fi

    # Step 3: Deploy Shared Infrastructure (uses VPC from Step 1)
    # DISABLED: Stateful MCP servers (Fargate) are disabled
    # print_status "🚀 Step 3: Deploying Shared Infrastructure..."
    # if ! deploy_component "Shared Infrastructure" \
    #     "fargate-mcp-farm/shared-infrastructure/deploy.sh" \
    #     "fargate-mcp-farm/shared-infrastructure/cdk" \
    #     "true" \
    #     "McpFarmAlbStack"; then
    #     print_warning "Shared Infrastructure failed to deploy. Fargate MCP servers will be skipped."
    #     SKIP_FARGATE=true
    # fi
    print_status "⏭️  Step 3: Skipping Shared Infrastructure (Stateful MCP disabled)"
    SKIP_FARGATE=true

    # Step 4: Deploy Fargate MCP Servers (depend on shared ALB and VPC)
    # DISABLED: Stateful MCP servers (Fargate) are disabled
    # if [ "$SKIP_FARGATE" != "true" ]; then
    #     print_status "🚀 Step 4: Deploying Fargate MCP Servers..."
    #
    #     # Deploy Python MCP Server
    #     if ! deploy_component "Python MCP Server" \
    #         "fargate-mcp-farm/python-mcp/deploy.sh" \
    #         "fargate-mcp-farm/python-mcp/cdk" \
    #         "true" \
    #         "python-mcp-fargate"; then
    #         print_warning "Python MCP Server failed to deploy, continuing..."
    #     fi
    #
    #     # Deploy Nova Act MCP Server
    #     if ! deploy_component "Nova Act MCP Server" \
    #         "fargate-mcp-farm/nova-act-mcp/deploy.sh" \
    #         "fargate-mcp-farm/nova-act-mcp/cdk" \
    #         "true" \
    #         "nova-act-mcp-fargate"; then
    #         print_warning "Nova Act MCP Server failed to deploy, continuing..."
    #     fi
    # else
    #     print_warning "Skipping Fargate MCP servers due to shared infrastructure failure"
    # fi
    print_status "⏭️  Step 4: Skipping Fargate MCP Servers (Stateful MCP disabled)"

    # Step 4.5: Deploy AgentCore MCP Servers
    print_status "🚀 Step 4.5: Deploying AgentCore MCP Servers..."
    if ! deploy_component "AgentCore MCP Servers" \
        "agentcore-mcp-farm/deploy-all.sh" \
        "" \
        "" \
        ""; then
        print_warning "Some AgentCore MCP servers failed to deploy, continuing..."
    fi

    # Step 5: Configure MCP endpoints
    configure_mcp_endpoints

    # Step 6: Display deployment results
    print_status "📋 Deployment Summary"
    echo "======================================"

    # Get Chatbot URL
    local chatbot_url=$(aws cloudformation describe-stacks \
        --stack-name "ChatbotStack" \
        --region $AWS_REGION \
        --query 'Stacks[0].Outputs[?OutputKey==`ApplicationUrl`].OutputValue' \
        --output text 2>/dev/null || echo "Not available")

    # Get Cognito Login URL
    local cognito_url=$(aws cloudformation describe-stacks \
        --stack-name "ChatbotStack" \
        --region $AWS_REGION \
        --query 'Stacks[0].Outputs[?OutputKey==`CognitoLoginUrl`].OutputValue' \
        --output text 2>/dev/null || echo "Not available")

    print_success "✅ Web Application: $chatbot_url"
    print_success "🔐 Cognito Login: $cognito_url"

    # List deployed MCP servers
    print_status "🔧 Deployed MCP Servers:"

    # Check serverless MCPs
    for server in aws-documentation aws-pricing bedrock-kb-retrieval tavily-web-search financial-market recruiter-insights; do
        local stack_name=$(get_stack_name "$server")
        if aws cloudformation describe-stacks --stack-name "$stack_name" --region $AWS_REGION &>/dev/null; then
            echo "  ✅ $server (Serverless)"
        fi
    done

    # Check Fargate MCPs
    if aws cloudformation describe-stacks --stack-name "python-mcp-fargate" --region $AWS_REGION &>/dev/null; then
        echo "  ✅ python-mcp (Fargate)"
    fi

    if aws cloudformation describe-stacks --stack-name "nova-act-mcp-fargate" --region $AWS_REGION &>/dev/null; then
        echo "  ✅ nova-act-mcp (Fargate)"
    fi

    echo ""
    print_success "🎉 Deployment completed successfully!"
    echo ""
    print_status "📝 Next Steps:"
    echo "1. Visit the application URL above"
    echo "2. Sign up for a new account using your email"
    echo "3. Verify your email address"
    echo "4. Log in and start chatting with the agent!"
    echo ""
    print_status "🔐 Security Features:"
    if [ "$ENABLE_COGNITO" = "true" ]; then
        echo "• All endpoints protected with Cognito authentication"
        echo "• Strong password policy enforced"
        echo "• Users must verify email addresses"
    else
        echo "• IP-based access control configured"
        echo "• Allowed IP ranges: ${ALLOWED_IP_RANGES:-'Not specified'}"
        echo "• Consider enabling Cognito for enhanced security"
    fi
    echo "• MCP servers only accessible from within VPC"
    echo "• Compliant with AWS security requirements"
}

# Run main function
main "$@"