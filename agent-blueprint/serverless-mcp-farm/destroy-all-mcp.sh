#!/bin/bash

# Serverless MCP Farm Destroy Script
# Destroys all serverless MCP Lambda stacks based on deploy-config.json

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🔥 Starting Serverless MCP Farm destruction...${NC}"

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/deploy-config.json"

# Check if config file exists
if [ ! -f "$CONFIG_FILE" ]; then
    echo -e "${RED}❌ Configuration file not found: $CONFIG_FILE${NC}"
    exit 1
fi

# Parse configuration and get enabled servers
ENABLED_SERVERS=$(python3 -c "
import json
with open('$CONFIG_FILE', 'r') as f:
    config = json.load(f)
servers = config.get('deployment', {}).get('servers', {})
enabled = [name for name, server in servers.items() if server.get('enabled', False)]
print(' '.join(enabled))
")

if [ -z "$ENABLED_SERVERS" ]; then
    echo -e "${YELLOW}⚠️  No enabled servers found in configuration.${NC}"
    exit 0
fi

echo -e "${BLUE}Found enabled MCP servers: $ENABLED_SERVERS${NC}"
echo ""

# Confirmation
echo -e "${YELLOW}This will destroy the following serverless MCP stacks:${NC}"
for server in $ENABLED_SERVERS; do
    # Get stack name from config
    STACK_NAME=$(python3 -c "
import json
with open('$CONFIG_FILE', 'r') as f:
    config = json.load(f)
servers = config.get('deployment', {}).get('servers', {})
print(servers.get('$server', {}).get('stack_name', '$server'))
")
    echo -e "  - ${BLUE}$STACK_NAME${NC} (from $server)"
done
echo ""

read -p "Are you sure you want to destroy all serverless MCP stacks? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${RED}❌ Destruction cancelled.${NC}"
    exit 1
fi

# Function to destroy a single MCP server
destroy_mcp_server() {
    local server_name=$1
    local server_dir="$SCRIPT_DIR/$server_name"
    
    echo -e "${BLUE}🔥 Destroying $server_name MCP server...${NC}"
    
    # Check if server directory exists
    if [ ! -d "$server_dir" ]; then
        echo -e "${RED}❌ Server directory not found: $server_dir${NC}"
        return 1
    fi
    
    # Get stack name from config
    local stack_name=$(python3 -c "
import json
with open('$CONFIG_FILE', 'r') as f:
    config = json.load(f)
servers = config.get('deployment', {}).get('servers', {})
print(servers.get('$server_name', {}).get('stack_name', '$server_name'))
")
    
    # Check for destroy script first
    if [ -f "$server_dir/destroy.sh" ]; then
        echo -e "${GREEN}  Using destroy script...${NC}"
        cd "$server_dir"
        chmod +x destroy.sh
        ./destroy.sh
        cd - > /dev/null
    elif [ -f "$server_dir/infrastructure/destroy.sh" ]; then
        echo -e "${GREEN}  Using infrastructure destroy script...${NC}"
        cd "$server_dir/infrastructure"
        chmod +x destroy.sh
        ./destroy.sh
        cd - > /dev/null
    else
        # Use CloudFormation directly
        echo -e "${GREEN}  Using AWS CLI to delete CloudFormation stack...${NC}"
        
        # Check if stack exists
        if aws cloudformation describe-stacks --stack-name "$stack_name" --region us-west-2 >/dev/null 2>&1; then
            echo -e "${GREEN}  Deleting CloudFormation stack: $stack_name${NC}"
            aws cloudformation delete-stack --stack-name "$stack_name" --region us-west-2
            
            echo -e "${YELLOW}  Waiting for stack deletion to complete...${NC}"
            aws cloudformation wait stack-delete-complete --stack-name "$stack_name" --region us-west-2
            echo -e "${GREEN}  ✅ Stack $stack_name deleted successfully${NC}"
        else
            echo -e "${YELLOW}  ⚠️  Stack $stack_name does not exist or already deleted${NC}"
        fi
    fi
    
    echo -e "${GREEN}  ✅ $server_name destroyed successfully${NC}"
    echo ""
}

# Function to check AWS CLI configuration
check_aws_cli() {
    if ! command -v aws &> /dev/null; then
        echo -e "${RED}❌ AWS CLI not found. Please install AWS CLI.${NC}"
        exit 1
    fi
    
    if ! aws sts get-caller-identity >/dev/null 2>&1; then
        echo -e "${RED}❌ AWS CLI not configured or no valid credentials.${NC}"
        echo -e "${YELLOW}Please run: aws configure${NC}"
        exit 1
    fi
}

# Check prerequisites
echo -e "${BLUE}🔍 Checking prerequisites...${NC}"
check_aws_cli

if ! command -v python3 &> /dev/null; then
    echo -e "${RED}❌ Python 3 not found. Please install Python 3.${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Prerequisites check passed${NC}"
echo ""

# Destroy all enabled servers
FAILED_SERVERS=""
SUCCESS_COUNT=0

for server in $ENABLED_SERVERS; do
    if destroy_mcp_server "$server"; then
        ((SUCCESS_COUNT++))
    else
        echo -e "${RED}❌ Failed to destroy $server${NC}"
        FAILED_SERVERS="$FAILED_SERVERS $server"
    fi
done

# Summary
echo -e "${BLUE}📊 Destruction Summary:${NC}"
echo -e "${GREEN}  ✅ Successfully destroyed: $SUCCESS_COUNT servers${NC}"

if [ -n "$FAILED_SERVERS" ]; then
    echo -e "${RED}  ❌ Failed to destroy:$FAILED_SERVERS${NC}"
    echo ""
    echo -e "${YELLOW}💡 You can manually delete failed stacks using:${NC}"
    for server in $FAILED_SERVERS; do
        STACK_NAME=$(python3 -c "
import json
with open('$CONFIG_FILE', 'r') as f:
    config = json.load(f)
servers = config.get('deployment', {}).get('servers', {})
print(servers.get('$server', {}).get('stack_name', '$server'))
")
        echo -e "   aws cloudformation delete-stack --stack-name $STACK_NAME --region us-west-2"
    done
    exit 1
else
    echo -e "${GREEN}🎉 All serverless MCP stacks destroyed successfully!${NC}"
fi

echo ""
echo -e "${BLUE}📝 Note: Serverless MCP stacks are independent and don't affect ChatbotStack.${NC}"