"""Swarm Configuration - Shared guidelines and agent tool mapping

This module defines:
- COMMON_GUIDELINES: Shared prompt injected into all agents
- AGENT_TOOL_MAPPING: Tools assigned to each specialist agent
- AGENT_DESCRIPTIONS: Brief descriptions for handoff reference
- SPECIALIST_PROMPTS: Agent-specific role and routing
"""

from typing import Dict, List


# Agent descriptions for handoff reference (other agents see these)
AGENT_DESCRIPTIONS: Dict[str, str] = {
    "coordinator": "Task analysis and routing to appropriate specialists",
    "web_researcher": "Web search, URL content extraction, Wikipedia lookup",
    "academic_researcher": "Academic paper search and retrieval from arXiv",
    "word_agent": "Word document (.docx) creation and modification",
    "excel_agent": "Excel spreadsheet (.xlsx) creation and modification",
    "powerpoint_agent": "PowerPoint presentation (.pptx) creation and modification",
    "data_analyst": "Charts, diagrams, visualizations, and mathematical calculations",
    "browser_agent": "Browser automation for dynamic pages, forms, and screenshots",
    "weather_agent": "Current weather and forecast information",
    "finance_agent": "Stock quotes, price history, and financial analysis",
    "maps_agent": "Place search, directions, and map display",
    "responder": "Final response generation for the user",
}


# Tool mapping per agent (based on existing Tool Groups)
AGENT_TOOL_MAPPING: Dict[str, List[str]] = {
    "coordinator": [],
    "web_researcher": [
        "ddg_web_search",
        "fetch_url_content",
        "gateway_wikipedia_search",
        "gateway_wikipedia_get_article",
    ],
    "academic_researcher": [
        "gateway_arxiv_search",
        "gateway_arxiv_get_paper",
    ],
    "word_agent": [
        "create_word_document",
        "modify_word_document",
        "list_my_word_documents",
        "read_word_document",
    ],
    "excel_agent": [
        "create_excel_spreadsheet",
        "modify_excel_spreadsheet",
        "list_my_excel_spreadsheets",
        "read_excel_spreadsheet",
    ],
    "powerpoint_agent": [
        "list_my_powerpoint_presentations",
        "get_presentation_layouts",
        "analyze_presentation",
        "create_presentation",
        "update_slide_content",
        "add_slide",
        "delete_slides",
        "move_slide",
        "duplicate_slide",
        "update_slide_notes",
    ],
    "data_analyst": [
        "create_visualization",
        "generate_diagram_and_validate",
        "calculator",
    ],
    "browser_agent": [
        "browser_navigate",
        "browser_act",
        "browser_extract",
        "browser_get_page_info",
        "browser_manage_tabs",
        "browser_drag",
        "browser_save_screenshot",
    ],
    "weather_agent": [
        "gateway_get_today_weather",
        "gateway_get_weather_forecast",
    ],
    "finance_agent": [
        "gateway_stock_quote",
        "gateway_stock_history",
        "gateway_stock_analysis",
    ],
    "maps_agent": [
        "gateway_search_places",
        "gateway_search_nearby_places",
        "gateway_get_place_details",
        "gateway_get_directions",
        "gateway_show_on_map",
    ],
    "responder": [],  # No tools - final response only
}


# =============================================================================
# COMMON GUIDELINES (injected into ALL agents)
# =============================================================================

COMMON_GUIDELINES = """
## Swarm Collaboration Rules

### Be Concise
- Keep text minimal - no lengthy explanations or status updates
- Focus on tools and handoff, not narration
- Responder writes the final detailed response

### Data Transfer (IMPORTANT)
Tool results are NOT auto-shared. Pass data via handoff context:

```
handoff_to_agent(
  agent_name="next_agent",
  message="brief summary",
  context={"data": <YOUR_TOOL_RESULTS>}
)
```

### Rules
- Read "Shared knowledge from previous agents" for input data
- Never handoff back to sender
"""


def build_available_agents(exclude_agent: str = "") -> str:
    """Build available agents list for prompt."""
    lines = [
        f"- {name}: {desc}"
        for name, desc in AGENT_DESCRIPTIONS.items()
        if name != exclude_agent
    ]
    return "## Available Agents\n" + "\n".join(lines)


# =============================================================================
# SPECIALIST PROMPTS (agent-specific role and routing only)
# =============================================================================

SPECIALIST_PROMPTS: Dict[str, str] = {
    "coordinator": """Coordinator - analyze requests and route to the right specialist.

Route based on task type:
- Greetings/simple chat → responder
- Weather → weather_agent
- Stocks/finance → finance_agent
- Location/maps → maps_agent
- Web search/research → web_researcher
- Academic papers → academic_researcher
- Charts/calculations → data_analyst
- Browser automation → browser_agent
- Word docs → word_agent
- Excel → excel_agent
- PowerPoint → powerpoint_agent
""",

    "web_researcher": """Web Researcher - search and extract web content.
Use tools, then handoff with results in context. Route: documents→doc agents, charts→data_analyst, done→responder""",

    "academic_researcher": """Academic Researcher - arXiv paper search.
Use tools, then handoff with results in context. Route: documents→doc agents, charts→data_analyst, done→responder""",

    "word_agent": """Word Agent - create/modify .docx documents.
Use tools, then handoff with results in context. Route: charts→data_analyst, research→web_researcher, done→responder""",

    "excel_agent": """Excel Agent - create/modify .xlsx spreadsheets.
Use tools, then handoff with results in context. Route: charts→data_analyst, research→web_researcher, done→responder""",

    "powerpoint_agent": """PowerPoint Agent - create/modify .pptx presentations.
Use tools, then handoff with results in context. Route: charts→data_analyst, research→web_researcher, done→responder""",

    "data_analyst": """Data Analyst - visualizations and calculations.
Use tools, then handoff with results in context. Route: embed in Word→word_agent, PowerPoint→powerpoint_agent, done→responder""",

    "browser_agent": """Browser Agent - web automation and screenshots.
Use tools, then handoff with results in context. Route: documents→doc agents, done→responder""",

    "weather_agent": """Weather Agent - current weather and forecasts.
Use tools, then handoff to responder with weather data in context.""",

    "finance_agent": """Finance Agent - stocks and financial data.
Use tools, then handoff with results in context. Route: charts→data_analyst, documents→doc agents, done→responder""",

    "maps_agent": """Maps Agent - places and directions.
Use tools, then handoff to responder with location data in context.""",

    "responder": """You are the Responder - write the final user-facing response.

Your role:
- Read "Shared knowledge from previous agents" for all collected data
- Generate a clear, well-formatted response using that data
- Reference any created files or charts

IMPORTANT: You are the FINAL agent. Do NOT call handoff_to_agent.
If no data was provided, state that information is unavailable.
""",
}


def build_agent_system_prompt(agent_name: str) -> str:
    """Build complete system prompt for an agent.

    Structure:
    1. Specialist prompt (role + routing)
    2. Common guidelines (handoff rules, data transfer)
    3. Available agents list

    Args:
        agent_name: Name of the agent

    Returns:
        Complete system prompt
    """
    specialist = SPECIALIST_PROMPTS.get(agent_name, "")
    available = build_available_agents(exclude_agent=agent_name)

    return f"{specialist}\n{COMMON_GUIDELINES}\n{available}"
