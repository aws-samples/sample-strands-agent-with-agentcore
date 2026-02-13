"""
SkillChatAgent - ChatAgent variant with progressive skill disclosure.

Inherits all of ChatAgent's functionality (streaming, session management, etc.)
but routes @skill-decorated tools through skill_dispatcher + skill_executor.
"""

import logging
import os
from typing import Optional, List, Dict

from agents.chat_agent import ChatAgent
from skill.skill_dispatcher import set_dispatcher_registry
from skill.skill_registry import SkillRegistry
from skill.decorators import _apply_skill_metadata

# Resolve skills directory relative to this file: src/agents/../../skills → agentcore/skills
_SKILLS_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "skills")

# Import local tools (same as ChatAgent uses)
import local_tools

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# MCP tool → skill mapping
#
# Maps simplified MCP tool names (after FilteredMCPClient name simplification)
# to skill names. Each skill groups related tools under a single SKILL.md.
# ---------------------------------------------------------------------------

# Skills served by MCP Runtime (3LO OAuth). Everything else is Gateway.
_MCP_RUNTIME_SKILLS = {"gmail", "google-calendar", "notion"}

MCP_TOOL_SKILL_MAP: Dict[str, str] = {
    # Gateway: weather
    "get_today_weather": "weather",
    "get_weather_forecast": "weather",
    # Gateway: financial-news
    "stock_quote": "financial-news",
    "stock_history": "financial-news",
    "financial_news": "financial-news",
    "stock_analysis": "financial-news",
    # Gateway: arxiv-search
    "arxiv_search": "arxiv-search",
    "arxiv_get_paper": "arxiv-search",
    # Gateway: google-web-search
    "google_web_search": "google-web-search",
    # Gateway: google-maps
    "search_places": "google-maps",
    "search_nearby_places": "google-maps",
    "get_place_details": "google-maps",
    "get_directions": "google-maps",
    "geocode_address": "google-maps",
    "reverse_geocode": "google-maps",
    "show_on_map": "google-maps",
    # Gateway: wikipedia-search
    "wikipedia_search": "wikipedia-search",
    "wikipedia_get_article": "wikipedia-search",
    # Gateway: tavily-search
    "tavily_search": "tavily-search",
    "tavily_extract": "tavily-search",
    # MCP Runtime: gmail
    "list_labels": "gmail",
    "list_emails": "gmail",
    "search_emails": "gmail",
    "read_email": "gmail",
    "send_email": "gmail",
    "draft_email": "gmail",
    "delete_email": "gmail",
    "bulk_delete_emails": "gmail",
    "modify_email": "gmail",
    "get_email_thread": "gmail",
    # MCP Runtime: google-calendar
    "list_calendars": "google-calendar",
    "list_events": "google-calendar",
    "get_event": "google-calendar",
    "create_event": "google-calendar",
    "update_event": "google-calendar",
    "delete_event": "google-calendar",
    "quick_add_event": "google-calendar",
    "check_availability": "google-calendar",
    # MCP Runtime: notion
    "notion_search": "notion",
    "notion_list_databases": "notion",
    "notion_query_database": "notion",
    "notion_get_page": "notion",
    "notion_create_page": "notion",
    "notion_update_page": "notion",
    "notion_get_block_children": "notion",
    "notion_append_blocks": "notion",
}

class SkillChatAgent(ChatAgent):
    """ChatAgent with progressive skill disclosure.

    Only tools decorated with @skill are routed through skill_dispatcher/executor.
    The rest of the ChatAgent behavior (streaming, session, hooks) is inherited.
    """

    def _load_tools(self):
        """Override: always include all @skill-decorated local tools + MCP skill tools.

        The frontend may not send skill tool IDs in enabled_tools (Skills mode
        is independent of the Tools panel), so we inject all MCP tool IDs into
        enabled_tools before calling the parent, letting filter_tools handle
        client creation through the normal pipeline.

        For MCP tools (gateway / runtime), FilteredMCPClient instances in the
        tools list are replaced with individual MCPAgentTool objects annotated
        with skill metadata (_skill_name).
        """
        # Inject MCP tool IDs so filter_tools creates Gateway/Runtime clients.
        # Skills mode manages tools via skills, not the frontend tool panel.
        if self.enabled_tools is None:
            self.enabled_tools = []
        has_auth = bool(getattr(self, 'auth_token', None))
        for tool_name, skill_name in MCP_TOOL_SKILL_MAP.items():
            if skill_name in _MCP_RUNTIME_SKILLS:
                # MCP Runtime tools (Gmail, Calendar, Notion) require auth_token.
                # Skip injection when unauthenticated to avoid spurious warnings.
                if not has_auth:
                    continue
                prefixed = f"mcp_{tool_name}"
            else:
                prefixed = f"gateway_{tool_name}"
            if prefixed not in self.enabled_tools:
                self.enabled_tools.append(prefixed)

        # Parent's _load_tools → filter_tools handles client creation,
        # gateway_client, elicitation_bridge, etc.
        tools = super()._load_tools()

        # Collect IDs already loaded to avoid duplicates
        loaded_ids = {getattr(t, 'tool_name', None) for t in tools}

        # Scan the full local registry for @skill tools not yet loaded
        from agents.chat_agent import TOOL_REGISTRY
        for tool_id, tool_obj in TOOL_REGISTRY.items():
            if getattr(tool_obj, '_skill_name', None) and tool_id not in loaded_ids:
                tools.append(tool_obj)
                logger.debug(f"[SkillChatAgent] Auto-loaded skill tool: {tool_id}")

        # Extract individual MCPAgentTool from any FilteredMCPClient instances
        # and attach skill metadata so SkillRegistry can index them.
        final_tools = []
        for t in tools:
            if self._is_mcp_client(t):
                mcp_skill_tools = self._extract_mcp_skill_tools(t)
                final_tools.extend(mcp_skill_tools)
                logger.info(
                    f"[SkillChatAgent] Extracted {len(mcp_skill_tools)} MCP skill tools "
                    f"from {t.__class__.__name__}"
                )
            else:
                final_tools.append(t)

        return final_tools

    @staticmethod
    def _is_mcp_client(obj) -> bool:
        """Check if an object is an MCPClient / ToolProvider (not an individual tool)."""
        # MCPClient has list_tools_sync but no tool_spec (unlike MCPAgentTool)
        return hasattr(obj, "list_tools_sync") and not hasattr(obj, "tool_spec")

    def _extract_mcp_skill_tools(self, client) -> list:
        """Start an MCP client and extract individual MCPAgentTool with skill metadata.

        Each tool is mapped to a skill name via MCP_TOOL_SKILL_MAP.
        Tools not found in the mapping are still included but without skill metadata
        (they'll be passed as non-skill tools to the agent directly).
        """
        try:
            # Start client session and list available tools
            client.start()
            paginated_tools = client.list_tools_sync()

            skill_tools = []
            for tool in paginated_tools:
                tool_name = tool.tool_name  # Simplified name (e.g., "get_today_weather")
                skill_name = MCP_TOOL_SKILL_MAP.get(tool_name)

                if skill_name:
                    _apply_skill_metadata(tool, skill_name)
                    logger.debug(
                        f"[SkillChatAgent] MCP tool '{tool_name}' → skill '{skill_name}'"
                    )
                else:
                    logger.warning(
                        f"[SkillChatAgent] MCP tool '{tool_name}' has no skill mapping — "
                        f"passing as non-skill tool"
                    )

                skill_tools.append(tool)

            return skill_tools

        except Exception as e:
            logger.error(f"[SkillChatAgent] Failed to extract MCP tools: {e}")
            return []

    def create_agent(self):
        """Override: set up skill registry, then delegate to ChatAgent.create_agent().

        Modifies self.tools and self.system_prompt to route skill tools through
        skill_dispatcher/executor, then calls the parent's create_agent() which
        handles hooks, SequentialToolExecutor, NullConversationManager, and all
        other Agent configuration.
        """
        from skill.skill_dispatcher import skill_dispatcher, skill_executor
        from agent.config.prompt_builder import system_prompt_to_string

        # Separate skill tools from non-skill tools
        skill_tools = [t for t in self.tools if getattr(t, '_skill_name', None)]
        non_skill_tools = [t for t in self.tools if not getattr(t, '_skill_name', None)]

        if skill_tools:
            logger.info(
                f"[SkillChatAgent] Routing {len(skill_tools)} skill tools: "
                f"{[t.tool_name for t in skill_tools]}"
            )
        if non_skill_tools:
            logger.info(
                f"[SkillChatAgent] {len(non_skill_tools)} non-skill tools passed directly: "
                f"{[getattr(t, 'tool_name', getattr(t, '__name__', str(t))) for t in non_skill_tools]}"
            )

        # Set up skill registry
        registry = SkillRegistry(_SKILLS_DIR)
        registry.discover_skills()
        registry.bind_tools(skill_tools)
        set_dispatcher_registry(registry)
        self._skill_registry = registry

        # Append skill catalog to system prompt
        catalog = registry.get_catalog()
        if self.system_prompt:
            base_prompt_text = system_prompt_to_string(self.system_prompt)
            self.system_prompt = [{"text": f"{base_prompt_text}\n\n{catalog}"}]
        else:
            self.system_prompt = [{"text": catalog}]

        # Replace tools: skill infrastructure + non-skill tools
        self.tools = [skill_dispatcher, skill_executor] + non_skill_tools

        # Delegate to parent — inherits hooks, SequentialToolExecutor,
        # NullConversationManager, and all other Agent configuration.
        super().create_agent()

        logger.info(
            f"[SkillChatAgent] Agent created with skills: {registry.skill_names}, "
            f"tools: {list(self.agent.tool_registry.registry.keys())}"
        )
