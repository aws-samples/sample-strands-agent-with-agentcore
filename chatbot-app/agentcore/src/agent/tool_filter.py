"""
Unified Tool Filter Module

Consolidates tool filtering logic for all tool sources:
- Local tools (TOOL_REGISTRY)
- Gateway MCP tools (gateway_* prefix)
- A2A Agent tools (agentcore_* prefix)

This module eliminates code duplication between ChatbotAgent and VoiceChatbotAgent.
"""

import logging
import re
from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional, Callable, Pattern, Union

logger = logging.getLogger(__name__)


# Type aliases for tool matching (following Strands SDK pattern)
ToolMatcher = Union[str, Pattern[str], Callable[[str], bool]]


@dataclass
class ToolFilters:
    """
    Filters for controlling which tools are loaded.

    Follows Strands SDK ToolFilters pattern:
    1. If 'allowed' is specified, only tools matching these patterns are included
    2. Tools matching 'rejected' patterns are then excluded
    """
    allowed: Optional[List[ToolMatcher]] = None
    rejected: Optional[List[ToolMatcher]] = None


@dataclass
class FilteredToolResult:
    """
    Result of tool filtering operation.

    Attributes:
        tools: List of tool objects ready for Agent
        metadata: Additional info (name mappings, categories, etc.)
        clients: Lifecycle objects (Gateway MCP client, etc.)
        validation_errors: List of issues encountered during filtering
        tool_ids_by_source: Mapping of source -> list of tool IDs
    """
    tools: List[Any] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)
    clients: Dict[str, Any] = field(default_factory=dict)
    validation_errors: List[str] = field(default_factory=list)
    tool_ids_by_source: Dict[str, List[str]] = field(default_factory=dict)


class ToolFilterRegistry:
    """
    Unified tool filter that handles all tool sources.

    Tool ID conventions:
    - Local tools: plain ID (e.g., "calculator", "fetch_url_content")
    - Gateway tools: "gateway_" prefix (e.g., "gateway_wikipedia_search")
    - A2A agents: "agentcore_" prefix (e.g., "agentcore_research-agent")
    """

    # Prefixes for different tool sources
    GATEWAY_PREFIX = "gateway_"
    A2A_PREFIX = "agentcore_"

    def __init__(
        self,
        local_registry: Optional[Dict[str, Any]] = None,
        gateway_client_factory: Optional[Callable] = None,
        a2a_tool_factory: Optional[Callable] = None,
    ):
        """
        Initialize the tool filter registry.

        Args:
            local_registry: Dict mapping tool_id -> tool object (default: imports TOOL_REGISTRY)
            gateway_client_factory: Function to create Gateway MCP client
            a2a_tool_factory: Function to create A2A tools
        """
        self._local_registry = local_registry
        self._gateway_client_factory = gateway_client_factory
        self._a2a_tool_factory = a2a_tool_factory

    def _get_local_registry(self) -> Dict[str, Any]:
        """Lazy load local registry to avoid circular imports."""
        if self._local_registry is None:
            from agent.agent import TOOL_REGISTRY
            self._local_registry = TOOL_REGISTRY
        return self._local_registry

    def _get_gateway_client_factory(self) -> Optional[Callable]:
        """Lazy load gateway client factory."""
        if self._gateway_client_factory is None:
            try:
                from agent.gateway_mcp_client import get_gateway_client_if_enabled
                self._gateway_client_factory = get_gateway_client_if_enabled
            except ImportError:
                logger.warning("Gateway MCP client not available")
                return None
        return self._gateway_client_factory

    def _get_a2a_tool_factory(self) -> Optional[Callable]:
        """Lazy load A2A tool factory."""
        if self._a2a_tool_factory is None:
            try:
                import a2a_tools
                self._a2a_tool_factory = a2a_tools.create_a2a_tool
            except ImportError:
                logger.warning("A2A tools module not available")
                return None
        return self._a2a_tool_factory

    def classify_tool_id(self, tool_id: str) -> str:
        """
        Classify a tool ID by its source.

        Args:
            tool_id: The tool identifier

        Returns:
            Source type: "local", "gateway", "a2a", or "unknown"
        """
        if tool_id.startswith(self.GATEWAY_PREFIX):
            return "gateway"
        elif tool_id.startswith(self.A2A_PREFIX):
            return "a2a"
        elif tool_id in self._get_local_registry():
            return "local"
        else:
            return "unknown"

    def _matches_pattern(self, tool_id: str, pattern: ToolMatcher) -> bool:
        """Check if tool_id matches a pattern."""
        if callable(pattern):
            return pattern(tool_id)
        elif isinstance(pattern, Pattern):
            return bool(pattern.match(tool_id))
        elif isinstance(pattern, str):
            # Support glob-like wildcards
            if "*" in pattern:
                regex = pattern.replace("*", ".*")
                return bool(re.match(f"^{regex}$", tool_id))
            return pattern == tool_id
        return False

    def _should_include_tool(
        self,
        tool_id: str,
        filters: Optional[ToolFilters]
    ) -> bool:
        """
        Check if a tool should be included based on filters.

        Args:
            tool_id: The tool identifier
            filters: Optional ToolFilters with allowed/rejected patterns

        Returns:
            True if tool should be included
        """
        if filters is None:
            return True

        # Check allowed patterns
        if filters.allowed is not None:
            matched = any(
                self._matches_pattern(tool_id, p)
                for p in filters.allowed
            )
            if not matched:
                return False

        # Check rejected patterns
        if filters.rejected is not None:
            rejected = any(
                self._matches_pattern(tool_id, p)
                for p in filters.rejected
            )
            if rejected:
                return False

        return True

    def filter_tools(
        self,
        enabled_tool_ids: Optional[List[str]],
        filters: Optional[ToolFilters] = None,
        log_prefix: str = "",
    ) -> FilteredToolResult:
        """
        Filter and load tools from all sources.

        Args:
            enabled_tool_ids: List of tool IDs to enable. None or empty = no tools.
            filters: Optional additional ToolFilters (allowed/rejected patterns)
            log_prefix: Prefix for log messages (e.g., "[VoiceAgent]")

        Returns:
            FilteredToolResult with tools, metadata, clients, and errors
        """
        result = FilteredToolResult()
        result.tool_ids_by_source = {
            "local": [],
            "gateway": [],
            "a2a": [],
        }

        # No tools if enabled_tool_ids is None or empty
        if not enabled_tool_ids:
            logger.debug(f"{log_prefix} No enabled_tools specified - returning empty")
            return result

        # Classify and collect tool IDs by source
        gateway_tool_ids = []
        a2a_agent_ids = []

        for tool_id in enabled_tool_ids:
            # Apply additional filters if provided
            if not self._should_include_tool(tool_id, filters):
                logger.debug(f"{log_prefix} Tool '{tool_id}' filtered out by ToolFilters")
                continue

            source = self.classify_tool_id(tool_id)

            if source == "local":
                # Local tool - add directly
                tool_obj = self._get_local_registry().get(tool_id)
                if tool_obj:
                    result.tools.append(tool_obj)
                    result.tool_ids_by_source["local"].append(tool_id)
                else:
                    result.validation_errors.append(
                        f"Local tool '{tool_id}' not found in registry"
                    )

            elif source == "gateway":
                gateway_tool_ids.append(tool_id)

            elif source == "a2a":
                a2a_agent_ids.append(tool_id)

            else:
                result.validation_errors.append(
                    f"Tool '{tool_id}' not found in any source"
                )

        # Process Gateway tools
        if gateway_tool_ids:
            gateway_result = self._load_gateway_tools(gateway_tool_ids, log_prefix)
            if gateway_result.get("client"):
                result.tools.append(gateway_result["client"])
                result.clients["gateway"] = gateway_result["client"]
                result.tool_ids_by_source["gateway"] = gateway_tool_ids
            if gateway_result.get("error"):
                result.validation_errors.append(gateway_result["error"])

        # Process A2A tools
        if a2a_agent_ids:
            for agent_id in a2a_agent_ids:
                a2a_result = self._load_a2a_tool(agent_id, log_prefix)
                if a2a_result.get("tool"):
                    result.tools.append(a2a_result["tool"])
                    result.tool_ids_by_source["a2a"].append(agent_id)
                if a2a_result.get("error"):
                    result.validation_errors.append(a2a_result["error"])

        # Log summary
        local_count = len(result.tool_ids_by_source["local"])
        gateway_count = len(result.tool_ids_by_source["gateway"])
        a2a_count = len(result.tool_ids_by_source["a2a"])

        logger.debug(f"{log_prefix} Local tools: {local_count}")
        logger.debug(f"{log_prefix} Gateway tools: {gateway_count}")
        logger.debug(f"{log_prefix} A2A agents: {a2a_count}")
        logger.info(
            f"{log_prefix} Total enabled tools: {len(result.tools)} "
            f"(local={local_count}, gateway={gateway_count}, a2a={a2a_count})"
        )

        return result

    def _load_gateway_tools(
        self,
        tool_ids: List[str],
        log_prefix: str
    ) -> Dict[str, Any]:
        """
        Load Gateway MCP tools.

        Args:
            tool_ids: List of gateway tool IDs
            log_prefix: Prefix for log messages

        Returns:
            Dict with "client" and/or "error"
        """
        factory = self._get_gateway_client_factory()
        if not factory:
            return {"error": "Gateway MCP client factory not available"}

        try:
            client = factory(enabled_tool_ids=tool_ids)
            if client:
                logger.debug(f"{log_prefix} Gateway MCP client created: {tool_ids}")
                return {"client": client}
            else:
                return {"error": "Gateway MCP client returned None"}
        except Exception as e:
            logger.error(f"{log_prefix} Failed to create Gateway client: {e}")
            return {"error": f"Gateway client creation failed: {e}"}

    def _load_a2a_tool(
        self,
        agent_id: str,
        log_prefix: str
    ) -> Dict[str, Any]:
        """
        Load a single A2A agent tool.

        Args:
            agent_id: A2A agent ID (e.g., "agentcore_research-agent")
            log_prefix: Prefix for log messages

        Returns:
            Dict with "tool" and/or "error"
        """
        factory = self._get_a2a_tool_factory()
        if not factory:
            return {"error": f"A2A tool factory not available for {agent_id}"}

        try:
            tool = factory(agent_id)
            if tool:
                logger.debug(f"{log_prefix} A2A Agent created: {agent_id}")
                return {"tool": tool}
            else:
                return {"error": f"A2A agent '{agent_id}' not found in config"}
        except Exception as e:
            logger.error(f"{log_prefix} Failed to create A2A tool {agent_id}: {e}")
            return {"error": f"A2A tool creation failed for {agent_id}: {e}"}


# Module-level singleton for convenience
_default_registry: Optional[ToolFilterRegistry] = None


def get_tool_filter_registry() -> ToolFilterRegistry:
    """Get the default ToolFilterRegistry singleton."""
    global _default_registry
    if _default_registry is None:
        _default_registry = ToolFilterRegistry()
    return _default_registry


def filter_tools(
    enabled_tool_ids: Optional[List[str]],
    filters: Optional[ToolFilters] = None,
    log_prefix: str = "",
) -> FilteredToolResult:
    """
    Convenience function to filter tools using the default registry.

    Args:
        enabled_tool_ids: List of tool IDs to enable
        filters: Optional ToolFilters (allowed/rejected patterns)
        log_prefix: Prefix for log messages

    Returns:
        FilteredToolResult with tools, metadata, clients, and errors

    Example:
        result = filter_tools(["calculator", "gateway_wikipedia_search"])
        agent = Agent(tools=result.tools)

        # Access gateway client for lifecycle management
        gateway_client = result.clients.get("gateway")

        # Check for any issues
        if result.validation_errors:
            for error in result.validation_errors:
                logger.warning(error)
    """
    return get_tool_filter_registry().filter_tools(
        enabled_tool_ids=enabled_tool_ids,
        filters=filters,
        log_prefix=log_prefix,
    )
