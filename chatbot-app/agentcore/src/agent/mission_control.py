"""Mission Control - Strategic Planner for Autopilot Mode

This module implements Mission Control using Strands Agent:
- Analyzes user requests and decomposes into focused steps
- Issues Directives with minimal, specific tool sets
- Adapts plans based on execution reports
- Currently no tools, but can be extended

Session history is maintained in-memory per mission.
"""

import json
import logging
import os
import re
from typing import List, Optional, Union
from uuid import uuid4

from strands import Agent
from strands.models import BedrockModel

from models.autopilot_schemas import (
    Directive,
    MissionComplete,
    ProgressReport,
    ToolGroup,
)
from agent.agent import get_current_date_pacific

logger = logging.getLogger(__name__)


# ============================================================
# Tool Groups Configuration
# ============================================================

DEFAULT_TOOL_GROUPS: List[ToolGroup] = [
    # === Search Tools ===
    ToolGroup(
        id="basic_web_search",
        name="Basic Web Search",
        tools=["ddg_web_search", "fetch_url_content"],
        capabilities="Quick web search via DuckDuckGo, extract content from URLs"
    ),
    ToolGroup(
        id="advanced_web_search",
        name="Advanced Web Search",
        tools=["gateway_google_web_search", "gateway_tavily_search", "gateway_tavily_extract"],
        capabilities="Google search with images, Tavily AI-powered search for complex research queries"
    ),
    ToolGroup(
        id="academic_search",
        name="Academic Research",
        tools=["gateway_arxiv_search", "gateway_arxiv_get_paper", "gateway_wikipedia_search", "gateway_wikipedia_get_article"],
        capabilities="Search arXiv papers, Wikipedia articles with full content retrieval"
    ),

    # === Document Creation (separated) ===
    ToolGroup(
        id="word_documents",
        name="Word Documents",
        tools=["create_word_document", "modify_word_document", "list_my_word_documents", "read_word_document"],
        capabilities="Create and modify Word documents (.docx) for reports and documentation"
    ),
    ToolGroup(
        id="excel_spreadsheets",
        name="Excel Spreadsheets",
        tools=["create_excel_spreadsheet", "modify_excel_spreadsheet", "list_my_excel_spreadsheets", "read_excel_spreadsheet"],
        capabilities="Create and modify Excel spreadsheets (.xlsx) for data analysis and tables"
    ),
    ToolGroup(
        id="powerpoint_presentations",
        name="PowerPoint Presentations",
        tools=["list_my_powerpoint_presentations", "analyze_presentation", "create_presentation", "update_slide_content", "add_slide", "delete_slides"],
        capabilities="Create and modify PowerPoint presentations (.pptx) for slides and pitches"
    ),

    # === Data Visualization (separated by purpose) ===
    ToolGroup(
        id="simple_charts",
        name="Simple Charts (Web UI Only)",
        tools=["create_visualization"],
        capabilities="Create simple bar, line, pie charts displayed in chat UI only. NOT for documents - these charts cannot be embedded into Word/Excel/PowerPoint files."
    ),
    ToolGroup(
        id="complex_diagrams",
        name="Charts & Diagrams (For Documents)",
        tools=["generate_diagram_and_validate"],
        capabilities="Generate charts, diagrams, flowcharts as image files using Python/matplotlib/plotly. Use this when charts need to be embedded into Word documents, Excel spreadsheets, or PowerPoint presentations."
    ),

    # === Browser Automation ===
    ToolGroup(
        id="browser_control",
        name="Nova Act Browser Control",
        tools=["browser_navigate", "browser_act", "browser_extract", "browser_get_page_info", "browser_save_screenshot"],
        capabilities="UI-based web browsing for tasks requiring real browser interaction (login, forms, dynamic pages)"
    ),

    # === Location & Maps ===
    ToolGroup(
        id="maps_location",
        name="Google Maps & Location",
        tools=["gateway_search_places", "gateway_search_nearby_places", "gateway_get_place_details", "gateway_get_directions", "gateway_show_on_map"],
        capabilities="Search places, get directions, show locations on interactive maps"
    ),

    # === Weather ===
    ToolGroup(
        id="weather",
        name="Weather",
        tools=["gateway_get_today_weather", "gateway_get_weather_forecast"],
        capabilities="Current weather and multi-day forecasts worldwide"
    ),

    # === Finance ===
    ToolGroup(
        id="finance",
        name="Financial Data",
        tools=["gateway_stock_quote", "gateway_stock_history", "gateway_stock_analysis"],
        capabilities="Stock quotes, price history, and stock analysis for investment research and market monitoring"
    ),

    # === Utilities ===
    ToolGroup(
        id="calculation",
        name="Calculation",
        tools=["calculator"],
        capabilities="Mathematical calculations and computations"
    ),
]


def build_tool_groups_yaml(tool_groups: List[ToolGroup]) -> str:
    """Build YAML-like representation of tool groups for system prompt"""
    lines = []
    for group in tool_groups:
        lines.append(f"- {group.name}")
        lines.append(f"  tools: {', '.join(group.tools)}")
        lines.append(f"  capabilities: {group.capabilities}")
        lines.append("")
    return "\n".join(lines)


# ============================================================
# System Prompt
# ============================================================

MISSION_CONTROL_SYSTEM_PROMPT = """You are Mission Control, a strategic task decomposer.

## Your Role
- Issue ONE directive at a time based on current needs
- Adapt dynamically based on execution reports
- You do NOT execute tools - you only plan the next step

## Available Tool Groups
{tool_groups_yaml}

## Step Separation Rules (CRITICAL)
Each step MUST use tools from only ONE Tool Group.

## Directive Guidelines
- prompt: 2-3 sentences, clear and actionable
- tools: Select tools from ONE Tool Group only
- expected_output: 1 sentence describing success criteria

## Response Format
Always respond with valid JSON only.

For next directive:
{{
  "type": "directive",
  "step": 1,
  "prompt": "Search for AI market trends and key statistics.",
  "tools": ["ddg_web_search", "fetch_url_content"],
  "expected_output": "Key statistics and source URLs about AI trends"
}}

For mission complete:
{{
  "type": "mission_complete",
  "total_steps": 3
}}

## Adaptive Planning
- Focus on the NEXT step only, not the entire plan
- After each report, decide: continue with next step OR mission_complete
- If the task is done, issue mission_complete immediately
- Don't add unnecessary steps

## Error Handling
- If agent reports failure: simplify or try alternative
- After 2 failures: complete mission early

## Tool Validation
- ONLY use tools listed above
- Never invent tool names
"""


# ============================================================
# Mission Control Class
# ============================================================

class MissionControl:
    """Strategic planner using Strands Agent"""

    def __init__(
        self,
        session_id: str,
        user_id: Optional[str] = None,
        tool_groups: Optional[List[ToolGroup]] = None,
        model_id: str = "us.anthropic.claude-haiku-4-5-20251001-v1:0",
        region: Optional[str] = None
    ):
        self.session_id = f"mc-{session_id}"  # Separate memory namespace for Mission Control
        self.user_id = user_id or "anonymous"
        self.mission_id = f"mission-{uuid4().hex[:8]}"
        self.tool_groups = tool_groups or DEFAULT_TOOL_GROUPS
        self.model_id = model_id
        self.region = region or os.environ.get("AWS_REGION", "us-west-2")

        # Build system prompt with tool catalog and current date
        tool_groups_yaml = build_tool_groups_yaml(self.tool_groups)
        current_date = get_current_date_pacific()
        self.system_prompt = MISSION_CONTROL_SYSTEM_PROMPT.format(
            tool_groups_yaml=tool_groups_yaml
        ) + f"\n\nCurrent date: {current_date}"

        # Create session manager for conversation persistence
        self.session_manager = self._create_session_manager()

        # Create Strands Agent with session manager
        self._create_agent()

        logger.info(f"[MissionControl] Initialized: session={self.session_id}, user={self.user_id}, mission={self.mission_id}")

    def _create_session_manager(self):
        """Create session manager for Mission Control conversation persistence.

        Uses the same pattern as ChatbotAgent but with mc- prefixed session_id.
        """
        from pathlib import Path

        # Check for AgentCore Memory (cloud mode)
        memory_id = os.environ.get('MEMORY_ID')

        try:
            from bedrock_agentcore.memory.integrations.strands.config import AgentCoreMemoryConfig
            from bedrock_agentcore.memory.integrations.strands.session_manager import AgentCoreMemorySessionManager
            AGENTCORE_MEMORY_AVAILABLE = True
        except ImportError:
            AGENTCORE_MEMORY_AVAILABLE = False

        if memory_id and AGENTCORE_MEMORY_AVAILABLE:
            # Cloud mode: Use AgentCore Memory
            logger.debug(f"[MissionControl] Using AgentCore Memory (memory_id={memory_id})")

            config = AgentCoreMemoryConfig(
                memory_id=memory_id,
                session_id=self.session_id,
                actor_id=self.user_id,
                enable_prompt_caching=False,  # No caching for Mission Control
                retrieval_config=None  # No LTM retrieval needed
            )

            return AgentCoreMemorySessionManager(
                agentcore_memory_config=config,
                region_name=self.region
            )
        else:
            # Local mode: Use FileSessionManager
            from strands.session.file_session_manager import FileSessionManager

            sessions_dir = Path(__file__).parent.parent.parent / "sessions"
            sessions_dir.mkdir(exist_ok=True)

            logger.debug(f"[MissionControl] Using FileSessionManager: {sessions_dir}")

            return FileSessionManager(
                session_id=self.session_id,
                storage_dir=str(sessions_dir)
            )

    def _create_agent(self):
        """Create Strands Agent for Mission Control"""
        from botocore.config import Config

        retry_config = Config(
            retries={"max_attempts": 3, "mode": "adaptive"},
            connect_timeout=10,
            read_timeout=60
        )

        model = BedrockModel(
            model_id=self.model_id,
            temperature=0.3,  # Lower temperature for consistent JSON
            boto_client_config=retry_config
        )

        # Create agent with session manager for conversation persistence
        self.agent = Agent(
            model=model,
            system_prompt=self.system_prompt,
            tools=[],  # No tools for now, can be extended
            session_manager=self.session_manager
        )

        logger.debug(f"[MissionControl] Strands Agent created with model {self.model_id}")

    def _extract_first_json_object(self, text: str) -> Optional[dict]:
        """Extract the first valid JSON object from text with balanced braces.

        Handles cases where Mission Control returns JSON followed by extra text.
        """
        # Find the first '{' character
        start_idx = text.find('{')
        if start_idx == -1:
            return None

        # Count braces to find the matching '}'
        brace_count = 0
        in_string = False
        escape_next = False

        for i, char in enumerate(text[start_idx:], start=start_idx):
            if escape_next:
                escape_next = False
                continue

            if char == '\\' and in_string:
                escape_next = True
                continue

            if char == '"' and not escape_next:
                in_string = not in_string
                continue

            if not in_string:
                if char == '{':
                    brace_count += 1
                elif char == '}':
                    brace_count -= 1
                    if brace_count == 0:
                        # Found the matching closing brace
                        json_str = text[start_idx:i + 1]
                        try:
                            data = json.loads(json_str)
                            logger.info(f"[MissionControl] Successfully extracted JSON object")
                            return data
                        except json.JSONDecodeError:
                            # Continue looking for another JSON object
                            continue

        return None

    def _parse_response(self, response_text: str) -> Union[Directive, MissionComplete]:
        """Parse Mission Control's JSON response"""
        # Clean up response - remove markdown code blocks if present
        cleaned = response_text.strip()
        if cleaned.startswith("```"):
            # Remove markdown code block
            cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
            cleaned = re.sub(r"\s*```$", "", cleaned)

        # Try to extract first JSON object if there's extra data
        # This handles cases where Mission Control adds explanation after JSON
        try:
            data = json.loads(cleaned)
        except json.JSONDecodeError as e:
            # Try to find and extract JSON object by finding balanced braces
            logger.warning(f"[MissionControl] Initial parse failed: {e}, attempting to extract JSON")

            data = self._extract_first_json_object(cleaned)
            if data is None:
                logger.error(f"[MissionControl] No valid JSON object found in response")
                logger.error(f"[MissionControl] Response was: {response_text[:500]}")
                raise ValueError(f"Invalid JSON response from Mission Control: {e}")

        response_type = data.get("type")

        if response_type == "directive":
            return Directive(
                directive_id=str(uuid4()),
                step=data.get("step", 1),
                prompt=data.get("prompt", ""),
                tools=data.get("tools", []),
                expected_output=data.get("expected_output", ""),
                context_summary=data.get("context_summary")
            )
        elif response_type == "mission_complete":
            return MissionComplete(
                mission_id=self.mission_id,
                total_steps=data.get("total_steps", 0)
            )
        else:
            raise ValueError(f"Unknown response type: {response_type}")

    async def _invoke_agent(self, message: str) -> str:
        """Invoke Strands Agent and get response text"""
        try:
            # Use synchronous call (Strands Agent doesn't have native async)
            result = self.agent(message)

            # Extract text from result
            response_text = str(result)

            logger.debug(f"[MissionControl] Agent response: {response_text[:200]}...")
            return response_text

        except Exception as e:
            logger.error(f"[MissionControl] Agent invocation failed: {e}")
            raise

    async def get_first_directive(self, user_query: str) -> Union[Directive, MissionComplete]:
        """Get first directive for a new mission

        Args:
            user_query: The user's original request

        Returns:
            First Directive with step 1 instructions, OR
            MissionComplete if Mission Control determines no tools needed
        """
        logger.info(f"[MissionControl] Starting mission: {user_query[:100]}...")

        message = f"""New mission request from user:

"{user_query}"

Analyze this request and decide:
1. If this requires tool usage (research, document creation, calculations, etc.), provide the first directive.
2. If this can be answered directly without any tools (simple questions, greetings, knowledge queries), return mission_complete with total_steps=0.

Remember: Respond with JSON only."""

        response_text = await self._invoke_agent(message)
        result = self._parse_response(response_text)

        if isinstance(result, MissionComplete):
            # Mission Control determined this doesn't need tool execution
            logger.info(f"[MissionControl] No tools needed - delegating to agent")
            return result

        logger.info(f"[MissionControl] First directive: step={result.step}, tools={result.tools}")
        return result

    async def process_report(self, report: ProgressReport) -> Union[Directive, MissionComplete]:
        """Process a progress report and get next directive or completion

        Args:
            report: Progress report from agent execution

        Returns:
            Next Directive or MissionComplete signal
        """
        logger.info(f"[MissionControl] Processing report: {len(report.tool_calls)} tool calls")

        # Build report message with tool calls and response
        message_parts = ["Step completed."]

        if report.tool_calls:
            tool_summary = ", ".join([f"{tc.name}({tc.input_summary})" for tc in report.tool_calls])
            message_parts.append(f"Tools used: {tool_summary}")

        if report.response_text:
            message_parts.append(f"Agent response: {report.response_text}")

        message = "\n\n".join(message_parts)
        message += "\n\nProvide the next directive or signal mission completion. Respond with JSON only."

        response_text = await self._invoke_agent(message)
        result = self._parse_response(response_text)

        if isinstance(result, Directive):
            logger.info(f"[MissionControl] Next directive: step={result.step}, tools={result.tools}")
        else:
            logger.info(f"[MissionControl] Mission complete after {result.total_steps} steps")

        return result

    def get_all_available_tools(self) -> List[str]:
        """Get flat list of all available tool IDs"""
        tools = []
        for group in self.tool_groups:
            tools.extend(group.tools)
        return tools
