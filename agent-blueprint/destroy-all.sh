#!/bin/bash

# Sample Strands Agent Chatbot - Complete Destruction Script
# Run this script from the agent-blueprint directory
# This script destroys all components in the correct dependency order

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

# Function to destroy using CDK or fallback to CloudFormation
destroy_stack() {
    local stack_name="$1"
    local cdk_dir="$2"
    local use_python_cdk="$3"

    # Check if stack exists first
    if ! stack_exists "$stack_name"; then
        print_warning "Stack $stack_name does not exist or already deleted. Skipping."
        return 0
    fi

    print_status "Found stack $stack_name. Proceeding with destruction..."

    if [ -n "$cdk_dir" ] && [ -d "$cdk_dir" ]; then
        print_status "Destroying $stack_name using CDK..."

        if [ "$use_python_cdk" = "true" ]; then
            activate_shared_venv
            cd "$cdk_dir"
        else
            cd "$cdk_dir"
        fi

        # Try CDK destroy first
        if npx cdk destroy --all --force --require-approval never 2>/dev/null; then
            print_success "$stack_name destroyed via CDK"
        else
            print_warning "CDK destroy failed, falling back to CloudFormation..."
            aws cloudformation delete-stack --stack-name "$stack_name" --region ${AWS_REGION:-us-west-2} 2>/dev/null || {
                print_warning "CloudFormation delete also failed for $stack_name"
            }
        fi

        cd - > /dev/null
    else
        # Direct CloudFormation deletion
        print_status "Destroying $stack_name via CloudFormation..."
        aws cloudformation delete-stack --stack-name "$stack_name" --region ${AWS_REGION:-us-west-2} 2>/dev/null || {
            print_warning "Failed to delete $stack_name via CloudFormation"
        }
    fi
}

# Main destruction process
main() {
    print_status "🗑️  Starting complete destruction of Sample Strands Agent Chatbot..."

    # Ensure we're in the agent-blueprint directory
    if [[ ! -d "chatbot-deployment" ]] || [[ ! -d "fargate-mcp-farm" ]] || [[ ! -d "serverless-mcp-farm" ]]; then
        print_error "This script must be run from the agent-blueprint directory!"
        print_error "Current directory: $(pwd)"
        print_error "Please cd to agent-blueprint and run the script again."
        exit 1
    fi

    # Set AWS region
    export AWS_REGION=${AWS_REGION:-us-west-2}
    export AWS_DEFAULT_REGION=$AWS_REGION

    # Setup shared virtual environment
    setup_shared_venv

    print_warning "This will destroy ALL components including:"
    echo "  - All Fargate MCP Servers"
    echo "  - Shared Infrastructure (ALB)"
    echo "  - All Serverless MCP Servers"
    echo "  - Web Application (Chatbot)"
    echo "  - Cognito User Pools and Authentication"
    echo "  - ECR repositories and Docker images"
    echo "  - All associated AWS resources"
    echo ""

    read -p "Are you sure you want to proceed? (yes/no): " confirm
    if [[ $confirm != "yes" ]]; then
        print_warning "Destruction cancelled by user."
        exit 0
    fi

    print_status "Starting destruction in dependency order..."

    # Step 1: Destroy Fargate MCP Servers (depend on shared ALB)
    print_status "🗑️  Step 1: Destroying Fargate MCP Servers..."

    # Python MCP Server
    if [ -f "fargate-mcp-farm/python-mcp/destroy.sh" ]; then
        print_status "Destroying Python MCP Server..."
        cd fargate-mcp-farm/python-mcp
        chmod +x destroy.sh
        ./destroy.sh || destroy_stack "python-mcp-fargate" "cdk" "true"
        cd - > /dev/null
    else
        destroy_stack "python-mcp-fargate" "fargate-mcp-farm/python-mcp/cdk" "true"
    fi

    # Nova Act MCP Server
    if [ -f "fargate-mcp-farm/nova-act-mcp/destroy.sh" ]; then
        print_status "Destroying Nova Act MCP Server..."
        cd fargate-mcp-farm/nova-act-mcp
        chmod +x destroy.sh
        ./destroy.sh || destroy_stack "nova-act-mcp-fargate" "cdk" "true"
        cd - > /dev/null
    else
        destroy_stack "nova-act-mcp-fargate" "fargate-mcp-farm/nova-act-mcp/cdk" "true"
    fi

    # Step 2: Destroy Shared Infrastructure (depends on VPC from chatbot)
    print_status "🗑️  Step 2: Destroying Shared Infrastructure..."
    destroy_stack "McpFarmAlbStack" "fargate-mcp-farm/shared-infrastructure/cdk" "true"

    # Step 3: Destroy Serverless MCP Servers (independent)
    print_status "🗑️  Step 3: Destroying Serverless MCP Servers..."

    if [ -f "serverless-mcp-farm/destroy-all-mcp.sh" ]; then
        cd serverless-mcp-farm
        chmod +x destroy-all-mcp.sh
        ./destroy-all-mcp.sh || {
            print_warning "Bulk destroy failed, trying individual servers..."

            # Individual serverless MCP server deletion
            for server in aws-documentation aws-pricing bedrock-kb-retrieval tavily-web-search financial-market; do
                print_status "Destroying $server MCP server..."
                aws cloudformation delete-stack --stack-name "mcp-$server" --region $AWS_REGION 2>/dev/null || true
            done
        }
        cd - > /dev/null
    else
        # Manual serverless stack deletion
        for server in aws-documentation aws-pricing bedrock-kb-retrieval tavily-web-search financial-market; do
            print_status "Destroying $server MCP server..."
            aws cloudformation delete-stack --stack-name "mcp-$server" --region $AWS_REGION 2>/dev/null || true
        done
    fi

    # Step 4: Destroy Web Application (base VPC - destroy last)
    print_status "🗑️  Step 4: Destroying Web Application (Chatbot)..."

    if [ -f "chatbot-deployment/infrastructure/scripts/destroy.sh" ]; then
        cd chatbot-deployment/infrastructure
        chmod +x scripts/destroy.sh
        ./scripts/destroy.sh || {
            print_warning "Dedicated destroy script failed, trying manual CDK destruction..."
            
            # Set CDK environment variables for fallback
            export CDK_DEFAULT_ACCOUNT=$ACCOUNT_ID
            export CDK_DEFAULT_REGION=$AWS_REGION
            
            # Manual CDK destruction from the correct directory
            print_status "Destroying CognitoAuthStack..."
            if stack_exists "CognitoAuthStack"; then
                npx cdk destroy CognitoAuthStack --force --require-approval never || {
                    print_warning "CDK destroy failed for CognitoAuthStack, trying CloudFormation..."
                    aws cloudformation delete-stack --stack-name "CognitoAuthStack" --region $AWS_REGION
                }
            fi
            
            print_status "Destroying ChatbotStack..."
            if stack_exists "ChatbotStack"; then
                npx cdk destroy ChatbotStack --force --require-approval never || {
                    print_warning "CDK destroy failed for ChatbotStack, trying CloudFormation..."
                    aws cloudformation delete-stack --stack-name "ChatbotStack" --region $AWS_REGION
                }
            fi
        }
        cd - > /dev/null
    else
        print_warning "No dedicated destroy script found, using manual CDK destruction..."
        
        # Change to the CDK directory for proper context
        cd chatbot-deployment/infrastructure
        
        # Install dependencies if needed
        if [ ! -d "node_modules" ]; then
            print_status "Installing CDK dependencies..."
            npm install
        fi
        
        # Set CDK environment variables
        export CDK_DEFAULT_ACCOUNT=$ACCOUNT_ID
        export CDK_DEFAULT_REGION=$AWS_REGION
        
        # Destroy both stacks manually with proper CDK context
        print_status "Destroying CognitoAuthStack..."
        if stack_exists "CognitoAuthStack"; then
            npx cdk destroy CognitoAuthStack --force --require-approval never || {
                print_warning "CDK destroy failed for CognitoAuthStack, trying CloudFormation..."
                aws cloudformation delete-stack --stack-name "CognitoAuthStack" --region $AWS_REGION
            }
        fi
        
        print_status "Destroying ChatbotStack..."
        if stack_exists "ChatbotStack"; then
            npx cdk destroy ChatbotStack --force --require-approval never || {
                print_warning "CDK destroy failed for ChatbotStack, trying CloudFormation..."
                aws cloudformation delete-stack --stack-name "ChatbotStack" --region $AWS_REGION
            }
        fi
        
        cd - > /dev/null
    fi

    # Step 5: Clean up ECR repositories (optional)
    print_status "🗑️  Step 5: Cleaning up ECR repositories..."

    echo ""
    read -p "Do you want to delete ECR repositories and all Docker images? (yes/no): " delete_ecr
    if [[ $delete_ecr == "yes" ]]; then
        print_status "Deleting ECR repositories..."

        # List of ECR repositories to delete
        repos=("chatbot-backend" "chatbot-frontend" "python-mcp-fargate-python-mcp" "nova-act-mcp-fargate-nova-act-mcp")

        for repo in "${repos[@]}"; do
            print_status "Deleting ECR repository: $repo"
            aws ecr delete-repository --repository-name "$repo" --force --region $AWS_REGION 2>/dev/null || {
                print_warning "Repository $repo not found or already deleted"
            }
        done
    fi

    # Step 6: Wait for all deletions to complete
    print_status "🗑️  Step 6: Waiting for all stacks to be deleted..."

    stacks_to_check=("python-mcp-fargate" "nova-act-mcp-fargate" "McpFarmAlbStack" "ChatbotStack" "CognitoAuthStack")

    for stack in "${stacks_to_check[@]}"; do
        print_status "Waiting for $stack to be deleted..."
        aws cloudformation wait stack-delete-complete --stack-name "$stack" --region $AWS_REGION 2>/dev/null || {
            print_warning "$stack may not exist or deletion already completed"
        }
    done

    print_success "✅ All components have been successfully destroyed!"
    print_status "🎉 Sample Strands Agent Chatbot completely removed from AWS account"

    # Cleanup local Python virtual environments
    print_status "Cleaning up local Python virtual environments..."
    find . -name ".venv" -type d -exec rm -rf {} + 2>/dev/null || true

    print_success "🧹 Local cleanup completed!"
}

# Run main function
main "$@"