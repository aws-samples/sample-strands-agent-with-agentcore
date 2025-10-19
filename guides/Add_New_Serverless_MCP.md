# Adding a New MCP Server to Serverless Farm

This guide covers adding a new MCP server with full automated deployment integration.

## Quick Steps

### 1. Create Directory Structure
```bash
cd agent-blueprint/serverless-mcp-farm/
mkdir your-new-server
cd your-new-server
mkdir src infrastructure
```

### 2. Create Core Files

**src/lambda_function.py**
```python
from mcp_server import app

def lambda_handler(event, context):
    return app.lambda_handler(event, context)
```

**src/mcp_server.py**
```python
from mcp.server.fastmcp import FastMCP

app = FastMCP("Your Server Name")

@app.tool()
def your_tool_function(param: str) -> str:
    """Your tool description"""
    # Your implementation
    return f"Result: {param}"
```

**src/requirements.txt**
```
mcp>=1.0.0
fastmcp>=0.1.0
# Add your dependencies
```

### 3. Create Infrastructure Files

**infrastructure/deploy.sh** (for standard deployment)
```bash
#!/bin/bash
set -e

STACK_NAME="mcp-your-new-server"
REGION="${AWS_DEFAULT_REGION:-us-west-2}"
STAGE="${DEPLOYMENT_STAGE:-prod}"

echo "🚀 Deploying your-new-server Lambda MCP server with CloudFormation..."

# Standard deployment logic
aws cloudformation deploy \
    --template-file cloudformation.yaml \
    --stack-name $STACK_NAME \
    --parameter-overrides DeploymentStage=$STAGE \
    --capabilities CAPABILITY_NAMED_IAM \
    --region $REGION

# Update function code and display results
# (Copy from existing server template)
```

**infrastructure/cloudformation.yaml**
```yaml
# Copy from existing server template (e.g., aws-documentation)
# Key requirements:
# 1. Must have McpEndpoint output for automation
# 2. Must create Parameter Store entry
# 3. Update function names and descriptions

Outputs:
  McpEndpoint:
    Description: 'MCP Server endpoint URL for deployment automation'
    Value: !Sub 'https://${ApiGateway}.execute-api.${AWS::Region}.amazonaws.com/${DeploymentStage}/mcp'
    Export:
      Name: !Sub '${AWS::StackName}-mcp-endpoint'

Resources:
  MCPEndpointParameter:
    Type: AWS::SSM::Parameter
    Properties:
      Name: '/mcp/endpoints/serverless/your-new-server'
      Type: String
      Value: !Sub 'https://${ApiGateway}.execute-api.${AWS::Region}.amazonaws.com/${DeploymentStage}/mcp'
      Description: 'Your New Server MCP endpoint URL'
```

### 4. Update Configuration Files

**Add to agent-blueprint/serverless-mcp-farm/deploy-config.json:**

        "your-server-name": {
        "enabled": true,
        "stack_name": "your-stack-name",
        "description": "your-stack-description"
      }


```json
{
  "deployment": {
    "servers": {
      "your-new-server": {
        "enabled": true,
        "stack_name": "mcp-your-new-server",
        "description": "Your New MCP Server Description"
      }
    }
  },
  "environment_variables": {
    "your-new-server": {
      "LOG_LEVEL": "INFO"
    }
  },
  "testing": {
    "test_cases": {
      "your-new-server": [
        {
          "name": "Test your function",
          "method": "your_tool_function",
          "arguments": {
            "param": "test"
          }
        }
      ]
    }
  }
}
```

### 5. Integrate with Automated Deployment

**For Standard Servers:** No additional changes needed - the deploy-server.sh will automatically handle your server.

**For Custom Servers (with special requirements like layers):**

1. **Update deploy-server.sh** to add special handling:
```bash
# Add after existing special handling blocks
if [ "$server_name" = "your-new-server" ]; then
    print_status "Using custom deployment script for your-new-server..."
    cd "$server_dir/infrastructure"
    if [ -f "./deploy.sh" ]; then
        AWS_DEFAULT_REGION="$region" DEPLOYMENT_STAGE="$stage" ./deploy.sh
        return $?
    else
        print_error "Custom deploy.sh not found for your-new-server"
        return 1
    fi
fi
```

2. **Update deploy-all.sh** to include in endpoint collection:
```bash
# Add to stack_names mapping
declare -A stack_names=(
    # ... existing mappings ...
    ["your-new-server"]="mcp-your-new-server"
)

# Add to server list
for server in aws-documentation aws-pricing bedrock-kb-retrieval tavily-web-search financial-market recruiter-insights your-new-server; do
```

### 6. Deploy Options

**Option 1: Deploy Individual Server**
```bash
cd infrastructure
./deploy.sh
```

**Option 2: Deploy via Serverless Farm**
```bash
cd agent-blueprint/serverless-mcp-farm
./deploy-server.sh -s your-new-server
```

**Option 3: Deploy Everything (Recommended)**
```bash
cd agent-blueprint
./deploy-all.sh
```

### 7. Verification

After deployment, verify:

1. **Stack Created**: Check AWS CloudFormation console
2. **Parameter Store**: Check `/mcp/endpoints/serverless/your-new-server`
3. **Endpoint Discovery**: The chatbot will automatically discover your server
4. **Testing**: Use the built-in test framework

```bash
# Test your server
cd agent-blueprint/serverless-mcp-farm
./deploy-server.sh -t -s your-new-server
```

### 8 =. Frontend Integration
Add tool  to `chatbot-app/backend/unified_tools_config.json`:

```json
{
  "id": "your-new-server",
  "name": "Your new server name", 
  "description": "your new server description",
  "type": "mcp",
  "config": {
    "url": "ssm:///mcp/endpoints/serverless/your-new-server"
  },
  "category": "category",
  "icon": "users",
  "enabled": true,
  "tool_type": "mcp"
}
```

## File Structure Template
```
your-new-server/
├── README.md
├── src/
│   ├── lambda_function.py    # Lambda entry point
│   ├── mcp_server.py        # MCP server implementation
│   ├── requirements.txt     # Dependencies
│   └── models.py           # Data models (optional)
└── infrastructure/
    ├── deploy.sh           # Deployment script
    └── cloudformation.yaml # AWS resources
```

## Integration Checklist

- [ ] Created directory structure
- [ ] Implemented MCP server code
- [ ] Created CloudFormation template with required outputs
- [ ] Added to deploy-config.json
- [ ] Updated deploy-server.sh (if custom deployment needed)
- [ ] Updated deploy-all.sh (if custom deployment needed)
- [ ] Tested individual deployment
- [ ] Tested via deploy-all.sh
- [ ] Verified Parameter Store entry
- [ ] Confirmed chatbot discovery for frontend integration

## Key Requirements for Automation

1. **CloudFormation Output**: Must include `McpEndpoint` output
2. **Parameter Store**: Must create `/mcp/endpoints/serverless/your-server-name` entry
3. **Stack Naming**: Use consistent `mcp-your-server-name` pattern
4. **Config Entry**: Must be in deploy-config.json with correct stack_name

## Tips

- **Start with Template**: Copy existing server (aws-documentation) as starting point
- **Test Early**: Deploy individually before integrating with deploy-all.sh
- **Follow Patterns**: Use same patterns as financial-market/recruiter-insights for consistency
- **Parameter Store**: The automation relies on Parameter Store entries for endpoint discovery
- **Stack Names**: Keep stack names consistent with the pattern in deploy-config.json

## Troubleshooting

- **Endpoint Not Found**: Check CloudFormation outputs and Parameter Store entry
- **Deploy-all.sh Skips Server**: Verify stack name mapping in deploy-all.sh
- **Custom Deployment Issues**: Ensure deploy.sh is executable and handles environment variables
