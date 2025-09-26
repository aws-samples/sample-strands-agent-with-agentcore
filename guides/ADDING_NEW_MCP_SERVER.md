# Adding a New MCP Server to Serverless Farm

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

**infrastructure/deploy.sh**
```bash
#!/bin/bash
# Copy from existing server and modify stack name
STACK_NAME="mcp-your-new-server"
# Rest of deployment logic
```

**infrastructure/cloudformation.yaml**
```yaml
# Copy from existing server template
# Modify function name and description
```

### 3. Update Configuration

**Add to deploy-config.json:**
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

### 4. Add to Chatbot Configuration

**Update chatbot-app/backend/unified_tools_config.json:**
```json
{
  "mcp_servers": [
    {
      "id": "your_new_server",
      "name": "Your New Server",
      "enabled": false,
      "transport": "streamable_http",
      "url": "https://your-lambda-url.amazonaws.com/mcp",
      "category": "your-category",
      "description": "Description of your new server"
    }
  ]
}
```

### 5. Deploy

**Individual deployment:**
```bash
cd infrastructure
./deploy.sh
```

**Deploy all servers:**
```bash
cd agent-blueprint/serverless-mcp-farm
./deploy-server.sh
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

## Tips
- Copy existing server as template (e.g., aws-documentation)
- Update stack names and function names
- Test locally before deploying
- Enable in deploy-config.json when ready
- The system auto-discovers servers from config
