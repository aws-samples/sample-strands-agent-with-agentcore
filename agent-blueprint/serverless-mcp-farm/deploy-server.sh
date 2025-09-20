#!/bin/bash

# Serverless MCP Farm - Improved Unified Deployment Script
# This script deploys multiple MCP servers with enhanced error handling and automation

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default configuration file
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/deploy-config.json"

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

# Function to collect API keys for MCP servers
collect_api_keys() {
    print_status "🔑 Collecting required API keys and configuration..."
    echo ""

    # Create .env file if it doesn't exist
    if [ ! -f ".env" ]; then
        touch .env
    fi

    # Source existing .env to check for values (check both locations)
    if [ -f "../.env" ]; then
        # Source from parent agent-blueprint directory first
        set -a
        source ../.env 2>/dev/null || true
        set +a
        echo "📋 Loaded environment variables from ../agent-blueprint/.env"
    fi

    # Source existing .env to check for values (local serverless-mcp-farm)
    if [ -f ".env" ]; then
        set -a
        source .env 2>/dev/null || true
        set +a
    fi

    # Tavily API Key for web search
    if [ -z "$TAVILY_API_KEY" ]; then
        echo "🔍 Tavily Web Search MCP requires an API key:"
        echo "   1. Sign up at: https://tavily.com/"
        echo "   2. Get your API key from the dashboard"
        echo ""
        read -p "Enter your Tavily API Key (or press Enter to skip tavily-web-search): " tavily_key
        if [ -n "$tavily_key" ]; then
            export TAVILY_API_KEY="$tavily_key"
            echo "TAVILY_API_KEY=$tavily_key" >> .env
            print_success "Tavily API key saved"
        else
            print_warning "Tavily Web Search will be skipped"
            # Update config to disable tavily
            jq '.deployment.servers."tavily-web-search".enabled = false' "$CONFIG_FILE" > "${CONFIG_FILE}.tmp" && mv "${CONFIG_FILE}.tmp" "$CONFIG_FILE"
        fi
        echo ""
    fi

    # Bedrock Knowledge Base ID
    if [ -z "$BEDROCK_KNOWLEDGE_BASE_ID" ]; then
        echo "🧠 Bedrock KB Retrieval MCP requires a Knowledge Base ID:"
        echo "   1. Go to Amazon Bedrock console"
        echo "   2. Create or select a Knowledge Base"
        echo "   3. Copy the Knowledge Base ID"
        echo ""
        read -p "Enter your Bedrock Knowledge Base ID (or press Enter to skip bedrock-kb-retrieval): " kb_id
        if [ -n "$kb_id" ]; then
            export BEDROCK_KNOWLEDGE_BASE_ID="$kb_id"
            echo "BEDROCK_KNOWLEDGE_BASE_ID=$kb_id" >> .env
            print_success "Bedrock Knowledge Base ID saved"
        else
            print_warning "Bedrock KB Retrieval will be skipped"
            # Update config to disable bedrock-kb-retrieval
            jq '.deployment.servers."bedrock-kb-retrieval".enabled = false' "$CONFIG_FILE" > "${CONFIG_FILE}.tmp" && mv "${CONFIG_FILE}.tmp" "$CONFIG_FILE"
        fi
        echo ""
    fi

    # Update config file with actual values
    if [ -n "$TAVILY_API_KEY" ]; then
        jq --arg key "$TAVILY_API_KEY" '.environment_variables."tavily-web-search".TAVILY_API_KEY = $key' "$CONFIG_FILE" > "${CONFIG_FILE}.tmp" && mv "${CONFIG_FILE}.tmp" "$CONFIG_FILE"
    fi

    if [ -n "$BEDROCK_KNOWLEDGE_BASE_ID" ]; then
        jq --arg kb_id "$BEDROCK_KNOWLEDGE_BASE_ID" '.environment_variables."bedrock-kb-retrieval".KNOWLEDGE_BASE_ID = $kb_id' "$CONFIG_FILE" > "${CONFIG_FILE}.tmp" && mv "${CONFIG_FILE}.tmp" "$CONFIG_FILE"
    fi

    print_success "API key collection completed!"
}

# Function to check and install dependencies
check_and_install_dependencies() {
    print_status "Checking system dependencies..."
    
    # Check if jq is installed
    if ! command -v jq &> /dev/null; then
        print_error "jq is required but not installed."
        print_status "Attempting to install jq..."
        
        if [[ "$OSTYPE" == "darwin"* ]]; then
            # macOS
            if command -v brew &> /dev/null; then
                brew install jq
            else
                print_error "Homebrew not found. Please install jq manually: brew install jq"
                exit 1
            fi
        elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
            # Linux
            if command -v apt-get &> /dev/null; then
                sudo apt-get update && sudo apt-get install -y jq
            elif command -v yum &> /dev/null; then
                sudo yum install -y jq
            else
                print_error "Package manager not found. Please install jq manually."
                exit 1
            fi
        else
            print_error "Unsupported OS. Please install jq manually."
            exit 1
        fi
    fi

    # Check if AWS CLI is installed
    if ! command -v aws &> /dev/null; then
        print_error "AWS CLI is required but not installed. Please install AWS CLI first."
        exit 1
    fi

    # Check Python and pip
    if ! command -v python3 &> /dev/null; then
        print_error "Python 3 is required but not installed."
        exit 1
    fi

    # Try different pip commands
    PIP_CMD=""
    if command -v pip3 &> /dev/null; then
        PIP_CMD="pip3"
    elif command -v pip &> /dev/null; then
        PIP_CMD="pip"
    elif python3 -m pip --version &> /dev/null; then
        PIP_CMD="python3 -m pip"
    else
        print_error "pip is required but not found. Installing pip..."
        python3 -m ensurepip --upgrade || {
            print_error "Failed to install pip. Please install pip manually."
            exit 1
        }
        PIP_CMD="python3 -m pip"
    fi

    export PIP_CMD
    print_success "Using pip command: $PIP_CMD"
}

# Function to setup Python virtual environment
setup_python_environment() {
    local server_dir=$1
    local venv_dir="$server_dir/venv"
    
    print_status "Setting up Python virtual environment for $(basename $server_dir)..."
    
    # Remove existing venv if it exists to ensure clean state
    if [ -d "$venv_dir" ]; then
        print_status "Removing existing virtual environment..."
        rm -rf "$venv_dir"
    fi
    
    # Create virtual environment
    python3 -m venv "$venv_dir"
    
    # Activate virtual environment
    source "$venv_dir/bin/activate"
    
    # Upgrade pip in virtual environment
    python -m pip install --upgrade pip
    
    print_success "Virtual environment ready at $venv_dir"
}

# Function to load configuration
load_config() {
    if [ ! -f "$CONFIG_FILE" ]; then
        print_error "Configuration file $CONFIG_FILE not found!"
        exit 1
    fi
    
    print_status "Loading configuration from $CONFIG_FILE"
    
    # Validate JSON
    if ! jq empty "$CONFIG_FILE" 2>/dev/null; then
        print_error "Invalid JSON in configuration file!"
        exit 1
    fi
}

# Function to get enabled servers
get_enabled_servers() {
    jq -r '.deployment.servers | to_entries[] | select(.value.enabled == true) | .key' "$CONFIG_FILE"
}

# Function to get server configuration
get_server_config() {
    local server_name=$1
    local key=$2
    jq -r ".deployment.servers[\"$server_name\"].$key" "$CONFIG_FILE"
}

# Function to get deployment region
get_region() {
    jq -r '.deployment.region' "$CONFIG_FILE"
}

# Function to get deployment stage
get_stage() {
    jq -r '.deployment.stage' "$CONFIG_FILE"
}

# Function to build Lambda deployment package with virtual environment
build_lambda_package() {
    local server_dir=$1
    local server_name=$(basename "$server_dir")
    
    print_status "Building Lambda deployment package for $server_name..."
    
    # Special handling for financial-market server (uses custom Layer)
    if [ "$server_name" = "financial-market" ]; then
        print_status "Using custom deployment script for financial-market server..."
        cd "$server_dir/infrastructure"
        if [ -f "./deploy.sh" ]; then
            # Pass region and stage to custom deploy script
            AWS_DEFAULT_REGION="$region" DEPLOYMENT_STAGE="$stage" ./deploy.sh
            return $?
        else
            print_error "Custom deploy.sh not found for financial-market"
            return 1
        fi
    fi
    
    # Standard deployment for other servers
    # Setup virtual environment
    setup_python_environment "$server_dir"
    
    # Activate virtual environment
    source "$server_dir/venv/bin/activate"
    
    # Create temp directory for packaging
    local temp_dir="$server_dir/infrastructure/temp"
    mkdir -p "$temp_dir"
    cd "$temp_dir"
    
    # Copy source files
    cp "$server_dir/src"/*.py .
    
    # Install requirements in the temp directory
    if [ -f "$server_dir/src/requirements.txt" ]; then
        print_status "Installing Python dependencies..."
        $PIP_CMD install -r "$server_dir/src/requirements.txt" -t . \
            --platform linux \
            --python-version 3.13 \
            --only-binary=:all: \
            --upgrade
    else
        print_warning "No requirements.txt found for $server_name"
    fi
    
    # Clean up unnecessary files
    find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
    find . -name "*.pyc" -delete
    find . -name "*.pyo" -delete
    find . -name "*.dist-info" -type d -exec rm -rf {} + 2>/dev/null || true
    find . -name "*.egg-info" -type d -exec rm -rf {} + 2>/dev/null || true
    
    # Create deployment package
    zip -r ../lambda-deployment.zip . -x "*.pyc" "*/__pycache__/*" "*.pyo" "*.dist-info/*" "*.egg-info/*"
    
    # Clean up temp directory
    cd ..
    rm -rf temp
    
    # Check package size
    local package_size=$(wc -c < lambda-deployment.zip)
    local package_size_mb=$((package_size / 1024 / 1024))
    
    print_status "Package size: ${package_size_mb}MB"
    
    if [ $package_size_mb -gt 50 ]; then
        print_error "Package size exceeds 50MB. Please reduce package size."
        rm lambda-deployment.zip
        return 1
    fi
    
    if [ $package_size_mb -eq 0 ]; then
        print_error "Package size is 0MB. Dependencies may not have been installed correctly."
        return 1
    fi
    
    # Deactivate virtual environment
    deactivate
    
    print_success "Lambda package built successfully (${package_size_mb}MB)"
    return 0
}

# Function to deploy a single MCP server with improved error handling
deploy_server() {
    local server_name=$1
    local server_dir="$SCRIPT_DIR/$server_name"
    
    print_status "Deploying MCP server: $server_name"
    
    if [ ! -d "$server_dir" ]; then
        print_error "Server directory not found: $server_dir"
        return 1
    fi
    
    if [ ! -d "$server_dir/infrastructure" ]; then
        print_error "Infrastructure directory not found: $server_dir/infrastructure"
        return 1
    fi
    
    if [ ! -f "$server_dir/infrastructure/cloudformation.yaml" ]; then
        print_error "CloudFormation template not found: $server_dir/infrastructure/cloudformation.yaml"
        return 1
    fi
    
    # Get server configuration
    local stack_name=$(get_server_config "$server_name" "stack_name")
    local description=$(get_server_config "$server_name" "description")
    local region=$(get_region)
    local stage=$(get_stage)
    
    print_status "  Stack Name: $stack_name"
    print_status "  Description: $description"
    print_status "  Region: $region"
    print_status "  Stage: $stage"
    
    # Change to server infrastructure directory
    cd "$server_dir/infrastructure"
    
    # Build Lambda package with virtual environment
    if ! build_lambda_package "$server_dir"; then
        print_error "Failed to build Lambda package for $server_name"
        return 1
    fi
    
    # Check existing stack status
    print_status "Checking existing stack status..."
    local stack_status=$(aws cloudformation describe-stacks \
        --stack-name "$stack_name" \
        --region "$region" \
        --query 'Stacks[0].StackStatus' \
        --output text 2>/dev/null || echo "STACK_NOT_EXISTS")
    
    if [[ "$stack_status" == "ROLLBACK_IN_PROGRESS" || "$stack_status" == "ROLLBACK_COMPLETE" || "$stack_status" == "CREATE_FAILED" ]]; then
        print_warning "Stack is in $stack_status state. Deleting existing stack..."
        aws cloudformation delete-stack --stack-name "$stack_name" --region "$region"
        print_status "Waiting for stack deletion to complete..."
        aws cloudformation wait stack-delete-complete --stack-name "$stack_name" --region "$region"
    fi
    
    # Prepare CloudFormation parameters
    local cf_params="DeploymentStage=$stage"
    local env_vars=$(jq -r ".environment_variables[\"$server_name\"] // {}" "$CONFIG_FILE")
    
    if [ "$env_vars" != "null" ] && [ "$env_vars" != "{}" ]; then
        print_status "Setting environment variables as CloudFormation parameters..."
        
        # Convert environment variables to CloudFormation parameters based on server type
        case "$server_name" in
            "tavily-web-search")
                local log_level=$(echo "$env_vars" | jq -r '.LOG_LEVEL // "INFO"')
                local tavily_key=$(echo "$env_vars" | jq -r '.TAVILY_API_KEY // "your-tavily-api-key-here"')
                cf_params="$cf_params LogLevel=$log_level TavilyApiKey=$tavily_key"
                ;;
            "bedrock-kb-retrieval")
                local log_level=$(echo "$env_vars" | jq -r '.LOG_LEVEL // "INFO"')
                local bedrock_region=$(echo "$env_vars" | jq -r '.BEDROCK_REGION // "us-west-2"')
                local kb_id=$(echo "$env_vars" | jq -r '.KNOWLEDGE_BASE_ID // "your-knowledge-base-id-here"')
                cf_params="$cf_params LogLevel=$log_level BedrockRegion=$bedrock_region KnowledgeBaseId=$kb_id AllowedKBIds=$kb_id"
                ;;
            *)
                local log_level=$(echo "$env_vars" | jq -r '.LOG_LEVEL // "INFO"')
                cf_params="$cf_params LogLevel=$log_level"
                ;;
        esac
        
        print_status "CloudFormation parameters: $cf_params"
    fi
    
    # Deploy CloudFormation stack
    print_status "Deploying CloudFormation stack..."
    aws cloudformation deploy \
        --template-file cloudformation.yaml \
        --stack-name "$stack_name" \
        --parameter-overrides $cf_params \
        --capabilities CAPABILITY_NAMED_IAM \
        --region "$region"
    
    # Get deployment outputs
    print_status "Getting deployment outputs..."
    local lambda_function_name=$(aws cloudformation describe-stacks \
        --stack-name "$stack_name" \
        --query 'Stacks[0].Outputs[?OutputKey==`LambdaFunctionName`].OutputValue' \
        --output text \
        --region "$region" 2>/dev/null)
    
    local api_url=$(aws cloudformation describe-stacks \
        --stack-name "$stack_name" \
        --query 'Stacks[0].Outputs[?OutputKey==`ApiGatewayUrl`].OutputValue' \
        --output text \
        --region "$region" 2>/dev/null)
    
    # Update Lambda function code
    if [ -n "$lambda_function_name" ] && [ "$lambda_function_name" != "None" ]; then
        print_status "Updating Lambda function code..."
        aws lambda update-function-code \
            --function-name "$lambda_function_name" \
            --zip-file fileb://lambda-deployment.zip \
            --region "$region"
    else
        print_warning "Lambda function name not found in stack outputs"
    fi
    
    # Store API URL for later use
    if [ -n "$api_url" ] && [ "$api_url" != "None" ]; then
        echo "$server_name|$api_url" >> "$SCRIPT_DIR/deployed-servers.txt"
        print_success "API Gateway URL: $api_url"
    fi
    
    # Clean up deployment package
    rm -f lambda-deployment.zip
    
    print_success "Successfully deployed $server_name"
    return 0
}

# Function to run tests for deployed servers
run_tests() {
    local testing_enabled=$(jq -r '.testing.enabled' "$CONFIG_FILE")
    
    if [ "$testing_enabled" != "true" ]; then
        print_status "Testing is disabled in configuration"
        return 0
    fi
    
    print_status "Running tests for deployed servers..."
    
    if [ ! -f "$SCRIPT_DIR/deployed-servers.txt" ]; then
        print_warning "No deployed servers found for testing"
        return 0
    fi
    
    while IFS='|' read -r server_name api_url; do
        print_status "Testing $server_name at $api_url"
        
        # Test health check
        print_status "  Testing health check..."
        if curl -s -f "$api_url" > /dev/null; then
            print_success "  Health check passed"
        else
            print_warning "  Health check failed"
        fi
        
        # Test MCP tools/list endpoint
        print_status "  Testing MCP tools/list..."
        local response=$(curl -s -X POST "$api_url/mcp" \
            -H "Content-Type: application/json" \
            -d '{
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/list"
            }' || echo "")
        
        if echo "$response" | jq -e '.result.tools' > /dev/null 2>&1; then
            local tool_count=$(echo "$response" | jq '.result.tools | length')
            print_success "  MCP tools/list passed ($tool_count tools available)"
        else
            print_warning "  MCP tools/list failed"
        fi
        
    done < "$SCRIPT_DIR/deployed-servers.txt"
}

# Function to generate deployment summary
generate_summary() {
    print_status "Generating deployment summary..."
    
    echo ""
    echo "=========================================="
    echo "  MCP Farm Deployment Summary"
    echo "=========================================="
    echo ""
    
    if [ -f "$SCRIPT_DIR/deployed-servers.txt" ]; then
        echo "Deployed Servers:"
        echo ""
        while IFS='|' read -r server_name api_url; do
            local description=$(get_server_config "$server_name" "description")
            echo "  • $server_name"
            echo "    Description: $description"
            echo "    API URL: $api_url"
            echo "    MCP Endpoint: $api_url/mcp"
            echo ""
        done < "$SCRIPT_DIR/deployed-servers.txt"
        
        echo "Configuration for Cline MCP:"
        echo ""
        while IFS='|' read -r server_name api_url; do
            echo "  $api_url/mcp"
        done < "$SCRIPT_DIR/deployed-servers.txt"
        echo ""
    else
        echo "No servers were successfully deployed."
    fi
    
    echo "=========================================="
}

# Function to show usage
show_usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -c, --config FILE    Use custom configuration file (default: deploy-config.json)"
    echo "  -s, --server NAME    Deploy only specific server"
    echo "  -t, --test-only      Run tests only (skip deployment)"
    echo "  -h, --help           Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0                           # Deploy all enabled servers" 
    echo "  $0 -s aws-documentation      # Deploy only aws-documentation server"
    echo "  $0 -s financial-market       # Deploy only financial-market server"
    echo "  $0 -c custom-config.json     # Use custom configuration file"
    echo "  $0 -t                        # Run tests only"
}

# Main function
main() {
    local specific_server=""
    local test_only=false
    
    # Parse command line arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            -c|--config)
                CONFIG_FILE="$2"
                shift 2
                ;;
            -s|--server)
                specific_server="$2"
                shift 2
                ;;
            -t|--test-only)
                test_only=true
                shift
                ;;
            -h|--help)
                show_usage
                exit 0
                ;;
            *)
                print_error "Unknown option: $1"
                show_usage
                exit 1
                ;;
        esac
    done
    
    # Change to script directory
    cd "$SCRIPT_DIR"
    
    print_status "Starting MCP Farm deployment..."
    print_status "Script directory: $SCRIPT_DIR"
    
    # Check dependencies
    check_and_install_dependencies

    # Load configuration
    load_config

    # Collect API keys (only when deploying, not testing, and not from master script)
    if [ "$test_only" != true ] && [ "$SKIP_API_KEY_COLLECTION" != "true" ]; then
        collect_api_keys
    fi

    if [ "$test_only" = true ]; then
        print_status "Running tests only..."
        run_tests
        exit 0
    fi
    
    # Clean up previous deployment tracking (only when deploying)
    rm -f deployed-servers.txt
    
    # Get servers to deploy
    local servers_to_deploy
    if [ -n "$specific_server" ]; then
        # Check if specific server exists and is enabled
        local server_enabled=$(jq -r ".deployment.servers[\"$specific_server\"].enabled" "$CONFIG_FILE")
        if [ "$server_enabled" = "null" ]; then
            print_error "Server '$specific_server' not found in configuration"
            exit 1
        elif [ "$server_enabled" != "true" ]; then
            print_warning "Server '$specific_server' is disabled in configuration"
            print_status "Deploying anyway as specifically requested..."
        fi
        servers_to_deploy="$specific_server"
    else
        servers_to_deploy=$(get_enabled_servers)
    fi
    
    if [ -z "$servers_to_deploy" ]; then
        print_warning "No servers enabled for deployment"
        exit 0
    fi
    
    print_status "Servers to deploy: $(echo $servers_to_deploy | tr '\n' ' ')"
    
    # Deploy each server
    local failed_deployments=0
    local successful_deployments=0
    
    for server in $servers_to_deploy; do
        echo ""
        echo "----------------------------------------"
        if deploy_server "$server"; then
            ((successful_deployments++))
        else
            ((failed_deployments++))
        fi
        echo "----------------------------------------"
    done
    
    echo ""
    print_status "Deployment completed!"
    print_status "Successful: $successful_deployments"
    if [ $failed_deployments -gt 0 ]; then
        print_warning "Failed: $failed_deployments"
    fi
    
    # Run tests if enabled
    if [ $successful_deployments -gt 0 ]; then
        echo ""
        run_tests
    fi
    
    # Generate summary
    echo ""
    generate_summary
    
    # Exit with error if any deployments failed
    if [ $failed_deployments -gt 0 ]; then
        exit 1
    fi
}

# Run main function with all arguments
main "$@"