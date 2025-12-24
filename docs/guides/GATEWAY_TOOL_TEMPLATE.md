# New Gateway Tool Template

Use this template when adding a new Gateway tool to avoid naming confusion.

---

## 📋 Pre-flight Checklist

Before you start:
- [ ] Lambda function is deployed
- [ ] Lambda function ARN is available
- [ ] Tool functionality is tested independently
- [ ] Tool input/output schema is designed

---

## Step 1: Choose Names

Fill in the table below:

| Name Type | Format | Your Value | Example |
|-----------|--------|------------|---------|
| **Lambda Function** | N/A | `____________` | `google-maps` |
| **Target Name** (kebab-case) | `{name}` | `____________` | `search-places` |
| **Schema Name** (snake_case) ⭐ | `{name}` | `____________` | `search_places` |
| **Config ID** | `gateway_{schema_name}` | `gateway____________` | `gateway_search_places` |

**⭐ Schema Name is the KEY - remember it for the next steps!**

---

## Step 2: CDK Gateway Target

```typescript
// File: agent-blueprint/agentcore-gateway-stack/infrastructure/lib/gateway-target-stack.ts

// 1. Get Lambda function reference
const myLambdaFn = functions.get('YOUR_LAMBDA_NAME')!

// 2. Add Gateway Target
new agentcore.CfnGatewayTarget(this, 'YourToolTarget', {
  name: 'YOUR_TARGET_NAME',  // ← From table above (kebab-case)
  gatewayIdentifier: gateway.attrGatewayIdentifier,
  description: 'SHORT DESCRIPTION',

  credentialProviderConfigurations: [
    {
      credentialProviderType: 'GATEWAY_IAM_ROLE',
    },
  ],

  targetConfiguration: {
    mcp: {
      lambda: {
        lambdaArn: myLambdaFn.functionArn,
        toolSchema: {
          inlinePayload: [
            {
              name: 'YOUR_SCHEMA_NAME',  // ← ⭐ From table above (snake_case)
              description: 'DETAILED DESCRIPTION OF WHAT THIS TOOL DOES',
              inputSchema: {
                type: 'object',
                description: 'PARAMETERS DESCRIPTION',
                required: ['REQUIRED_PARAM'],
                properties: {
                  REQUIRED_PARAM: {
                    type: 'string',  // or 'integer', 'boolean', etc.
                    description: 'PARAMETER DESCRIPTION',
                  },
                  OPTIONAL_PARAM: {
                    type: 'string',
                    description: 'OPTIONAL PARAMETER DESCRIPTION',
                  },
                },
              },
            },
          ],
        },
      },
    },
  },
})
```

---

## Step 3: tools-config.json

```json
// File: chatbot-app/frontend/src/config/tools-config.json

{
  "gateway_targets": [
    // ... existing tools ...

    // Add your new tool here:
    {
      "id": "gateway_YOUR_SCHEMA_NAME",  // ← From table above
      "name": "Your Tool Display Name",
      "description": "User-friendly description of what this tool does",
      "category": "Productivity",  // or "Search", "Data", "Communication", etc.
      "isDynamic": false,
      "tools": [
        {
          "id": "gateway_YOUR_SCHEMA_NAME",  // Same as parent ID
          "name": "YOUR_SCHEMA_NAME",  // Just the schema name
          "description": "Brief tool description"
        }
      ],
      "systemPromptGuidance": "Optional: Tell Claude when and how to use this tool. Example: Use this tool when the user asks about..."
    }
  ]
}
```

---

## Step 4: Deploy

```bash
# 1. Deploy Gateway stack
cd agent-blueprint/agentcore-gateway-stack/infrastructure
npm run deploy

# 2. Restart agentcore (if running locally)
# Server will auto-reload tools-config.json

# 3. Test in Frontend
# - Navigate to tool settings
# - Enable your new tool
# - Test with a query that should trigger the tool
```

---

## Step 5: Verification

Run these checks:

### Check 1: Gateway Target Deployed
```bash
aws bedrock-agent-core list-gateway-targets \
  --gateway-identifier YOUR_GATEWAY_ID \
  --region us-west-2
```
**Expected**: Your target appears in the list

---

### Check 2: FilteredMCPClient Logs
```bash
# Start agentcore with your tool enabled
# Look for these log lines:
```
```
✅ Filtered 1 tools from 20 available
   Original tool names: ['YOUR_TARGET_NAME___YOUR_SCHEMA_NAME']
📝 Simplified tool name: YOUR_TARGET_NAME___YOUR_SCHEMA_NAME → YOUR_SCHEMA_NAME
   Simplified tool names: ['YOUR_SCHEMA_NAME']
```

---

### Check 3: Agent Invocation
Test with the actual agent:
```bash
cd tests
python3 << EOF
import asyncio
import sys
sys.path.insert(0, '../chatbot-app/agentcore/src')

from agent.gateway_mcp_client import FilteredMCPClient
from strands import Agent
# ... (similar to test-simplified-agent.py)
EOF
```

**Expected**:
- Tool called with simplified name: `YOUR_SCHEMA_NAME`
- Gateway receives full name: `YOUR_TARGET_NAME___YOUR_SCHEMA_NAME`
- Tool execution succeeds

---

## Troubleshooting

| Issue | Likely Cause | Fix |
|-------|--------------|-----|
| Tool doesn't appear in list | Wrong ID in config | Check `gateway_{schema_name}` matches CDK |
| "Tool not found" error | Name mismatch | Verify CDK `toolSchema.name` is correct |
| Tool appears but fails | Lambda error | Check Lambda logs in CloudWatch |
| Name not simplified | FilteredMCPClient issue | Check `list_tools_sync()` logs |

---

## Example: Complete Workflow

Let's add a "Get Stock Price" tool:

### Planning
| Name Type | Value |
|-----------|-------|
| Lambda Function | `finance` |
| Target Name | `get-stock-price` |
| Schema Name | `get_stock_price` ⭐ |
| Config ID | `gateway_get_stock_price` |

### CDK (gateway-target-stack.ts)
```typescript
const financeFn = functions.get('finance')!

new agentcore.CfnGatewayTarget(this, 'GetStockPriceTarget', {
  name: 'get-stock-price',
  gatewayIdentifier: gateway.attrGatewayIdentifier,
  description: 'Get current stock price',

  credentialProviderConfigurations: [
    { credentialProviderType: 'GATEWAY_IAM_ROLE' }
  ],

  targetConfiguration: {
    mcp: {
      lambda: {
        lambdaArn: financeFn.functionArn,
        toolSchema: {
          inlinePayload: [{
            name: 'get_stock_price',  // ⭐
            description: 'Get current stock price for a given symbol',
            inputSchema: {
              type: 'object',
              required: ['symbol'],
              properties: {
                symbol: {
                  type: 'string',
                  description: 'Stock ticker symbol (e.g., AAPL, MSFT)'
                }
              }
            }
          }]
        }
      }
    }
  }
})
```

### tools-config.json
```json
{
  "id": "gateway_get_stock_price",
  "name": "Get Stock Price",
  "description": "Get real-time stock prices",
  "category": "Finance",
  "tools": [{
    "id": "gateway_get_stock_price",
    "name": "get_stock_price",
    "description": "Get current stock price"
  }],
  "systemPromptGuidance": "Use this tool when users ask about current stock prices. Requires a valid stock ticker symbol."
}
```

### Expected Flow
```
User enables: "gateway_get_stock_price"
  ↓
FilteredMCPClient filters: "get-stock-price___get_stock_price" → "get_stock_price"
  ↓
Claude sees: "get_stock_price"
  ↓
Claude calls: "get_stock_price"
  ↓
call_tool_sync converts: "get_stock_price" → "get-stock-price___get_stock_price"
  ↓
Gateway executes: Lambda function with "get-stock-price___get_stock_price"
  ↓
Success! ✅
```

---

## Done!

- [ ] CDK code added
- [ ] tools-config.json updated
- [ ] Deployed to AWS
- [ ] Tested in Frontend
- [ ] Documentation updated (if needed)

Keep this template for future tool additions!
