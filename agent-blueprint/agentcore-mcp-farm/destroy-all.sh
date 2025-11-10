#!/bin/bash

# AgentCore MCP Farm - Unified Destroy Script
# This script destroys all enabled MCP servers from AWS Bedrock AgentCore Runtime

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

print_warning "=========================================="
print_warning "AgentCore MCP Farm Cleanup"
print_warning "=========================================="
echo ""

# Function to load configuration
load_config() {
    if [ ! -f "$CONFIG_FILE" ]; then
        print_error "Configuration file $CONFIG_FILE not found!"
        exit 1
    fi

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

# Main execution
main() {
    load_config

    # Get list of enabled servers
    local enabled_servers=$(get_enabled_servers)

    if [ -z "$enabled_servers" ]; then
        print_warning "No enabled servers found in configuration"
        exit 0
    fi

    print_warning "This will destroy the following AgentCore MCP servers:"
    for server in $enabled_servers; do
        local description=$(get_server_config "$server" "description")
        echo "  - $server: $description"
    done
    echo ""
    print_warning "This action cannot be undone!"
    echo ""

    # Confirm deletion
    read -p "Are you sure you want to proceed? (yes/no): " confirmation
    if [ "$confirmation" != "yes" ]; then
        print_status "Cleanup cancelled"
        exit 0
    fi

    echo ""
    print_status "Destroying AgentCore MCP servers..."

    # Destroy servers in reverse order
    local servers_array=($enabled_servers)
    for ((i=${#servers_array[@]}-1; i>=0; i--)); do
        local server="${servers_array[$i]}"
        local server_dir="$SCRIPT_DIR/$server"

        print_status "Destroying $server..."

        if [ ! -d "$server_dir" ]; then
            print_warning "Server directory not found: $server_dir"
            continue
        fi

        if [ ! -f "$server_dir/destroy.sh" ]; then
            print_warning "Destroy script not found: $server_dir/destroy.sh"
            continue
        fi

        # Change to server directory and run destroy script
        cd "$server_dir"

        if bash destroy.sh; then
            print_success "Successfully destroyed $server"
        else
            print_error "Failed to destroy $server"
        fi

        cd "$SCRIPT_DIR"
    done

    echo ""
    print_status "=========================================="
    print_success "AgentCore MCP Farm Cleanup Complete"
    print_status "=========================================="
    echo ""
    print_status "All enabled servers have been removed."
}

# Run main function
main
