"""
Gateway MCP Client for AgentCore Gateway Tools
Creates MCP client with JWT Bearer authentication for Gateway tools.
Gateway uses CUSTOM_JWT inbound auth — the orchestrator forwards the user's JWT.
"""

import logging
import os
import httpx
import boto3
from typing import Optional, List, Callable, Any
from mcp.client.streamable_http import streamablehttp_client
from strands.tools.mcp import MCPClient

logger = logging.getLogger(__name__)


class BearerAuth(httpx.Auth):
    """httpx Auth that adds a Bearer token to every request."""

    def __init__(self, token: str):
        self.token = token

    def auth_flow(self, request: httpx.Request):
        request.headers["Authorization"] = f"Bearer {self.token}"
        yield request


class FilteredMCPClient(MCPClient):
    """
    MCPClient wrapper that filters tools based on enabled tool IDs.
    This allows us to use Managed Integration while still filtering tools.

    The client automatically maintains the MCP session for the lifetime
    of the ChatbotAgent instance, ensuring tools remain accessible.
    """

    def __init__(
        self,
        client_factory: Callable[[], Any],
        enabled_tool_ids: List[str],
        prefix: str = "gateway",
        api_keys: Optional[dict] = None,
        elicitation_callback=None,
    ):
        """
        Initialize filtered MCP client.

        Args:
            client_factory: Factory function to create MCP client transport
            enabled_tool_ids: List of tool IDs that should be enabled
            prefix: Prefix used for tool IDs (default: 'gateway')
            api_keys: User-specific API keys for external services
            elicitation_callback: MCP elicitation callback for OAuth consent flows
        """
        super().__init__(client_factory, elicitation_callback=elicitation_callback)
        self.enabled_tool_ids = enabled_tool_ids
        self.prefix = prefix
        self._session_started = False
        self.api_keys = api_keys  # User-specific API keys
        logger.debug(f"FilteredMCPClient created with {len(enabled_tool_ids)} enabled tool IDs")

    def __enter__(self):
        """Start MCP session when entering context"""
        logger.debug("Starting FilteredMCPClient session")
        result = super().__enter__()
        self._session_started = True
        return result

    def __exit__(self, exc_type, exc_val, exc_tb):
        """Close MCP session when exiting context"""
        logger.debug("Closing FilteredMCPClient session")
        self._session_started = False
        return super().__exit__(exc_type, exc_val, exc_tb)

    def ensure_session(self):
        """Ensure the MCP session is alive, restarting if necessary.

        When MCP tools are used through skill_executor (not Strands' managed
        integration), the session can die due to HTTP timeouts or connection
        drops.  This method provides a safe restart mechanism.
        """
        if not self._is_session_active():
            logger.info("FilteredMCPClient session not active — restarting")
            try:
                self.start()
                self._session_started = True
            except Exception as e:
                logger.error(f"Failed to restart MCP session: {e}")
                raise

    def list_tools_sync(self, *args, **kwargs):
        """List tools from Gateway and filter based on enabled_tool_ids.

        Also simplifies tool names by removing the Gateway namespace prefix.
        For example: "search-places___search_places" becomes "search_places"
        This makes tool names cleaner for Claude, Frontend UI, and logs.
        """
        from strands.types import PaginatedList

        paginated_result = super().list_tools_sync()

        # Filter tools based on enabled_tool_ids
        # Support both full names and simplified names:
        # - gateway_search-places___search_places (full)
        # - gateway_search_places (simplified)
        filtered_tools = []
        for tool in paginated_result:
            full_name = tool.tool_name  # e.g., "search-places___search_places"

            # Extract simplified name if tool has ___ separator
            if '___' in full_name:
                target_name, schema_name = full_name.split('___', 1)
                simplified_name = schema_name
            else:
                simplified_name = full_name

            # Check if this tool is enabled (support both formats)
            for enabled_id in self.enabled_tool_ids:
                # Remove prefix: "gateway_search-places___search_places" → "search-places___search_places"
                enabled_without_prefix = enabled_id.replace(f"{self.prefix}_", "")

                # Match full name or simplified name
                if (enabled_without_prefix == full_name or
                    enabled_without_prefix == simplified_name or
                    full_name in enabled_id):
                    filtered_tools.append(tool)
                    break

        logger.debug(f"Filtered {len(filtered_tools)} tools from {len(paginated_result)} available")
        logger.debug(f"   Enabled tool IDs: {self.enabled_tool_ids}")
        logger.debug(f"   Original tool names: {[t.tool_name for t in filtered_tools]}")

        # Build tool name mapping and simplify tool names
        self._tool_name_map = {}
        simplified_tools = []

        for tool in filtered_tools:
            full_name = tool.tool_name  # e.g., "search-places___search_places"

            # Extract simplified name (schema_name: snake_case)
            if '___' in full_name:
                target_name, schema_name = full_name.split('___', 1)
                simplified_name = schema_name  # Use schema_name as the simplified name

                # Build reverse mapping: simplified → full name (for call_tool_sync)
                self._tool_name_map[simplified_name] = full_name

                # Modify tool_spec to use simplified name
                # Note: tool is MCPAgentTool, tool_spec is a dict property
                tool._agent_tool_name = simplified_name

                logger.debug(f"Simplified tool name: {full_name} → {simplified_name}")
            else:
                simplified_name = full_name

            simplified_tools.append(tool)

        logger.debug(f"   Simplified tool names: {[t.tool_name for t in simplified_tools]}")
        logger.debug(f"   Tool name mapping created: {len(self._tool_name_map)} mappings")

        return PaginatedList(simplified_tools, token=paginated_result.pagination_token)

    def call_tool_sync(self, tool_use_id: str, name: str, arguments: dict, **kwargs):
        """
        Call tool with automatic name conversion and API key injection.

        Converts simplified tool name (e.g., "search_places") back to
        Gateway's full name format (e.g., "search-places___search_places")
        before calling the Gateway.

        Also injects user API keys into arguments if available.
        """
        # Convert simplified name to full name for Gateway
        actual_name = name
        if hasattr(self, '_tool_name_map') and name in self._tool_name_map:
            actual_name = self._tool_name_map[name]
            logger.debug(f"Restoring full tool name for Gateway: {name} → {actual_name}")

        # Inject user API keys into arguments (Lambda will extract these)
        if self.api_keys:
            arguments = {**arguments, '__user_api_keys': self.api_keys}
            logger.debug("Injected user API keys into tool arguments")

        return super().call_tool_sync(tool_use_id, actual_name, arguments, **kwargs)


def get_gateway_url_from_ssm(
    project_name: str = "strands-agent-chatbot",
    environment: str = "dev",
    region: str = "us-west-2"
) -> Optional[str]:
    """
    Retrieve Gateway URL from SSM Parameter Store.

    Args:
        project_name: Project name for SSM parameter path
        environment: Environment name (dev, prod, etc.)
        region: AWS region

    Returns:
        Gateway URL or None if not found
    """
    try:
        ssm = boto3.client('ssm', region_name=region)
        response = ssm.get_parameter(
            Name=f'/{project_name}/{environment}/mcp/gateway-url'
        )
        gateway_url = response['Parameter']['Value']
        logger.debug(f"Gateway URL retrieved from SSM: {gateway_url}")
        return gateway_url
    except Exception as e:
        logger.debug(f"Failed to get Gateway URL from SSM: {e}")
        return None


def _make_gateway_auth(auth_token: Optional[str] = None) -> Optional[httpx.Auth]:
    """Create auth for Gateway: Bearer JWT if token available, else None."""
    if auth_token:
        token = auth_token.replace("Bearer ", "") if auth_token.startswith("Bearer ") else auth_token
        return BearerAuth(token)
    return None


def create_gateway_mcp_client(
    gateway_url: Optional[str] = None,
    auth_token: Optional[str] = None,
) -> Optional[MCPClient]:
    """Create MCP client for AgentCore Gateway with JWT Bearer authentication."""
    if not gateway_url:
        gateway_url = get_gateway_url_from_ssm()
        if not gateway_url:
            logger.debug("Gateway URL not available. Gateway tools will not be loaded.")
            return None

    auth = _make_gateway_auth(auth_token)

    mcp_client = MCPClient(
        lambda: streamablehttp_client(gateway_url, auth=auth)
    )

    logger.debug(f"Gateway MCP client created: {gateway_url}")
    return mcp_client


def create_filtered_gateway_client(
    enabled_tool_ids: List[str],
    prefix: str = "gateway",
    api_keys: Optional[dict] = None,
    auth_token: Optional[str] = None,
) -> Optional[FilteredMCPClient]:
    """Create Gateway MCP client with tool filtering and JWT Bearer auth."""
    gateway_tool_ids = [tid for tid in enabled_tool_ids if tid.startswith(f"{prefix}_")]

    if not gateway_tool_ids:
        logger.debug("No Gateway tools enabled")
        return None

    gateway_url = get_gateway_url_from_ssm()
    if not gateway_url:
        logger.debug("Gateway URL not available. Gateway tools will not be loaded.")
        return None

    auth = _make_gateway_auth(auth_token)

    logger.debug(f"Creating FilteredMCPClient with {len(gateway_tool_ids)} enabled tool IDs")

    mcp_client = FilteredMCPClient(
        lambda: streamablehttp_client(gateway_url, auth=auth),
        enabled_tool_ids=gateway_tool_ids,
        prefix=prefix,
        api_keys=api_keys
    )

    logger.debug(f"FilteredMCPClient created: {gateway_url}")
    return mcp_client


# Environment variable control
GATEWAY_ENABLED = os.environ.get('GATEWAY_MCP_ENABLED', 'true').lower() == 'true'

def get_gateway_client_if_enabled(
    enabled_tool_ids: Optional[List[str]] = None,
    api_keys: Optional[dict] = None,
    auth_token: Optional[str] = None,
) -> Optional[MCPClient]:
    """Get Gateway MCP client if enabled via environment variable."""
    if not GATEWAY_ENABLED:
        logger.debug("Gateway MCP is disabled via GATEWAY_MCP_ENABLED=false")
        return None

    if enabled_tool_ids:
        return create_filtered_gateway_client(enabled_tool_ids, api_keys=api_keys, auth_token=auth_token)
    else:
        return create_gateway_mcp_client(auth_token=auth_token)
