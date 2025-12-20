# Tools Documentation

This document provides detailed specifications for all tools in the Strands Agent Chatbot platform.

## Overview

The platform implements **30 tools** across 4 protocol types:
- **21 tools** are production-ready (✅ Implemented)
- **9 tools** are in development (🚧 In Progress)

## Tool Categories

### 1. Local Tools (5 tools)

Local tools are Python functions executed directly in the AgentCore Runtime container using Strands `@tool` decorator.

| Tool | Function ID | Description | Protocol | API Keys | Status |
|------|------------|-------------|----------|----------|--------|
| **Calculator** | `calculator` | Mathematical computations and calculations | Direct call | No | ✅ |
| **Weather Lookup** | `get_current_weather` | Current weather by city (worldwide) | Direct call | No | ✅ |
| **Visualization Creator** | `create_visualization` | Interactive charts using Plotly | Direct call | No | ✅ |
| **Web Search** | `ddg_web_search` | Web search via DuckDuckGo | Direct call | No | ✅ |
| **URL Fetcher** | `fetch_url_content` | Extract content from web URLs | Direct call | No | ✅ |

**Implementation:**
- Location: `chatbot-app/agentcore/src/local_tools/`
- Protocol: Direct Python function calls
- Registration: `agent.py` imports and adds to `TOOL_REGISTRY`

**Example:**
```python
from strands import tool

@tool
def get_current_weather(city: str) -> str:
    """Get current weather for a city"""
    # Implementation using wttr.in API
    ...
```

---

### 2. Built-in Tools (4 tools)

Built-in tools leverage AWS Bedrock AgentCore services via AWS SDK. These tools require IAM permissions.

| Tool | Function ID | Description | AgentCore Service | API Key |
|------|------------|-------------|-------------------|---------|
| **Diagram Generator** | `generate_diagram_and_validate` | Generate diagrams/charts using Python code | Code Interpreter | No |
| **Browser Navigate** | `browser_navigate` | Navigate browser to URL and capture screenshot | Browser + Nova Act | Yes |
| **Browser Action** | `browser_act` | Execute browser actions via natural language | Browser + Nova Act | Yes |
| **Browser Extract** | `browser_extract` | Extract structured data from web pages | Browser + Nova Act | Yes |

**Implementation:**
- Location: `chatbot-app/agentcore/src/builtin_tools/`
- Protocol: AWS SDK (boto3) + WebSocket for browser automation
- Authentication: IAM role-based
- Browser automation requires AgentCore Browser API access

#### Diagram Generator

**Service:** AgentCore Code Interpreter

**Capabilities:**
- Execute Python code in sandboxed environment
- Generate charts and diagrams (matplotlib, seaborn, pandas, numpy)
- Return PNG images as raw bytes

**Example Usage:**
```python
generate_diagram_and_validate(
    python_code="""
import matplotlib.pyplot as plt
import numpy as np

x = np.linspace(0, 10, 100)
y = np.sin(x)

plt.figure(figsize=(10, 6))
plt.plot(x, y)
plt.savefig('chart.png', dpi=300, bbox_inches='tight')
    """,
    diagram_filename="chart.png"
)
```

**Output Format:**
```python
{
    "content": [
        {"text": "✅ Diagram generated successfully: chart.png"},
        {"image": {"format": "png", "source": {"bytes": b"..."}}}
    ],
    "status": "success"
}
```

#### Browser Tools (Nova Act)

**Service:** AgentCore Browser with Nova Act AI model

**Protocol:** AWS SDK + WebSocket
- AWS SDK for session management and control
- WebSocket for real-time bidirectional communication
- Enables streaming browser interactions

**Capabilities:**
- Visual understanding of web pages
- Natural language interaction with UI elements
- Structured data extraction from visual content

**Browser Navigate:**
- Navigate to URL and capture screenshot
- Returns current page state as PNG image

**Browser Action:**
- Execute actions via natural language instructions (English only)
- Examples: "Click the first product", "Type 'laptop' in search box and click search"
- Returns screenshot showing action result

**Browser Extract:**
- Extract structured data from current page
- AI-powered visual analysis (no pre-defined schema required)
- Returns JSON data

**Implementation Details:**
- Location: `chatbot-app/agentcore/src/builtin_tools/nova_act_browser_tools.py`
- Controller: `browser_controller.py` manages session lifecycle and WebSocket connection
- Session isolation: Each conversation has isolated browser via `SESSION_ID` env var

---

### 3. Gateway Tools (12 tools via 5 Lambda functions)

Gateway tools are Lambda functions or OpenAPI implementations exposed through AgentCore Gateway, which converts them to MCP (Model Context Protocol) endpoints. This implementation uses SigV4 authentication (AgentCore Gateway supports multiple auth methods).

#### Wikipedia (2 tools)

**Lambda:** `mcp-wikipedia`
**API Keys:** None
**Status:** ✅ Implemented

| Tool | MCP Function | Description |
|------|--------------|-------------|
| Wikipedia Search | `wikipedia_search` | Search Wikipedia articles |
| Wikipedia Get Article | `wikipedia_get_article` | Get full article content |

#### ArXiv (2 tools)

**Lambda:** `mcp-arxiv`
**API Keys:** None
**Status:** ✅ Implemented

| Tool | MCP Function | Description |
|------|--------------|-------------|
| ArXiv Search | `arxiv_search` | Search scientific papers |
| ArXiv Get Paper | `arxiv_get_paper` | Get paper content by paper ID |

#### Google Search (2 tools)

**Lambda:** `mcp-google-search`
**API Keys:** Google API Key + Custom Search Engine ID
**Status:** ✅ Implemented

| Tool | MCP Function | Description |
|------|--------------|-------------|
| Google Web Search | `google_web_search` | Web search via Google Custom Search |
| Google Image Search | `google_image_search` | Image search via Google |

**Setup:**
```bash
aws secretsmanager put-secret-value \
  --secret-id strands-agent-chatbot/mcp/google-credentials \
  --secret-string '{"api_key":"YOUR_KEY","search_engine_id":"YOUR_ID"}'
```

#### Tavily AI (2 tools)

**Lambda:** `mcp-tavily`
**API Keys:** Tavily API Key
**Status:** ✅ Implemented

| Tool | MCP Function | Description |
|------|--------------|-------------|
| Tavily AI Search | `tavily_search` | AI-powered web search |
| Tavily Extract | `tavily_extract` | Clean content extraction from URLs |

**Setup:**
```bash
aws secretsmanager put-secret-value \
  --secret-id strands-agent-chatbot/mcp/tavily-api-key \
  --secret-string "YOUR_KEY"
```

#### Financial Market (4 tools)

**Lambda:** `mcp-finance`
**Data Source:** Yahoo Finance
**API Keys:** None
**Status:** ✅

| Tool | MCP Function | Description |
|------|--------------|-------------|
| Stock Quote | `stock_quote` | Current stock quote with key metrics |
| Stock History | `stock_history` | Historical price data |
| Financial News | `financial_news` | Latest financial news articles |
| Stock Analysis | `stock_analysis` | Comprehensive stock analysis |

**Features:**
- Real-time stock quotes and historical data via Yahoo Finance API
- No API key required (public data access)
- Supports major global stock exchanges

**Implementation Details:**

**Protocol:** MCP (Model Context Protocol)
- Lambda functions expose MCP-compatible endpoints
- Strands `MCPClient` connects via streamable HTTP transport
- SigV4 authentication via `httpx.Auth` class

**Code Reference:**
```python
# gateway_mcp_client.py
mcp_client = MCPClient(
    lambda: streamablehttp_client(
        gateway_url,
        auth=get_sigv4_auth(region)  # AWS SigV4 signing
    )
)
```

**Tool Filtering:**
- `FilteredMCPClient` filters tools based on user selection
- Reduces token usage by excluding disabled tools from model prompt

---

### 4. Runtime Tools (9 tools - Work in Progress)

Runtime tools use Agent-to-Agent (A2A) protocol for communication between AgentCore Runtimes.

#### Report Writer (9 tools)

**Runtime:** AgentCore Report Writer
**Protocol:** A2A (Agent-to-Agent)
**API Keys:** None
**Status:** 🚧 In Progress

| Tool | MCP Function | Description | Status |
|------|--------------|-------------|--------|
| Create Report | `create_report` | Create new report with title and outline | 🚧 |
| Write Section | `write_section` | Write section with markdown content | 🚧 |
| Generate Chart | `generate_chart` | Generate charts using Python code | 🚧 |
| Insert Chart | `insert_chart` | Insert generated chart into report | 🚧 |
| Read Report | `read_report` | Read current report content | 🚧 |
| Replace Text | `replace_text` | Find and replace text in report | 🚧 |
| Get Outline | `get_outline` | Get report outline | 🚧 |
| Finalize Report | `finalize_report` | Convert to DOCX and save to S3 | 🚧 |
| Clear Report | `clear_report` | Clear current report | 🚧 |

**Planned Capabilities:**
- Multi-section research report generation
- Chart generation via Code Interpreter
- DOCX export with S3 storage
- Collaborative report editing

**Architecture:**
- Separate AgentCore Runtime dedicated to report generation
- A2A protocol enables runtime-to-runtime communication
- Main agent delegates complex report tasks to Report Writer agent

---

## Tool Selection and Filtering

### Dynamic Tool Filtering

Users can enable/disable tools via UI sidebar. Selected tools are filtered before agent creation.

**Configuration:** `chatbot-app/frontend/src/config/tools-config.json`

```json
{
  "local_tools": [...],
  "builtin_tools": [...],
  "gateway_targets": [...],
  "agentcore_runtime_mcp": [...]
}
```

**Properties:**
- `id`: Unique tool identifier
- `name`: Display name in UI
- `description`: Tool description
- `category`: Tool category (utilities, search, etc.)
- `enabled`: Default enabled state
- `isDynamic`: Whether users can toggle on/off

**Implementation:**
```python
# agent.py:277-318
def get_filtered_tools(enabled_tools):
    filtered_tools = []
    for tool_id in enabled_tools:
        if tool_id in TOOL_REGISTRY:
            filtered_tools.append(TOOL_REGISTRY[tool_id])
        elif tool_id.startswith("gateway_"):
            # Add to Gateway tool filter list
            gateway_tool_ids.append(tool_id)

    # Create filtered Gateway MCP client
    if gateway_tool_ids:
        gateway_client = create_filtered_gateway_client(gateway_tool_ids)
        filtered_tools.append(gateway_client)

    return filtered_tools
```

### Benefits of Dynamic Filtering

1. **Token Optimization**: Only selected tool definitions sent to model
2. **Per-User Customization**: Each user has custom tool combination
3. **Real-Time Updates**: Tool changes without redeployment
4. **Cost Efficiency**: Reduced input tokens = lower API costs

---

## Protocol Comparison

| Protocol | Latency | Deployment | Auth | Use Case |
|----------|---------|------------|------|----------|
| **Direct call** | Lowest | In-container | N/A | Simple utilities |
| **AWS SDK** | Low | AWS services | IAM | AgentCore-powered features (Code Interpreter, Browser) |
| **WebSocket** | Low | AWS services | IAM | Real-time browser automation |
| **MCP + SigV4** | Medium | Lambda via AgentCore Gateway | AWS SigV4 | External APIs, scalable services |
| **A2A** | Medium-High | AgentCore Runtime | AgentCore | Complex agent collaboration |

**Selection Criteria:**
- **Direct call**: Lightweight utilities, no external dependencies
- **AWS SDK**: Leverage AgentCore capabilities (Code Interpreter, Browser)
- **WebSocket**: Real-time bidirectional communication for browser automation
- **MCP + SigV4**: Lambda/OpenAPI implementations exposed as MCP endpoints via AgentCore Gateway
- **A2A**: Complex multi-agent workflows, specialized agents

---

## Adding New Tools

### Local Tool

1. Create tool file in `chatbot-app/agentcore/src/local_tools/`
2. Implement with `@tool` decorator
3. Add to `TOOL_REGISTRY` in `agent.py`
4. Add configuration to `tools-config.json`

### Built-in Tool

1. Create tool file in `chatbot-app/agentcore/src/builtin_tools/`
2. Implement AWS SDK calls to Bedrock services
3. Add to `TOOL_REGISTRY` in `agent.py`
4. Add configuration to `tools-config.json`

### Gateway Tool

1. Create Lambda function with MCP server
2. Deploy to AgentCore Gateway stack
3. Configure in `tools-config.json` with `gateway_` prefix
4. Add API key setup to documentation (if required)

### Runtime Tool

1. Create new AgentCore Runtime with specialized agent
2. Implement A2A protocol endpoints
3. Configure endpoint ARN in `tools-config.json`
4. Add to `agentcore_runtime_mcp` section

---

## Tool Output Formats

All tools return results in Strands `ToolResult` format:

**Text-only:**
```python
{
    "content": [{"text": "Result text"}],
    "status": "success"
}
```

**Multimodal (text + image):**
```python
{
    "content": [
        {"text": "Description"},
        {"image": {"format": "png", "source": {"bytes": b"..."}}}
    ],
    "status": "success"
}
```

**Error:**
```python
{
    "content": [{"text": "Error message"}],
    "status": "error"
}
```

Image and document content is delivered as **raw bytes** (not base64), following Bedrock's native content format.
