# Gateway Tool Naming Convention

## Overview

Gateway tools use a three-layer naming system:
1. **Gateway MCP Protocol**: `{target-name}___{schema_name}` (e.g., `search-places___search_places`)
2. **Frontend/Config/DynamoDB**: `gateway_{schema_name}` (e.g., `gateway_search_places`)
3. **Claude/Agent/Logs**: `{schema_name}` (e.g., `search_places`)

The conversion between these formats is **automatic** via `FilteredMCPClient`.

---

## Adding a New Gateway Tool

### Step 1: Define Gateway Target in CDK

```typescript
// gateway-target-stack.ts

new agentcore.CfnGatewayTarget(this, 'MyNewToolTarget', {
  name: 'my-new-tool',  // ← Target name (kebab-case, for display)
  gatewayIdentifier: gateway.attrGatewayIdentifier,
  description: 'Description of my new tool',

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
              name: 'my_new_tool',  // ← ⭐ IMPORTANT: Schema name (snake_case)
              description: 'Performs a specific action...',
              inputSchema: {
                type: 'object',
                description: 'Tool parameters',
                required: ['param1'],
                properties: {
                  param1: {
                    type: 'string',
                    description: 'First parameter',
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

**Key Point**: Remember the **schema name** (`my_new_tool`). This is what you'll use in the next step.

---

### Step 2: Add to tools-config.json

**Rule**: Use `gateway_{schema_name}` format

```json
{
  "gateway_targets": [
    {
      "id": "gateway_my_new_tool",  // ← gateway_ + schema_name
      "name": "My New Tool",  // Display name for users
      "description": "Description of what this tool does",
      "category": "Productivity",  // Optional category
      "isDynamic": false,
      "tools": [
        {
          "id": "gateway_my_new_tool",  // Same as parent ID
          "name": "my_new_tool",  // Schema name
          "description": "Performs a specific action"
        }
      ],
      "systemPromptGuidance": "Optional guidance for Claude on when/how to use this tool."
    }
  ]
}
```

---

### Step 3: Deploy and Test

1. **Deploy CDK stack**:
   ```bash
   cd agent-blueprint/agentcore-gateway-stack/infrastructure
   npm run deploy
   ```

2. **Restart agentcore server**:
   ```bash
   # Server will auto-reload tools-config.json
   ```

3. **Test in Frontend**:
   - Select "My New Tool" in the sidebar
   - Verify tool name appears as `my_new_tool` in logs/UI
   - Confirm Gateway receives `my-new-tool___my_new_tool` (automatic conversion)

---

## Quick Reference

| Layer | Format | Example | Where Used |
|-------|--------|---------|------------|
| **Gateway MCP** | `{target-name}___{schema_name}` | `search-places___search_places` | Gateway internal protocol |
| **Config/Frontend** | `gateway_{schema_name}` | `gateway_search_places` | tools-config.json, DynamoDB, Frontend state |
| **Agent/Claude** | `{schema_name}` | `search_places` | Tool specs sent to Claude, Agent logs, Frontend display |

---

## Naming Rules

### Target Name (CDK `name` field)
- **Format**: kebab-case
- **Purpose**: Display/identification in AWS Console
- **Example**: `search-places`, `get-weather`, `stock-analysis`

### Schema Name (CDK `toolSchema.inlinePayload[].name`)
- **Format**: snake_case
- **Purpose**: Actual tool invocation name
- **Example**: `search_places`, `get_weather`, `stock_analysis`
- **⭐ This is the PRIMARY identifier used everywhere else**

### Config/Frontend ID
- **Format**: `gateway_{schema_name}`
- **Purpose**: Tool selection in UI, DynamoDB storage
- **Example**: `gateway_search_places`, `gateway_get_weather`

---

## Examples

### Example 1: Google Maps Search Places
```typescript
// CDK
name: 'search-places',  // Target name
toolSchema: { name: 'search_places' }  // Schema name ⭐

// tools-config.json
"id": "gateway_search_places",  // Config ID

// Automatic conversions
// Frontend sends: "gateway_search_places"
// Agent sees: "search_places"
// Gateway receives: "search-places___search_places"
```

### Example 2: Weather Forecast
```typescript
// CDK
name: 'get-weather-forecast',  // Target name
toolSchema: { name: 'get_weather_forecast' }  // Schema name ⭐

// tools-config.json
"id": "gateway_get_weather_forecast",  // Config ID

// Automatic conversions
// Frontend sends: "gateway_get_weather_forecast"
// Agent sees: "get_weather_forecast"
// Gateway receives: "get-weather-forecast___get_weather_forecast"
```

---

## Troubleshooting

### Tool not appearing in FilteredMCPClient logs
**Problem**: `enabled_tool_ids` doesn't match

**Check**:
1. Verify `tools-config.json` uses `gateway_{schema_name}`
2. Check CDK `toolSchema.name` matches `{schema_name}`
3. Look for typos (underscore vs hyphen)

### Tool call fails with "tool not found in registry"
**Problem**: Name mapping not working

**Check**:
1. Verify `FilteredMCPClient.list_tools_sync()` logs show simplified name
2. Check `_tool_name_map` is populated
3. Verify Gateway target is deployed correctly

### Claude uses wrong tool name
**Problem**: Tool spec has incorrect name

**Check**:
1. Verify `tool.tool_spec['name']` matches simplified name
2. Check if `_agent_tool_name` was set correctly in `list_tools_sync()`

---

## Migration from Full Names

If you have existing configs with full names like `gateway_search-places___search_places`:

✅ **No changes required** - both formats are supported!

```json
// Old format - still works
"id": "gateway_search-places___search_places"

// New format - cleaner
"id": "gateway_search_places"

// Mixed - also works
["gateway_search_places", "gateway_wikipedia-search___wikipedia_search"]
```

**Recommendation**: Migrate to simplified format (`gateway_{schema_name}`) for better maintainability.

---

## Code References

- **FilteredMCPClient**: `chatbot-app/agentcore/src/agent/gateway_mcp_client.py`
  - `list_tools_sync()`: Filtering and name simplification
  - `call_tool_sync()`: Name restoration for Gateway calls

- **Gateway Stack**: `agent-blueprint/agentcore-gateway-stack/infrastructure/lib/gateway-target-stack.ts`
  - Gateway target definitions

- **Tools Config**: `chatbot-app/frontend/src/config/tools-config.json`
  - Frontend tool registry
