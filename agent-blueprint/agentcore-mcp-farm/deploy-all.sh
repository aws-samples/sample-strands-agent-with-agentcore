#!/bin/bash

# AgentCore MCP Farm - Unified Deployment Script
# This script deploys all enabled MCP servers to AWS Bedrock AgentCore Runtime

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

print_status "Starting AgentCore MCP Farm deployment..."
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

    print_status "Deploying AgentCore MCP server: $server_name"

    if [ ! -d "$server_dir" ]; then
        print_error "Server directory not found: $server_dir"
        return 1
    fi

    if [ ! -f "$server_dir/deploy.sh" ]; then
        print_error "Deploy script not found: $server_dir/deploy.sh"
        return 1
    fi

    # Change to server directory and run deploy script
    cd "$server_dir"

    print_status "Running deploy script for $server_name..."
    if bash deploy.sh; then
        print_success "Successfully deployed $server_name"
        cd "$SCRIPT_DIR"
        return 0
    else
        print_error "Failed to deploy $server_name"
        cd "$SCRIPT_DIR"
        return 1
    fi
}

# Function to test deployments
test_deployments() {
    print_status "Testing AgentCore MCP deployments..."

    local enabled_servers=$(get_enabled_servers)

    if [ -z "$enabled_servers" ]; then
        print_warning "No enabled servers found"
        return
    fi

    for server in $enabled_servers; do
        print_status "Testing $server..."

        # Get endpoint from SSM
        local endpoint=$(aws ssm get-parameter \
            --name "/mcp/endpoints/agentcore/$server" \
            --region $(get_region) \
            --query 'Parameter.Value' \
            --output text 2>/dev/null || echo "")

        if [ -z "$endpoint" ] || [ "$endpoint" == "None" ]; then
            print_warning "Endpoint not found for $server"
            continue
        fi

        print_status "Endpoint: $endpoint"

        # Test MCP initialize
        if curl -f -s -X POST "${endpoint}/mcp" \
            -H "Content-Type: application/json" \
            -d '{"jsonrpc":"2.0","method":"initialize","id":1,"params":{}}' > /dev/null 2>&1; then
            print_success "$server is responding"
        else
            print_warning "$server is not responding yet (may still be initializing)"
        fi
    done
}

# Function to display deployment summary
display_summary() {
    print_status "=========================================="
    print_success "AgentCore MCP Farm Deployment Complete"
    print_status "=========================================="
    echo ""

    local enabled_servers=$(get_enabled_servers)

    if [ -z "$enabled_servers" ]; then
        print_warning "No servers were deployed"
        return
    fi

    echo "Deployed Servers:"
    for server in $enabled_servers; do
        local description=$(get_server_config "$server" "description")
        local stack_name=$(get_server_config "$server" "stack_name")
        local endpoint=$(aws ssm get-parameter \
            --name "/mcp/endpoints/agentcore/$server" \
            --region $(get_region) \
            --query 'Parameter.Value' \
            --output text 2>/dev/null || echo "N/A")

        echo ""
        echo "  Server: $server"
        echo "  Description: $description"
        echo "  Stack: $stack_name"
        echo "  Endpoint: $endpoint"
        echo "  SSM Parameter: /mcp/endpoints/agentcore/$server"
    done

    echo ""
    print_status "To view logs for a server:"
    echo "  aws logs tail /aws/bedrockagentcore/<stack-name> --follow"
    echo ""
    print_status "To test MCP servers:"
    echo "  curl -X POST <endpoint>/mcp \\"
    echo "    -H 'Content-Type: application/json' \\"
    echo "    -d '{\"jsonrpc\":\"2.0\",\"method\":\"tools/list\",\"id\":1}'"
    echo ""
}

# Main execution
main() {
    check_and_install_dependencies
    load_config

    local stage=$(get_stage)
    export STAGE=$stage

    print_status "Deployment stage: $stage"
    print_status "AWS region: $(get_region)"
    echo ""

    # Get list of enabled servers
    local enabled_servers=$(get_enabled_servers)

    if [ -z "$enabled_servers" ]; then
        print_warning "No enabled servers found in configuration"
        print_status "Edit $CONFIG_FILE to enable servers"
        exit 0
    fi

    print_status "Enabled servers:"
    for server in $enabled_servers; do
        echo "  - $server"
    done
    echo ""

    # Deploy each enabled server
    local failed_servers=()
    for server in $enabled_servers; do
        if ! deploy_server "$server"; then
            failed_servers+=("$server")
        fi
    done

    # Test deployments
    echo ""
    test_deployments

    # Display summary
    echo ""
    display_summary

    # Report failures
    if [ ${#failed_servers[@]} -gt 0 ]; then
        echo ""
        print_warning "The following servers failed to deploy:"
        for server in "${failed_servers[@]}"; do
            echo "  - $server"
        done
        exit 1
    fi

    print_success "All servers deployed successfully!"
}

# Run main function
main
