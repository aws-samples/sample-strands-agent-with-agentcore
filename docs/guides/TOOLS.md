# Tools Documentation

This document provides detailed specifications for all tools in the Strands Agent Chatbot platform.

## Overview

The platform implements **81 tools** across 6 protocol categories and **18 tool groups**:

| Category | Tool Groups | Tools | Protocol |
|----------|-------------|-------|----------|
| Local Tools | 4 | 4 | Direct call |
| Built-in Tools | 4 | 23 | AWS SDK (Code Interpreter) |
| Browser Automation | 2 | 7 | AWS SDK + WebSocket / A2A |
| Gateway Tools | 7 | 20 | MCP + SigV4 (Lambda) |
| Runtime A2A | 1 | 1 | A2A |
| Runtime MCP (3LO) | 3 | 26 | MCP (OAuth) |

## Tool Categories

### 1. Local Tools (4 tools)

Python functions executed directly in the AgentCore Runtime container using Strands `@tool` decorator.

| Tool | ID | Description |
|------|----|-------------|
| Calculator | `calculator` | Mathematical computations and calculations |
| Visualization Creator | `create_visualization` | Interactive charts using Plotly |
| Web Search (DuckDuckGo) | `ddg_web_search` | Web search via DuckDuckGo |
| URL Fetcher | `fetch_url_content` | Extract content from web URLs |

**Implementation:**
- Location: `chatbot-app/agentcore/src/local_tools/`
- Protocol: Direct Python function calls
- Registration: `agent.py` imports and adds to `TOOL_REGISTRY`

**Example:**
```python
from strands import tool

@tool
def ddg_web_search(query: str, max_results: int = 5) -> str:
    """Search the web using DuckDuckGo"""
    ...
```

---

### 2. Built-in Tools (23 tools in 4 groups)

Built-in tools leverage AWS Bedrock AgentCore Code Interpreter for sandboxed Python execution. Used for diagram generation and document creation/editing.

#### Diagram Generator (1 tool)

| Tool | ID | Description |
|------|----|-------------|
| Diagram Generator | `generate_diagram_and_validate` | Generate diagrams/charts using Python code |

- Executes Python in sandboxed Code Interpreter
- Available libraries: matplotlib, pandas, numpy
- Returns PNG images as raw bytes

#### Word Documents (5 tools)

Create, modify, and manage Word documents with automatic S3 storage.

| Tool | ID | Description |
|------|----|-------------|
| Create Document | `create_word_document` | Create new Word document from Markdown content |
| Modify Document | `modify_word_document` | Edit existing document using python-docx code |
| List Documents | `list_my_word_documents` | List all Word documents in workspace |
| Read Document | `read_word_document` | Read and download document from workspace |
| Preview Pages | `preview_word_page` | Get page screenshots for visual inspection |

- Sequential execution required (prevents S3 race conditions)
- Available libraries: python-docx, matplotlib, pandas, numpy

#### Excel Spreadsheets (5 tools)

Create, modify, and manage Excel spreadsheets with automatic S3 storage.

| Tool | ID | Description |
|------|----|-------------|
| Create Spreadsheet | `create_excel_spreadsheet` | Create new Excel spreadsheet with openpyxl code |
| Modify Spreadsheet | `modify_excel_spreadsheet` | Edit existing spreadsheet using openpyxl code |
| List Spreadsheets | `list_my_excel_spreadsheets` | List all spreadsheets in workspace |
| Read Spreadsheet | `read_excel_spreadsheet` | Read and download spreadsheet from workspace |
| Preview Sheets | `preview_excel_sheets` | Get sheet screenshots for visual inspection |

- Formulas auto-recalculated via LibreOffice after save
- Available libraries: openpyxl, matplotlib, pandas, numpy

#### PowerPoint Presentations (12 tools)

Create, modify, and manage PowerPoint presentations with full slide manipulation.

| Tool | ID | Description |
|------|----|-------------|
| Get Slide Examples | `get_slide_code_examples` | Get python-pptx code examples for slide creation |
| List Presentations | `list_my_powerpoint_presentations` | List all presentations in workspace |
| Get Layouts | `get_presentation_layouts` | Get available slide layouts from presentation |
| Analyze Presentation | `analyze_presentation` | Analyze structure with element IDs for editing |
| Create Presentation | `create_presentation` | Create from outline or blank |
| Update Slides | `update_slide_content` | Edit slides using operations (replace_text, replace_image, etc.) |
| Add Slide | `add_slide` | Add new slide at specified position |
| Delete Slides | `delete_slides` | Delete one or more slides by indices |
| Move Slide | `move_slide` | Move slide from one position to another |
| Duplicate Slide | `duplicate_slide` | Copy slide to specified position |
| Update Notes | `update_slide_notes` | Update speaker notes for a slide |
| Preview Slides | `preview_presentation_slides` | Get slide screenshots for visual inspection |

- Uses python-pptx for slide generation

**Implementation:**
- Location: `chatbot-app/agentcore/src/builtin_tools/`
- Protocol: AWS SDK (boto3) for Code Interpreter invocation
- Authentication: IAM role-based

---

### 3. Browser Automation (7 tools in 2 groups)

#### Nova Act Browser Control (6 tools)

Web browser automation powered by Nova Act AI model with WebSocket-based real-time interaction.

| Tool | ID | Description |
|------|----|-------------|
| Navigate | `browser_navigate` | Navigate browser to a URL and capture screenshot |
| Browser Action | `browser_act` | Execute actions via natural language (click, type, scroll) |
| Extract Data | `browser_extract` | Extract structured data (auto-scrolls entire page) |
| Get Page Info | `browser_get_page_info` | Get page structure and all open tabs (fast, no AI) |
| Manage Tabs | `browser_manage_tabs` | Switch, close, or create browser tabs |
| Save Screenshot | `browser_save_screenshot` | Save screenshot to workspace for document use |

- Protocol: AWS SDK + WebSocket for real-time bidirectional communication
- Session isolation: Each conversation has isolated browser via `SESSION_ID`
- Location: `chatbot-app/agentcore/src/builtin_tools/nova_act_browser_tools.py`

#### Browser-Use Agent (1 tool)

Autonomous browser automation powered by browser-use AI, deployed as a separate AgentCore Runtime.

| Tool | ID | Description |
|------|----|-------------|
| Browser Automation Skill | `agentcore_browser-use-agent` | Execute multi-step browser tasks with AI-driven adaptive navigation |

- Protocol: A2A (Agent-to-Agent) communication between runtimes
- Supports live view of browser activity

---

### 4. Gateway Tools (20 tools in 7 groups)

Lambda functions exposed through AgentCore Gateway as MCP (Model Context Protocol) endpoints with SigV4 authentication.

#### Weather (2 tools)

| Tool | ID | Description |
|------|----|-------------|
| Today's Weather | `gateway_get_today_weather` | Current weather and today's hourly forecast |
| Weather Forecast | `gateway_get_weather_forecast` | Multi-day forecast (up to 16 days) |

- API: Open-Meteo (no API key required)

#### Financial Market (4 tools)

| Tool | ID | Description |
|------|----|-------------|
| Stock Quote | `gateway_stock_quote` | Current stock quote with key metrics |
| Stock History | `gateway_stock_history` | Historical stock price data |
| Financial News | `gateway_financial_news` | Latest financial news articles |
| Stock Analysis | `gateway_stock_analysis` | Comprehensive stock analysis |

- API: Yahoo Finance (no API key required)

#### ArXiv (2 tools)

| Tool | ID | Description |
|------|----|-------------|
| Search Papers | `gateway_arxiv_search` | Search scientific papers on ArXiv |
| Get Paper | `gateway_arxiv_get_paper` | Get full paper content by paper ID |

#### Google Search (1 tool)

| Tool | ID | Description |
|------|----|-------------|
| Web Search (Google) | `gateway_google_web_search` | Web search via Google Custom Search (includes image results) |

- API Keys: Google API Key + Custom Search Engine ID

#### Google Maps (7 tools)

| Tool | ID | Description |
|------|----|-------------|
| Search Places | `gateway_search_places` | Search for places using text query |
| Nearby Places | `gateway_search_nearby_places` | Search for places near a specific location |
| Place Details | `gateway_get_place_details` | Get detailed info about a place including reviews |
| Get Directions | `gateway_get_directions` | Step-by-step directions between two locations |
| Geocode Address | `gateway_geocode_address` | Convert address to geographic coordinates |
| Reverse Geocode | `gateway_reverse_geocode` | Convert coordinates to address |
| Show on Map | `gateway_show_on_map` | Display locations and routes on interactive Google Map |

- API Keys: Google Maps API Key

#### Wikipedia (2 tools)

| Tool | ID | Description |
|------|----|-------------|
| Search Articles | `gateway_wikipedia_search` | Search Wikipedia for articles |
| Get Article | `gateway_wikipedia_get_article` | Get full content of a Wikipedia article |

#### Tavily AI (2 tools)

| Tool | ID | Description |
|------|----|-------------|
| Web Search (Tavily) | `gateway_tavily_search` | AI-powered web search using Tavily |
| Content Extract | `gateway_tavily_extract` | Extract clean content from web URLs |

- API Keys: Tavily API Key

**Implementation:**

```python
# gateway_mcp_client.py
mcp_client = MCPClient(
    lambda: streamablehttp_client(
        gateway_url,
        auth=get_sigv4_auth(region)  # AWS SigV4 signing
    )
)
```

- Lambda functions expose MCP-compatible endpoints
- `FilteredMCPClient` filters tools based on user selection to reduce token usage

---

### 5. Runtime A2A Tools (1 tool)

Agent-to-Agent protocol for communication between AgentCore Runtimes.

#### Research Agent

| Tool | ID | Description |
|------|----|-------------|
| Research Agent | `agentcore_research-agent` | Web research and markdown report generation |

- Separate AgentCore Runtime dedicated to research
- Results displayed directly in Research Modal UI
- Protocol: A2A (Agent-to-Agent)

---

### 6. Runtime MCP Tools - 3LO OAuth (26 tools in 3 groups)

MCP servers running on AgentCore Runtime with Google/Notion OAuth (3-Legged OAuth) for user-level authentication.

#### Gmail (10 tools)

Full email management via Google OAuth.

| Tool | ID | Description |
|------|----|-------------|
| List Labels | `mcp_list_labels` | List all Gmail labels |
| List Emails | `mcp_list_emails` | List emails by label |
| Search Emails | `mcp_search_emails` | Search using Gmail query syntax |
| Read Email | `mcp_read_email` | Read full email message |
| Send Email | `mcp_send_email` | Send email with CC, BCC, HTML body |
| Draft Email | `mcp_draft_email` | Create email draft |
| Delete Email | `mcp_delete_email` | Delete email (trash or permanent) |
| Bulk Delete Emails | `mcp_bulk_delete_emails` | Permanently delete multiple emails by query |
| Modify Email | `mcp_modify_email` | Add/remove labels (read/unread, star, archive) |
| Get Thread | `mcp_get_email_thread` | Get all messages in a conversation thread |

#### Google Calendar (8 tools)

Calendar management via Google OAuth.

| Tool | ID | Description |
|------|----|-------------|
| List Calendars | `mcp_list_calendars` | List all user's calendars |
| List Events | `mcp_list_events` | List events with date range and search filters |
| Get Event | `mcp_get_event` | Get detailed event information |
| Create Event | `mcp_create_event` | Create event with attendees and reminders |
| Update Event | `mcp_update_event` | Update existing event |
| Delete Event | `mcp_delete_event` | Delete event with optional notification |
| Quick Add Event | `mcp_quick_add_event` | Create event from natural language text |
| Check Availability | `mcp_check_availability` | Check free/busy status for scheduling |

#### Notion (8 tools)

Notion workspace management via Notion OAuth.

| Tool | ID | Description |
|------|----|-------------|
| Search Notion | `mcp_notion_search` | Search across all accessible pages and databases |
| List Databases | `mcp_notion_list_databases` | List all shared databases |
| Query Database | `mcp_notion_query_database` | Query database with filters and sorts |
| Get Page | `mcp_notion_get_page` | Get page properties and metadata |
| Create Page | `mcp_notion_create_page` | Create new page in database or as child page |
| Update Page | `mcp_notion_update_page` | Update page properties |
| Get Page Content | `mcp_notion_get_block_children` | Get content blocks (paragraphs, headings, lists) |
| Append Content | `mcp_notion_append_blocks` | Add content blocks to a page |

---

## Tool Selection and Filtering

### Dynamic Tool Filtering

Users can enable/disable tools via UI sidebar. Selected tools are filtered before agent creation.

**Configuration:** `chatbot-app/frontend/src/config/tools-config.json`

```json
{
  "local_tools": [...],
  "builtin_tools": [...],
  "browser_automation": [...],
  "gateway_targets": [...],
  "agentcore_runtime_a2a": [...],
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
- `tools`: Sub-tools for grouped tool entries
- `systemPromptGuidance`: Tool-specific instructions injected into system prompt
- `usesCitation`: Whether tool results should include source citations
- `tags`: Used for smart tool recommendation

---

## Protocol Comparison

| Protocol | Deployment | Auth | Use Case |
|----------|------------|------|----------|
| **Direct call** | In-container | N/A | Simple utilities |
| **AWS SDK** | AWS services | IAM | Code Interpreter, Document generation |
| **WebSocket** | AWS services | IAM | Real-time browser automation |
| **MCP + SigV4** | Lambda via Gateway | AWS SigV4 | External APIs, scalable services |
| **MCP + 3LO** | AgentCore Runtime | OAuth | User-authenticated services (Gmail, Calendar, Notion) |
| **A2A** | AgentCore Runtime | AgentCore | Agent collaboration (Research, Browser-Use) |

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

### Runtime A2A Tool

1. Create new AgentCore Runtime with specialized agent
2. Implement A2A protocol endpoints
3. Configure endpoint ARN in `tools-config.json` under `agentcore_runtime_a2a`

### Runtime MCP Tool (3LO)

1. Create MCP server with OAuth provider integration
2. Deploy as AgentCore Runtime
3. Configure in `tools-config.json` under `agentcore_runtime_mcp`
4. Set up OAuth credentials and callback URLs

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
