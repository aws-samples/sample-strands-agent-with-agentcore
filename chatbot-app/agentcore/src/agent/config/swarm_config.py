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
    "word_agent": "Word document (.docx) creation - only when user explicitly requests document",
    "excel_agent": "Excel spreadsheet (.xlsx) creation - only when user explicitly requests spreadsheet",
    "powerpoint_agent": "PowerPoint (.pptx) creation - only when user explicitly requests presentation",
    "data_analyst": "Diagrams (PNG images) and mathematical calculations",
    "browser_agent": "Browser automation for dynamic pages, forms, and screenshots",
    "weather_agent": "Current weather and forecast information",
    "finance_agent": "Stock quotes, price history, and financial analysis",
    "maps_agent": "Place search, directions, and map display",
    "responder": "Final response and simple interactive charts (bar, line, pie)",
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
    "responder": [
        "create_visualization",
    ],
}


# =============================================================================
# COMMON GUIDELINES (injected into all agents except responder)
# =============================================================================

COMMON_GUIDELINES = """
## Rules
- Be concise - focus on tools, not narration
- Include ONLY your own results in handoff context (previous data is auto-accumulated)
- CRITICAL: You MUST call handoff_to_agent when done. NEVER finish without handoff.
  - If ALL user tasks are complete → handoff to "responder"
  - If more work needed by another specialist → handoff to that specialist
"""


# =============================================================================
# SPECIALIST PROMPTS
# =============================================================================

SPECIALIST_PROMPTS: Dict[str, str] = {
    "coordinator": """Coordinator - analyze requests and route to the right specialist.

Check conversation history for context. For follow-ups, infer intent from history.

Routing: greetings/chat → responder | weather → weather_agent | stocks → finance_agent | maps → maps_agent | web search → web_researcher | papers → academic_researcher | simple charts → responder | diagrams/calculations → data_analyst | browser → browser_agent | word → word_agent | excel → excel_agent | powerpoint → powerpoint_agent""",

    "web_researcher": """Web Researcher - search and extract web content.

Context format: {"citations": [{"source": "Title", "url": "...", "content": "key finding"}]}""",

    "academic_researcher": """Academic Researcher - arXiv paper search.

Context format: {"citations": [{"source": "Paper (arXiv:ID)", "url": "...", "content": "key finding"}]}""",

    "word_agent": """Word Agent - create/modify .docx documents.

Handoff context (REQUIRED): {"documents": [{"filename": "actual_filename.docx", "tool_type": "word"}]}""",

    "excel_agent": """Excel Agent - create/modify .xlsx spreadsheets.

Handoff context (REQUIRED): {"documents": [{"filename": "actual_filename.xlsx", "tool_type": "excel"}]}""",

    "powerpoint_agent": """PowerPoint Agent - create/modify .pptx presentations.

Handoff context (REQUIRED): {"documents": [{"filename": "actual_filename.pptx", "tool_type": "powerpoint"}]}""",

    "data_analyst": """Data Analyst - diagrams (PNG) and calculations.

Handoff context (REQUIRED): {"images": [{"filename": "actual_filename.png", "description": "brief description"}]}""",

    "browser_agent": """Browser Agent - web automation and screenshots.""",

    "weather_agent": """Weather Agent - current weather and forecasts.""",

    "finance_agent": """Finance Agent - stocks and financial data.""",

    "maps_agent": """Maps Agent - places and directions.""",

    "responder": """Responder - write the final user-facing response.

Use create_visualization tool for simple charts if needed.
Citation: When citing sources from shared context, use markdown links: [source name](URL)""",
}


def build_agent_system_prompt(agent_name: str) -> str:
    """Build complete system prompt for an agent.

    Structure:
    1. Specialist prompt (role + context format)
    2. Common guidelines (handoff rules) - except for responder

    Note: SDK automatically injects "Shared knowledge from previous agents"
    and "Other agents available for collaboration" into each agent's input.
    """
    specialist = SPECIALIST_PROMPTS.get(agent_name, "")

    # Responder is the final agent - no handoff guidelines needed
    if agent_name == "responder":
        return specialist

    return f"{specialist}\n{COMMON_GUIDELINES}"
