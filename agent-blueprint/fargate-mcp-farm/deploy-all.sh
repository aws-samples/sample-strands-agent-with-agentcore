#!/bin/bash

# Fargate MCP Farm - Unified Deployment Script
# This script deploys all enabled MCP servers to AWS Fargate

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

# Default configuration file
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/deploy-config.json"

print_status "Starting Fargate MCP Farm deployment..."
print_status "Script directory: $SCRIPT_DIR"

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

    # Check if CDK is installed
    if ! command -v cdk &> /dev/null; then
        print_error "AWS CDK is required but not installed. Please install CDK first:"
        print_error "npm install -g aws-cdk"
        exit 1
    fi

    # Check if Docker is installed and running
    if ! command -v docker &> /dev/null; then
        print_error "Docker is required but not installed. Please install Docker first."
        exit 1
    fi
    
    if ! docker info &> /dev/null; then
        print_error "Docker is not running. Please start Docker first."
        exit 1
    fi

    print_success "All dependencies met"
}

# Function to load configuration
load_config() {
    if [ ! -f "$CONFIG_FILE" ]; then
        print_error "Configuration file $CONFIG_FILE not found!"
        exit 1
    fi

    print_status "Loading configuration from $CONFIG_FILE"

    # Set AWS region from environment or default
    export AWS_REGION=${AWS_REGION:-us-west-2}
    print_status "Using AWS region: $AWS_REGION"

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
    # Always use environment variable, ignore JSON config
    echo "${AWS_REGION:-us-west-2}"
}

# Function to get deployment stage
get_stage() {
    jq -r '.deployment.stage' "$CONFIG_FILE"
}

# Function to deploy a single MCP server
deploy_server() {
    local server_name=$1
    local server_dir="$SCRIPT_DIR/$server_name"
    
    print_status "Deploying Fargate MCP server: $server_name"
    
    if [ ! -d "$server_dir" ]; then
        print_error "Server directory not found: $server_dir"
        return 1
    fi
    
    if [ ! -f "$server_dir/deploy.sh" ]; then
        print_error "Deploy script not found: $server_dir/deploy.sh"
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
    
    # Change to server directory and run deploy script
    cd "$server_dir"
    
    # Set environment variables for the deployment
    export AWS_REGION="$region"
    export STAGE="$stage"
    
    # Run the deployment script
    if ./deploy.sh; then
        print_success "Successfully deployed $server_name"
        return 0
    else
        print_error "Failed to deploy $server_name"
        return 1
    fi
}

# Function to test deployed servers
test_deployments() {
    print_status "Testing deployed servers..."
    
    local servers_to_test
    servers_to_test=$(get_enabled_servers)
    
    if [ -z "$servers_to_test" ]; then
        print_warning "No servers to test"
        return 0
    fi
    
    for server in $servers_to_test; do
        print_status "Testing $server..."
        
        # Get stack name and region
        local stack_name=$(get_server_config "$server" "stack_name")
        local region=$(get_region)
        local stage=$(get_stage)
        local full_stack_name="${stack_name}-${stage}"
        
        # Get MCP endpoint from CloudFormation outputs
        local mcp_endpoint=$(aws cloudformation describe-stacks \
            --stack-name "$full_stack_name" \
            --region "$region" \
            --query 'Stacks[0].Outputs[?OutputKey==`McpEndpoint`].OutputValue' \
            --output text 2>/dev/null || echo "")
        
        if [ -n "$mcp_endpoint" ] && [ "$mcp_endpoint" != "None" ]; then
            print_status "  Testing MCP endpoint: $mcp_endpoint"
            
            # Test health check
            if curl -s -f "${mcp_endpoint%/mcp}/health" > /dev/null; then
                print_success "  Health check passed for $server"
            else
                print_warning "  Health check failed for $server - service might still be starting"
            fi
            
            # Test MCP initialize
            local response=$(curl -s -X POST "$mcp_endpoint" \
                -H "Content-Type: application/json" \
                -d '{
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "initialize",
                    "params": {
                        "protocolVersion": "2024-11-05",
                        "capabilities": {},
                        "clientInfo": {"name": "test-client", "version": "1.0.0"}
                    }
                }' || echo "")
            
            if echo "$response" | grep -q "serverInfo"; then
                print_success "  MCP initialize test passed for $server"
            else
                print_warning "  MCP initialize test failed for $server"
            fi
        else
            print_warning "  Could not find MCP endpoint for $server"
        fi
    done
}

# Function to generate deployment summary
generate_summary() {
    print_status "Generating deployment summary..."
    
    echo ""
    echo "=========================================="
    echo "  Fargate MCP Farm Deployment Summary"
    echo "=========================================="
    echo ""
    
    local servers_deployed
    servers_deployed=$(get_enabled_servers)
    
    if [ -n "$servers_deployed" ]; then
        echo "Deployed Servers:"
        echo ""
        
        for server in $servers_deployed; do
            local description=$(get_server_config "$server" "description")
            local stack_name=$(get_server_config "$server" "stack_name")
            local region=$(get_region)
            local stage=$(get_stage)
            local full_stack_name="${stack_name}-${stage}"
            
            # Get outputs from CloudFormation
            local load_balancer_url=$(aws cloudformation describe-stacks \
                --stack-name "$full_stack_name" \
                --region "$region" \
                --query 'Stacks[0].Outputs[?OutputKey==`LoadBalancerUrl`].OutputValue' \
                --output text 2>/dev/null || echo "Not available")
            
            local mcp_endpoint=$(aws cloudformation describe-stacks \
                --stack-name "$full_stack_name" \
                --region "$region" \
                --query 'Stacks[0].Outputs[?OutputKey==`McpEndpoint`].OutputValue' \
                --output text 2>/dev/null || echo "Not available")
            
            echo "  • $server"
            echo "    Description: $description"
            echo "    Load Balancer: $load_balancer_url"
            echo "    MCP Endpoint: $mcp_endpoint"
            echo ""
        done
        
        echo "Configuration for MCP Clients:"
        echo ""
        for server in $servers_deployed; do
            local stack_name=$(get_server_config "$server" "stack_name")
            local region=$(get_region)
            local stage=$(get_stage)
            local full_stack_name="${stack_name}-${stage}"
            
            local mcp_endpoint=$(aws cloudformation describe-stacks \
                --stack-name "$full_stack_name" \
                --region "$region" \
                --query 'Stacks[0].Outputs[?OutputKey==`McpEndpoint`].OutputValue' \
                --output text 2>/dev/null || echo "")
            
            if [ -n "$mcp_endpoint" ] && [ "$mcp_endpoint" != "None" ]; then
                echo "  \"$server\": \"$mcp_endpoint\""
            fi
        done
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
    echo "  --region REGION      Override region from config"
    echo "  --stage STAGE        Override stage from config"
    echo "  -h, --help           Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0                           # Deploy all enabled servers"
    echo "  $0 -s playwright-mcp         # Deploy only playwright-mcp server"
    echo "  $0 -c custom-config.json     # Use custom configuration file"
    echo "  $0 -t                        # Run tests only"
    echo "  $0 --region us-east-1        # Override region"
}

# Function to deploy shared infrastructure
deploy_shared_infrastructure() {
    print_status "Deploying MCP Farm Shared Infrastructure..."
    
    local shared_infra_dir="$SCRIPT_DIR/shared-infrastructure"
    
    if [ ! -d "$shared_infra_dir" ]; then
        print_error "Shared infrastructure directory not found: $shared_infra_dir"
        return 1
    fi
    
    if [ ! -f "$shared_infra_dir/deploy.sh" ]; then
        print_error "Shared infrastructure deploy script not found: $shared_infra_dir/deploy.sh"
        return 1
    fi
    
    # Change to shared infrastructure directory and run deploy script
    cd "$shared_infra_dir"
    
    if ./deploy.sh; then
        print_success "Shared infrastructure deployed successfully"
        cd "$SCRIPT_DIR"
        return 0
    else
        print_error "Failed to deploy shared infrastructure"
        cd "$SCRIPT_DIR"
        return 1
    fi
}

# Function to check if shared infrastructure exists
check_shared_infrastructure() {
    print_status "Checking if MCP Farm Shared Infrastructure exists..."
    
    local region=$(get_region)
    
    # Check if McpFarmAlbStack exists
    if aws cloudformation describe-stacks --stack-name McpFarmAlbStack --region "$region" &>/dev/null; then
        print_success "MCP Farm Shared Infrastructure already exists"
        return 0
    else
        print_warning "MCP Farm Shared Infrastructure not found"
        return 1
    fi
}

# Main function
main() {
    local specific_server=""
    local test_only=false
    local region_override=""
    local stage_override=""
    local skip_shared_infra=false
    
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
            --region)
                region_override="$2"
                shift 2
                ;;
            --stage)
                stage_override="$2"
                shift 2
                ;;
            --skip-shared-infra)
                skip_shared_infra=true
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
    
    print_status "Fargate MCP Farm deployment starting..."
    
    # Check dependencies
    check_and_install_dependencies
    
    # Load configuration
    load_config
    
    # Override config values if specified
    if [ -n "$region_override" ]; then
        export AWS_REGION="$region_override"
    fi
    
    if [ -n "$stage_override" ]; then
        export STAGE="$stage_override"
    fi
    
    if [ "$test_only" = true ]; then
        print_status "Running tests only..."
        test_deployments
        exit 0
    fi
    
    # Deploy or check shared infrastructure first
    if [ "$skip_shared_infra" = false ]; then
        if ! check_shared_infrastructure; then
            print_status "Deploying shared infrastructure first..."
            if ! deploy_shared_infrastructure; then
                print_error "Failed to deploy shared infrastructure. Cannot proceed with MCP servers."
                exit 1
            fi
        fi
    else
        print_warning "Skipping shared infrastructure deployment (--skip-shared-infra flag used)"
    fi
    
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
        test_deployments
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
